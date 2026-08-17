// aiditor.inspector folding state — expanded Section paths per project/primary.
;(function (aiditor) {
  'use strict'

  const inspector = aiditor.inspector
  const VERSION = 1
  const STORAGE_KEY = 'aiditor.inspector.folding'
  const DEFAULT_MAX_ENTRIES = 512
  const DEFAULT_THROTTLE_MS = 250
  const anonymousIds = new WeakMap()
  let nextAnonymousId = 0

  function fieldSectionPath(fieldPath) {
    return JSON.stringify(['field', String(fieldPath)])
  }

  function groupSectionPath(parentFieldPath, groupId) {
    return JSON.stringify(['group', String(parentFieldPath || ''), String(groupId)])
  }

  function foldingScope(inspection, targets, meta) {
    const list = targets || []
    const primary = list[0]
    if (!inspection || !primary) return null
    const provider = inspection.provider
    let primaryId = provider && typeof provider.targetId === 'function'
      ? aiditor.safeCall({ scope: 'inspector', action: 'targetId', type: inspection.type }, function () {
        return provider.targetId(primary, list)
      })
      : primary.id
    let persistent = primaryId != null && primaryId !== ''
    if (!persistent) primaryId = anonymousId(primary)
    return {
      workspaceId: String(meta && meta.workspaceId || 'default'),
      providerType: String(inspection.type),
      primaryId: String(primaryId),
      persistent: persistent,
    }
  }

  function anonymousId(primary) {
    if ((typeof primary === 'object' && primary) || typeof primary === 'function') {
      let id = anonymousIds.get(primary)
      if (!id) {
        id = '@session:' + (++nextAnonymousId)
        anonymousIds.set(primary, id)
      }
      return id
    }
    return '@session:' + (++nextAnonymousId)
  }

  /**
   * @aiditorApi aiditor.inspector.createFoldingStateStore
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.createFoldingStateStore(options?)
   * @summary Create the bounded project/primary folding-state owner used by PropertyForm field Sections, recursive StructInput Sections, and Groups.
   * @param {object} options - Optional persistence, LRU, and throttling configuration.
   * @returns {object} FoldingStateStore with bind(scope,path), flush(), snapshot(workspaceId), and dispose().
   * @related aiditor.ui.propertyForm,aiditor.inspector.select,aiditor.workspaceState.configure
   */
  function createFoldingStateStore(opts) {
    const o = opts || {}
    const state = o.workspaceState || aiditor.workspaceState
    const storageKey = String(o.storageKey || STORAGE_KEY)
    const maxEntries = Math.max(1, Number(o.maxEntries) || DEFAULT_MAX_ENTRIES)
    const throttleMs = Math.max(0, Number(o.throttleMs) || DEFAULT_THROTTLE_MS)
    const projects = new Map()
    const sessionEntries = new Map()
    const observers = new Map()
    const bindings = new Set()
    let disposed = false

    function bind(scopeSource, sectionPath) {
      if (!validSectionPath(sectionPath)) throw new Error('inspector.foldingState.bind: invalid section path')
      const value = aiditor.signal(false)
      const binding = {
        scope: null,
        scopeKey: '',
        observerKey: '',
        value: value,
        disposed: false,
      }
      bindings.add(binding)
      const stop = aiditor.effect(function () {
        const next = normalizeScope(readSource(scopeSource))
        const nextKey = next ? fullScopeKey(next) : ''
        if (binding.scopeKey === nextKey) return
        detach(binding)
        binding.scope = next
        binding.scopeKey = nextKey
        if (next) attach(binding, sectionPath)
        else value.set(false)
      })
      binding.stop = stop
      const read = function () { return value() }
      read.peek = value.peek
      read.set = function (expanded) {
        if (binding.scope) setExpanded(binding.scope, sectionPath, !!expanded)
      }
      read.dispose = function () {
        if (binding.disposed) return
        binding.disposed = true
        stop()
        detach(binding)
        bindings.delete(binding)
      }
      return read
    }

    function attach(binding, sectionPath) {
      const scope = binding.scope
      if (scope.persistent) {
        const project = projectFor(scope.workspaceId)
        ensureLoaded(project)
        const key = primaryKey(scope)
        const refs = project.refs.get(key) || 0
        project.refs.set(key, refs + 1)
        if (!refs && project.entries.has(key)) touchPersistent(project, key, true)
      } else {
        touchSession(scope)
      }
      const key = observerKey(scope, sectionPath)
      let list = observers.get(key)
      if (!list) {
        list = new Set()
        observers.set(key, list)
      }
      list.add(binding)
      binding.observerKey = key
      binding.value.set(isExpanded(scope, sectionPath))
    }

    function detach(binding) {
      if (!binding.scope) return
      const list = observers.get(binding.observerKey)
      if (list) {
        list.delete(binding)
        if (!list.size) observers.delete(binding.observerKey)
      }
      if (binding.scope.persistent) {
        const project = projects.get(binding.scope.workspaceId)
        if (project) {
          const key = primaryKey(binding.scope)
          const refs = project.refs.get(key) || 0
          if (refs <= 1) project.refs.delete(key)
          else project.refs.set(key, refs - 1)
        }
      }
      binding.scope = null
      binding.scopeKey = ''
      binding.observerKey = ''
    }

    function setExpanded(scope, sectionPath, expanded) {
      if (scope.persistent) setPersistentExpanded(scope, sectionPath, expanded)
      else setSessionExpanded(scope, sectionPath, expanded)
    }

    function setPersistentExpanded(scope, sectionPath, expanded) {
      const project = projectFor(scope.workspaceId)
      ensureLoaded(project)
      const key = primaryKey(scope)
      let record = project.entries.get(key)
      if (expanded) {
        if (!record) {
          record = persistentRecord(scope)
          project.entries.set(key, record)
        }
        if (record.expanded.has(sectionPath)) return
        record.expanded.add(sectionPath)
        touchPersistent(project, key, false)
      } else {
        if (!record || !record.expanded.has(sectionPath)) return
        record.expanded.delete(sectionPath)
        if (!record.expanded.size) project.entries.delete(key)
        else touchPersistent(project, key, false)
      }
      if (!project.loaded) project.touched.add(key)
      project.revision++
      project.dirty = true
      evictPersistent(project)
      scheduleProject(project)
      notify(scope, sectionPath)
    }

    function setSessionExpanded(scope, sectionPath, expanded) {
      const key = fullScopeKey(scope)
      let record = sessionEntries.get(key)
      if (expanded) {
        if (!record) {
          record = { expanded: new Set() }
          sessionEntries.set(key, record)
        }
        if (record.expanded.has(sectionPath)) return
        record.expanded.add(sectionPath)
        sessionEntries.delete(key)
        sessionEntries.set(key, record)
      } else {
        if (!record || !record.expanded.has(sectionPath)) return
        record.expanded.delete(sectionPath)
        if (!record.expanded.size) sessionEntries.delete(key)
      }
      while (sessionEntries.size > maxEntries) sessionEntries.delete(sessionEntries.keys().next().value)
      notify(scope, sectionPath)
    }

    function isExpanded(scope, sectionPath) {
      if (!scope) return false
      if (!scope.persistent) {
        const record = sessionEntries.get(fullScopeKey(scope))
        return !!record && record.expanded.has(sectionPath)
      }
      const project = projects.get(scope.workspaceId)
      const record = project && project.entries.get(primaryKey(scope))
      return !!record && record.expanded.has(sectionPath)
    }

    function touchPersistent(project, key, dirty) {
      const record = project.entries.get(key)
      if (!record) return
      project.entries.delete(key)
      project.entries.set(key, record)
      if (dirty) {
        project.revision++
        project.dirty = true
        scheduleProject(project)
      }
    }

    function touchSession(scope) {
      const key = fullScopeKey(scope)
      const record = sessionEntries.get(key)
      if (!record) return
      sessionEntries.delete(key)
      sessionEntries.set(key, record)
    }

    function evictPersistent(project) {
      while (project.entries.size > maxEntries) {
        const key = project.entries.keys().next().value
        const record = project.entries.get(key)
        project.entries.delete(key)
        if (!project.loaded) project.touched.add(key)
        notifyRecord(project.workspaceId, record)
      }
    }

    function projectFor(workspaceId) {
      let project = projects.get(workspaceId)
      if (!project) {
        project = {
          workspaceId: workspaceId,
          entries: new Map(),
          refs: new Map(),
          touched: new Set(),
          loaded: false,
          loading: null,
          loadGeneration: 0,
          revision: 0,
          dirty: false,
          timer: null,
        }
        projects.set(workspaceId, project)
      }
      return project
    }

    function ensureLoaded(project) {
      if (project.loaded || project.loading) return project.loading
      const generation = ++project.loadGeneration
      project.loading = state.load(project.workspaceId, storageKey).then(function (raw) {
        if (generation !== project.loadGeneration) return
        const decoded = decodeSnapshot(raw, maxEntries)
        mergeLoaded(project, decoded.entries)
        project.loaded = true
        project.loading = null
        if (decoded.normalized) {
          project.revision++
          project.dirty = true
        }
        notifyProject(project.workspaceId)
        if (project.dirty) scheduleProject(project)
      }, function (err) {
        if (generation !== project.loadGeneration) return
        project.loaded = true
        project.loading = null
        reportPersistenceError(err, 'load', project.workspaceId)
        if (project.dirty) scheduleProject(project)
      })
      return project.loading
    }

    function mergeLoaded(project, loaded) {
      const current = project.entries
      const merged = new Map()
      loaded.forEach(function (record, key) {
        if (!project.touched.has(key)) merged.set(key, record)
      })
      current.forEach(function (record, key) {
        merged.delete(key)
        merged.set(key, record)
      })
      project.entries = merged
      project.refs.forEach(function (_, key) {
        if (project.entries.has(key)) touchPersistent(project, key, true)
      })
      evictPersistent(project)
      project.touched.clear()
    }

    function scheduleProject(project) {
      if (disposed || project.timer != null) return
      project.timer = setTimeout(function () {
        project.timer = null
        flushProject(project).catch(function () {})
      }, throttleMs)
    }

    function flushProject(project) {
      if (project.timer != null) {
        clearTimeout(project.timer)
        project.timer = null
      }
      if (project.loading) return project.loading.then(function () { return flushProject(project) })
      if (!project.loaded || !project.dirty) return Promise.resolve(null)
      const revision = project.revision
      const snapshot = encodeSnapshot(project.entries)
      project.dirty = false
      const write = snapshot.entries.length
        ? state.save(project.workspaceId, storageKey, snapshot)
        : state.remove(project.workspaceId, storageKey)
      return write.then(function (value) {
        if (project.revision !== revision || project.dirty) scheduleProject(project)
        return value
      }, function (err) {
        project.dirty = true
        reportPersistenceError(err, 'save', project.workspaceId)
        throw err
      })
    }

    function flush() {
      return Promise.all(Array.from(projects.values()).map(flushProject))
    }

    function notify(scope, sectionPath) {
      const list = observers.get(observerKey(scope, sectionPath))
      if (!list) return
      const expanded = isExpanded(scope, sectionPath)
      list.forEach(function (binding) { binding.value.set(expanded) })
    }

    function notifyRecord(workspaceId, record) {
      if (!record) return
      record.expanded.forEach(function (path) {
        notify({
          workspaceId: workspaceId,
          providerType: record.providerType,
          primaryId: record.primaryId,
          persistent: true,
        }, path)
      })
    }

    function notifyProject(workspaceId) {
      bindings.forEach(function (binding) {
        if (binding.scope && binding.scope.workspaceId === workspaceId) {
          binding.value.set(isExpanded(binding.scope, observerSectionPath(binding.observerKey)))
        }
      })
    }

    function observerSectionPath(key) {
      return JSON.parse(key)[3]
    }

    function onPageHide() { flush().catch(function () {}) }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') onPageHide()
    }
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', onPageHide)
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVisibilityChange)

    function dispose() {
      if (disposed) return
      disposed = true
      bindings.forEach(function (binding) {
        if (!binding.disposed) {
          binding.disposed = true
          binding.stop()
          detach(binding)
        }
      })
      bindings.clear()
      projects.forEach(function (project) {
        if (project.timer != null) clearTimeout(project.timer)
      })
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('pagehide', onPageHide)
      if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', onVisibilityChange)
    }

    return {
      bind: bind,
      flush: flush,
      dispose: dispose,
      snapshot: function (workspaceId) {
        const project = projects.get(String(workspaceId))
        return project ? encodeSnapshot(project.entries) : { version: VERSION, entries: [] }
      },
    }
  }

  function decodeSnapshot(raw, maxEntries) {
    if (raw == null) return { entries: new Map(), normalized: false }
    if (!raw || raw.version !== VERSION || !Array.isArray(raw.entries)) {
      return { entries: new Map(), normalized: true }
    }
    const entries = new Map()
    let normalized = raw.entries.length > maxEntries
    const start = Math.max(0, raw.entries.length - maxEntries)
    for (let i = start; i < raw.entries.length; i++) {
      const item = raw.entries[i]
      if (!validEntry(item)) {
        normalized = true
        continue
      }
      const expanded = new Set()
      for (let j = 0; j < item.expanded.length; j++) {
        if (validSectionPath(item.expanded[j])) expanded.add(item.expanded[j])
        else normalized = true
      }
      if (!expanded.size) {
        normalized = true
        continue
      }
      const record = {
        providerType: String(item.providerType),
        primaryId: String(item.primaryId),
        expanded: expanded,
      }
      const key = JSON.stringify([record.providerType, record.primaryId])
      if (entries.has(key)) {
        entries.delete(key)
        normalized = true
      }
      entries.set(key, record)
    }
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value)
      normalized = true
    }
    return { entries: entries, normalized: normalized }
  }

  function encodeSnapshot(entries) {
    return {
      version: VERSION,
      entries: Array.from(entries.values()).map(function (record) {
        return {
          providerType: record.providerType,
          primaryId: record.primaryId,
          expanded: Array.from(record.expanded),
        }
      }),
    }
  }

  function validEntry(item) {
    return !!item && typeof item === 'object' && item.providerType != null && item.providerType !== '' &&
      item.primaryId != null && item.primaryId !== '' && Array.isArray(item.expanded)
  }

  function validSectionPath(path) {
    if (typeof path !== 'string') return false
    let value
    try { value = JSON.parse(path) } catch (_) { return false }
    if (!Array.isArray(value)) return false
    if (value[0] === 'field') return value.length === 2 && typeof value[1] === 'string' && !!value[1]
    return value[0] === 'group' && value.length === 3 && typeof value[1] === 'string' && typeof value[2] === 'string' && !!value[2]
  }

  function normalizeScope(scope) {
    if (!scope) return null
    return {
      workspaceId: String(scope.workspaceId || 'default'),
      providerType: String(scope.providerType),
      primaryId: String(scope.primaryId),
      persistent: scope.persistent !== false,
    }
  }

  function readSource(source) {
    return typeof source === 'function' && source.peek ? source() : source
  }

  function persistentRecord(scope) {
    return { providerType: scope.providerType, primaryId: scope.primaryId, expanded: new Set() }
  }

  function primaryKey(scope) {
    return JSON.stringify([scope.providerType, scope.primaryId])
  }

  function fullScopeKey(scope) {
    return JSON.stringify([scope.workspaceId, scope.providerType, scope.primaryId])
  }

  function observerKey(scope, sectionPath) {
    return JSON.stringify([scope.workspaceId, scope.providerType, scope.primaryId, sectionPath])
  }

  function reportPersistenceError(err, action, workspaceId) {
    if (aiditor.reportError) aiditor.reportError(err, { scope: 'inspector.foldingState', action: action, workspaceId: workspaceId })
  }

  inspector.createFoldingStateStore = createFoldingStateStore
  inspector.foldingState = createFoldingStateStore()
  inspector.foldingScope = foldingScope
  inspector.foldingPath = {
    field: fieldSectionPath,
    group: groupSectionPath,
  }
})(window.aiditor = window.aiditor || {})

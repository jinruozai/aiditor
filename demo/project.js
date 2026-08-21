// Demo.project - demo-only file-backed editor project runtime.
// This is product/demo behavior, not part of the AIditor framework bundle.
;(function (aiditor, Demo) {
  'use strict'

  const projects = {}
  const definitions = []
  const DEFAULT_PREVIEW_CHARS = 24000
  const DEFAULT_PREVIEW_LINES = 240
  const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'
  const PROJECT_HOST_COMPONENT = 'demo-project-root'
  const DEFAULT_LAYOUT_PATH = 'aiditor.layout.json'
  let activeId = null
  let nextVersion = 1
  let loadingRuntime = null
  const checkResults = {}
  const projectTick = aiditor.signal ? aiditor.signal(0) : null

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value))
  }

  function keys(obj) { return Object.keys(obj || {}) }

  function stableOwner(id) { return 'project:' + id }

  function runtimeOwner(id, versioned) {
    return stableOwner(id) + (versioned ? '@' + (nextVersion++) : '')
  }

  function define(spec) {
    if (!spec || !spec.id) throw new Error('Demo.project.define: spec.id is required')
    definitions.push(spec)
    return spec
  }

  function defaultLayoutRoot() {
    return { type: 'dock', id: 'dock-main', name: 'main', panels: [], activeId: null }
  }

  function bumpProjectTick() {
    if (projectTick && projectTick.set) projectTick.set(projectTick.peek() + 1)
  }

  function normalizeEntry(entry) {
    if (typeof entry === 'string') return { type: 'script', src: entry }
    const out = Object.assign({ type: 'script' }, entry || {})
    if (!out.src && out.path) out.src = out.path
    return out
  }

  function normalizeEntries(entries) {
    const list = Array.isArray(entries) ? entries : []
    return list.map(normalizeEntry)
  }

  async function readJson(workspace, path) {
    const file = await workspace.readText(path)
    return JSON.parse(file.text)
  }

  function normalizeDescriptor(raw) {
    const d = clone(raw || {})
    if (d.type !== 'aiditor-project') throw new Error('Invalid project descriptor type')
    if (!d.id) throw new Error('Project descriptor requires id')
    d.schemaVersion = d.schemaVersion || 1
    d.kind = d.kind || 'app'
    d.entry = normalizeEntry(d.entry)
    d.entries = normalizeEntries(d.entries)
    if (d.layout != null && typeof d.layout !== 'string') d.layout = DEFAULT_LAYOUT_PATH
    d.styles = d.styles || []
    d.permissions = d.permissions || {}
    return d
  }

  function layoutPathFrom(value, fallback) {
    return typeof value === 'string' && value ? value : (fallback || DEFAULT_LAYOUT_PATH)
  }

  function inlineLayoutRoot(value) {
    if (!value || typeof value !== 'object') return null
    if (value.root) return value.root
    if (value.type === 'dock' || value.type === 'split') return value
    return null
  }

  function hasPermission(runtime, key) {
    if (runtime.options && runtime.options.fullAccess) return true
    const p = runtime.descriptor.permissions || {}
    if (p[key] === true) return true
    if ((key === 'workspace.list' || key === 'workspace.search' || key === 'workspace.readText' || key === 'workspace.stat') && p.workspace === 'read') return true
    if (key.indexOf('workspace.') === 0 && p.workspace === 'readwrite') return true
    return false
  }

  function requirePermission(runtime, key) {
    if (!hasPermission(runtime, key)) throw new Error('Project permission denied: ' + key)
  }

  function workspaceFor(runtime) {
    const ws = runtime.workspace
    return {
      rootId: ws.rootId,
      kind: ws.kind,
      resolveUrl: ws.resolveUrl,
      list: function (path) { requirePermission(runtime, 'workspace.list'); return ws.list(path || '') },
      readText: function (path) { requirePermission(runtime, 'workspace.readText'); return ws.readText(path) },
      writeText: function (path, text, opts) { requirePermission(runtime, 'workspace.writeText'); return ws.writeText(path, text, opts || {}) },
      patchText: function (path, baseHash, patches) { requirePermission(runtime, 'workspace.writeText'); return ws.patchText(path, baseHash, patches || []) },
      search: function (query, opts) { requirePermission(runtime, 'workspace.search'); return ws.search(query, opts || {}) },
      stat: function (path) { requirePermission(runtime, 'workspace.stat'); return ws.stat(path) },
      watch: function (path, handler) { return ws.watch ? ws.watch(path, handler) : function () {} },
      delete: function (path) { requirePermission(runtime, 'workspace.delete'); return ws.delete(path) },
    }
  }

  function hostWorkspaceFor(runtime) {
    return runtime.workspace
  }

  function bindAiWorkspace(runtime) {
    if (!runtime || !aiditor.ai || !aiditor.ai.setWorkspace) return
    aiditor.ai.setWorkspace(runtime.workspace, {
      id: 'demo.project:' + runtime.id,
      label: runtime.descriptor.title || runtime.id,
      kind: 'demo-project',
    })
  }

  function validateScriptSyntax(path, text) {
    try {
      ;(new Function(String(text || '')))
    } catch (err) {
      throw new Error('Project script syntax error in ' + path + ': ' + (err && err.message || err))
    }
  }

  function validateWorkspaceText(path, text, opts) {
    if (aiditor.workspace && aiditor.workspace.validateText) aiditor.workspace.validateText(path, text, opts || {})
  }

  function omitFileText(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, 'text')) return result
    const next = Object.assign({}, result)
    delete next.text
    next.textOmitted = true
    return next
  }

  function writeProjectFile(runtime, path, text, opts) {
    text = String(text == null ? '' : text)
    validateWorkspaceText(path, text, opts || {})
    return hostWorkspaceFor(runtime).writeText(path, text, opts || {}).then(omitFileText)
  }

  async function patchProjectFile(runtime, path, baseHash, patches, opts) {
    const ws = hostWorkspaceFor(runtime)
    const current = await ws.readText(path)
    const text = aiditor.workspace.applyLinePatches(current.text, baseHash, patches || [])
    validateWorkspaceText(path, text, opts || {})
    return omitFileText(await ws.writeText(path, text, { baseHash: baseHash }))
  }

  function clearAiWorkspace(runtime) {
    if (
      runtime &&
      aiditor.ai &&
      aiditor.ai.currentWorkspace &&
      aiditor.ai.clearWorkspace &&
      aiditor.ai.currentWorkspace() === runtime.workspace
    ) {
      aiditor.ai.clearWorkspace()
    }
  }

  function cleanupOwner(owner) {
    if (aiditor.ai && aiditor.ai.tools && aiditor.ai.tools.unregisterOwner) aiditor.ai.tools.unregisterOwner(owner)
    if (aiditor.ai && aiditor.ai.references && aiditor.ai.references.unregisterOwner) aiditor.ai.references.unregisterOwner(owner)
    if (aiditor.ai && aiditor.ai.operations && aiditor.ai.operations.unregisterOwner) aiditor.ai.operations.unregisterOwner(owner)
    if (aiditor.commands && aiditor.commands.unregisterOwner) aiditor.commands.unregisterOwner(owner)
    if (aiditor.settings && aiditor.settings.unregisterOwner) aiditor.settings.unregisterOwner(owner)
    if (aiditor.unregisterComponentOwner) aiditor.unregisterComponentOwner(owner)
  }

  function wrapOperation(runtime, spec) {
    const op = Object.assign({}, spec || {})
    if (typeof op.apply === 'function') {
      const apply = op.apply
      op.apply = function (preview, ctx) {
        requirePermission(runtime, 'ai.operations.apply')
        return apply(preview, ctx)
      }
    }
    return op
  }

  function makeContext(runtime) {
    const meta = { owner: runtime.owner, layer: 'project' }
    const ctx = {
      projectId: runtime.id,
      owner: stableOwner(runtime.id),
      runtimeOwner: runtime.owner,
      stableOwner: stableOwner(runtime.id),
      descriptor: clone(runtime.descriptor),
      workspace: workspaceFor(runtime),
      layout: runtime.layoutData,
      bus: {
        emit: aiditor.bus.emit,
        on: function (topic, handler) {
          const off = aiditor.bus.on(topic, handler)
          runtime.cleanups.push(off)
          return off
        },
      },
      component: function (id, spec) {
        return aiditor.registerComponent(id, spec, meta)
      },
      command: function (id, spec) {
        return aiditor.commands.register(id, spec, meta)
      },
      menu: function (id, spec) {
        return aiditor.commands.registerMenu(id, spec, meta)
      },
      tool: function (id, spec) {
        if (!aiditor.ai || !aiditor.ai.tools) throw new Error('Project tool registry is not available')
        requirePermission(runtime, 'ai.tools.register')
        return aiditor.ai.tools.register(id, spec, meta)
      },
      reference: function (id, spec) {
        if (!aiditor.ai || !aiditor.ai.references) throw new Error('Project reference registry is not available')
        return aiditor.ai.references.register(id, spec, meta)
      },
      operation: function (id, spec) {
        if (!aiditor.ai || !aiditor.ai.operations) throw new Error('Project operation registry is not available')
        return aiditor.ai.operations.register(id, wrapOperation(runtime, spec), meta)
      },
      settingsSection: function (id, spec) {
        return aiditor.settings.registerSection(id, spec, meta)
      },
      settingsSchema: function (sectionId, schema) {
        return aiditor.settings.registerSchema(sectionId, schema, meta)
      },
      settingsPage: function (id, spec) {
        return aiditor.settings.registerPage(id, spec, meta)
      },
      style: function (path) {
        return installStyle(runtime, path)
      },
      createDockLayout: function (container, config) {
        config = Object.assign({ name: runtime.id }, config || {})
        return aiditor.createDockLayout(container, config)
      },
      onCleanup: function (fn) {
        runtime.cleanups.push(fn)
      },
    }
    return ctx
  }

  function registrationRuntime() {
    const runtime = loadingRuntime || projects[activeId]
    if (!runtime) throw new Error('Demo.project registration requires a loading or active project')
    return runtime
  }

  function registerProjectComponent(id, spec) {
    const runtime = registrationRuntime()
    const nextSpec = Object.assign({ category: 'panel' }, spec)
    return aiditor.registerComponent(id, nextSpec, { owner: runtime.owner, layer: 'project' })
  }

  function withLoadingRuntime(runtime, task) {
    const prev = loadingRuntime
    loadingRuntime = runtime
    return Promise.resolve().then(task).finally(function () {
      loadingRuntime = prev
    })
  }

  async function textUrl(runtime, path, mime) {
    const file = await hostWorkspaceFor(runtime).readText(path)
    if (mime === 'text/javascript') validateScriptSyntax(path, file.text)
    if (typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) {
      throw new Error('Project loader requires object URLs for file-backed entries')
    }
    const url = URL.createObjectURL(new Blob([file.text], { type: mime || 'text/plain' }))
    runtime.objectUrls.push(url)
    return url
  }

  async function loadScript(runtime, path) {
    if (!path) return
    if (typeof document === 'undefined' || !document.createElement) {
      const file = await hostWorkspaceFor(runtime).readText(path)
      validateScriptSyntax(path, file.text)
      ;(new Function(file.text))()
      return
    }
    const src = await textUrl(runtime, path, 'text/javascript')
    await new Promise(function (resolve, reject) {
      const el = document.createElement('script')
      el.src = src
      el.onload = function () { resolve() }
      el.onerror = function () { reject(new Error('Failed to load project script: ' + path)) }
      document.head.appendChild(el)
      runtime.entryNodes.push(el)
    })
  }

  async function loadModule(runtime, path, exportName) {
    const url = await textUrl(runtime, path, 'text/javascript')
    const mod = await import(url)
    return exportName ? mod[exportName] : (mod.default || mod)
  }

  async function installStyle(runtime, path) {
    if (typeof document === 'undefined' || !document.createElement) return null
    const file = await hostWorkspaceFor(runtime).readText(path)
    const el = document.createElement('style')
    el.setAttribute('data-aiditor-project-style', runtime.id)
    el.textContent = file.text
    document.head.appendChild(el)
    runtime.styleNodes.push(el)
    return el
  }

  function findDefinedSpec(id, fromIndex) {
    for (let i = definitions.length - 1; i >= fromIndex; i--) {
      if (definitions[i] && definitions[i].id === id) return definitions[i]
    }
    return null
  }

  function noopProjectHandle() {
    return {
      destroy: function () {},
      inspectPanel: function () { return null },
      inspectDocks: function () { return [] },
      inspectPanels: function () { return [] },
    }
  }

  function defaultProjectSpec(runtime) {
    return {
      id: runtime.id,
      title: runtime.descriptor.title || runtime.id,
      mount: function (container, ctx) {
        if (!container || container.nodeType !== 1) return noopProjectHandle()
        container.textContent = ''
        const tree = ctx.layout || defaultLayoutRoot()
        return ctx.createDockLayout(container, { tree: tree, lru: { max: -1 }, dockMenu: true })
      },
    }
  }

  async function loadSpec(runtime) {
    const entry = runtime.descriptor.entry || {}
    const start = definitions.length
    requirePermission(runtime, 'project.code.load')
    for (let i = 0; i < runtime.descriptor.entries.length; i++) {
      const extra = runtime.descriptor.entries[i]
      await withLoadingRuntime(runtime, function () {
        return extra.type === 'module'
          ? loadModule(runtime, extra.src, extra.export || 'default')
          : loadScript(runtime, extra.src)
      })
    }
    if (entry.type === 'module') {
      return withLoadingRuntime(runtime, function () {
        return loadModule(runtime, entry.src, entry.export || 'default')
      })
    }
    if (entry.src) {
      await withLoadingRuntime(runtime, function () {
        return loadScript(runtime, entry.src)
      })
    }
    if (entry.symbol && window[entry.symbol]) return window[entry.symbol]
    const defined = findDefinedSpec(runtime.id, start)
    if (defined) return defined
    if (runtime.layoutData) return defaultProjectSpec(runtime)
    throw new Error('Project entry did not provide a spec or layout: ' + runtime.id)
  }

  async function activateRuntime(runtime, spec, mountTarget) {
    runtime.spec = spec
    runtime.ctx = makeContext(runtime)
    for (let i = 0; i < runtime.descriptor.styles.length; i++) {
      await installStyle(runtime, runtime.descriptor.styles[i])
    }
    if (spec.setup) await Promise.resolve(spec.setup(runtime.ctx))
    if (spec.mount && mountTarget) {
      runtime.handle = await Promise.resolve(spec.mount(mountTarget, runtime.ctx))
    }
    return runtime
  }

  async function prepareRuntime(workspace, descriptor, options, spec) {
    const runtime = {
      id: descriptor.id,
      owner: runtimeOwner(descriptor.id, !!(options && options.versionedOwner)),
      workspace: workspace,
      descriptor: descriptor,
      options: options || {},
      cleanups: [],
      styleNodes: [],
      entryNodes: [],
      objectUrls: [],
      layoutData: null,
      handle: null,
      spec: spec || null,
      ctx: null,
      openedAt: Date.now(),
    }
    if (descriptor.layout) {
      const layout = await hostWorkspaceFor(runtime).readText(descriptor.layout)
      const parsed = JSON.parse(layout.text)
      runtime.layoutData = parsed.root || parsed
    }
    runtime.spec = spec || await loadSpec(runtime)
    return runtime
  }

  async function createRuntime(workspace, descriptor, options, spec) {
    const runtime = await prepareRuntime(workspace, descriptor, options, spec)
    return activateRuntime(runtime, runtime.spec, options && options.mount)
  }

  function walkDocks(node, out) {
    if (!node) return out
    if (node.type === 'dock') {
      out.push(node)
      return out
    }
    const children = node.children || []
    for (let i = 0; i < children.length; i++) walkDocks(children[i], out)
    return out
  }

  function findPanel(node, predicate) {
    if (!node) return null
    if (node.type === 'dock') {
      const panels = node.panels || []
      for (let i = 0; i < panels.length; i++) {
        if (predicate(panels[i])) return panels[i]
      }
      return null
    }
    const children = node.children || []
    for (let j = 0; j < children.length; j++) {
      const found = findPanel(children[j], predicate)
      if (found) return found
    }
    return null
  }

  function hostDockName() {
    if (!Demo.layout || !Demo.layout.tree) return ''
    const docks = walkDocks(Demo.layout.tree(), [])
    const names = docks.map(function (dock) { return dock.name || dock.id })
    const preferred = ['editor', 'main', 'chat']
    for (let i = 0; i < preferred.length; i++) {
      if (names.indexOf(preferred[i]) >= 0) return preferred[i]
    }
    for (let j = 0; j < names.length; j++) {
      if (names[j] !== 'sidebar') return names[j]
    }
    return names[0] || ''
  }

  function projectHostPanelId(runtime) {
    return 'project-host-' + safeId(runtime.id)
  }

  function ensureProjectHostPanel(runtime) {
    if (!Demo.layout || !Demo.layout.addPanel || !Demo.layout.tree) return
    const panelId = projectHostPanelId(runtime)
    const existing = findPanel(Demo.layout.tree(), function (panel) {
      return panel.id === panelId || (panel.component === PROJECT_HOST_COMPONENT && panel.props && panel.props.projectId === runtime.id)
    })
    if (existing) {
      if (Demo.layout.activatePanel) Demo.layout.activatePanel(existing.id)
      return
    }
    const dockName = hostDockName()
    if (!dockName) return
    Demo.layout.addPanel(dockName, {
      id: panelId,
      component: PROJECT_HOST_COMPONENT,
      title: runtime.descriptor.title || runtime.id,
      icon: runtime.descriptor.icon || 'box',
      props: { projectId: runtime.id },
    })
  }

  async function open(workspace, options) {
    options = options || {}
    const descriptor = normalizeDescriptor(await readJson(workspace, 'aiditor.project.json'))
    const old = projects[descriptor.id] || null
    let runtime = null
    if (old) close(descriptor.id)
    try {
      runtime = await prepareRuntime(workspace, descriptor, Object.assign({}, options, { versionedOwner: !!old }))
      await activateRuntime(runtime, runtime.spec, options && options.mount)
    } catch (err) {
      disposeRuntime(runtime)
      if (old) {
        const restored = await createRuntime(old.workspace, old.descriptor, old.options, old.spec)
        projects[old.id] = restored
        activeId = old.id
      }
      throw err
    }
    projects[descriptor.id] = runtime
    activeId = descriptor.id
    bindAiWorkspace(runtime)
    ensureProjectHostPanel(runtime)
    bumpProjectTick()
    return publicRuntime(runtime)
  }

  function disposeRuntime(runtime) {
    if (!runtime) return
    if (runtime.handle && runtime.handle.destroy) runtime.handle.destroy()
    runtime.handle = null
    for (let i = runtime.cleanups.length - 1; i >= 0; i--) runtime.cleanups[i]()
    runtime.cleanups.length = 0
    cleanupOwner(runtime.owner)
    for (let s = runtime.styleNodes.length - 1; s >= 0; s--) if (runtime.styleNodes[s].parentNode) runtime.styleNodes[s].parentNode.removeChild(runtime.styleNodes[s])
    for (let e = runtime.entryNodes.length - 1; e >= 0; e--) if (runtime.entryNodes[e].parentNode) runtime.entryNodes[e].parentNode.removeChild(runtime.entryNodes[e])
    for (let u = runtime.objectUrls.length - 1; u >= 0; u--) if (window.URL && URL.revokeObjectURL) URL.revokeObjectURL(runtime.objectUrls[u])
  }

  function close(id) {
    id = id || activeId
    const runtime = projects[id]
    if (!runtime) return false
    disposeRuntime(runtime)
    delete projects[id]
    if (activeId === id) activeId = keys(projects)[0] || null
    if (activeId) bindAiWorkspace(projects[activeId])
    else clearAiWorkspace(runtime)
    bumpProjectTick()
    return true
  }

  async function reload(id, options) {
    id = id || activeId
    const old = projects[id]
    if (!old) throw new Error('Project not open: ' + id)
    const workspace = old.workspace
    const mount = options && Object.prototype.hasOwnProperty.call(options, 'mount') ? options.mount : (old.options && old.options.mount)
    const nextOptions = Object.assign({}, old.options || {}, options || {}, { mount: mount })
    const descriptor = normalizeDescriptor(await readJson(hostWorkspaceFor(old), 'aiditor.project.json'))
    let candidate = null
    close(id)
    try {
      candidate = await prepareRuntime(workspace, descriptor, Object.assign({}, nextOptions, { versionedOwner: true }))
      await activateRuntime(candidate, candidate.spec, mount)
      projects[candidate.id] = candidate
      activeId = candidate.id
      bindAiWorkspace(candidate)
      ensureProjectHostPanel(candidate)
      bumpProjectTick()
      return publicRuntime(candidate)
    } catch (err) {
      disposeRuntime(candidate)
      const restored = await createRuntime(workspace, old.descriptor, Object.assign({}, old.options || {}, { mount: mount }), old.spec)
      projects[id] = restored
      activeId = id
      bindAiWorkspace(restored)
      bumpProjectTick()
      throw err
    }
  }

  function current() {
    return activeId ? publicRuntime(projects[activeId]) : null
  }

  function list() {
    return keys(projects).map(function (id) { return publicRuntime(projects[id]) })
  }

  function publicRuntime(runtime) {
    if (!runtime) return null
    return {
      id: runtime.id,
      title: runtime.descriptor.title || runtime.id,
      kind: runtime.descriptor.kind,
      owner: runtime.owner,
      descriptor: clone(runtime.descriptor),
      workspace: runtime.workspace,
      handle: runtime.handle,
      ctx: runtime.ctx,
      close: function () { return close(runtime.id) },
      reload: function (options) { return reload(runtime.id, options || {}) },
      saveLayout: function (options) { return saveLayout(runtime.id, options || {}) },
      inspectPanel: function (panelId) {
        return runtime.handle && runtime.handle.inspectPanel ? runtime.handle.inspectPanel(panelId) : null
      },
      inspectDocks: function () {
        return runtime.handle && runtime.handle.inspectDocks ? runtime.handle.inspectDocks() : []
      },
    }
  }

  function projectForTool(projectId) {
    const p = projectId ? projects[projectId] : projects[activeId]
    if (!p) throw new Error('No open AIditor project')
    return p
  }

  function projectAvailable() {
    return !!activeId
  }

  async function saveLayout(id, options) {
    const runtime = projectForTool(id)
    const o = options || {}
    const ws = hostWorkspaceFor(runtime)
    const layoutPath = layoutPathFrom(o.path || o.layoutPath || runtime.descriptor.layout, DEFAULT_LAYOUT_PATH)
    const root = runtime.handle && runtime.handle.tree ? runtime.handle.tree() : runtime.layoutData
    if (!root) throw new Error('Project layout is not available')
    const previous = await readJsonOrNull(ws, layoutPath)
    const saved = omitFileText(await ws.writeText(layoutPath, JSON.stringify({ root: root }, null, 2), previous && previous.file ? { baseHash: previous.file.hash } : {}))
    runtime.layoutData = clone(root)
    if (runtime.ctx) runtime.ctx.layout = runtime.layoutData
    if (o.updateDescriptor && runtime.descriptor.layout !== layoutPath) {
      const descriptorFile = await ws.readText('aiditor.project.json')
      const descriptor = normalizeDescriptor(JSON.parse(descriptorFile.text))
      descriptor.layout = layoutPath
      await ws.writeText('aiditor.project.json', JSON.stringify(descriptor, null, 2), { baseHash: descriptorFile.hash })
      runtime.descriptor = descriptor
    }
    return { ok: true, projectId: runtime.id, layoutPath: layoutPath, layout: saved }
  }

  function workspaceAvailable() {
    return !!(aiditor.ai && aiditor.ai.currentWorkspace && aiditor.ai.currentWorkspace())
  }

  function openCurrentWorkspace(options) {
    if (!workspaceAvailable()) throw new Error('No AI workspace is selected')
    return open(aiditor.ai.currentWorkspace(), options || { mount: {} })
  }

  function normalizeCheckResult(runtime, result) {
    const r = result && typeof result === 'object'
      ? Object.assign({}, result)
      : { ok: result !== false, result: result }
    if (r.ok == null) r.ok = r.error ? false : true
    if (r.checked == null) r.checked = true
    if (!r.projectId) r.projectId = runtime.id
    if (!Array.isArray(r.diagnostics)) r.diagnostics = []
    r.checkedAt = r.checkedAt || Date.now()
    checkResults[runtime.id] = r
    return r
  }

  async function runProjectCheck(input) {
    input = input || {}
    const runtime = projectForTool(input.projectId)
    if (runtime.spec && runtime.spec.check) {
      return normalizeCheckResult(runtime, await Promise.resolve(runtime.spec.check(runtime.ctx, input)))
    }
    return normalizeCheckResult(runtime, { ok: true, checked: false, reason: 'Project has no check hook' })
  }

  function projectDiagnostics(input) {
    input = input || {}
    const runtime = input.projectId ? projects[input.projectId] : projects[activeId]
    if (!runtime) return []
    const last = checkResults[runtime.id] || null
    if (last && last.diagnostics && last.diagnostics.length) return last.diagnostics.slice(0, input.maxItems || 100)
    const panels = runtime.handle && runtime.handle.inspectPanels ? runtime.handle.inspectPanels() : []
    const out = []
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i] || {}
      if (panel.status && panel.status !== 'ready') {
        out.push({
          source: 'panel',
          panelId: panel.panelId || panel.id || '',
          status: panel.status,
          message: panel.error || panel.message || ('Panel status: ' + panel.status),
        })
      }
    }
    return out.slice(0, input.maxItems || 100)
  }

  function bridgeBaseUrl() {
    if (
      aiditor.ai &&
      aiditor.ai.getConnectionConfig &&
      aiditor.ai.getConnectionConfig('local-bridge') &&
      aiditor.ai.getConnectionConfig('local-bridge').baseUrl
    ) {
      return aiditor.ai.getConnectionConfig('local-bridge').baseUrl.replace(/\/+$/, '')
    }
    return DEFAULT_BRIDGE_URL
  }

  async function bridgeJson(path, body) {
    if (typeof fetch !== 'function') throw new Error('Local bridge fetch is not available')
    const opts = body == null
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    const res = await fetch(bridgeBaseUrl() + path, opts)
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) throw new Error(data.error || res.statusText || 'Local bridge request failed')
    return data
  }

  async function bridgeVerifyList() {
    try {
      const data = await bridgeJson('/verify/list')
      return data.checks || []
    } catch (_) {
      return []
    }
  }

  async function bridgeVerifyRun(args) {
    return bridgeJson('/verify/run', args || {})
  }

  async function bridgeVerifyDiagnostics(args) {
    try {
      const data = await bridgeJson('/verify/diagnostics', args || {})
      return data.diagnostics || []
    } catch (_) {
      return []
    }
  }

  function textPreview(file, options) {
    const o = options || {}
    const maxChars = o.maxChars || DEFAULT_PREVIEW_CHARS
    const maxLines = o.maxLines || DEFAULT_PREVIEW_LINES
    const text = String(file.text || '')
    const lines = text.split(/\r?\n/)
    const previewLines = lines.slice(0, maxLines)
    let preview = previewLines.join('\n')
    if (preview.length > maxChars) preview = preview.slice(0, maxChars)
    return {
      path: file.path,
      hash: file.hash,
      size: file.size,
      lines: lines.length,
      truncated: text.length > preview.length || lines.length > previewLines.length,
      previewStartLine: 1,
      previewEndLine: Math.min(lines.length, previewLines.length),
      preview: preview,
    }
  }

  async function readProjectFile(runtime, path, options) {
    const file = await hostWorkspaceFor(runtime).readText(path)
    if (options && options.full === true) return file
    const max = options && options.maxChars || DEFAULT_PREVIEW_CHARS
    if (file.size <= max) return file
    return textPreview(file, options)
  }

  function safeId(value) {
    return String(value || 'panel').trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'panel'
  }

  function addPanelToLayoutTree(node, dock, panel, state) {
    if (!node) return node
    if (node.type === 'dock') {
      if (node.id !== dock && node.name !== dock) return node
      state.found = true
      const panels = (node.panels || []).slice()
      for (let i = 0; i < panels.length; i++) {
        if (panels[i].id === panel.id || panels[i].component === panel.component) {
          const nextPanel = Object.assign({}, panels[i], {
            title: panel.title || panels[i].title,
            icon: panel.icon || panels[i].icon,
            props: Object.assign({}, panels[i].props || {}, panel.props || {}),
          })
          panels[i] = nextPanel
          state.existing = true
          return Object.assign({}, node, { panels: panels, activeId: nextPanel.id })
        }
      }
      panels.push(panel)
      return Object.assign({}, node, { panels: panels, activeId: panel.id })
    }
    if (!node.children) return node
    let changed = false
    const children = node.children.map(function (child) {
      const next = addPanelToLayoutTree(child, dock, panel, state)
      if (next !== child) changed = true
      return next
    })
    return changed ? Object.assign({}, node, { children: children }) : node
  }

  function entryMatchesPath(entry, path) {
    return String(entry && entry.src || '') === String(path || '')
  }

  async function ensureDescriptorEntry(runtime, path) {
    if (!path) return null
    const ws = hostWorkspaceFor(runtime)
    const file = await ws.readText('aiditor.project.json')
    const descriptor = normalizeDescriptor(JSON.parse(file.text))
    for (let i = 0; i < descriptor.entries.length; i++) {
      if (entryMatchesPath(descriptor.entries[i], path)) return null
    }
    descriptor.entries.push({ type: 'script', src: path })
    return omitFileText(await ws.writeText('aiditor.project.json', JSON.stringify(descriptor, null, 2), { baseHash: file.hash }))
  }

  async function readJsonOrNull(ws, path) {
    try {
      const file = await ws.readText(path)
      return { file: file, json: JSON.parse(file.text) }
    } catch (_) {
      return null
    }
  }

  function workspaceLabel(ws) {
    if (!ws) return 'workspace'
    const root = typeof ws.rootId === 'function' ? ws.rootId() : ws.rootId
    return safeId(root || 'workspace')
  }

  async function ensureWorkspaceProject(ws, input) {
    input = input || {}
    const entryPath = input.entryPath || input.path || ''
    const existing = await readJsonOrNull(ws, 'aiditor.project.json')
    const raw = existing && existing.json && typeof existing.json === 'object' ? existing.json : {}
    const projectId = safeId(input.projectId || raw.id || raw.name || workspaceLabel(ws))
    const layoutPath = layoutPathFrom(input.layoutPath || raw.layout, DEFAULT_LAYOUT_PATH)
    const inlineRoot = inlineLayoutRoot(raw.layout)
    const descriptor = raw.type === 'aiditor-project'
      ? normalizeDescriptor(raw)
      : normalizeDescriptor({
        type: 'aiditor-project',
        schemaVersion: 1,
        id: projectId,
        title: input.projectTitle || raw.title || raw.name || projectId,
        entries: [],
        layout: layoutPath,
        permissions: {
          'project.code.load': true,
          workspace: 'readwrite',
          'ai.operations.apply': true,
        },
      })
    let changed = raw.type !== 'aiditor-project' ||
      (raw.layout != null && typeof raw.layout !== 'string') ||
      entryNeedsNormalize(raw.entry) ||
      entriesNeedNormalize(raw.entries)
    if (!descriptor.title && (input.projectTitle || raw.name)) {
      descriptor.title = input.projectTitle || raw.name
      changed = true
    }
    if (!descriptor.layout) {
      descriptor.layout = layoutPath
      changed = true
    }
    if (descriptor.layout !== layoutPath) {
      descriptor.layout = layoutPath
      changed = true
    }
    descriptor.permissions = descriptor.permissions || {}
    if (descriptor.permissions['project.code.load'] !== true) {
      descriptor.permissions['project.code.load'] = true
      changed = true
    }
    if (entryPath) {
      let hasEntry = false
      for (let i = 0; i < descriptor.entries.length; i++) {
        if (entryMatchesPath(descriptor.entries[i], entryPath)) hasEntry = true
      }
      if (!hasEntry) {
        descriptor.entries.push({ type: 'script', src: entryPath })
        changed = true
      }
    }
    if (changed || !existing) {
      await ws.writeText('aiditor.project.json', JSON.stringify(descriptor, null, 2), existing && existing.file ? { baseHash: existing.file.hash } : {})
    }
    const layout = await readJsonOrNull(ws, descriptor.layout)
    if (!layout) {
      await ws.writeText(descriptor.layout, JSON.stringify({ root: inlineRoot || defaultLayoutRoot() }, null, 2))
    }
    return descriptor
  }

  function entryNeedsNormalize(entry) {
    return !!(entry && typeof entry === 'object' && entry.path && !entry.src)
  }

  function entriesNeedNormalize(entries) {
    if (!Array.isArray(entries)) return false
    for (let i = 0; i < entries.length; i++) if (entryNeedsNormalize(entries[i])) return true
    return false
  }

  async function mountPanel(input) {
    input = input || {}
    const componentId = input.component || input.componentId
    if (!componentId) throw new Error('demo.project.mountPanel: component is required')
    const entryPath = input.entryPath || input.path || ''
    let runtime = input.projectId ? projects[input.projectId] : projects[activeId]
    if (!runtime) {
      if (!workspaceAvailable()) throw new Error('No AI workspace is selected')
      const ws = aiditor.ai.currentWorkspace()
      const descriptor = await ensureWorkspaceProject(ws, input)
      await open(ws, { mount: {} })
      runtime = projects[descriptor.id]
    }
    const result = await addPanel(Object.assign({}, input, {
      projectId: runtime.id,
      component: componentId,
      dock: input.dock || input.dockId || 'main',
      entryPath: entryPath,
    }))
    return Object.assign({ mounted: true }, result)
  }

  function registeredComponentDefaults(componentId) {
    try {
      return aiditor.componentDefaults(componentId) || {}
    } catch (_) {
      return {}
    }
  }

  async function addPanel(input) {
    input = input || {}
    const runtime = projectForTool(input.projectId)
    const ws = hostWorkspaceFor(runtime)
    const componentId = input.component || input.componentId
    if (!componentId) throw new Error('demo.project.addPanel: component is required')
    const dock = input.dock || input.dockId || 'main'
    const layoutPath = input.layoutPath || runtime.descriptor.layout || ''
    if (!layoutPath) throw new Error('demo.project.addPanel: layoutPath is required')
    const current = await ws.readText(layoutPath)
    const parsed = JSON.parse(current.text)
    const root = parsed.root || parsed
    const id = safeId(input.id || input.panelId || componentId.split(/[/.]/).pop())
    const defaults = registeredComponentDefaults(componentId)
    const defaultProps = clone(defaults.props || {})
    const panel = {
      id: input.panelId || ('panel-' + id),
      component: componentId,
      title: input.title || defaults.title || id,
      icon: input.icon || defaults.icon || '',
      props: Object.assign(defaultProps, clone(input.props || {})),
      owner: stableOwner(runtime.id),
    }
    const state = { found: false }
    const nextRoot = addPanelToLayoutTree(root, dock, panel, state)
    if (!state.found) throw new Error('demo.project.addPanel: dock not found: ' + dock)
    const nextLayout = parsed.root ? Object.assign({}, parsed, { root: nextRoot }) : nextRoot
    const entryPath = input.entryPath || input.path || ''
    const descriptorBefore = entryPath ? await ws.readText('aiditor.project.json') : null
    const layout = omitFileText(await ws.writeText(layoutPath, JSON.stringify(nextLayout, null, 2), { baseHash: current.hash }))
    let descriptor = null
    let reloaded = null
    try {
      descriptor = await ensureDescriptorEntry(runtime, entryPath)
      if (input.reload !== false) reloaded = await reload(runtime.id)
    } catch (err) {
      const currentLayout = await ws.readText(layoutPath)
      await ws.writeText(layoutPath, current.text, { baseHash: currentLayout.hash })
      if (descriptor) {
        const currentDescriptor = await ws.readText('aiditor.project.json')
        await ws.writeText('aiditor.project.json', descriptorBefore.text, { baseHash: currentDescriptor.hash })
      }
      throw err
    }
    return {
      ok: true,
      projectId: runtime.id,
      component: componentId,
      panelId: panel.id,
      dock: dock,
      existing: !!state.existing,
      layout: layout,
      descriptor: descriptor,
      reloaded: !!reloaded,
    }
  }

  async function readSourceProjection(runtime, path, options) {
    const o = options || {}
    const projection = o.projection || 'summary'
    const ws = hostWorkspaceFor(runtime)
    if (projection === 'search') {
      return { path: path, projection: projection, matches: await ws.search(o.query || '', { path: path, limit: o.limit || 20 }) }
    }
    const file = await ws.readText(path)
    const lines = file.text.split(/\r?\n/)
    if (projection === 'range') {
      const start = Math.max(1, o.startLine || o.page && o.page.startLine || 1)
      const end = Math.min(lines.length, o.endLine || o.page && o.page.endLine || start)
      return { path: path, projection: projection, hash: file.hash, startLine: start, endLine: end, text: lines.slice(start - 1, end).join('\n') }
    }
    if (projection === 'full') return Object.assign({ projection: projection }, file)
    if (projection === 'outline' || projection === 'events') {
      const out = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (projection === 'outline' && /^\s*(function|const|let|var)\s+[\w$]+|aiditor\.registerComponent|Demo\.project\.define/.test(line)) {
          out.push({ line: i + 1, text: line.trim() })
        }
        if (projection === 'events' && /ctx\.bus|aiditor\.bus|addEventListener|removeEventListener|onCleanup|registerScopedOverlay/.test(line)) {
          out.push({ line: i + 1, text: line.trim() })
        }
      }
      return { path: path, projection: projection, hash: file.hash, size: file.size, lines: lines.length, entries: out }
    }
    return {
      id: runtime.id,
      title: runtime.descriptor.title || runtime.id,
      path: path,
      projection: 'summary',
      hash: file.hash,
      size: file.size,
      lines: lines.length,
      panels: runtime.handle && runtime.handle.inspectPanels ? runtime.handle.inspectPanels() : [],
      docks: runtime.handle && runtime.handle.inspectDocks ? runtime.handle.inspectDocks() : [],
    }
  }

  function registerProjectHostComponent() {
    if (aiditor.componentRegistration && aiditor.componentRegistration(PROJECT_HOST_COMPONENT)) return
    aiditor.registerComponent(PROJECT_HOST_COMPONENT, {
      palette: false,
      defaults: function () {
        return { title: 'Project', icon: 'box', props: {} }
      },
      factory: function (propsSig) {
        const root = document.createElement('div')
        root.style.cssText = 'height:100%;min-height:0;box-sizing:border-box;'
        let handle = null
        let mountedRuntime = null

        function destroyMounted() {
          if (handle && handle.destroy) handle.destroy()
          if (mountedRuntime && mountedRuntime.handle === handle) mountedRuntime.handle = null
          handle = null
          mountedRuntime = null
        }

        function mountCurrent() {
          const props = propsSig.peek ? (propsSig.peek() || {}) : (propsSig() || {})
          const projectId = props.projectId || activeId
          const runtime = projectId ? projects[projectId] : projects[activeId]
          destroyMounted()
          root.textContent = ''
          if (!runtime || !runtime.spec || !runtime.spec.mount || !runtime.ctx) {
            root.textContent = 'No project is open.'
            return
          }
          mountedRuntime = runtime
          handle = runtime.spec.mount(root, runtime.ctx)
          runtime.handle = handle
        }

        if (projectTick && aiditor.effect) {
          const stop = aiditor.effect(function () {
            propsSig()
            projectTick()
            mountCurrent()
          })
          if (aiditor.ui && aiditor.ui.collect) aiditor.ui.collect(root, stop)
        } else {
          mountCurrent()
        }
        if (aiditor.ui && aiditor.ui.collect) aiditor.ui.collect(root, destroyMounted)
        return root
      },
      dispose: function (el) {
        if (aiditor.ui && aiditor.ui.dispose) aiditor.ui.dispose(el)
      },
    }, { owner: 'demo.project', layer: 'builtin' })
  }

  function registerAiTools() {
    if (!aiditor.ai || !aiditor.ai.tools) return
    const owner = 'demo.project'
    aiditor.ai.tools.register('demo.project.openWorkspace', {
      title: 'Open Workspace Project',
      description: 'Open the current AI workspace as an AIditor demo project when it contains aiditor.project.json. Use this before demo.project.addPanel if files exist but no demo project is open.',
      schema: { type: 'object', properties: {} },
      permissions: ['tool.call', 'tool.apply'],
      available: function () { return workspaceAvailable() && !projectAvailable() },
      run: function () { return openCurrentWorkspace({ mount: {} }) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.readDescriptor', {
      title: 'Read Project Descriptor',
      description: 'Read the current AIditor project descriptor.',
      schema: { type: 'object', properties: { projectId: { type: 'string' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: function (args) { return clone(projectForTool(args && args.projectId).descriptor) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.searchFiles', {
      title: 'Search Project Files',
      description: 'Search files in the current project workspace. Prefer this before reading whole files.',
      schema: { type: 'object', required: ['query'], properties: { projectId: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: function (args) { return hostWorkspaceFor(projectForTool(args && args.projectId)).search(args.query || '', args || {}) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.readFile', {
      title: 'Read Project File',
      description: 'Read one project file. Use readFileRange for large source files.',
      schema: { type: 'object', required: ['path'], properties: { projectId: { type: 'string' }, path: { type: 'string' }, full: { type: 'boolean' }, maxChars: { type: 'number' }, maxLines: { type: 'number' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: function (args) { return readProjectFile(projectForTool(args && args.projectId), args.path, args || {}) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.readFileRange', {
      title: 'Read Project File Range',
      description: 'Read a 1-based line range from one project file.',
      schema: { type: 'object', required: ['path', 'startLine', 'endLine'], properties: { projectId: { type: 'string' }, path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: async function (args) {
        const file = await hostWorkspaceFor(projectForTool(args && args.projectId)).readText(args.path)
        const lines = file.text.split(/\r?\n/)
        const start = Math.max(1, args.startLine || 1)
        const end = Math.min(lines.length, args.endLine || start)
        return { path: file.path, hash: file.hash, startLine: start, endLine: end, text: lines.slice(start - 1, end).join('\n') }
      },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.readSource', {
      title: 'Read Project Source Projection',
      description: 'Read a source file projection: summary, outline, events, search, range, or full.',
      schema: { type: 'object', required: ['path'], properties: { projectId: { type: 'string' }, path: { type: 'string' }, projection: { type: 'string' }, query: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' }, limit: { type: 'number' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: function (args) { return readSourceProjection(projectForTool(args && args.projectId), args.path, args || {}) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.writeFile', {
      title: 'Write Project File',
      description: 'Write one complete project file. JS/JSON writes are validated before commit; broad rewrites are high risk, prefer workspace.editText for existing source files.',
      schema: { type: 'object', required: ['path', 'text'], properties: { projectId: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' }, baseHash: { type: 'string' }, validate: { type: 'string', enum: ['auto', 'none', 'javascript', 'json'] } } },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) { return writeProjectFile(projectForTool(args && args.projectId), args.path, args.text || '', { baseHash: args.baseHash, validate: args.validate }) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.createFile', {
      title: 'Create Project File',
      description: 'Create or overwrite one complete project file in the authorized workspace. JS/JSON writes are validated before commit.',
      schema: { type: 'object', required: ['path', 'text'], properties: { projectId: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' }, validate: { type: 'string', enum: ['auto', 'none', 'javascript', 'json'] } } },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) { return writeProjectFile(projectForTool(args && args.projectId), args.path, args.text || '', { validate: args.validate }) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.patchFile', {
      title: 'Patch Project File',
      description: 'Patch a project file with 1-based line patches and a base hash. JS/JSON results are validated before commit.',
      schema: { type: 'object', required: ['path', 'baseHash', 'patches'], properties: { projectId: { type: 'string' }, path: { type: 'string' }, baseHash: { type: 'string' }, patches: { type: 'array' }, validate: { type: 'string', enum: ['auto', 'none', 'javascript', 'json'] } } },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) { return patchProjectFile(projectForTool(args && args.projectId), args.path, args.baseHash, args.patches || [], { validate: args.validate }) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.deleteFile', {
      title: 'Delete Project File',
      description: 'Delete one project file from the authorized workspace.',
      schema: { type: 'object', required: ['path'], properties: { projectId: { type: 'string' }, path: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) { return hostWorkspaceFor(projectForTool(args && args.projectId)).delete(args.path) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.addPanel', {
      title: 'Add Project Panel',
      description: 'Add an already registered project component to the persistent project layout. This does not accept code. Write or patch project files first, ensure the component file is listed in aiditor.project.json entries, reload if needed, then add by component name.',
      schema: {
        type: 'object',
        required: ['component', 'dock'],
        properties: {
          projectId: { type: 'string' },
          component: { type: 'string', description: 'Registered component id, for example app.mainPanel.' },
          dock: { type: 'string', description: 'Dock name or id.' },
          id: { type: 'string', description: 'Stable panel id suffix. Defaults to the component name suffix.' },
          panelId: { type: 'string' },
          title: { type: 'string', description: 'Optional override. Defaults to the component defaults().title.' },
          icon: { type: 'string', description: 'Optional override. Defaults to the component defaults().icon.' },
          props: { type: 'object', description: 'Optional override props merged over component defaults().props.' },
          layoutPath: { type: 'string' },
          entryPath: { type: 'string', description: 'Optional component file path to append to aiditor.project.json entries before reload.' },
          reload: { type: 'boolean', description: 'Defaults to true so the changed layout appears immediately.' },
        },
      },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) { return addPanel(args || {}) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.mountPanel', {
      title: 'Mount Project Panel',
      description: 'Open or bootstrap the current workspace as a demo project, ensure the component file is listed in aiditor.project.json, then place the registered component into the project layout by component name. Use this after writing a panel file; title/icon/props default from the registered component.',
      schema: {
        type: 'object',
        required: ['component', 'entryPath'],
        properties: {
          projectId: { type: 'string' },
          projectTitle: { type: 'string' },
          component: { type: 'string', description: 'Registered component id, for example app.mainPanel.' },
          entryPath: { type: 'string', description: 'Workspace file path containing Demo.project.component registration.' },
          dock: { type: 'string', description: 'Project dock name or id. Defaults to main.' },
          id: { type: 'string' },
          panelId: { type: 'string' },
          title: { type: 'string', description: 'Optional override. Defaults to the component defaults().title.' },
          icon: { type: 'string', description: 'Optional override. Defaults to the component defaults().icon.' },
          props: { type: 'object', description: 'Optional override props merged over component defaults().props.' },
          layoutPath: { type: 'string', description: 'Defaults to aiditor.layout.json for new projects.' },
        },
      },
      permissions: ['tool.call', 'tool.apply'],
      available: function () { return workspaceAvailable() || projectAvailable() },
      run: function (args) { return mountPanel(args || {}) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.updateDescriptor', {
      title: 'Update Project Descriptor',
      description: 'Update aiditor.project.json in the current project.',
      schema: { type: 'object', required: ['descriptor'], properties: { projectId: { type: 'string' }, descriptor: { type: 'object' }, baseHash: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) {
        return writeProjectFile(projectForTool(args && args.projectId), 'aiditor.project.json', JSON.stringify(args.descriptor || {}, null, 2), { baseHash: args.baseHash, validate: 'json' })
      },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.reload', {
      title: 'Reload Project',
      description: 'Reload the current AIditor project after file edits.',
      schema: { type: 'object', properties: { projectId: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: projectAvailable,
      run: function (args) { return reload(args && args.projectId) },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.inspectPanel', {
      title: 'Inspect Project Panel',
      description: 'Inspect runtime health for a mounted project panel.',
      schema: { type: 'object', required: ['panelId'], properties: { projectId: { type: 'string' }, panelId: { type: 'string' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: function (args) {
        const p = projectForTool(args && args.projectId)
        return p.handle && p.handle.inspectPanel ? p.handle.inspectPanel(args.panelId) : null
      },
    }, { owner: owner, layer: 'builtin' })
    aiditor.ai.tools.register('demo.project.runCheck', {
      title: 'Run Project Check',
      description: 'Run the current project check hook when the project provides one.',
      schema: { type: 'object', properties: { projectId: { type: 'string' } } },
      permissions: ['tool.call'],
      available: projectAvailable,
      run: function (args) { return runProjectCheck(args || {}) },
    }, { owner: owner, layer: 'builtin' })
  }

  function configureVerifyAdapter() {
    if (!aiditor.ai || !aiditor.ai.configureVerify) return
    aiditor.ai.configureVerify({
      list: async function () {
        const out = []
        const ids = keys(projects)
        for (let i = 0; i < ids.length; i++) {
          const runtime = projects[ids[i]]
          if (runtime && runtime.spec && runtime.spec.check) {
            out.push({
              id: 'demo.project.check',
              title: 'Project Check',
              projectId: runtime.id,
              projectTitle: runtime.descriptor.title || runtime.id,
            })
          }
        }
        const bridgeChecks = await bridgeVerifyList()
        for (let i = 0; i < bridgeChecks.length; i++) {
          out.push(Object.assign({ source: 'bridge' }, bridgeChecks[i]))
        }
        return out
      },
      run: function (args) {
        args = args || {}
        if (args.check && args.check !== 'demo.project.check') return bridgeVerifyRun(args)
        if (args.source === 'bridge') return bridgeVerifyRun(args)
        return runProjectCheck(args)
      },
      diagnostics: async function (args) {
        const project = projectDiagnostics(args || {})
        const bridge = await bridgeVerifyDiagnostics(args || {})
        return project.concat(bridge)
      },
    })
  }

  function registerAiSkills() {
    if (!aiditor.ai || !aiditor.ai.skills || !aiditor.ai.skills.register) return
    aiditor.ai.skills.register('demo.project.authoring', {
      title: 'Demo Project Authoring',
      description: 'Develop and operate the currently open AIditor demo project.',
      toolDisclosure: 'onRead',
      instructions: [
        'Use the current demo project runtime as the host-specific AIditor authoring environment. Keep UI code file-backed and add registered components to inspected docks by name.',
        'A demo project is a workspace folder with aiditor.project.json, optional aiditor.layout.json, and plain .js entry files.',
        'Demo project component files register with Demo.project.component(componentId, spec). Use this instead of aiditor.registerComponent inside demo project entry files.',
        'Use generic dotted component ids such as app.mainPanel or tool.timeline. Do not copy ids from examples unless they match the requested feature.',
        'After writing or editing a component file, pass that file path to aiditor.addPanelToDock so the runtime loads it before adding the panel.',
        'Before adding a panel, call aiditor.inspectDocks and choose a returned dockId from its position, size, and existing panels.',
        'Pass title, icon, or props only when overriding component defaults; otherwise defaults() supplies them.',
        'Do not manually create aiditor.project.json or aiditor.layout.json unless the user explicitly asks to edit project metadata or layout files.',
        'Do not guess dock names such as main/editor and do not hand-write layout JSON to place a panel.',
      ].join('\n'),
      tools: ['demo.project.openWorkspace', 'demo.project.readDescriptor', 'demo.project.searchFiles', 'demo.project.readFile', 'demo.project.readFileRange', 'demo.project.readSource', 'demo.project.writeFile', 'demo.project.createFile', 'demo.project.patchFile', 'demo.project.deleteFile', 'demo.project.addPanel', 'demo.project.mountPanel', 'demo.project.updateDescriptor', 'demo.project.reload', 'demo.project.inspectPanel', 'demo.project.runCheck', 'aiditor.inspectDocks', 'aiditor.addPanelToDock', 'aiditor.reloadPanel', 'aiditor.replacePanel'],
    }, { owner: 'project:demo', layer: 'project', source: 'demo/project.js' })
  }

  Demo.project = {
    define: define,
    open: open,
    openCurrentWorkspace: openCurrentWorkspace,
    close: close,
    reload: reload,
    current: current,
    list: list,
    saveLayout: saveLayout,
    addPanel: addPanel,
    mountPanel: mountPanel,
    component: registerProjectComponent,
    stableOwner: stableOwner,
  }

  registerProjectHostComponent()
  registerAiSkills()
  registerAiTools()
  configureVerifyAdapter()
})(window.aiditor = window.aiditor || {}, window.Demo = window.Demo || {})

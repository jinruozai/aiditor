// aiditor.ai complete transcript persistence.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const BASE_KEY = 'aiditor.ai'
  const SNAPSHOT_VERSION = 3
  const ENVELOPE_VERSION = 1
  const BOOTSTRAP_VERSION = 1
  const statusSig = aiditor.signal({ state: 'loading', key: null, savedAt: null, restoredAt: null, error: null })
  const reportedFailures = {}

  let config = {
    enabled: true,
    namespace: defaultNamespace(),
    key: null,
    adapter: null,
    debounceMs: 500,
  }
  config.key = persistenceKey(config.namespace)
  config.adapter = defaultAdapter()

  let timer = null
  let generation = 0
  let loaded = false
  let restoring = false
  let legacySnapshot = null
  let suspended = false
  let readyPromise = Promise.resolve(null)
  let writeChain = Promise.resolve()

  function normalizeNamespace(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  }

  function defaultNamespace() {
    if (!window.location) return ''
    return normalizeNamespace(String(window.location.origin || '') + String(window.location.pathname || ''))
  }

  function persistenceKey(namespace) {
    const normalized = normalizeNamespace(namespace)
    return normalized ? BASE_KEY + '.' + normalized : BASE_KEY
  }

  function localStorageOrNull() {
    try { return window.localStorage || null } catch (_) { return null }
  }

  function defaultAdapter() {
    const available = typeof window.indexedDB !== 'undefined' || typeof indexedDB !== 'undefined'
    return available ? indexedDbAdapter() : null
  }

  function settings() {
    return {
      enabled: !!config.enabled,
      namespace: config.namespace,
      key: config.key,
      adapter: config.adapter,
      debounceMs: config.debounceMs,
      suspended: suspended,
    }
  }

  function setStatus(patch) {
    const next = Object.assign({}, statusSig.peek(), patch || {}, { key: config.key })
    statusSig.set(next)
    return next
  }

  function persistenceError(code, op, message, cause) {
    const err = new Error(message)
    err.code = code
    err.op = op
    err.key = config.key
    if (cause) err.cause = cause
    return err
  }

  function errorSummary(err) {
    return {
      code: err && err.code || 'AI_PERSISTENCE_ERROR',
      message: String(err && err.message || err),
    }
  }

  function reportOnce(op, err) {
    const id = config.key + ':' + op
    if (reportedFailures[id] || !aiditor.reportError) return
    reportedFailures[id] = true
    aiditor.reportError({ scope: 'ai', storage: config.key, op: op }, err)
  }

  function bootstrapAgent(agent) {
    return {
      id: agent.id,
      name: agent.name,
      parentAgentId: agent.parentAgentId || null,
      order: agent.order,
      connection: agent.connection || null,
      model: agent.model || '',
      contextBudgetTokens: agent.contextBudgetTokens || null,
      permissionMode: agent.permissionMode || 'auto',
      createdAt: agent.createdAt || null,
      updatedAt: agent.updatedAt || null,
    }
  }

  function bootstrapManifest(snapshot) {
    return {
      version: BOOTSTRAP_VERSION,
      kind: 'aiditor.ai.bootstrap',
      agents: (snapshot.agents || []).map(bootstrapAgent),
      preferences: snapshot.preferences || {},
      activeAgentId: snapshot.activeAgentId || null,
    }
  }

  function bootstrapState(manifest) {
    return {
      version: SNAPSHOT_VERSION,
      agents: manifest.agents || [],
      attachments: [],
      preferences: manifest.preferences || {},
      activeAgentId: manifest.activeAgentId || null,
    }
  }

  function writeBootstrap(snapshot) {
    const storage = localStorageOrNull()
    if (!storage) return false
    try {
      storage.setItem(config.key, JSON.stringify(bootstrapManifest(snapshot)))
      return true
    } catch (cause) {
      reportOnce('bootstrap', persistenceError('AI_PERSISTENCE_BOOTSTRAP_FAILED', 'bootstrap', 'AI persistence bootstrap write failed', cause))
      return false
    }
  }

  function readBootstrap() {
    legacySnapshot = null
    const storage = localStorageOrNull()
    if (!storage) return null
    const text = storage.getItem(config.key)
    if (!text) return null
    try {
      const value = JSON.parse(text)
      if (value && value.kind === 'aiditor.ai.bootstrap' && value.version === BOOTSTRAP_VERSION) {
        return bootstrapState(value)
      }
      const migrated = migrateSnapshot(value)
      if (migrated) {
        legacySnapshot = migrated.state
        return migrated.state
      }
      return null
    } catch (cause) {
      reportOnce('bootstrap', persistenceError('AI_PERSISTENCE_BOOTSTRAP_FAILED', 'bootstrap', 'AI persistence bootstrap read failed', cause))
      return null
    }
  }

  function recordMap(records) {
    const map = {}
    for (let i = 0; i < (records || []).length; i++) {
      const record = records[i]
      if (record && record.id != null) map[record.id] = record
    }
    return map
  }

  function mergeRecords(durable, current, baseline) {
    const currentById = recordMap(current)
    const baselineById = recordMap(baseline)
    const out = []
    const seen = {}
    for (let i = 0; i < (durable || []).length; i++) {
      const record = durable[i]
      if (!record || record.id == null) continue
      const id = record.id
      if (baselineById[id] && !currentById[id]) continue
      out.push(currentById[id] || record)
      seen[id] = true
    }
    for (let i = 0; i < (current || []).length; i++) {
      const record = current[i]
      if (record && record.id != null && !seen[record.id]) out.push(record)
    }
    return out
  }

  function mergeAgent(durable, current, baseline) {
    if (!current) return durable
    const currentChanged = !baseline || Number(current.updatedAt || 0) > Number(baseline.updatedAt || 0)
    const base = currentChanged ? current : durable
    return Object.assign({}, base, {
      messages: mergeRecords(durable.messages, current.messages, baseline && baseline.messages),
      compactions: mergeRecords(durable.compactions, current.compactions, baseline && baseline.compactions),
      quests: mergeRecords(durable.quests, current.quests, baseline && baseline.quests),
      inbox: mergeRecords(durable.inbox, current.inbox, baseline && baseline.inbox),
      queue: currentChanged ? (current.queue || []) : (durable.queue || []),
    })
  }

  function mergeSnapshots(durable, current, baseline) {
    const currentAgents = recordMap(current.agents)
    const baselineAgents = recordMap(baseline.agents)
    const agents = []
    const seen = {}
    for (let i = 0; i < (durable.agents || []).length; i++) {
      const durableAgent = durable.agents[i]
      const id = durableAgent.id
      if (baselineAgents[id] && !currentAgents[id]) continue
      agents.push(mergeAgent(durableAgent, currentAgents[id], baselineAgents[id]))
      seen[id] = true
    }
    for (let i = 0; i < (current.agents || []).length; i++) {
      const agent = current.agents[i]
      if (!seen[agent.id]) agents.push(agent)
    }

    const activeChanged = current.activeAgentId !== baseline.activeAgentId
    const preferencesChanged = JSON.stringify(current.preferences || {}) !== JSON.stringify(baseline.preferences || {})
    return {
      version: SNAPSHOT_VERSION,
      agents: agents,
      attachments: mergeRecords(durable.attachments, current.attachments, baseline.attachments),
      preferences: preferencesChanged ? current.preferences : durable.preferences,
      activeAgentId: activeChanged ? current.activeAgentId : durable.activeAgentId,
    }
  }

  function optionalArray(value, key) {
    return value[key] == null || Array.isArray(value[key])
  }

  function validMessage(message) {
    return !!message && typeof message === 'object' &&
      optionalArray(message, 'contextRefs') &&
      optionalArray(message, 'attachments') &&
      optionalArray(message, 'toolCalls')
  }

  function validAgent(agent) {
    if (!agent || typeof agent !== 'object' || typeof agent.id !== 'string' || !agent.id) return false
    const arrays = ['messages', 'compactions', 'queue', 'inbox', 'quests', 'contextRefs', 'toolRefs']
    for (let i = 0; i < arrays.length; i++) {
      if (!optionalArray(agent, arrays[i])) return false
    }
    const messages = agent.messages || []
    for (let i = 0; i < messages.length; i++) {
      if (!validMessage(messages[i])) return false
    }
    return !agent.permissions || typeof agent.permissions === 'object' && optionalArray(agent.permissions, 'paths')
  }

  function validSnapshot(state) {
    if (!state || typeof state !== 'object') return false
    if (state.version !== 2 && state.version !== SNAPSHOT_VERSION) return false
    if (!Array.isArray(state.agents) || !Array.isArray(state.attachments)) return false
    if (state.preferences != null && typeof state.preferences !== 'object') return false
    if (state.activeAgentId != null && typeof state.activeAgentId !== 'string') return false
    for (let i = 0; i < state.agents.length; i++) {
      if (!validAgent(state.agents[i])) return false
    }
    return true
  }

  function migrateSnapshot(state) {
    if (!validSnapshot(state)) return null
    if (state.version === SNAPSHOT_VERSION) return { state: state, migrated: false }
    const next = Object.assign({}, state, {
      version: SNAPSHOT_VERSION,
      agents: state.agents.map(function (agent) {
        const migrated = Object.assign({}, agent)
        delete migrated.toolRefs
        return migrated
      }),
    })
    return { state: next, migrated: true }
  }

  function decodeEnvelope(envelope) {
    if (!envelope) return { state: null, migrated: false, invalid: false }
    const migrated = migrateSnapshot(envelope.state || envelope)
    return migrated
      ? { state: migrated.state, migrated: migrated.migrated, invalid: false }
      : { state: null, migrated: false, invalid: true }
  }

  function recoverInvalidTranscript(cause) {
    const err = persistenceError('AI_PERSISTENCE_INVALID_TRANSCRIPT', 'load', 'AI transcript envelope is invalid', cause)
    reportOnce('invalid', err)
    loaded = true
    suspended = false
    const recovered = ai.snapshot()
    writeBootstrap(recovered)
    return persistNow('recovery').then(function () { return recovered })
  }

  function loadDurable() {
    const token = ++generation
    const adapter = config.adapter
    const key = config.key
    const baseline = ai.snapshot()
    const startRevision = ai.storeVersion.peek()
    loaded = false
    if (!config.enabled) {
      loaded = true
      setStatus({ state: 'disabled', error: null })
      return Promise.resolve(null)
    }
    if (!adapter) {
      loaded = true
      suspended = false
      setStatus({ state: 'unavailable', error: null })
      return Promise.resolve(null)
    }

    setStatus({ state: 'loading', error: null })
    return Promise.resolve().then(function () {
      return adapter.load(key)
    }).then(function (envelope) {
      if (token !== generation) return null
      const decoded = decodeEnvelope(envelope)
      const durable = decoded.state
      if (decoded.invalid) return recoverInvalidTranscript()
      const changedDuringLoad = ai.storeVersion.peek() !== startRevision
      if (durable) {
        const current = ai.snapshot()
        const next = !changedDuringLoad
          ? durable
          : mergeSnapshots(durable, current, baseline)
        let restoreFailure = null
        restoring = true
        try { ai.restore(next) } catch (cause) { restoreFailure = cause }
        restoring = false
        if (restoreFailure) {
          ai.restore(current)
          return recoverInvalidTranscript(restoreFailure)
        }
      }
      loaded = true
      suspended = false
      const restoredAt = Date.now()
      setStatus({ state: 'ready', savedAt: envelope && envelope.savedAt || null, restoredAt: restoredAt, error: null })
      const state = ai.snapshot()
      writeBootstrap(state)
      if (decoded.migrated) return persistNow('migration').then(function () { return state })
      if (!durable && legacySnapshot) return persistNow('migration').then(function () { return state })
      if (changedDuringLoad && durable) scheduleSave()
      return state
    }).catch(function (cause) {
      if (token !== generation) return null
      loaded = true
      const err = cause && cause.code === 'AI_PERSISTENCE_LOAD_FAILED'
        ? cause
        : persistenceError('AI_PERSISTENCE_LOAD_FAILED', 'load', 'AI transcript restore failed', cause)
      suspended = true
      setStatus({ state: 'error', error: errorSummary(err) })
      reportOnce('load', err)
      return null
    })
  }

  function persistNow(reason) {
    if (timer) clearTimeout(timer)
    timer = null
    if (!config.enabled) return Promise.resolve(null)
    if (!config.adapter) {
      setStatus({ state: 'unavailable', error: null })
      return Promise.resolve(null)
    }

    const token = generation
    const key = config.key
    const adapter = config.adapter
    const revision = ai.storeVersion.peek()
    const state = ai.snapshot()
    const envelope = { version: ENVELOPE_VERSION, savedAt: Date.now(), reason: reason || 'manual', state: state }
    writeBootstrap(state)
    setStatus({ state: 'saving', error: null })
    writeChain = writeChain.catch(function () {}).then(function () {
      return adapter.save(key, envelope)
    }).then(function () {
      if (token !== generation || key !== config.key) return envelope
      legacySnapshot = null
      suspended = false
      setStatus({ state: 'ready', savedAt: envelope.savedAt, error: null })
      if (ai.storeVersion.peek() !== revision) scheduleSave()
      return envelope
    }, function (cause) {
      if (token !== generation || key !== config.key) return null
      const err = persistenceError('AI_PERSISTENCE_SAVE_FAILED', 'save', 'AI transcript save failed', cause)
      suspended = true
      setStatus({ state: 'error', error: errorSummary(err) })
      reportOnce('save', err)
      throw err
    })
    return writeChain
  }

  function scheduleSave() {
    if (restoring || !loaded || !config.enabled || suspended) return
    writeBootstrap(ai.snapshot())
    if (!config.adapter) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(function () {
      timer = null
      persistNow('state_change').catch(function () {})
    }, Math.max(0, Number(config.debounceMs) || 0))
  }

  function flush() {
    if (!loaded) return readyPromise.then(function () { return persistNow('flush') })
    return persistNow('flush')
  }

  function clearStoredState() {
    if (timer) clearTimeout(timer)
    timer = null
    const storage = localStorageOrNull()
    if (storage) storage.removeItem(config.key)
    legacySnapshot = null
    const adapter = config.adapter
    const key = config.key
    if (!adapter) return Promise.resolve(true)
    return Promise.resolve().then(function () {
      return adapter.remove(key)
    }).then(function () {
      setStatus({ state: config.enabled ? 'ready' : 'disabled', savedAt: null, restoredAt: null, error: null })
      return true
    }, function (cause) {
      const err = persistenceError('AI_PERSISTENCE_REMOVE_FAILED', 'remove', 'AI transcript removal failed', cause)
      setStatus({ state: 'error', error: errorSummary(err) })
      reportOnce('remove', err)
      throw err
    })
  }

  function configure(opts) {
    opts = opts || {}
    const previousKey = config.key
    if (Object.prototype.hasOwnProperty.call(opts, 'namespace')) config.namespace = normalizeNamespace(opts.namespace)
    if (Object.prototype.hasOwnProperty.call(opts, 'key')) config.key = String(opts.key || BASE_KEY)
    else if (Object.prototype.hasOwnProperty.call(opts, 'namespace')) config.key = persistenceKey(config.namespace)
    if (Object.prototype.hasOwnProperty.call(opts, 'enabled')) config.enabled = opts.enabled !== false
    if (Object.prototype.hasOwnProperty.call(opts, 'adapter')) config.adapter = opts.adapter
    if (Object.prototype.hasOwnProperty.call(opts, 'debounceMs')) config.debounceMs = Math.max(0, Number(opts.debounceMs) || 0)

    if (timer) clearTimeout(timer)
    timer = null
    generation++
    suspended = false
    loaded = false
    restoring = true
    if (config.key !== previousKey) {
      ai.resetRuntimeState()
      const bootstrap = readBootstrap()
      if (bootstrap) ai.restore(bootstrap)
    }
    restoring = false

    if (opts.load === false) {
      loaded = true
      setStatus({ state: config.enabled ? (config.adapter ? 'ready' : 'unavailable') : 'disabled', error: null })
      readyPromise = Promise.resolve(ai.snapshot())
      return settings()
    }
    readyPromise = loadDurable()
    return settings()
  }

  function ready() {
    return readyPromise
  }

  function indexedDbAdapter(opts) {
    opts = opts || {}
    const dbName = opts.dbName || 'aiditor.ai.transcripts'
    const storeName = opts.storeName || 'transcripts'
    const version = Number(opts.version) || 1

    function open() {
      const factory = typeof window.indexedDB !== 'undefined' ? window.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null)
      if (!factory) return Promise.reject(persistenceError('AI_PERSISTENCE_UNAVAILABLE', 'open', 'IndexedDB is unavailable'))
      return new Promise(function (resolve, reject) {
        const request = factory.open(dbName, version)
        request.onupgradeneeded = function () {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
        }
        request.onsuccess = function () { resolve(request.result) }
        request.onerror = function () { reject(request.error) }
      })
    }

    function operation(mode, key, value) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(storeName, mode)
          const store = tx.objectStore(storeName)
          const request = mode === 'readonly'
            ? store.get(key)
            : (value === undefined ? store.delete(key) : store.put(value, key))
          let result = null
          request.onsuccess = function () { result = request.result }
          request.onerror = function () { reject(request.error) }
          tx.oncomplete = function () { db.close(); resolve(result) }
          tx.onerror = function () { db.close(); reject(tx.error || request.error) }
          tx.onabort = function () { db.close(); reject(tx.error || request.error) }
        })
      })
    }

    return {
      load: function (key) { return operation('readonly', key) },
      save: function (key, value) { return operation('readwrite', key, value) },
      remove: function (key) { return operation('readwrite', key, undefined) },
    }
  }

  function installLifecycleFlush() {
    function flushPending() {
      if (timer) flush().catch(function () {})
    }
    if (window.addEventListener) {
      window.addEventListener('pagehide', flushPending)
      window.addEventListener('beforeunload', flushPending)
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flushPending()
      })
    }
  }

  ai.persistence = {
    status: statusSig,
    settings: settings,
    ready: ready,
    flush: flush,
    indexedDbAdapter: indexedDbAdapter,
  }
  ai.configurePersistence = configure
  ai.clearStoredState = clearStoredState
  ai.save = flush

  restoring = true
  const initialBootstrap = readBootstrap()
  if (initialBootstrap) ai.restore(initialBootstrap)
  restoring = false
  readyPromise = loadDurable()

  aiditor.effect(function () {
    ai.storeVersion()
    scheduleSave()
  })
  installLifecycleFlush()
})(window.aiditor = window.aiditor || {})

// aiditor.ai connection/auth/transport registry.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const connections = {}
  const authDrivers = {}
  const transportDrivers = {}
  const connectionsSig = aiditor.signal([])
  const modelsSig = aiditor.signal({})
  const statusSig = aiditor.signal({})
  const healthSig = aiditor.signal({})
  const CUSTOM_KEY = 'ai.customConnections'
  let activeConnection = 'mock'
  const DEFAULT_RETRY_POLICY = {
    maxAttempts: 3,
    baseDelayMs: 400,
    maxDelayMs: 4000,
    jitter: 0.2,
  }

  function normalizeModels(models) {
    const list = Array.isArray(models) ? models : []
    return list.map(function (item) {
      if (typeof item === 'string') return { id: item, value: item, label: item }
      const id = item.id || item.value || item.name || item.model
      return Object.assign({}, item, { id: id, value: id, label: item.label || item.name || id })
    }).filter(function (item) { return !!item.id })
  }

  function normalizeConnectionCapabilities(spec) {
    const caps = Object.assign({}, spec && spec.capabilities || {})
    const defaults = spec && spec.configDefaults || {}
    const transport = transportDrivers[spec && spec.transport && spec.transport.type] || {}
    const toolProtocol = caps.toolProtocol || transport.toolProtocol || 'none'
    const toolArgumentsFallback = transport.toolArguments || (toolProtocol === 'none' ? 'none' : 'json')
    const toolArguments = caps.toolArguments || toolArgumentsFallback
    const outputProtocol = caps.outputProtocol || transport.outputProtocol || 'text'
    if (toolProtocol !== 'native' && toolProtocol !== 'text' && toolProtocol !== 'none') {
      throw new Error('Unknown AI tool protocol: ' + toolProtocol)
    }
    if (outputProtocol !== 'native' && outputProtocol !== 'text') throw new Error('Unknown AI output protocol: ' + outputProtocol)
    if (toolArguments !== 'strict' && toolArguments !== 'structured' && toolArguments !== 'json' && toolArguments !== 'none') {
      throw new Error('Unknown AI Tool argument mode: ' + toolArguments)
    }
    if (toolProtocol === 'none' && toolArguments !== 'none') throw new Error('Tool argument mode requires a Tool protocol')
    if (toolProtocol !== 'none' && toolArguments === 'none') throw new Error('Tool protocol requires a Tool argument mode')
    if (toolArguments === 'strict' && transport.strictToolArguments !== true) {
      throw new Error('Transport does not support strict Tool arguments: ' + (spec.transport && spec.transport.type || 'unknown'))
    }
    return {
      stream: caps.stream != null ? !!caps.stream : defaults.stream !== false,
      toolProtocol: toolProtocol,
      toolCalling: toolProtocol !== 'none',
      toolArguments: toolArguments,
      toolArgumentsFallback: toolArguments === 'strict' ? toolArgumentsFallback : toolArguments,
      outputProtocol: outputProtocol,
      reasoning: !!caps.reasoning,
      multimodal: !!caps.multimodal,
      maxInputTokens: Number(caps.maxInputTokens || 0) || null,
      local: !!caps.local,
    }
  }

  function registerAuthDriver(type, driver) {
    authDrivers[type] = driver || {}
    return authDrivers[type]
  }

  function registerTransport(type, driver) {
    transportDrivers[type] = driver || {}
    return transportDrivers[type]
  }

  function registerConnection(id, spec) {
    spec = Object.assign({}, spec || {}, { id: id || spec.id })
    spec.capabilities = normalizeConnectionCapabilities(spec)
    connections[spec.id] = spec
    setHealth(spec.id, healthState(spec.id))
    connectionsSig.set(connectionOptions())
    if (!activeConnection) activeConnection = spec.id
    return spec
  }

  function unregisterConnection(id) {
    if (!connections[id]) return false
    delete connections[id]
    const nextHealth = Object.assign({}, healthSig.peek())
    delete nextHealth[id]
    healthSig.set(nextHealth)
    if (activeConnection === id) {
      const ids = Object.keys(connections)
      activeConnection = ids[0] || ''
      ai.defaultConnection = activeConnection
    }
    connectionsSig.set(connectionOptions())
    return true
  }

  function customConnections() {
    if (aiditor.settings && aiditor.settings.values) aiditor.settings.values()
    return aiditor.settings && aiditor.settings.get ? (aiditor.settings.get(CUSTOM_KEY) || []) : []
  }

  function persistCustomConnections(list) {
    if (aiditor.settings && aiditor.settings.set) aiditor.settings.set(CUSTOM_KEY, list || [])
  }

  function createCustomConnection(spec) {
    const s = spec || {}
    const id = uniqueConnectionId(s.id || slug(s.label || s.provider || 'custom'))
    const item = {
      id: id,
      label: s.label || id,
      provider: s.provider || 'custom',
      authType: s.authType || 'apiKey',
      transportType: s.transportType || 'openai-compatible',
      defaults: {
        baseUrl: s.baseUrl || '',
        apiKey: s.apiKey || '',
        defaultModel: s.defaultModel || '',
        stream: s.stream !== false,
      },
      modelHints: s.modelHints || [],
      order: s.order || 500,
      capabilities: Object.assign({}, s.capabilities || {}),
    }
    const list = customConnections().filter(function (old) { return old.id !== id }).concat([item])
    persistCustomConnections(list)
    registerConnection(id, customSpec(item))
    return getConnection(id)
  }

  function loadCustomConnections() {
    const list = customConnections()
    for (let i = 0; i < list.length; i++) registerConnection(list[i].id, customSpec(list[i]))
    return list
  }

  function customSpec(item) {
    return {
      id: item.id,
      label: item.label || item.id,
      provider: item.provider || 'custom',
      auth: { type: item.authType || 'apiKey' },
      transport: { type: item.transportType || 'openai-compatible' },
      configDefaults: Object.assign({ baseUrl: '', apiKey: '', defaultModel: '', stream: true }, item.defaults || {}),
      modelHints: item.modelHints || [],
      order: item.order || 500,
      capabilities: Object.assign({}, item.capabilities || {}),
      custom: true,
    }
  }

  function deleteCustomConnection(id) {
    const c = connections[id]
    if (!c || c.custom !== true) return false
    const wasActive = activeConnection === id
    persistCustomConnections(customConnections().filter(function (old) { return old.id !== id }))
    const prefix = configKey(id, '')
    if (aiditor.settings && aiditor.settings.values) {
      const values = aiditor.settings.values()
      for (const key in values) {
        if (key.indexOf(prefix) === 0) aiditor.settings.reset(key)
      }
    }
    unregisterConnection(id)
    if (wasActive && aiditor.settings && aiditor.settings.set) {
      aiditor.settings.set('ai.defaultConnection', activeConnection || 'mock')
    }
    return true
  }

  function slug(text) {
    return String(text || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom'
  }

  function uniqueConnectionId(base) {
    let id = base
    let n = 2
    while (connections[id]) id = base + '-' + n++
    return id
  }

  function getConnection(id) {
    return connections[id || activeConnection]
  }

  function listConnections() {
    return Object.keys(connections)
  }

  function connectionOptions() {
    return Object.keys(connections).map(function (id) {
      const c = connections[id]
      return {
        id: id,
        label: c.label || id,
        provider: c.provider || id,
        authType: c.auth && c.auth.type || 'none',
        transportType: c.transport && c.transport.type || '',
        modelHints: c.modelHints || [],
        capabilities: Object.assign({}, c.capabilities || {}),
        order: c.order || 1000,
      }
    }).sort(function (a, b) { return a.order - b.order || a.label.localeCompare(b.label) })
  }

  function configKey(id, key) {
    return 'ai.connections.' + id + '.' + key
  }

  function connectionConfig(id, overrides) {
    const c = getConnection(id)
    const defaults = Object.assign({}, (c && c.configDefaults) || {})
    if (aiditor.settings && c) {
      if (aiditor.settings.values) aiditor.settings.values()
      Object.keys(defaults).forEach(function (key) {
        const value = aiditor.settings.get(configKey(c.id, key))
        if (value !== undefined) defaults[key] = value
      })
    }
    return Object.assign(defaults, overrides || {})
  }

  function modelHints(id) {
    const c = getConnection(id)
    return c ? (c.modelHints || []) : []
  }

  function connectionCapabilities(id) {
    const c = getConnection(id)
    return c ? Object.assign({}, c.capabilities || normalizeConnectionCapabilities(c)) : {}
  }

  function healthState(id) {
    return healthSig.peek()[id] || {
      connectionId: id || null,
      state: 'unknown',
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      retryAfterMs: null,
    }
  }

  function setHealth(id, value) {
    const next = Object.assign({}, healthSig.peek())
    next[id] = value
    healthSig.set(next)
    return value
  }

  function errorSummary(err) {
    return {
      code: err && err.code || 'PROVIDER_ERROR',
      message: String(err && err.message || err),
      status: err && err.status || null,
      retryable: !!(err && err.retryable),
    }
  }

  function recordSuccess(id) {
    const previous = healthState(id)
    return setHealth(id, Object.assign({}, previous, {
      state: 'healthy',
      consecutiveFailures: 0,
      lastSuccessAt: Date.now(),
      lastError: null,
      retryAfterMs: null,
    }))
  }

  function recordFailure(id, err) {
    const previous = healthState(id)
    const state = err && err.status === 429 ? 'rate_limited'
      : err && err.code === 'PROVIDER_NETWORK_ERROR' ? 'offline'
        : 'degraded'
    return setHealth(id, Object.assign({}, previous, {
      state: state,
      consecutiveFailures: previous.consecutiveFailures + 1,
      lastFailureAt: Date.now(),
      lastError: errorSummary(err),
      retryAfterMs: err && err.retryAfterMs != null ? err.retryAfterMs : null,
    }))
  }

  function normalizedRetryPolicy(connection, request) {
    const configured = Object.assign({}, DEFAULT_RETRY_POLICY, connection && connection.retryPolicy || {}, request && request.retryPolicy || {})
    return {
      maxAttempts: Math.min(10, Math.max(1, Math.floor(Number(configured.maxAttempts) || 1))),
      baseDelayMs: Math.max(0, Number(configured.baseDelayMs) || 0),
      maxDelayMs: Math.max(0, Number(configured.maxDelayMs) || 0),
      jitter: Math.max(0, Math.min(1, Number(configured.jitter) || 0)),
    }
  }

  function retryDelay(policy, attempt, err) {
    const retryAfter = Number(err && err.retryAfterMs)
    const base = err && err.retryAfterMs != null && retryAfter >= 0 && Number.isFinite(retryAfter)
      ? retryAfter
      : policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
    const capped = policy.maxDelayMs ? Math.min(base, policy.maxDelayMs) : base
    const spread = capped * policy.jitter
    return Math.max(0, Math.round(capped - spread + Math.random() * spread * 2))
  }

  function abortError() {
    const err = new Error('Provider request aborted')
    err.name = 'AbortError'
    err.code = 'PROVIDER_ABORTED'
    return err
  }

  function wait(ms, signal) {
    if (signal && signal.aborted) return Promise.reject(abortError())
    if (!ms) return Promise.resolve()
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(done, ms)
      function done() {
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', cancelled)
        resolve()
      }
      function cancelled() {
        clearTimeout(timer)
        if (signal && signal.removeEventListener) signal.removeEventListener('abort', cancelled)
        reject(abortError())
      }
      if (signal && signal.addEventListener) signal.addEventListener('abort', cancelled, { once: true })
    })
  }

  function isAsyncIterable(value) {
    return !!(value && typeof Symbol !== 'undefined' && Symbol.asyncIterator && value[Symbol.asyncIterator])
  }

  function monitoredStream(id, source) {
    return (async function* () {
      try {
        for await (const item of source) yield item
        recordSuccess(id)
      } catch (err) {
        recordFailure(id, err)
        throw err
      }
    })()
  }

  function monitorResult(id, result) {
    if (result && isAsyncIterable(result.deltas)) return Object.assign({}, result, { deltas: monitoredStream(id, result.deltas) })
    if (isAsyncIterable(result)) return monitoredStream(id, result)
    recordSuccess(id)
    return result
  }

  function setActiveConnection(id) {
    activeConnection = id || activeConnection
    ai.defaultConnection = activeConnection
    return getConnection(activeConnection)
  }

  function getTransport(id) {
    const c = getConnection(id)
    return c && transportDrivers[c.transport && c.transport.type]
  }

  function getAuthDriver(id) {
    const c = getConnection(id)
    return c && authDrivers[c.auth && c.auth.type || 'none']
  }

  function authStatus(id) {
    const c = getConnection(id)
    const driver = getAuthDriver(id)
    if (!c || !driver || !driver.status) return { state: 'unknown' }
    const status = driver.status(c, connectionConfig(c.id))
    return status && typeof status.then === 'function'
      ? (statusSig.peek()[c.id] || { state: 'unknown' })
      : status
  }

  function setStatus(id, status) {
    const next = Object.assign({}, statusSig.peek())
    next[id] = status || authStatus(id)
    statusSig.set(next)
    return next[id]
  }

  function refreshAuthStatus(id) {
    const c = getConnection(id)
    const driver = getAuthDriver(id)
    if (!c || !driver || !driver.status) return Promise.resolve(setStatus(id, { state: 'unknown' }))
    return Promise.resolve(driver.status(c, connectionConfig(c.id))).then(function (status) {
      return setStatus(c.id, status || { state: 'unknown' })
    })
  }

  function login(id, opts) {
    const c = getConnection(id)
    const driver = getAuthDriver(id)
    if (!c || !driver || !driver.login) return Promise.resolve(setStatus(id, authStatus(id)))
    return Promise.resolve(driver.login(c, connectionConfig(c.id), opts || {})).then(function (status) {
      return setStatus(c.id, status || authStatus(c.id))
    })
  }

  function logout(id) {
    const c = getConnection(id)
    const driver = getAuthDriver(id)
    if (!c || !driver || !driver.logout) return Promise.resolve(setStatus(id, authStatus(id)))
    return Promise.resolve(driver.logout(c, connectionConfig(c.id))).then(function (status) {
      return setStatus(c.id, status || authStatus(c.id))
    })
  }

  function refreshModels(id, overrides) {
    const c = getConnection(id || activeConnection)
    const transport = getTransport(c && c.id)
    if (!c || !transport || !transport.models) return Promise.resolve([])
    return Promise.resolve(transport.models(c, connectionConfig(c.id, overrides || {}))).then(function (models) {
      const next = Object.assign({}, modelsSig.peek())
      next[c.id] = normalizeModels(models || [])
      modelsSig.set(next)
      return next[c.id]
    })
  }

  function send(connectionId, request, ctx) {
    const c = getConnection(connectionId || activeConnection)
    const transport = getTransport(c && c.id)
    if (!c || !transport || !transport.send) throw new Error('AI connection is not available: ' + (connectionId || activeConnection))
    const normalized = Object.assign({}, request, {
      connection: c.id,
      connectionName: c.id,
      connectionCapabilities: request.connectionCapabilities || Object.assign({}, c.capabilities || {}),
      model: request.model || connectionConfig(c.id).defaultModel || '',
    })
    const policy = normalizedRetryPolicy(c, normalized)
    const signal = ctx && ctx.signal
    let attempt = 0
    function run() {
      attempt++
      if (signal && signal.aborted) return Promise.reject(abortError())
      let sent = null
      try {
        sent = transport.send(c, normalized, ctx || {})
      } catch (err) {
        return failed(err)
      }
      return Promise.resolve(sent).then(function (result) {
        return monitorResult(c.id, result)
      }, failed)
    }
    function failed(err) {
      if (!err || err.connectionNeutral !== true) recordFailure(c.id, err)
      if (!err || !err.retryable || attempt >= policy.maxAttempts || (signal && signal.aborted)) return Promise.reject(err)
      const delay = retryDelay(policy, attempt, err)
      if (ai.trace && ai.trace.append) {
        ai.trace.append({
          type: 'provider_retry',
          runId: normalized.runId || null,
          traceId: normalized.runId || null,
          agentId: normalized.agent && normalized.agent.id || null,
          phase: 'provider',
          entry: c.id,
          status: 'retrying',
          summary: 'provider retry ' + (attempt + 1) + '/' + policy.maxAttempts,
          meta: { attempt: attempt, delayMs: delay, code: err.code || null, status: err.status || null },
        })
      }
      return wait(delay, signal).then(run)
    }
    return run()
  }

  ai.defaultConnection = activeConnection
  ai.connections = connectionsSig
  ai.connectionModels = modelsSig
  ai.connectionStatus = statusSig
  ai.connectionHealth = healthSig
  ai.registerAuthDriver = registerAuthDriver
  ai.registerTransport = registerTransport
  ai.registerConnection = registerConnection
  ai.unregisterConnection = unregisterConnection
  ai.createCustomConnection = createCustomConnection
  ai.deleteCustomConnection = deleteCustomConnection
  ai.loadCustomConnections = loadCustomConnections
  ai.getConnection = getConnection
  ai.listConnections = listConnections
  ai.connectionOptions = connectionOptions
  ai.connectionConfigKey = configKey
  ai.getConnectionConfig = connectionConfig
  ai.connectionCapabilities = connectionCapabilities
  ai.connectionHealthState = healthState
  ai.modelHints = modelHints
  ai.setActiveConnection = setActiveConnection
  ai.authStatus = authStatus
  ai.refreshAuthStatus = refreshAuthStatus
  ai.loginConnection = login
  ai.logoutConnection = logout
  ai.refreshModels = refreshModels
  ai.sendViaConnection = send
  ai.models = modelsSig
})(window.aiditor = window.aiditor || {})

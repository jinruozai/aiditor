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
  const CUSTOM_KEY = 'ai.customConnections'
  let activeConnection = 'mock'

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
    return {
      stream: caps.stream != null ? !!caps.stream : defaults.stream !== false,
      toolCalling: caps.toolCalling !== false,
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
    connectionsSig.set(connectionOptions())
    if (!activeConnection) activeConnection = spec.id
    return spec
  }

  function unregisterConnection(id) {
    if (!connections[id]) return false
    delete connections[id]
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
      custom: true,
    }
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
    return transport.send(c, Object.assign({}, request, {
      connection: c.id,
      connectionName: c.id,
      model: request.model || connectionConfig(c.id).defaultModel || '',
    }), ctx)
  }

  ai.defaultConnection = activeConnection
  ai.connections = connectionsSig
  ai.connectionModels = modelsSig
  ai.connectionStatus = statusSig
  ai.registerAuthDriver = registerAuthDriver
  ai.registerTransport = registerTransport
  ai.registerConnection = registerConnection
  ai.unregisterConnection = unregisterConnection
  ai.createCustomConnection = createCustomConnection
  ai.loadCustomConnections = loadCustomConnections
  ai.getConnection = getConnection
  ai.listConnections = listConnections
  ai.connectionOptions = connectionOptions
  ai.connectionConfigKey = configKey
  ai.getConnectionConfig = connectionConfig
  ai.connectionCapabilities = connectionCapabilities
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

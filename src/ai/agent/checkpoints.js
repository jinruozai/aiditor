// aiditor.ai optional recoverable runtime checkpoints.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const statusSig = aiditor.signal({ state: 'disabled', key: null, savedAt: null, restoredAt: null, error: null })
  let config = { enabled: false, adapter: null, key: 'runtime', autoSave: true, debounceMs: 500 }
  let timer = null
  let suppress = false
  let disabledForSession = false
  let warningReported = false

  function configure(opts) {
    opts = opts || {}
    if (timer) clearTimeout(timer)
    timer = null
    config = Object.assign({}, config, opts)
    if (config.enabled && !config.adapter) throw checkpointError('CHECKPOINT_ADAPTER_REQUIRED', 'configure', 'Checkpoint adapter is required')
    disabledForSession = false
    warningReported = false
    setStatus({ state: config.enabled ? 'idle' : 'disabled', key: config.key, error: null })
    if (config.enabled && config.autoSave) schedule('configured')
    return settings()
  }

  function settings() {
    return {
      enabled: !!config.enabled,
      key: config.key,
      autoSave: config.autoSave !== false,
      debounceMs: config.debounceMs,
      disabledForSession: disabledForSession,
    }
  }

  function capture(reason) {
    if (!config.enabled || !config.adapter || disabledForSession) return Promise.reject(checkpointError('CHECKPOINT_UNAVAILABLE', 'save', 'Checkpoint persistence is not available'))
    if (timer) clearTimeout(timer)
    timer = null
    const envelope = {
      version: 1,
      savedAt: Date.now(),
      reason: reason || 'manual',
      state: ai.checkpointSnapshot(),
    }
    setStatus({ state: 'saving', key: config.key, error: null })
    return Promise.resolve().then(function () { return config.adapter.save(config.key, envelope) }).then(function () {
      setStatus({ state: 'idle', key: config.key, savedAt: envelope.savedAt, error: null })
      return { key: config.key, savedAt: envelope.savedAt, reason: envelope.reason }
    }, function (err) {
      fail('save', err)
      throw checkpointFailure('save', err)
    })
  }

  function restore(opts) {
    opts = opts || {}
    if (!config.adapter) return Promise.reject(checkpointError('CHECKPOINT_ADAPTER_REQUIRED', 'load', 'Checkpoint adapter is required'))
    setStatus({ state: 'loading', key: config.key, error: null })
    return Promise.resolve().then(function () { return config.adapter.load(config.key) }).then(function (envelope) {
      if (!envelope) {
        setStatus({ state: config.enabled ? 'idle' : 'disabled', key: config.key, error: null })
        return null
      }
      const state = envelope.state || envelope
      suppress = true
      const restored = ai.restoreCheckpoint(state)
      suppress = false
      if (!restored) throw checkpointError('CHECKPOINT_INVALID', 'load', 'Checkpoint snapshot is invalid')
      const restoredAt = Date.now()
      setStatus({ state: config.enabled ? 'idle' : 'disabled', key: config.key, savedAt: envelope.savedAt || null, restoredAt: restoredAt, error: null })
      if (opts.resumeQueued !== false && ai.scheduleAgent) {
        const agents = ai.agents.peek()
        for (let i = 0; i < agents.length; i++) if (agents[i].queue && agents[i].queue.length) ai.scheduleAgent(agents[i].id)
      }
      return { key: config.key, savedAt: envelope.savedAt || null, restoredAt: restoredAt, state: restored }
    }).catch(function (err) {
      suppress = false
      fail('load', err)
      throw checkpointFailure('load', err)
    })
  }

  function clear() {
    if (!config.adapter) return Promise.resolve(false)
    if (timer) clearTimeout(timer)
    timer = null
    return Promise.resolve().then(function () { return config.adapter.remove(config.key) }).then(function () {
      setStatus({ state: config.enabled ? 'idle' : 'disabled', key: config.key, savedAt: null, restoredAt: null, error: null })
      return true
    }, function (err) {
      fail('remove', err)
      throw checkpointFailure('remove', err)
    })
  }

  function schedule(reason) {
    if (suppress || !config.enabled || !config.autoSave || !config.adapter || disabledForSession) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(function () {
      timer = null
      capture(reason || 'state_change').catch(function () {})
    }, Math.max(0, Number(config.debounceMs) || 0))
  }

  function fail(op, err) {
    disabledForSession = true
    setStatus({ state: 'error', key: config.key, error: errorSummary(err) })
    if (warningReported || !aiditor.reportError) return
    warningReported = true
    aiditor.reportError({ scope: 'ai', checkpoint: config.key, op: op }, checkpointFailure(op, err))
  }

  function setStatus(patch) {
    const next = Object.assign({}, statusSig.peek(), patch || {})
    statusSig.set(next)
    return next
  }

  function errorSummary(err) {
    return { code: err && err.code || 'CHECKPOINT_STORAGE_ERROR', message: String(err && err.message || err) }
  }

  function checkpointFailure(op, cause) {
    if (cause && cause.code && String(cause.code).indexOf('CHECKPOINT_') === 0) return cause
    const err = checkpointError('CHECKPOINT_STORAGE_ERROR', op, 'Checkpoint ' + op + ' failed')
    err.cause = cause
    return err
  }

  function checkpointError(code, op, message) {
    const err = new Error(message)
    err.code = code
    err.op = op
    return err
  }

  function indexedDbAdapter(opts) {
    return ai.persistence.indexedDbAdapter(Object.assign({
      dbName: 'aiditor.ai.checkpoints',
      storeName: 'checkpoints',
    }, opts || {}))
  }

  aiditor.effect(function () {
    if (ai.agents) ai.agents()
    if (ai.attachments) ai.attachments()
    if (ai.activeAgentId) ai.activeAgentId()
    schedule('state_change')
  })

  ai.checkpoints = {
    status: statusSig,
    configure: configure,
    settings: settings,
    capture: capture,
    restore: restore,
    clear: clear,
    indexedDbAdapter: indexedDbAdapter,
  }
})(window.aiditor = window.aiditor || {})

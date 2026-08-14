// aiditor.ai verify tools - optional host-provided verification adapter.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const OWNER = 'aiditor.ai.verify'
  let adapter = null
  let registered = false

  function configureVerify(next) {
    if (registered && ai.tools && ai.tools.unregisterOwner) {
      ai.tools.unregisterOwner(OWNER)
      registered = false
    }
    adapter = next || null
    if (adapter) registerTools()
    return adapter
  }

  function currentVerify() {
    return adapter
  }

  function requireVerify() {
    if (!adapter) throw new Error('Verify adapter is not available.')
    return adapter
  }

  function hasMethod(method) {
    return adapter && typeof adapter[method] === 'function'
  }

  function callAdapter(method, args) {
    const verify = requireVerify()
    const fn = verify[method]
    if (typeof fn !== 'function') throw new Error('Verify adapter does not implement ' + method)
    return fn.call(verify, args || {})
  }

  function registerReadTool(name, method, title, description, schema) {
    if (!hasMethod(method)) return
    ai.tools.register('verify.' + name, {
      title: title,
      description: description,
      schema: schema || { type: 'object', properties: {} },
      permissions: ['tool.call'],
      run: function (args) { return callAdapter(method, args) },
    }, { owner: OWNER, layer: 'builtin' })
    registered = true
  }

  function registerTools() {
    registerReadTool('list', 'list', 'List Verify Checks', 'List host-provided verification checks for the current workspace.', {
      type: 'object',
      properties: {},
    })
    registerReadTool('run', 'run', 'Run Verify Check', 'Run one host-provided verification check, such as tests, lint, typecheck, or health checks.', {
      type: 'object',
      properties: {
        check: { type: 'string' },
        checks: { type: 'array' },
        path: { type: 'string' },
        maxChars: { type: 'number' },
      },
    })
    registerReadTool('diagnostics', 'diagnostics', 'Read Verify Diagnostics', 'Read the latest host-provided diagnostics after a verification run.', {
      type: 'object',
      properties: {
        path: { type: 'string' },
        maxItems: { type: 'number' },
      },
    })
  }

  ai.configureVerify = configureVerify
  ai.currentVerify = currentVerify
})(window.aiditor = window.aiditor || {})

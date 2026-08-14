// aiditor.ai git tools - optional host-provided git adapter.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const OWNER = 'aiditor.ai.git'
  let adapter = null
  let registered = false

  function configureGit(next) {
    if (registered && ai.tools && ai.tools.unregisterOwner) {
      ai.tools.unregisterOwner(OWNER)
      registered = false
    }
    adapter = next || null
    if (adapter) registerTools()
    return adapter
  }

  function currentGit() {
    return adapter
  }

  function requireGit() {
    if (!adapter) throw new Error('Git adapter is not available.')
    return adapter
  }

  function clone(value) {
    return value == null ? value : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(value) : JSON.parse(JSON.stringify(value)))
  }

  function callAdapter(method, args) {
    const git = requireGit()
    const fn = git[method]
    if (typeof fn !== 'function') throw new Error('Git adapter does not implement ' + method)
    return fn.call(git, args || {})
  }

  function previewGitChange(action, args) {
    args = args || {}
    return {
      ok: true,
      risk: action === 'restoreFile' ? 'delete' : 'edit',
      title: 'git.' + action,
      input: clone(args),
      changes: [{
        type: 'git',
        action: action,
        paths: args.paths || (args.path ? [args.path] : []),
        message: args.message || null,
      }],
    }
  }

  function applyGit(method, preview) {
    return Promise.resolve(callAdapter(method, preview.input || preview)).then(function (result) {
      return Object.assign({ applied: true }, result || {})
    })
  }

  function registerReadTool(name, method, title, description, schema) {
    ai.tools.register('git.' + name, {
      title: title,
      description: description,
      schema: schema || { type: 'object', properties: {} },
      permissions: ['tool.call'],
      run: function (args) { return callAdapter(method, args) },
    }, { owner: OWNER, layer: 'builtin' })
  }

  function registerApplyTool(name, method, title, description, schema) {
    ai.tools.register('git.' + name, {
      title: title,
      description: description,
      schema: schema || { type: 'object', properties: {} },
      permissions: ['tool.call', 'tool.apply'],
      preview: function (args) { return previewGitChange(name, args) },
      apply: function (preview) { return applyGit(method, preview) },
      run: function (args) { return callAdapter(method, args) },
    }, { owner: OWNER, layer: 'builtin' })
  }

  function registerTools() {
    if (registered) return
    registered = true
    registerReadTool('status', 'status', 'Git Status', 'Read repository status for the current workspace.', {
      type: 'object',
      properties: {},
    })
    registerReadTool('diff', 'diff', 'Git Diff', 'Read a repository diff.', {
      type: 'object',
      properties: { staged: { type: 'boolean' }, path: { type: 'string' }, maxChars: { type: 'number' } },
    })
    registerReadTool('diffFile', 'diffFile', 'Git Diff File', 'Read a diff for one file.', {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, staged: { type: 'boolean' }, maxChars: { type: 'number' } },
    })
    registerReadTool('log', 'log', 'Git Log', 'Read recent commits.', {
      type: 'object',
      properties: { limit: { type: 'number' } },
    })
    registerReadTool('show', 'show', 'Git Show', 'Read one commit or object.', {
      type: 'object',
      required: ['ref'],
      properties: { ref: { type: 'string' }, maxChars: { type: 'number' } },
    })
    registerApplyTool('stage', 'stage', 'Git Stage', 'Stage workspace files.', {
      type: 'object',
      properties: { paths: { type: 'array' } },
    })
    registerApplyTool('restoreFile', 'restoreFile', 'Git Restore File', 'Restore workspace files through the host git adapter.', {
      type: 'object',
      properties: { path: { type: 'string' }, paths: { type: 'array' }, staged: { type: 'boolean' } },
    })
    registerApplyTool('commit', 'commit', 'Git Commit', 'Create a commit through the host git adapter.', {
      type: 'object',
      required: ['message'],
      properties: { message: { type: 'string' }, paths: { type: 'array' } },
    })
  }

  ai.configureGit = configureGit
  ai.currentGit = currentGit
})(window.aiditor = window.aiditor || {})

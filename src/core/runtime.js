// Runtime contribution loader.
// Hosts provide source text or a URL; AIditor executes it with a default owner
// so plain register calls can be cleaned up as one contribution group.
;(function (aiditor) {
  'use strict'

  const stack = []
  const ownerCleanups = []

  function normalizeMeta(meta) {
    meta = meta || {}
    const out = {}
    if (meta.owner != null) out.owner = String(meta.owner)
    if (meta.layer != null) out.layer = String(meta.layer)
    if (meta.replace === true) out.replace = true
    return out
  }

  function registrationMeta(meta) {
    const base = stack.length ? stack[stack.length - 1] : null
    if (!base) return meta || {}
    return Object.assign({}, base, meta || {})
  }

  function withOwner(meta, fn) {
    stack.push(normalizeMeta(meta))
    try { return fn() } finally { stack.pop() }
  }

  function sourceUrl(input) {
    const id = input.sourceURL || input.sourceUrl || input.path || input.id || 'aiditor-runtime-script'
    return String(id).replace(/[\r\n]/g, '')
  }

  function sourceText(input) {
    if (input.source != null) return Promise.resolve(String(input.source))
    const url = input.url || input.src
    if (!url) return Promise.reject(new Error('runtime.loadScript: source or url is required'))
    if (typeof fetch !== 'function') return Promise.reject(new Error('runtime.loadScript: fetch is not available'))
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('runtime.loadScript: failed to fetch ' + url)
      return res.text()
    })
  }

  function executeScript(input, text) {
    const type = input.type || 'script'
    if (type !== 'script') throw new Error('runtime.loadScript: unsupported type "' + type + '"')
    const meta = { owner: input.owner, layer: input.layer, replace: input.replace === true }
    const code = String(text || '') + '\n//# sourceURL=' + sourceUrl(input)
    return withOwner(meta, function () {
      ;(new Function('aiditor', code))(aiditor)
    })
  }

  /**
   * @aiditorApi aiditor.runtime.loadScript
   * @group runtime
   * @layer core
   * @kind js-api
   * @signature aiditor.runtime.loadScript({ id?, source?, url?, path?, owner?, layer?, type? })
   * @summary Execute a workspace or host script with default owner/layer metadata so its registrations can be cleaned up as one contribution group.
   * @param {object} input - Script loading options.
   * @param {string} input.source - Inline JavaScript source text. Use source or url.
   * @param {string} input.url - URL to fetch and execute. Use source or url.
   * @param {string} input.path - Optional display/sourceURL path, commonly the workspace path.
   * @param {string} input.owner - Owner attached to registrations made during execution.
   * @param {string} input.layer - Registration layer, usually workspace, extension, or builtin.
   * @returns {Promise<object>} Load result with ok/id/owner/layer/type.
   * @example
   * aiditor.runtime.loadScript({
   *   path: 'three-scene.js',
   *   source: text,
   *   owner: 'workspace:demo',
   *   layer: 'workspace',
   * })
   * @related aiditor.registerComponent,aiditor.addPanelToDock
   */
  function loadScript(input) {
    input = input || {}
    return sourceText(input).then(function (text) {
      executeScript(input, text)
      return {
        ok: true,
        id: input.id || input.path || input.url || input.src || '',
        owner: input.owner || null,
        layer: input.layer || null,
        type: input.type || 'script',
      }
    })
  }

  function unloadOwner(owner) {
    const removed = {}
    if (!owner) return removed
    if (aiditor.unregisterComponentOwner) removed.components = aiditor.unregisterComponentOwner(owner)
    if (aiditor.commands && aiditor.commands.unregisterOwner) removed.commands = aiditor.commands.unregisterOwner(owner)
    if (aiditor.shortcuts && aiditor.shortcuts.unregisterOwner) removed.shortcuts = aiditor.shortcuts.unregisterOwner(owner)
    if (aiditor.settings && aiditor.settings.unregisterOwner) removed.settings = aiditor.settings.unregisterOwner(owner)
    for (let i = 0; i < ownerCleanups.length; i++) {
      const extra = ownerCleanups[i](owner) || {}
      Object.keys(extra).forEach(function (key) { removed[key] = extra[key] })
    }
    return removed
  }

  function registerOwnerCleanup(fn) {
    ownerCleanups.push(fn)
    return function () {
      const index = ownerCleanups.indexOf(fn)
      if (index >= 0) ownerCleanups.splice(index, 1)
    }
  }

  aiditor.runtime = {
    loadScript: loadScript,
    withOwner: withOwner,
    registrationMeta: registrationMeta,
    currentOwner: function () {
      const meta = stack.length ? stack[stack.length - 1] : null
      return meta && meta.owner || null
    },
    unloadOwner: unloadOwner,
    registerOwnerCleanup: registerOwnerCleanup,
  }
})(window.aiditor = window.aiditor || {})

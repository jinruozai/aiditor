// aiditor.ui.createTextDocument - shared file-editor loading/saving lifecycle.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  function invoke(label, fn) {
    let failure = null
    const value = aiditor.safeCall({ scope: 'text-document', action: label }, function () {
      try { return fn() } catch (err) { failure = err; throw err }
    })
    if (failure) throw failure
    return value
  }

  /**
   * @aiditorApi aiditor.ui.createTextDocument
   * @group ui
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.ui.createTextDocument(options)
   * @summary Create the format-neutral load/save state used by file-backed text editors. Workspace lookup, CAS writes, dirty state, external-change detection, and watcher cleanup live here; parsing stays in the editor.
   * @param {object} options - Text document options.
   * @param {string} options.workspaceId - Id registered through aiditor.workspace.bind.
   * @param {string} options.path - Workspace-relative file path.
   * @param {Function} options.decode - Convert source text and file metadata into the editor model.
   * @param {Function} options.encode - Convert the editor model into source text.
   * @param {Function} options.equals - Optional model equality function; immutable models normally use identity.
   * @returns {object} Document controller with signals and load, reload, save, set, checkExternal, snapshot, restore, and dispose methods.
   * @related aiditor.workspace.bind
   */
  ui.createTextDocument = function (options) {
    const o = options || {}
    const workspaceId = String(o.workspaceId || 'default')
    const path = aiditor.workspace.normalizePath(o.path)
    const decode = o.decode || function (text) { return text }
    const encode = o.encode || function (value) { return String(value == null ? '' : value) }
    const equals = o.equals || Object.is

    const valueSig = aiditor.signal(null)
    const statusSig = aiditor.signal('idle')
    const errorSig = aiditor.signal(null)
    const staleSig = aiditor.signal(false)
    const baseHashSig = aiditor.signal(null)
    const loadedSig = aiditor.signal(false)
    const savedValueSig = aiditor.signal(null)
    let operation = 0
    let stopWatch = null
    let disposed = false

    const dirtySig = aiditor.derived(function () {
      return loadedSig() && !equals(valueSig(), savedValueSig())
    })

    function adapter() {
      const bound = aiditor.workspace.binding(workspaceId)
      if (!bound) throw new Error('textDocument: workspace is not bound: ' + workspaceId)
      return bound
    }

    function decodeFile(file) {
      return invoke('decode', function () { return decode(file.text, file) })
    }

    function encodeValue(value) {
      return invoke('encode', function () { return encode(value) })
    }

    function beginWatch(ws) {
      if (stopWatch || typeof ws.watch !== 'function') return
      stopWatch = ws.watch(path, function () {
        checkExternal().catch(function (err) {
          aiditor.reportError({ scope: 'text-document', action: 'watch', path: path }, err)
        })
      })
    }

    async function load() {
      const token = ++operation
      const ws = adapter()
      statusSig.set('loading')
      errorSig.set(null)
      try {
        const file = await ws.readText(path)
        const next = decodeFile(file)
        if (disposed || token !== operation) return valueSig.peek()
        aiditor.batch(function () {
          savedValueSig.set(next)
          valueSig.set(next)
          baseHashSig.set(file.hash)
          staleSig.set(false)
          loadedSig.set(true)
          statusSig.set('ready')
        })
        beginWatch(ws)
        return next
      } catch (err) {
        if (!disposed && token === operation) {
          errorSig.set(err)
          statusSig.set('error')
        }
        throw err
      }
    }

    async function save() {
      if (!loadedSig.peek()) throw new Error('textDocument.save: document is not loaded')
      const token = ++operation
      const ws = adapter()
      const snapshot = valueSig.peek()
      const text = encodeValue(snapshot)
      statusSig.set('saving')
      errorSig.set(null)
      try {
        const result = await ws.writeText(path, text, { baseHash: baseHashSig.peek() })
        if (disposed || token !== operation) return result
        aiditor.batch(function () {
          savedValueSig.set(snapshot)
          baseHashSig.set(result.hash || aiditor.workspace.hashText(text))
          staleSig.set(false)
          statusSig.set('ready')
        })
        return result
      } catch (err) {
        if (!disposed && token === operation) {
          if (err && (err.reason === 'stale' || err.code === 'STALE_FILE')) staleSig.set(true)
          errorSig.set(err)
          statusSig.set('error')
        }
        throw err
      }
    }

    async function checkExternal() {
      if (!loadedSig.peek() || statusSig.peek() === 'saving') return false
      const stat = await adapter().stat(path)
      if (stat.hash === baseHashSig.peek()) return false
      if (dirtySig.peek()) {
        staleSig.set(true)
        return true
      }
      await load()
      return true
    }

    function set(next) {
      if (!loadedSig.peek()) throw new Error('textDocument.set: document is not loaded')
      valueSig.set(next)
    }

    function snapshot() {
      return {
        value: valueSig.peek(),
        savedValue: savedValueSig.peek(),
        baseHash: baseHashSig.peek(),
        loaded: loadedSig.peek(),
        stale: staleSig.peek(),
      }
    }

    function restore(state) {
      ++operation
      const next = state || {}
      aiditor.batch(function () {
        savedValueSig.set(next.savedValue)
        valueSig.set(next.value)
        baseHashSig.set(next.baseHash || null)
        loadedSig.set(!!next.loaded)
        staleSig.set(!!next.stale)
        errorSig.set(null)
        statusSig.set(next.loaded ? 'ready' : 'idle')
      })
      if (next.loaded) beginWatch(adapter())
    }

    function dispose() {
      if (disposed) return
      disposed = true
      ++operation
      if (stopWatch) stopWatch()
      dirtySig.dispose()
    }

    return {
      workspaceId: workspaceId,
      path: path,
      value: valueSig,
      status: statusSig,
      error: errorSig,
      stale: staleSig,
      baseHash: baseHashSig,
      loaded: loadedSig,
      dirty: dirtySig,
      load: load,
      reload: load,
      save: save,
      checkExternal: checkExternal,
      set: set,
      snapshot: snapshot,
      restore: restore,
      dispose: dispose,
    }
  }
})(window.aiditor = window.aiditor || {})

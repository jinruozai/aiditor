// aiditor.ui.editSession — shared keyboard contract for editable fields.
//
// The UI library writes values live while the user types. An edit session adds
// the editor-style finish semantics on top: focus captures the base value,
// Enter/blur commit, Escape restores the base value. Multiline controls choose
// their submit behavior with `submitMode`.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.editSession = function (opts) {
    const o = opts || {}
    const el = o.el
    const owner = o.owner || el
    const get = o.get
    const set = o.set
    const commit = typeof o.onCommit === 'function' ? o.onCommit : null
    const cancel = typeof o.onCancel === 'function' ? o.onCancel : null
    const multiline = !!o.multiline
    const defaultSubmitMode = multiline ? 'modifier' : 'enter'
    let active = false
    let composing = false
    let base = ''

    function mode() {
      return ui.isSignal && ui.isSignal(o.submitMode) ? (o.submitMode.peek() || defaultSubmitMode) : (o.submitMode || defaultSubmitMode)
    }
    function value() { return get ? get() : el.value }
    function write(v) { if (set) set(v); else el.value = v == null ? '' : String(v) }
    function begin() {
      active = true
      base = value()
    }
    function finish() {
      if (!active) return
      active = false
      if (commit) commit(value())
    }
    function revert() {
      if (!active) return
      active = false
      write(base)
      if (cancel) cancel(base)
    }
    function shouldCommit(ev) {
      if (ev.key !== 'Enter' || composing) return false
      if (!multiline) return true
      const submitMode = mode()
      if (submitMode === 'none') return false
      if (submitMode === 'enter') return !ev.shiftKey
      return ev.ctrlKey || ev.metaKey
    }
    function onKey(ev) {
      if (shouldCommit(ev)) {
        ev.preventDefault()
        finish()
        el.blur()
        return
      }
      if (ev.key === 'Escape' && !composing) {
        ev.preventDefault()
        revert()
        el.blur()
      }
    }
    function onCompositionStart() { composing = true }
    function onCompositionEnd() { composing = false }

    el.addEventListener('focus', begin)
    el.addEventListener('blur', finish)
    el.addEventListener('keydown', onKey)
    el.addEventListener('compositionstart', onCompositionStart)
    el.addEventListener('compositionend', onCompositionEnd)

    ui.collect(owner, function () {
      el.removeEventListener('focus', begin)
      el.removeEventListener('blur', finish)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('compositionstart', onCompositionStart)
      el.removeEventListener('compositionend', onCompositionEnd)
    })

    return { commit: finish, cancel: revert }
  }

  let gestureId = 0

  ui.editGesture = function (opts) {
    const o = opts || {}
    const get = o.get
    const write = o.write
    let active = null

    function begin(source) {
      if (active) return active.id
      active = {
        id: 'aiditor-edit-' + (++gestureId),
        source: source || o.source || 'pointer',
        initialValue: clone(get()),
        value: clone(get()),
        changed: false,
      }
      return active.id
    }
    function update(value, source) {
      if (!active) begin(source)
      active.value = clone(value)
      active.changed = true
      write(value, metadata('update', value))
    }
    function commit() {
      if (!active) return
      const current = active
      active = null
      if (current.changed) write(current.value, metadataFor(current, 'commit', current.value))
    }
    function cancel() {
      if (!active) return
      const current = active
      active = null
      if (current.changed) write(current.initialValue, metadataFor(current, 'cancel', current.initialValue))
    }
    function metadata(phase, value) { return metadataFor(active, phase, value) }
    return { begin: begin, update: update, commit: commit, cancel: cancel, active: function () { return !!active } }
  }

  function metadataFor(edit, phase, value) {
    return { edit: {
      id: edit.id,
      phase: phase,
      source: edit.source,
      initialValue: clone(edit.initialValue),
      value: clone(value),
    } }
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone)
    if (!value || typeof value !== 'object') return value
    const result = {}
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]) })
    return result
  }
})(window.aiditor = window.aiditor || {})

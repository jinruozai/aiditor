// UI library — signal helper.
//
// All input widgets in aiditor.ui take a caller-owned signal as `value`. This file
// provides four small helpers that every component reuses:
//
//   asSig(v)             → returns v if it's a signal, or wraps a constant
//   writer(sig, onChange, name)
//                        → returns the write path for a component. Caller
//                          contract (§ signal contract C):
//                            · if `onChange` is a function, use it
//                            · else if `sig.set` exists, fall back to it
//                            · else throw at construction
//                          Runtime write sites call this once and reuse the
//                          returned function — no per-event typeof checks.
//   bind(el, sig, fn)    → run fn(value) immediately + every time sig changes;
//                          auto-cleanup is registered on el.__aiditorCleanups
//   collect(el, fn)      → push a cleanup callback onto el.__aiditorCleanups
//
// Cleanup model: every component root element grows an `__aiditorCleanups: fn[]`
// array. aiditor.ui.dispose(el) runs them in reverse order and removes el from
// its parent. Callers that mount UI components inside a framework panel should
// call ctx.onCleanup(() => aiditor.ui.dispose(el)) so cleanups fire when the
// panel is removed.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // Accepts both plain signals and read-only derived signals — the read
  // contract is the same (call as fn, has .peek). Writable check (.set) is
  // only needed by components that default-write into the signal; they can
  // gate on `typeof v.set === 'function'` where relevant.
  function isSignal(v) {
    return typeof v === 'function' && typeof v.peek === 'function'
  }
  ui.isSignal = isSignal

  function asSig(v) {
    if (isSignal(v)) return v
    return aiditor.signal(v)
  }
  ui.asSig = asSig

  // Caller contract (§ signal contract C): returns the function a component
  // should call to write a new value. Throws at construction if no write path
  // is available — no runtime defensive `typeof .set` checks anywhere.
  //
  // Writes execute in `aiditor.untracked` scope so the caller's onChange (which may
  // read outer signals as part of persisting state) never silently subscribes
  // the effect that invoked the write. Same principle as `bus.emit` handlers
  // and `materializeComponentEl` — a write is a side effect, not a computation.
  function writer(sig, onChange, name) {
    const write = (typeof onChange === 'function')
      ? onChange
      : (typeof sig === 'function' && typeof sig.set === 'function' ? sig.set : null)
    if (!write) throw new Error((name || 'ui') + ': `value` must be a writable signal or `onChange` is required')
    return function (v, meta) { aiditor.untracked(function () { write(v, meta) }) }
  }
  ui.writer = writer

  function collect(el, fn) {
    if (!el.__aiditorCleanups) el.__aiditorCleanups = []
    el.__aiditorCleanups.push(fn)
  }
  ui.collect = collect

  // bind(el, sig, fn): runs fn(sig()) once + on every change; cleanup auto.
  function bind(el, sig, fn) {
    const stop = aiditor.effect(function () { fn(sig()) })
    collect(el, stop)
    return stop
  }
  ui.bind = bind

  // bindText(el, sig) — textContent = String(sig() ?? '')
  // Used by every component with a text/label display signal.
  ui.bindText = function (el, sig) {
    bind(el, sig, function (v) { el.textContent = v == null ? '' : String(v) })
  }

  // bindClass(el, sig, prefix) — swap `${prefix}${value}` class as sig changes.
  // For mutually-exclusive variant classes like aiditor-ui-btn-primary, aiditor-ui-btn-md.
  // Strips the previous variant class before adding the new one.
  ui.bindClass = function (el, sig, prefix) {
    let prev = ''
    bind(el, sig, function (v) {
      if (prev) el.classList.remove(prev)
      prev = v ? (prefix + v) : ''
      if (prev) el.classList.add(prev)
    })
  }

  // bindAttr(el, sig, name) — reflect sig() onto an attribute / boolean prop.
  // If `name` is a boolean DOM prop (disabled, checked, open), sets el[name]=!!v.
  // Otherwise sets/removes the attribute.
  ui.bindAttr = function (el, sig, name) {
    const isBoolProp = name === 'disabled' || name === 'checked' || name === 'open' || name === 'readOnly'
    bind(el, sig, function (v) {
      if (isBoolProp) { el[name] = !!v }
      else if (v == null || v === false) el.removeAttribute(name)
      else el.setAttribute(name, v === true ? '' : String(v))
    })
  }

  // dispose: run all cleanups in reverse, then detach.
  ui.dispose = function (el) {
    if (!el) return
    const list = el.__aiditorCleanups
    if (list) {
      for (let i = list.length - 1; i >= 0; i--) {
        try { list[i]() } catch (e) { console.error('[aiditor.ui] cleanup error', e) }
      }
      el.__aiditorCleanups = null
    }
    if (el.parentNode) el.parentNode.removeChild(el)
  }

  // tiny element helper — keeps component files terse.
  // No `html:` escape hatch by design: if a component genuinely needs raw HTML
  // (only codeInput does, for syntax highlighting), it assigns `.innerHTML`
  // directly on its own element. That makes the trust boundary visible at
  // the call site instead of hiding it behind an option name.
  ui.disposeChildren = function (el) {
    while (el && el.firstChild) ui.dispose(el.firstChild)
  }

  ui.h = function (tag, cls, attrs) {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (attrs) for (const k in attrs) {
      if (k === 'text') el.textContent = attrs[k]
      else if (k === 'style') el.style.cssText = attrs[k]
      else if (k.charCodeAt(0) === 111 && k.charCodeAt(1) === 110) el[k.toLowerCase()] = attrs[k] // onClick etc.
      else el.setAttribute(k, attrs[k])
    }
    return el
  }
})(window.aiditor = window.aiditor || {})

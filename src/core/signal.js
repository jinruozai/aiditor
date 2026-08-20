// Minimal reactive core — signal / effect / derived / batch / onCleanup.
// Exposed on the global aiditor namespace. No imports, no modules.
//
// This file is the zero-dependency bottom of the framework. It does NOT call
// aiditor.reportError — effect cleanup failures go to console.error to avoid a
// circular dependency with errors.js (which itself uses signal()). See § 4.7.
;(function (aiditor) {
  'use strict'

  let currentEffect = null
  let batchDepth = 0
  const pending = new Set()
  const MAX_EFFECT_RUNS = 100

  function signal(initial) {
    let value = initial
    const subs = new Set()
    const read = function () {
      if (currentEffect) { subs.add(currentEffect); currentEffect.deps.add(subs) }
      return value
    }
    read.set = function (v) {
      if (Object.is(v, value)) return
      value = v
      const list = Array.from(subs)
      for (let i = 0; i < list.length; i++) schedule(list[i])
    }
    read.update = function (fn) { read.set(fn(value)) }
    read.peek = function () { return value }
    return read
  }

  function schedule(eff) {
    if (eff.disposed) return
    if (eff.running) {
      eff.queued = true
      return
    }
    if (batchDepth > 0) pending.add(eff)
    else run(eff)
  }

  // Drop every dep edge and run+clear every onCleanup callback. Shared by the
  // re-run path (run) and the final dispose path, so the two can't drift.
  // Cleanup failures go to console.error, not aiditor.log — § 4.7: signal.js is
  // the zero-dep bottom, so a cleanup throw is fail-loud, not panel-scoped.
  function teardown(eff) {
    eff.deps.forEach(function (s) { s.delete(eff) })
    eff.deps.clear()
    for (let i = 0; i < eff.cleanups.length; i++) {
      try { eff.cleanups[i]() } catch (e) { console.error(e) }
    }
    eff.cleanups = []
  }

  function run(eff) {
    if (eff.disposed) return
    if (eff.running) {
      eff.queued = true
      return
    }
    eff.running = true
    let runs = 0
    try {
      do {
        eff.queued = false
        teardown(eff)
        const prev = currentEffect
        currentEffect = eff
        try { eff.fn() } finally { currentEffect = prev }
        runs++
        if (runs >= MAX_EFFECT_RUNS && eff.queued) throw new Error('aiditor.signal: reactive cycle detected')
      } while (eff.queued && !eff.disposed)
    } finally {
      eff.running = false
      eff.queued = false
    }
  }

  function effect(fn) {
    const eff = { fn: fn, deps: new Set(), cleanups: [], disposed: false, running: false, queued: false }
    run(eff)
    return function dispose() {
      if (eff.disposed) return
      eff.disposed = true
      teardown(eff)
    }
  }

  function onCleanup(fn) {
    if (currentEffect) currentEffect.cleanups.push(fn)
  }

  function batch(fn) {
    batchDepth++
    try { fn() } finally {
      if (--batchDepth === 0) {
        const list = Array.from(pending); pending.clear()
        for (let i = 0; i < list.length; i++) run(list[i])
      }
    }
  }

  // derived(fn) → read-only signal whose value is the result of fn().
  // Re-runs when any signal read inside fn changes. Backed by an effect that
  // writes into an internal signal, so downstream effects can subscribe to it
  // exactly the same way as a plain signal. Object.is dirty-check ensures
  // unchanged outputs don't re-notify.
  function derived(fn) {
    const out = signal(undefined)
    const dispose = effect(function () { out.set(fn()) })
    const read = function () { return out() }
    read.peek = function () { return out.peek() }
    read.dispose = dispose
    return read
  }

  // untracked(fn) — run fn with no `currentEffect`, so any signal reads
  // inside it subscribe NO effect. Used by the framework wherever code that
  // *might* do reads is invoked from inside an owning effect you don't want
  // to pollute. Component.create is the canonical case — it runs inside the
  // reconcile effect, but component code shouldn't accidentally subscribe
  // reconcile to user-owned signals. Any real reactivity should go through
  // aiditor.effect inside the component, where it creates its own effect scope.
  function untracked(fn) {
    const prev = currentEffect
    currentEffect = null
    try { return fn() } finally { currentEffect = prev }
  }

  aiditor.signal    = signal
  aiditor.effect    = effect
  aiditor.derived   = derived
  aiditor.onCleanup = onCleanup
  aiditor.batch     = batch
  aiditor.untracked = untracked
})(window.aiditor = window.aiditor || {})

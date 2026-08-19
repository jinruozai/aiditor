// Single global log stream. Errors are just entries with level='error' —
// no separate channel. Anything that wants "errors only" filters in its own
// derived/effect.
//
//   aiditor.log                          : signal<LogEntry[]>
//     aiditor.log()         entries[]
//     aiditor.log.push(level, source, message[, error])
//     aiditor.log.dismiss(id)
//     aiditor.log.clear()
//
//   aiditor.reportError(source, err)     // shim → aiditor.log.push('error', source, …)
//   aiditor.safeCall(source, fn)         // sync try/catch wrapper
//
// LogEntry = { id, time, level, source, message, error?, stack? }
// level    = 'error' | 'warn' | 'info' | 'debug'
// source   = { scope: 'component'|'global'|'bus'|..., dockId?, panelId?, component?, topic? }
//
// The window 'error' / 'unhandledrejection' listeners are NOT installed
// here — they live in dock/layout.js and attach on first createDockLayout()
// (§ 4.7). This file is pure data and must not touch window globals.
;(function (aiditor) {
  'use strict'

  const log = aiditor.signal([])
  let _nextId = 1

  log.push = function (level, source, message, error) {
    const entry = {
      id:      'log-' + (_nextId++),
      time:    Date.now(),
      level:   level || 'info',
      source:  source || { scope: 'unknown' },
      message: message != null ? String(message) : ((error && error.message) || ''),
      error:   error || null,
      stack:   (error && error.stack) || null,
    }
    log.update(function (list) { return list.concat([entry]) })
    return entry
  }

  log.dismiss = function (id) {
    log.update(function (list) { return list.filter(function (e) { return e.id !== id }) })
  }

  log.clear = function () { log.set([]) }

  // Synchronous try/catch wrapper. Async errors inside fn (setTimeout,
  // Promises, event handlers) are NOT caught here — the global window
  // listeners in dock/layout.js cover those.
  //
  // Optional `level` downgrades a caught failure from 'error' to a softer
  // level (e.g. 'warn'). Use it for best-effort projection hooks (permission
  // targets, availability, …) whose failure is expected and already handled
  // by the caller's fallback — those are not bugs, so they must not surface as
  // errors. Non-error failures omit the error object/stack to keep the log quiet.
  function safeCall(source, fn, level) {
    try { return fn() }
    catch (e) { log.push(level || 'error', source, e.message || String(e), level && level !== 'error' ? null : e); return null }
  }

  function reportError(source, err) {
    return log.push('error', source, (err && err.message) || String(err), err)
  }

  aiditor.log         = log
  aiditor.reportError = reportError
  aiditor.safeCall    = safeCall
})(window.aiditor = window.aiditor || {})

// Ordered Tool batch scheduling and cooperative execution deadlines.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function executionError(code, message) {
    const err = new Error(message)
    err.code = code
    return err
  }

  function aborted(signal) {
    return !!(signal && signal.aborted)
  }

  function runWithDeadline(tool, parentSignal, task) {
    const controller = new AbortController()
    const timeoutMs = tool && tool.timeoutMs || null
    let timer = null
    let reason = null
    let rejectAbort = null
    const abortPromise = new Promise(function (_, reject) { rejectAbort = reject })

    function stop(code, message) {
      if (reason) return
      reason = code
      controller.abort()
      rejectAbort(executionError(code, message))
    }

    function onParentAbort() {
      stop('TOOL_CANCELLED', 'Tool call was cancelled')
    }

    if (parentSignal) parentSignal.addEventListener('abort', onParentAbort, { once: true })
    if (aborted(parentSignal)) onParentAbort()
    if (timeoutMs) {
      timer = setTimeout(function () {
        stop('TOOL_TIMEOUT', 'Tool call timed out after ' + timeoutMs + 'ms')
      }, timeoutMs)
    }

    let taskPromise
    if (reason) taskPromise = Promise.reject(executionError(reason, reason === 'TOOL_TIMEOUT' ? 'Tool call timed out' : 'Tool call was cancelled'))
    else taskPromise = Promise.resolve().then(function () { return task(controller.signal) })
    taskPromise.catch(function () {})

    return Promise.race([taskPromise, abortPromise]).finally(function () {
      if (timer) clearTimeout(timer)
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort)
    })
  }

  function parallelGroup(items, start, mode) {
    let end = start
    while (end < items.length && mode(items[end]) === 'parallel') end++
    return end
  }

  function runParallel(items, start, end, execute, signal, limit, results) {
    let cursor = start
    function worker() {
      if (cursor >= end || aborted(signal)) return Promise.resolve()
      const index = cursor++
      return Promise.resolve(execute(items[index], index)).then(function (value) {
        results[index] = value
        return worker()
      })
    }
    const workers = []
    const count = Math.min(limit, end - start)
    for (let i = 0; i < count; i++) workers.push(worker())
    return Promise.all(workers)
  }

  function schedule(items, options) {
    const opts = options || {}
    const mode = opts.mode
    const execute = opts.execute
    const halt = opts.halt || function () { return false }
    const signal = opts.signal || null
    const limit = Math.max(1, Number(opts.parallelLimit) || 4)
    const results = new Array(items.length)

    function next(index) {
      if (index >= items.length || aborted(signal)) return Promise.resolve(results)
      if (mode(items[index]) === 'exclusive') {
        return Promise.resolve(execute(items[index], index)).then(function (value) {
          results[index] = value
          if (halt(value)) return results
          return next(index + 1)
        })
      }
      const end = parallelGroup(items, index, mode)
      return runParallel(items, index, end, execute, signal, limit, results).then(function () {
        for (let i = index; i < end; i++) if (halt(results[i])) return results
        return next(end)
      })
    }

    return next(0)
  }

  ai.toolScheduler = {
    schedule: schedule,
    runWithDeadline: runWithDeadline,
  }
})(window.aiditor = window.aiditor || {})

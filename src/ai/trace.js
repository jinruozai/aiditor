// aiditor.ai run trace - compact diagnostic event timeline.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const eventsSig = aiditor.signal([])
  const MAX_TRACE_EVENTS = 2000
  let nextTraceEventId = 1

  function now() { return Date.now() }

  function makeId() {
    return 'tr_' + now().toString(36) + '_' + nextTraceEventId++
  }

  function compactString(value, max) {
    if (value == null) return ''
    const text = String(value)
    max = max || 600
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function compactMeta(value, depth) {
    if (value == null) return null
    if (typeof value === 'string') return compactString(value, 1200)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (depth <= 0) return compactString(stringify(value), 1200)
    if (Array.isArray(value)) {
      const out = []
      const n = Math.min(value.length, 24)
      for (let i = 0; i < n; i++) out.push(compactMeta(value[i], depth - 1))
      if (value.length > n) out.push({ omitted: value.length - n })
      return out
    }
    const out = {}
    const keys = Object.keys(value)
    const n = Math.min(keys.length, 32)
    for (let i = 0; i < n; i++) out[keys[i]] = compactMeta(value[keys[i]], depth - 1)
    if (keys.length > n) out.__omittedKeys = keys.length - n
    return out
  }

  function stringify(value) {
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (_) { return String(value) }
  }

  function normalize(spec) {
    spec = spec || {}
    return {
      id: spec.id || makeId(),
      time: spec.time || now(),
      type: spec.type || 'event',
      runId: spec.runId || null,
      traceId: spec.traceId || spec.runId || null,
      agentId: spec.agentId || null,
      messageId: spec.messageId || null,
      questId: spec.questId || null,
      parentAgentId: spec.parentAgentId || null,
      phase: spec.phase || '',
      entry: spec.entry || '',
      status: spec.status || '',
      summary: compactString(spec.summary || '', 500),
      meta: compactMeta(spec.meta || null, 2),
    }
  }

  function append(spec) {
    const event = normalize(spec)
    eventsSig.update(function (events) {
      const next = events.concat([event])
      return next.length > MAX_TRACE_EVENTS ? next.slice(next.length - MAX_TRACE_EVENTS) : next
    })
    return event
  }

  function list(filter) {
    const events = eventsSig()
    if (!filter) return events
    if (typeof filter === 'string') return events.filter(function (event) { return event.runId === filter || event.traceId === filter })
    return events.filter(function (event) {
      if (filter.runId && event.runId !== filter.runId) return false
      if (filter.traceId && event.traceId !== filter.traceId) return false
      if (filter.agentId && event.agentId !== filter.agentId) return false
      if (filter.questId && event.questId !== filter.questId) return false
      if (filter.type && event.type !== filter.type) return false
      return true
    })
  }

  function clear(filter) {
    if (!filter) {
      eventsSig.set([])
      return []
    }
    eventsSig.update(function (events) {
      return events.filter(function (event) {
        if (typeof filter === 'string') return event.runId !== filter && event.traceId !== filter
        if (filter.runId && event.runId === filter.runId) return false
        if (filter.traceId && event.traceId === filter.traceId) return false
        if (filter.agentId && event.agentId === filter.agentId) return false
        if (filter.questId && event.questId === filter.questId) return false
        return true
      })
    })
    return eventsSig()
  }

  ai.trace = {
    events: eventsSig,
    append: append,
    list: list,
    clear: clear,
  }
})(window.aiditor = window.aiditor || {})

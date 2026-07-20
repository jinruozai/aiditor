// aiditor.ai provider shared helpers.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function normalizeModels(models) {
    const list = Array.isArray(models) ? models : []
    return list.map(function (item) {
      if (typeof item === 'string') return { id: item, value: item, label: item }
      const id = item.id || item.value || item.name || item.model
      return Object.assign({}, item, { id: id, value: id, label: item.label || item.name || id })
    })
  }

  function trimSlash(s) {
    return String(s || '').replace(/\/+$/, '')
  }

  function joinUrl(base, path) {
    return trimSlash(base) + '/' + String(path || '').replace(/^\/+/, '')
  }

  function authHeaders(config, kind) {
    const headers = { 'Content-Type': 'application/json' }
    if (!config.apiKey) return headers
    if (kind === 'anthropic') headers['x-api-key'] = config.apiKey
    else headers.Authorization = 'Bearer ' + config.apiKey
    return headers
  }

  function providerError(res, data) {
    const status = Number(res && res.status || 0) || null
    const message = (data && (data.error && (data.error.message || data.error))) || (res && res.statusText) || 'Provider request failed'
    const err = new Error(String(message))
    err.name = 'ProviderError'
    err.status = status
    err.code = status === 429 ? 'PROVIDER_RATE_LIMITED'
      : status === 408 ? 'PROVIDER_REQUEST_TIMEOUT'
        : status && status >= 500 ? 'PROVIDER_UNAVAILABLE'
          : 'PROVIDER_HTTP_ERROR'
    err.retryable = status === 408 || status === 429 || !!(status && status >= 500)
    err.retryAfterMs = retryAfterMs(res && res.headers)
    err.providerBody = data || null
    return err
  }

  function retryAfterMs(headers) {
    const value = headers && headers.get ? headers.get('retry-after') : null
    if (!value) return null
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const time = Date.parse(value)
    return Number.isFinite(time) ? Math.max(0, time - Date.now()) : null
  }

  function requestFetch(url, opts) {
    return fetch(url, opts).catch(function (cause) {
      if (cause && cause.name === 'AbortError') throw cause
      const err = new Error(cause && cause.message ? cause.message : 'Provider network request failed')
      err.name = 'ProviderError'
      err.code = 'PROVIDER_NETWORK_ERROR'
      err.status = null
      err.retryable = true
      err.retryAfterMs = null
      err.cause = cause
      throw err
    })
  }

  function requestBody(url, opts) {
    return requestFetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        let data = null
        try { data = text ? JSON.parse(text) : null } catch (_) {}
        if (!res.ok) throw providerError(res, data)
        return {
          text: text,
          contentType: res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '',
        }
      })
    })
  }

  function requestJson(url, opts) {
    return requestBody(url, opts).then(function (body) {
      return body.text ? JSON.parse(body.text) : null
    })
  }

  function requestMaybeStream(url, opts, extractDelta) {
    return requestFetch(url, opts).then(function (res) {
      const contentType = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : ''
      if (res.ok && contentType.indexOf('text/event-stream') >= 0 && res.body) {
        return { streamed: true, deltas: streamSse(res.body, extractDelta) }
      }
      return res.text().then(function (text) {
        let data = null
        try { data = text ? JSON.parse(text) : null } catch (_) {}
        if (!res.ok) throw providerError(res, data)
        if (contentType.indexOf('text/event-stream') >= 0 || text.indexOf('data:') === 0) {
          const parsed = parseSse(text, extractDelta)
          return Object.assign({ streamed: true }, parsed)
        }
        return { streamed: false, data: data }
      })
    })
  }

  async function* streamSse(body, extractDelta) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const snapshotState = { text: '' }
    while (true) {
      const next = await reader.read()
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.indexOf('data:') !== 0) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        const data = JSON.parse(raw)
        const chunk = normalizeSnapshotDelta(normalizeStreamDelta(extractDelta(data), data.usage || null), snapshotState)
        if (hasStreamDelta(chunk)) yield chunk
      }
    }
    buffer += decoder.decode()
    if (buffer.indexOf('data:') === 0) {
      const raw = buffer.slice(5).trim()
      if (raw && raw !== '[DONE]') {
        const data = JSON.parse(raw)
        const chunk = normalizeSnapshotDelta(normalizeStreamDelta(extractDelta(data), data.usage || null), snapshotState)
        if (hasStreamDelta(chunk)) yield chunk
      }
    }
  }

  function parseSse(text, extractDelta) {
    const lines = String(text || '').split(/\r?\n/)
    const parts = []
    const reasoning = []
    const toolCalls = []
    const snapshotState = { text: '' }
    let usage = null
    let finishReason = null
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.indexOf('data:') !== 0) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      const data = JSON.parse(raw)
      if (data.usage) usage = data.usage
      const chunk = normalizeSnapshotDelta(normalizeStreamDelta(extractDelta(data), data.usage || null), snapshotState)
      if (chunk.text) parts.push(chunk.text)
      if (chunk.reasoning_content) reasoning.push(chunk.reasoning_content)
      if (chunk.finishReason || chunk.finish_reason || chunk.stopReason || chunk.stop_reason) finishReason = chunk.finishReason || chunk.finish_reason || chunk.stopReason || chunk.stop_reason
      for (let j = 0; chunk.toolCalls && j < chunk.toolCalls.length; j++) toolCalls.push(chunk.toolCalls[j])
    }
    const out = { content: parts.join(''), usage: usage }
    if (reasoning.length) out.reasoning_content = reasoning.join('')
    if (toolCalls.length) out.toolCalls = toolCalls
    if (finishReason) out.finishReason = finishReason
    return out
  }

  function normalizeSnapshotDelta(delta, state) {
    if (!delta) return delta
    if (delta.snapshot != null) {
      const full = String(delta.snapshot)
      delta.text = textDeltaFromSnapshot(full, state, 'text')
      delete delta.snapshot
      return delta
    }
    if (delta.text) delta.text = textDeltaFromMaybeSnapshot(String(delta.text), state, 'text')
    if (delta.reasoning_content) delta.reasoning_content = textDeltaFromMaybeSnapshot(String(delta.reasoning_content), state, 'reasoning')
    return delta
  }

  function textDeltaFromSnapshot(full, state, key) {
    const previous = state && state[key] || ''
    const text = previous && full.indexOf(previous) === 0 ? full.slice(previous.length) : full
    if (state) state[key] = full
    return text
  }

  function textDeltaFromMaybeSnapshot(text, state, key) {
    const previous = state && state[key] || ''
    const delta = previous && text.indexOf(previous) === 0 ? text.slice(previous.length) : text
    if (state) state[key] = previous && text.indexOf(previous) === 0 ? text : previous + text
    return delta
  }

  function normalizeStreamDelta(chunk, usage) {
    let out = null
    if (chunk && typeof chunk === 'object') {
      out = Object.assign({}, chunk)
      if (out.content != null && out.text == null) out.text = String(out.content)
      if (out.reasoningContent != null && out.reasoning_content == null) out.reasoning_content = String(out.reasoningContent)
    } else {
      out = { text: chunk ? String(chunk) : '' }
    }
    if (usage && !out.usage) out.usage = usage
    return out
  }

  function hasStreamDelta(delta) {
    return !!(delta && (delta.text || delta.reasoning_content || delta.usage || delta.finishReason || delta.finish_reason || delta.stopReason || delta.stop_reason || (delta.toolCalls && delta.toolCalls.length) || (delta.tool_calls && delta.tool_calls.length)))
  }

  function estimateUsageCost(provider, model, usage) {
    if (provider !== 'deepseek' || !usage) return null
    const m = String(model || '').toLowerCase()
    const rates = m.indexOf('pro') >= 0
      ? { inputHit: 0.145, inputMiss: 1.74, output: 3.48 }
      : { inputHit: 0.028, inputMiss: 0.14, output: 0.28 }
    const hit = Number(usage.prompt_cache_hit_tokens || 0)
    const prompt = Number(usage.prompt_tokens || 0)
    const explicitMiss = Number(usage.prompt_cache_miss_tokens || 0)
    const miss = explicitMiss || Math.max(0, prompt - hit)
    const out = Number(usage.completion_tokens || usage.output_tokens || 0)
    const amount = (hit * rates.inputHit + miss * rates.inputMiss + out * rates.output) / 1000000
    return amount > 0 ? { currency: 'USD', amount: amount } : null
  }

  ai.provider = {
    normalizeModels: normalizeModels,
    joinUrl: joinUrl,
    authHeaders: authHeaders,
    requestJson: requestJson,
    requestMaybeStream: requestMaybeStream,
    providerError: providerError,
  }
  ai.estimateUsageCost = estimateUsageCost
})(window.aiditor = window.aiditor || {})

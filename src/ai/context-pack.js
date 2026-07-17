// aiditor.ai context pack - normalized request context inventory.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function estimateTokens(text) {
    const s = String(text || '')
    let ascii = 0
    let wide = 0
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) < 128) ascii++
      else wide++
    }
    return Math.ceil(ascii / 4 + wide * 0.8)
  }

  function textOf(message) {
    if (!message) return ''
    const content = message.content != null ? message.content : message.text
    if (typeof content === 'string') return content
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(content) : JSON.stringify(content) } catch (_) { return String(content) }
  }

  function normalizeItem(item, index) {
    item = item || {}
    const text = item.text != null ? String(item.text) : ''
    const id = String(item.id || ('context_' + String(index + 1)))
    const priority = Number(item.priority || 0)
    return {
      id: id,
      kind: item.kind || 'context',
      layer: item.layer || item.kind || 'context',
      title: item.title || id || item.layer || item.kind || 'Context',
      summary: item.summary || '',
      uri: item.uri || '',
      source: item.source || '',
      priority: isFinite(priority) ? priority : 0,
      tokenEstimate: item.tokenEstimate || estimateTokens(text || item.summary || item.title),
      stale: !!item.stale,
      meta: item.meta || {},
    }
  }

  function fromMessages(messages) {
    const items = []
    for (let i = 0; i < (messages || []).length; i++) {
      const message = messages[i]
      const meta = message && message.meta || {}
      if (!meta.contextLayer) continue
      const text = textOf(message)
      items.push(normalizeItem({
        id: meta.contextCardId || message.id,
        kind: meta.contextLayer,
        layer: meta.contextLayer,
        title: meta.contextCardId || meta.contextLayer,
        summary: text.slice(0, 240),
        priority: meta.contextPriority || 0,
        tokenEstimate: estimateTokens(text),
        source: 'request',
        meta: {
          messageId: message.id || null,
          role: message.role || '',
        },
      }, items.length))
    }
    items.sort(function (a, b) {
      return (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id))
    })
    return {
      version: 1,
      items: items,
      totalTokenEstimate: items.reduce(function (sum, item) { return sum + (item.tokenEstimate || 0) }, 0),
    }
  }

  ai.contextPack = {
    normalizeItem: normalizeItem,
    fromMessages: fromMessages,
    estimateTokens: estimateTokens,
  }
})(window.aiditor = window.aiditor || {})

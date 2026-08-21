// aiditor.ai memory - conservative durable memory helpers.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const config = {
    maxItems: 80,
  }

  function now() { return Date.now() }

  function textOf(item) {
    if (item == null) return ''
    if (typeof item === 'string') return item
    return String(item.text || item.summary || item.title || item.value || '')
  }

  function normalizeItems(items) {
    const out = []
    const list = Array.isArray(items) ? items : []
    for (let i = 0; i < list.length; i++) {
      const text = textOf(list[i]).trim()
      if (text) out.push(text)
    }
    return out
  }

  function mergeList(current, incoming, max) {
    const seen = {}
    const out = []
    const base = normalizeItems(current)
    const next = normalizeItems(incoming)
    for (let i = 0; i < base.length; i++) {
      const key = base[i].toLowerCase()
      if (seen[key]) continue
      seen[key] = true
      out.push(base[i])
    }
    for (let j = 0; j < next.length; j++) {
      const key = next[j].toLowerCase()
      if (seen[key]) continue
      seen[key] = true
      out.push(next[j])
    }
    return out.slice(Math.max(0, out.length - max))
  }

  function updateFromCompaction(agentId, record, opts) {
    const agent = ai.findAgent && ai.findAgent(agentId)
    if (!agent || !record) return null
    const options = Object.assign({}, config, opts || {})
    const memory = Object.assign({}, agent.memory || {})
    memory.facts = mergeList(memory.facts, record.facts, options.maxItems)
    memory.decisions = mergeList(memory.decisions, record.decisions, options.maxItems)
    memory.openItems = mergeList(memory.openItems, record.openItems, options.maxItems)
    memory.updatedAt = now()
    memory.sourceCompactionIds = mergeList(memory.sourceCompactionIds, [record.id], options.maxItems)
    return ai.updateAgent(agent.id, { memory: memory }).memory
  }

  function configure(options) {
    Object.assign(config, options || {})
    return Object.assign({}, config)
  }

  ai.memory = {
    configure: configure,
    updateFromCompaction: updateFromCompaction,
  }
})(window.aiditor = window.aiditor || {})

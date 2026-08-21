// aiditor.ai semantic context compaction runtime service.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  const config = {
    enabled: true,
    softLimitRatio: 0.75,
    hardLimitRatio: 0.9,
    tailMessages: 12,
    minMessages: 8,
    maxMessages: 80,
    maxRecordsInRequest: 12,
    summaryChars: 900,
    memoryUpdate: 'conservative',
  }
  let nextCompactionId = 1

  function now() { return Date.now() }

  function textOf(value) {
    if (value == null) return ''
    if (typeof value === 'string') return value
    return safeJson(value)
  }

  function safeJson(value) {
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (_) { return String(value) }
  }

  function clip(value, max) {
    const text = textOf(value).replace(/\s+/g, ' ').trim()
    return text.length > max ? text.slice(0, max) + '...' : text
  }

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

  function stableHash(text) {
    const s = String(text || '')
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
    }
    return 'fnv1a:' + (h >>> 0).toString(16)
  }

  function modelContextLimit(agent) {
    const explicit = Number(agent && (agent.contextBudgetTokens || (agent.meta && agent.meta.contextBudgetTokens)))
    if (explicit > 0) return explicit
    const id = String(agent && agent.model || '').toLowerCase()
    if (id.indexOf('gpt-5') >= 0) return 400000
    if (id.indexOf('claude') >= 0) return 200000
    if (id.indexOf('gemini') >= 0) return 1000000
    if (id.indexOf('deepseek') >= 0) return 64000
    return 128000
  }

  function messageCost(message) {
    let cost = estimateTokens((message.role || '') + '\n' + textOf(message.content)) + 8
    if (message.reasoning_content) cost += estimateTokens(message.reasoning_content)
    const calls = message.toolCalls || []
    for (let i = 0; i < calls.length; i++) cost += estimateTokens(safeJson(calls[i])) + 16
    return cost
  }

  function messagesCost(messages) {
    let total = 0
    for (let i = 0; i < (messages || []).length; i++) total += messageCost(messages[i])
    return total
  }

  function compactedIdSet(agent) {
    const set = {}
    const records = agent && agent.compactions || []
    for (let i = 0; i < records.length; i++) {
      const ids = records[i].messageIds || []
      for (let j = 0; j < ids.length; j++) set[ids[j]] = true
    }
    return set
  }

  function messageIndexById(messages) {
    const out = {}
    for (let i = 0; i < (messages || []).length; i++) out[messages[i].id] = i
    return out
  }

  function latestCompactedIndex(agent, messages) {
    const byId = messageIndexById(messages)
    const records = agent && agent.compactions || []
    let latest = -1
    for (let i = 0; i < records.length; i++) {
      const ids = records[i].messageIds || []
      for (let j = 0; j < ids.length; j++) {
        if (byId[ids[j]] != null && byId[ids[j]] > latest) latest = byId[ids[j]]
      }
    }
    return latest
  }

  function finalToolStatus(call) {
    return !!call && (call.status === 'applied' || call.status === 'completed' || call.status === 'rejected' || call.status === 'failed')
  }

  function hasToolResult(messages, callId, endExclusive) {
    for (let i = 0; i < endExclusive; i++) {
      const message = messages[i]
      if (message.role === 'tool' && message.meta && message.meta.toolCallId === callId) return true
    }
    return false
  }

  function safeRangeEnd(messages, endExclusive) {
    let end = endExclusive
    while (end > 0) {
      let safe = true
      for (let i = 0; i < end; i++) {
        const calls = messages[i].toolCalls || []
        for (let j = 0; j < calls.length; j++) {
          const call = calls[j]
          if (!finalToolStatus(call) || !hasToolResult(messages, call.id, end)) {
            safe = false
            end = i
            break
          }
        }
        if (!safe) break
      }
      if (safe) return end
    }
    return 0
  }

  function compactableMessages(agent, input, opts) {
    const options = Object.assign({}, config, opts || {})
    const messages = agent && agent.messages || []
    const start = latestCompactedIndex(agent, messages) + 1
    let end = messages.length - Math.max(0, options.tailMessages)
    if (input && input.id) {
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].id === input.id) {
          end = Math.min(end, i)
          break
        }
      }
    }
    end = Math.max(start, safeRangeEnd(messages, Math.max(0, end)))
    const out = []
    for (let i = start; i < end && out.length < options.maxMessages; i++) {
      const message = messages[i]
      if (message.status === 'queued' || message.status === 'running' || message.status === 'waiting_approval') break
      out.push(message)
    }
    return out
  }

  function plan(agentId, input, opts) {
    const agent = ai.findAgent && ai.findAgent(agentId)
    const options = Object.assign({}, config, opts || {})
    if (!agent || options.enabled === false) return null
    const messages = agent.messages || []
    const limit = modelContextLimit(agent)
    const used = messagesCost(messages)
    const softLimit = Math.floor(limit * options.softLimitRatio)
    const hardLimit = Math.floor(limit * options.hardLimitRatio)
    const force = !!options.force
    if (!force && used < softLimit) return null
    const selected = compactableMessages(agent, input, options)
    if (selected.length < options.minMessages) return null
    const before = messagesCost(selected)
    return {
      agentId: agent.id,
      inputMessageId: input && input.id || null,
      messageIds: selected.map(function (message) { return message.id }),
      tokenEstimateBefore: before,
      tokenEstimateAfter: Math.min(before, Math.max(128, Math.floor(before * 0.18))),
      limit: limit,
      used: used,
      softLimit: softLimit,
      hardLimit: hardLimit,
      forced: force,
      createdAt: now(),
    }
  }

  function collectRefs(messages) {
    const seen = {}
    const out = []
    function add(ref) {
      const id = typeof ref === 'string' ? ref : (ref && (ref.uri || ref.id || ref.refId))
      if (!id || seen[id]) return
      seen[id] = true
      out.push(typeof ref === 'string' ? { id: ref } : {
        id: ref.id || ref.refId || null,
        uri: ref.uri || '',
        kind: ref.kind || ref.resolver || '',
        title: ref.title || '',
        summary: ref.summary || '',
      })
    }
    for (let i = 0; i < messages.length; i++) {
      const refs = (messages[i].contextRefs || []).concat(messages[i].attachments || [])
      for (let j = 0; j < refs.length; j++) add(refs[j])
    }
    return out
  }

  function collectToolObservations(messages) {
    const out = []
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]
      const calls = message.toolCalls || []
      for (let j = 0; j < calls.length; j++) {
        out.push({
          messageId: message.id,
          toolId: calls[j].toolId || calls[j].name || '',
          status: calls[j].status || '',
          error: calls[j].error ? clip(calls[j].error, 240) : null,
        })
      }
      if (message.role === 'tool') {
        out.push({
          messageId: message.id,
          toolId: message.meta && message.meta.toolId || (message.from || '').replace(/^tool:/, ''),
          status: message.status || 'done',
          summary: clip(message.content, 300),
        })
      }
    }
    return out
  }

  function lineItems(messages, specs, max) {
    const out = []
    for (let i = 0; i < messages.length && out.length < max; i++) {
      const text = textOf(messages[i].content)
      const lines = text.split(/\r?\n/)
      for (let j = 0; j < lines.length && out.length < max; j++) {
        const line = clip(lines[j], 260)
        if (!line) continue
        for (let s = 0; s < specs.length; s++) {
          const m = line.match(specs[s].re)
          if (!m) continue
          out.push({
            text: clip((m[1] || line).replace(/^[:：\-\s]+/, ''), 240),
            messageId: messages[i].id,
            role: messages[i].role || '',
          })
          break
        }
      }
    }
    return out
  }

  function collectFacts(messages) {
    return lineItems(messages, [
      { re: /^(?:fact|facts|context|constraint|rule|invariant|事实|背景|约束|规则|原则)\s*[:：-]\s*(.+)$/i },
    ], 12)
  }

  function collectDecisions(messages) {
    return lineItems(messages, [
      { re: /^(?:decision|decided|final decision|conclusion|结论|决定|最终方案|采用)\s*[:：-]\s*(.+)$/i },
    ], 12)
  }

  function collectOpenItems(messages) {
    return lineItems(messages, [
      { re: /^(?:todo|open item|next|follow up|blocker|待办|后续|下一步|阻塞|需要确认)\s*[:：-]\s*(.+)$/i },
    ], 12)
  }

  function collectVerification(tools) {
    const out = []
    for (let i = 0; i < tools.length; i++) {
      if (String(tools[i].toolId || '').indexOf('verify.') !== 0) continue
      out.push({
        messageId: tools[i].messageId || null,
        toolId: tools[i].toolId,
        status: tools[i].status || '',
        summary: tools[i].summary || tools[i].error || '',
      })
    }
    return out
  }

  function collectRisks(tools) {
    const out = []
    for (let i = 0; i < tools.length && out.length < 12; i++) {
      if (tools[i].status !== 'failed' && tools[i].status !== 'error' && !tools[i].error) continue
      out.push({
        messageId: tools[i].messageId || null,
        toolId: tools[i].toolId || '',
        summary: tools[i].error || tools[i].summary || 'failed',
      })
    }
    return out
  }

  function meaningfulLines(messages, role, max) {
    const out = []
    for (let i = 0; i < messages.length && out.length < max; i++) {
      if (messages[i].role !== role) continue
      const text = clip(messages[i].content, 220)
      if (text) out.push(text)
    }
    return out
  }

  function buildRecord(agent, planValue) {
    const byId = {}
    const messages = agent.messages || []
    for (let i = 0; i < messages.length; i++) byId[messages[i].id] = messages[i]
    const selected = []
    for (let j = 0; j < planValue.messageIds.length; j++) if (byId[planValue.messageIds[j]]) selected.push(byId[planValue.messageIds[j]])
    const users = meaningfulLines(selected, 'user', 4)
    const assistants = meaningfulLines(selected, 'assistant', 4)
    const tools = collectToolObservations(selected)
    const refs = collectRefs(selected)
    const facts = collectFacts(selected)
    const decisions = collectDecisions(selected)
    const openItems = collectOpenItems(selected)
    const verification = collectVerification(tools)
    const risks = collectRisks(tools)
    const source = selected.map(function (message) {
      return [message.id, message.role, message.status, textOf(message.content), safeJson(message.toolCalls || [])].join('\n')
    }).join('\n---\n')
    const summaryParts = [
      'Compacted ' + selected.length + ' older messages for agent ' + (agent.name || agent.id) + '.',
    ]
    if (users.length) summaryParts.push('User goals/requests: ' + users.join(' | '))
    if (assistants.length) summaryParts.push('Assistant progress: ' + assistants.join(' | '))
    if (tools.length) summaryParts.push('Tool observations: ' + tools.map(function (item) {
      return (item.toolId || 'tool') + ':' + (item.status || 'done') + (item.error ? ':' + item.error : '')
    }).slice(0, 8).join(' | '))
    return {
      id: 'cmp_' + Date.now().toString(36) + '_' + nextCompactionId++,
      agentId: agent.id,
      range: {
        fromMessageId: selected[0] && selected[0].id || null,
        toMessageId: selected[selected.length - 1] && selected[selected.length - 1].id || null,
      },
      messageIds: planValue.messageIds.slice(),
      createdAt: now(),
      model: 'deterministic',
      sourceHash: stableHash(source),
      summary: clip(summaryParts.join('\n'), config.summaryChars),
      facts: facts,
      decisions: decisions,
      openItems: openItems,
      changedRefs: refs,
      toolObservations: tools,
      verification: verification,
      risks: risks,
      omittedDetails: selected.length > 0 ? ['Full raw messages remain in the transcript and are omitted from provider requests by this compaction record.'] : [],
      tokenEstimateBefore: planValue.tokenEstimateBefore || messagesCost(selected),
      tokenEstimateAfter: planValue.tokenEstimateAfter || estimateTokens(summaryParts.join('\n')),
    }
  }

  function run(agentId, planValue) {
    const agent = ai.findAgent && ai.findAgent(agentId)
    const nextPlan = planValue || plan(agentId, null, { force: true })
    if (!agent || !nextPlan || !nextPlan.messageIds || !nextPlan.messageIds.length) return null
    const record = buildRecord(agent, nextPlan)
    const records = (agent.compactions || []).concat([record])
    ai.updateAgent(agent.id, { compactions: records })
    if (config.memoryUpdate === 'conservative' && ai.memory && ai.memory.updateFromCompaction) {
      ai.memory.updateFromCompaction(agent.id, record)
    }
    return record
  }

  function maybeCompact(agentId, input, opts) {
    const nextPlan = plan(agentId, input, opts)
    return nextPlan ? run(agentId, nextPlan) : null
  }

  function records(agentId) {
    const agent = ai.findAgent && ai.findAgent(agentId)
    return agent && agent.compactions ? agent.compactions.slice() : []
  }

  function clear(agentId, opts) {
    const agent = ai.findAgent && ai.findAgent(agentId)
    if (!agent) return []
    const removed = agent.compactions || []
    if (opts && opts.before) {
      const keep = removed.filter(function (record) { return (record.createdAt || 0) >= opts.before })
      ai.updateAgent(agent.id, { compactions: keep })
      return removed.filter(function (record) { return (record.createdAt || 0) < opts.before })
    }
    ai.updateAgent(agent.id, { compactions: [] })
    return removed.slice()
  }

  function configure(options) {
    Object.assign(config, options || {})
    return Object.assign({}, config)
  }

  function memoryMessage(agent) {
    const memory = agent && agent.memory || {}
    if (!memory || !Object.keys(memory).length) return null
    return {
      id: 'system-memory-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: 'Compact durable agent memory. Treat it as stable guidance, not as a replacement for exact tool reads.\n' + clip(safeJson(memory), 4000),
    }
  }

  function compactionMessage(agent) {
    const records = (agent && agent.compactions || []).slice(-config.maxRecordsInRequest)
    if (!records.length) return null
    const items = records.map(function (record) {
      return {
        id: record.id,
        range: record.range,
        summary: record.summary,
        facts: record.facts || [],
        decisions: record.decisions || [],
        openItems: record.openItems || [],
        changedRefs: record.changedRefs || [],
        toolObservations: (record.toolObservations || []).slice(0, 12),
        verification: record.verification || [],
        risks: record.risks || [],
        omittedDetails: record.omittedDetails || [],
      }
    })
    return {
      id: 'system-compactions-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: 'Compacted older transcript ranges. The raw transcript remains the source of truth; reread exact workspace files, references, or messages when precision matters.\n' + clip(safeJson(items), 12000),
    }
  }

  function contextMessages(agent) {
    const out = []
    const memory = memoryMessage(agent)
    const compacted = compactionMessage(agent)
    if (memory) out.push(memory)
    if (compacted) out.push(compacted)
    return out
  }

  function requestMessages(agent, input) {
    const compacted = compactedIdSet(agent)
    return (agent.messages || []).filter(function (message) {
      if (input && input.id === message.id) return true
      return !compacted[message.id]
    })
  }

  function commandAgent(input, ctx) {
    const id = input && input.agentId || ctx && ctx.agentId
    return id ? ai.findAgent(id) : ai.getActiveAgent && ai.getActiveAgent()
  }

  function registerCommands() {
    if (!aiditor.commands || aiditor.commands.get && aiditor.commands.get('ai.compactCurrentAgent')) return
    aiditor.commands.register('ai.compactCurrentAgent', {
      title: 'Compact Current Agent Context',
      description: 'Compact closed conversation history while preserving the full transcript.',
      icon: 'history',
      run: function (input, ctx) {
        const agent = commandAgent(input, ctx)
        if (!agent) return { compacted: false, reason: 'No active agent' }
        const nextPlan = plan(agent.id, null, Object.assign({ force: true }, input || {}))
        const record = nextPlan ? run(agent.id, nextPlan) : null
        return record
          ? { compacted: true, record: record, records: records(agent.id) }
          : { compacted: false, reason: 'No compactable closed range', records: records(agent.id) }
      },
    }, { owner: 'aiditor.ai', layer: 'builtin' })
    aiditor.commands.register('ai.clearCurrentAgentCompactions', {
      title: 'Clear Current Agent Compactions',
      danger: true,
      run: function (input, ctx) {
        const agent = commandAgent(input, ctx)
        return agent ? clear(agent.id, input || {}) : []
      },
    }, { owner: 'aiditor.ai', layer: 'builtin' })
    aiditor.commands.register('ai.listCurrentAgentCompactions', {
      title: 'List Current Agent Compactions',
      run: function (input, ctx) {
        const agent = commandAgent(input, ctx)
        return agent ? records(agent.id) : []
      },
    }, { owner: 'aiditor.ai', layer: 'builtin' })
    aiditor.commands.registerMenu('ai.compactCurrentAgent.composer', {
      target: 'ai.composer.slash',
      command: 'ai.compactCurrentAgent',
      name: 'compact',
      label: 'Compact context',
      description: 'Compact closed conversation history without deleting the transcript.',
      icon: 'history',
      order: 100,
    }, { owner: 'aiditor.ai', layer: 'builtin' })
  }

  ai.compaction = {
    configure: configure,
    plan: plan,
    run: run,
    maybeCompact: maybeCompact,
    records: records,
    clear: clear,
    contextMessages: contextMessages,
    requestMessages: requestMessages,
    estimateTokens: estimateTokens,
  }
  registerCommands()
})(window.aiditor = window.aiditor || {})

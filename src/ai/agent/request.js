// aiditor.ai canonical request builder.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const DEFAULT_SYSTEM_PROMPT = [
    'You are an AI agent.',
    'Complete the user\'s request using the capabilities available in the current request.',
    'Treat the current workspace, runtime state, and Tool results as the source of truth.',
    'Never claim an action that was not completed.',
    'If blocked, state the exact blocker.',
    'Keep responses concise, clear, and limited to what is necessary.',
  ].join('\n')
  const SKILL_BOOTSTRAP_TOOLS = ['skill.read']
  const SKILL_CATALOG_MAX_TOKENS = 2000
  const SKILL_CATALOG_CONTEXT_RATIO = 0.02

  function resolveAttachmentRef(ref, all) {
    if (typeof ref === 'string') return all.find(function (item) { return item.id === ref }) || { id: ref }
    return ref
  }

  function effectiveContextRefs(agent, input) {
    const refs = []
    const seen = {}
    function add(ref) {
      const id = typeof ref === 'string' ? ref : (ref && (ref.refId || ref.id || ref.uri))
      if (!id || seen[id]) return
      seen[id] = true
      refs.push(ref)
    }
    const agentRefs = (agent.contextRefs || []).concat(agent.attachments || [])
    const inputRefs = input ? (input.contextRefs || []).concat(input.attachments || []) : []
    for (let i = 0; i < agentRefs.length; i++) add(agentRefs[i])
    for (let j = 0; j < inputRefs.length; j++) add(inputRefs[j])
    return refs
  }

  function abortError() {
    const error = new Error('Reference hydration was cancelled')
    error.code = 'REFERENCE_HYDRATION_CANCELLED'
    return error
  }

  function withAbort(value, signal) {
    if (!signal) return Promise.resolve(value)
    if (signal.aborted) return Promise.reject(abortError())
    return new Promise(function (resolve, reject) {
      function finish(fn, result) {
        signal.removeEventListener('abort', onAbort)
        fn(result)
      }
      function onAbort() { finish(reject, abortError()) }
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(value).then(function (result) { finish(resolve, result) }, function (error) { finish(reject, error) })
    })
  }

  function resolveAttachments(refs, baseCtx, signal) {
    const store = ai.attachments
    const all = store ? store.peek() : []
    const jobs = refs.map(function (item) {
      if (signal && signal.aborted) return Promise.reject(abortError())
      const ref = resolveAttachmentRef(item, all)
      const targets = ai.references && ai.references.permissionTargets
        ? ai.references.permissionTargets(ref, baseCtx)
        : [{ entry: 'reference:' + (ref.resolver || ref.kind || 'attachment'), target: ref.uri || ref.id || '', risk: 'read' }]
      const details = targets.map(function (target) {
        return Object.assign({
          phase: 'read',
          workspace: baseCtx.workspaceMeta && (baseCtx.workspaceMeta.id || baseCtx.workspaceMeta.name) || '',
          risk: 'read',
          runId: baseCtx.runId,
          traceId: baseCtx.runId,
        }, target || {})
      })
      const decision = ai.permissions.decideMany(baseCtx.actor, baseCtx.agent.id, 'reference.read', details)
      if (!decision.allowed) {
        return Promise.resolve({
          ok: false,
          code: decision.decision === 'unavailable' ? 'REFERENCE_UNAVAILABLE' : 'REFERENCE_READ_DENIED',
          error: decision.reason,
        })
      }
      if (!ai.references || !ai.references.read) return Promise.resolve(ref)
      const ctx = Object.assign({}, baseCtx, { signal: signal || null })
      return withAbort(ai.references.read(ref, {}, ctx), signal).catch(function (error) {
        if (signal && signal.aborted) throw abortError()
        return { ok: false, code: 'REFERENCE_READ_FAILED', error: String(error && error.message || error) }
      })
    })
    return Promise.all(jobs).then(function (out) {
      if (signal && signal.aborted) throw abortError()
      return out
    })
  }

  function describeAttachments(refs, ctx) {
    const store = ai.attachments
    const all = store ? store.peek() : []
    return refs.map(function (ref) {
      const item = resolveAttachmentRef(ref, all)
      return {
        id: item.id || null,
        resolver: item.resolver || item.kind || '',
        uri: item.uri || '',
        title: item.title || '',
        kind: item.kind || 'attachment',
        summary: item.summary || '',
        meta: item.meta || {},
        schema: ai.references && ai.references.schema ? ai.references.schema(item, ctx) : (item.schema || null),
        capabilities: ai.references && ai.references.capabilities ? ai.references.capabilities(item, ctx) : (item.capabilities || []),
      }
    })
  }

  function availableSkillTools(skill, ctx) {
    const out = []
    const tools = skill && skill.tools || []
    for (let i = 0; i < tools.length; i++) {
      if (ai.tools && ai.tools.available && ai.tools.available(tools[i], ctx)) out.push(tools[i])
    }
    return out
  }

  function resolveToolRefs(ctx, skills, includeSkillList) {
    const out = []
    const seen = {}
    function add(id) {
      if (!id || seen[id] || !ai.tools.available(id, ctx)) return
      seen[id] = true
      out.push(id)
    }
    for (let i = 0; i < SKILL_BOOTSTRAP_TOOLS.length; i++) add(SKILL_BOOTSTRAP_TOOLS[i])
    if (includeSkillList) add('skill.list')
    for (let i = 0; i < (skills || []).length; i++) {
      const tools = skills[i].tools || []
      for (let j = 0; j < tools.length; j++) add(tools[j])
    }
    return out
  }

  function resolveTools(ctx, toolIds) {
    const refs = toolIds || resolveToolRefs(ctx, [])
    const out = []
    const seen = {}
    function append(spec) {
      const id = spec && spec.id
      if (seen[id]) throw new Error('Model Tool id conflict: ' + id)
      seen[id] = true
      out.push(spec)
    }
    for (let i = 0; i < refs.length; i++) {
      const tool = ai.tools.get(refs[i])
      const base = {
        id: refs[i],
        title: tool.title || refs[i],
        description: tool.description || '',
        permissions: tool.permissions || null,
        capabilities: ai.tools.capabilities ? ai.tools.capabilities(refs[i]) : null,
      }
      const projections = typeof tool.resolveModelSpecs === 'function'
        ? tool.resolveModelSpecs(ctx || {})
        : null
      if (projections) {
        for (let j = 0; j < projections.length; j++) {
          append(Object.assign({}, base, projections[j], {
            route: Object.assign({}, projections[j].route || {}, { toolId: refs[i] }),
          }))
        }
      } else {
        append(Object.assign({}, base, {
          schema: ai.tools.schema ? ai.tools.schema(refs[i], ctx) : (tool.schema || null),
        }))
      }
    }
    return out
  }

  function addUnique(list, seen, id) {
    if (!id || seen[id]) return
    seen[id] = true
    list.push(id)
  }

  function requestedSkillIds(input) {
    const out = []
    const seen = {}
    const direct = input && (input.skills || input.meta && input.meta.skills) || []
    for (let i = 0; i < direct.length; i++) addUnique(out, seen, direct[i])
    const content = input && input.content
    if (content && content.type === 'rich-prompt' && ai.richPrompt && ai.richPrompt.skills) {
      const selected = ai.richPrompt.skills(content)
      for (let j = 0; j < selected.length; j++) addUnique(out, seen, selected[j])
    }
    return out
  }

  function requestedSkills(input) {
    const ids = requestedSkillIds(input)
    const out = []
    for (let i = 0; i < ids.length; i++) {
      const skill = ai.skills && ai.skills.get ? ai.skills.get(ids[i]) : null
      if (skill) out.push(skill)
    }
    return out
  }

  function contextReadSkills(agent, input) {
    const messages = ai.compaction && ai.compaction.requestMessages
      ? ai.compaction.requestMessages(agent, input)
      : (agent.messages || [])
    const completed = {}
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]
      if (message.role === 'tool' && message.status !== 'error' && message.meta && message.meta.toolCallId) {
        completed[message.meta.toolCallId] = true
      }
    }
    const out = []
    const seen = {}
    for (let i = 0; i < messages.length; i++) {
      const calls = messages[i].toolCalls || []
      for (let j = 0; j < calls.length; j++) {
        const call = calls[j]
        if (call.toolId !== 'skill.read' || !completed[call.id] || call.args && call.args.resource) continue
        const id = call.args && call.args.id
        const skill = id && ai.skills && ai.skills.get ? ai.skills.get(String(id)) : null
        if (!skill || seen[skill.id]) continue
        seen[skill.id] = true
        out.push(skill)
      }
    }
    return out
  }

  function projectedSkills(agent, input, requested) {
    const out = []
    const seen = {}
    function add(skill) {
      if (!skill || seen[skill.id]) return
      seen[skill.id] = true
      out.push(skill)
    }
    const ids = ai.skills && ai.skills.list ? ai.skills.list() : []
    for (let i = 0; i < ids.length; i++) {
      const skill = ai.skills.get(ids[i])
      if (skill && skill.toolDisclosure === 'always') add(skill)
    }
    for (let i = 0; i < requested.length; i++) add(requested[i])
    const read = contextReadSkills(agent, input)
    for (let i = 0; i < read.length; i++) add(read[i])
    return out
  }

  function compactJson(value, max) {
    let text = ''
    try { text = ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (_) { text = String(value) }
    max = max || 1200
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function compactRuntimeContextValue(value) {
    return compactValue(value, 1200, 4)
  }

  function compactString(value, max) {
    max = max || 4000
    if (ai.serialize && ai.serialize.compactString) return ai.serialize.compactString(value, max)
    const text = String(value == null ? '' : value)
    return text.length > max ? text.slice(0, max) + '\n...[truncated]' : text
  }

  function compactValue(value, maxString, depth) {
    if (value == null) return value
    if (typeof value === 'string') return compactString(value, maxString)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (depth <= 0) return compactJson(value, maxString)
    if (Array.isArray(value)) {
      const out = []
      const n = Math.min(value.length, 24)
      for (let i = 0; i < n; i++) out.push(compactValue(value[i], maxString, depth - 1))
      if (value.length > n) out.push('...[+' + (value.length - n) + ' items]')
      return out
    }
    const out = {}
    const keys = Object.keys(value)
    const n = Math.min(keys.length, 32)
    for (let i = 0; i < n; i++) out[keys[i]] = compactValue(value[keys[i]], maxString, depth - 1)
    if (keys.length > n) out.__truncatedKeys = keys.length - n
    return out
  }

  function compactToolArg(value, key, depth) {
    if (typeof value === 'string') {
      const text = String(value)
      if ((key === 'text' || key === 'content' || key === 'source') && text.length > 1000) {
        return {
          omitted: true,
          originalLength: text.length,
          preview: text.slice(0, 400),
        }
      }
      return compactString(text, 1000)
    }
    if (!value || typeof value !== 'object' || depth <= 0) return compactValue(value, 1000, 1)
    if (Array.isArray(value)) {
      const out = []
      const n = Math.min(value.length, 24)
      for (let i = 0; i < n; i++) out.push(compactToolArg(value[i], '', depth - 1))
      if (value.length > n) out.push('...[+' + (value.length - n) + ' items]')
      return out
    }
    const out = {}
    const keys = Object.keys(value)
    const n = Math.min(keys.length, 32)
    for (let i = 0; i < n; i++) out[keys[i]] = compactToolArg(value[keys[i]], keys[i], depth - 1)
    if (keys.length > n) out.__truncatedKeys = keys.length - n
    return out
  }

  function compactToolCall(call) {
    return {
      id: call.id || call.providerCallId || null,
      toolId: call.toolId || call.name || call.tool || '',
      name: call.name || call.toolId || call.tool || '',
      args: compactToolArg(Object.prototype.hasOwnProperty.call(call, 'args') ? call.args : {}, '', 3),
      status: call.status || '',
      error: call.error ? compactString(call.error, 1000) : null,
    }
  }

  function contextCardMessage(layer, id, priority, content, maxChars) {
    const text = compactString(content, maxChars || 4000)
    return {
      id: 'system-' + id + '-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: text,
      meta: {
        contextLayer: layer,
        contextCardId: id,
        contextPriority: priority || 0,
      },
    }
  }

  function normalizeContextMessage(message, layer, id, priority, maxChars) {
    if (!message) return null
    const out = Object.assign({}, message)
    out.content = compactString(out.content, maxChars || 6000)
    out.meta = Object.assign({}, out.meta || {}, {
      contextLayer: layer,
      contextCardId: id || out.id || layer,
      contextPriority: priority || 0,
    })
    return out
  }

  function toolPrefix(name) {
    const i = String(name || '').indexOf('.')
    return i < 0 ? String(name || '') : String(name).slice(0, i)
  }

  function toolPrefixSummary(toolIds) {
    const seen = {}
    const out = []
    for (let i = 0; i < (toolIds || []).length; i++) {
      const prefix = toolPrefix(toolIds[i])
      if (!prefix || seen[prefix]) continue
      seen[prefix] = true
      out.push(prefix)
    }
    return out.sort()
  }

  function sanitizeAttachmentMeta(meta) {
    const out = Object.assign({}, meta || {})
    if (out.dataUrl) {
      out.hasImageData = true
      delete out.dataUrl
    }
    return out
  }

  function sanitizeAttachmentPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    const out = Object.assign({}, payload)
    if (out.dataUrl) {
      out.hasImageData = true
      delete out.dataUrl
    }
    if (out.meta) out.meta = sanitizeAttachmentMeta(out.meta)
    return out
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

  function messageText(content) {
    if (ai.messageText) return ai.messageText(content)
    if (content == null) return ''
    if (typeof content === 'string') return content
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(content) : JSON.stringify(content) } catch (_) { return String(content) }
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

  function messageCost(message) {
    const text = (message.role || '') + '\n' + messageText(message.content != null ? message.content : message.text)
    let cost = estimateTokens(text) + 8
    const calls = message.toolCalls || []
    for (let i = 0; i < calls.length; i++) cost += estimateTokens(compactJson(compactToolCall(calls[i]), 6000)) + 16
    return cost
  }

  function groupMessages(messages) {
    const groups = []
    let i = 0
    while (i < messages.length) {
      const message = messages[i]
      const group = { index: groups.length, messages: [message] }
      const calls = message.toolCalls || []
      if (calls.length) {
        const sourceId = message.id
        let j = i + 1
        while (j < messages.length) {
          const next = messages[j]
          if (next.role !== 'tool' || !next.meta || next.meta.sourceMessageId !== sourceId) break
          group.messages.push(next)
          j++
        }
        i = j
      } else {
        i++
      }
      groups.push(group)
    }
    return groups
  }

  function groupCost(group) {
    let cost = 0
    for (let i = 0; i < group.messages.length; i++) cost += messageCost(group.messages[i])
    return cost
  }

  function groupHasInput(group, input) {
    if (!input || !input.id) return false
    for (let i = 0; i < group.messages.length; i++) if (group.messages[i].id === input.id) return true
    return false
  }

  function compactMessageForRequest(message, isInput) {
    if (isInput) return message
    const out = Object.assign({}, message)
    if (typeof out.content === 'string') out.content = compactString(out.content, out.role === 'tool' ? 6000 : 16000)
    if (typeof out.reasoning_content === 'string') out.reasoning_content = compactString(out.reasoning_content, 2000)
    if (out.toolCalls && out.toolCalls.length) out.toolCalls = out.toolCalls.map(compactToolCall)
    return out
  }

  function budgetMessages(agent, prefix, messages, input) {
    const limit = Math.max(1024, modelContextLimit(agent))
    const reserve = Math.min(4096, Math.floor(limit * 0.15))
    let remaining = Math.max(512, limit - reserve)
    for (let i = 0; i < prefix.length; i++) remaining -= messageCost(prefix[i])
    const groups = groupMessages(messages)
    const includedGroups = {}
    const selected = []
    for (let i = 0; i < groups.length; i++) {
      if (!groupHasInput(groups[i], input)) continue
      includedGroups[i] = true
      selected.push(groups[i])
      remaining -= groupCost(groups[i])
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      if (includedGroups[i]) continue
      const group = groups[i]
      const cost = groupCost(group)
      if (selected.length && remaining - cost < 0) break
      if (!selected.length || remaining - cost >= 0) {
        selected.push(group)
        remaining -= cost
      }
    }
    selected.sort(function (a, b) { return a.index - b.index })
    const out = []
    for (let i = 0; i < selected.length; i++) {
      const group = selected[i]
      for (let j = 0; j < group.messages.length; j++) {
        const message = group.messages[j]
        out.push(compactMessageForRequest(message, input && message.id === input.id))
      }
    }
    return out
  }

  function attachmentContextMessage(attachmentRefs, resolvedAttachments) {
    if (!attachmentRefs.length && !resolvedAttachments.length) return null
    const items = []
    for (let i = 0; i < attachmentRefs.length; i++) {
      const ref = attachmentRefs[i]
      const resolved = resolvedAttachments[i] == null ? null : sanitizeAttachmentPayload(resolvedAttachments[i])
      items.push({
        id: ref.id || null,
        uri: ref.uri || '',
        kind: ref.kind || ref.resolver || 'attachment',
        title: ref.title || '',
        summary: ref.summary || '',
        meta: sanitizeAttachmentMeta(ref.meta || {}),
        payload: resolved == null ? null : compactJson(resolved, 1400),
      })
    }
    return contextCardMessage(
      'attachments',
      'attachments',
      40,
      'Attached editor context. Use attachment uri/kind/meta to choose precise tools. Large payloads are summarized; call tools for full data.\n' + compactJson(items, 6000),
      7000
    )
  }

  function runtimeContextMessage(runtimeContext) {
    const items = []
    for (let i = 0; runtimeContext && i < runtimeContext.length; i++) {
      const item = runtimeContext[i] || {}
      const value = compactRuntimeContextValue(item.value)
      if (value == null) continue
      items.push({ id: item.id || '', value: value })
    }
    if (!items.length) return null
    return contextCardMessage('context', 'runtime-context', 60, [
      'Current editor runtime context.',
      'Use these bounded host snapshots directly. Read a reference only when the required value is absent.',
      compactJson(items, 6000),
    ].join('\n'), 7000)
  }

  function eventSummary(event) {
    return {
      type: event.type,
      fromAgentId: event.fromAgentId,
      questId: event.questId,
      resultMessageId: event.resultMessageId,
      summary: event.summary,
    }
  }

  function inboxContextMessage(agent, input) {
    const meta = input && input.meta
    if (meta && meta.runtimeEvent === 'inbox.continuation') {
      const events = meta.events || []
      const pending = meta.pendingQuests || []
      return contextCardMessage('inbox', 'inbox', 20, [
          'Completed agent runtime events for the current response.',
          'Process every completed/failed event in this batch.',
          'Use quest.result only for quest ids listed in completedEvents unless the user explicitly asks for broader reads.',
          'Do not wait for pendingQuests. They are non-blocking background and will produce later inbox events.',
          'completedEvents:',
          compactJson(events.map(eventSummary), 4000),
          'pendingQuests:',
          compactJson(pending, 2000),
        ].join('\n'), 7000)
    }
    return null
  }

  function queuedContextMessage(agent, input) {
    const queue = agent.queue || []
    if (!queue.length) return null
    const items = []
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      if (input && input.id && item.messageId === input.id) continue
      const message = ai.readMessage ? ai.readMessage(agent.id, item.messageId) : null
      if (!message) continue
      items.push({
        messageId: item.messageId,
        priority: item.priority || 0,
        interrupt: !!item.interrupt,
        from: message.from || 'user',
        content: messageText(message.content).slice(0, 500),
      })
    }
    if (!items.length) return null
    return contextCardMessage(
      'queue',
      'queue',
      10,
      'Queued user messages are waiting behind the current work. Do not process them as the current request; use them only to avoid conflicting work and to decide whether to finish cleanly.\n' + compactJson(items, 4000),
      5000
    )
  }

  function runtimeGuideMessage(agent) {
    const content = agent.systemPrompt == null ? DEFAULT_SYSTEM_PROMPT : String(agent.systemPrompt)
    if (!content) return null
    return {
      id: 'system-runtime-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: content,
      meta: {
        contextLayer: 'runtime',
        contextCardId: 'runtime',
        contextPriority: 100,
      },
    }
  }

  function skillToolCountLabel(skill, requestCtx) {
    const total = (skill.tools || []).length
    if (!total) return 'instruction only'
    const available = availableSkillTools(skill, requestCtx || {}).length
    return available === total
      ? total + (total === 1 ? ' tool' : ' tools')
      : available + '/' + total + ' tools available'
  }

  function truncatedSkillDescription(value, maxChars) {
    const text = String(value || '').trim().replace(/\s+/g, ' ')
    if (!maxChars) return ''
    if (text.length <= maxChars) return text
    return text.slice(0, Math.max(1, maxChars - 1)).trim() + '…'
  }

  function skillCatalogLine(skill, requestCtx, descriptionChars) {
    const description = truncatedSkillDescription(skill.description, descriptionChars)
    return '- ' + skill.id + (description ? ': ' + description : '') + ' (' + skillToolCountLabel(skill, requestCtx) + ')'
  }

  function skillCatalogText(lines, omitted) {
    const out = [
      'Available Skills. Use skill.read({ id }) to load one Skill\'s instructions and currently available Tool schemas.',
    ].concat(lines)
    if (omitted) out.push(omitted + ' additional Skills omitted; use skill.list and follow nextCursor to enumerate all Skills.')
    return out.join('\n')
  }

  function buildSkillCatalog(agent, requestCtx) {
    if (!ai.skills || !ai.skills.catalog) return null
    const skills = ai.skills.catalog()
    if (!skills.length) return null
    const tokenBudget = Math.max(256, Math.min(
      SKILL_CATALOG_MAX_TOKENS,
      Math.floor(modelContextLimit(agent) * SKILL_CATALOG_CONTEXT_RATIO)
    ))
    const descriptionCaps = [240, 160, 120, 80, 40, 0]
    for (let i = 0; i < descriptionCaps.length; i++) {
      const lines = skills.map(function (skill) {
        return skillCatalogLine(skill, requestCtx, descriptionCaps[i])
      })
      const content = skillCatalogText(lines, 0)
      if (estimateTokens(content) <= tokenBudget) {
        return { content: content, total: skills.length, included: skills.length, omitted: 0 }
      }
    }
    const lines = []
    for (let i = 0; i < skills.length; i++) {
      const next = lines.concat([skillCatalogLine(skills[i], requestCtx, 0)])
      const omitted = skills.length - next.length
      if (estimateTokens(skillCatalogText(next, omitted)) > tokenBudget) break
      lines.push(next[next.length - 1])
    }
    const omitted = skills.length - lines.length
    return {
      content: skillCatalogText(lines, omitted),
      total: skills.length,
      included: lines.length,
      omitted: omitted,
    }
  }

  function skillCatalogMessage(requestCtx) {
    const catalog = requestCtx && requestCtx.skillCatalog
    if (!catalog) return null
    return contextCardMessage(
      'skills',
      'skill-catalog',
      75,
      catalog.content,
      catalog.content.length + 1
    )
  }

  function skillInstructionsMessage(requestCtx) {
    const skills = requestCtx && requestCtx.requestedSkills || []
    if (!skills.length) return null
    return contextCardMessage(
      'skills',
      'skill-instructions',
      76,
      skills.map(function (skill) {
        return skill.title + ' (' + skill.id + ')\n' + skill.instructions
      }).join('\n\n'),
      16000
    )
  }

  function outputSchemaMessage(requestCtx) {
    const schema = requestCtx && requestCtx.outputSchema
    if (!schema) return null
    return {
      id: 'system-output-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: [
        'FINAL_OUTPUT_CONTRACT:',
        'When no tool call remains, return exactly one JSON value matching this schema.',
        'Do not wrap the final JSON in commentary. A single ```json fenced block is accepted but plain JSON is preferred.',
        JSON.stringify(schema),
      ].join('\n'),
      meta: {
        contextLayer: 'runtime',
        contextCardId: 'output-schema',
        contextPriority: 95,
      },
    }
  }

  function workspaceContextMessage(requestCtx, toolIds) {
    const meta = requestCtx && requestCtx.workspaceMeta
    if (!meta) return null
    const tools = {}
    for (let i = 0; i < (toolIds || []).length; i++) tools[toolIds[i]] = true
    if (!Object.keys(tools).some(function (id) { return id.indexOf('workspace.') === 0 || id.indexOf('code.') === 0 || id.indexOf('verify.') === 0 })) return null
    const flow = [
      tools['workspace.fileSummary'] || tools['code.map'] ? '1. Inspect structure with workspace.fileSummary or code.map.' : null,
      tools['workspace.searchFiles'] ? '2. Locate candidates with workspace.searchFiles.' : null,
      tools['workspace.readTextRange'] ? '3. Read exact current ranges with workspace.readTextRange.' : null,
      tools['workspace.editText'] ? '4. Edit existing files with workspace.editText using baseHash and exact oldText/newText.' : null,
      tools['workspace.writeText'] ? '5. Use workspace.writeText for new files or deliberate whole-file replacement.' : null,
      tools['verify.run'] ? '6. Run the narrowest relevant verify.run check after edits.' : null,
    ].filter(Boolean)
    return contextCardMessage('workspace', 'workspace', 80, [
      'Current workspace context.',
      'workspace: ' + compactJson(meta, 600),
      'Use workspace files as the source of truth. Transcript code snippets may be stale.',
      'Recommended file workflow:',
      flow.length ? flow.join('\n') : 'Use the exposed workspace tools in this request.',
    ].join('\n'), 2400)
  }

  function taskStateContextMessage(agent, input, requestCtx, toolIds) {
    const prefixes = toolPrefixSummary(toolIds || [])
    const queue = agent.queue || []
    const quest = input && input.questId && ai.findQuest ? ai.findQuest(agent.id, input.questId) : null
    if (!quest && !(requestCtx && requestCtx.turn) && !queue.length) return null
    return contextCardMessage('task', 'task', 70, [
      'Current task state.',
      'permissionMode: ' + (agent.permissionMode || 'auto'),
      'turn: ' + (requestCtx && requestCtx.turn || 0),
      'inputMessageId: ' + (input && input.id || ''),
      quest ? 'questId: ' + quest.id : '',
      quest && quest.goal ? 'questGoal: ' + quest.goal : '',
      quest && quest.plan && quest.plan.length ? 'questPlan: ' + compactJson(quest.plan.map(function (step) {
        return { id: step.id, title: step.title, status: step.status, kind: step.kind }
      }), 2000) : '',
      'queuedMessages: ' + queue.length,
      'visibleToolCount: ' + (toolIds || []).length,
      'visibleToolPrefixes: ' + prefixes.join(', '),
    ].filter(Boolean).join('\n'), 1800)
  }

  function compactionContextMessages(agent) {
    const messages = ai.compaction && ai.compaction.contextMessages ? ai.compaction.contextMessages(agent) : []
    const out = []
    for (let i = 0; i < messages.length; i++) {
      const layer = messages[i] && String(messages[i].id || '').indexOf('system-memory-') === 0 ? 'memory' : 'compaction'
      out.push(normalizeContextMessage(messages[i], layer, layer, layer === 'memory' ? 35 : 30, layer === 'memory' ? 5000 : 12000))
    }
    return out
  }

  function prefixMessages(agent, input, attachmentRefs, resolvedAttachments, requestCtx, toolIds) {
    const out = []
    const runtimeGuide = runtimeGuideMessage(agent)
    const skillCatalog = skillCatalogMessage(requestCtx)
    const skillInstructions = skillInstructionsMessage(requestCtx)
    const output = outputSchemaMessage(requestCtx)
    const workspace = workspaceContextMessage(requestCtx, toolIds)
    const task = taskStateContextMessage(agent, input, requestCtx, requestCtx && requestCtx.modelToolIds || toolIds)
    const runtimeContext = runtimeContextMessage(requestCtx && requestCtx.runtimeContext)
    const attachments = attachmentContextMessage(attachmentRefs, resolvedAttachments)
    const inbox = inboxContextMessage(agent, input)
    const queued = queuedContextMessage(agent, input)
    if (runtimeGuide) out.push(runtimeGuide)
    if (output) out.push(output)
    if (skillCatalog) out.push(skillCatalog)
    if (skillInstructions) out.push(skillInstructions)
    if (workspace) out.push(workspace)
    if (task) out.push(task)
    if (runtimeContext) out.push(runtimeContext)
    if (attachments) out.push(attachments)
    const compacted = compactionContextMessages(agent)
    for (let i = 0; i < compacted.length; i++) out.push(compacted[i])
    if (inbox) out.push(inbox)
    if (queued) out.push(queued)
    return out
  }

  function requestMessages(agent, input, attachmentRefs, resolvedAttachments, requestCtx, toolIds) {
    const baseMessages = ai.compaction && ai.compaction.requestMessages ? ai.compaction.requestMessages(agent, input) : (agent.messages || [])
    const messages = baseMessages.filter(function (message) {
      return message.status !== 'queued' || (input && message.id === input.id)
    })
    const prefix = prefixMessages(agent, input, attachmentRefs, resolvedAttachments, requestCtx, toolIds)
    return prefix.concat(budgetMessages(agent, prefix, messages, input))
  }

  function planRequest(agent, input, runId, actor, turn) {
    const who = actor || 'user'
    const baseCtx = {
      ai: ai,
      agent: agent,
      actor: who,
      runId: runId,
      input: input || null,
      workspace: ai.currentWorkspace ? ai.currentWorkspace() : null,
      workspaceMeta: ai.workspaceMeta ? ai.workspaceMeta() : null,
      turn: turn || 0,
    }
    baseCtx.tools = ai.tools
    baseCtx.skills = ai.skills
    baseCtx.signal = null
    baseCtx.canReadPath = function (path) { return ai.canReadPath ? ai.canReadPath(agent, path) : false }
    baseCtx.canWritePath = function (path) { return ai.canWritePath ? ai.canWritePath(agent, path) : false }
    baseCtx.canRead = function (targetId, scope) { return ai.canRead ? ai.canRead(who, targetId || agent.id, scope || 'agent.full') : false }
    baseCtx.canSend = function (targetId) { return ai.canSend ? ai.canSend(who, targetId) : false }
    baseCtx.canManage = function (targetId) { return ai.canManage ? ai.canManage(who, targetId) : false }
    const allowedAttachments = ai.canRead(who, agent.id, 'attachments.read')
    const contextRefs = effectiveContextRefs(agent, input)
    const attachmentRefs = allowedAttachments ? describeAttachments(contextRefs, baseCtx) : []
    const connectionName = agent.connection || ai.defaultConnection || 'mock'
    const connectionCapabilities = ai.connectionCapabilities ? ai.connectionCapabilities(connectionName) : {}
    const connectionConfig = ai.getConnectionConfig ? ai.getConnectionConfig(connectionName) : {}
    const stream = !!connectionCapabilities.stream && connectionConfig.stream !== false
    baseCtx.connectionCapabilities = connectionCapabilities
    baseCtx.outputSchema = agent.outputSchema || null
    const requestShell = {
      runId: runId,
      agent: agent,
      actor: who,
      input: input || null,
      target: agent,
      event: input && input.event ? input.event : null,
    }
    baseCtx.runtimeContext = ai.collectContext ? ai.collectContext(requestShell, baseCtx) : []
    baseCtx.requestedSkills = requestedSkills(input)
    baseCtx.skillCatalog = buildSkillCatalog(agent, baseCtx)
    const tools = connectionCapabilities.toolCalling
      ? resolveToolRefs(
          baseCtx,
          projectedSkills(agent, input, baseCtx.requestedSkills),
          !!(baseCtx.skillCatalog && baseCtx.skillCatalog.omitted)
        )
      : []
    baseCtx.toolIds = tools
    const toolSpecs = ai.toolArguments && ai.toolArguments.prepareSpecs
      ? ai.toolArguments.prepareSpecs(resolveTools(baseCtx, tools), connectionCapabilities)
      : resolveTools(baseCtx, tools)
    baseCtx.modelToolIds = toolSpecs.map(function (tool) { return tool.id })
    const messages = requestMessages(agent, input, attachmentRefs, [], baseCtx, tools)
    const contextPack = ai.contextPack && ai.contextPack.fromMessages ? ai.contextPack.fromMessages(messages) : null
    if (ai.trace && ai.trace.append) {
      ai.trace.append({
        type: 'request_built',
        runId: runId,
        traceId: runId,
        agentId: agent.id,
        messageId: input && input.id || null,
        questId: input && input.questId || null,
        phase: 'request',
        status: 'done',
        summary: 'provider request built',
        meta: {
          messageCount: messages.length,
          toolCount: toolSpecs.length,
          gatewayCount: tools.length,
          toolIds: tools.slice(),
          requestedSkills: baseCtx.requestedSkills.map(function (skill) { return skill.id }),
          omittedSkills: baseCtx.skillCatalog && baseCtx.skillCatalog.omitted || 0,
          toolProtocol: connectionCapabilities.toolProtocol || 'none',
          toolArguments: connectionCapabilities.toolArguments || 'none',
          strictToolCount: toolSpecs.filter(function (tool) { return tool.argumentMode === 'strict' }).length,
          bestEffortToolCount: toolSpecs.filter(function (tool) { return tool.argumentMode !== 'strict' }).length,
          stream: stream,
          contextItems: contextPack ? contextPack.items.length : 0,
          contextTokens: contextPack ? contextPack.totalTokenEstimate : 0,
        },
      })
    }
    const request = {
      runId: runId,
      agent: agent,
      actor: who,
      connectionName: connectionName,
      connection: connectionName,
      connectionCapabilities: connectionCapabilities,
      model: agent.model || '',
      input: input || null,
      messages: messages,
      contextPack: contextPack,
      contextRefs: contextRefs.slice(),
      attachmentRefs: attachmentRefs,
      attachments: [],
      resolvedAttachments: [],
      runtimeContext: baseCtx.runtimeContext,
      tools: tools,
      toolSpecs: toolSpecs,
      modelToolIds: baseCtx.modelToolIds.slice(),
      requestedSkills: baseCtx.requestedSkills.map(function (skill) { return skill.id }),
      outputSchema: agent.outputSchema || null,
      stream: stream,
      target: agent,
      event: input && input.event ? input.event : null,
      turn: turn || 0,
      time: Date.now(),
    }
    Object.defineProperty(request, '_assembly', {
      value: { baseCtx: baseCtx, contextRefs: allowedAttachments ? contextRefs.slice() : [], attachmentRefs: attachmentRefs.slice(), toolIds: tools.slice() },
      enumerable: false,
    })
    return request
  }

  function resolveRequest(request, signal) {
    if (request.hydrated || !request._assembly) return Promise.resolve(request)
    const assembly = request._assembly
    return resolveAttachments(assembly.contextRefs, assembly.baseCtx, signal).then(function (resolvedAttachments) {
      const messages = requestMessages(request.agent, request.input, assembly.attachmentRefs, resolvedAttachments, assembly.baseCtx, assembly.toolIds)
      const contextPack = ai.contextPack && ai.contextPack.fromMessages ? ai.contextPack.fromMessages(messages) : null
      const resolved = Object.assign({}, request, {
        messages: messages,
        contextPack: contextPack,
        attachments: resolvedAttachments,
        resolvedAttachments: resolvedAttachments,
        hydrated: true,
      })
      if (ai.trace && ai.trace.append) {
        ai.trace.append({
          type: 'request_resolved',
          runId: request.runId,
          traceId: request.runId,
          agentId: request.agent.id,
          messageId: request.input && request.input.id || null,
          questId: request.input && request.input.questId || null,
          phase: 'request',
          status: 'done',
          summary: 'provider request references hydrated',
          meta: { attachmentCount: resolvedAttachments.length },
        })
      }
      return resolved
    })
  }

  ai.planRequest = planRequest
  ai.resolveRequest = resolveRequest
})(window.aiditor = window.aiditor || {})

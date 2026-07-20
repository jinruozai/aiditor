// aiditor.ai canonical request builder.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

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

  function resolveAttachments(refs, baseCtx) {
    const out = []
    const store = ai.attachments
    const all = store ? store.peek() : []
    for (let i = 0; i < refs.length; i++) {
      const ref = resolveAttachmentRef(refs[i], all)
      if (ai.references && ai.references.read) {
        out.push(ai.references.read(ref, {}, baseCtx))
        continue
      }
      out.push(ref)
    }
    return out
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

  function addToolRefs(value, refs, seen) {
    const tools = value && value.tools || []
    for (let i = 0; i < tools.length; i++) addUnique(refs, seen, tools[i])
    const nested = value && value.refs || []
    for (let j = 0; j < nested.length; j++) addToolRefs(nested[j], refs, seen)
  }

  function resolveToolRefs(agent, ctx, skillSpecs, runtimeContext) {
    const refs = []
    const seen = {}
    const direct = agent.toolRefs || []
    for (let i = 0; i < direct.length; i++) addUnique(refs, seen, direct[i])
    for (let j = 0; j < (skillSpecs || []).length; j++) addToolRefs(skillSpecs[j], refs, seen)
    for (let k = 0; k < (runtimeContext || []).length; k++) addToolRefs(runtimeContext[k] && runtimeContext[k].value, refs, seen)
    return ai.tools.visibleList ? ai.tools.visibleList(refs, ctx, true) : refs
  }

  function resolveTools(agent, ctx, toolRefs) {
    const refs = toolRefs || resolveToolRefs(agent, ctx, [], [])
    const out = []
    for (let i = 0; i < refs.length; i++) {
      const tool = ai.tools.get(refs[i])
      out.push({
        id: refs[i],
        title: tool.title || refs[i],
        description: tool.description || '',
        schema: tool.schema || null,
        permissions: tool.permissions || null,
        capabilities: ai.tools.capabilities ? ai.tools.capabilities(refs[i]) : null,
      })
    }
    return out
  }

  function addUnique(list, seen, id) {
    if (!id || seen[id]) return
    seen[id] = true
    list.push(id)
  }

  function skillPromptLines(skill) {
    const lines = []
    if (skill.systemPrompt) lines.push(skill.title + ': ' + skill.systemPrompt)
    const rules = skill.rules || []
    for (let i = 0; i < rules.length; i++) lines.push('- ' + rules[i])
    return lines
  }

  function addSkillActivation(list, seen, id, reason) {
    if (!id || seen[id]) return
    const skill = ai.skills && ai.skills.get ? ai.skills.get(id) : null
    if (!skill) return
    seen[id] = true
    const meta = ai.skills.meta ? ai.skills.meta(id) : {}
    list.push({
      id: id,
      reason: reason,
      spec: skill,
      owner: meta.owner || null,
      layer: meta.layer || null,
      source: meta.source || null,
      hash: meta.hash || null,
      promptChars: skillPromptLines(skill).join('\n').length,
      toolRefs: (skill.tools || []).slice(),
    })
  }

  function resolveSkillActivations(agent, input, ctx) {
    const activations = []
    const seen = {}
    const configured = agent.skillRefs || []
    for (let i = 0; i < configured.length; i++) addSkillActivation(activations, seen, configured[i], 'configured')
    const needsRuntimeAuthoring = uiAuthoringIntent(input)
    if (ai.skills && ai.skills.get && needsRuntimeAuthoring) {
      addSkillActivation(activations, seen, 'aiditor.runtime-authoring', 'runtime')
    }
    if (ai.skills && ai.skills.list && ai.skills.get) {
      const names = ai.skills.list()
      for (let j = 0; j < names.length; j++) {
        const id = names[j]
        if (seen[id]) continue
        const skill = ai.skills.get(id)
        if (!skill || typeof skill.auto !== 'function') continue
        const matched = aiditor.safeCall
          ? aiditor.safeCall({ scope: 'ai.skill', skill: id, phase: 'auto' }, function () { return skill.auto(ctx || {}) })
          : skill.auto(ctx || {})
        if (matched) addSkillActivation(activations, seen, id, 'auto')
      }
    }
    return activations
  }

  function activationDetails(activations) {
    return activations.map(function (activation) {
      return {
        id: activation.id,
        reason: activation.reason,
        owner: activation.owner,
        layer: activation.layer,
        source: activation.source,
        hash: activation.hash,
        promptChars: activation.promptChars,
        toolRefs: activation.toolRefs.slice(),
      }
    })
  }

  function resolveSkillSpecs(activations) {
    return activations.map(function (activation) {
      return Object.assign({ id: activation.id }, activation.spec)
    })
  }

  function compactJson(value, max) {
    let text = ''
    try { text = ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (_) { text = String(value) }
    max = max || 1200
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function compactContextRef(ref) {
    if (!ref || typeof ref !== 'object') return ref
    const out = {}
    const keys = ['resolver', 'uri', 'kind', 'title', 'summary', 'meta', 'capabilities', 'tools']
    for (let i = 0; i < keys.length; i++) {
      if (ref[keys[i]] != null) out[keys[i]] = ref[keys[i]]
    }
    return out
  }

  function compactRuntimeContextValue(value) {
    if (value == null) return null
    if (Array.isArray(value)) return value.map(compactRuntimeContextValue)
    if (typeof value !== 'object') return value
    const out = compactContextRef(value)
    if (value.selection != null) out.selection = value.selection
    if (value.refs != null) out.refs = value.refs.map(compactContextRef)
    if (Object.keys(out).length) return out
    return { value: compactJson(value, 1200) }
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
      args: compactToolArg(call.args || {}, '', 3),
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

  function toolPrefixSummary(toolRefs) {
    const seen = {}
    const out = []
    for (let i = 0; i < (toolRefs || []).length; i++) {
      const prefix = toolPrefix(toolRefs[i])
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

  function uiAuthoringIntent(input) {
    const text = messageText(input && (input.content != null ? input.content : input.text)).toLowerCase()
    if (!text) return false
    const normalizedAction = /(create|make|build|write|add|modify|change|design|generate|implement|put|mount|\u5199|\u505a|\u521b\u5efa|\u65b0\u5efa|\u8bbe\u8ba1|\u751f\u6210|\u6dfb\u52a0|\u653e\u5230|\u653e\u5728|\u6302\u5230|\u4fee\u6539|\u5b9e\u73b0|\u6784\u5efa)/.test(text)
    const normalizedTarget = /(ui|panel|dock|interface|screen|view|component|\u754c\u9762|\u9762\u677f|\u4e3b\s*dock|\u7ec4\u4ef6|\u89c6\u56fe|\u7a97\u53e3)/.test(text)
    return normalizedAction && normalizedTarget
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
      'Use this to resolve phrases like "current table", "selected rows", "selected nodes", or "active editor".',
      'This is a navigation summary, not full data. Before modifying data, call the relevant tools to read schemas/entities.',
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
          'Current completed agent runtime event batch.',
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

  function skillLines(agent, input, requestCtx) {
    const specs = requestCtx && requestCtx.skillSpecs || resolveSkillSpecs(resolveSkillActivations(agent, input, requestCtx))
    const lines = []
    for (let i = 0; i < specs.length; i++) {
      lines.push.apply(lines, skillPromptLines(specs[i]))
    }
    return lines
  }

  function skillCatalogMessage(requestCtx) {
    const active = requestCtx && requestCtx.skillRefs || []
    if (active.indexOf('orchestration') < 0 || !ai.skills || !ai.skills.list) return null
    const ids = ai.skills.list()
    const items = []
    for (let i = 0; i < ids.length; i++) {
      const skill = ai.skills.get(ids[i])
      if (!skill || ids[i] === 'aiditor.authoring') continue
      items.push({ id: ids[i], title: skill.title || ids[i], description: skill.description || '' })
    }
    if (!items.length) return null
    return contextCardMessage(
      'skills',
      'skill-catalog',
      75,
      'Available skill profiles for newly delegated agents. Pass only the skill ids needed by the child. Full skill instructions and tools load only when active.\n' + compactJson(items, 3600),
      4000
    )
  }

  function runtimeGuideMessage(agent, requestCtx) {
    const lines = [
      'You are an AIditor AI agent running inside an editor runtime.',
      'Complete the current request with the capabilities exposed in this request; never claim an action that was not performed.',
      'Current runtime state and available tools override older transcript claims about capabilities.',
      'Stop with a clear result when complete, or report the exact blocker when required state, permission, or user input is missing.',
      'Do not retry an equivalent failed tool call under guessed names.',
      'Invoke tools only through the provider tool-calling interface. Never print or imitate XML tool-call markup such as <invoke> in assistant text.',
      'CURRENT_AGENT_ID: ' + (agent.id || ''),
      'CURRENT_AGENT_NAME: ' + (agent.name || ''),
      'CURRENT_PARENT_AGENT_ID: ' + (agent.parentAgentId || ''),
    ]
    if (requestCtx && requestCtx.uiAuthoringBlocked) {
      lines.push('CURRENT_REQUEST_BLOCKED: Workspace-backed UI authoring requires the user to open or select a workspace.')
    }
    if (agent.systemPrompt) lines.push('AGENT_SYSTEM_PROMPT:\n' + agent.systemPrompt)
    if (!requestCtx || !(requestCtx.toolRefs || []).length) {
      lines.push('AVAILABLE_TOOLS: none. Report that the required capability is unavailable instead of imitating a tool call.')
    }
    const skills = skillLines(agent, requestCtx && requestCtx.input, requestCtx)
    if (skills.length) lines.push('ACTIVE_SKILLS:\n' + skills.join('\n'))
    return {
      id: 'system-runtime-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: lines.join('\n'),
      meta: {
        contextLayer: 'runtime',
        contextCardId: 'runtime',
        contextPriority: 100,
      },
    }
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

  function workspaceContextMessage(requestCtx, toolRefs) {
    const meta = requestCtx && requestCtx.workspaceMeta
    if (!meta) return null
    const tools = {}
    for (let i = 0; i < (toolRefs || []).length; i++) tools[toolRefs[i]] = true
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

  function taskStateContextMessage(agent, input, requestCtx, toolRefs) {
    const prefixes = toolPrefixSummary(toolRefs || [])
    const queue = agent.queue || []
    const quest = input && input.questId && ai.findQuest ? ai.findQuest(agent.id, input.questId) : null
    if (!quest && !(requestCtx && requestCtx.turn) && !queue.length && !(requestCtx && requestCtx.uiAuthoringBlocked)) return null
    return contextCardMessage('task', 'task', 70, [
      'Current task state.',
      'permissionMode: ' + (agent.permissionMode || 'default'),
      'turn: ' + (requestCtx && requestCtx.turn || 0),
      'inputMessageId: ' + (input && input.id || ''),
      quest ? 'questId: ' + quest.id : '',
      quest && quest.goal ? 'questGoal: ' + quest.goal : '',
      quest && quest.plan && quest.plan.length ? 'questPlan: ' + compactJson(quest.plan.map(function (step) {
        return { id: step.id, title: step.title, status: step.status, kind: step.kind }
      }), 2000) : '',
      'queuedMessages: ' + queue.length,
      'visibleToolCount: ' + (toolRefs || []).length,
      'visibleToolPrefixes: ' + prefixes.join(', '),
      requestCtx && requestCtx.uiAuthoringBlocked ? 'blocked: workspace-backed UI authoring is unavailable until the user opens or selects a workspace.' : '',
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

  function prefixMessages(agent, input, attachmentRefs, resolvedAttachments, requestCtx, toolRefs) {
    const out = [runtimeGuideMessage(agent, requestCtx)]
    const output = outputSchemaMessage(requestCtx)
    const workspace = workspaceContextMessage(requestCtx, toolRefs)
    const task = taskStateContextMessage(agent, input, requestCtx, toolRefs)
    const skills = skillCatalogMessage(requestCtx)
    const runtimeContext = runtimeContextMessage(requestCtx && requestCtx.runtimeContext)
    const attachments = attachmentContextMessage(attachmentRefs, resolvedAttachments)
    const inbox = inboxContextMessage(agent, input)
    const queued = queuedContextMessage(agent, input)
    if (output) out.push(output)
    if (workspace) out.push(workspace)
    if (task) out.push(task)
    if (skills) out.push(skills)
    if (runtimeContext) out.push(runtimeContext)
    if (attachments) out.push(attachments)
    const compacted = compactionContextMessages(agent)
    for (let i = 0; i < compacted.length; i++) out.push(compacted[i])
    if (inbox) out.push(inbox)
    if (queued) out.push(queued)
    return out
  }

  function requestMessages(agent, input, attachmentRefs, resolvedAttachments, requestCtx, toolRefs) {
    const baseMessages = ai.compaction && ai.compaction.requestMessages ? ai.compaction.requestMessages(agent, input) : (agent.messages || [])
    const messages = baseMessages.filter(function (message) {
      return message.status !== 'queued' || (input && message.id === input.id)
    })
    const prefix = prefixMessages(agent, input, attachmentRefs, resolvedAttachments, requestCtx, toolRefs)
    return prefix.concat(budgetMessages(agent, prefix, messages, input))
  }

  function makeRequest(agent, input, runId, actor, turn) {
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
    baseCtx.uiAuthoringIntent = uiAuthoringIntent(input)
    baseCtx.uiAuthoringBlocked = !baseCtx.workspace && uiAuthoringIntent(input)
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
    const resolvedAttachments = allowedAttachments ? resolveAttachments(contextRefs, baseCtx) : []
    const attachmentRefs = allowedAttachments ? describeAttachments(contextRefs, baseCtx) : []
    const skillActivationRecords = resolveSkillActivations(agent, input, baseCtx)
    const skillRefs = skillActivationRecords.map(function (activation) { return activation.id })
    const skillSpecs = resolveSkillSpecs(skillActivationRecords)
    const skillActivations = activationDetails(skillActivationRecords)
    const connectionName = agent.connection || ai.defaultConnection || 'mock'
    const connectionCapabilities = ai.connectionCapabilities ? ai.connectionCapabilities(connectionName) : {}
    baseCtx.skillRefs = skillRefs
    baseCtx.skillSpecs = skillSpecs
    baseCtx.skillActivations = skillActivations
    baseCtx.connectionCapabilities = connectionCapabilities
    baseCtx.outputSchema = agent.outputSchema || null
    const initialTools = connectionCapabilities.toolCalling ? resolveToolRefs(agent, baseCtx, skillSpecs, []) : []
    const requestShell = {
      runId: runId,
      agent: agent,
      actor: who,
      input: input || null,
      target: agent,
      event: input && input.event ? input.event : null,
      tools: initialTools,
      toolSpecs: resolveTools(agent, baseCtx, initialTools),
    }
    baseCtx.runtimeContext = ai.collectContext ? ai.collectContext(requestShell, baseCtx) : []
    const tools = connectionCapabilities.toolCalling ? resolveToolRefs(agent, baseCtx, skillSpecs, baseCtx.runtimeContext) : []
    baseCtx.toolRefs = tools
    const toolSpecs = resolveTools(agent, baseCtx, tools)
    const messages = requestMessages(agent, input, attachmentRefs, resolvedAttachments, baseCtx, tools)
    const contextPack = ai.contextPack && ai.contextPack.fromMessages ? ai.contextPack.fromMessages(messages) : null
    if (ai.trace && ai.trace.append) {
      for (let i = 0; i < skillActivations.length; i++) {
        const activation = skillActivations[i]
        ai.trace.append({
          type: 'skill_activated',
          runId: runId,
          traceId: runId,
          agentId: agent.id,
          messageId: input && input.id || null,
          questId: input && input.questId || null,
          phase: 'request',
          entry: activation.id,
          status: 'active',
          summary: activation.reason + ' skill: ' + activation.id,
          meta: activation,
        })
      }
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
          toolCount: tools.length,
          toolRefs: tools.slice(),
          skillRefs: skillRefs.slice(),
          skillPromptChars: skillActivations.reduce(function (total, item) { return total + item.promptChars }, 0),
          toolProtocol: connectionCapabilities.toolProtocol || 'none',
          contextItems: contextPack ? contextPack.items.length : 0,
          contextTokens: contextPack ? contextPack.totalTokenEstimate : 0,
        },
      })
    }
    return {
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
      attachments: resolvedAttachments,
      resolvedAttachments: resolvedAttachments,
      runtimeContext: baseCtx.runtimeContext,
      tools: tools,
      toolSpecs: toolSpecs,
      skills: skillRefs,
      skillSpecs: skillSpecs,
      skillActivations: skillActivations,
      outputSchema: agent.outputSchema || null,
      stream: !!agent.stream,
      target: agent,
      event: input && input.event ? input.event : null,
      turn: turn || 0,
      time: Date.now(),
    }
  }

  ai.makeRequest = makeRequest
})(window.aiditor = window.aiditor || {})

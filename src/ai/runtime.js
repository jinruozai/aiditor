// aiditor.ai agent runtime.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const runs = {}
  const waitingRuns = {}
  const budgetTimers = {}
  const runtimeConfig = {
    maxConcurrentAgents: 8,
    maxConcurrentMessagesPerAgent: 1,
    maxDelegationDepth: 4,
    limits: {
      maxTurns: 32,
      timeoutMs: 600000,
      maxTokens: null,
    },
  }
  const STREAM_UI_UPDATE_MS = 200
  const RUN_PREVIEW_UPDATE_MS = 80
  const RUN_PREVIEW_CHARS = 140
  const MAX_STREAM_CONTENT_CHARS = 1000000
  const MAX_REASONING_CHARS = 65536
  let nextRunId = 1
  let nextProviderToolCallId = 1

  function normalizeProviderMessage(result, request) {
    if (typeof result === 'string') return { role: 'assistant', content: result }
    if (result && result.message) return result.message
    return Object.assign({ role: 'assistant', content: '' }, result || {}, {
      connection: request.connectionName,
      model: request.agent.model || null,
    })
  }

  function isIterable(value) {
    return value && (typeof value[Symbol.asyncIterator] === 'function' || typeof value[Symbol.iterator] === 'function')
  }

  function toAsyncIterable(value) {
    if (value && typeof value[Symbol.asyncIterator] === 'function') return value
    return (async function* () {
      const iterator = value[Symbol.iterator]()
      let next = iterator.next()
      while (!next.done) {
        yield next.value
        next = iterator.next()
      }
    })()
  }

  function deltaContent(delta) {
    if (delta == null) return ''
    if (typeof delta === 'string') return delta
    if (delta.delta != null) return deltaContent(delta.delta)
    if (delta.text != null) return String(delta.text)
    if (delta.content != null) return String(delta.content)
    if (delta.message && delta.message.content != null) return String(delta.message.content)
    if (delta.choices && delta.choices[0] && delta.choices[0].delta) return deltaContent(delta.choices[0].delta)
    return ''
  }

  function deltaToolCalls(delta) {
    return (delta && (delta.toolCalls || delta.tool_calls)) || []
  }

  function deltaReasoningContent(delta) {
    if (!delta) return ''
    if (delta.reasoning_content != null) return String(delta.reasoning_content)
    if (delta.reasoningContent != null) return String(delta.reasoningContent)
    if (delta.delta != null) return deltaReasoningContent(delta.delta)
    if (delta.choices && delta.choices[0] && delta.choices[0].delta) return deltaReasoningContent(delta.choices[0].delta)
    return ''
  }

  function deltaFinishReason(delta) {
    if (!delta) return ''
    if (delta.finishReason != null) return String(delta.finishReason)
    if (delta.finish_reason != null) return String(delta.finish_reason)
    if (delta.stopReason != null) return String(delta.stopReason)
    if (delta.stop_reason != null) return String(delta.stop_reason)
    if (delta.delta != null) return deltaFinishReason(delta.delta)
    if (delta.choices && delta.choices[0]) return String(delta.choices[0].finish_reason || delta.choices[0].finishReason || '')
    return ''
  }

  function normalizeToolCalls(calls, actor) {
    const request = actor && actor.toolSpecs ? actor : null
    const who = request ? request.actor : actor
    const allowed = requestToolMap(request)
    return (calls || []).map(function (call) {
      if (!call.toolId && !call.tool && (call.function || call.arguments != null) && ai.normalizeOpenAiToolCalls) {
        call = ai.normalizeOpenAiToolCalls([call], request || {})[0]
      }
      const id = call.id || call.providerCallId || ('tc_provider_' + Date.now().toString(36) + '_' + nextProviderToolCallId++)
      const toolId = call.toolId || call.name || call.tool || ''
      const denied = allowed && !allowed[toolId]
      return Object.assign({}, call, {
        id: id,
        toolId: toolId,
        name: call.name || call.toolId || call.tool || '',
        args: call.args || {},
        status: denied ? 'failed' : (call.status || 'proposed'),
        error: denied ? ('Tool was not available in this request: ' + toolId) : call.error,
        actor: call.actor || who || 'user',
        createdAt: call.createdAt || Date.now(),
        updatedAt: call.updatedAt || Date.now(),
      })
    })
  }

  function requestToolMap(request) {
    if (!request) return null
    const map = {}
    const specs = request.toolSpecs || []
    const refs = request.tools || []
    for (let i = 0; i < specs.length; i++) map[specs[i].id] = true
    for (let j = 0; j < refs.length; j++) map[refs[j]] = true
    return map
  }

  function mergeToolCallDeltas(existing, deltas) {
    const out = existing.slice()
    for (let i = 0; i < (deltas || []).length; i++) {
      const delta = deltas[i]
      const index = delta.index != null ? delta.index : findToolCallIndex(out, delta)
      const at = index >= 0 ? index : out.length
      const cur = out[at] || {}
      const next = Object.assign({}, cur)
      if (delta.id) next.id = delta.id
      if (delta.type) next.type = delta.type
      if (delta.toolId) next.toolId = delta.toolId
      if (delta.name) next.name = delta.name
      if (delta.args) next.args = Object.assign({}, next.args || {}, delta.args)
      if (delta.arguments != null) next.arguments = String(next.arguments || '') + String(delta.arguments)
      if (delta.function) {
        const fn = Object.assign({}, next.function || {})
        if (delta.function.name) fn.name = delta.function.name
        if (delta.function.arguments != null) fn.arguments = String(fn.arguments || '') + String(delta.function.arguments)
        next.function = fn
      }
      out[at] = next
    }
    return out
  }

  function findToolCallIndex(calls, delta) {
    if (delta.id) {
      for (let i = 0; i < calls.length; i++) if (calls[i].id === delta.id) return i
    }
    return -1
  }

  function appendCapped(target, key, text, max, label) {
    if (!text) return
    const current = target[key] || ''
    if (current.length + text.length > max) {
      const keep = Math.max(0, max - current.length)
      target[key] = current + String(text).slice(0, keep)
      throw new Error('AI ' + label + ' exceeded ' + max + ' characters; stopped to protect the editor.')
    }
    target[key] = current + text
  }

  function normalizePreviewText(text) {
    return String(text || '').replace(/\s+/g, ' ')
  }

  function safeJson(value) {
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (_) { return String(value) }
  }

  function pushPreviewTail(state, text) {
    const clean = normalizePreviewText(text)
    if (!clean) return
    state.previewTail = String((state.previewTail || '') + clean).slice(-RUN_PREVIEW_CHARS)
    state.previewUpdatedAt = Date.now()
  }

  function pushModelTail(state, text) {
    if (!text) return
    state.modelTail = String((state.modelTail || '') + String(text)).slice(-RUN_PREVIEW_CHARS)
    state.previewUpdatedAt = Date.now()
  }

  function toolCallName(call) {
    return call && (call.toolId || call.name || call.tool || (call.function && call.function.name)) || 'tool'
  }

  function toolCallDeltaText(calls) {
    let out = ''
    for (let i = 0; i < (calls || []).length; i++) {
      const call = calls[i]
      if (!call) continue
      if (call.toolId) out += String(call.toolId)
      if (call.name) out += String(call.name)
      if (call.tool) out += String(call.tool)
      if (call.function && call.function.name) out += String(call.function.name)
      if (call.arguments != null) out += String(call.arguments)
      if (call.function && call.function.arguments != null) out += String(call.function.arguments)
      if (call.args && Object.keys(call.args).length) out += safeJson(call.args)
    }
    return out
  }

  function toolCallFullText(calls) {
    let out = ''
    for (let i = 0; i < (calls || []).length; i++) {
      const input = toolCallInput(calls[i])
      out += toolCallName(calls[i])
      if (input) out += input
    }
    return out
  }

  function toolCallInput(call) {
    if (!call) return ''
    if (call.function && call.function.arguments != null) return String(call.function.arguments)
    if (call.arguments != null) return String(call.arguments)
    if (call.args && Object.keys(call.args).length) return safeJson(call.args)
    return ''
  }

  function toolInputTail(input) {
    return normalizePreviewText(input).slice(-RUN_PREVIEW_CHARS)
  }

  function toolActivityText(calls) {
    const seen = {}
    const names = []
    let input = ''
    for (let i = 0; i < (calls || []).length; i++) {
      const name = toolCallName(calls[i])
      if (seen[name]) continue
      seen[name] = true
      names.push(name)
      input = toolCallInput(calls[i]) || input
    }
    return names.length ? 'tool: ' + names.join(', ') + (input ? ' · ' + toolInputTail(input) : '') : 'tool call'
  }

  function trace(spec) {
    return ai.trace && ai.trace.append ? ai.trace.append(spec) : null
  }

  function toolTraceBase(agentId, call) {
    const found = ai.findToolCall ? ai.findToolCall(agentId, call.id) : null
    const message = found && found.message || null
    const runId = message && message.meta && message.meta.runId || null
    return {
      runId: runId,
      traceId: runId,
      agentId: agentId,
      messageId: call.messageId || message && message.id || null,
      questId: message && message.resultForQuestId || null,
      entry: call.toolId,
    }
  }

  function publishToolActivity(agentId, call, label) {
    const input = toolCallInput(call)
    ai.setActiveRunState(agentId, {
      state: 'tool',
      activityText: label + ' ' + toolCallName(call) + (input ? ' · ' + toolInputTail(input) : ''),
      previewUpdatedAt: Date.now(),
    })
  }

  function usageNumber(usage, keys) {
    if (!usage) return 0
    for (let i = 0; i < keys.length; i++) {
      const v = Number(usage[keys[i]])
      if (v > 0) return v
    }
    return 0
  }

  function positiveLimit(value) {
    const number = Number(value)
    return number > 0 && Number.isFinite(number) ? Math.floor(number) : null
  }

  function clampLimit(value, ceiling) {
    const requested = positiveLimit(value)
    const maximum = positiveLimit(ceiling)
    if (requested && maximum) return Math.min(requested, maximum)
    return requested || maximum || null
  }

  function effectiveRunBudget(budget) {
    const requested = budget || {}
    const limits = runtimeConfig.limits || {}
    return {
      maxTurns: clampLimit(requested.maxTurns, limits.maxTurns),
      timeoutMs: clampLimit(requested.timeoutMs, limits.timeoutMs),
      maxTokens: clampLimit(requested.maxTokens, limits.maxTokens),
    }
  }

  function emptyUsage() {
    return { promptTokens: 0, outputTokens: 0, totalTokens: 0, reported: false }
  }

  function normalizedUsage(usage) {
    if (!usage) return null
    const promptTokens = usageNumber(usage, ['prompt_tokens', 'input_tokens', 'promptTokens', 'inputTokens'])
    const outputTokens = usageNumber(usage, ['completion_tokens', 'output_tokens', 'completionTokens', 'outputTokens'])
    const totalTokens = usageNumber(usage, ['total_tokens', 'totalTokens']) || (promptTokens || outputTokens ? promptTokens + outputTokens : 0)
    if (!promptTokens && !outputTokens && !totalTokens) return null
    return { promptTokens: promptTokens, outputTokens: outputTokens, totalTokens: totalTokens, reported: true }
  }

  function recordRunUsage(agentId, request, usage) {
    const current = normalizedUsage(usage)
    if (!current) return null
    const run = runs[agentId]
    const total = run && run.usage || emptyUsage()
    const next = {
      promptTokens: total.promptTokens + current.promptTokens,
      outputTokens: total.outputTokens + current.outputTokens,
      totalTokens: total.totalTokens + current.totalTokens,
      reported: true,
    }
    if (run) run.usage = next
    const input = request && request.input || (run && run.request && run.request.input)
    if (input && input.questId) ai.updateQuest(agentId, input.questId, { usage: next })
    return next
  }

  function streamOutputTokens(state) {
    const usage = state.usage
    const out = usageNumber(usage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'])
    if (out) return out
    return Math.ceil(String(state.content || '').length / 4)
  }

  function streamTotalTokens(state) {
    return usageNumber(state.usage, ['total_tokens', 'totalTokens'])
  }

  function publishRunState(agentId, state, request, runState, force) {
    const now = Date.now()
    if (!force && state.lastRunPreviewAt && now - state.lastRunPreviewAt < RUN_PREVIEW_UPDATE_MS) return
    state.lastRunPreviewAt = now
    const patch = {
      runId: request.runId,
      messageId: state.messageId || null,
      state: runState || state.runState || 'connecting',
      turn: request.turn || 0,
      startedAt: state.startTime || null,
      firstTokenAt: state.firstTokenAt || null,
      completedAt: state.completedAt || null,
      usage: state.usage || null,
      outputTokens: streamOutputTokens(state),
      totalTokens: streamTotalTokens(state),
      cost: state.cost || null,
      error: state.error || null,
    }
    if (Object.prototype.hasOwnProperty.call(state, 'previewTail')) patch.previewTail = state.previewTail || ''
    if (Object.prototype.hasOwnProperty.call(state, 'modelTail')) patch.modelTail = state.modelTail || ''
    if (Object.prototype.hasOwnProperty.call(state, 'activityText')) patch.activityText = state.activityText || ''
    if (Object.prototype.hasOwnProperty.call(state, 'previewUpdatedAt')) patch.previewUpdatedAt = state.previewUpdatedAt || null
    ai.setActiveRunState(agentId, patch)
  }

  function shouldPublishStreamState(state, force) {
    const now = Date.now()
    if (force || !state.lastUiUpdateAt || now - state.lastUiUpdateAt >= STREAM_UI_UPDATE_MS) {
      state.lastUiUpdateAt = now
      return true
    }
    return false
  }

  function publishStreamState(agentId, messageId, state, request) {
    return ai.updateMessage(agentId, messageId, {
      content: state.content,
      connection: state.connection || request.connectionName,
      model: state.model || request.agent.model || null,
      status: 'running',
    })
  }

  function applyDelta(agentId, messageId, state, delta, request) {
    const text = deltaContent(delta)
    const reasoning = deltaReasoningContent(delta)
    const calls = deltaToolCalls(delta)
    const finishReason = deltaFinishReason(delta)
    if (reasoning) {
      appendCapped(state, 'reasoning_content', reasoning, MAX_REASONING_CHARS, 'reasoning')
      pushModelTail(state, reasoning)
      if (!text) state.runState = 'thinking'
    }
    if (text) {
      if (!state.firstTokenAt) state.firstTokenAt = Date.now()
      appendCapped(state, 'content', text, MAX_STREAM_CONTENT_CHARS, 'response')
      pushPreviewTail(state, text)
      pushModelTail(state, text)
      state.runState = 'receiving'
    }
    if (calls.length) {
      pushModelTail(state, toolCallDeltaText(calls))
      state.toolCalls = mergeToolCallDeltas(state.toolCalls, calls)
      state.activityText = toolActivityText(state.toolCalls)
      state.previewUpdatedAt = Date.now()
      state.runState = 'tool'
    }
    if (delta && delta.connection) state.connection = delta.connection
    if (delta && delta.model) state.model = delta.model
    if (delta && delta.usage) state.usage = delta.usage
    if (finishReason) state.finishReason = finishReason
    publishRunState(agentId, state, request, state.runState || 'connecting', (!!text && !state.publishedFirstPreview) || (!!calls.length && !state.publishedFirstTool))
    if (text) state.publishedFirstPreview = true
    if (calls.length) state.publishedFirstTool = true
    return shouldPublishStreamState(state, !!(delta && delta.usage)) ? publishStreamState(agentId, messageId, state, request) : ai.readMessage(agentId, messageId)
  }

  function finishStreamingMessage(agentId, messageId, state, result, request) {
    const message = normalizeProviderMessage(result || {}, request)
    const storedMessage = ai.readMessage(agentId, messageId)
    let content = message.content != null && (message.content !== '' || !state.content) ? message.content : state.content
    const reasoning = message.reasoning_content != null ? message.reasoning_content : (message.reasoningContent != null ? message.reasoningContent : state.reasoning_content)
    const toolCalls = normalizeToolCalls(message.toolCalls || state.toolCalls, request)
    const output = structuredOutput(content, toolCalls, request)
    const actionNote = content && hasActionBoundary(toolCalls) ? content : null
    if (actionNote) content = ''
    if (!state.previewTail && content) pushPreviewTail(state, content)
    if (!state.modelTail) pushModelTail(state, (content || '') + toolCallFullText(toolCalls))
    const completedAt = Date.now()
    const usage = message.usage || (result && result.usage) || state.usage || null
    const finishReason = resultFinishReason(message) || resultFinishReason(result) || state.finishReason || null
    const finishCategory = classifyFinishReason(finishReason)
    const cost = ai.estimateUsageCost ? ai.estimateUsageCost(request.connectionName, message.model || state.model || request.agent.model, usage) : null
    state.usage = usage
    recordRunUsage(agentId, request, usage)
    state.cost = cost
    state.completedAt = completedAt
    const firstTokenAt = state.firstTokenAt || null
    const toolCallsWithSource = toolCalls.map(function (call) {
      return Object.assign({}, call, { messageId: messageId })
    })
    const patch = Object.assign({}, message, {
      content: content,
      reasoning_content: reasoning || null,
      toolCalls: toolCallsWithSource,
      connection: message.connection || state.connection || request.connectionName,
      model: message.model || state.model || request.agent.model || null,
      status: message.status || 'done',
      stats: {
        runId: request.runId,
        startTime: state.startTime,
        firstTokenAt: firstTokenAt,
        completedAt: completedAt,
        durationMs: completedAt - state.startTime,
        ttftMs: firstTokenAt ? firstTokenAt - state.startTime : null,
        generationMs: firstTokenAt ? completedAt - firstTokenAt : completedAt - state.startTime,
        usage: usage,
        cost: cost,
      },
    })
    if (request.outputSchema && !toolCalls.length) patch.output = output
    const messageMeta = Object.assign({}, storedMessage && storedMessage.meta || {}, message.meta || {}, {
      runId: request.runId,
      responseId: storedMessage && storedMessage.meta && storedMessage.meta.responseId ||
        (request.input && request.input.meta && request.input.meta.responseId) ||
        (request.input && request.input.id) || request.runId,
    })
    if (finishReason) {
      messageMeta.finishReason = finishReason
      messageMeta.finishCategory = finishCategory
    }
    if (actionNote) {
      messageMeta.actionNote = actionNote
    }
    if (Object.keys(messageMeta).length) patch.meta = messageMeta
    const updated = ai.updateMessage(agentId, messageId, patch)
    publishRunState(agentId, state, request, toolCalls.length ? 'tool' : 'idle', true)
    return updated
  }

  function structuredOutput(content, toolCalls, request) {
    if (!request.outputSchema || toolCalls.length) return null
    try {
      const output = ai.schema.parse(content, request.outputSchema)
      trace({
        type: 'output_validated',
        runId: request.runId,
        traceId: request.runId,
        agentId: request.agent && request.agent.id || null,
        phase: 'output',
        status: 'completed',
        summary: 'structured output validated',
      })
      return output
    } catch (err) {
      err.providerContent = content || ''
      throw err
    }
  }

  function resultFinishReason(result) {
    const message = result && result.message || result
    return String(
      (message && (message.finishReason || message.finish_reason || message.stopReason || message.stop_reason)) ||
      (result && (result.finishReason || result.finish_reason || result.stopReason || result.stop_reason)) ||
      ''
    )
  }

  function classifyFinishReason(reason) {
    const r = String(reason || '').toLowerCase()
    if (!r || r === 'stop' || r === 'end_turn' || r === 'stop_sequence' || r === 'complete' || r === 'completed') return 'complete'
    if (r === 'tool_calls' || r === 'tool_use' || r === 'function_call') return 'tool'
    if (r === 'length' || r === 'max_tokens' || r === 'max_output_tokens' || r === 'max_completion_tokens') return 'truncated'
    if (r === 'content_filter' || r === 'content_filter_length' || r === 'blocked' || r === 'safety') return 'blocked'
    if (r === 'insufficient_system_resource' || r === 'interrupted' || r === 'cancelled' || r === 'canceled' || r === 'provider_error') return 'interrupted'
    return 'unknown'
  }

  function providerCompletionError(code, reason, message, content) {
    const err = new Error(message)
    err.code = code
    err.reason = reason || null
    err.providerContent = content || ''
    return err
  }

  function providerToolCalls(state, result) {
    const message = result && result.message || result || {}
    return message.toolCalls || message.tool_calls || state.toolCalls || []
  }

  function providerContent(state, result) {
    const message = result && result.message || result || {}
    const content = message.content != null ? message.content : state.content
    return ai.messageText ? ai.messageText(content) : String(content || '')
  }

  function hasToolInvocationMarkup(text, request) {
    const source = String(text || '')
    if (/<invoke\b[^>]*\bname\s*=/i.test(source) || /<\/?(?:tool_call|function_call)\b/i.test(source)) return true
    const tags = source.match(/<\/?([a-zA-Z][a-zA-Z0-9_.-]*)\b/g) || []
    if (!tags.length) return false
    const names = {}
    const specs = request && request.toolSpecs || []
    const aliases = ai.toolAliasMap ? ai.toolAliasMap(request).byId : {}
    for (let i = 0; i < specs.length; i++) {
      const id = String(specs[i].id || '')
      const parts = id.split('.')
      names[id.replace(/[^a-zA-Z0-9_-]/g, '_')] = true
      names[parts.slice().reverse().join('_')] = true
      if (aliases[id]) names[aliases[id]] = true
    }
    for (let j = 0; j < tags.length; j++) {
      const name = tags[j].replace(/^<\/?/, '').split(/\s|>/)[0]
      if (names[name]) return true
    }
    return false
  }

  function completedStreamResult(state, result, request) {
    const message = result && result.message || result || {}
    const completed = Object.assign({}, message, {
      role: message.role || 'assistant',
      content: state.content,
      reasoning_content: state.reasoning_content || message.reasoning_content || null,
      toolCalls: state.toolCalls && state.toolCalls.length ? state.toolCalls : (message.toolCalls || []),
      usage: state.usage || message.usage || result && result.usage || null,
      finishReason: state.finishReason || resultFinishReason(message) || resultFinishReason(result) || null,
    })
    delete completed.deltas
    delete completed.message
    const protocol = request.connectionCapabilities && request.connectionCapabilities.toolProtocol || 'none'
    return protocol === 'text' && ai.decodeTextToolResponse ? ai.decodeTextToolResponse(completed) : completed
  }

  function assertProviderCompleted(state, result, request) {
    const reason = resultFinishReason(result) || state.finishReason || ''
    const category = classifyFinishReason(reason)
    const calls = providerToolCalls(state, result)
    const content = providerContent(state, result)
    if (category === 'tool' && !calls.length) {
      throw providerCompletionError('TOOL_PROTOCOL_INVALID', reason, 'Provider reported a tool-call stop without returning structured tool calls.', content)
    }
    if (category === 'truncated') {
      throw providerCompletionError('PROVIDER_OUTPUT_TRUNCATED', reason, 'Provider stopped because the output token limit was reached. The partial response was not executed; retry with a smaller change or patch the file in smaller pieces.', content)
    }
    if (category === 'blocked') {
      throw providerCompletionError('PROVIDER_CONTENT_BLOCKED', reason, 'Provider blocked the response before it completed.', content)
    }
    if (category === 'interrupted') {
      throw providerCompletionError('PROVIDER_INTERRUPTED', reason, 'Provider stopped before the response completed: ' + reason, content)
    }
    const protocol = request && request.connectionCapabilities && request.connectionCapabilities.toolProtocol || 'none'
    if (protocol !== 'none' && !calls.length && hasToolInvocationMarkup(content, request)) {
      throw providerCompletionError('TOOL_PROTOCOL_INVALID', reason, 'The model printed tool-call markup as text instead of returning a structured tool call. No tool was executed.', content)
    }
    if (category === 'unknown' && reason) {
      trace({
        type: 'provider_finish_unknown',
        runId: request.runId,
        traceId: request.runId,
        agentId: request.agent && request.agent.id || null,
        messageId: state.messageId || null,
        phase: 'provider',
        status: 'unknown',
        summary: reason,
        meta: { finishReason: reason },
      })
    }
    return { category: category, reason: reason || null }
  }

  function consumeDeltas(agentId, messageId, state, source, request, controller) {
    return (async function () {
      for await (const delta of toAsyncIterable(source)) {
        if (controller.signal.aborted) return null
        applyDelta(agentId, messageId, state, delta, request)
      }
      publishStreamState(agentId, messageId, state, request)
      return null
    })()
  }

  function toolResultContent(value) {
    if (value == null) return ''
    if (typeof value === 'string') return value
    return safeJson(value)
  }

  function appendToolResult(agentId, call, result, status) {
    const found = ai.findToolCall ? ai.findToolCall(agentId, call.id) : null
    const sourceMessageId = call.messageId || (found && found.message && found.message.id) || null
    const message = {
      from: 'tool:' + call.toolId,
      role: 'tool',
      content: toolResultContent(result),
      status: status || 'done',
      meta: {
        toolCallId: call.id,
        toolId: call.toolId,
        sourceMessageId: sourceMessageId,
      },
    }
    const after = sourceMessageId ? toolResultInsertAfter(agentId, sourceMessageId) : null
    return after && ai.insertMessageAfter ? ai.insertMessageAfter(agentId, after, message) : ai.appendMessage(agentId, message)
  }

  function failedToolPayload(call) {
    if (!call) return { ok: false, error: 'Tool failed' }
    if (call.errorDetails && typeof call.errorDetails === 'object') return call.errorDetails
    if (call.applyResult && typeof call.applyResult === 'object') return call.applyResult
    if (call.result && typeof call.result === 'object') return call.result
    if (call.preview && typeof call.preview === 'object') return call.preview
    const message = String(call.error || 'Tool failed')
    return { ok: false, error: message, message: message, toolId: call.toolId || call.name || '' }
  }

  function toolResultInsertAfter(agentId, sourceMessageId) {
    const agent = ai.findAgent(agentId)
    const messages = agent && agent.messages || []
    let after = null
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].id === sourceMessageId) {
        after = messages[i].id
        continue
      }
      if (after && messages[i].role === 'tool' && messages[i].meta && messages[i].meta.sourceMessageId === sourceMessageId) {
        after = messages[i].id
        continue
      }
      if (after) break
    }
    return after
  }

  function hasToolResult(agent, callId) {
    const messages = agent && agent.messages || []
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'tool' && messages[i].meta && messages[i].meta.toolCallId === callId) return true
    }
    return false
  }

  function appendResolvedToolResults(agentId, message) {
    const agent = ai.findAgent(agentId)
    const calls = message && message.toolCalls || []
    const state = { appended: 0, pending: 0 }
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      if (call.status !== 'applied' && call.status !== 'completed' && call.status !== 'rejected' && call.status !== 'failed') {
        state.pending++
        continue
      }
      if (hasToolResult(agent, call.id)) continue
      if (call.status === 'applied') {
        appendToolResult(agentId, call, call.applyResult || { applied: true }, 'done')
        state.appended++
      } else if (call.status === 'completed') {
        appendToolResult(agentId, call, call.result, 'done')
        state.appended++
      } else if (call.status === 'rejected') {
        appendToolResult(agentId, call, { rejected: true, reason: call.error || 'Rejected' }, 'error')
        state.appended++
      } else if (call.status === 'failed') {
        appendToolResult(agentId, call, failedToolPayload(call), 'error')
        state.appended++
      }
    }
    return state
  }

  function isTerminalToolStatus(status) {
    return status === 'applied' || status === 'completed' || status === 'rejected' || status === 'failed'
  }

  function terminalToolResult(call) {
    if (call.status === 'applied') return call.applyResult || { applied: true }
    if (call.status === 'completed') return call.result
    if (call.status === 'rejected') return { rejected: true, reason: call.error || 'Rejected' }
    return failedToolPayload(call)
  }

  function flushToolResults(agentId, messageId) {
    const agent = ai.findAgent(agentId)
    const state = { appended: 0, pending: 0 }
    const messages = agent && agent.messages || []
    for (let i = 0; i < messages.length; i++) {
      if (messageId && messages[i].id !== messageId) continue
      const next = appendResolvedToolResults(agentId, messages[i])
      state.appended += next.appended
      state.pending += next.pending
    }
    return state
  }

  function closeStaleToolCalls(agentId, reason) {
    const agent = ai.findAgent(agentId)
    if (!agent) return { closed: 0 }
    let closed = 0
    ai.updateAgent(agentId, {
      messages: agent.messages.map(function (message) {
        const calls = message.toolCalls || []
        if (!calls.length) return message
        let changed = false
        const nextCalls = calls.map(function (call) {
          if (call.status === 'applied' || call.status === 'completed' || call.status === 'rejected' || call.status === 'failed') return call
          changed = true
          closed++
          return Object.assign({}, call, {
            status: 'failed',
            error: reason || 'Tool call was not completed before the next request.',
            updatedAt: Date.now(),
          })
        })
        return changed ? Object.assign({}, message, { toolCalls: nextCalls }) : message
      }),
    })
    if (closed) flushToolResults(agentId)
    return { closed: closed }
  }

  function executeToolCalls(agentId, message, actor) {
    const calls = message.toolCalls || []
    if (!calls.length) return Promise.resolve({ count: 0, waiting: false })
    const jobs = []
    let waiting = false
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      if (isTerminalToolStatus(call.status)) {
        if (!hasToolResult(ai.findAgent(agentId), call.id)) {
          appendToolResult(agentId, call, terminalToolResult(call), call.status === 'failed' ? 'error' : 'done')
        }
        continue
      }
      let job = null
      try {
        job = Promise.resolve(executeOneToolCall(agentId, call, actor))
      } catch (err) {
        job = Promise.reject(err)
      }
      jobs.push(job.catch(function (err) {
        appendToolResult(agentId, call, { error: String(err && err.message || err) }, 'error')
        if (aiditor.reportError) aiditor.reportError({ scope: 'ai', tool: call.toolId || call.name || 'tool' }, err)
        return { waiting: false, error: err }
      }).then(function (state) {
        if (state && state.waiting) waiting = true
        return state
      }))
    }
    return Promise.all(jobs).then(function () {
      return { count: calls.length, waiting: waiting }
    })
  }

  function hasDelegationBoundary(calls) {
    calls = calls || []
    for (let i = 0; i < calls.length; i++) {
      const id = calls[i] && (calls[i].toolId || calls[i].name)
      if (id === 'agent.delegate' || id === 'agent.send') return true
    }
    return false
  }

  function hasActionBoundary(calls) {
    calls = calls || []
    for (let i = 0; i < calls.length; i++) {
      const id = calls[i] && (calls[i].toolId || calls[i].name)
      if (id === 'agent.delegate' || id === 'agent.send') return true
      if (id === 'agent.create' || id === 'agent.configure' || id === 'agent.reparent' || id === 'agent.delete' || id === 'agent.stop') return true
      if (id === 'quest.cancel') return true
    }
    return false
  }

  function shouldAutoApplyTool(agent, call, state) {
    if (!agent) return false
    const id = call && (call.toolId || call.name || '')
    if (ai.isToolAlwaysAllowed && ai.isToolAlwaysAllowed(agent.id, id)) return !!(state && state.canApply)
    const risk = call && call.preview && call.preview.risk || call && call.result && call.result.risk || ''
    if (risk === 'destructive' || risk === 'external') return false
    return agent.permissionMode === 'full' && !!(state && state.canApply)
  }

  function prepareApprovalTool(agentId, call, actor, tool) {
    let state = ai.getToolCallActionState ? ai.getToolCallActionState(agentId, call.id, actor) : null
    if (state && state.canPreview) {
      const preview = ai.previewToolCall(agentId, call.id, actor)
      if (preview && preview.promise) return preview.promise.then(function () { return { done: true } })
      return Promise.resolve({ done: true })
    }
    if (state && state.canApprove) {
      ai.approveToolCall(agentId, call.id, actor)
      state = ai.getToolCallActionState ? ai.getToolCallActionState(agentId, call.id, actor) : null
    }
    if (state && state.canRun) {
      const run = ai.runToolCall(agentId, call.id, actor)
      if (run && run.promise) return run.promise.then(function () { return { done: true } })
    }
    return Promise.resolve({ done: !!(tool.preview || tool.run) })
  }

  function applyPreparedApprovalTool(agentId, call, actor) {
    const applied = ai.applyToolCall(agentId, call.id, actor)
    if (applied && applied.promise) {
      return applied.promise.then(function (done) {
        appendToolResult(agentId, call, done && done.status === 'failed' ? failedToolPayload(done) : done && (done.applyResult || done), done && done.status === 'failed' ? 'error' : 'done')
        return { waiting: false }
      })
    }
    appendToolResult(agentId, call, applied && applied.status === 'failed' ? failedToolPayload(applied) : applied && (applied.applyResult || applied), applied && applied.status === 'failed' ? 'error' : 'done')
    return Promise.resolve({ waiting: false })
  }

  function isWaitingForUser(state) {
    return !!(state && (state.canPreview || state.canApply || state.canApprove || state.canRun || state.canReject))
  }

  function executeOneToolCall(agentId, call, actor) {
    const tool = ai.tools.get(call.toolId)
    if (!tool) {
      trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_missing', status: 'failed', summary: 'tool not found' }))
      appendToolResult(agentId, call, { error: 'Tool not found: ' + call.toolId }, 'error')
      return Promise.resolve({ waiting: false })
    }
    trace(Object.assign(toolTraceBase(agentId, call), {
      type: 'tool_started',
      status: 'running',
      summary: toolCallName(call),
      meta: { hasPreview: !!tool.preview, hasRun: !!tool.run, hasApply: !!tool.apply },
    }))
    publishToolActivity(agentId, call, 'preparing')
    if (tool.apply) {
      publishToolActivity(agentId, call, tool.preview ? 'previewing' : 'preparing')
      return prepareApprovalTool(agentId, call, actor, tool).then(function () {
        const current = ai.findToolCall ? ai.findToolCall(agentId, call.id) : null
        const prepared = current && current.toolCall || call
        const state = ai.getToolCallActionState ? ai.getToolCallActionState(agentId, call.id, actor) : null
        if (prepared.status === 'failed' || prepared.status === 'rejected') {
          trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: prepared.status, summary: prepared.error || prepared.status }))
          appendToolResult(agentId, call, prepared.status === 'failed' ? failedToolPayload(prepared) : { rejected: true, reason: prepared.error || 'Rejected' }, prepared.status === 'failed' ? 'error' : 'done')
          return { waiting: false }
        }
        if (shouldAutoApplyTool(ai.findAgent(agentId), prepared, state)) {
          publishToolActivity(agentId, call, 'applying')
          return applyPreparedApprovalTool(agentId, call, actor).then(function (result) {
            trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: 'applied', summary: toolCallName(call) }))
            return result
          })
        }
        if (isWaitingForUser(state)) {
          trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_waiting_approval', status: 'waiting_approval', summary: toolCallName(call) }))
          return { waiting: true }
        }
        trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: 'failed', summary: 'not actionable' }))
        appendToolResult(agentId, call, { error: 'Tool call was not allowed or did not produce an actionable preview: ' + call.toolId }, 'error')
        return { waiting: false }
      })
    }
    const approved = ai.approveToolCall(agentId, call.id, actor)
    publishToolActivity(agentId, call, 'running')
    const run = approved && ai.runToolCall(agentId, call.id, actor)
    if (!run || !run.promise) {
      appendToolResult(agentId, call, { error: 'Tool call was not allowed: ' + call.toolId }, 'error')
      return Promise.resolve({ waiting: false })
    }
    return run.promise.then(function (done) {
      appendToolResult(agentId, call, done && done.status === 'failed' ? failedToolPayload(done) : done && (done.result || done), done && done.status === 'failed' ? 'error' : 'done')
      trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: done && done.status === 'failed' ? 'failed' : 'completed', summary: toolCallName(call) }))
      return { waiting: false }
    })
  }

  function runChatTurn(agentId, provider, request, ctx, controller, actor) {
    const inputMessage = request.input && request.input.id ? request.input : null
    const responseId = inputMessage && inputMessage.meta && inputMessage.meta.responseId || (inputMessage && inputMessage.id) || request.runId
    const assistant = ai.appendMessage(agentId, {
      from: 'agent:' + agentId,
      role: 'assistant',
      content: '',
      connection: request.connectionName,
      model: request.agent.model || null,
      status: 'running',
      resultForQuestId: inputMessage && inputMessage.questId || null,
      contextRefs: [],
      meta: { runId: request.runId, responseId: responseId },
    })
    if (runs[agentId]) runs[agentId].messageId = assistant.id
    const state = {
      messageId: assistant.id,
      content: '',
      toolCalls: [],
      connection: request.connectionName,
      model: request.agent.model || null,
      startTime: Date.now(),
      reasoning_content: '',
      previewTail: '',
      previewUpdatedAt: null,
      runState: 'connecting',
    }
    publishRunState(agentId, state, request, 'connecting', true)
    trace({
      type: 'assistant_message_started',
      runId: request.runId,
      traceId: request.runId,
      agentId: agentId,
      messageId: assistant.id,
      questId: inputMessage && inputMessage.questId || null,
      phase: 'model',
      status: 'running',
      summary: 'assistant response started',
    })
    function failTurn(err) {
      if (controller.signal.aborted) return null
      const completedAt = Date.now()
      const currentMessage = ai.readMessage(agentId, assistant.id) || assistant
      ai.updateMessage(agentId, assistant.id, {
        content: err && err.providerContent || currentMessage.content || '',
        status: 'error',
        meta: Object.assign({}, currentMessage.meta || {}, {
          error: String(err && err.message ? err.message : err),
          errorCode: err && err.code || null,
          finishReason: err && err.reason || state.finishReason || null,
        }),
        stats: {
          runId: request.runId,
          startTime: state.startTime,
          completedAt: completedAt,
          durationMs: completedAt - state.startTime,
        },
      })
      state.completedAt = completedAt
      state.error = String(err && err.message ? err.message : err)
      publishRunState(agentId, state, request, 'error', true)
      trace({ type: 'run_failed', runId: request.runId, traceId: request.runId, agentId: agentId, messageId: assistant.id, questId: inputMessage && inputMessage.questId || null, status: 'failed', summary: state.error, meta: { code: err && err.code || null, finishReason: err && err.reason || state.finishReason || null } })
      throw err
    }
    return Promise.resolve().then(function () {
      request.stream = request.stream || !!provider.stream
      trace({
        type: 'provider_request_started',
        runId: request.runId,
        traceId: request.runId,
        agentId: agentId,
        messageId: assistant.id,
        questId: inputMessage && inputMessage.questId || null,
        entry: request.connectionName,
        phase: 'provider',
        status: 'running',
        summary: request.connectionName + ' / ' + (request.agent.model || request.model || ''),
        meta: {
          messageCount: request.messages ? request.messages.length : 0,
          toolCount: request.tools ? request.tools.length : 0,
          toolProtocol: request.connectionCapabilities && request.connectionCapabilities.toolProtocol || 'none',
        },
      })
      return provider.stream ? provider.stream(request, ctx) : provider.send(request, ctx)
    }).then(function (result) {
      if (controller.signal.aborted) return null
      if (isIterable(result)) {
        return consumeDeltas(agentId, assistant.id, state, result, request, controller).then(function () {
          if (controller.signal.aborted) return null
          const completed = completedStreamResult(state, null, request)
          assertProviderCompleted(state, completed, request)
          const done = finishStreamingMessage(agentId, assistant.id, state, completed, request)
          return continueAfterTools(agentId, provider, done, done, request, controller, actor)
        })
      }
      if (result && result.deltas && isIterable(result.deltas)) {
        return consumeDeltas(agentId, assistant.id, state, result.deltas, request, controller).then(function () {
          if (controller.signal.aborted) return null
          const completed = completedStreamResult(state, result, request)
          assertProviderCompleted(state, completed, request)
          const done = finishStreamingMessage(agentId, assistant.id, state, completed, request)
          return continueAfterTools(agentId, provider, done, result, request, controller, actor)
        })
      }
      assertProviderCompleted(state, result, request)
      const done = finishStreamingMessage(agentId, assistant.id, state, result, request)
      return continueAfterTools(agentId, provider, done, result, request, controller, actor)
    }).catch(failTurn)
  }

  function continueAfterTools(agentId, provider, message, result, request, controller, actor) {
    const calls = message.toolCalls || []
    if (!calls.length) return message
    return executeToolCalls(agentId, message, actor).then(function (state) {
      if (controller.signal.aborted || !state.count) return message
      const current = ai.findAgent(agentId)
      if (!current || state.waiting) {
        trace({ type: 'run_waiting_approval', runId: request.runId, traceId: request.runId, agentId: agentId, messageId: message.id, questId: request.input && request.input.questId || null, status: 'waiting_approval', summary: 'waiting for tool approval' })
        publishRunState(agentId, {
          messageId: message.id,
          content: message.content || '',
          startTime: request.startTime || (message.stats && message.stats.startTime) || Date.now(),
          firstTokenAt: message.stats && message.stats.firstTokenAt || null,
          usage: message.usage || (message.stats && message.stats.usage) || null,
          cost: message.stats && message.stats.cost || null,
        }, request, 'waiting_approval', true)
        waitingRuns[agentId] = {
          request: request,
          actor: actor,
          runId: request.runId,
          turn: request.turn || 0,
          messageId: message.id,
          usage: runs[agentId] && runs[agentId].usage || emptyUsage(),
        }
        ai.setAgentStatus(agentId, {
          status: 'waiting_approval',
          statusText: 'waiting for tool approval',
          activeMessageId: request.input && request.input.id || null,
          activeQuestId: request.input && request.input.questId || null,
        })
        return message
      }
      const budgetReason = runBudgetStopReason(agentId, request)
      if (budgetReason) {
        flushToolResults(agentId, message.id)
        stopRun(agentId, 'idle', budgetReason)
        return message
      }
      if (hasDelegationBoundary(calls)) {
        enqueuePostDelegationContinuation(agentId, request, ai.readMessage(agentId, message.id) || message)
        return message
      }
      if (ai.compaction && ai.compaction.maybeCompact) ai.compaction.maybeCompact(agentId, null, { phase: 'before_tool_continuation' })
      const nextRequest = makeRequest(ai.findAgent(agentId) || current, null, request.runId, actor, (request.turn || 0) + 1)
      nextRequest.input = request.input
      nextRequest.budget = request.budget
      nextRequest.startedAt = request.startedAt
      const nextCtx = ai.createRunContext(nextRequest, controller)
      return runChatTurn(agentId, provider, nextRequest, nextCtx, controller, actor)
    })
  }

  function runBudgetStopReason(agentId, request) {
    const budget = request && request.budget || effectiveRunBudget()
    const run = runs[agentId]
    return consumedBudgetStopReason(budget, (request.turn || 0) + 1, run && run.usage)
  }

  function consumedBudgetStopReason(budget, turns, usage) {
    if (budget.maxTurns && turns >= budget.maxTurns) return 'max_turns'
    if (budget.maxTokens && usage && usage.reported && usage.totalTokens >= budget.maxTokens) return 'max_tokens'
    return null
  }

  function makeRequest(agent, input, runId, actor, turn) {
    const request = ai.makeRequest(agent, input, runId, actor, turn)
    const quest = input && input.questId && ai.findQuest ? ai.findQuest(agent.id, input.questId) : null
    request.budget = quest && quest.budget || effectiveRunBudget()
    request.startedAt = quest && quest.startedAt || Date.now()
    return request
  }

  function providerRunner() {
    return {
      send: function (request, runCtx) { return ai.sendViaConnection(request.connectionName, request, runCtx) },
    }
  }

  function clearBudgetTimer(agentId) {
    if (!budgetTimers[agentId]) return
    clearTimeout(budgetTimers[agentId])
    delete budgetTimers[agentId]
  }

  function stopSummary(reason) {
    if (reason === 'timeout') return 'Stopped: execution timeout reached'
    if (reason === 'max_turns') return 'Stopped: model turn limit reached'
    if (reason === 'max_tokens') return 'Stopped: token budget reached'
    return 'Stopped'
  }

  function stopQuestExecution(agentId, input, reason, usage) {
    if (!input || !input.questId) return null
    const current = ai.findQuest(agentId, input.questId)
    if (!current || current.status === 'completed' || current.status === 'failed' || current.status === 'stopped') return current
    const quest = ai.updateQuest(agentId, input.questId, {
      status: 'stopped',
      stopReason: reason || 'cancelled',
      usage: usage && usage.reported ? usage : (current.usage || null),
      completedAt: Date.now(),
      summary: stopSummary(reason),
    })
    if (quest && quest.fromAgentId) {
      ai.appendInboxEvent(quest.fromAgentId, {
        type: 'quest.stopped',
        fromAgentId: agentId,
        questId: quest.id,
        summary: quest.summary,
        meta: {
          stopReason: quest.stopReason,
          responseId: quest.meta && quest.meta.sourceResponseId || null,
        },
      })
      scheduleAgent(quest.fromAgentId)
    }
    return quest
  }

  function armBudgetTimer(agentId, request) {
    clearBudgetTimer(agentId)
    const timeoutMs = request && request.budget && request.budget.timeoutMs
    if (!timeoutMs) return
    const remaining = Math.max(0, timeoutMs - (Date.now() - request.startedAt))
    budgetTimers[agentId] = setTimeout(function () {
      delete budgetTimers[agentId]
      stopRun(agentId, 'idle', 'timeout')
      scheduleQueuedAgents()
    }, remaining)
  }

  function failRunningRequest(agentId, request, controller, key, err) {
    clearBudgetTimer(agentId)
    delete runs[key]
    const input = request.input
    const stopped = controller.signal.aborted
    if (input && input.id) ai.updateMessage(agentId, input.id, { status: stopped ? 'stopped' : 'failed', completedAt: Date.now() })
    if (input && input.questId && !stopped) {
      const quest = ai.updateQuest(agentId, input.questId, {
        status: 'failed',
        completedAt: Date.now(),
        summary: String(err && err.message ? err.message : err),
      })
      if (quest && quest.fromAgentId) {
        ai.appendInboxEvent(quest.fromAgentId, {
          type: 'quest.failed',
          fromAgentId: agentId,
          questId: quest.id,
          summary: quest.summary,
          meta: { responseId: quest.meta && quest.meta.sourceResponseId || null },
        })
        scheduleAgent(quest.fromAgentId)
      }
    }
    ai.setAgentStatus(agentId, stopped ? 'idle' : 'failed')
    if (!stopped && aiditor.reportError) aiditor.reportError({ scope: 'ai', connection: request.connectionName }, err)
    scheduleQueuedAgents()
    return null
  }

  function startRunningRequest(agentId, request, actor, statusText, markInputStarted) {
    const controller = new AbortController()
    const runner = providerRunner()
    const ctx = ai.createRunContext(request, controller)
    const key = agentId
    const input = request.input
    const quest = input && input.questId && ai.findQuest ? ai.findQuest(agentId, input.questId) : null
    request.startedAt = quest && quest.startedAt || request.startedAt || Date.now()
    runs[key] = {
      controller: controller,
      connection: runner,
      runId: request.runId,
      request: request,
      usage: request.accumulatedUsage || (quest && quest.usage) || emptyUsage(),
    }
    ai.setAgentStatus(agentId, {
      status: 'running',
      statusText: statusText || '',
      activeMessageId: input && input.id || null,
      activeQuestId: input && input.questId || null,
    })
    trace({
      type: 'run_started',
      runId: request.runId,
      traceId: request.runId,
      agentId: agentId,
      messageId: input && input.id || null,
      questId: input && input.questId || null,
      parentAgentId: request.agent && request.agent.parentAgentId || null,
      phase: 'run',
      status: 'running',
      summary: statusText || 'agent run started',
    })
    if (markInputStarted && input && input.id) ai.updateMessage(agentId, input.id, { status: 'running', startedAt: Date.now() })
    if (markInputStarted && input && input.questId) {
      request.startedAt = Date.now()
      ai.updateQuest(agentId, input.questId, { status: 'running', startedAt: request.startedAt, stopReason: null })
    }
    armBudgetTimer(agentId, request)

    const promise = Promise.resolve().then(function () {
      return runChatTurn(agentId, runner, request, ctx, controller, actor)
    }).then(function (result) {
      if (controller.signal.aborted) return null
      return finishAgentRun(agentId, request, result, key, controller)
    }, function (err) {
      return failRunningRequest(agentId, request, controller, key, err)
    })
    return { request: request, controller: controller, promise: promise }
  }

  function completeMessageExecution(agentId, request, result) {
    const input = request && request.input
    if (!input || !input.id) return
    const failed = result && result.status === 'error'
    ai.updateMessage(agentId, input.id, {
      status: failed ? 'failed' : 'done',
      completedAt: Date.now(),
    })
    if (!input.questId) return
    const questPatch = failed
      ? { status: 'failed', completedAt: Date.now(), summary: 'Quest failed' }
      : {
        status: 'completed',
        resultMessageId: result && result.id || null,
        completedAt: Date.now(),
        summary: result && typeof result.content === 'string' ? result.content.slice(0, 240) : '',
      }
    const quest = ai.updateQuest(agentId, input.questId, questPatch)
    if (quest && quest.fromAgentId) {
      ai.appendInboxEvent(quest.fromAgentId, {
        type: failed ? 'quest.failed' : 'quest.completed',
        fromAgentId: agentId,
        questId: quest.id,
        resultMessageId: quest.resultMessageId || null,
        summary: quest.summary || '',
        meta: { responseId: quest.meta && quest.meta.sourceResponseId || null },
      })
      scheduleAgent(quest.fromAgentId)
    }
  }

  function finishAgentRun(agentId, request, result, key, controller) {
    delete runs[key]
    const current = ai.findAgent(agentId)
    if (current && current.status === 'waiting_approval') return result
    clearBudgetTimer(agentId)
    completeMessageExecution(agentId, request, result)
    trace({
      type: 'run_completed',
      runId: request.runId,
      traceId: request.runId,
      agentId: agentId,
      messageId: result && result.id || null,
      questId: request.input && request.input.questId || null,
      phase: 'run',
      status: result && result.status === 'error' ? 'failed' : 'completed',
      summary: result && typeof result.content === 'string' ? result.content.slice(0, 240) : '',
    })
    const agent = ai.findAgent(agentId)
    if (agent && agent.queue && agent.queue.length) {
      ai.setAgentStatus(agentId, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
      scheduleAgent(agentId)
    } else if (agent && hasActionableInbox(agent)) {
      enqueueInboxContinuation(agent)
      ai.setAgentStatus(agentId, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
      scheduleAgent(agentId)
    } else {
      ai.setAgentStatus(agentId, { status: 'idle', statusText: '', activeMessageId: null, activeQuestId: null })
    }
    scheduleQueuedAgents()
    return result
  }

  function hasActionableInbox(agent) {
    const inbox = agent && agent.inbox || []
    for (let i = 0; i < inbox.length; i++) if (!inbox[i].consumed) return true
    return false
  }

  function summarizeDelegationCalls(message) {
    const calls = message && message.toolCalls || []
    const out = []
    for (let i = 0; i < calls.length; i++) {
      const id = calls[i] && (calls[i].toolId || calls[i].name)
      if (id !== 'agent.delegate' && id !== 'agent.send') continue
      const result = calls[i].applyResult || calls[i].result || {}
      out.push({
        toolId: id,
        agentId: result.agentId || (calls[i].args && calls[i].args.agentId) || null,
        questId: result.questId || null,
        messageId: result.messageId || null,
        status: result.status || calls[i].status || '',
      })
    }
    return out
  }

  function enqueuePostDelegationContinuation(agentId, request, message) {
    const input = request && request.input
    if (input && input.meta && input.meta.runtimeEvent === 'post-delegation.continuation') return null
    const delegated = summarizeDelegationCalls(message)
    if (!delegated.length) return null
    const content = [
      'Continue after delegated tasks were dispatched.',
      'Delegated quests:',
      JSON.stringify(delegated),
      'Continue only useful local work that does not depend on those child results.',
      'Do not call quest.result for these delegated quests until a completion inbox event reports they are ready.',
      'If no independent local work remains, briefly state that delegated work is running and stop this turn.',
    ].join('\n')
    return queueMessage(agentId, {
      from: 'system',
      role: 'user',
      content: content,
      meta: {
        runtimeEvent: 'post-delegation.continuation',
        sourceMessageId: message && message.id || null,
        responseId: message && message.meta && message.meta.responseId || null,
        delegated: delegated,
      },
      priority: 10,
      schedule: false,
    })
  }

  function enqueueInboxContinuation(agent) {
    const events = (agent.inbox || []).filter(function (event) { return !event.consumed })
    if (!events.length) return null
    events.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) })
    const selected = events.slice()
    for (let i = 0; i < selected.length; i++) ai.markInboxEventConsumed(agent.id, selected[i].id)
    const pending = pendingQuestsForEvents(agent.id, selected)
    const content = 'Process this completed agent runtime event batch:\n' + JSON.stringify(selected.map(function (event) {
      return {
        type: event.type,
        fromAgentId: event.fromAgentId,
        questId: event.questId,
        resultMessageId: event.resultMessageId,
        summary: event.summary,
      }
    })) + '\nPending related quests, if any, are non-blocking background:\n' + JSON.stringify(pending)
    let responseId = null
    for (let i = 0; i < selected.length; i++) {
      const eventResponseId = selected[i].meta && selected[i].meta.responseId || null
      if (!eventResponseId || (responseId && responseId !== eventResponseId)) {
        responseId = null
        break
      }
      responseId = eventResponseId
    }
    return queueMessage(agent.id, {
      from: 'system',
      role: 'user',
      content: content,
      meta: { runtimeEvent: 'inbox.continuation', responseId: responseId, events: selected, pendingQuests: pending },
      schedule: false,
    })
  }

  function pendingQuestsForEvents(agentId, events) {
    const seen = {}
    const out = []
    const agents = ai.agents ? ai.agents.peek() : []
    const sourceIds = {}
    for (let i = 0; i < events.length; i++) if (events[i].fromAgentId) sourceIds[events[i].fromAgentId] = true
    for (let a = 0; a < agents.length; a++) {
      const list = agents[a].quests || []
      for (let j = 0; j < list.length; j++) {
        const quest = list[j]
        if (quest.fromAgentId !== agentId) continue
        if (quest.status === 'completed' || quest.status === 'failed' || quest.status === 'stopped') continue
        if (sourceIds[agents[a].id]) continue
        const key = agents[a].id + '/' + quest.id
        if (seen[key]) continue
        seen[key] = true
        out.push({
          agentId: agents[a].id,
          questId: quest.id,
          status: quest.status,
          summary: quest.summary || '',
        })
      }
    }
    return out
  }

  function runAgent(agentId, input) {
    let agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    const connection = ai.getConnection(agent && agent.connection)
    if (!agent || !connection) return null
    const runId = 'run_' + Date.now().toString(36) + '_' + nextRunId++
    const actor = (input && input.actor) || agent.id
    closeStaleToolCalls(agent.id)
    if (ai.compaction && ai.compaction.maybeCompact) ai.compaction.maybeCompact(agent.id, input, { phase: 'before_request' })
    agent = ai.findAgent(agent.id)
    const request = makeRequest(agent, input, runId, actor, 0)
    return startRunningRequest(agent.id, request, actor, input && input.content ? String(input.content).slice(0, 120) : '', true)
  }

  function activeRunCount() {
    return Object.keys(runs).length
  }

  function canStartRun(agentId) {
    if (runs[agentId]) return false
    return activeRunCount() < runtimeConfig.maxConcurrentAgents
  }

  function stopRun(agentId, status, reason) {
    const agent = ai.findAgent(agentId)
    if (!agent) return false
    const run = runs[agent.id]
    const waiting = waitingRuns[agent.id]
    if (!run && !waiting) return false
    const stopReason = reason || 'cancelled'
    clearBudgetTimer(agent.id)
    if (run) {
      run.controller.__aiditorStopReason = stopReason
      run.controller.abort()
      ai.setActiveRunState(agent.id, {
        runId: run.runId,
        messageId: run.messageId || null,
        state: 'stopped',
        completedAt: Date.now(),
      })
      if (run.messageId) ai.updateMessage(agent.id, run.messageId, { status: 'stopped' })
      const input = run.request && run.request.input
      if (input && input.id) ai.updateMessage(agent.id, input.id, { status: 'stopped', completedAt: Date.now() })
      stopQuestExecution(agent.id, input, stopReason, run.usage)
      trace({ type: 'run_stopped', runId: run.runId, traceId: run.runId, agentId: agent.id, messageId: run.messageId || null, questId: input && input.questId || null, status: 'stopped', summary: stopSummary(stopReason), meta: { stopReason: stopReason } })
      if (run.connection && run.connection.abort) {
        if (aiditor.safeCall) aiditor.safeCall({ scope: 'ai', connection: agent.connection || ai.defaultConnection, runId: run.runId }, function () { run.connection.abort(run.runId) })
        else run.connection.abort(run.runId)
      }
      delete runs[agent.id]
    }
    if (waiting) {
      ai.setActiveRunState(agent.id, {
        runId: waiting.runId,
        messageId: waiting.messageId || null,
        state: 'stopped',
        completedAt: Date.now(),
      })
      const input = waiting.request && waiting.request.input
      if (input && input.id) ai.updateMessage(agent.id, input.id, { status: 'stopped', completedAt: Date.now() })
      stopQuestExecution(agent.id, input, stopReason, waiting.usage)
      trace({ type: 'run_stopped', runId: waiting.runId, traceId: waiting.runId, agentId: agent.id, messageId: waiting.messageId || null, questId: input && input.questId || null, status: 'stopped', summary: stopSummary(stopReason), meta: { stopReason: stopReason } })
      delete waitingRuns[agent.id]
    }
    ai.setAgentStatus(agent.id, status || 'idle')
    return true
  }

  function resumeAgent(agentId, actor) {
    const agent = ai.findAgent(agentId)
    const waiting = agent && waitingRuns[agent.id]
    if (!agent || !waiting || runs[agent.id]) return null
    if (!canStartRun(agent.id)) return null
    const message = ai.readMessage(agent.id, waiting.messageId)
    const toolState = appendResolvedToolResults(agent.id, message)
    if (toolState.pending) return null
    const budgetReason = consumedBudgetStopReason(waiting.request.budget, waiting.turn + 1, waiting.usage)
    if (budgetReason) {
      stopRun(agent.id, 'idle', budgetReason)
      scheduleQueuedAgents()
      return null
    }
    delete waitingRuns[agent.id]
    if (ai.compaction && ai.compaction.maybeCompact) ai.compaction.maybeCompact(agent.id, waiting.request.input, { phase: 'before_resume' })

    const request = makeRequest(ai.findAgent(agent.id), waiting.request.input, waiting.runId, waiting.actor, waiting.turn + 1)
    request.accumulatedUsage = waiting.usage || emptyUsage()
    request.startedAt = waiting.request.startedAt
    return startRunningRequest(agent.id, request, actor || waiting.actor, 'continuing after tool approval', false)
  }

  function stopAgent(agentId) {
    const agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    if (!agent) return false
    const stopped = stopRun(agent.id, 'idle', 'cancelled')
    scheduleQueuedAgents()
    return stopped
  }

  function terminalQuest(quest) {
    return quest.status === 'completed' || quest.status === 'failed' || quest.status === 'stopped'
  }

  function cancelQuest(agentId, questId, actor) {
    const agent = ai.findAgent(agentId)
    const quest = agent && ai.findQuest(agentId, questId)
    const who = actor || 'user'
    if (!quest || !ai.canCancelQuest(who, agentId, questId)) return null
    const previousStatus = quest.status
    if (terminalQuest(quest)) {
      return Object.assign({ outcome: 'already_terminal', cancelled: false, previousStatus: previousStatus }, ai.quest.read(agentId, questId, who))
    }

    const run = runs[agentId]
    const waiting = waitingRuns[agentId]
    const activeInput = run && run.request && run.request.input
    const waitingInput = waiting && waiting.request && waiting.request.input
    const active = (activeInput && activeInput.questId === questId) || (waitingInput && waitingInput.questId === questId)
    if (active) {
      stopRun(agentId, 'idle', 'cancelled')
    } else {
      const messageId = quest.requestMessageId || quest.id
      ai.dequeueMessage(agentId, messageId)
      if (messageId) ai.updateMessage(agentId, messageId, { status: 'stopped', completedAt: Date.now() })
      stopQuestExecution(agentId, { questId: questId }, 'cancelled', quest.usage)
    }

    const current = ai.findAgent(agentId)
    if (!runs[agentId] && !waitingRuns[agentId]) {
      if (current && current.queue && current.queue.length) {
        ai.setAgentStatus(agentId, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
      } else {
        ai.setAgentStatus(agentId, { status: 'idle', statusText: '', activeMessageId: null, activeQuestId: null })
      }
      scheduleAgent(agentId)
    }
    const activeRun = run || waiting
    trace({
      type: 'quest_cancelled',
      runId: activeRun && activeRun.runId || null,
      traceId: activeRun && activeRun.runId || null,
      agentId: agentId,
      questId: questId,
      phase: 'quest',
      status: 'stopped',
      summary: 'Quest cancelled',
    })
    scheduleQueuedAgents()
    return Object.assign({ outcome: 'cancelled', cancelled: true, previousStatus: previousStatus }, ai.quest.read(agentId, questId, who))
  }

  function scheduleAgent(agentId) {
    let agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    if (!agent) return null
    if (runs[agent.id] || agent.status === 'running' || agent.status === 'waiting_approval') return null
    if (!canStartRun(agent.id)) {
      if (agent.queue && agent.queue.length) ai.setAgentStatus(agent.id, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
      return null
    }
    if ((!agent.queue || !agent.queue.length) && hasActionableInbox(agent)) {
      enqueueInboxContinuation(agent)
      agent = ai.findAgent(agent.id)
    }
    const queue = agent.queue || []
    if (!queue.length) return null
    const item = queue.slice().sort(function (a, b) {
      return (b.priority || 0) - (a.priority || 0) || a.createdAt - b.createdAt
    })[0]
    ai.dequeueMessage(agent.id, item.messageId)
    const message = ai.readMessage(agent.id, item.messageId)
    return message ? runAgent(agent.id, message) : null
  }

  function scheduleQueuedAgents() {
    if (activeRunCount() >= runtimeConfig.maxConcurrentAgents) return
    const agents = ai.agents ? ai.agents.peek() : []
    for (let i = 0; i < agents.length; i++) {
      if (activeRunCount() >= runtimeConfig.maxConcurrentAgents) return
      if (agents[i].queue && agents[i].queue.length) scheduleAgent(agents[i].id)
    }
  }

  function queueMessage(agentId, content, from, meta) {
    const agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    if (!agent) return null
    const spec = content && typeof content === 'object' ? content : { content: content }
    const messageMeta = Object.assign({}, meta || spec.meta || {})
    let message = ai.appendMessage(agent.id, {
      from: spec.from || from || 'user',
      role: spec.role || 'user',
      content: spec.content,
      connection: agent.connection,
      model: agent.model || null,
      contextRefs: spec.contextRefs || [],
      attachments: spec.attachments || [],
      questId: spec.questId || null,
      resultForQuestId: spec.resultForQuestId || null,
      status: 'queued',
      meta: messageMeta,
    })
    if (!messageMeta.responseId) {
      messageMeta.responseId = message.id
      message = ai.updateMessage(agent.id, message.id, { meta: messageMeta })
    }
    ai.enqueueMessage(agent.id, message.id, {
      interrupt: !!spec.interrupt,
      priority: spec.priority || 0,
    })
    ai.setActiveRunState(agent.id, {
      runId: null,
      messageId: message.id,
      state: 'queued',
      previewTail: '',
      previewUpdatedAt: null,
      startedAt: Date.now(),
      firstTokenAt: null,
      completedAt: null,
      usage: null,
      outputTokens: 0,
      totalTokens: 0,
      cost: null,
      error: null,
    })
    if (spec.interrupt) stopRun(agent.id, 'queued')
    const run = spec.schedule === false ? null : scheduleAgent(agent.id)
    return Object.assign({ agentId: agent.id, messageId: message.id, message: message, status: message.status }, run || {})
  }

  function sendAgentQuest(toAgentId, spec) {
    spec = spec || {}
    const target = ai.findAgent(toAgentId)
    if (!target) return null
    const messageMeta = Object.assign({}, spec.meta || {})
    let message = ai.appendMessage(target.id, {
      from: spec.fromAgentId ? ('agent:' + spec.fromAgentId) : (spec.from || 'user'),
      role: 'user',
      content: spec.content || '',
      connection: target.connection,
      model: target.model || null,
      contextRefs: spec.contextRefs || [],
      attachments: spec.attachments || [],
      status: 'queued',
      meta: messageMeta,
    })
    if (!messageMeta.responseId) messageMeta.responseId = message.id
    message = ai.updateMessage(target.id, message.id, { questId: message.id, meta: messageMeta })
    const quest = ai.createQuest(target.id, {
      id: message.id,
      fromAgentId: spec.fromAgentId || null,
      requestMessageId: message.id,
      goal: String(spec.content || '').slice(0, 1000),
      status: 'queued',
      budget: effectiveRunBudget(spec.budget),
      meta: { sourceResponseId: spec.sourceResponseId || null },
    })
    ai.enqueueMessage(target.id, message.id, {
      interrupt: !!spec.interrupt,
      priority: spec.priority || 0,
    })
    if (spec.interrupt) stopRun(target.id, 'queued')
    const run = scheduleAgent(target.id)
    return {
      agentId: target.id,
      questId: quest.id,
      messageId: message.id,
      status: run ? 'running' : 'queued',
    }
  }

  ai.runAgent = runAgent
  ai.stopAgent = stopAgent
  ai.resumeAgent = resumeAgent
  ai.flushToolResults = flushToolResults
  ai.scheduleAgent = scheduleAgent
  ai.configureRuntime = function (config) {
    const next = config || {}
    if (next.maxConcurrentAgents != null) runtimeConfig.maxConcurrentAgents = next.maxConcurrentAgents
    if (next.maxConcurrentMessagesPerAgent != null) runtimeConfig.maxConcurrentMessagesPerAgent = next.maxConcurrentMessagesPerAgent
    if (next.maxDelegationDepth != null) runtimeConfig.maxDelegationDepth = next.maxDelegationDepth
    if (next.limits) runtimeConfig.limits = Object.assign({}, runtimeConfig.limits, next.limits)
    scheduleQueuedAgents()
    return ai.runtimeConfig()
  }
  ai.runtimeConfig = function () {
    return Object.assign({}, runtimeConfig, { limits: Object.assign({}, runtimeConfig.limits) })
  }
  ai.message = ai.message || {}
  ai.agent = ai.agent || {}
  ai.quest = ai.quest || {}
  ai.message.send = function (agentId, spec) { return queueMessage(agentId, spec || {}, (spec && spec.from) || 'user') }
  ai.agent.send = sendAgentQuest
  ai.quest.cancel = cancelQuest
})(window.aiditor = window.aiditor || {})

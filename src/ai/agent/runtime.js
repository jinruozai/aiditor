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
    maxConcurrentTools: 4,
    maxDelegationDepth: 4,
    limits: {
      maxTurns: null,
      timeoutMs: null,
      maxTokens: null,
    },
  }
  const STREAM_UI_UPDATE_MS = 200
  const RUN_PREVIEW_UPDATE_MS = 80
  const RUN_PREVIEW_CHARS = 140
  const MAX_STREAM_CONTENT_CHARS = 1000000
  const MAX_REASONING_CHARS = 65536
  const RUNTIME_CONTINUATION_PRIORITY = -10
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
    const who = request ? request.agent.id : actor
    const list = calls || []
    const aliases = request && ai.toolAliasMap ? ai.toolAliasMap(request) : { byName: {} }
    const expectedNames = list.map(function (call) {
      const providerName = call && call.function && call.function.name
      return call.toolId || call.name || call.tool || aliases.byName[providerName] || providerName || ''
    })
    const normalized = []
    const batch = []
    let firstError = null
    for (let i = 0; i < list.length; i++) {
      let call = list[i]
      let id = call.id || call.providerCallId || ('tc_provider_' + Date.now().toString(36) + '_' + nextProviderToolCallId++)
      let providerName = call && call.function && call.function.name || call.providerName || call.name || call.toolId || call.tool || ''
      let providerToolId = expectedNames[i]
      let normalizedToolId = providerToolId
      let spec = requestToolSpec(request, providerToolId)
      let argumentMode = call.argumentMode || spec && spec.argumentMode || request && request.connectionCapabilities && request.connectionCapabilities.toolArguments || 'json'
      let providerArgs = null
      let hasArgs = false
      try {
        if (!call.toolId && !call.tool && (call.function || call.arguments != null) && ai.normalizeOpenAiToolCalls) {
          call = ai.normalizeOpenAiToolCalls([call], request || {})[0]
        }
        id = call.id || call.providerCallId || id
        providerName = call.providerName || providerName
        providerToolId = call.toolId || call.name || call.tool || providerToolId
        spec = requestToolSpec(request, providerToolId)
        argumentMode = call.argumentMode || spec && spec.argumentMode || argumentMode
        providerArgs = ai.toolArguments.read(call, providerToolId)
        hasArgs = true
        if (spec) assertToolArguments(providerArgs, spec, id, argumentMode)
        const route = spec && spec.route
        const executorToolId = route && route.toolId || null
        const executorArgs = routeToolArguments(providerArgs, route)
        normalizedToolId = providerToolId
        if (!route && !ai.tools.get(normalizedToolId) && ai.providerToolAliasCandidates) {
          const candidates = ai.providerToolAliasCandidates(normalizedToolId, ai.tools.list())
          if (candidates.length === 1) normalizedToolId = candidates[0]
        }
        if (!spec && ai.tools.get(normalizedToolId)) {
          assertToolArguments(providerArgs, {
            id: normalizedToolId,
            schema: ai.tools.schema(normalizedToolId, request || {}),
          }, id, argumentMode)
        }
        normalized.push(Object.assign({}, call, {
          id: id,
          toolId: normalizedToolId,
          name: normalizedToolId,
          providerName: providerName || null,
          providerToolId: route ? providerToolId : null,
          providerArgs: route ? providerArgs : null,
          args: providerArgs,
          executorToolId: executorToolId,
          executorArgs: route ? executorArgs : null,
          argumentMode: argumentMode,
          status: call.status || 'proposed',
          error: call.error,
          errorDetails: call.errorDetails,
          actor: who || 'user',
          createdAt: call.createdAt || Date.now(),
          updatedAt: call.updatedAt || Date.now(),
        }))
      } catch (error) {
        if (!isToolArgumentError(error)) throw error
        if (!firstError) firstError = error
      }
      batch.push({
        callId: id,
        providerName: providerName,
        toolId: normalizedToolId,
        argumentMode: argumentMode,
        hasArgs: hasArgs,
        args: hasArgs ? providerArgs : null,
      })
    }
    if (firstError) {
      const failedSpec = requestToolSpec(request, firstError.toolName)
      if (!firstError.argumentMode) firstError.argumentMode = failedSpec && failedSpec.argumentMode || 'json'
      firstError.expectedToolNames = expectedNames
      Object.defineProperty(firstError, 'toolCallBatch', { value: batch, configurable: true })
      throw firstError
    }
    return normalized
  }

  function routeToolArguments(args, route) {
    if (!route) return args
    if (route.inputKey) {
      const out = Object.assign({}, route.args || {})
      out[route.inputKey] = args
      return out
    }
    return route.args ? Object.assign({}, args, route.args) : args
  }

  function requestToolSpec(request, id) {
    const specs = request && request.toolSpecs || []
    for (let i = 0; i < specs.length; i++) if (specs[i].id === id) return specs[i]
    return null
  }

  function assertToolArguments(args, spec, callId, argumentMode) {
    const result = ai.schema.validate(args, spec.schema)
    if (result.valid) return
    const first = result.error
    const err = new Error('Tool arguments do not match the schema for "' + spec.id + '" at ' + first.path + ': ' + first.message)
    err.code = 'TOOL_ARGUMENTS_SCHEMA_INVALID'
    err.toolName = spec.id
    err.callId = callId || null
    err.argumentMode = argumentMode
    err.path = first.path
    err.keyword = first.keyword
    err.schemaMessage = first.message
    err.schemaErrors = result.errors
    err.argumentHash = toolArgumentHash(args)
    err.argumentSummary = toolArgumentSummary(args)
    err.connectionNeutral = true
    throw err
  }

  function toolArgumentHash(args) {
    return ai.serialize.hash(args)
  }

  function toolArgumentSummary(args) {
    return ai.serialize.compactString(ai.serialize.stableStringify(args), 320)
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

  function approvalActivity(message) {
    const calls = message && message.toolCalls || []
    for (let i = 0; i < calls.length; i++) {
      if (!calls[i].approvalPhase) continue
      return 'awaiting approval ' + toolCallName(calls[i]) + ' · ' + String(i + 1) + '/' + String(calls.length)
    }
    return 'awaiting tool approval'
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
    const effective = {
      maxTurns: clampLimit(requested.maxTurns, limits.maxTurns),
      timeoutMs: clampLimit(requested.timeoutMs, limits.timeoutMs),
      maxTokens: clampLimit(requested.maxTokens, limits.maxTokens),
    }
    return effective.maxTurns || effective.timeoutMs || effective.maxTokens ? effective : null
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
      state.toolCalls = ai.toolArguments.mergeDeltas(state.toolCalls, calls)
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

  function finishStreamingMessage(agentId, messageId, state, result, request, normalizedToolCalls) {
    const message = normalizeProviderMessage(result || {}, request)
    const storedMessage = ai.readMessage(agentId, messageId)
    let content = message.content != null && (message.content !== '' || !state.content) ? message.content : state.content
    const reasoning = message.reasoning_content != null ? message.reasoning_content : (message.reasoningContent != null ? message.reasoningContent : state.reasoning_content)
    let toolCalls = normalizedToolCalls
    if (toolCalls == null) {
      try {
        toolCalls = normalizeToolCalls(message.toolCalls || state.toolCalls, request)
      } catch (error) {
        error.providerContent = content || ''
        error.providerReasoning = reasoning || null
        error.providerUsage = message.usage || result && result.usage || state.usage || null
        error.providerFinishReason = resultFinishReason(message) || resultFinishReason(result) || state.finishReason || null
        throw error
      }
    }
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

  function executeToolCalls(agentId, message, actor, signal) {
    const calls = message.toolCalls || []
    if (!calls.length) return Promise.resolve({ count: 0, waiting: false })
    const pending = []
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      if (isTerminalToolStatus(call.status)) {
        if (!hasToolResult(ai.findAgent(agentId), call.id)) {
          appendToolResult(agentId, call, terminalToolResult(call), call.status === 'failed' ? 'error' : 'done')
        }
        continue
      }
      pending.push(call)
    }
    return ai.toolScheduler.schedule(pending, {
      signal: signal,
      parallelLimit: runtimeConfig.maxConcurrentTools,
      halt: function (state) { return !!(state && state.waiting) },
      mode: function (call) {
        return ai.tools.executionMode(call.executorToolId || call.toolId, call.executorArgs == null ? call.args : call.executorArgs)
      },
      execute: function (call) {
        let job = null
        try {
          job = Promise.resolve(executeOneToolCall(agentId, call, actor, { signal: signal }))
        } catch (err) {
          job = Promise.reject(err)
        }
        return job.catch(function (err) {
          const found = ai.findToolCall ? ai.findToolCall(agentId, call.id) : null
          const current = found && found.toolCall
          const failed = current && isTerminalToolStatus(current.status)
            ? current
            : ai.failToolCall(agentId, call.id, err, 'run')
          if (!hasToolResult(ai.findAgent(agentId), call.id)) appendToolResult(agentId, call, failedToolPayload(failed || call), 'error')
          if (err && err.code !== 'TOOL_CANCELLED' && aiditor.reportError) aiditor.reportError({ scope: 'ai', tool: call.toolId || call.name || 'tool' }, err)
          return { waiting: false, error: err }
        })
      },
    }).then(function (states) {
      let waiting = false
      for (let i = 0; i < states.length; i++) if (states[i] && states[i].waiting) waiting = true
      return { count: calls.length, waiting: waiting }
    })
  }

  function hasDelegationBoundary(calls) {
    calls = calls || []
    for (let i = 0; i < calls.length; i++) {
      const id = calls[i] && (calls[i].toolId || calls[i].name)
      const status = calls[i] && calls[i].status
      if ((id === 'agent.delegate' || id === 'agent.send') && status !== 'failed' && status !== 'rejected') return true
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
    return !!(agent && state && state.applyDecision && state.applyDecision.allowed && state.canApply)
  }

  function prepareApprovalTool(agentId, call, actor, tool, options) {
    let state = ai.getToolCallActionState ? ai.getToolCallActionState(agentId, call.id, actor) : null
    if (state && state.canPreview) {
      const preview = ai.previewToolCall(agentId, call.id, actor, options)
      if (preview && preview.promise) return preview.promise.then(function () { return { done: true } })
      return Promise.resolve({ done: true })
    }
    if (state && state.canApprove) {
      ai.approveToolCall(agentId, call.id, actor)
      state = ai.getToolCallActionState ? ai.getToolCallActionState(agentId, call.id, actor) : null
    }
    if (state && state.canRun) {
      const run = ai.runToolCall(agentId, call.id, actor, options)
      if (run && run.promise) return run.promise.then(function () { return { done: true } })
    }
    return Promise.resolve({ done: !!(tool.preview || tool.run) })
  }

  function applyPreparedApprovalTool(agentId, call, actor, options) {
    const applied = ai.applyToolCall(agentId, call.id, actor, options)
    if (applied && applied.promise) {
      return applied.promise.then(function (done) {
        appendToolResult(agentId, call, done && done.status === 'failed' ? failedToolPayload(done) : done && (done.applyResult || done), done && done.status === 'failed' ? 'error' : 'done')
        return { waiting: false }
      })
    }
    appendToolResult(agentId, call, applied && applied.status === 'failed' ? failedToolPayload(applied) : applied && (applied.applyResult || applied), applied && applied.status === 'failed' ? 'error' : 'done')
    return Promise.resolve({ waiting: false })
  }

  function approvalPhase(state) {
    if (!state) return null
    if (state.runDecision && state.runDecision.decision === 'ask') return 'run'
    if (state.applyDecision && state.applyDecision.decision === 'ask') return 'apply'
    return null
  }

  function permissionFailure(call, decision) {
    const code = decision && decision.decision === 'unavailable' ? 'PERMISSION_UNAVAILABLE' : 'PERMISSION_DENIED'
    return { ok: false, code: code, error: decision && decision.reason || 'Tool call was not allowed', toolId: call.toolId }
  }

  function executeOneToolCall(agentId, call, actor, options) {
    const executorToolId = call.executorToolId || call.toolId
    const tool = ai.tools.get(executorToolId)
    if (!tool) {
      trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_missing', status: 'failed', summary: 'tool not found' }))
      const failed = ai.failToolCall(agentId, call.id, { code: 'TOOL_NOT_FOUND', message: 'Tool not found: ' + call.toolId }, 'run')
      appendToolResult(agentId, call, failedToolPayload(failed), 'error')
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
      return prepareApprovalTool(agentId, call, actor, tool, options).then(function () {
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
          return applyPreparedApprovalTool(agentId, call, actor, options).then(function (result) {
            trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: 'applied', summary: toolCallName(call) }))
            return result
          })
        }
        const pendingApproval = approvalPhase(state)
        if (pendingApproval) {
          ai.requestToolCallApproval(agentId, call.id, pendingApproval)
          trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_waiting_approval', status: 'waiting_approval', summary: toolCallName(call) }))
          return { waiting: true }
        }
        const denied = state && state.applyDecision || state && state.runDecision
        trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: 'failed', summary: denied && denied.reason || 'not actionable' }))
        const failure = permissionFailure(call, denied)
        const failed = ai.failToolCall(agentId, call.id, failure, 'apply')
        appendToolResult(agentId, call, failedToolPayload(failed), 'error')
        return { waiting: false }
      })
    }
    const state = ai.getToolCallActionState ? ai.getToolCallActionState(agentId, call.id, actor) : null
    if (state && state.runDecision && state.runDecision.decision === 'ask') {
      ai.requestToolCallApproval(agentId, call.id, 'run')
      trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_waiting_approval', status: 'waiting_approval', summary: toolCallName(call) }))
      return Promise.resolve({ waiting: true })
    }
    if (!state || !state.runDecision || !state.runDecision.allowed) {
      const failure = permissionFailure(call, state && state.runDecision)
      const failed = ai.failToolCall(agentId, call.id, failure, 'run')
      appendToolResult(agentId, call, failedToolPayload(failed), 'error')
      return Promise.resolve({ waiting: false })
    }
    const approved = ai.approveToolCall(agentId, call.id, actor)
    publishToolActivity(agentId, call, 'running')
    const run = approved && ai.runToolCall(agentId, call.id, actor, options)
    if (!run || !run.promise) {
      const failed = ai.failToolCall(agentId, call.id, { code: 'PERMISSION_DENIED', message: 'Tool call was not allowed: ' + call.toolId }, 'run')
      appendToolResult(agentId, call, failedToolPayload(failed), 'error')
      return Promise.resolve({ waiting: false })
    }
    return run.promise.then(function (done) {
      appendToolResult(agentId, call, done && done.status === 'failed' ? failedToolPayload(done) : done && (done.result || done), done && done.status === 'failed' ? 'error' : 'done')
      trace(Object.assign(toolTraceBase(agentId, call), { type: 'tool_completed', status: done && done.status === 'failed' ? 'failed' : 'completed', summary: toolCallName(call) }))
      return { waiting: false }
    })
  }

  function toolArgumentRecoveryMessage(error) {
    const expected = error.expectedToolNames && error.expectedToolNames.length
      ? error.expectedToolNames.join(', ')
      : (error.toolName || 'unknown')
    return {
      id: 'system-tool-arguments-recovery-' + Date.now().toString(36),
      from: 'system',
      role: 'system',
      status: 'done',
      content: [
        'TOOL_CALL_RECOVERY: The previous response selected Tool calls [' + expected + '] but emitted invalid JSON arguments for "' + (error.toolName || 'unknown') + '".',
        'No Tool from that response was executed.',
        'Regenerate exactly the same Tool-call set for the same user intent once, using the provider Tool interface and its strict schemas.',
        'Do not add prose, omit a call, add a call, or claim that the previous calls ran.',
      ].join('\n'),
      meta: {
        contextLayer: 'runtime',
        contextCardId: 'tool-arguments-recovery',
        contextPriority: 110,
      },
    }
  }

  function toolArgumentRecoveryRequest(request, error, correction) {
    const names = uniqueToolNames(error.expectedToolNames && error.expectedToolNames.length ? error.expectedToolNames : [error.toolName])
    return Object.assign({}, request, {
      messages: (request.messages || []).concat([toolArgumentRecoveryMessage(error)]),
      tools: (request.tools || []).slice(),
      toolSpecs: (request.toolSpecs || []).filter(function (tool) { return names.indexOf(tool.id) >= 0 }),
      toolChoice: { mode: 'required', tools: names.slice() },
      toolArgumentRecoveryAttempt: correction.count,
      toolArgumentCorrection: correction,
    })
  }

  function uniqueToolNames(names) {
    const out = []
    for (let i = 0; i < (names || []).length; i++) if (names[i] && out.indexOf(names[i]) < 0) out.push(names[i])
    return out
  }

  function canRecoverToolArguments(request, error) {
    if (!request.connectionCapabilities || request.connectionCapabilities.toolArguments !== 'strict') return false
    const names = uniqueToolNames(error.expectedToolNames && error.expectedToolNames.length ? error.expectedToolNames : [error.toolName])
    if (!names.length) return false
    for (let i = 0; i < names.length; i++) {
      const spec = requestToolSpec(request, names[i])
      if (!spec || spec.argumentMode !== 'strict' || !spec.providerSchema) return false
    }
    return true
  }

  function isToolArgumentError(error) {
    return !!(error && (error.code === 'TOOL_ARGUMENTS_INVALID_JSON' || error.code === 'TOOL_ARGUMENTS_SCHEMA_INVALID'))
  }

  function toolArgumentFingerprint(error) {
    return [
      error.code || '',
      error.toolName || '',
      error.argumentHash || '',
      error.path || '',
      error.keyword || '',
      error.parsePosition == null ? '' : error.parsePosition,
      error.argumentLength == null ? '' : error.argumentLength,
      error.argumentSnippet || '',
      error.schemaMessage || '',
    ].join('|')
  }

  function toolArgumentCorrectionDecision(request, error) {
    const current = request.toolArgumentCorrection || { count: 0, fingerprints: [], hiddenUsed: false }
    const fingerprint = toolArgumentFingerprint(error)
    if (current.fingerprints.indexOf(fingerprint) >= 0) {
      return { allowed: false, reason: 'repeated', state: current }
    }
    return {
      allowed: true,
      reason: null,
      state: {
        count: current.count + 1,
        fingerprints: current.fingerprints.concat([fingerprint]),
        hiddenUsed: current.hiddenUsed,
      },
    }
  }

  function finalToolArgumentError(error, decision) {
    error.retryable = false
    error.correctionReason = decision.reason
    error.correctionAttempts = decision.state.count
    error.recoveryAttempted = decision.state.hiddenUsed
    return error
  }

  function toolArgumentFailureCalls(error, request) {
    const batch = error.toolCallBatch && error.toolCallBatch.length
      ? error.toolCallBatch
      : uniqueToolNames(error.expectedToolNames && error.expectedToolNames.length ? error.expectedToolNames : [error.toolName]).map(function (toolId) {
        return { callId: null, providerName: '', toolId: toolId }
      })
    const details = Object.assign({}, ai.toolArguments.errorDetails(error), {
      retryable: true,
      correctionAttempt: request.toolArgumentCorrection.count,
    })
    return batch.map(function (item, index) {
      const providerToolId = item.toolId || error.expectedToolNames && error.expectedToolNames[index] || error.toolName || ''
      const spec = requestToolSpec(request, providerToolId)
      const route = spec && spec.route
      const callId = item.callId || 'tc_invalid_' + Date.now().toString(36) + '_' + nextProviderToolCallId++
      const failed = error.callId ? callId === error.callId : providerToolId === error.toolName
      const providerArgs = item.hasArgs ? item.args : {}
      const payload = failed ? details : {
        code: 'TOOL_BATCH_ABORTED',
        toolName: providerToolId,
        callId: callId,
        argumentMode: spec && spec.argumentMode || error.argumentMode || 'json',
        message: 'No Tool was executed because another call in the same batch had invalid arguments.',
        retryable: true,
        causedBy: error.toolName || null,
        correctionAttempt: request.toolArgumentCorrection.count,
      }
      return {
        id: callId,
        providerCallId: callId,
        providerName: item.providerName || '',
        providerToolId: providerToolId,
        providerArgs: providerArgs,
        toolId: providerToolId,
        name: providerToolId,
        args: providerArgs,
        executorToolId: route && route.toolId || null,
        executorArgs: route ? routeToolArguments(providerArgs, route) : null,
        argumentMode: spec && spec.argumentMode || error.argumentMode || 'json',
        status: 'failed',
        error: payload.message,
        errorDetails: payload,
        actor: request.agent.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    })
  }

  function finishToolArgumentCorrection(agentId, messageId, state, request, error) {
    const calls = toolArgumentFailureCalls(error, request)
    const result = {
      role: 'assistant',
      content: error.providerContent || state.content || '',
      reasoning_content: error.providerReasoning || state.reasoning_content || null,
      usage: error.providerUsage || state.usage || null,
      finishReason: error.providerFinishReason || state.finishReason || 'tool_calls',
    }
    const message = finishStreamingMessage(agentId, messageId, state, result, request, calls)
    trace({
      type: 'tool_arguments_correction_requested',
      runId: request.runId,
      traceId: request.runId,
      agentId: agentId,
      messageId: messageId,
      questId: request.input && request.input.questId || null,
      phase: 'provider',
      entry: error.toolName || '',
      status: 'retrying',
      summary: 'returning invalid Tool arguments to the model for correction',
      meta: Object.assign({}, ai.toolArguments.errorDetails(error), {
        correctionAttempt: request.toolArgumentCorrection.count,
      }),
    })
    return { message: message, result: result, request: request }
  }

  function resetToolArgumentAttempt(agentId, messageId, state, request) {
    state.content = ''
    state.toolCalls = []
    state.reasoning_content = ''
    state.previewTail = ''
    state.modelTail = ''
    state.activityText = ''
    state.previewUpdatedAt = null
    state.firstTokenAt = null
    state.usage = null
    state.finishReason = null
    state.runState = 'connecting'
    state.publishedFirstPreview = false
    state.publishedFirstTool = false
    ai.updateMessage(agentId, messageId, {
      content: '',
      reasoning_content: null,
      toolCalls: [],
      status: 'running',
    })
    publishRunState(agentId, state, request, 'connecting', true)
  }

  function recoveryResultError(error) {
    const out = new Error('Tool argument recovery did not reproduce the complete Tool-call batch for the original intent')
    out.code = 'TOOL_ARGUMENTS_RECOVERY_FAILED'
    out.connectionNeutral = true
    out.recoveryAttempted = true
    out.recoveryFor = ai.toolArguments.errorDetails(error)
    return out
  }

  function recoveredToolBatch(error, calls) {
    const expected = error.expectedToolNames && error.expectedToolNames.length
      ? error.expectedToolNames
      : [error.toolName || '']
    if (calls.length !== expected.length) return false
    const counts = {}
    for (let i = 0; i < calls.length; i++) {
      const name = calls[i].providerToolId || calls[i].toolId || calls[i].name || ''
      counts[name] = (counts[name] || 0) + 1
    }
    for (let j = 0; j < expected.length; j++) {
      const name = expected[j]
      if (!name || !counts[name]) return false
      counts[name]--
    }
    return true
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
    let recoveryError = null
    let recoveryCompleted = false
    function failTurn(err) {
      if (controller.signal.aborted) return null
      const completedAt = Date.now()
      const currentMessage = ai.readMessage(agentId, assistant.id) || assistant
      const argumentDetails = ai.toolArguments.errorDetails(err) || err && err.recoveryFor || null
      const errorMeta = {
        error: String(err && err.message ? err.message : err),
        errorCode: err && err.code || null,
        finishReason: err && err.reason || state.finishReason || null,
      }
      if (argumentDetails) errorMeta.toolArguments = argumentDetails
      ai.updateMessage(agentId, assistant.id, {
        content: err && err.providerContent || currentMessage.content || '',
        status: 'error',
        meta: Object.assign({}, currentMessage.meta || {}, errorMeta),
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
      trace({ type: 'run_failed', runId: request.runId, traceId: request.runId, agentId: agentId, messageId: assistant.id, questId: inputMessage && inputMessage.questId || null, status: 'failed', summary: state.error, meta: { code: err && err.code || null, finishReason: err && err.reason || state.finishReason || null, toolArguments: argumentDetails } })
      throw err
    }
    function completeProviderAttempt(attemptRequest, result, providerResult) {
      assertProviderCompleted(state, result, attemptRequest)
      const done = finishStreamingMessage(agentId, assistant.id, state, result, attemptRequest)
      if (recoveryError && !recoveryCompleted) {
        const expected = recoveryError.toolName || ''
        const calls = done.toolCalls || []
        if (!recoveredToolBatch(recoveryError, calls)) throw recoveryResultError(recoveryError)
        recoveryCompleted = true
        trace({
          type: 'tool_arguments_recovery_completed',
          runId: request.runId,
          traceId: request.runId,
          agentId: agentId,
          messageId: assistant.id,
          questId: inputMessage && inputMessage.questId || null,
          phase: 'provider',
          entry: expected,
          status: 'completed',
          summary: 'tool arguments recovered',
          meta: { attempt: 1, toolName: expected },
        })
      }
      return { message: done, result: providerResult || result, request: attemptRequest }
    }
    function sendAttempt(attemptRequest) {
      return ai.resolveRequest(attemptRequest, controller.signal).then(sendResolvedAttempt)
    }
    function sendResolvedAttempt(attemptRequest) {
      attemptRequest.stream = attemptRequest.stream || !!provider.stream
      trace({
        type: 'provider_request_started',
        runId: attemptRequest.runId,
        traceId: attemptRequest.runId,
        agentId: agentId,
        messageId: assistant.id,
        questId: inputMessage && inputMessage.questId || null,
        entry: request.connectionName,
        phase: 'provider',
        status: 'running',
        summary: request.connectionName + ' / ' + (request.agent.model || request.model || ''),
        meta: {
          messageCount: attemptRequest.messages ? attemptRequest.messages.length : 0,
          toolCount: attemptRequest.tools ? attemptRequest.tools.length : 0,
          toolProtocol: attemptRequest.connectionCapabilities && attemptRequest.connectionCapabilities.toolProtocol || 'none',
          toolArguments: attemptRequest.connectionCapabilities && attemptRequest.connectionCapabilities.toolArguments || 'none',
          toolArgumentRecoveryAttempt: attemptRequest.toolArgumentRecoveryAttempt || 0,
        },
      })
      return Promise.resolve().then(function () {
        return provider.stream ? provider.stream(attemptRequest, ctx) : provider.send(attemptRequest, ctx)
      }).then(function (result) {
        if (controller.signal.aborted) return null
        if (isIterable(result)) {
          return consumeDeltas(agentId, assistant.id, state, result, attemptRequest, controller).then(function () {
            if (controller.signal.aborted) return null
            const completed = completedStreamResult(state, null, attemptRequest)
            return completeProviderAttempt(attemptRequest, completed, completed)
          })
        }
        if (result && result.deltas && isIterable(result.deltas)) {
          return consumeDeltas(agentId, assistant.id, state, result.deltas, attemptRequest, controller).then(function () {
            if (controller.signal.aborted) return null
            const completed = completedStreamResult(state, result, attemptRequest)
            return completeProviderAttempt(attemptRequest, completed, result)
          })
        }
        if (controller.signal.aborted) return null
        return completeProviderAttempt(attemptRequest, result, result)
      })
    }
    function handleToolArgumentError(err, attemptRequest) {
      if (!isToolArgumentError(err)) throw err
      const decision = toolArgumentCorrectionDecision(attemptRequest, err)
      if (!decision.allowed) throw finalToolArgumentError(err, decision)
      const useHiddenRecovery = canRecoverToolArguments(attemptRequest, err) && !decision.state.hiddenUsed
      if (useHiddenRecovery) {
        const correction = Object.assign({}, decision.state, { hiddenUsed: true })
        const recoveryRequest = toolArgumentRecoveryRequest(attemptRequest, err, correction)
        err.retryable = true
        err.recoveryAttempted = true
        recoveryError = err
        trace({
          type: 'tool_arguments_recovery_started',
          runId: request.runId,
          traceId: request.runId,
          agentId: agentId,
          messageId: assistant.id,
          questId: inputMessage && inputMessage.questId || null,
          phase: 'provider',
          entry: err.toolName || '',
          status: 'retrying',
          summary: 'retrying invalid tool arguments with strict schemas',
          meta: Object.assign({}, ai.toolArguments.errorDetails(err), { correctionAttempt: correction.count }),
        })
        resetToolArgumentAttempt(agentId, assistant.id, state, attemptRequest)
        return runAttempt(recoveryRequest)
      }
      err.retryable = true
      err.recoveryAttempted = decision.state.hiddenUsed
      const correctionRequest = Object.assign({}, attemptRequest, { toolArgumentCorrection: decision.state })
      return finishToolArgumentCorrection(agentId, assistant.id, state, correctionRequest, err)
    }
    function runAttempt(attemptRequest) {
      return sendAttempt(attemptRequest).catch(function (err) {
        return handleToolArgumentError(err, attemptRequest)
      })
    }
    return runAttempt(request).then(function (completed) {
      if (!completed || controller.signal.aborted) return null
      return continueAfterTools(agentId, provider, completed.message, completed.result, completed.request, controller, actor)
    }, failTurn)
  }

  function continueAfterTools(agentId, provider, message, result, request, controller, actor) {
    const calls = message.toolCalls || []
    if (!calls.length) return message
    return executeToolCalls(agentId, message, agentId, controller.signal).then(function (state) {
      if (controller.signal.aborted || !state.count) return message
      const current = ai.findAgent(agentId)
      if (!current || state.waiting) {
        const waitingMessage = ai.readMessage(agentId, message.id) || message
        trace({ type: 'run_waiting_approval', runId: request.runId, traceId: request.runId, agentId: agentId, messageId: message.id, questId: request.input && request.input.questId || null, status: 'waiting_approval', summary: 'waiting for tool approval' })
        publishRunState(agentId, {
          messageId: message.id,
          content: message.content || '',
          previewTail: '',
          modelTail: '',
          activityText: approvalActivity(waitingMessage),
          previewUpdatedAt: Date.now(),
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
      const nextRequest = planRunRequest(ai.findAgent(agentId) || current, request.input, request.runId, actor, (request.turn || 0) + 1)
      nextRequest.budget = request.budget
      nextRequest.startedAt = request.startedAt
      nextRequest.toolArgumentCorrection = calls.some(function (call) {
        return call.status === 'failed' && isToolArgumentError(call.errorDetails)
      }) ? (request.toolArgumentCorrection || null) : null
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
    if (!budget) return null
    if (budget.maxTurns && turns >= budget.maxTurns) return 'max_turns'
    if (budget.maxTokens && usage && usage.reported && usage.totalTokens >= budget.maxTokens) return 'max_tokens'
    return null
  }

  function planRunRequest(agent, input, runId, actor, turn) {
    const request = ai.planRequest(agent, input, runId, actor, turn)
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

  function startRunningRequest(agentId, request, actor, statusText, markInputStarted, execute) {
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
      return execute
        ? execute(runner, request, ctx, controller, actor)
        : runChatTurn(agentId, runner, request, ctx, controller, actor)
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
    } else if (agent && enqueueInboxContinuation(agent)) {
      ai.setAgentStatus(agentId, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
      scheduleAgent(agentId)
    } else {
      ai.setAgentStatus(agentId, { status: 'idle', statusText: '', activeMessageId: null, activeQuestId: null })
    }
    scheduleQueuedAgents()
    return result
  }

  function isRuntimeContinuation(message) {
    return !!(message && message.role === 'user' && message.meta && message.meta.runtimeEvent)
  }

  function isForegroundInput(message) {
    return !!(message && message.role === 'user' && !isRuntimeContinuation(message))
  }

  function foregroundResponseId(agent) {
    const messages = agent && agent.messages || []
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!isForegroundInput(message)) continue
      return message.meta && message.meta.responseId || message.id || null
    }
    return null
  }

  function messageResponseId(message) {
    return message && message.meta && message.meta.responseId || message && message.id || null
  }

  function responseInput(agent, responseId) {
    const messages = agent && agent.messages || []
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!isForegroundInput(message)) continue
      if (messageResponseId(message) === responseId) return message
    }
    return null
  }

  function pendingExecutionStatus(status) {
    return status === 'queued' || status === 'running' || status === 'waiting' || status === 'waiting_approval'
  }

  function responseWasStopped(input) {
    return !!(input && (input.status === 'stopped' || input.meta && input.meta.responseStoppedAt))
  }

  function responseGraph(agentId, responseId) {
    const agents = ai.agents ? ai.agents.peek() : []
    const byId = {}
    const questsBySource = {}
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      byId[agent.id] = agent
      const quests = agent.quests || []
      for (let q = 0; q < quests.length; q++) {
        const quest = quests[q]
        const sourceResponseId = quest.meta && quest.meta.sourceResponseId
        if (!quest.fromAgentId || !sourceResponseId) continue
        const key = quest.fromAgentId + '/' + sourceResponseId
        if (!questsBySource[key]) questsBySource[key] = []
        questsBySource[key].push({ agent: agent, quest: quest })
      }
    }
    const root = byId[agentId]
    const rootResponseId = responseId || foregroundResponseId(root)
    if (!root || !rootResponseId) return null

    const nodes = []
    const responseQuests = []
    const pendingMessages = []
    const pendingQuests = []
    const pendingEvents = []
    const seen = {}

    function visit(currentAgentId, currentResponseId, depth) {
      const key = currentAgentId + '/' + currentResponseId
      if (seen[key]) return
      seen[key] = true
      const agent = byId[currentAgentId]
      if (!agent) return
      const input = responseInput(agent, currentResponseId)
      nodes.push({ agentId: currentAgentId, responseId: currentResponseId, input: input, agent: agent, depth: depth })

      const messages = agent.messages || []
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i]
        if (messageResponseId(message) !== currentResponseId) continue
        if (pendingExecutionStatus(message.status)) {
          pendingMessages.push({ agentId: currentAgentId, responseId: currentResponseId, message: message, depth: depth })
        }
      }

      const inbox = agent.inbox || []
      for (let i = 0; i < inbox.length; i++) {
        const event = inbox[i]
        if (event.consumed || !event.meta || event.meta.responseId !== currentResponseId) continue
        pendingEvents.push({ agentId: currentAgentId, responseId: currentResponseId, event: event, depth: depth })
      }

      const children = questsBySource[key] || []
      for (let q = 0; q < children.length; q++) {
        const target = children[q].agent
        const quest = children[q].quest
        responseQuests.push({ agentId: target.id, questId: quest.id, quest: quest, depth: depth + 1 })
        if (!terminalQuest(quest)) {
          pendingQuests.push({ agentId: target.id, questId: quest.id, quest: quest, depth: depth + 1 })
        }
        const requestId = quest.requestMessageId || quest.id
        const targetMessages = target.messages || []
        let request = null
        for (let m = 0; m < targetMessages.length; m++) {
          if (targetMessages[m].id === requestId) {
            request = targetMessages[m]
            break
          }
        }
        const childResponseId = messageResponseId(request) || quest.id
        visit(target.id, childResponseId, depth + 1)
      }
    }

    visit(agentId, rootResponseId, 0)
    const rootInput = nodes.length ? nodes[0].input : null
    const stopped = responseWasStopped(rootInput)
    const active = !stopped && !!(pendingMessages.length || pendingQuests.length || pendingEvents.length)
    let status = 'completed'
    if (stopped) status = 'stopped'
    else if (active) {
      const rootRunning = pendingMessages.some(function (entry) {
        return entry.agentId === agentId && entry.responseId === rootResponseId
      })
      status = rootRunning ? 'running' : 'waiting'
    }
    return {
      agentId: agentId,
      responseId: rootResponseId,
      status: status,
      active: active,
      nodes: nodes,
      quests: responseQuests,
      pendingMessages: pendingMessages,
      pendingQuests: pendingQuests,
      pendingEvents: pendingEvents,
      startedAt: rootInput && (rootInput.createdAt || rootInput.time) || null,
    }
  }

  function responseMessageUsage(message) {
    return normalizedUsage(message && (message.usage || message.stats && message.stats.usage || message.meta && message.meta.usage))
  }

  function responseMessageStart(message) {
    const stats = message && message.stats || {}
    return message && (message.startedAt || message.createdAt || message.time) || stats.startTime || 0
  }

  function responseMessageEnd(message) {
    const stats = message && message.stats || {}
    return message && (message.completedAt || stats.completedAt || (!pendingExecutionStatus(message.status) && (message.time || message.createdAt))) || 0
  }

  function responseMessageGenerationMs(message) {
    const stats = message && message.stats || {}
    if (stats.generationMs > 0) return stats.generationMs
    if (stats.firstTokenAt && stats.completedAt > stats.firstTokenAt) return stats.completedAt - stats.firstTokenAt
    return 0
  }

  function responseSummary(graph) {
    const metrics = {
      startedAt: graph.startedAt || null,
      completedAt: null,
      durationMs: 0,
      generationMs: 0,
      promptTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokensPerSecond: 0,
      toolCallCount: 0,
      providerTurnCount: 0,
      cost: null,
    }
    const relatedAgentIds = []
    let lastAssistantMessageId = null
    let lastCompletedAt = 0
    let costAmount = 0

    for (let n = 0; n < graph.nodes.length; n++) {
      const node = graph.nodes[n]
      relatedAgentIds.push(node.agentId)
      const messages = node.agent && node.agent.messages || []
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i]
        if (messageResponseId(message) !== node.responseId) continue
        const start = responseMessageStart(message)
        const end = responseMessageEnd(message)
        if (!metrics.startedAt && start) metrics.startedAt = start
        if (end > lastCompletedAt) lastCompletedAt = end
        if (message.role !== 'assistant') continue
        metrics.providerTurnCount++
        if (node.depth === 0) lastAssistantMessageId = message.id
        metrics.toolCallCount += (message.toolCalls || []).length
        let usage = responseMessageUsage(message)
        let generationMs = responseMessageGenerationMs(message)
        let cost = message.stats && message.stats.cost || message.meta && message.meta.cost || null
        if (pendingExecutionStatus(message.status) && ai.peekActiveRunState) {
          const live = ai.peekActiveRunState(node.agentId)
          if (live && live.messageId === message.id) {
            usage = usage || normalizedUsage(live.usage)
            if (!generationMs && live.firstTokenAt) generationMs = Math.max(0, Date.now() - live.firstTokenAt)
            cost = cost || live.cost || null
          }
        }
        if (usage) {
          metrics.promptTokens += usage.promptTokens
          metrics.outputTokens += usage.outputTokens
          metrics.totalTokens += usage.totalTokens
        }
        metrics.generationMs += generationMs
        if (cost && cost.amount > 0) costAmount += Number(cost.amount || 0)
      }
    }

    for (let i = 0; i < graph.quests.length; i++) {
      const completedAt = graph.quests[i].quest.completedAt || 0
      if (completedAt > lastCompletedAt) lastCompletedAt = completedAt
    }
    const rootInput = graph.nodes.length ? graph.nodes[0].input : null
    const stoppedAt = rootInput && rootInput.meta && rootInput.meta.responseStoppedAt || 0
    if (stoppedAt > lastCompletedAt) lastCompletedAt = stoppedAt
    if (!graph.active) metrics.completedAt = lastCompletedAt || metrics.startedAt
    const end = metrics.completedAt || Date.now()
    if (metrics.startedAt && end >= metrics.startedAt) metrics.durationMs = end - metrics.startedAt
    if (metrics.outputTokens && metrics.generationMs) {
      metrics.tokensPerSecond = metrics.outputTokens / Math.max(metrics.generationMs / 1000, 0.001)
    }
    if (costAmount > 0) metrics.cost = { currency: 'USD', amount: costAmount }
    return {
      metrics: metrics,
      lastAssistantMessageId: lastAssistantMessageId,
      relatedAgentIds: relatedAgentIds,
    }
  }

  function readResponse(agentId, responseId) {
    const graph = responseGraph(agentId, responseId)
    if (!graph) return null
    const summary = responseSummary(graph)
    const pendingAgents = {}
    for (let i = 0; i < graph.pendingMessages.length; i++) pendingAgents[graph.pendingMessages[i].agentId] = true
    for (let i = 0; i < graph.pendingQuests.length; i++) pendingAgents[graph.pendingQuests[i].agentId] = true
    for (let i = 0; i < graph.pendingEvents.length; i++) pendingAgents[graph.pendingEvents[i].agentId] = true
    return {
      agentId: graph.agentId,
      responseId: graph.responseId,
      status: graph.status,
      active: graph.active,
      stoppable: graph.active,
      startedAt: graph.startedAt,
      pendingQuestCount: graph.pendingQuests.length,
      pendingAgentCount: Object.keys(pendingAgents).length,
      lastAssistantMessageId: summary.lastAssistantMessageId,
      relatedAgentIds: summary.relatedAgentIds,
      metrics: summary.metrics,
    }
  }

  function responseInboxBatch(agent) {
    const responseId = foregroundResponseId(agent)
    const input = responseInput(agent, responseId)
    const stopped = responseWasStopped(input)
    const inbox = agent && agent.inbox || []
    const events = []
    for (let i = 0; i < inbox.length; i++) {
      const event = inbox[i]
      if (event.consumed) continue
      const eventResponseId = event.meta && event.meta.responseId || null
      if (!stopped && responseId && eventResponseId === responseId) events.push(event)
      else ai.markInboxEventConsumed(agent.id, event.id)
    }
    return { responseId: stopped ? null : responseId, events: events }
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
      priority: RUNTIME_CONTINUATION_PRIORITY,
      schedule: false,
    })
  }

  function enqueueInboxContinuation(agent) {
    const batch = responseInboxBatch(agent)
    if (!batch.responseId || !batch.events.length) return null
    const selected = batch.events.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) })
    for (let i = 0; i < selected.length; i++) ai.markInboxEventConsumed(agent.id, selected[i].id)
    const pending = pendingQuestsForEvents(agent.id, selected, batch.responseId)
    const content = 'Process this completed agent runtime event batch:\n' + JSON.stringify(selected.map(function (event) {
      return {
        type: event.type,
        fromAgentId: event.fromAgentId,
        questId: event.questId,
        resultMessageId: event.resultMessageId,
        summary: event.summary,
      }
    })) + '\nPending related quests, if any, are non-blocking background:\n' + JSON.stringify(pending)
    return queueMessage(agent.id, {
      from: 'system',
      role: 'user',
      content: content,
      meta: { runtimeEvent: 'inbox.continuation', responseId: batch.responseId, events: selected, pendingQuests: pending },
      priority: RUNTIME_CONTINUATION_PRIORITY,
      schedule: false,
    })
  }

  function pendingQuestsForEvents(agentId, events, responseId) {
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
        if (!quest.meta || quest.meta.sourceResponseId !== responseId) continue
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
    const request = planRunRequest(agent, input, runId, actor, 0)
    return startRunningRequest(agent.id, request, actor, runStatusText(input), true)
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
      if (ai.cancelRunToolCalls) ai.cancelRunToolCalls(agent.id, run.runId, 'Tool call was cancelled because the run stopped')
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
    if (!toolState.pending) {
      const budgetReason = consumedBudgetStopReason(waiting.request.budget, waiting.turn + 1, waiting.usage)
      if (budgetReason) {
        stopRun(agent.id, 'idle', budgetReason)
        scheduleQueuedAgents()
        return null
      }
    }
    delete waitingRuns[agent.id]
    if (ai.compaction && ai.compaction.maybeCompact) ai.compaction.maybeCompact(agent.id, waiting.request.input, { phase: 'before_resume' })

    const request = Object.assign({}, waiting.request)
    request.accumulatedUsage = waiting.usage || emptyUsage()
    request.startedAt = waiting.request.startedAt
    return startRunningRequest(agent.id, request, actor || waiting.actor, 'continuing tool calls', false, function (provider, nextRequest, ctx, controller, nextActor) {
      const currentMessage = ai.readMessage(agent.id, waiting.messageId) || message
      return continueAfterTools(agent.id, provider, currentMessage, null, nextRequest, controller, nextActor)
    })
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

  function stopResponse(agentId, responseId) {
    const graph = responseGraph(agentId, responseId)
    if (!graph) {
      return { outcome: 'not_found', stopped: false, agentId: agentId || null, responseId: responseId || null }
    }
    if (!graph.active) {
      return {
        outcome: 'already_terminal',
        stopped: false,
        agentId: graph.agentId,
        responseId: graph.responseId,
        status: graph.status,
        stoppedRunCount: 0,
        cancelledQuestCount: 0,
      }
    }

    const now = Date.now()
    const nodeKeys = {}
    const nodes = graph.nodes.slice().sort(function (a, b) { return b.depth - a.depth })
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      nodeKeys[node.agentId + '/' + node.responseId] = true
      if (node.input) {
        ai.updateMessage(node.agentId, node.input.id, {
          meta: Object.assign({}, node.input.meta || {}, {
            responseStoppedAt: now,
            responseStopReason: 'cancelled',
          }),
        })
      }
      const agent = ai.findAgent(node.agentId)
      const queue = agent && agent.queue || []
      for (let q = queue.length - 1; q >= 0; q--) {
        const message = ai.readMessage(node.agentId, queue[q].messageId)
        if (messageResponseId(message) !== node.responseId) continue
        ai.dequeueMessage(node.agentId, message.id)
        ai.updateMessage(node.agentId, message.id, {
          status: 'stopped',
          completedAt: now,
          meta: Object.assign({}, message.meta || {}, {
            stopReason: 'cancelled',
            responseStoppedAt: now,
            responseStopReason: 'cancelled',
          }),
        })
      }
      const inbox = agent && agent.inbox || []
      for (let e = 0; e < inbox.length; e++) {
        const event = inbox[e]
        if (!event.consumed && event.meta && event.meta.responseId === node.responseId) {
          ai.markInboxEventConsumed(node.agentId, event.id)
        }
      }
    }

    let stoppedRunCount = 0
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const current = runs[node.agentId] || waitingRuns[node.agentId]
      const input = current && current.request && current.request.input
      if (!input || !nodeKeys[node.agentId + '/' + messageResponseId(input)]) continue
      if (stopRun(node.agentId, 'idle', 'cancelled')) stoppedRunCount++
    }

    let cancelledQuestCount = 0
    const quests = graph.pendingQuests.slice().sort(function (a, b) { return b.depth - a.depth })
    for (let i = 0; i < quests.length; i++) {
      const entry = quests[i]
      const current = ai.findQuest(entry.agentId, entry.questId)
      if (current && !terminalQuest(current)) cancelQuest(entry.agentId, entry.questId, 'user')
      const stoppedQuest = ai.findQuest(entry.agentId, entry.questId)
      if (stoppedQuest && stoppedQuest.status === 'stopped') cancelledQuestCount++
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const agent = ai.findAgent(node.agentId)
      if (!agent) continue
      const inbox = agent.inbox || []
      for (let e = 0; e < inbox.length; e++) {
        const event = inbox[e]
        if (!event.consumed && event.meta && event.meta.responseId === node.responseId) {
          ai.markInboxEventConsumed(node.agentId, event.id)
        }
      }
      if (runs[node.agentId] || waitingRuns[node.agentId]) continue
      if (agent.queue && agent.queue.length) {
        ai.setAgentStatus(node.agentId, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
        scheduleAgent(node.agentId)
      } else {
        ai.setAgentStatus(node.agentId, { status: 'idle', statusText: '', activeMessageId: null, activeQuestId: null })
      }
    }
    scheduleQueuedAgents()
    return {
      outcome: 'stopped',
      stopped: true,
      agentId: graph.agentId,
      responseId: graph.responseId,
      status: 'stopped',
      stoppedRunCount: stoppedRunCount,
      cancelledQuestCount: cancelledQuestCount,
    }
  }

  function supersedeQueuedRuntimeContinuations(agentId, responseId) {
    const agent = ai.findAgent(agentId)
    const queue = agent && agent.queue || []
    for (let i = 0; i < queue.length; i++) {
      const message = ai.readMessage(agentId, queue[i].messageId)
      const messageResponseId = message && message.meta && message.meta.responseId || null
      if (!isRuntimeContinuation(message)) continue
      if (responseId && messageResponseId === responseId) continue
      ai.dequeueMessage(agentId, message.id)
      ai.updateMessage(agentId, message.id, {
        status: 'stopped',
        completedAt: Date.now(),
        meta: Object.assign({}, message.meta, { stopReason: 'superseded', supersededByResponseId: responseId }),
      })
    }
  }

  function supersedeActiveRuntimeContinuation(agentId, responseId) {
    const active = runs[agentId] || waitingRuns[agentId]
    const input = active && active.request && active.request.input
    const inputResponseId = input && input.meta && input.meta.responseId || null
    if (!isRuntimeContinuation(input) || inputResponseId === responseId) return false
    return stopRun(agentId, 'queued', 'superseded')
  }

  function supersedeRuntimeContinuations(agentId, responseId) {
    supersedeActiveRuntimeContinuation(agentId, responseId)
    supersedeQueuedRuntimeContinuations(agentId, responseId)
  }

  function scheduleAgent(agentId) {
    let agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    if (!agent) return null
    if (runs[agent.id] || agent.status === 'running' || agent.status === 'waiting_approval') return null
    supersedeQueuedRuntimeContinuations(agent.id, foregroundResponseId(agent))
    agent = ai.findAgent(agent.id)
    if (!agent.queue || !agent.queue.length) {
      enqueueInboxContinuation(agent)
      agent = ai.findAgent(agent.id)
    }
    if (!agent.queue || !agent.queue.length) {
      if (agent.status === 'queued') ai.setAgentStatus(agent.id, { status: 'idle', statusText: '', activeMessageId: null, activeQuestId: null })
      return null
    }
    if (!canStartRun(agent.id)) {
      ai.setAgentStatus(agent.id, { status: 'queued', statusText: '', activeMessageId: null, activeQuestId: null })
      return null
    }
    const queue = agent.queue || []
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
    if (isForegroundInput(message)) supersedeRuntimeContinuations(agent.id, messageMeta.responseId)
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
    supersedeRuntimeContinuations(target.id, messageMeta.responseId)
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

  function runStatusText(input) {
    const content = input && input.content
    if (content == null) return ''
    const supported = typeof content === 'string' || Array.isArray(content) || content.type === 'rich-prompt'
    if (!supported) return ''
    const text = ai.messageText ? ai.messageText(content) : String(content)
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
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
    if (next.maxConcurrentTools != null) runtimeConfig.maxConcurrentTools = next.maxConcurrentTools
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
  ai.response = ai.response || {}
  ai.message.send = function (agentId, spec) { return queueMessage(agentId, spec || {}, (spec && spec.from) || 'user') }
  ai.agent.send = sendAgentQuest
  ai.quest.cancel = cancelQuest
  ai.response.read = readResponse
  ai.response.stop = stopResponse
})(window.aiditor = window.aiditor || {})

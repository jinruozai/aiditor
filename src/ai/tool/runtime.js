// AI Host Tool-call lifecycle and run context.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  let nextToolCallId = 1
  let nextToolExecutionId = 1

  function makeToolCall(spec, actor) {
    spec = spec || {}
    return {
      id: spec.id || 'tc_' + Date.now().toString(36) + '_' + nextToolCallId++,
      providerCallId: spec.providerCallId || null,
      providerName: spec.providerName || null,
      providerToolId: spec.providerToolId || null,
      providerArgs: Object.prototype.hasOwnProperty.call(spec, 'providerArgs') ? spec.providerArgs : null,
      toolId: spec.toolId || spec.name || spec.tool || '',
      name: spec.name || spec.toolId || spec.tool || '',
      args: Object.prototype.hasOwnProperty.call(spec, 'args') ? spec.args : {},
      executorToolId: spec.executorToolId || null,
      executorArgs: Object.prototype.hasOwnProperty.call(spec, 'executorArgs') ? spec.executorArgs : null,
      status: spec.status || 'proposed',
      executionId: spec.executionId || null,
      approvalPhase: spec.approvalPhase || null,
      actor: actor || spec.actor || 'user',
      messageId: spec.messageId || null,
      preview: spec.preview || null,
      result: spec.result || null,
      applyResult: spec.applyResult || null,
      error: spec.error || null,
      createdAt: spec.createdAt || Date.now(),
      updatedAt: spec.updatedAt || Date.now(),
      meta: spec.meta || {},
    }
  }

  function traceTool(found, type, status, summary, meta) {
    const runId = found && found.message && found.message.meta && found.message.meta.runId || null
    if (ai.trace && ai.trace.append) {
      ai.trace.append({
        type: type,
        runId: runId,
        traceId: runId,
        agentId: found && found.agent && found.agent.id || null,
        messageId: found && found.message && found.message.id || null,
        questId: found && found.message && found.message.resultForQuestId || null,
        entry: found && found.toolCall && found.toolCall.toolId || '',
        phase: 'tool',
        status: status || '',
        summary: summary || '',
        meta: meta || null,
      })
    }
  }

  function normalizeToolStatus(status) {
    return status || 'proposed'
  }

  function canTransition(from, to) {
    const status = normalizeToolStatus(from)
    if (to === 'previewing') return status === 'proposed'
    if (to === 'previewed') return status === 'proposed'
    if (to === 'approved') return status === 'proposed' || status === 'previewed'
    if (to === 'rejected') return status === 'proposed' || status === 'previewed' || status === 'approved'
    if (to === 'running') return status === 'approved'
    if (to === 'completed') return status === 'running'
    if (to === 'failed') return status === 'previewing' || status === 'running' || status === 'applying'
    if (to === 'applying') return status === 'completed' || status === 'approved' || status === 'previewed'
    if (to === 'applied') return status === 'applying'
    return false
  }

  function updateToolCall(agentId, callId, patch) {
    let out = null
    ai.updateAgent(agentId, {
      messages: ai.findAgent(agentId).messages.map(function (message) {
        const calls = message.toolCalls || []
        let changed = false
        const nextCalls = calls.map(function (call) {
          if (call.id !== callId) return call
          changed = true
          out = Object.assign({}, call, patch || {}, { updatedAt: Date.now() })
          return out
        })
        return changed ? Object.assign({}, message, { toolCalls: nextCalls }) : message
      }),
    })
    return out
  }

  function findToolCall(agentId, callId) {
    const agent = ai.findAgent(agentId)
    const messages = agent.messages
    for (let i = 0; i < messages.length; i++) {
      const calls = messages[i].toolCalls || []
      for (let j = 0; j < calls.length; j++) {
        if (calls[j].id === callId) return { agent: agent, message: messages[i], toolCall: calls[j] }
      }
    }
    return null
  }

  function attachToolCalls(agentId, messageId, calls, actor) {
    let out = []
    ai.updateAgent(agentId, {
      messages: ai.findAgent(agentId).messages.map(function (message) {
        if (message.id !== messageId) return message
        out = (calls || []).map(function (call) {
          return makeToolCall(Object.assign({}, call, { messageId: messageId }), actor)
        })
        return Object.assign({}, message, { toolCalls: (message.toolCalls || []).concat(out) })
      }),
    })
    return out
  }

  function createToolCall(agentId, spec, actor) {
    const message = spec.messageId
      ? null
      : ai.appendMessage(agentId, {
        from: actor || 'user',
        role: 'assistant',
        content: '',
        status: 'done',
        toolCalls: [],
      })
    return attachToolCalls(agentId, spec.messageId || message.id, [spec], actor || 'user')[0]
  }

  function createToolContext(found, actor, signal) {
    const ctx = {
      ai: ai,
      actor: actor || found.toolCall.actor || 'user',
      agent: found.agent,
      message: found.message,
      toolCall: found.toolCall,
      runId: found.message && found.message.meta && found.message.meta.runId || null,
      signal: signal || null,
      workspace: ai.currentWorkspace ? ai.currentWorkspace() : null,
      workspaceMeta: ai.workspaceMeta ? ai.workspaceMeta() : null,
      tools: ai.tools,
      skills: ai.skills,
      canRead: function (scope) { return ai.canRead(actor || found.toolCall.actor || 'user', found.agent.id, scope || 'agent.full') },
      canApply: function () { return toolPermissionDecision(found, actor || found.toolCall.actor || 'user', 'apply').allowed === true },
    }
    return ctx
  }

  function toolExecutorId(call) {
    return call.executorToolId || call.toolId
  }

  function toolExecutorArgs(call) {
    return call.executorArgs == null ? call.args : call.executorArgs
  }

  function callToolPhase(agentId, callId, actor, phase, signal) {
    const found = findToolCall(agentId, callId)
    if (!found) return null
    const ctx = createToolContext(found, actor, signal)
    const input = phase === 'apply'
      ? (found.toolCall.result || found.toolCall.preview || toolExecutorArgs(found.toolCall))
      : toolExecutorArgs(found.toolCall)
    return invokeTool(toolExecutorId(found.toolCall), input, ctx, phase)
  }

  function invokeTool(name, args, ctx, phase) {
    const tool = ai.tools.get(name)
    if (!tool) {
      const error = new Error('Tool not found: ' + name)
      error.code = 'TOOL_NOT_FOUND'
      throw error
    }
    if (!ai.tools.available(name, ctx || {})) {
      const error = new Error('Tool is not currently available: ' + name)
      error.code = 'TOOL_UNAVAILABLE'
      throw error
    }
    const method = phase || 'run'
    const fn = tool[method]
    if (!fn) {
      const error = new Error('Tool does not support phase "' + method + '": ' + name)
      error.code = 'TOOL_PHASE_UNAVAILABLE'
      throw error
    }
    if (method !== 'apply') {
      const validation = ai.schema.validate(args, ai.tools.schema(name, ctx || {}))
      if (!validation.valid) {
        const first = validation.error
        const error = new Error('Tool arguments do not match the schema for "' + name + '" at ' + first.path + ': ' + first.message)
        error.code = 'TOOL_ARGUMENTS_SCHEMA_INVALID'
        error.toolName = name
        error.schemaErrors = validation.errors
        throw error
      }
    }
    return fn(args, ctx || {})
  }

  function invokeToolPhase(agentId, callId, actor, phase, options) {
    const found = findToolCall(agentId, callId)
    const tool = ai.tools.get(toolExecutorId(found.toolCall))
    const parentSignal = options && options.signal || null
    const task = function (signal) { return callToolPhase(agentId, callId, actor, phase, signal) }
    if (parentSignal || tool.timeoutMs) return ai.toolScheduler.runWithDeadline(tool, parentSignal, task)
    return task(null)
  }

  function beginToolExecution(agentId, callId, status) {
    const executionId = 'texec_' + Date.now().toString(36) + '_' + nextToolExecutionId++
    const call = updateToolCall(agentId, callId, { status: status, executionId: executionId, approvalPhase: null })
    return { call: call, executionId: executionId }
  }

  function settleToolExecution(agentId, callId, executionId, expectedStatus, patch) {
    const current = findToolCall(agentId, callId)
    if (!current || current.toolCall.executionId !== executionId || current.toolCall.status !== expectedStatus) {
      return current && current.toolCall || null
    }
    return updateToolCall(agentId, callId, Object.assign({ executionId: null }, patch || {}))
  }

  function errorMessage(value, fallback) {
    if (!value) return fallback || 'Tool failed'
    if (typeof value === 'string') return value
    if (value.message) return String(value.message)
    if (value.error) return String(value.error)
    return serialize(value)
  }

  function recoverHint(code, toolId) {
    if (code === 'BASE_HASH_MISMATCH') return 'Read the current resource again, then retry with the new hash.'
    if (code === 'WORKSPACE_REQUIRED') return 'Ask the user to open or select a workspace before writing files.'
    if (code === 'FILE_NOT_FOUND') return 'Check the path with list/search tools, then retry with an existing path or create the file first.'
    if (code === 'INVALID_JSON') return 'Fix the JSON syntax and retry.'
    if (code === 'INVALID_JAVASCRIPT') return 'Fix the JavaScript syntax and retry.'
    if (code === 'PERMISSION_DENIED') {
      const tool = ai.tools && ai.tools.get(toolId)
      return tool && tool.permissionDeniedHint
        ? tool.permissionDeniedHint
        : 'Stop and ask the user or owning agent for the required permission; do not retry equivalent actions through another Tool.'
    }
    return ''
  }

  function failureEnvelope(toolId, value) {
    const message = errorMessage(value, 'Tool failed')
    const code = value && value.code ? String(value.code) : 'TOOL_FAILED'
    const out = {
      ok: false,
      code: code,
      message: message,
    }
    const hint = value && value.hint ? String(value.hint) : recoverHint(code, toolId)
    if (hint) out.hint = hint
    return out
  }

  function resultFailed(result) {
    return !!(result && typeof result === 'object' && (result.ok === false || result.status === 'failed'))
  }

  function failToolExecution(agentId, callId, found, err, phase, executionId, expectedStatus) {
    if (err && err.code !== 'TOOL_CANCELLED' && aiditor.reportError) aiditor.reportError({ scope: 'ai', tool: found.toolCall.toolId }, err)
    const envelope = failureEnvelope(found.toolCall.toolId, err)
    const patch = { status: 'failed', error: envelope.message, errorDetails: envelope }
    if (phase === 'preview') patch.preview = envelope
    else if (phase === 'apply') patch.applyResult = envelope
    else patch.result = envelope
    return settleToolExecution(agentId, callId, executionId, expectedStatus, patch)
  }

  function isPromiseLike(value) {
    return value && typeof value.then === 'function'
  }

  function serialize(value) {
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (_) { return String(value) }
  }

  function applySucceeded(result) {
    if (!result || typeof result !== 'object') return false
    return result.applied === true || result.status === 'applied'
  }

  function applyFailureMessage(result) {
    if (!result || typeof result !== 'object') return 'Tool apply did not report success'
    if (result.error) return String(result.error)
    const validation = result.validation || {}
    const errors = result.errors || validation.errors || []
    if (errors.length) {
      return errors.map(function (item) {
        return item && typeof item === 'object'
          ? ((item.path ? item.path + ': ' : '') + (item.message || serialize(item)))
          : String(item)
      }).join('\n')
    }
    if (result.ok === false) return 'Tool apply returned ok=false'
    return 'Tool apply did not report success'
  }

  function previewFailureMessage(result) {
    if (!result || typeof result !== 'object') return 'Tool preview did not report success'
    if (result.error) return String(result.error)
    const validation = result.validation || {}
    const errors = result.errors || validation.errors || []
    if (errors.length) {
      return errors.map(function (item) {
        return item && typeof item === 'object'
          ? ((item.path ? item.path + ': ' : '') + (item.message || serialize(item)))
          : String(item)
      }).join('\n')
    }
    return 'Tool preview returned ok=false'
  }

  function permissionContext(found, actor) {
    return createToolContext(found, actor, null)
  }

  function toolPermissionDecision(found, actor, phase) {
    const call = found.toolCall
    const executorId = toolExecutorId(call)
    const ctx = permissionContext(found, actor)
    const targets = ai.tools.permissionTargets(executorId, toolExecutorArgs(call), ctx, phase)
    const runId = ctx.runId
    const details = targets.map(function (target) {
      return Object.assign({
        runId: runId,
        traceId: runId,
        messageId: found.message && found.message.id || null,
        executorToolId: executorId,
      }, target, {
        entry: target.entry === executorId ? call.toolId : target.entry,
      })
    })
    return ai.permissions.decideMany(actor, found.agent.id, phase === 'apply' ? 'tool.apply' : 'tool.call', details)
  }

  function getToolCallActionState(agentId, callId, actor) {
    const found = findToolCall(agentId, callId)
    if (!found) return null
    const call = found.toolCall
    const executorId = toolExecutorId(call)
    const tool = ai.tools.get(executorId)
    const who = actor || call.actor || 'user'
    const capabilities = ai.tools.capabilities(executorId)
    const previewDecision = toolPermissionDecision(found, who, 'preview')
    const runDecision = toolPermissionDecision(found, who, 'run')
    const applyDecision = toolPermissionDecision(found, who, 'apply')
    const status = normalizeToolStatus(call.status)
    return {
      toolCall: call,
      status: status,
      capabilities: capabilities,
      hasPreview: !!(tool && tool.preview),
      hasRun: !!(tool && tool.run),
      hasApply: !!(tool && tool.apply),
      previewDecision: previewDecision,
      runDecision: runDecision,
      applyDecision: applyDecision,
      canPreview: !!(tool && tool.preview && previewDecision.allowed && canTransition(status, 'previewed')),
      canApprove: runDecision.allowed && canTransition(status, 'approved'),
      canReject: canTransition(status, 'rejected'),
      canRun: !!(tool && tool.run && runDecision.allowed && canTransition(status, 'running')),
      canApply: !!(tool && tool.apply && applyDecision.allowed && canTransition(status, 'applying')),
      callAllowed: runDecision.allowed,
      applyAllowed: applyDecision.allowed,
    }
  }

  function grantPhases(found) {
    const tool = ai.tools.get(toolExecutorId(found.toolCall))
    return tool && tool.apply ? ['run', 'apply'] : ['run']
  }

  function toolCallGrantDescriptors(found) {
    const phases = grantPhases(found)
    const out = []
    for (let i = 0; i < phases.length; i++) {
      const decision = toolPermissionDecision(found, found.toolCall.actor, phases[i])
      for (let j = 0; j < decision.checks.length; j++) out.push(decision.checks[j].ctx)
    }
    const seen = {}
    return out.filter(function (descriptor) {
      const key = ai.permissions.grantKey(descriptor)
      if (seen[key]) return false
      seen[key] = true
      return true
    })
  }

  function toolCallGrantIds(agentId, callId) {
    const found = findToolCall(agentId, callId)
    if (!found) return []
    const descriptors = toolCallGrantDescriptors(found)
    const keys = {}
    for (let i = 0; i < descriptors.length; i++) keys[ai.permissions.grantKey(descriptors[i])] = true
    return ai.permissions.grants(agentId).filter(function (grant) {
      return keys[ai.permissions.grantKey(grant)]
    }).map(function (grant) { return grant.id })
  }

  function isToolCallGranted(agentId, callId) {
    const found = findToolCall(agentId, callId)
    if (!found) return false
    return toolCallGrantIds(agentId, callId).length === toolCallGrantDescriptors(found).length
  }

  function setToolCallGranted(agentId, callId, allowed) {
    const found = findToolCall(agentId, callId)
    if (!found) return false
    if (allowed) {
      ai.permissions.grant(agentId, toolCallGrantDescriptors(found))
      return true
    }
    const ids = toolCallGrantIds(agentId, callId)
    for (let i = 0; i < ids.length; i++) ai.permissions.revoke(agentId, ids[i])
    return true
  }

  function failToolCall(agentId, callId, value, phase) {
    const found = findToolCall(agentId, callId)
    if (!found) return null
    const envelope = failureEnvelope(found.toolCall.toolId, value)
    traceTool(found, 'tool_completed', 'failed', envelope.message)
    return updateToolCall(agentId, callId, {
      status: 'failed',
      executionId: null,
      approvalPhase: null,
      error: envelope.message,
      errorDetails: envelope,
      result: phase === 'apply' ? found.toolCall.result : envelope,
      applyResult: phase === 'apply' ? envelope : found.toolCall.applyResult,
    })
  }

  function previewToolCall(agentId, callId, actor, options) {
    const state = getToolCallActionState(agentId, callId, actor || 'user')
    if (!state || !state.canPreview) return null
    const found = findToolCall(agentId, callId)
    const execution = beginToolExecution(agentId, callId, 'previewing')
    try {
      traceTool(found, 'tool_preview_started', 'previewing', found.toolCall.toolId)
      const result = invokeToolPhase(agentId, callId, actor || state.toolCall.actor || 'user', 'preview', options)
      if (isPromiseLike(result)) {
        const promise = Promise.resolve(result).then(function (done) {
          if (resultFailed(done)) {
            traceTool(found, 'tool_preview_completed', 'failed', previewFailureMessage(done))
            return settleToolExecution(agentId, callId, execution.executionId, 'previewing', { status: 'failed', preview: done, error: previewFailureMessage(done), errorDetails: failureEnvelope(found.toolCall.toolId, done) })
          }
          traceTool(found, 'tool_preview_completed', 'previewed', found.toolCall.toolId)
          return settleToolExecution(agentId, callId, execution.executionId, 'previewing', { status: 'previewed', preview: done, error: null })
        }, function (err) {
          traceTool(found, 'tool_preview_completed', 'failed', errorMessage(err))
          return failToolExecution(agentId, callId, found, err, 'preview', execution.executionId, 'previewing')
        })
        return { toolCall: findToolCall(agentId, callId).toolCall, promise: promise }
      }
      if (resultFailed(result)) {
        traceTool(found, 'tool_preview_completed', 'failed', previewFailureMessage(result))
        return settleToolExecution(agentId, callId, execution.executionId, 'previewing', { status: 'failed', preview: result, error: previewFailureMessage(result), errorDetails: failureEnvelope(found.toolCall.toolId, result) })
      }
      traceTool(found, 'tool_preview_completed', 'previewed', found.toolCall.toolId)
      return settleToolExecution(agentId, callId, execution.executionId, 'previewing', { status: 'previewed', preview: result, error: null })
    } catch (err) {
      traceTool(found, 'tool_preview_completed', 'failed', errorMessage(err))
      return failToolExecution(agentId, callId, found, err, 'preview', execution.executionId, 'previewing')
    }
  }

  function approveToolCall(agentId, callId, actor) {
    const state = getToolCallActionState(agentId, callId, actor || 'user')
    return state && state.canApprove
      ? updateToolCall(agentId, callId, { status: 'approved', approvalPhase: null })
      : null
  }

  function rejectToolCall(agentId, callId, reason, actor) {
    const state = getToolCallActionState(agentId, callId, actor || 'user')
    return state && state.canReject
      ? updateToolCall(agentId, callId, { status: 'rejected', approvalPhase: null, error: reason || null })
      : null
  }

  function requestToolCallApproval(agentId, callId, phase) {
    return updateToolCall(agentId, callId, { approvalPhase: phase === 'apply' ? 'apply' : 'run' })
  }

  function runToolCall(agentId, callId, actor, options) {
    const found = findToolCall(agentId, callId)
    const state = getToolCallActionState(agentId, callId, actor || (found && found.toolCall.actor) || 'user')
    if (!found || !state || !state.canRun) return null
    const execution = beginToolExecution(agentId, callId, 'running')
    traceTool(found, 'tool_run_started', 'running', found.toolCall.toolId)
    const promise = Promise.resolve().then(function () {
      return invokeToolPhase(agentId, callId, actor || found.toolCall.actor || 'user', 'run', options)
    }).then(function (result) {
      if (resultFailed(result)) {
        traceTool(found, 'tool_run_completed', 'failed', errorMessage(result))
        return settleToolExecution(agentId, callId, execution.executionId, 'running', { status: 'failed', result: result, error: errorMessage(result), errorDetails: failureEnvelope(found.toolCall.toolId, result) })
      }
      traceTool(found, 'tool_run_completed', 'completed', found.toolCall.toolId)
      return settleToolExecution(agentId, callId, execution.executionId, 'running', { status: 'completed', result: result, error: null })
    }, function (err) {
      traceTool(found, 'tool_run_completed', 'failed', errorMessage(err))
      return failToolExecution(agentId, callId, found, err, 'run', execution.executionId, 'running')
    })
    return { toolCall: findToolCall(agentId, callId).toolCall, promise: promise }
  }

  function applyToolCall(agentId, callId, actor, options) {
    const found = findToolCall(agentId, callId)
    const state = getToolCallActionState(agentId, callId, actor || (found && found.toolCall.actor) || 'user')
    if (!found || !state || !state.canApply) return null
    const execution = beginToolExecution(agentId, callId, 'applying')
    traceTool(found, 'tool_apply_started', 'applying', found.toolCall.toolId)
    try {
      const result = invokeToolPhase(agentId, callId, actor || found.toolCall.actor || 'user', 'apply', options)
      if (!isPromiseLike(result)) {
        traceTool(found, 'tool_apply_completed', applySucceeded(result) ? 'applied' : 'failed', applySucceeded(result) ? found.toolCall.toolId : applyFailureMessage(result))
        return applySucceeded(result)
          ? settleToolExecution(agentId, callId, execution.executionId, 'applying', { status: 'applied', applyResult: result, error: null })
          : settleToolExecution(agentId, callId, execution.executionId, 'applying', { status: 'failed', applyResult: result, error: applyFailureMessage(result), errorDetails: failureEnvelope(found.toolCall.toolId, result) })
      }
      const promise = Promise.resolve(result).then(function (done) {
        traceTool(found, 'tool_apply_completed', applySucceeded(done) ? 'applied' : 'failed', applySucceeded(done) ? found.toolCall.toolId : applyFailureMessage(done))
        return applySucceeded(done)
          ? settleToolExecution(agentId, callId, execution.executionId, 'applying', { status: 'applied', applyResult: done, error: null })
          : settleToolExecution(agentId, callId, execution.executionId, 'applying', { status: 'failed', applyResult: done, error: applyFailureMessage(done), errorDetails: failureEnvelope(found.toolCall.toolId, done) })
      }, function (err) {
        traceTool(found, 'tool_apply_completed', 'failed', errorMessage(err))
        return failToolExecution(agentId, callId, found, err, 'apply', execution.executionId, 'applying')
      })
      return { toolCall: findToolCall(agentId, callId).toolCall, promise: promise }
    } catch (err) {
      traceTool(found, 'tool_apply_completed', 'failed', errorMessage(err))
      return failToolExecution(agentId, callId, found, err, 'apply', execution.executionId, 'applying')
    }
  }

  function cancelRunToolCalls(agentId, runId, reason) {
    const agent = ai.findAgent(agentId)
    let cancelled = 0
    ai.updateAgent(agentId, {
      messages: agent.messages.map(function (message) {
        if (!message.meta || message.meta.runId !== runId || !(message.toolCalls || []).length) return message
        let changed = false
        const calls = message.toolCalls.map(function (call) {
          if (call.status === 'applied' || call.status === 'completed' || call.status === 'failed' || call.status === 'rejected') return call
          changed = true
          cancelled++
          const error = reason || 'Tool call was cancelled'
          return Object.assign({}, call, {
            status: 'failed',
            executionId: null,
            approvalPhase: null,
            error: error,
            errorDetails: failureEnvelope(call.toolId, { code: 'TOOL_CANCELLED', message: error }),
            updatedAt: Date.now(),
          })
        })
        return changed ? Object.assign({}, message, { toolCalls: calls }) : message
      }),
    })
    return cancelled
  }

  function createRunContext(request, controller) {
    const actor = request.actor || 'user'
    const ctx = {
      ai: ai,
      agent: request.agent,
      actor: actor,
      runId: request.runId,
      signal: controller.signal,
      tools: ai.tools,
      skills: ai.skills,
      context: {},
      canReadPath: function (path) { return ai.canReadPath(request.agent, path) },
      canWritePath: function (path) { return ai.canWritePath(request.agent, path) },
      canRead: function (targetId, scope) { return ai.canRead(actor, targetId || request.agent.id, scope || 'agent.full') },
      canSend: function (targetId) { return ai.canSend(actor, targetId || request.agent.id) },
      canManage: function (targetId) { return ai.canManage(actor, targetId || request.agent.id) },
    }
    ctx.context = request.runtimeContext || ai.collectContext(request, ctx)
    return ctx
  }

  ai.createToolCall = createToolCall
  ai.attachToolCalls = attachToolCalls
  ai.findToolCall = findToolCall
  ai.previewToolCall = previewToolCall
  ai.approveToolCall = approveToolCall
  ai.rejectToolCall = rejectToolCall
  ai.requestToolCallApproval = requestToolCallApproval
  ai.runToolCall = runToolCall
  ai.applyToolCall = applyToolCall
  ai.getToolCallActionState = getToolCallActionState
  ai.isToolCallGranted = isToolCallGranted
  ai.setToolCallGranted = setToolCallGranted
  ai.failToolCall = failToolCall
  ai.cancelRunToolCalls = cancelRunToolCalls
  ai.createRunContext = createRunContext
  ai.tools.invoke = invokeTool
})(window.aiditor = window.aiditor || {})

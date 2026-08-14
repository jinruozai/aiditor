// aiditor.ai built-in agent orchestration tools.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const META = { owner: 'aiditor.ai.orchestration', layer: 'builtin', source: 'builtin' }

  function clone(value) {
    return value == null ? value : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(value) : structuredClone(value))
  }

  function actor(ctx) {
    return ctx.actor || (ctx.toolCall && ctx.toolCall.actor) || (ctx.agent && ctx.agent.id) || 'user'
  }

  function caller(ctx) {
    return (ctx.toolCall && ctx.toolCall.actor) || actor(ctx)
  }

  function parentResolutionError(message) {
    const error = new Error(message)
    error.code = 'AGENT_PARENT_RESOLUTION_FAILED'
    return error
  }

  function questAccessError(args, ctx) {
    const who = actor(ctx)
    const agentId = args && args.agentId || ''
    const questId = args && args.questId || ''
    let code = 'QUEST_UNAVAILABLE'
    let message = 'Quest is unavailable to the current agent'
    if (who === 'user') {
      if (!ai.findAgent(agentId)) {
        code = 'AGENT_NOT_FOUND'
        message = 'Agent not found: ' + agentId
      } else if (!ai.findQuest(agentId, questId)) {
        code = 'QUEST_NOT_FOUND'
        message = 'Quest not found: ' + questId
      }
    }
    const error = new Error(message)
    error.code = code
    error.hint = code === 'QUEST_UNAVAILABLE'
      ? 'Use the agentId and questId returned by agent.delegate or agent.send, and read only quests delegated by this agent.'
      : 'Check the agentId and questId returned by the originating delegation.'
    error.details = { agentId: agentId, questId: questId }
    return error
  }

  function sourceResponseId(ctx) {
    return ctx && ctx.message && ctx.message.meta && ctx.message.meta.responseId || null
  }

  function requireRead(ctx, agentId) {
    if (!ai.canRead(actor(ctx), agentId, 'agent.full')) throw new Error('Permission denied')
  }

  function requireSend(ctx, agentId) {
    if (!ai.canSend(actor(ctx), agentId)) throw new Error('Permission denied')
  }

  function requireManage(ctx, agentId) {
    if (!ai.canManage(actor(ctx), agentId)) throw new Error('Permission denied')
  }

  function requireConfigure(ctx, agentId) {
    if (actor(ctx) === agentId) throw new Error('Permission denied: agents cannot configure themselves')
    requireManage(ctx, agentId)
  }

  function requireManageOrSelf(ctx, agentId) {
    if (actor(ctx) !== agentId) requireManage(ctx, agentId)
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key)
  }

  function agentDepth(agentId) {
    let depth = 0
    let current = ai.findAgent(agentId)
    while (current && current.parentAgentId) {
      depth++
      current = ai.findAgent(current.parentAgentId)
    }
    return depth
  }

  function subtreeHeight(agentId) {
    if (!agentId) return 0
    const agents = ai.agents.peek()
    let height = 0
    for (let i = 0; i < agents.length; i++) {
      if (!ai.isDescendant(agentId, agents[i].id)) continue
      height = Math.max(height, agentDepth(agents[i].id) - agentDepth(agentId))
    }
    return height
  }

  function maxDelegationDepth() {
    const config = ai.runtimeConfig ? ai.runtimeConfig() : null
    const value = Number(config && config.maxDelegationDepth)
    return value > 0 ? value : 4
  }

  function resolveParentAgentId(args, ctx, movingAgentId) {
    const who = caller(ctx)
    const explicit = hasOwn(args, 'parentAgentId')
    const parentAgentId = explicit ? (args.parentAgentId || null) : (who === 'user' ? null : who)
    if (who !== 'user' && !ai.findAgent(who)) throw parentResolutionError('Agent caller is no longer available: ' + who)
    if (parentAgentId && !ai.findAgent(parentAgentId)) throw parentResolutionError('Parent agent is not available: ' + parentAgentId)
    if (movingAgentId && parentAgentId && (parentAgentId === movingAgentId || ai.isDescendant(movingAgentId, parentAgentId))) {
      throw new Error('Agent tree cycle is not allowed')
    }
    if (who === 'user') {
      if (parentAgentId) requireManageOrSelf(ctx, parentAgentId)
      return parentAgentId
    }
    if (!parentAgentId) throw new Error('Permission denied: agents cannot create or move root agents')
    requireManageOrSelf(ctx, parentAgentId)
    const resultingDepth = agentDepth(parentAgentId) + 1 + subtreeHeight(movingAgentId)
    if (resultingDepth > maxDelegationDepth()) throw new Error('Delegation depth limit reached')
    return parentAgentId
  }

  function newAgentSpec(args, ctx, fallbackName) {
    const parentAgentId = resolveParentAgentId(args, ctx)
    const parent = parentAgentId && ai.findAgent(parentAgentId)
    const inherited = parent || ctx.agent || null
    return {
      name: args.name || fallbackName,
      parentAgentId: parentAgentId,
      connection: args.connection || (inherited && inherited.connection) || ai.defaultConnection || 'mock',
      model: args.model || (inherited && inherited.model) || '',
      systemPrompt: args.systemPrompt || '',
      outputSchema: args.outputSchema ? ai.schema.normalize(args.outputSchema, 'outputSchema') : null,
      contextRefs: clone(args.contextRefs || []),
      skillRefs: clone(args.skillRefs || []),
      permissionMode: inherited && inherited.permissionMode || 'auto',
      permissions: clone(inherited && inherited.permissions || null),
    }
  }

  function questSummary(agentId, quest) {
    return {
      agentId: agentId,
      questId: quest.id,
      fromAgentId: quest.fromAgentId || null,
      status: quest.status,
      resultId: quest.resultMessageId || null,
      summary: quest.summary || '',
      goal: quest.goal || '',
      currentStepId: quest.currentStepId || null,
      budget: clone(quest.budget || null),
      usage: clone(quest.usage || null),
      stopReason: quest.stopReason || null,
      createdAt: quest.createdAt,
      startedAt: quest.startedAt || null,
      completedAt: quest.completedAt || null,
    }
  }

  function agentSummary(agent, profile) {
    const out = {
      id: agent.id,
      name: agent.name,
      parentAgentId: agent.parentAgentId || null,
      order: agent.order,
      connection: agent.connection,
      model: agent.model,
      permissionMode: agent.permissionMode,
      status: agent.status,
      statusText: agent.statusText || '',
      activeMessageId: agent.activeMessageId || null,
      activeQuestId: agent.activeQuestId || null,
      queuedCount: (agent.queue || []).length,
      unreadInboxCount: (agent.inbox || []).filter(function (event) { return !event.consumed }).length,
      recentQuests: (agent.quests || []).slice(-8).map(function (quest) { return questSummary(agent.id, quest) }),
      contextRefs: clone(agent.contextRefs || []),
      skillRefs: clone(agent.skillRefs || []),
      permissions: clone(agent.permissions),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }
    if (profile) {
      out.systemPrompt = agent.systemPrompt || ''
      out.outputSchema = clone(agent.outputSchema || null)
    }
    return out
  }

  function readAgent(args, ctx) {
    if (args && args.agentId) {
      if (hasOwn(args, 'parentAgentId') || args.recursive) throw new Error('agentId cannot be combined with parentAgentId or recursive')
      requireRead(ctx, args.agentId)
      const agent = ai.findAgent(args.agentId)
      if (!agent) throw new Error('Agent not found')
      return agentSummary(agent, true)
    }
    const who = actor(ctx)
    const explicitParent = hasOwn(args, 'parentAgentId')
    const parentAgentId = explicitParent ? (args.parentAgentId || null) : (who === 'user' ? null : who)
    if (parentAgentId && !ai.findAgent(parentAgentId)) throw new Error('Agent not found')
    if (who !== 'user') {
      if (!parentAgentId) throw new Error('Permission denied: agents cannot inspect root agents')
      requireRead(ctx, parentAgentId)
    } else if (parentAgentId) {
      requireRead(ctx, parentAgentId)
    }
    const agents = ai.agents.peek()
    const out = []
    for (let i = 0; i < agents.length; i++) {
      const inScope = args.recursive
        ? (parentAgentId ? ai.isDescendant(parentAgentId, agents[i].id) : true)
        : (agents[i].parentAgentId || null) === parentAgentId
      if (inScope && ai.canRead(who, agents[i].id, 'agent.summary')) out.push(agentSummary(agents[i], false))
    }
    return out
  }

  function createAgentPreview(args, ctx) {
    const existingNames = ai.agents.peek().map(function (agent) { return agent.name })
    return {
      action: 'create',
      kind: 'agent',
      agent: newAgentSpec(args, ctx, ai.generateAgentName(existingNames)),
    }
  }

  function validateAgentCreation(args, ctx) {
    const spec = args && args.agent
    if (!spec) throw parentResolutionError('Agent creation preview is missing')
    const who = caller(ctx)
    const input = ctx && ctx.toolCall && ctx.toolCall.args || {}
    const explicit = hasOwn(input, 'parentAgentId')
    const expected = explicit ? (input.parentAgentId || null) : (who === 'user' ? null : who)
    if ((spec.parentAgentId || null) !== expected) {
      throw parentResolutionError('Agent parent no longer matches the originating ToolCall')
    }
    resolveParentAgentId(input, ctx)
    return expected
  }

  function createAgentApply(args, ctx) {
    const parentAgentId = validateAgentCreation(args, ctx)
    const spec = clone(args.agent)
    spec.parentAgentId = parentAgentId
    spec.select = false
    const agent = ai.createAgent(spec)
    return Object.assign({ applied: true }, agentSummary(agent, true))
  }

  const AGENT_CONFIG_KEYS = ['name', 'connection', 'model', 'systemPrompt', 'outputSchema', 'contextRefs', 'skillRefs']

  function validateRegisteredRefs(ids, registry, label) {
    for (let i = 0; i < ids.length; i++) {
      if (!registry.get(ids[i])) throw new Error('Unknown ' + label + ': ' + ids[i])
    }
  }

  function agentConfigPatch(args) {
    const patch = {}
    for (let i = 0; i < AGENT_CONFIG_KEYS.length; i++) {
      const key = AGENT_CONFIG_KEYS[i]
      if (hasOwn(args, key)) patch[key] = clone(args[key])
    }
    if (!Object.keys(patch).length) throw new Error('No agent configuration changes provided')
    if (hasOwn(patch, 'name') && !String(patch.name || '').trim()) throw new Error('Agent name cannot be empty')
    if (hasOwn(patch, 'connection') && !ai.getConnection(patch.connection)) throw new Error('Unknown connection: ' + patch.connection)
    if (hasOwn(patch, 'outputSchema') && patch.outputSchema) patch.outputSchema = ai.schema.normalize(patch.outputSchema, 'outputSchema')
    if (patch.skillRefs) validateRegisteredRefs(patch.skillRefs, ai.skills, 'skill')
    return patch
  }

  function configureAgentPreview(args, ctx) {
    const agent = ai.findAgent(args.agentId)
    if (!agent) throw new Error('Agent not found')
    requireConfigure(ctx, agent.id)
    return {
      action: 'configure',
      kind: 'agent',
      agentId: agent.id,
      before: agentSummary(agent, true),
      changes: agentConfigPatch(args),
    }
  }

  function configureAgentApply(args) {
    const agent = ai.updateAgent(args.agentId, clone(args.changes))
    if (!agent) throw new Error('Agent not found')
    return Object.assign({ applied: true }, agentSummary(agent, true))
  }

  function delegateAgentPreview(args, ctx) {
    const target = args.agentId ? ai.findAgent(args.agentId) : null
    if (args.agentId) {
      if (!target) throw new Error('Agent not found')
      const creationKeys = ['name', 'parentAgentId', 'connection', 'model', 'systemPrompt', 'outputSchema', 'skillRefs']
      for (let i = 0; i < creationKeys.length; i++) {
        if (hasOwn(args, creationKeys[i])) throw new Error('Agent configuration is only valid when delegate creates a new agent')
      }
      requireSend(ctx, target.id)
      return {
        action: 'delegate',
        kind: 'agent',
        agentId: target.id,
        content: args.content || '',
        contextRefs: clone(args.contextRefs || []),
        attachments: clone(args.attachments || []),
        meta: clone(args.meta || null),
        interrupt: !!args.interrupt,
        budget: clone(args.budget || null),
      }
    }
    return {
      action: 'delegate',
      kind: 'agent',
      agent: newAgentSpec(Object.assign({}, args, { contextRefs: [] }), ctx, 'Agent'),
      content: args.content || '',
      contextRefs: clone(args.contextRefs || []),
      attachments: clone(args.attachments || []),
      meta: clone(args.meta || null),
      interrupt: !!args.interrupt,
      budget: clone(args.budget || null),
    }
  }

  function delegateAgentApply(args, ctx) {
    const agent = args.agentId ? ai.findAgent(args.agentId) : createAgentApply({ agent: args.agent }, ctx)
    if (!agent) throw new Error('Agent not found')
    const sent = ai.agent.send(agent.id, {
      fromAgentId: caller(ctx) === 'user' ? null : caller(ctx),
      sourceResponseId: sourceResponseId(ctx),
      content: args.content || '',
      contextRefs: clone(args.contextRefs || []),
      attachments: clone(args.attachments || []),
      meta: clone(args.meta || null),
      interrupt: !!args.interrupt,
      budget: clone(args.budget || null),
    })
    return {
      applied: true,
      agent: agentSummary(ai.findAgent(agent.id), false),
      agentId: agent.id,
      questId: sent && sent.questId,
      messageId: sent && sent.messageId,
      status: sent && sent.status,
    }
  }

  function reparentAgentPreview(args, ctx) {
    const agent = ai.findAgent(args.agentId)
    if (!agent) throw new Error('Agent not found')
    requireManage(ctx, agent.id)
    const parentAgentId = resolveParentAgentId(args, ctx, agent.id)
    return {
      action: 'reparent',
      kind: 'agent',
      agentId: agent.id,
      fromParentAgentId: agent.parentAgentId || null,
      toParentAgentId: parentAgentId,
      order: args.order == null ? agent.order : args.order,
    }
  }

  function reparentAgentApply(args) {
    const parentAgentId = args.toParentAgentId || args.parentAgentId || null
    const agent = ai.reparentAgent(args.agentId, parentAgentId, args.order)
    return Object.assign({ applied: true }, agentSummary(agent, false))
  }

  function deleteAgentPreview(args, ctx) {
    const agent = ai.findAgent(args.agentId)
    if (!agent) throw new Error('Agent not found')
    requireManage(ctx, agent.id)
    return {
      action: 'delete',
      kind: 'agent',
      agent: agentSummary(agent, false),
      descendantAgentIds: ai.agents.peek().filter(function (item) {
        return item.id !== agent.id && ai.isDescendant(agent.id, item.id)
      }).map(function (item) { return item.id }),
    }
  }

  function deleteAgentApply(args) {
    const agent = ai.deleteAgent(args.agent && args.agent.id)
    return Object.assign({ applied: true }, agent ? agentSummary(agent, false) : {})
  }

  function sendAgent(args, ctx) {
    requireSend(ctx, args.agentId)
    return ai.agent.send(args.agentId, {
      fromAgentId: actor(ctx) === 'user' ? null : actor(ctx),
      sourceResponseId: sourceResponseId(ctx),
      content: args.content || '',
      contextRefs: clone(args.contextRefs || []),
      attachments: clone(args.attachments || []),
      meta: clone(args.meta || null),
      interrupt: !!args.interrupt,
      budget: clone(args.budget || null),
    })
  }

  function readQuest(args, ctx) {
    if (args.questId) {
      const result = ai.quest.read(args.agentId, args.questId, actor(ctx))
      if (!result) throw questAccessError(args, ctx)
      return result
    }
    const agent = ai.findAgent(args.agentId)
    if (!agent) throw new Error('Agent not found')
    requireRead(ctx, agent.id)
    const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit) || 20)))
    const quests = (agent.quests || []).slice().reverse()
    const out = []
    for (let i = 0; i < quests.length && out.length < limit; i++) {
      if (args.status && quests[i].status !== args.status) continue
      if (ai.quest.read(args.agentId, quests[i].id, actor(ctx))) out.push(questSummary(agent.id, quests[i]))
    }
    return out
  }

  function readQuestResult(args, ctx) {
    const result = ai.quest.result(args.agentId, args.questId, actor(ctx))
    if (!result) throw questAccessError(args, ctx)
    return result
  }

  function readMessage(args, ctx) {
    const result = ai.message.read(args.agentId, args.messageId, actor(ctx))
    if (!result) throw new Error('Message not found or permission denied')
    return result
  }

  function cancelQuest(args, ctx) {
    const result = ai.quest.cancel(args.agentId, args.questId, actor(ctx))
    if (!result) throw questAccessError(args, ctx)
    return result
  }

  function stopAgent(args, ctx) {
    requireManage(ctx, args.agentId)
    const before = ai.findAgent(args.agentId)
    if (!before) throw new Error('Agent not found')
    const previousStatus = before.status
    const questId = before.activeQuestId || null
    const messageId = before.activeMessageId || null
    const stopped = ai.stopAgent(args.agentId)
    const current = ai.findAgent(args.agentId)
    return {
      outcome: stopped ? 'stopped' : 'not_running',
      stopped: stopped,
      agentId: args.agentId,
      questId: questId,
      messageId: messageId,
      previousStatus: previousStatus,
      status: current.status,
      stopReason: stopped ? 'cancelled' : null,
    }
  }

  const RUN_BUDGET_SCHEMA = {
    type: 'object',
    properties: {
      maxTurns: { type: 'number', description: 'Maximum model request turns for this task.' },
      timeoutMs: { type: 'number', description: 'Maximum wall-clock execution time after the task starts.' },
      maxTokens: { type: 'number', description: 'Maximum reported provider tokens across this task.' },
    },
  }

  const STRING_ARRAY_SCHEMA = { type: 'array', items: { type: 'string' } }

  function agentTarget(args, ctx, phase) {
    return {
      target: args && (args.agentId || args.parentAgentId) || ctx && ctx.agent && ctx.agent.id || 'root',
      risk: phase === 'apply' ? 'write' : 'read',
    }
  }

  function mutableAgentTarget(args, ctx, phase) {
    const target = agentTarget(args, ctx, phase)
    if (phase === 'run') target.risk = 'write'
    return target
  }

  function questTarget(args, ctx, phase) {
    return {
      target: (args && args.agentId || ctx && ctx.agent && ctx.agent.id || '') + '/quest/' + (args && args.questId || '*'),
      risk: phase === 'run' && args && args.__readOnly !== true ? 'write' : 'read',
    }
  }

  ai.tools.register('agent.read', {
    title: 'Read Agents',
    description: 'Read one bounded agent profile by id, or list a tree level. Without arguments, agents see their direct children and the user sees root agents.',
    schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Exact agent profile to read.' },
        parentAgentId: { type: ['string', 'null'], description: 'Parent whose children should be listed.' },
        recursive: { type: 'boolean', description: 'Include the full readable subtree below parentAgentId.' },
      },
    },
    permissions: ['tool.call'],
    permissionTargets: agentTarget,
    isConcurrencySafe: function () { return true },
    run: readAgent,
  }, META)

  ai.tools.register('agent.create', {
    title: 'Create Agent',
    description: 'Create an AI agent after preview approval. Creation only creates the agent; if the user asked this agent to do work, continue with agent.send unless the request only asked for creation.',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentAgentId: { type: 'string', description: 'Parent agent id. Omit to create under the calling agent, or at root when called by the user.' },
        connection: { type: 'string' },
        model: { type: 'string' },
        systemPrompt: { type: 'string' },
        outputSchema: { type: 'object', description: 'JSON schema for the final assistant output.' },
        contextRefs: STRING_ARRAY_SCHEMA,
        skillRefs: STRING_ARRAY_SCHEMA,
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    permissionTargets: agentTarget,
    preview: createAgentPreview,
    apply: createAgentApply,
  }, META)

  ai.tools.register('agent.configure', {
    title: 'Configure Agent',
    description: 'Update the stable configuration of a descendant agent after preview approval. Changes affect future model requests, not an already running request.',
    schema: {
      type: 'object',
      required: ['agentId'],
      properties: {
        agentId: { type: 'string' },
        name: { type: 'string' },
        connection: { type: 'string' },
        model: { type: 'string' },
        systemPrompt: { type: 'string' },
        outputSchema: { type: ['object', 'null'], description: 'JSON schema for the final assistant output, or null to clear it.' },
        contextRefs: STRING_ARRAY_SCHEMA,
        skillRefs: STRING_ARRAY_SCHEMA,
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    permissionTargets: agentTarget,
    preview: configureAgentPreview,
    apply: configureAgentApply,
  }, META)

  ai.tools.register('agent.delegate', {
    title: 'Delegate Agent Task',
    description: 'Create or reuse an agent and send it a delegated task in one workflow. A new agent defaults under the calling agent, or at root when called by the user. Returns agentId and questId. Delegation does not force the parent to wait.',
    schema: {
      type: 'object',
      required: ['content'],
      properties: {
        agentId: { type: 'string' },
        name: { type: 'string' },
        parentAgentId: { type: 'string', description: 'Parent for a newly created agent. Omit to create under the calling agent, or at root when called by the user.' },
        connection: { type: 'string' },
        model: { type: 'string' },
        systemPrompt: { type: 'string', description: 'System instructions for a newly created delegated agent.' },
        outputSchema: { type: 'object', description: 'JSON schema for the newly created agent final outputs.' },
        skillRefs: STRING_ARRAY_SCHEMA,
        content: { type: 'string' },
        contextRefs: STRING_ARRAY_SCHEMA,
        attachments: { type: 'array' },
        interrupt: { type: 'boolean', description: 'Stop the target agent current quest and run this new quest first. False queues normally.' },
        budget: RUN_BUDGET_SCHEMA,
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    permissionTargets: agentTarget,
    isConcurrencySafe: function (args) { return !!(args && args.agentId) },
    preview: delegateAgentPreview,
    apply: delegateAgentApply,
  }, META)

  ai.tools.register('agent.reparent', {
    title: 'Reparent Agent',
    description: 'Move an agent under another agent. Only the user may move an agent to the root by passing null.',
    schema: {
      type: 'object',
      required: ['agentId', 'parentAgentId'],
      properties: {
        agentId: { type: 'string' },
        parentAgentId: { type: ['string', 'null'] },
        order: { type: 'number', description: 'Stable display order among siblings.' },
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    permissionTargets: agentTarget,
    preview: reparentAgentPreview,
    apply: reparentAgentApply,
  }, META)

  ai.tools.register('agent.delete', {
    title: 'Delete Agent',
    description: 'Delete an agent and its descendants after preview approval.',
    schema: { type: 'object', required: ['agentId'], properties: { agentId: { type: 'string' } } },
    permissions: ['tool.call', 'tool.apply'],
    permissionTargets: agentTarget,
    preview: deleteAgentPreview,
    apply: deleteAgentApply,
  }, META)

  ai.tools.register('agent.send', {
    title: 'Send Agent Message',
    description: 'Send a message to another agent. Returns a questId for this exact delegated task; prefer quest.result after the runtime reports completion.',
    schema: {
      type: 'object',
      required: ['agentId', 'content'],
      properties: {
        agentId: { type: 'string' },
        content: { type: 'string' },
        contextRefs: STRING_ARRAY_SCHEMA,
        attachments: { type: 'array' },
        interrupt: { type: 'boolean', description: 'Stop the target agent current quest and run this new quest first. False queues normally.' },
        budget: RUN_BUDGET_SCHEMA,
      },
    },
    permissions: ['tool.call'],
    permissionTargets: mutableAgentTarget,
    isConcurrencySafe: function () { return true },
    run: sendAgent,
  }, META)

  ai.tools.register('quest.read', {
    title: 'Read Quests',
    description: 'Read one quest by id, or omit questId to list a bounded set of readable quests for an agent.',
    schema: {
      type: 'object',
      required: ['agentId'],
      properties: {
        agentId: { type: 'string' },
        questId: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'stopped'] },
        limit: { type: 'number', description: 'Maximum results when listing. Defaults to 20 and is capped at 50.' },
      },
    },
    permissions: ['tool.call'],
    permissionTargets: function (args, ctx) {
      const target = questTarget(Object.assign({ __readOnly: true }, args || {}), ctx, 'run')
      return target
    },
    isConcurrencySafe: function () { return true },
    run: readQuest,
  }, META)

  ai.tools.register('quest.result', {
    title: 'Read Quest Result',
    description: 'Read a quest and, when completed, return its result message content in one call.',
    schema: {
      type: 'object',
      required: ['agentId', 'questId'],
      properties: {
        agentId: { type: 'string' },
        questId: { type: 'string' },
      },
    },
    permissions: ['tool.call'],
    permissionTargets: function (args, ctx) {
      const target = questTarget(Object.assign({ __readOnly: true }, args || {}), ctx, 'run')
      return target
    },
    isConcurrencySafe: function () { return true },
    run: readQuestResult,
  }, META)

  ai.tools.register('quest.cancel', {
    title: 'Cancel Quest',
    description: 'Cancel one exact queued or running quest without stopping unrelated work. Returns outcome cancelled or already_terminal.',
    schema: {
      type: 'object',
      required: ['agentId', 'questId'],
      properties: {
        agentId: { type: 'string' },
        questId: { type: 'string' },
      },
    },
    permissions: ['tool.call'],
    permissionTargets: questTarget,
    run: cancelQuest,
  }, META)

  ai.tools.register('message.read', {
    title: 'Read Message',
    description: 'Read one exact message by agent id and message id.',
    schema: {
      type: 'object',
      required: ['agentId', 'messageId'],
      properties: {
        agentId: { type: 'string' },
        messageId: { type: 'string' },
      },
    },
    permissions: ['tool.call'],
    permissionTargets: function (args) { return { target: args.agentId + '/message/' + args.messageId, risk: 'read' } },
    isConcurrencySafe: function () { return true },
    run: readMessage,
  }, META)

  ai.tools.register('agent.stop', {
    title: 'Stop Agent',
    description: 'Emergency-stop the agent current run. Returns outcome stopped or not_running; use quest.cancel when a specific delegated quest is known.',
    schema: { type: 'object', required: ['agentId'], properties: { agentId: { type: 'string' } } },
    permissions: ['tool.call'],
    permissionTargets: mutableAgentTarget,
    run: stopAgent,
  }, META)
})(window.aiditor = window.aiditor || {})

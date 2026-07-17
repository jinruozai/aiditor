// aiditor.ai built-in agent orchestration tools.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function clone(value) {
    return value == null ? value : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(value) : structuredClone(value))
  }

  function actor(ctx) {
    return ctx.actor || (ctx.toolCall && ctx.toolCall.actor) || 'user'
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
    const who = actor(ctx)
    const explicit = hasOwn(args, 'parentAgentId')
    const parentAgentId = explicit ? (args.parentAgentId || null) : (who === 'user' ? null : who)
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
      contextRefs: clone(args.contextRefs || []),
      skillRefs: clone(args.skillRefs || []),
      toolRefs: clone(args.toolRefs || []),
      permissionMode: inherited && inherited.permissionMode || 'full',
      permissions: clone(inherited && inherited.permissions || null),
    }
  }

  function agentSummary(agent, full) {
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
      recentQuests: clone((agent.quests || []).slice(-8)),
      contextRefs: clone(agent.contextRefs || []),
      skillRefs: clone(agent.skillRefs || []),
      toolRefs: clone(agent.toolRefs || []),
      permissions: clone(agent.permissions),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      meta: clone(agent.meta || {}),
    }
    if (full) {
      out.systemPrompt = agent.systemPrompt || ''
      out.messages = clone(agent.messages || [])
      out.queue = clone(agent.queue || [])
      out.inbox = clone(agent.inbox || [])
      out.memory = clone(agent.memory || {})
      out.state = clone(agent.state || {})
    }
    return out
  }

  function readAgent(args, ctx) {
    if (args && args.agentId) {
      requireRead(ctx, args.agentId)
      const agent = ai.findAgent(args.agentId)
      if (!agent) throw new Error('Agent not found')
      return agentSummary(agent, true)
    }
    const who = actor(ctx)
    const agents = ai.agents.peek()
    const out = []
    for (let i = 0; i < agents.length; i++) {
      if (ai.canRead(who, agents[i].id, 'agent.summary')) out.push(agentSummary(agents[i], false))
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

  function createAgentApply(args) {
    const spec = clone(args.agent)
    spec.select = false
    const agent = ai.createAgent(spec)
    return Object.assign({ applied: true }, agentSummary(agent, true))
  }

  function delegateAgentPreview(args, ctx) {
    const target = args.agentId ? ai.findAgent(args.agentId) : null
    if (args.agentId) {
      if (!target) throw new Error('Agent not found')
      const creationKeys = ['name', 'parentAgentId', 'connection', 'model', 'systemPrompt', 'skillRefs', 'toolRefs']
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
        guidance: args.guidance || null,
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
      guidance: args.guidance || null,
      budget: clone(args.budget || null),
    }
  }

  function delegateAgentApply(args, ctx) {
    const agent = args.agentId ? ai.findAgent(args.agentId) : createAgentApply({ agent: args.agent })
    if (!agent) throw new Error('Agent not found')
    const sent = ai.agent.send(agent.id, {
      fromAgentId: actor(ctx) === 'user' ? null : actor(ctx),
      content: args.content || '',
      contextRefs: clone(args.contextRefs || []),
      attachments: clone(args.attachments || []),
      meta: clone(args.meta || null),
      interrupt: !!args.interrupt,
      guidance: args.guidance || null,
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
      content: args.content || '',
      contextRefs: clone(args.contextRefs || []),
      attachments: clone(args.attachments || []),
      meta: clone(args.meta || null),
      interrupt: !!args.interrupt,
      guidance: args.guidance || null,
      budget: clone(args.budget || null),
    })
  }

  function readQuest(args, ctx) {
    const result = ai.quest.read(args.agentId, args.questId, actor(ctx))
    if (!result) throw new Error('Quest not found or permission denied')
    return result
  }

  function readQuestResult(args, ctx) {
    const result = ai.quest.result(args.agentId, args.questId, actor(ctx))
    if (!result) throw new Error('Quest not found or permission denied')
    return result
  }

  function readMessage(args, ctx) {
    const result = ai.message.read(args.agentId, args.messageId, actor(ctx))
    if (!result) throw new Error('Message not found or permission denied')
    return result
  }

  function stopAgent(args, ctx) {
    requireManage(ctx, args.agentId)
    return { stopped: ai.stopAgent(args.agentId) }
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

  ai.tools.register('agent.read', {
    title: 'Read Agents',
    description: 'Read one full agent by id. Omit agentId to list every agent readable by the caller, including parentAgentId and runtime status.',
    schema: { type: 'object', properties: { agentId: { type: 'string', description: 'Agent to read. Omit to list readable agents.' } } },
    permissions: ['tool.call'],
    run: readAgent,
  })

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
        contextRefs: STRING_ARRAY_SCHEMA,
        skillRefs: STRING_ARRAY_SCHEMA,
        toolRefs: STRING_ARRAY_SCHEMA,
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    preview: createAgentPreview,
    apply: createAgentApply,
  })

  ai.tools.register('agent.delegate', {
    title: 'Delegate Agent Task',
    description: 'Create or reuse an agent and send it a delegated task in one workflow. Returns agentId and questId. Delegation does not force the parent to wait.',
    schema: {
      type: 'object',
      required: ['content'],
      properties: {
        agentId: { type: 'string' },
        name: { type: 'string' },
        parentAgentId: { type: 'string' },
        connection: { type: 'string' },
        model: { type: 'string' },
        systemPrompt: { type: 'string', description: 'System instructions for a newly created delegated agent.' },
        skillRefs: STRING_ARRAY_SCHEMA,
        toolRefs: STRING_ARRAY_SCHEMA,
        content: { type: 'string' },
        contextRefs: STRING_ARRAY_SCHEMA,
        attachments: { type: 'array' },
        interrupt: { type: 'boolean' },
        guidance: { type: 'string' },
        budget: RUN_BUDGET_SCHEMA,
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    preview: delegateAgentPreview,
    apply: delegateAgentApply,
  })

  ai.tools.register('agent.reparent', {
    title: 'Reparent Agent',
    description: 'Move an agent under another agent. Only the user may move an agent to the root by passing null.',
    schema: {
      type: 'object',
      required: ['agentId', 'parentAgentId'],
      properties: {
        agentId: { type: 'string' },
        parentAgentId: { type: ['string', 'null'] },
        order: { type: 'number' },
      },
    },
    permissions: ['tool.call', 'tool.apply'],
    preview: reparentAgentPreview,
    apply: reparentAgentApply,
  })

  ai.tools.register('agent.delete', {
    title: 'Delete Agent',
    description: 'Delete an agent and its descendants after preview approval.',
    schema: { type: 'object', required: ['agentId'] },
    permissions: ['tool.call', 'tool.apply'],
    preview: deleteAgentPreview,
    apply: deleteAgentApply,
  })

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
        interrupt: { type: 'boolean' },
        guidance: { type: 'string' },
        budget: RUN_BUDGET_SCHEMA,
      },
    },
    permissions: ['tool.call'],
    run: sendAgent,
  })

  ai.tools.register('quest.read', {
    title: 'Read Quest',
    description: 'Read the status and result message id for a cross-agent quest.',
    schema: { type: 'object', required: ['agentId', 'questId'] },
    permissions: ['tool.call'],
    run: readQuest,
  })

  ai.tools.register('quest.result', {
    title: 'Read Quest Result',
    description: 'Read a quest and, when completed, return its result message content in one call.',
    schema: { type: 'object', required: ['agentId', 'questId'] },
    permissions: ['tool.call'],
    run: readQuestResult,
  })

  ai.tools.register('message.read', {
    title: 'Read Message',
    description: 'Read one exact message by agent id and message id.',
    schema: { type: 'object', required: ['agentId', 'messageId'] },
    permissions: ['tool.call'],
    run: readMessage,
  })

  ai.tools.register('agent.stop', {
    title: 'Stop Agent',
    description: 'Stop a running agent.',
    schema: { type: 'object', required: ['agentId'] },
    permissions: ['tool.call'],
    run: stopAgent,
  })

  ai.skills.register('orchestration', {
    id: 'orchestration',
    title: 'Agent Orchestration',
    version: '2.0.0',
    description: 'Create, read, message, stop, delete, and reorganize aiditor.ai agents within permission boundaries.',
    systemPrompt: 'Use agent.* and quest.* tools to coordinate aiditor.ai agents. Complete delegated tasks end-to-end when possible. Prefer agent.delegate for create/reuse + send. Delegation is parallel: continue useful local work, then use quest.result for completed inbox event batches.',
    rules: [
      'Agents are identified by id. Names are display labels and may repeat.',
      'Omitting parentAgentId creates under the calling agent; user-created agents may be roots. Agents cannot escape their ownership subtree.',
      'Use agent.delegate when the user asks an agent to do work; it is the stable one-step delegation workflow.',
      'agent.delegate accepts systemPrompt, model, skillRefs, and toolRefs only when creating a new child. When agentId is present it only sends work to that existing agent.',
      'If agent.create is used separately for delegated work, follow it with agent.send unless the user only asked to create an agent.',
      'Use a task budget to tighten maxTurns, timeoutMs, or maxTokens when delegated work needs a smaller execution bound.',
      'After agent.delegate or agent.send, do not immediately poll quest.result. Continue useful work or stop; child completions arrive later as inbox notifications.',
      'When processing an inbox event batch, use quest.result for completed events in that batch and do not wait for pending sibling quests.',
      'A response that delegates or sends work is an action turn; continue user-visible synthesis after the runtime delivers child completion events.',
    ],
    tools: [
      'agent.read',
      'agent.create',
      'agent.delegate',
      'agent.reparent',
      'agent.delete',
      'agent.send',
      'quest.read',
      'quest.result',
      'message.read',
      'agent.stop',
    ],
  })
})(window.aiditor = window.aiditor || {})

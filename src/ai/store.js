// aiditor.ai store - agents, messages, and chat attachments.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  let nextAgentId = 1
  let nextMessageId = 1
  let nextAttachmentId = 1
  let nextEventId = 1

  const agentsSig = aiditor.signal([])
  const attachmentsSig = aiditor.signal([])
  const activeAgentIdSig = aiditor.signal(null)
  const agentVersionSigs = {}
  const messageListVersionSigs = {}
  const messageVersionSigs = {}
  const activeRunStateSigs = {}
  const storeVersionSig = aiditor.signal(0)
  let suppressStoreVersion = false
  let lastModelSelection = { connection: null, model: null }

  function now() { return Date.now() }

  function makeId(prefix, n) {
    return prefix + '_' + now().toString(36) + '_' + n
  }

  function defaultAgentName() {
    return ai.generateAgentName(agentsSig.peek().map(function (agent) { return agent.name }))
  }

  function cleanOrder(order, fallback) {
    return typeof order === 'number' ? order : fallback
  }

  function normalizePath(path) {
    let out = String(path || '').replace(/\\/g, '/')
    out = out.replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    return out || 'root'
  }

  function makePermission(path, mode) {
    return { path: normalizePath(path), mode: mode || 'read' }
  }

  function normalizePermissionList(permissions) {
    const paths = permissions && permissions.paths
    if (paths && paths.length) return { paths: paths.map(function (p) { return makePermission(p.path, p.mode) }) }
    return { paths: [] }
  }

  function connectionConfigDefaultModel(connection) {
    const config = ai.getConnectionConfig ? ai.getConnectionConfig(connection) : null
    return config && config.defaultModel || ''
  }

  function defaultAgentConnection(spec) {
    if (Object.prototype.hasOwnProperty.call(spec, 'connection')) return spec.connection || ai.defaultConnection || 'mock'
    return lastModelSelection.connection || ai.defaultConnection || 'mock'
  }

  function defaultAgentModel(spec, connection) {
    if (Object.prototype.hasOwnProperty.call(spec, 'model')) return spec.model || ''
    if (lastModelSelection.model && (!lastModelSelection.connection || lastModelSelection.connection === connection)) return lastModelSelection.model
    return connectionConfigDefaultModel(connection)
  }

  function makeAgent(spec) {
    spec = spec || {}
    const id = spec.id || makeId('a', nextAgentId++)
    const connection = defaultAgentConnection(spec)
    return {
      id: id,
      name: spec.name || defaultAgentName(),
      parentAgentId: spec.parentAgentId || null,
      order: cleanOrder(spec.order, agentsSig.peek().length),
      connection: connection,
      model: defaultAgentModel(spec, connection),
      contextBudgetTokens: spec.contextBudgetTokens || null,
      permissionMode: spec.permissionMode || 'full',
      status: spec.status || 'idle',
      statusText: spec.statusText || '',
      activeMessageId: spec.activeMessageId || null,
      activeQuestId: spec.activeQuestId || null,
      systemPrompt: spec.systemPrompt || '',
      outputSchema: spec.outputSchema ? ai.schema.normalize(spec.outputSchema, 'outputSchema') : null,
      messages: (spec.messages || []).map(makeMessage),
      compactions: (spec.compactions || []).map(makeCompaction),
      queue: (spec.queue || []).map(makeQueueItem),
      inbox: (spec.inbox || []).map(makeInboxEvent),
      quests: (spec.quests || []).map(makeQuest),
      contextRefs: spec.contextRefs ? spec.contextRefs.slice() : [],
      memory: spec.memory || {},
      state: spec.state || {},
      skillRefs: spec.skillRefs ? spec.skillRefs.slice() : [],
      permissions: normalizePermissionList(spec.permissions),
      createdAt: spec.createdAt || now(),
      updatedAt: spec.updatedAt || now(),
      meta: spec.meta || {},
    }
  }

  function normalizeRuntimeEvents(value) {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string') return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch (_) {
      return []
    }
  }

  function normalizeMessageMeta(meta) {
    if (!meta || meta.runtimeEvent !== 'inbox.continuation') return meta || null
    return Object.assign({}, meta, { events: normalizeRuntimeEvents(meta.events) })
  }

  function makeMessage(spec) {
    spec = spec || {}
    return {
      id: spec.id || makeId('m', nextMessageId++),
      agentId: spec.agentId || null,
      from: spec.from || 'user',
      role: spec.role || 'user',
      content: spec.content == null ? '' : spec.content,
      reasoning_content: spec.reasoning_content || spec.reasoningContent || null,
      connection: spec.connection || null,
      model: spec.model || null,
      time: spec.time || spec.createdAt || now(),
      createdAt: spec.createdAt || spec.time || now(),
      startedAt: spec.startedAt || null,
      completedAt: spec.completedAt || (spec.status === 'done' ? (spec.time || now()) : null),
      status: spec.status || 'done',
      contextRefs: spec.contextRefs ? spec.contextRefs.slice() : [],
      attachments: spec.attachments ? spec.attachments.slice() : [],
      toolCalls: spec.toolCalls ? spec.toolCalls.slice() : [],
      questId: spec.questId || null,
      resultForQuestId: spec.resultForQuestId || null,
      meta: normalizeMessageMeta(spec.meta),
      usage: spec.usage || null,
      stats: spec.stats || null,
      output: Object.prototype.hasOwnProperty.call(spec, 'output') ? spec.output : null,
    }
  }

  function makeQueueItem(spec) {
    spec = spec || {}
    return {
      messageId: spec.messageId || null,
      priority: cleanOrder(spec.priority, 0),
      interrupt: !!spec.interrupt,
      createdAt: spec.createdAt || now(),
    }
  }

  function makeInboxEvent(spec) {
    spec = spec || {}
    return {
      id: spec.id || makeId('evt', nextEventId++),
      type: spec.type || 'event',
      fromAgentId: spec.fromAgentId || null,
      questId: spec.questId || null,
      resultMessageId: spec.resultMessageId || null,
      summary: spec.summary || '',
      consumed: !!spec.consumed,
      createdAt: spec.createdAt || now(),
      meta: spec.meta || {},
    }
  }

  function makeQuest(spec) {
    spec = spec || {}
    return {
      id: spec.id || spec.requestMessageId,
      fromAgentId: spec.fromAgentId || null,
      toAgentId: spec.toAgentId || null,
      requestMessageId: spec.requestMessageId || spec.id || null,
      goal: spec.goal || spec.title || '',
      status: spec.status || 'queued',
      resultMessageId: spec.resultMessageId || spec.resultId || null,
      summary: spec.summary || '',
      plan: normalizeQuestPlan(spec.plan || spec.steps || []),
      currentStepId: spec.currentStepId || null,
      budget: spec.budget || null,
      usage: spec.usage || null,
      stopReason: spec.stopReason || null,
      createdAt: spec.createdAt || now(),
      startedAt: spec.startedAt || null,
      completedAt: spec.completedAt || null,
      meta: spec.meta || {},
    }
  }

  function normalizeQuestStep(step, index) {
    step = step || {}
    return {
      id: step.id || ('step_' + String(index + 1)),
      title: step.title || step.label || step.content || ('Step ' + String(index + 1)),
      status: normalizeQuestStepStatus(step.status),
      kind: step.kind || 'work',
      summary: step.summary || '',
      result: step.result || null,
      meta: step.meta || {},
    }
  }

  function normalizeQuestStepStatus(status) {
    if (status === 'running' || status === 'completed' || status === 'failed' || status === 'blocked' || status === 'skipped') return status
    return 'pending'
  }

  function normalizeQuestPlan(plan) {
    return (Array.isArray(plan) ? plan : []).map(normalizeQuestStep)
  }

  function makeAttachment(spec) {
    spec = spec || {}
    return {
      id: spec.id || makeId('att', nextAttachmentId++),
      kind: spec.kind || 'attachment',
      uri: spec.uri || '',
      title: spec.title || '',
      summary: spec.summary || '',
      resolver: spec.resolver || spec.kind || '',
      meta: spec.meta || {},
      createdAt: spec.createdAt || now(),
      updatedAt: spec.updatedAt || now(),
    }
  }

  function findAgent(id) {
    const agents = agentsSig.peek()
    for (let i = 0; i < agents.length; i++) if (agents[i].id === id) return agents[i]
    return null
  }

  function makeCompaction(spec) {
    spec = spec || {}
    return {
      id: spec.id || makeId('cmp', nextMessageId++),
      agentId: spec.agentId || null,
      range: spec.range || { fromMessageId: null, toMessageId: null },
      messageIds: spec.messageIds ? spec.messageIds.slice() : [],
      createdAt: spec.createdAt || now(),
      model: spec.model || 'deterministic',
      sourceHash: spec.sourceHash || '',
      summary: spec.summary || '',
      facts: spec.facts ? spec.facts.slice() : [],
      decisions: spec.decisions ? spec.decisions.slice() : [],
      openItems: spec.openItems ? spec.openItems.slice() : [],
      changedRefs: spec.changedRefs ? spec.changedRefs.slice() : [],
      toolObservations: spec.toolObservations ? spec.toolObservations.slice() : [],
      omittedDetails: spec.omittedDetails ? spec.omittedDetails.slice() : [],
      tokenEstimateBefore: spec.tokenEstimateBefore || 0,
      tokenEstimateAfter: spec.tokenEstimateAfter || 0,
    }
  }

  function messageKey(agentId, messageId) {
    return String(agentId || '') + '/' + String(messageId || '')
  }

  function versionSig(map, key) {
    if (!map[key]) map[key] = aiditor.signal(0)
    return map[key]
  }

  function bump(sig) {
    sig.set(sig.peek() + 1)
  }

  function touchStore() {
    if (!suppressStoreVersion) bump(storeVersionSig)
  }

  function bumpMessageList(agentId) {
    bump(versionSig(messageListVersionSigs, agentId))
  }

  function bumpAgent(agentId) {
    bump(versionSig(agentVersionSigs, agentId))
  }

  function bumpMessage(agentId, messageId) {
    bump(versionSig(messageVersionSigs, messageKey(agentId, messageId)))
  }

  function deleteMessageVersionSignals(agentId) {
    const prefix = String(agentId || '') + '/'
    Object.keys(messageVersionSigs).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete messageVersionSigs[key]
    })
  }

  function deleteAgentSignals(agentId) {
    delete agentVersionSigs[agentId]
    delete messageListVersionSigs[agentId]
    delete activeRunStateSigs[agentId]
    deleteMessageVersionSignals(agentId)
  }

  function touchMessages(agentId, messages) {
    bumpMessageList(agentId)
    for (let i = 0; i < (messages || []).length; i++) bumpMessage(agentId, messages[i].id)
  }

  function shouldBumpMessageList(patch) {
    return !!(patch && (
      patch.status != null ||
      patch.toolCalls != null ||
      patch.meta != null ||
      patch.stats != null ||
      patch.contextRefs != null ||
      patch.attachments != null ||
      patch.questId != null ||
      patch.resultForQuestId != null
    ))
  }

  function getActiveAgent() {
    return findAgent(activeAgentIdSig())
  }

  function updateAgents(fn) {
    let out = null
    agentsSig.update(function (agents) {
      out = fn(agents.slice())
      return out
    })
    touchStore()
    return out
  }

  function isDescendant(parentId, childId) {
    if (!parentId || !childId || parentId === childId) return false
    let cur = findAgent(childId)
    while (cur && cur.parentAgentId) {
      if (cur.parentAgentId === parentId) return true
      cur = findAgent(cur.parentAgentId)
    }
    return false
  }

  function createAgent(spec) {
    spec = spec || {}
    const agent = makeAgent(spec)
    if (agent.parentAgentId && (!findAgent(agent.parentAgentId) || isDescendant(agent.id, agent.parentAgentId))) {
      agent.parentAgentId = null
    }
    updateAgents(function (agents) { return agents.concat([agent]) })
    bumpAgent(agent.id)
    if (!spec || spec.select !== false) {
      activeAgentIdSig.set(agent.id)
      touchStore()
    }
    return agent
  }

  function updateAgent(id, patch) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== id) return agent
        out = Object.assign({}, agent, patch || {}, { updatedAt: now() })
        if (patch && patch.parentAgentId && (!findAgent(patch.parentAgentId) || isDescendant(id, patch.parentAgentId))) out.parentAgentId = agent.parentAgentId || null
        if (patch && patch.permissions) out.permissions = normalizePermissionList(patch.permissions)
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'outputSchema')) {
          out.outputSchema = patch.outputSchema ? ai.schema.normalize(patch.outputSchema, 'outputSchema') : null
        }
        delete out.workingDirectory
        delete out.workdir
        delete out.path
        delete out.groupId
        return out
      })
    })
    if (out) bumpAgent(id)
    if (out && patch && patch.messages) touchMessages(id, out.messages)
    return out
  }

  function renameAgent(id, name) {
    return updateAgent(id, { name: String(name || '') })
  }

  function moveAgent(id, opts, orderArg) {
    const agent = findAgent(id)
    const o = (opts && typeof opts === 'object') ? opts : { parentAgentId: opts, order: orderArg }
    if (!agent) return null
    const parentAgentId = o.parentAgentId || null
    if (parentAgentId && (!findAgent(parentAgentId) || parentAgentId === id || isDescendant(id, parentAgentId))) return null
    return updateAgent(id, { parentAgentId: parentAgentId, order: cleanOrder(o.order, agent.order) })
  }

  function reparentAgent(id, parentAgentId, order) {
    return moveAgent(id, { parentAgentId: parentAgentId || null, order: order })
  }

  function childIdsOf(id) {
    const agents = agentsSig.peek()
    const out = []
    for (let i = 0; i < agents.length; i++) if (agents[i].parentAgentId === id) out.push(agents[i].id)
    return out
  }

  function descendantIdsOf(id) {
    const out = []
    const stack = childIdsOf(id)
    while (stack.length) {
      const next = stack.shift()
      out.push(next)
      const children = childIdsOf(next)
      for (let i = 0; i < children.length; i++) stack.push(children[i])
    }
    return out
  }

  function deleteAgent(id) {
    const removed = findAgent(id)
    if (!removed) return null
    const removeIds = new Set([id].concat(descendantIdsOf(id)))
    updateAgents(function (agents) { return agents.filter(function (agent) { return !removeIds.has(agent.id) }) })
    removeIds.forEach(function (agentId) { deleteAgentSignals(agentId) })
    if (removeIds.has(activeAgentIdSig.peek())) {
      const rest = agentsSig.peek()
      activeAgentIdSig.set(rest.length ? rest[0].id : null)
      touchStore()
    }
    return removed
  }

  function selectAgent(id) {
    if (activeAgentIdSig.peek() === id) return findAgent(id)
    activeAgentIdSig.set(id)
    touchStore()
    return findAgent(id)
  }

  function appendMessage(agentId, message) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        out = makeMessage(Object.assign({}, message || {}, { agentId: agentId }))
        return Object.assign({}, agent, { messages: agent.messages.concat([out]), updatedAt: now() })
      })
    })
    if (out) {
      bumpMessageList(agentId)
      bumpMessage(agentId, out.id)
    }
    return out
  }

  function insertMessageAfter(agentId, afterMessageId, message) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        out = makeMessage(Object.assign({}, message || {}, { agentId: agentId }))
        const messages = agent.messages.slice()
        let index = messages.length - 1
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].id === afterMessageId) {
            index = i
            break
          }
        }
        messages.splice(index + 1, 0, out)
        return Object.assign({}, agent, { messages: messages, updatedAt: now() })
      })
    })
    if (out) {
      bumpMessageList(agentId)
      bumpMessage(agentId, out.id)
    }
    return out
  }

  function readMessage(agentId, messageId) {
    const agent = findAgent(agentId)
    const messages = agent && agent.messages || []
    for (let i = 0; i < messages.length; i++) if (messages[i].id === messageId) return messages[i]
    return null
  }

  function updateMessage(agentId, messageId, patch) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        const messages = agent.messages.map(function (message) {
          if (message.id !== messageId) return message
          out = Object.assign({}, message, patch || {})
          return out
        })
        return Object.assign({}, agent, { messages: messages, updatedAt: now() })
      })
    })
    if (out) {
      bumpMessage(agentId, messageId)
      if (shouldBumpMessageList(patch)) bumpMessageList(agentId)
    }
    return out
  }

  function setAgentStatus(agentId, status) {
    return updateAgent(agentId, typeof status === 'object' ? status : { status: status })
  }

  function enqueueMessage(agentId, messageId, opts) {
    let out = null
    opts = opts || {}
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        out = makeQueueItem({ messageId: messageId, priority: opts.priority, interrupt: opts.interrupt })
        const queue = opts.interrupt ? [out].concat(agent.queue || []) : (agent.queue || []).concat([out])
        return Object.assign({}, agent, {
          queue: queue,
          status: agent.status === 'idle' ? 'queued' : agent.status,
          updatedAt: now(),
        })
      })
    })
    if (out) bumpAgent(agentId)
    return out
  }

  function dequeueMessage(agentId, messageId) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        const queue = (agent.queue || []).filter(function (item) {
          if (!out && (!messageId || item.messageId === messageId)) {
            out = item
            return false
          }
          return true
        })
        return Object.assign({}, agent, { queue: queue, updatedAt: now() })
      })
    })
    if (out) bumpAgent(agentId)
    return out
  }

  function createQuest(agentId, spec) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        out = makeQuest(Object.assign({}, spec || {}, { toAgentId: agentId }))
        return Object.assign({}, agent, { quests: (agent.quests || []).concat([out]), updatedAt: now() })
      })
    })
    return out
  }

  function findQuest(agentId, questId) {
    const agent = findAgent(agentId)
    const quests = agent && agent.quests || []
    for (let i = 0; i < quests.length; i++) if (quests[i].id === questId) return quests[i]
    return null
  }

  function updateQuest(agentId, questId, patch) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        const quests = (agent.quests || []).map(function (quest) {
          if (quest.id !== questId) return quest
          out = Object.assign({}, quest, patch || {})
          if (patch && Object.prototype.hasOwnProperty.call(patch, 'plan')) out.plan = normalizeQuestPlan(patch.plan)
          if (patch && Object.prototype.hasOwnProperty.call(patch, 'steps')) out.plan = normalizeQuestPlan(patch.steps)
          return out
        })
        return Object.assign({}, agent, { quests: quests, updatedAt: now() })
      })
    })
    return out
  }

  function updateQuestPlan(agentId, questId, plan, patch) {
    return updateQuest(agentId, questId, Object.assign({}, patch || {}, { plan: normalizeQuestPlan(plan) }))
  }

  function updateQuestStep(agentId, questId, stepId, patch) {
    const quest = findQuest(agentId, questId)
    if (!quest) return null
    let found = false
    const plan = (quest.plan || []).map(function (step) {
      if (step.id !== stepId) return step
      found = true
      return normalizeQuestStep(Object.assign({}, step, patch || {}, { id: step.id }), 0)
    })
    if (!found) return null
    return updateQuest(agentId, questId, {
      plan: plan,
      currentStepId: patch && patch.status === 'running' ? stepId : quest.currentStepId,
    })
  }

  function appendInboxEvent(agentId, event) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        out = makeInboxEvent(event)
        return Object.assign({}, agent, { inbox: (agent.inbox || []).concat([out]), updatedAt: now() })
      })
    })
    return out
  }

  function markInboxEventConsumed(agentId, eventId) {
    let out = null
    updateAgents(function (agents) {
      return agents.map(function (agent) {
        if (agent.id !== agentId) return agent
        const inbox = (agent.inbox || []).map(function (event) {
          if (event.id !== eventId) return event
          out = Object.assign({}, event, { consumed: true })
          return out
        })
        return Object.assign({}, agent, { inbox: inbox, updatedAt: now() })
      })
    })
    return out
  }

  function addAttachment(spec) {
    const attachment = makeAttachment(spec)
    attachmentsSig.update(function (items) { return items.concat([attachment]) })
    touchStore()
    return attachment
  }

  function removeAttachment(id) {
    let removed = null
    attachmentsSig.update(function (items) {
      return items.filter(function (item) {
        if (item.id === id) { removed = item; return false }
        return true
      })
    })
    agentsSig.update(function (agents) {
      return agents.map(function (agent) {
        return Object.assign({}, agent, {
          contextRefs: agent.contextRefs.filter(function (ref) { return typeof ref === 'string' ? ref !== id : ref.refId !== id && ref.id !== id }),
        })
      })
    })
    touchStore()
    return removed
  }

  function clearMap(map) {
    Object.keys(map).forEach(function (key) { delete map[key] })
  }

  function resetRuntimeState() {
    suppressStoreVersion = true
    nextAgentId = 1
    nextMessageId = 1
    nextAttachmentId = 1
    nextEventId = 1
    clearMap(agentVersionSigs)
    clearMap(messageListVersionSigs)
    clearMap(messageVersionSigs)
    clearMap(activeRunStateSigs)
    agentsSig.set([])
    attachmentsSig.set([])
    activeAgentIdSig.set(null)
    lastModelSelection = { connection: null, model: null }
    suppressStoreVersion = false
    touchStore()
  }

  function snapshot() {
    const data = {
      version: 3,
      agents: agentsSig.peek().map(function (agent) {
        const out = Object.assign({}, agent)
        delete out.path
        delete out.groupId
        return out
      }),
      attachments: attachmentsSig.peek(),
      preferences: {
        lastConnection: lastModelSelection.connection,
        lastModel: lastModelSelection.model,
      },
      activeAgentId: activeAgentIdSig.peek(),
    }
    return ai.serialize && ai.serialize.clone ? ai.serialize.clone(data) : JSON.parse(JSON.stringify(data))
  }

  function checkpointSnapshot() {
    return snapshot()
  }

  function normalizeRestoredRuntime(agent) {
    const transient = { running: true, queued: true, waiting_approval: true, stopped: true, failed: true }
    const messages = (agent.messages || []).map(function (message) {
      return normalizeRestoredMessage(message, false)
    })
    const quests = (agent.quests || []).map(function (quest) {
      return (quest.status === 'running' || quest.status === 'queued' || quest.status === 'waiting_approval')
        ? Object.assign({}, quest, { status: 'stopped', stopReason: 'reload', completedAt: quest.completedAt || now(), summary: quest.summary || 'Stopped by reload' })
        : quest
    })
    return Object.assign({}, agent, {
      status: transient[agent.status] ? 'idle' : (agent.status || 'idle'),
      statusText: '',
      activeMessageId: null,
      activeQuestId: null,
      queue: [],
      messages: messages,
      quests: quests,
    })
  }

  function normalizeCheckpointRuntime(agent) {
    const messages = (agent.messages || []).map(function (message) {
      return normalizeRestoredMessage(message, true)
    })
    const messageById = {}
    for (let i = 0; i < messages.length; i++) messageById[messages[i].id] = messages[i]
    const queue = (agent.queue || []).filter(function (item) {
      return !!(messageById[item.messageId] && messageById[item.messageId].status === 'queued')
    })
    const quests = (agent.quests || []).map(function (quest) {
      return (quest.status === 'running' || quest.status === 'waiting_approval')
        ? Object.assign({}, quest, { status: 'stopped', stopReason: 'reload', completedAt: quest.completedAt || now(), summary: quest.summary || 'Stopped by reload' })
        : quest
    })
    return Object.assign({}, agent, {
      status: queue.length ? 'queued' : 'idle',
      statusText: '',
      activeMessageId: null,
      activeQuestId: null,
      queue: queue,
      messages: messages,
      quests: quests,
    })
  }

  function normalizeRestoredMessage(message, preserveQueued) {
    const transientMessage = message.status === 'running' || (!preserveQueued && message.status === 'queued')
    const calls = (message.toolCalls || []).map(function (call) {
      if (call.status === 'applied' || call.status === 'completed' || call.status === 'rejected' || call.status === 'failed') return call
      return Object.assign({}, call, {
        status: 'failed',
        error: call.error || 'Tool call was interrupted by reload.',
        updatedAt: now(),
      })
    })
    if (!transientMessage && calls.length === (message.toolCalls || []).length && calls.every(function (call, index) { return call === message.toolCalls[index] })) return message
    return Object.assign({}, message, {
      status: transientMessage ? 'stopped' : message.status,
      completedAt: transientMessage ? (message.completedAt || now()) : message.completedAt,
      toolCalls: calls,
    })
  }

  function restore(data) {
    const next = data || null
    if (!next || next.version !== 3) return null
    suppressStoreVersion = true
    lastModelSelection = {
      connection: next.preferences && next.preferences.lastConnection || null,
      model: next.preferences && next.preferences.lastModel || null,
    }
    agentsSig.set((next.agents || []).map(function (agent) { return normalizeRestoredRuntime(makeAgent(agent)) }))
    attachmentsSig.set((next.attachments || []).map(makeAttachment))
    activeAgentIdSig.set(next.activeAgentId || (agentsSig.peek()[0] && agentsSig.peek()[0].id) || null)
    const agents = agentsSig.peek()
    for (let i = 0; i < agents.length; i++) touchMessages(agents[i].id, agents[i].messages)
    suppressStoreVersion = false
    touchStore()
    return snapshot()
  }

  function restoreCheckpoint(data) {
    const next = data || null
    if (!next || next.version !== 3) return null
    suppressStoreVersion = true
    lastModelSelection = {
      connection: next.preferences && next.preferences.lastConnection || null,
      model: next.preferences && next.preferences.lastModel || null,
    }
    clearMap(activeRunStateSigs)
    agentsSig.set((next.agents || []).map(function (agent) { return normalizeCheckpointRuntime(makeAgent(agent)) }))
    attachmentsSig.set((next.attachments || []).map(makeAttachment))
    activeAgentIdSig.set(next.activeAgentId || (agentsSig.peek()[0] && agentsSig.peek()[0].id) || null)
    const agents = agentsSig.peek()
    for (let i = 0; i < agents.length; i++) touchMessages(agents[i].id, agents[i].messages)
    suppressStoreVersion = false
    touchStore()
    return checkpointSnapshot()
  }

  function setLastSelectedModel(selection) {
    const s = selection || {}
    lastModelSelection = {
      connection: s.connection || null,
      model: s.model || '',
    }
    touchStore()
    return Object.assign({}, lastModelSelection)
  }

  function getLastSelectedModel() {
    return Object.assign({}, lastModelSelection)
  }

  function permissionAllowed(actor, targetAgentId, scope, details) {
    return ai.decidePermission
      ? ai.decidePermission(actor || 'user', targetAgentId, scope, details || {}).allowed === true
      : true
  }

  function messageApiRead(agentId, messageId, actor) {
    if (!permissionAllowed(actor || 'user', agentId, 'messages.read', { messageId: messageId })) return null
    return readMessage(agentId, messageId)
  }

  function questApiRead(agentId, questId, actor) {
    if (!permissionAllowed(actor || 'user', agentId, 'quest.read', { questId: questId })) return null
    const quest = findQuest(agentId, questId)
    if (!quest) return null
    return {
      agentId: agentId,
      questId: quest.id,
      status: quest.status,
      resultId: quest.resultMessageId || null,
      summary: quest.summary || '',
      goal: quest.goal || '',
      plan: (quest.plan || []).slice(),
      currentStepId: quest.currentStepId || null,
      budget: quest.budget || null,
      usage: quest.usage || null,
      stopReason: quest.stopReason || null,
      createdAt: quest.createdAt,
      startedAt: quest.startedAt || null,
      completedAt: quest.completedAt || null,
    }
  }

  function questApiResult(agentId, questId, actor) {
    const quest = questApiRead(agentId, questId, actor)
    if (!quest || !quest.resultId) return quest
    const message = messageApiRead(agentId, quest.resultId, actor)
    return Object.assign({}, quest, {
      message: message || null,
      content: message ? message.content : null,
      output: message ? message.output : null,
      resultMessageId: quest.resultId,
    })
  }

  function agentApiRead(agentId, actor) {
    if (!permissionAllowed(actor || 'user', agentId, 'agent.summary')) return null
    const agent = findAgent(agentId)
    if (!agent) return null
    const unread = (agent.inbox || []).filter(function (event) { return !event.consumed }).length
    return {
      id: agent.id,
      name: agent.name,
      parentAgentId: agent.parentAgentId || null,
      order: agent.order,
      status: agent.status,
      statusText: agent.statusText || '',
      activeMessageId: agent.activeMessageId || null,
      activeQuestId: agent.activeQuestId || null,
      queuedCount: (agent.queue || []).length,
      unreadInboxCount: unread,
      recentQuests: (agent.quests || []).slice(-8),
    }
  }

  function agentMessages(agentId, opts, actor) {
    opts = opts || {}
    if (!permissionAllowed(actor || 'user', agentId, 'messages.read')) return []
    const agent = findAgent(agentId)
    let messages = agent && agent.messages || []
    if (!opts.includeToolMessages) messages = messages.filter(function (message) { return message.role !== 'tool' })
    if (opts.after) {
      let index = -1
      for (let i = 0; i < messages.length; i++) if (messages[i].id === opts.after) { index = i; break }
      if (index >= 0) messages = messages.slice(index + 1)
    }
    if (opts.limit > 0 && messages.length > opts.limit) messages = messages.slice(messages.length - opts.limit)
    return messages.slice()
  }

  function activeAgentMeta() {
    const id = activeAgentIdSig()
    if (id) versionSig(agentVersionSigs, id)()
    const agent = findAgent(id)
    if (!agent) return null
    return {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      statusText: agent.statusText || '',
      connection: agent.connection,
      model: agent.model,
      permissionMode: agent.permissionMode,
      activeMessageId: agent.activeMessageId || null,
      activeQuestId: agent.activeQuestId || null,
      queueLength: (agent.queue || []).length,
    }
  }

  function agentMessageIds(agentId) {
    versionSig(messageListVersionSigs, agentId)()
    const agent = findAgent(agentId)
    const messages = agent && agent.messages || []
    const out = []
    for (let i = 0; i < messages.length; i++) out.push(messages[i].id)
    return out
  }

  function messageVersion(agentId, messageId) {
    return versionSig(messageVersionSigs, messageKey(agentId, messageId))()
  }

  function messageListVersion(agentId) {
    return versionSig(messageListVersionSigs, agentId)()
  }

  function agentVersion(agentId) {
    return versionSig(agentVersionSigs, agentId)()
  }

  function idleRunState(agentId) {
    return {
      agentId: agentId || null,
      runId: null,
      messageId: null,
      state: 'idle',
      previewTail: '',
      modelTail: '',
      activityText: '',
      previewUpdatedAt: null,
      startedAt: null,
      firstTokenAt: null,
      updatedAt: now(),
      completedAt: null,
      usage: null,
      outputTokens: 0,
      totalTokens: 0,
      cost: null,
      error: null,
    }
  }

  function activeRunState(agentId) {
    return versionSig(activeRunStateSigs, agentId)() || idleRunState(agentId)
  }

  function peekActiveRunState(agentId) {
    return versionSig(activeRunStateSigs, agentId).peek() || idleRunState(agentId)
  }

  function setActiveRunState(agentId, patch) {
    const sig = versionSig(activeRunStateSigs, agentId)
    const prev = sig.peek() || idleRunState(agentId)
    const next = Object.assign({}, prev, patch || {}, {
      agentId: agentId || (patch && patch.agentId) || prev.agentId || null,
      updatedAt: now(),
    })
    sig.set(next)
    return next
  }

  if (ai.configurePermissionAccessors) {
    ai.configurePermissionAccessors({
      findAgent: findAgent,
      findQuest: findQuest,
      isDescendant: isDescendant,
    })
  }

  ai.agents = agentsSig
  ai.attachments = attachmentsSig
  ai.activeAgentId = activeAgentIdSig
  ai.storeVersion = storeVersionSig
  ai.findAgent = findAgent
  ai.getActiveAgent = getActiveAgent
  ai.activeAgentMeta = activeAgentMeta
  ai.agentVersion = agentVersion
  ai.agentMessageIds = agentMessageIds
  ai.messageVersion = messageVersion
  ai.messageListVersion = messageListVersion
  ai.activeRunState = activeRunState
  ai.peekActiveRunState = peekActiveRunState
  ai.setActiveRunState = setActiveRunState
  ai.createAgent = createAgent
  ai.updateAgent = updateAgent
  ai.renameAgent = renameAgent
  ai.moveAgent = moveAgent
  ai.reparentAgent = reparentAgent
  ai.deleteAgent = deleteAgent
  ai.selectAgent = selectAgent
  ai.isDescendant = isDescendant
  ai.appendMessage = appendMessage
  ai.insertMessageAfter = insertMessageAfter
  ai.readMessage = readMessage
  ai.updateMessage = updateMessage
  ai.setAgentStatus = setAgentStatus
  ai.enqueueMessage = enqueueMessage
  ai.dequeueMessage = dequeueMessage
  ai.createQuest = createQuest
  ai.findQuest = findQuest
  ai.updateQuest = updateQuest
  ai.updateQuestPlan = updateQuestPlan
  ai.updateQuestStep = updateQuestStep
  ai.appendInboxEvent = appendInboxEvent
  ai.markInboxEventConsumed = markInboxEventConsumed
  ai.addAttachment = addAttachment
  ai.removeAttachment = removeAttachment
  ai.snapshot = snapshot
  ai.checkpointSnapshot = checkpointSnapshot
  ai.resetRuntimeState = resetRuntimeState
  ai.restore = restore
  ai.restoreCheckpoint = restoreCheckpoint
  ai.setLastSelectedModel = setLastSelectedModel
  ai.getLastSelectedModel = getLastSelectedModel
  ai.message = ai.message || {}
  ai.quest = ai.quest || {}
  ai.agent = ai.agent || {}
  ai.message.read = messageApiRead
  ai.quest.read = questApiRead
  ai.quest.result = questApiResult
  ai.agent.read = agentApiRead
  ai.agent.messages = agentMessages

})(window.aiditor = window.aiditor || {})

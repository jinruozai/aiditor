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
  let lastModelSelection = { connection: null, model: null }
  const PERSISTENCE_BASE_KEY = 'aiditor.ai'
  let persistenceNamespace = defaultPersistenceNamespace()
  let persistenceKey = persistenceKeyFor(persistenceNamespace)
  let persistenceEnabled = true
  let persistenceDisabledForSession = false
  let persistenceWarningReported = false
  let persistenceMaxBytes = 2 * 1024 * 1024
  let persistenceMaxMessagesPerAgent = 80
  let persistenceToolResultPolicy = 'compact'
  let saveTimer = null
  const MAX_SNAPSHOT_CONTENT_CHARS = 1000000
  const MAX_SNAPSHOT_REASONING_CHARS = 65536
  const MAX_STORED_STATE_CHARS = 5000000
  const MAX_SNAPSHOT_TOOL_STRING_CHARS = 12000
  const PERSISTENCE_TOOL_POLICIES = { compact: true, 'metadata-only': true, none: true }

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
      messages: (spec.messages || []).map(makeMessage),
      compactions: (spec.compactions || []).map(makeCompaction),
      queue: (spec.queue || []).map(makeQueueItem),
      inbox: (spec.inbox || []).map(makeInboxEvent),
      quests: (spec.quests || []).map(makeQuest),
      contextRefs: spec.contextRefs ? spec.contextRefs.slice() : [],
      memory: spec.memory || {},
      state: spec.state || {},
      skillRefs: spec.skillRefs ? spec.skillRefs.slice() : [],
      toolRefs: spec.toolRefs ? spec.toolRefs.slice() : [],
      permissions: normalizePermissionList(spec.permissions),
      createdAt: spec.createdAt || now(),
      updatedAt: spec.updatedAt || now(),
      meta: spec.meta || {},
    }
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
      meta: spec.meta || null,
      usage: spec.usage || null,
      stats: spec.stats || null,
    }
  }

  function makeQueueItem(spec) {
    spec = spec || {}
    return {
      messageId: spec.messageId || null,
      priority: cleanOrder(spec.priority, 0),
      interrupt: !!spec.interrupt,
      guidance: spec.guidance || null,
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
    agentsSig.update(function (agents) { return agents.concat([agent]) })
    bumpAgent(agent.id)
    if (!spec || spec.select !== false) activeAgentIdSig.set(agent.id)
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
    agentsSig.update(function (agents) { return agents.filter(function (agent) { return !removeIds.has(agent.id) }) })
    removeIds.forEach(function (agentId) { deleteAgentSignals(agentId) })
    if (removeIds.has(activeAgentIdSig.peek())) {
      const rest = agentsSig.peek()
      activeAgentIdSig.set(rest.length ? rest[0].id : null)
    }
    return removed
  }

  function selectAgent(id) {
    activeAgentIdSig.set(id)
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
        out = makeQueueItem({ messageId: messageId, priority: opts.priority, interrupt: opts.interrupt, guidance: opts.guidance })
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
    return removed
  }

  function storage() {
    try { return window.localStorage || null } catch (_) { return null }
  }

  function normalizeNamespace(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  }

  function defaultPersistenceNamespace() {
    if (!window.location) return ''
    return normalizeNamespace(String(window.location.origin || '') + String(window.location.pathname || ''))
  }

  function persistenceKeyFor(namespace) {
    const ns = normalizeNamespace(namespace)
    return ns ? PERSISTENCE_BASE_KEY + '.' + ns : PERSISTENCE_BASE_KEY
  }

  function clearMap(map) {
    Object.keys(map).forEach(function (key) { delete map[key] })
  }

  function resetRuntimeState() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
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
  }

  function resetPersistenceFailureState() {
    persistenceDisabledForSession = false
    persistenceWarningReported = false
  }

  function snapshot() {
    return {
      version: 2,
      agents: agentsSig.peek().map(snapshotAgent),
      attachments: attachmentsSig.peek(),
      preferences: {
        lastConnection: lastModelSelection.connection,
        lastModel: lastModelSelection.model,
      },
      activeAgentId: activeAgentIdSig.peek(),
    }
  }

  function snapshotAgent(agent) {
    const out = Object.assign({}, agent, {
      contextRefs: [],
      messages: (agent.messages || []).map(snapshotMessage),
    })
    delete out.path
    delete out.groupId
    return out
  }

  function limitString(value, max) {
    if (typeof value !== 'string' || value.length <= max) return value
    return value.slice(0, max) + '\n\n[truncated for persistence]'
  }

  function snapshotMessage(message) {
    const out = Object.assign({}, message)
    out.content = limitString(out.content, MAX_SNAPSHOT_CONTENT_CHARS)
    out.reasoning_content = limitString(out.reasoning_content, MAX_SNAPSHOT_REASONING_CHARS)
    if (out.toolCalls && out.toolCalls.length) out.toolCalls = out.toolCalls.map(snapshotToolCall)
    return out
  }

  function stringifySnapshotValue(value) {
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value) } catch (err) {
      return JSON.stringify({ error: 'Value is not JSON serializable', message: String(err && err.message || err) })
    }
  }

  function compactSnapshotValue(value, depth, seen) {
    if (value == null) return value
    if (typeof value === 'string') return limitString(value, MAX_SNAPSHOT_TOOL_STRING_CHARS)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'function') return '[Function]'
    if (typeof value !== 'object') return String(value)
    if (value.nodeType === 1 || value.nodeType === 9 || value.nodeType === 11) {
      return ai.serialize && ai.serialize.stringify ? JSON.parse(ai.serialize.stringify(value)) : '[DOM node]'
    }
    seen = seen || []
    for (let s = 0; s < seen.length; s++) if (seen[s] === value) return '[Circular]'
    if (depth <= 0) return limitString(stringifySnapshotValue(value), MAX_SNAPSHOT_TOOL_STRING_CHARS)
    seen.push(value)
    if (Array.isArray(value)) {
      const out = []
      const n = Math.min(value.length, 32)
      for (let i = 0; i < n; i++) out.push(compactSnapshotValue(value[i], depth - 1, seen))
      if (value.length > n) out.push('[+' + (value.length - n) + ' items truncated]')
      seen.pop()
      return out
    }
    const out = {}
    const keys = Object.keys(value)
    const n = Math.min(keys.length, 48)
    for (let i = 0; i < n; i++) out[keys[i]] = compactSnapshotValue(value[keys[i]], depth - 1, seen)
    if (keys.length > n) out.__truncatedKeys = keys.length - n
    seen.pop()
    return out
  }

  function snapshotToolCall(call) {
    return {
      id: call.id,
      providerCallId: call.providerCallId,
      toolId: call.toolId,
      name: call.name,
      args: compactSnapshotValue(call.args || {}, 4),
      status: call.status,
      actor: call.actor,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      error: limitString(call.error, 4000),
      preview: compactSnapshotValue(call.preview, 3),
      result: compactSnapshotValue(call.result, 3),
      applyResult: compactSnapshotValue(call.applyResult, 3),
    }
  }

  function storageBytes(text) {
    return String(text || '').length * 2
  }

  function serializeSnapshot(data) {
    return JSON.stringify(data)
  }

  function boundedNumber(value, fallback, min) {
    const n = Math.floor(Number(value))
    return isFinite(n) && n >= min ? n : fallback
  }

  function compactString(value, max) {
    if (typeof value !== 'string' || value.length <= max) return value
    return value.slice(0, max) + '\n\n[truncated for persistence]'
  }

  function compactPersistenceValue(value, depth, stringMax, arrayMax, objectMax, seen) {
    if (value == null) return value
    if (typeof value === 'string') return compactString(value, stringMax)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'function') return '[Function]'
    if (typeof value !== 'object') return String(value)
    seen = seen || []
    for (let i = 0; i < seen.length; i++) if (seen[i] === value) return '[Circular]'
    if (depth <= 0) return compactString(stringifySnapshotValue(value), stringMax)
    seen.push(value)
    if (Array.isArray(value)) {
      const out = []
      const n = Math.min(value.length, arrayMax)
      for (let j = 0; j < n; j++) out.push(compactPersistenceValue(value[j], depth - 1, stringMax, arrayMax, objectMax, seen))
      if (value.length > n) out.push('[+' + (value.length - n) + ' items truncated]')
      seen.pop()
      return out
    }
    const out = {}
    const keys = Object.keys(value).sort()
    const n = Math.min(keys.length, objectMax)
    for (let k = 0; k < n; k++) out[keys[k]] = compactPersistenceValue(value[keys[k]], depth - 1, stringMax, arrayMax, objectMax, seen)
    if (keys.length > n) out.__truncatedKeys = keys.length - n
    seen.pop()
    return out
  }

  function compactRefs(list, emergency) {
    const out = []
    const input = Array.isArray(list) ? list : []
    const max = emergency ? 16 : 64
    for (let i = 0; i < input.length && i < max; i++) {
      const item = input[i]
      if (typeof item === 'string') out.push(item)
      else if (item && typeof item === 'object') {
        out.push({
          id: item.id || item.refId || null,
          refId: item.refId || item.id || null,
          kind: item.kind || item.type || null,
          uri: compactString(item.uri || item.url || '', emergency ? 160 : 512),
          title: compactString(item.title || item.label || '', emergency ? 80 : 240),
        })
      }
    }
    if (input.length > max) out.push({ omitted: input.length - max })
    return out
  }

  function compactAttachment(item, emergency) {
    return {
      id: item.id,
      kind: item.kind,
      uri: compactString(item.uri, emergency ? 240 : 1024),
      title: compactString(item.title, emergency ? 120 : 512),
      summary: compactString(item.summary, emergency ? 240 : 1024),
      resolver: item.resolver,
      meta: compactPersistenceValue(item.meta || {}, emergency ? 1 : 2, emergency ? 160 : 512, emergency ? 8 : 24, emergency ? 12 : 32),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }

  function compactMessage(message, emergency) {
    const out = Object.assign({}, message)
    out.content = compactString(out.content, emergency ? 1200 : 12000)
    out.reasoning_content = compactString(out.reasoning_content, emergency ? 400 : 2000)
    out.contextRefs = compactRefs(out.contextRefs, emergency)
    out.attachments = compactRefs(out.attachments, emergency)
    out.meta = compactPersistenceValue(out.meta, emergency ? 1 : 2, emergency ? 240 : 1000, emergency ? 8 : 24, emergency ? 12 : 32)
    out.usage = compactPersistenceValue(out.usage, 1, 200, 8, 16)
    out.stats = compactPersistenceValue(out.stats, 1, 200, 8, 16)
    if (out.toolCalls && out.toolCalls.length) out.toolCalls = out.toolCalls.map(function (call) { return compactPersistenceToolCall(call, emergency) })
    return out
  }

  function compactPersistenceToolCall(call, emergency) {
    const out = {
      id: call.id,
      providerCallId: call.providerCallId,
      toolId: call.toolId,
      name: call.name,
      status: call.status,
      actor: call.actor,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      error: compactString(call.error, emergency ? 500 : 2000),
    }
    if (persistenceToolResultPolicy !== 'none') {
      out.args = compactPersistenceValue(call.args || {}, emergency ? 1 : 2, emergency ? 240 : 1200, emergency ? 8 : 24, emergency ? 12 : 32)
    }
    if (persistenceToolResultPolicy === 'compact') {
      out.preview = compactPersistenceValue(call.preview, emergency ? 1 : 2, emergency ? 240 : 1200, emergency ? 8 : 24, emergency ? 12 : 32)
      out.result = compactPersistenceValue(call.result, emergency ? 1 : 2, emergency ? 240 : 1200, emergency ? 8 : 24, emergency ? 12 : 32)
      out.applyResult = compactPersistenceValue(call.applyResult, emergency ? 1 : 2, emergency ? 240 : 1200, emergency ? 8 : 24, emergency ? 12 : 32)
    }
    return out
  }

  function compactQuestStep(step, emergency) {
    return {
      id: compactString(step.id, emergency ? 80 : 240),
      title: compactString(step.title, emergency ? 160 : 512),
      status: step.status,
      kind: step.kind,
      summary: compactString(step.summary, emergency ? 240 : 1000),
      result: compactPersistenceValue(step.result, emergency ? 1 : 2, emergency ? 160 : 512, emergency ? 8 : 16, emergency ? 12 : 24),
      meta: compactPersistenceValue(step.meta || {}, emergency ? 1 : 2, emergency ? 160 : 512, emergency ? 8 : 16, emergency ? 12 : 24),
    }
  }

  function compactQuest(quest, emergency) {
    const plan = Array.isArray(quest.plan) ? quest.plan : []
    const maxSteps = emergency ? 32 : 128
    const meta = compactPersistenceValue(quest.meta || {}, emergency ? 1 : 2, emergency ? 160 : 512, emergency ? 8 : 16, emergency ? 12 : 24) || {}
    if (plan.length > maxSteps) {
      meta.persistence = Object.assign({}, meta.persistence && typeof meta.persistence === 'object' ? meta.persistence : {}, {
        compacted: true,
        omittedPlanSteps: plan.length - maxSteps,
      })
    }
    return {
      id: quest.id,
      fromAgentId: quest.fromAgentId,
      toAgentId: quest.toAgentId,
      requestMessageId: quest.requestMessageId,
      goal: compactString(quest.goal, emergency ? 240 : 1000),
      status: quest.status,
      resultMessageId: quest.resultMessageId,
      summary: compactString(quest.summary, emergency ? 240 : 1000),
      plan: plan.slice(0, maxSteps).map(function (step) { return compactQuestStep(step, emergency) }),
      currentStepId: quest.currentStepId,
      budget: compactPersistenceValue(quest.budget, 1, emergency ? 160 : 512, emergency ? 8 : 16, emergency ? 12 : 24),
      usage: compactPersistenceValue(quest.usage, 1, emergency ? 160 : 512, emergency ? 8 : 16, emergency ? 12 : 24),
      stopReason: quest.stopReason || null,
      createdAt: quest.createdAt,
      startedAt: quest.startedAt,
      completedAt: quest.completedAt,
      meta: meta,
    }
  }

  function compactAgent(agent, emergency) {
    const messages = agent.messages || []
    const maxMessages = Math.max(1, emergency ? Math.min(persistenceMaxMessagesPerAgent, 12) : persistenceMaxMessagesPerAgent)
    const omittedMessages = Math.max(0, messages.length - maxMessages)
    const meta = compactPersistenceValue(agent.meta || {}, emergency ? 1 : 2, emergency ? 240 : 1000, emergency ? 8 : 24, emergency ? 12 : 32) || {}
    if (omittedMessages) {
      meta.persistence = Object.assign({}, meta.persistence || {}, {
        compacted: true,
        omittedMessages: omittedMessages,
      })
    }
    return Object.assign({}, agent, {
      systemPrompt: compactString(agent.systemPrompt, emergency ? 2000 : 16000),
      statusText: compactString(agent.statusText, emergency ? 200 : 800),
      messages: messages.slice(Math.max(0, messages.length - maxMessages)).map(function (message) { return compactMessage(message, emergency) }),
      compactions: (agent.compactions || []).slice(emergency ? -4 : -16).map(function (item) {
        return compactPersistenceValue(item, emergency ? 1 : 2, emergency ? 240 : 1000, emergency ? 8 : 24, emergency ? 12 : 32)
      }),
      inbox: (agent.inbox || []).slice(emergency ? -8 : -32).map(function (item) {
        return compactPersistenceValue(item, emergency ? 1 : 2, emergency ? 160 : 512, emergency ? 8 : 16, emergency ? 12 : 24)
      }),
      quests: (agent.quests || []).slice(emergency ? -8 : -32).map(function (item) {
        return compactQuest(item, emergency)
      }),
      queue: (agent.queue || []).slice(emergency ? -4 : -16).map(function (item) {
        return compactPersistenceValue(item, 1, 160, 8, 16)
      }),
      contextRefs: compactRefs(agent.contextRefs, emergency),
      memory: compactPersistenceValue(agent.memory || {}, emergency ? 1 : 2, emergency ? 240 : 1000, emergency ? 8 : 24, emergency ? 12 : 32),
      state: compactPersistenceValue(agent.state || {}, emergency ? 1 : 2, emergency ? 240 : 1000, emergency ? 8 : 24, emergency ? 12 : 32),
      meta: meta,
    })
  }

  function compactPersistenceSnapshot(data, emergency) {
    return {
      version: 2,
      agents: (data.agents || []).map(function (agent) { return compactAgent(agent, emergency) }),
      attachments: (data.attachments || []).map(function (item) { return compactAttachment(item, emergency) }),
      preferences: data.preferences || {},
      activeAgentId: data.activeAgentId || null,
      persistence: { compacted: true, emergency: !!emergency },
    }
  }

  function preparePersistenceSnapshot(data, emergency) {
    let out = emergency ? compactPersistenceSnapshot(data, true) : data
    let usedEmergency = !!emergency
    let text = null
    try {
      text = serializeSnapshot(out)
    } catch (err) {
      if (emergency) throw err
      out = compactPersistenceSnapshot(data, true)
      usedEmergency = true
      text = serializeSnapshot(out)
    }
    if (!usedEmergency && storageBytes(text) > persistenceMaxBytes) {
      out = compactPersistenceSnapshot(data, false)
      text = serializeSnapshot(out)
    }
    if (!usedEmergency && storageBytes(text) > persistenceMaxBytes) {
      out = compactPersistenceSnapshot(data, true)
      usedEmergency = true
      text = serializeSnapshot(out)
    }
    return { data: out, text: text, bytes: storageBytes(text), fits: storageBytes(text) <= persistenceMaxBytes }
  }

  function isQuotaError(err) {
    const name = err && err.name || ''
    const message = String(err && err.message || '')
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err && (err.code === 22 || err.code === 1014) || /quota/i.test(message)
  }

  function reportPersistenceFailure(reason, err, info) {
    if (persistenceWarningReported) return
    persistenceWarningReported = true
    if (!aiditor.reportError) return
    const e = new Error('AI persistence disabled for this session: ' + reason)
    e.reason = reason
    e.code = 'ai_persistence_' + reason
    e.storageKey = persistenceKey
    e.maxBytes = persistenceMaxBytes
    e.bytes = info && info.bytes || null
    e.cause = err || null
    aiditor.reportError({ scope: 'ai', storage: persistenceKey, op: 'save', reason: reason }, e)
  }

  function disablePersistenceForSession(reason, err, info) {
    persistenceDisabledForSession = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    reportPersistenceFailure(reason, err, info)
  }

  function normalizeRestoredRuntime(agent) {
    const transient = { running: true, queued: true, waiting_approval: true, stopped: true, failed: true }
    const messages = (agent.messages || []).map(function (message) {
      return (message.status === 'running' || message.status === 'queued')
        ? Object.assign({}, message, { status: 'stopped', completedAt: message.completedAt || now() })
        : message
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

  function save() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    const s = storage()
    const data = snapshot()
    if (!s || !persistenceEnabled || persistenceDisabledForSession) return data
    let prepared = null
    try {
      prepared = preparePersistenceSnapshot(data, false)
    } catch (err) {
      disablePersistenceForSession('serialization_failed', err, null)
      return data
    }
    if (!prepared.fits) {
      disablePersistenceForSession('size_exceeded', null, prepared)
      return prepared.data
    }
    try {
      s.setItem(persistenceKey, prepared.text)
      return prepared.data
    } catch (err) {
      let emergency = null
      try {
        emergency = preparePersistenceSnapshot(data, true)
      } catch (serializeErr) {
        disablePersistenceForSession('serialization_failed', serializeErr, prepared)
        return prepared.data
      }
      if (isQuotaError(err) && emergency.fits) {
        try {
          s.setItem(persistenceKey, emergency.text)
          return emergency.data
        } catch (secondErr) {
          disablePersistenceForSession(isQuotaError(secondErr) ? 'quota_exceeded' : 'storage_error', secondErr, emergency)
          return emergency.data
        }
      }
      disablePersistenceForSession(isQuotaError(err) ? 'quota_exceeded' : 'storage_error', err, prepared)
    }
    return data
  }

  function scheduleSave() {
    if (!persistenceEnabled || persistenceDisabledForSession) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 800)
  }

  function flushPendingSave() {
    if (saveTimer) save()
  }

  function installPersistenceFlushHandlers() {
    if (!window.addEventListener) return
    window.addEventListener('beforeunload', flushPendingSave)
    window.addEventListener('pagehide', flushPendingSave)
    window.addEventListener('visibilitychange', function () {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushPendingSave()
    })
  }

  function restore(data) {
    const next = data || readStored()
    if (!next || next.version !== 2) return null
    lastModelSelection = {
      connection: next.preferences && next.preferences.lastConnection || null,
      model: next.preferences && next.preferences.lastModel || null,
    }
    agentsSig.set((next.agents || []).map(function (agent) { return normalizeRestoredRuntime(makeAgent(agent)) }))
    attachmentsSig.set((next.attachments || []).map(makeAttachment))
    activeAgentIdSig.set(next.activeAgentId || (agentsSig.peek()[0] && agentsSig.peek()[0].id) || null)
    const agents = agentsSig.peek()
    for (let i = 0; i < agents.length; i++) touchMessages(agents[i].id, agents[i].messages)
    return snapshot()
  }

  function readStored() {
    const s = storage()
    if (!s) return null
    try {
      const text = s.getItem(persistenceKey)
      if (!text) return null
      const parsed = JSON.parse(text)
      if (!parsed || parsed.version !== 2) return parsed
      if (text.length > MAX_STORED_STATE_CHARS || storageBytes(text) > persistenceMaxBytes) {
        return migrateStoredSnapshot(s, parsed, text)
      }
      return parsed
    } catch (_) {
      return null
    }
  }

  function migrateStoredSnapshot(s, data, text) {
    let prepared = null
    try {
      prepared = preparePersistenceSnapshot(data, false)
    } catch (_) {
      return null
    }
    if (prepared.fits) {
      try { s.setItem(persistenceKey, prepared.text) } catch (_) {}
      return prepared.data
    }
    return prepared.data
  }

  function configurePersistence(opts) {
    opts = opts || {}
    const previousKey = persistenceKey
    const previousEnabled = persistenceEnabled
    const previousMaxBytes = persistenceMaxBytes
    const previousMaxMessages = persistenceMaxMessagesPerAgent
    const previousPolicy = persistenceToolResultPolicy
    if (Object.prototype.hasOwnProperty.call(opts, 'key') && opts.key) {
      persistenceKey = String(opts.key)
    } else if (Object.prototype.hasOwnProperty.call(opts, 'namespace')) {
      persistenceNamespace = normalizeNamespace(opts.namespace)
      persistenceKey = persistenceKeyFor(persistenceNamespace)
    }
    if (opts.enabled != null) persistenceEnabled = opts.enabled !== false
    if (opts.maxBytes != null) persistenceMaxBytes = boundedNumber(opts.maxBytes, persistenceMaxBytes, 4096)
    if (opts.maxMessagesPerAgent != null) persistenceMaxMessagesPerAgent = boundedNumber(opts.maxMessagesPerAgent, persistenceMaxMessagesPerAgent, 1)
    if (opts.toolResultPolicy != null && PERSISTENCE_TOOL_POLICIES[opts.toolResultPolicy]) persistenceToolResultPolicy = opts.toolResultPolicy
    if (persistenceKey !== previousKey ||
        persistenceEnabled !== previousEnabled ||
        persistenceMaxBytes !== previousMaxBytes ||
        persistenceMaxMessagesPerAgent !== previousMaxMessages ||
        persistenceToolResultPolicy !== previousPolicy) {
      resetPersistenceFailureState()
    }
    if (persistenceKey !== previousKey) resetRuntimeState()
    if (opts.load !== false) restore()
    return snapshot()
  }

  function clearStoredState() {
    const s = storage()
    if (s) s.removeItem(persistenceKey)
  }

  function setLastSelectedModel(selection) {
    const s = selection || {}
    lastModelSelection = {
      connection: s.connection || null,
      model: s.model || '',
    }
    scheduleSave()
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
    return Object.assign({}, quest, { message: message || null, content: message ? message.content : null, resultMessageId: quest.resultId })
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
  ai.findAgent = findAgent
  ai.getActiveAgent = getActiveAgent
  ai.activeAgentMeta = activeAgentMeta
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
  ai.save = save
  ai.restore = restore
  ai.configurePersistence = configurePersistence
  ai.clearStoredState = clearStoredState
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

  installPersistenceFlushHandlers()
  restore()
  aiditor.effect(function () {
    agentsSig()
    attachmentsSig()
    activeAgentIdSig()
    scheduleSave()
  })
})(window.aiditor = window.aiditor || {})

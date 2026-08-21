import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/ai/agent/name-generator.js',
  'src/ai/permission.js',
  'src/ai/agent/store.js',
  'src/ai/connection.js',
  'src/ai/adapter.js',
  'src/ai/provider.js',
  'src/ai/provider-auth.js',
  'src/ai/provider-transports.js',
  'src/ai/provider-connections.js',
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/skill/builtins.js',
  'src/ai/tool/scheduler.js',
  'src/ai/tool/runtime.js',
  'src/ai/agent/orchestration.js',
  'src/ai/agent/request.js',
  'src/ai/agent/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai

async function runCall(agentId, toolId, args, actor) {
  const call = ai.createToolCall(agentId, { toolId: toolId, args: args || {} }, actor || 'user')
  assert.equal(call.status, 'proposed')
  assert.equal(ai.approveToolCall(agentId, call.id, actor || 'user').status, 'approved')
  const run = ai.runToolCall(agentId, call.id, actor || 'user')
  assert.equal(run.toolCall.status, 'running')
  return run.promise
}

function previewApply(agentId, toolId, args, actor) {
  const call = ai.createToolCall(agentId, { toolId: toolId, args: args || {} }, actor || 'user')
  assert.equal(call.status, 'proposed')
  const previewed = ai.previewToolCall(agentId, call.id, actor || 'user')
  assert.equal(previewed.status, 'previewed')
  const applied = ai.applyToolCall(agentId, call.id, actor || 'user')
  assert.equal(applied.status, 'applied')
  return applied.applyResult
}

const builtinTools = ai.tools.list()
assert.deepEqual(builtinTools.filter(function (id) { return id.indexOf('group.') === 0 }), [])
assert.equal(builtinTools.includes('agent.create'), true)
assert.equal(builtinTools.includes('agent.configure'), true)
assert.equal(builtinTools.includes('agent.delegate'), true)
assert.equal(builtinTools.includes('agent.read'), true)
assert.equal(builtinTools.includes('agent.send'), true)
assert.equal(builtinTools.includes('quest.result'), true)
assert.equal(builtinTools.includes('quest.cancel'), true)
assert.equal(builtinTools.includes('message.read'), true)
assert.equal(builtinTools.includes('agent.stop'), true)
assert.equal(builtinTools.includes('agent.delete'), true)
assert.equal(builtinTools.includes('agent.reparent'), true)
assert.equal(ai.tools.get('agent.delegate').schema.properties.systemPrompt.type, 'string')
assert.equal('skillRefs' in ai.tools.get('agent.delegate').schema.properties, false)
assert.equal('toolRefs' in ai.tools.get('agent.delegate').schema.properties, false)
assert.equal(ai.tools.get('agent.delegate').schema.properties.budget.properties.timeoutMs.type, 'number')
assert.equal('guidance' in ai.tools.get('agent.delegate').schema.properties, false)
assert.equal('guidance' in ai.tools.get('agent.send').schema.properties, false)
assert.equal('permissions' in ai.tools.get('agent.create').schema.properties, false)
assert.deepEqual(ai.tools.get('agent.reparent').schema.required, ['agentId', 'parentAgentId'])
assert.match(ai.tools.get('agent.read').description, /direct children/)
assert.match(ai.tools.get('agent.create').description, /idle AI agent profile/)
assert.match(ai.tools.get('agent.create').description, /agent\.delegate/)
assert.match(ai.tools.get('agent.delegate').description, /when an Agent should perform work/)
assert.match(ai.tools.get('agent.delegate').schema.properties.parentAgentId.description, /calling agent/)
assert.equal(ai.skills.get('aiditor.agent-orchestration').tools.includes('agent.delegate'), true)
assert.equal(ai.skills.get('aiditor.agent-orchestration').tools.indexOf('agent.delegate') < ai.skills.get('aiditor.agent-orchestration').tools.indexOf('agent.create'), true)
assert.match(ai.skills.get('aiditor.agent-orchestration').instructions, /call agent\.delegate directly/)
assert.equal(ai.skills.get('aiditor.agent-orchestration').toolDisclosure, 'onRead')
assert.equal(ai.skills.get('aiditor.editor-control').toolDisclosure, 'always')
assert.equal(ai.skills.get('aiditor.workspace-authoring').toolDisclosure, 'onRead')
assert.equal(ai.skills.get('aiditor.ai-host-authoring').toolDisclosure, 'onRead')

const root = ai.createAgent({
  name: 'Root',
  permissionMode: 'full',
})
assert.throws(function () {
  ai.createAgent({ name: 'Orphan', parentAgentId: 'missing-parent' })
}, /Parent agent not found/)

const contextOwnedPreview = ai.tools.get('agent.create').preview({ name: 'Context Child' }, { agent: root })
assert.equal(contextOwnedPreview.agent.parentAgentId, root.id)
assert.throws(function () {
  ai.tools.get('agent.create').preview({ name: 'Missing Caller Child' }, {
    actor: 'missing-caller',
    agent: root,
    toolCall: { actor: 'missing-caller', args: { name: 'Missing Caller Child' } },
  })
}, function (error) {
  return error && error.code === 'AGENT_PARENT_RESOLUTION_FAILED'
})

const createdAgent = previewApply(root.id, 'agent.create', {
  name: 'Worker',
  parentAgentId: root.id,
  connection: 'mock',
  model: 'fast',
}, root.id)
assert.equal(createdAgent.name, 'Worker')
assert.equal(createdAgent.parentAgentId, root.id)
assert.equal('path' in createdAgent, false)
assert.equal('groupId' in createdAgent, false)
assert.equal(ai.activeAgentId(), root.id)

const implicitChild = previewApply(root.id, 'agent.create', {
  name: 'Implicit Child',
}, root.id)
assert.equal(implicitChild.parentAgentId, root.id)

const userRoot = previewApply(root.id, 'agent.create', {
  name: 'User Root',
}, 'user')
assert.equal(userRoot.parentAgentId, null)

const approvedChildCall = ai.createToolCall(root.id, {
  toolId: 'agent.create',
  args: { name: 'User Approved Child' },
}, root.id)
assert.equal(ai.previewToolCall(root.id, approvedChildCall.id, root.id).status, 'previewed')
const approvedChild = ai.applyToolCall(root.id, approvedChildCall.id, 'user')
assert.equal(approvedChild.status, 'applied')
assert.equal(approvedChild.applyResult.parentAgentId, root.id)

const removedParent = ai.createAgent({ name: 'Removed Before Apply', parentAgentId: root.id, select: false })
const staleParentCall = ai.createToolCall(root.id, {
  toolId: 'agent.create',
  args: { name: 'Stale Parent Child', parentAgentId: removedParent.id },
}, root.id)
assert.equal(ai.previewToolCall(root.id, staleParentCall.id, root.id).status, 'previewed')
ai.deleteAgent(removedParent.id)
const staleParentApply = ai.applyToolCall(root.id, staleParentCall.id, 'user')
assert.equal(staleParentApply.status, 'failed')
assert.equal(staleParentApply.errorDetails.code, 'AGENT_PARENT_RESOLUTION_FAILED')
assert.equal(ai.agents.peek().some(function (agent) { return agent.name === 'Stale Parent Child' }), false)

const rootEscapeCall = ai.createToolCall(root.id, {
  toolId: 'agent.create',
  args: { name: 'Escaped Root', parentAgentId: null },
}, root.id)
assert.equal(ai.previewToolCall(root.id, rootEscapeCall.id, root.id).status, 'failed')

const duplicateName = previewApply(root.id, 'agent.create', {
  name: 'Worker',
  parentAgentId: root.id,
}, root.id)
assert.equal(duplicateName.name, 'Worker')
assert.notEqual(duplicateName.id, createdAgent.id)

const reparented = previewApply(root.id, 'agent.reparent', {
  agentId: duplicateName.id,
  parentAgentId: createdAgent.id,
}, root.id)
assert.equal(reparented.parentAgentId, createdAgent.id)

const readableAgents = await runCall(root.id, 'agent.read', {}, root.id)
assert.equal(readableAgents.status, 'completed')
assert.equal(readableAgents.result.some(function (agent) {
  return agent.id === createdAgent.id && agent.parentAgentId === root.id
}), true)
assert.equal(readableAgents.result.some(function (agent) { return agent.id === reparented.id }), false)

const recursiveAgents = await runCall(root.id, 'agent.read', { parentAgentId: root.id, recursive: true }, root.id)
assert.equal(recursiveAgents.result.some(function (agent) { return agent.id === reparented.id }), true)

const exactAgent = await runCall(root.id, 'agent.read', { agentId: createdAgent.id }, root.id)
assert.equal(exactAgent.result.systemPrompt, null)
assert.equal('messages' in exactAgent.result, false)
assert.equal('queue' in exactAgent.result, false)
assert.equal('inbox' in exactAgent.result, false)

const configuredAgent = previewApply(root.id, 'agent.configure', {
  agentId: createdAgent.id,
  model: 'configured-model',
  systemPrompt: 'Review precisely.',
}, root.id)
assert.equal(configuredAgent.model, 'configured-model')
assert.equal(configuredAgent.systemPrompt, 'Review precisely.')
assert.equal('skillRefs' in configuredAgent, false)
assert.equal('toolRefs' in configuredAgent, false)

const selfConfigureCall = ai.createToolCall(createdAgent.id, {
  toolId: 'agent.configure',
  args: { agentId: createdAgent.id, systemPrompt: 'Self modified' },
}, createdAgent.id)
assert.equal(ai.previewToolCall(createdAgent.id, selfConfigureCall.id, createdAgent.id).status, 'failed')
assert.equal(ai.findAgent(createdAgent.id).systemPrompt, 'Review precisely.')

let sentRequest = null
ai.registerTransport('capture-send', {
  toolProtocol: 'native',
  send: function (connection, request) {
    sentRequest = request
    return { role: 'assistant', content: 'done' }
  },
})
ai.registerConnection('capture-send', { auth: { type: 'none' }, transport: { type: 'capture-send' }, configDefaults: {} })
ai.context.register('test.active-table', {
  capture: function () {
    return {
      resolver: 'test',
      uri: 'test://table/data/items',
      kind: 'test.table',
      title: 'data/items',
      meta: { table: 'data/items' },
    }
  },
}, { owner: 'test:orchestration' })
ai.updateAgent(createdAgent.id, { connection: 'capture-send' })
const sent = await runCall(root.id, 'agent.send', { agentId: createdAgent.id, content: 'work item' }, root.id)
assert.equal(sent.status, 'completed')
assert.equal(sent.result.agentId, createdAgent.id)
assert.equal(sent.result.questId, sent.result.messageId)
await new Promise(function (resolve) { setTimeout(resolve, 0) })
const quest = ai.quest.read(createdAgent.id, sent.result.questId, root.id)
assert.equal(quest.status, 'completed')
const resultMessage = ai.message.read(createdAgent.id, quest.resultId, root.id)
assert.equal(resultMessage.content, 'done')
assert.equal(ai.quest.result(createdAgent.id, sent.result.questId, root.id).content, 'done')
const readableQuests = await runCall(root.id, 'quest.read', { agentId: createdAgent.id, limit: 5 }, root.id)
assert.equal(readableQuests.result.some(function (item) { return item.questId === sent.result.questId }), true)
assert.equal(readableQuests.result.some(function (item) { return Object.prototype.hasOwnProperty.call(item, 'plan') }), false)
const completedQuests = await runCall(root.id, 'quest.read', { agentId: createdAgent.id, status: 'completed' }, root.id)
assert.equal(completedQuests.result.length > 0, true)
assert.equal(completedQuests.result.every(function (item) { return item.status === 'completed' }), true)
const queuedQuests = await runCall(root.id, 'quest.read', { agentId: createdAgent.id, status: 'queued' }, root.id)
assert.equal(queuedQuests.result.length, 0)
const completedCancellation = await runCall(root.id, 'quest.cancel', { agentId: createdAgent.id, questId: sent.result.questId }, root.id)
assert.equal(completedCancellation.result.cancelled, false)
assert.equal(completedCancellation.result.outcome, 'already_terminal')
assert.equal(completedCancellation.result.previousStatus, 'completed')
assert.throws(function () {
  ai.tools.get('quest.result').run({ agentId: createdAgent.id, questId: 'missing-quest' }, { actor: 'user', agent: root })
}, function (error) {
  return error && error.code === 'QUEST_NOT_FOUND' && error.details.agentId === createdAgent.id
})
assert.throws(function () {
  ai.tools.get('quest.result').run({ agentId: createdAgent.id, questId: 'missing-quest' }, { actor: root.id, agent: root })
}, function (error) {
  return error && error.code === 'QUEST_UNAVAILABLE' && /agentId and questId/.test(error.hint)
})
assert.equal(sentRequest.agent.id, createdAgent.id)
assert.equal(sentRequest.messages.some(function (message) {
  return message.role === 'system'
    && String(message.content || '').indexOf('Current editor runtime context') >= 0
    && String(message.content || '').indexOf('test.active-table') >= 0
    && String(message.content || '').indexOf('data/items') >= 0
}), true)

ai.updateAgent(root.id, { connection: 'mock' })
const delegatedExisting = previewApply(root.id, 'agent.delegate', {
  agentId: createdAgent.id,
  content: 'delegated existing work',
}, root.id)
assert.equal(delegatedExisting.agentId, createdAgent.id)
assert.equal(!!delegatedExisting.questId, true)

const delegatedNew = previewApply(root.id, 'agent.delegate', {
  name: 'Poet',
  systemPrompt: 'Write concise poems.',
  content: 'write a poem',
}, root.id)
const delegatedPoet = ai.findAgent(delegatedNew.agentId)
assert.equal(delegatedPoet.parentAgentId, root.id)
assert.equal(delegatedPoet.systemPrompt, 'Write concise poems.')
assert.equal('skillRefs' in delegatedPoet, false)
assert.equal('toolRefs' in delegatedPoet, false)
assert.equal(!!delegatedNew.questId, true)

const mixedDelegateCall = ai.createToolCall(root.id, {
  toolId: 'agent.delegate',
  args: { agentId: createdAgent.id, systemPrompt: 'Should not be ignored', content: 'work' },
}, root.id)
assert.equal(ai.previewToolCall(root.id, mixedDelegateCall.id, root.id).status, 'failed')

ai.configureRuntime({ maxDelegationDepth: 1 })
const depthCall = ai.createToolCall(createdAgent.id, {
  toolId: 'agent.create',
  args: { name: 'Too Deep' },
}, createdAgent.id)
assert.equal(ai.previewToolCall(createdAgent.id, depthCall.id, createdAgent.id).status, 'failed')
ai.configureRuntime({ maxDelegationDepth: 4 })

let releaseRun
const held = new Promise(function (resolve) { releaseRun = resolve })
ai.registerTransport('hold-orchestration', {
  toolProtocol: 'native',
  send: function () { return held.then(function () { return 'late' }) },
})
ai.registerConnection('hold-orchestration', { auth: { type: 'none' }, transport: { type: 'hold-orchestration' }, configDefaults: {} })
ai.updateAgent(createdAgent.id, { connection: 'hold-orchestration' })
const run = ai.runAgent(createdAgent.id)
assert.equal(ai.findAgent(createdAgent.id).status, 'running')
const configuredWhileRunning = previewApply(root.id, 'agent.configure', {
  agentId: createdAgent.id,
  systemPrompt: 'Use this on the next request.',
}, root.id)
assert.equal(run.request.agent.systemPrompt, 'Review precisely.')
assert.equal(configuredWhileRunning.systemPrompt, 'Use this on the next request.')
const stopped = await runCall(root.id, 'agent.stop', { agentId: createdAgent.id }, root.id)
assert.equal(stopped.result.outcome, 'stopped')
assert.equal(stopped.result.stopped, true)
assert.equal(stopped.result.agentId, createdAgent.id)
assert.equal(stopped.result.previousStatus, 'running')
assert.equal(stopped.result.status, 'idle')
assert.equal(stopped.result.stopReason, 'cancelled')
const stoppedAgain = await runCall(root.id, 'agent.stop', { agentId: createdAgent.id }, root.id)
assert.equal(stoppedAgain.result.outcome, 'not_running')
assert.equal(stoppedAgain.result.stopped, false)
assert.equal(stoppedAgain.result.previousStatus, 'idle')
releaseRun()
assert.equal(await run.promise, null)

const denied = ai.createAgent({ name: 'Denied' })
const deniedCall = ai.createToolCall(denied.id, {
  toolId: 'agent.delete',
  args: { agentId: createdAgent.id },
}, denied.id)
assert.equal(ai.previewToolCall(denied.id, deniedCall.id, denied.id).status, 'failed')
assert.equal(ai.findAgent(createdAgent.id) != null, true)

const deletedAgent = previewApply(root.id, 'agent.delete', { agentId: duplicateName.id }, root.id)
assert.equal(deletedAgent.id, duplicateName.id)
assert.equal(ai.findAgent(duplicateName.id), null)

console.log('ai orchestration tests ok')

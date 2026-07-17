import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/ai/name-generator.js',
  'src/ai/permission.js',
  'src/ai/store.js',
  'src/ai/connection.js',
  'src/ai/adapter.js',
  'src/ai/provider.js',
  'src/ai/provider-auth.js',
  'src/ai/provider-transports.js',
  'src/ai/provider-connections.js',
  'src/ai/registries.js',
  'src/ai/context.js',
  'src/ai/orchestration.js',
  'src/ai/request.js',
  'src/ai/runtime.js',
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
assert.equal(builtinTools.includes('agent.delegate'), true)
assert.equal(builtinTools.includes('agent.read'), true)
assert.equal(builtinTools.includes('agent.send'), true)
assert.equal(builtinTools.includes('quest.result'), true)
assert.equal(builtinTools.includes('message.read'), true)
assert.equal(builtinTools.includes('agent.stop'), true)
assert.equal(builtinTools.includes('agent.delete'), true)
assert.equal(builtinTools.includes('agent.reparent'), true)
assert.equal(ai.tools.get('agent.delegate').schema.properties.systemPrompt.type, 'string')
assert.equal(ai.tools.get('agent.delegate').schema.properties.skillRefs.items.type, 'string')
assert.equal(ai.tools.get('agent.delegate').schema.properties.toolRefs.items.type, 'string')
assert.equal(ai.tools.get('agent.delegate').schema.properties.budget.properties.timeoutMs.type, 'number')
assert.equal('permissions' in ai.tools.get('agent.create').schema.properties, false)
assert.deepEqual(ai.tools.get('agent.reparent').schema.required, ['agentId', 'parentAgentId'])
assert.match(ai.tools.get('agent.read').description, /Omit agentId/)
assert.equal(ai.skills.get('orchestration').rules.some(function (rule) {
  return rule.indexOf('Names are display labels') >= 0
}), true)

const root = ai.createAgent({
  name: 'Root',
  toolRefs: builtinTools,
  skillRefs: ['orchestration'],
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

let sentRequest = null
ai.registerTransport('capture-send', {
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
      tools: ['test.getTableSchema', 'test.patchRows'],
    }
  },
})
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
  skillRefs: ['orchestration'],
  toolRefs: ['agent.read'],
  content: 'write a poem',
}, root.id)
const delegatedPoet = ai.findAgent(delegatedNew.agentId)
assert.equal(delegatedPoet.parentAgentId, root.id)
assert.equal(delegatedPoet.systemPrompt, 'Write concise poems.')
assert.deepEqual(delegatedPoet.skillRefs, ['orchestration'])
assert.deepEqual(delegatedPoet.toolRefs, ['agent.read'])
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
  send: function () { return held.then(function () { return 'late' }) },
})
ai.registerConnection('hold-orchestration', { auth: { type: 'none' }, transport: { type: 'hold-orchestration' }, configDefaults: {} })
ai.updateAgent(createdAgent.id, { connection: 'hold-orchestration' })
const run = ai.runAgent(createdAgent.id)
assert.equal(ai.findAgent(createdAgent.id).status, 'running')
const stopped = await runCall(root.id, 'agent.stop', { agentId: createdAgent.id }, root.id)
assert.deepEqual(stopped.result, { stopped: true })
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

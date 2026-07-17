import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/ai/name-generator.js',
  'src/ai/serialize.js',
  'src/ai/trace.js',
  'src/ai/context-pack.js',
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
const replies = []

async function flush(count = 1) {
  for (let i = 0; i < count; i++) await new Promise(function (resolve) { setTimeout(resolve, 0) })
}

ai.registerTransport('agent-primitives', {
  send: function () {
    return replies.shift() || { role: 'assistant', content: 'done' }
  },
})
ai.registerConnection('agent-primitives', { auth: { type: 'none' }, transport: { type: 'agent-primitives' }, configDefaults: {} })

ai.context.register('selection.test', function () {
  return { selection: ['node-a'], summary: 'current selection' }
})

const agent = ai.createAgent({
  name: 'Root Agent',
  connection: 'agent-primitives',
  toolRefs: ['trace-edit'],
})
const child = ai.createAgent({
  name: 'Child Agent',
  parentAgentId: agent.id,
  connection: 'agent-primitives',
  select: false,
})

const quest = ai.createQuest(child.id, {
  fromAgentId: agent.id,
  requestMessageId: 'manual-message',
  goal: 'Review child work',
  plan: [
    { id: 'inspect', title: 'Inspect', status: 'running' },
    { id: 'report', title: 'Report' },
  ],
  currentStepId: 'inspect',
})
assert.equal(ai.findQuest(child.id, quest.id).goal, 'Review child work')
assert.equal(ai.findQuest(child.id, quest.id).plan[0].status, 'running')
ai.updateQuestStep(child.id, quest.id, 'inspect', { status: 'completed', result: { ok: true } })
assert.equal(ai.quest.read(child.id, quest.id, agent.id).plan[0].status, 'completed')
assert.equal(ai.quest.read(child.id, quest.id, agent.id).currentStepId, 'inspect')

const input = ai.appendMessage(agent.id, { role: 'user', from: 'user', content: 'context please' })
const request = ai.makeRequest(agent, input, 'run_context_test', agent.id, 0)
assert.ok(request.contextPack)
assert.equal(request.contextPack.items.some(function (item) { return item.layer === 'runtime' }), true)
assert.equal(request.contextPack.items.some(function (item) { return item.layer === 'context' }), true)
assert.equal(ai.trace.list('run_context_test').some(function (event) { return event.type === 'request_built' }), true)

ai.tools.register('trace-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
  capabilities: { write: true, idempotent: false },
})
assert.equal(ai.tools.capabilities('trace-edit').apply, true)
assert.equal(ai.tools.capabilities('trace-edit').write, true)
assert.equal(ai.tools.capabilities('trace-edit').risk, 'write')

replies.push({
  role: 'assistant',
  content: '',
  toolCalls: [{ toolId: 'trace-edit', args: { before: 'a', after: 'b' } }],
})
replies.push({ role: 'assistant', content: 'changed' })

const run = ai.message.send(agent.id, { content: 'edit' })
await run.promise
await flush()

const capabilityRequest = ai.makeRequest(ai.findAgent(agent.id), null, 'run_capability_test', agent.id, 0)
assert.equal(capabilityRequest.connectionCapabilities.stream, true)
assert.equal(capabilityRequest.connectionCapabilities.toolCalling, true)
assert.equal(capabilityRequest.toolSpecs.some(function (tool) {
  return tool.id === 'trace-edit' && tool.capabilities && tool.capabilities.apply && tool.capabilities.write
}), true)

const events = ai.trace.list().filter(function (event) { return event.agentId === agent.id })
assert.equal(events.some(function (event) { return event.type === 'run_started' }), true)
assert.equal(events.some(function (event) { return event.type === 'provider_request_started' }), true)
assert.equal(events.some(function (event) { return event.type === 'tool_preview_started' }), true)
assert.equal(events.some(function (event) { return event.type === 'tool_apply_completed' && event.status === 'applied' }), true)
assert.equal(events.some(function (event) { return event.type === 'run_completed' }), true)

console.log('ai agent runtime primitive tests passed')

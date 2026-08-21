import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/ai/agent/name-generator.js',
  'src/ai/serialize.js',
  'src/ai/trace.js',
  'src/ai/context-pack.js',
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
  'src/ai/tool/scheduler.js',
  'src/ai/tool/runtime.js',
  'src/ai/agent/orchestration.js',
  'src/ai/agent/request.js',
  'src/ai/agent/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai
const TEST_META = { owner: 'test:agent-primitives' }
const replies = []

async function flush(count = 1) {
  for (let i = 0; i < count; i++) await new Promise(function (resolve) { setTimeout(resolve, 0) })
}

ai.registerTransport('agent-primitives', {
  toolProtocol: 'native',
  send: function () {
    return replies.shift() || { role: 'assistant', content: 'done' }
  },
})
ai.registerConnection('agent-primitives', { auth: { type: 'none' }, transport: { type: 'agent-primitives' }, configDefaults: {} })

ai.context.register('selection.test', function () {
  return { selection: ['node-a'], summary: 'current selection' }
}, TEST_META)

const agent = ai.createAgent({
  name: 'Root Agent',
  connection: 'agent-primitives',
  permissionMode: 'full',
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
const request = ai.planRequest(agent, input, 'run_context_test', agent.id, 0)
assert.ok(request.contextPack)
assert.equal(request.contextPack.items.some(function (item) { return item.layer === 'runtime' }), true)
assert.equal(request.contextPack.items.some(function (item) { return item.layer === 'context' }), true)
assert.equal(ai.trace.list('run_context_test').some(function (event) { return event.type === 'request_built' }), true)

ai.tools.register('trace-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
  capabilities: { write: true, idempotent: false },
}, TEST_META)
ai.skills.register('test.trace-edit', {
  title: 'Trace Edit',
  toolDisclosure: 'always',
  tools: ['trace-edit'],
}, TEST_META)
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

const capabilityRequest = ai.planRequest(ai.findAgent(agent.id), null, 'run_capability_test', agent.id, 0)
assert.equal(capabilityRequest.connectionCapabilities.stream, true)
assert.equal(capabilityRequest.connectionCapabilities.toolProtocol, 'native')
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

const protocolAgent = ai.createAgent({
  name: 'Protocol Agent',
  connection: 'agent-primitives',
  select: false,
})
replies.push({
  role: 'assistant',
  content: '<trace-edit><before>a</before><after>b</after></trace-edit>',
  finishReason: 'stop',
})
const protocolRun = ai.message.send(protocolAgent.id, { content: 'edit through a tool' })
await protocolRun.promise
const protocolMessage = ai.findAgent(protocolAgent.id).messages.at(-1)
assert.equal(protocolMessage.status, 'error')
assert.equal(protocolMessage.meta.errorCode, 'TOOL_PROTOCOL_INVALID')
assert.match(protocolMessage.content, /<trace-edit>/)

const interruptedAgent = ai.createAgent({
  name: 'Interrupted Agent',
  connection: 'agent-primitives',
  select: false,
})
replies.push({ role: 'assistant', content: 'partial', finishReason: 'insufficient_system_resource' })
const interruptedRun = ai.message.send(interruptedAgent.id, { content: 'answer' })
await interruptedRun.promise
const interruptedMessage = ai.findAgent(interruptedAgent.id).messages.at(-1)
assert.equal(interruptedMessage.meta.finishReason, 'insufficient_system_resource')
assert.equal(interruptedMessage.content, 'partial')

ai.registerTransport('no-tools', {
  toolProtocol: 'none',
  send: function () { return { role: 'assistant', content: 'no tools' } },
})
ai.registerConnection('no-tools', { auth: { type: 'none' }, transport: { type: 'no-tools' }, configDefaults: {} })
const noToolAgent = ai.createAgent({
  name: 'No Tool Agent',
  connection: 'no-tools',
  select: false,
})
const noToolRequest = ai.planRequest(noToolAgent, null, 'no_tool_request', noToolAgent.id, 0)
assert.deepEqual(noToolRequest.tools, [])
assert.equal(noToolRequest.connectionCapabilities.toolProtocol, 'none')
const noToolRuntimePrompt = noToolRequest.messages.find(function (message) {
  return message.role === 'system' && message.meta && message.meta.contextCardId === 'runtime'
})
assert.match(noToolRuntimePrompt.content, /You are an AI agent\./)
assert.match(noToolRuntimePrompt.content, /Keep responses concise, clear, and limited to what is necessary\./)
assert.doesNotMatch(noToolRuntimePrompt.content, /You are an AIditor agent/)
assert.doesNotMatch(noToolRuntimePrompt.content, /CURRENT_AGENT_ID|CURRENT_AGENT_NAME|CURRENT_PARENT_AGENT_ID/)
assert.doesNotMatch(noToolRuntimePrompt.content, /AVAILABLE_TOOLS: none/)
assert.equal(noToolRequest.messages.some(function (message) {
  return message.meta && message.meta.contextCardId === 'skill-catalog'
}), true)

const customPromptAgent = ai.createAgent({
  name: 'Custom Prompt Agent',
  connection: 'no-tools',
  systemPrompt: 'Custom project prompt.',
  select: false,
})
const customPromptRequest = ai.planRequest(customPromptAgent, null, 'custom_prompt_request', customPromptAgent.id, 0)
const customRuntimePrompt = customPromptRequest.messages.find(function (message) {
  return message.meta && message.meta.contextCardId === 'runtime'
})
assert.equal(customRuntimePrompt.content, 'Custom project prompt.')
assert.doesNotMatch(customRuntimePrompt.content, /You are an AI agent/)

const emptyPromptAgent = ai.createAgent({
  name: 'Empty Prompt Agent',
  connection: 'no-tools',
  systemPrompt: '',
  select: false,
})
const emptyPromptRequest = ai.planRequest(emptyPromptAgent, null, 'empty_prompt_request', emptyPromptAgent.id, 0)
assert.equal(emptyPromptRequest.messages.some(function (message) {
  return message.meta && message.meta.contextCardId === 'runtime'
}), false)

console.log('ai agent runtime primitive tests passed')

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
  'src/ai/schema.js',
  'src/ai/trace.js',
  'src/ai/context-pack.js',
  'src/ai/permission.js',
  'src/ai/store.js',
  'src/ai/persistence.js',
  'src/ai/connection.js',
  'src/ai/adapter.js',
  'src/ai/provider.js',
  'src/ai/provider-transports.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/tool/scheduler.js',
  'src/ai/tool/runtime.js',
  'src/ai/request.js',
  'src/ai/runtime.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const ai = window.aiditor.ai
ai.configurePersistence({ enabled: false, load: false })

const replies = []
ai.registerTransport('structured-test', {
  toolProtocol: 'native',
  outputProtocol: 'text',
  send: function () { return replies.shift() },
})
ai.registerConnection('structured-test', {
  auth: { type: 'none' },
  transport: { type: 'structured-test' },
  configDefaults: {},
})

const outputSchema = {
  type: 'object',
  required: ['name', 'count'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    count: { type: 'integer', minimum: 1 },
  },
}
const agent = ai.createAgent({ name: 'Structured', connection: 'structured-test', outputSchema: outputSchema })
const request = ai.planRequest(agent, null, 'output-request', 'user', 0)
assert.deepEqual(request.outputSchema, outputSchema)
assert.equal(request.messages.some(function (message) { return String(message.content).includes('FINAL_OUTPUT_CONTRACT') }), true)

replies.push({ role: 'assistant', content: '```json\n{"name":"alpha","count":2}\n```' })
const validRun = ai.message.send(agent.id, { content: 'return data' })
await validRun.promise
let current = ai.findAgent(agent.id)
let assistant = current.messages.at(-1)
assert.equal(assistant.status, 'done')
assert.deepEqual(assistant.output, { name: 'alpha', count: 2 })
assert.equal(ai.trace.list(assistant.meta.runId).some(function (event) { return event.type === 'output_validated' }), true)

replies.push({ role: 'assistant', content: '{"name":"missing count"}' })
const invalidRun = ai.message.send(agent.id, { content: 'return invalid data' })
await invalidRun.promise
current = ai.findAgent(agent.id)
assistant = current.messages.at(-1)
assert.equal(assistant.status, 'error')
assert.equal(assistant.meta.errorCode, 'OUTPUT_SCHEMA_INVALID')
assert.equal(current.status, 'failed')

ai.tools.register('structured.read', {
  run: function () { return { value: 2 } },
}, { owner: 'test:output' })
ai.skills.register('test.structured-output', { title: 'Structured Output', tools: ['structured.read'] }, { owner: 'test:output' })
const toolAgent = ai.createAgent({
  name: 'Structured Tool Flow',
  connection: 'structured-test',
  outputSchema: outputSchema,
  skillRefs: ['test.structured-output'],
})
replies.push({ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', toolId: 'structured.read', args: {} }], finishReason: 'tool_calls' })
replies.push({ role: 'assistant', content: '{"name":"after tool","count":2}' })
const toolRun = ai.message.send(toolAgent.id, { content: 'read then return data' })
await toolRun.promise
const finalToolMessage = ai.findAgent(toolAgent.id).messages.at(-1)
assert.equal(finalToolMessage.role, 'assistant')
assert.deepEqual(finalToolMessage.output, { name: 'after tool', count: 2 })

assert.equal(ai.schema.validate([1, 2], { type: 'array', items: { type: 'integer' } }).valid, true)
assert.equal(ai.schema.validate([1, '2'], { type: 'array', items: { type: 'integer' } }).valid, false)
assert.equal(ai.schema.validate('ok', { anyOf: [{ type: 'string' }, { type: 'number' }], minLength: 2 }).valid, true)
assert.throws(function () {
  ai.schema.normalize({ type: 'object', required: ['missing'], properties: {} })
}, function (err) { return err.code === 'SCHEMA_REQUIRED_UNKNOWN' })

console.log('ai structured output tests ok')

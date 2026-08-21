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
  'src/ai/schema.js',
  'src/ai/trace.js',
  'src/ai/permission.js',
  'src/ai/agent/store.js',
  'src/ai/agent/persistence.js',
  'src/ai/agent/checkpoints.js',
  'src/ai/agent/evals.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const ai = window.aiditor.ai
ai.configurePersistence({ enabled: false, load: false })
const records = new Map()
const adapter = {
  load: function (key) { return records.get(key) || null },
  save: function (key, value) { records.set(key, value) },
  remove: function (key) { records.delete(key) },
}
ai.checkpoints.configure({ enabled: true, adapter: adapter, key: 'test', autoSave: false })

const queued = ai.createAgent({ name: 'Queued', select: false })
const queuedMessage = ai.appendMessage(queued.id, { role: 'user', content: 'queued', status: 'queued' })
ai.enqueueMessage(queued.id, queuedMessage.id)
ai.createQuest(queued.id, { id: queuedMessage.id, requestMessageId: queuedMessage.id, status: 'queued' })
const running = ai.createAgent({ name: 'Running', select: false })
const runningMessage = ai.appendMessage(running.id, {
  role: 'assistant',
  content: 'running',
  status: 'running',
  toolCalls: [{ id: 'pending-call', toolId: 'pending.tool', status: 'running' }],
})
ai.createQuest(running.id, { id: runningMessage.id, requestMessageId: runningMessage.id, status: 'running' })

const saved = await ai.checkpoints.capture('test')
assert.equal(saved.key, 'test')
ai.deleteAgent(queued.id)
ai.deleteAgent(running.id)
const restored = await ai.checkpoints.restore({ resumeQueued: false })
assert.ok(restored)
assert.equal(ai.findAgent(queued.id).status, 'queued')
assert.equal(ai.findAgent(queued.id).queue.length, 1)
assert.equal(ai.findQuest(queued.id, queuedMessage.id).status, 'queued')
assert.equal(ai.findAgent(running.id).messages[0].status, 'stopped')
assert.equal(ai.findAgent(running.id).messages[0].toolCalls[0].status, 'failed')
assert.equal(ai.findQuest(running.id, runningMessage.id).status, 'stopped')
assert.equal(ai.findQuest(running.id, runningMessage.id).stopReason, 'reload')
await ai.checkpoints.clear()
assert.equal(records.has('test'), false)

let failedSaves = 0
ai.checkpoints.configure({
  enabled: true,
  autoSave: false,
  adapter: {
    load: function () { return null },
    save: function () { failedSaves++; throw new Error('storage failed') },
    remove: function () {},
  },
})
await assert.rejects(ai.checkpoints.capture('failure'))
await assert.rejects(ai.checkpoints.capture('failure-again'), function (err) { return err.code === 'CHECKPOINT_UNAVAILABLE' })
assert.equal(failedSaves, 1)
assert.equal(ai.checkpoints.status().state, 'error')

ai.trace.append({ type: 'tool_completed', runId: 'eval-trace', status: 'completed' })
const report = await ai.evals.run({
  id: 'math',
  cases: [{ id: 'two', input: 1, expected: { value: 2 } }],
  execute: function (testCase, ctx) {
    ctx.trace('eval-trace')
    return { value: testCase.input + 1 }
  },
  evaluators: [
    ai.evals.evaluators.noError(),
    ai.evals.evaluators.equalsExpected(),
    ai.evals.evaluators.schema({ type: 'object', required: ['value'], properties: { value: { type: 'integer' } } }),
    ai.evals.evaluators.trace('tool-completed', function (event) { return event.type === 'tool_completed' }),
  ],
})
assert.deepEqual(report.summary, { total: 1, passed: 1, failed: 0, errors: 0 })
assert.equal(report.cases[0].pass, true)
assert.equal(report.cases[0].scores.length, 4)

console.log('ai checkpoints and evals tests ok')

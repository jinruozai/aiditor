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
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/tool/scheduler.js',
  'src/ai/tool/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai
const wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

const events = []
let active = 0
let maxActive = 0
const scheduled = await ai.toolScheduler.schedule([
  { id: 'a', delay: 15, mode: 'parallel' },
  { id: 'b', delay: 5, mode: 'parallel' },
  { id: 'barrier', delay: 1, mode: 'exclusive' },
  { id: 'c', delay: 5, mode: 'parallel' },
  { id: 'd', delay: 5, mode: 'parallel' },
], {
  parallelLimit: 2,
  mode: function (item) { return item.mode },
  execute: async function (item) {
    active++
    maxActive = Math.max(maxActive, active)
    events.push('start:' + item.id)
    await wait(item.delay)
    events.push('end:' + item.id)
    active--
    return item.id
  },
})

assert.deepEqual(scheduled, ['a', 'b', 'barrier', 'c', 'd'])
assert.equal(maxActive, 2)
assert.equal(events.indexOf('start:barrier') > events.indexOf('end:a'), true)
assert.equal(events.indexOf('start:barrier') > events.indexOf('end:b'), true)
assert.equal(events.indexOf('start:c') > events.indexOf('end:barrier'), true)

const policyAgent = ai.createAgent({ name: 'Policy Agent' })
const writeTarget = { entry: 'workspace.writeText', phase: 'apply', target: 'src/a.js', risk: 'write' }
assert.equal(policyAgent.permissionMode, 'auto')
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', writeTarget).decision, 'ask')
ai.updateAgent(policyAgent.id, { permissionMode: 'default' })
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', writeTarget).decision, 'deny')
ai.updateAgent(policyAgent.id, { permissionMode: 'full' })
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', writeTarget).decision, 'allow')
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', Object.assign({}, writeTarget, { risk: 'network' })).decision, 'ask')
ai.updateAgent(policyAgent.id, { permissionMode: 'custom' })
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', writeTarget).decision, 'unavailable')
assert.equal(ai.permissions.decide('user', policyAgent.id, 'tool.apply', writeTarget).decision, 'allow')
ai.updateAgent(policyAgent.id, { permissionMode: 'auto' })
const granted = ai.permissions.grant(policyAgent.id, writeTarget)
assert.equal(granted.length, 1)
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', writeTarget).decision, 'allow')
assert.equal(ai.permissions.decide(policyAgent.id, policyAgent.id, 'tool.apply', Object.assign({}, writeTarget, { target: 'src/b.js' })).decision, 'ask')
assert.equal(ai.permissions.revoke(policyAgent.id, granted[0].id), true)

let releaseLate
ai.tools.register('test.timeout', {
  timeoutMs: 10,
  schema: { type: 'object', properties: {} },
  run: function (args, ctx) {
    return new Promise(function (resolve) {
      releaseLate = function () { resolve({ late: true, aborted: ctx.signal.aborted }) }
    })
  },
}, { owner: 'test:scheduler' })

const timeoutCall = ai.createToolCall(policyAgent.id, { toolId: 'test.timeout' }, 'user')
ai.approveToolCall(policyAgent.id, timeoutCall.id, 'user')
const timeoutRun = ai.runToolCall(policyAgent.id, timeoutCall.id, 'user')
const timedOut = await timeoutRun.promise
assert.equal(timedOut.status, 'failed')
assert.equal(timedOut.errorDetails.code, 'TOOL_TIMEOUT')
releaseLate()
await Promise.resolve()
await Promise.resolve()
assert.equal(ai.findToolCall(policyAgent.id, timeoutCall.id).toolCall.status, 'failed')
assert.equal(ai.findToolCall(policyAgent.id, timeoutCall.id).toolCall.errorDetails.code, 'TOOL_TIMEOUT')

let releaseCancelled
ai.tools.register('test.cancel', {
  schema: { type: 'object', properties: {} },
  run: function (args, ctx) {
    return new Promise(function (resolve) {
      releaseCancelled = function () { resolve({ late: true, aborted: ctx.signal.aborted }) }
    })
  },
}, { owner: 'test:scheduler' })

const cancelController = new AbortController()
const cancelCall = ai.createToolCall(policyAgent.id, { toolId: 'test.cancel' }, 'user')
ai.approveToolCall(policyAgent.id, cancelCall.id, 'user')
const cancelRun = ai.runToolCall(policyAgent.id, cancelCall.id, 'user', { signal: cancelController.signal })
await Promise.resolve()
await Promise.resolve()
cancelController.abort()
const cancelled = await cancelRun.promise
assert.equal(cancelled.status, 'failed')
assert.equal(cancelled.errorDetails.code, 'TOOL_CANCELLED')
releaseCancelled()
await Promise.resolve()
await Promise.resolve()
assert.equal(ai.findToolCall(policyAgent.id, cancelCall.id).toolCall.errorDetails.code, 'TOOL_CANCELLED')

console.log('ai tool scheduler tests ok')

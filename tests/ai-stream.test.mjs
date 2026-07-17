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
  'src/ai/request.js',
  'src/ai/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai

function byId(items, id) {
  return items.find(function (item) { return item.id === id })
}

let streamRequest = null
let streamCtx = null
ai.registerTransport('stream-capture', {
  send: async function (connection, request, ctx) {
    streamRequest = request
    streamCtx = ctx
    assert.equal(ctx.signal.aborted, false)
    return {
      role: 'assistant',
      content: ['alpha', 'beta', 'gamma'].join(''),
      meta: { chunks: ['alpha', 'beta', 'gamma'] },
    }
  },
})
ai.registerConnection('stream-capture', { auth: { type: 'none' }, transport: { type: 'stream-capture' }, configDefaults: {} })

const streamed = ai.createAgent({
  name: 'Streamer',
  connection: 'stream-capture',
  model: 'stream-model',
})
ai.updateAgent(streamed.id, { stream: true })
const sent = ai.message.send(streamed.id, { content: 'stream this' }, 'user')
assert.equal(sent.request.stream, true)
assert.equal(byId(ai.agents(), streamed.id).status, 'running')
const streamedReply = await sent.promise
assert.equal(streamRequest.stream, true)
assert.equal(streamRequest.connection, 'stream-capture')
assert.equal(streamRequest.model, 'stream-model')
assert.equal(streamRequest.messages.at(-1).content, 'stream this')
assert.equal(streamCtx.runId, streamRequest.runId)
assert.equal(streamedReply.content, 'alphabetagamma')
assert.deepEqual(streamedReply.meta, { chunks: ['alpha', 'beta', 'gamma'] })
assert.equal(byId(ai.agents(), streamed.id).status, 'idle')
assert.equal(ai.peekActiveRunState(streamed.id).state, 'idle')
assert.equal(ai.peekActiveRunState(streamed.id).previewTail, 'alphabetagamma')

let release
const held = new Promise(function (resolve) { release = resolve })
let abortCtx = null
ai.registerTransport('stream-hold', {
  send: function (connection, request, ctx) {
    abortCtx = ctx
    return held.then(function () {
      return { role: 'assistant', content: ctx.signal.aborted ? 'aborted' : 'late' }
    })
  },
})
ai.registerConnection('stream-hold', { auth: { type: 'none' }, transport: { type: 'stream-hold' }, configDefaults: {} })

const aborting = ai.createAgent({
  name: 'Abort Stream',
  connection: 'stream-hold',
})
ai.updateAgent(aborting.id, { stream: true })
const run = ai.runAgent(aborting.id)
assert.equal(run.request.stream, true)
await Promise.resolve()
await Promise.resolve()
assert.equal(byId(ai.agents(), aborting.id).status, 'running')
assert.equal(ai.stopAgent(aborting.id), true)
assert.equal(abortCtx.signal.aborted, true)
assert.equal(byId(ai.agents(), aborting.id).status, 'idle')
release()
assert.equal(await run.promise, null)
assert.equal(byId(ai.agents(), aborting.id).messages.length, 1)
assert.equal(byId(ai.agents(), aborting.id).messages[0].status, 'stopped')

ai.tools.register('stream-read', {
  run: function (args) { return { ok: true, query: args.query } },
})
let toolStreamRequests = 0
ai.registerTransport('stream-tool-flow', {
  send: function () {
    toolStreamRequests += 1
    if (toolStreamRequests === 1) {
      return {
        deltas: (async function* () {
          yield { text: 'Let me check. ' }
          yield { toolCalls: [{ index: 0, id: 'call_stream_read', type: 'function', function: { name: 'stream-read', arguments: '{"query":' } }] }
          yield { toolCalls: [{ index: 0, function: { arguments: '"dock"}' } }] }
        })(),
      }
    }
    return { role: 'assistant', content: 'stream tool continued' }
  },
})
ai.registerConnection('stream-tool-flow', { auth: { type: 'none' }, transport: { type: 'stream-tool-flow' }, configDefaults: {} })
const streamingTool = ai.createAgent({
  name: 'Stream Tool',
  connection: 'stream-tool-flow',
  permissionMode: 'full',
  toolRefs: ['stream-read'],
})
ai.updateAgent(streamingTool.id, { stream: true })
const toolRun = ai.message.send(streamingTool.id, { content: 'use streaming tool' }, 'user')
await toolRun.promise
assert.equal(toolStreamRequests, 2)
const toolMessage = byId(ai.agents(), streamingTool.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.length
})
assert.equal(toolMessage.content, 'Let me check. ')
assert.equal(toolMessage.toolCalls[0].toolId, 'stream-read')
assert.equal(toolMessage.toolCalls[0].args.query, 'dock')
assert.equal(toolMessage.toolCalls[0].status, 'completed')
assert.equal(byId(ai.agents(), streamingTool.id).messages.some(function (message) {
  return message.role === 'tool' && message.meta && message.meta.toolCallId === toolMessage.toolCalls[0].id
}), true)
assert.equal(byId(ai.agents(), streamingTool.id).messages.some(function (message) {
  return message.content === 'stream tool continued'
}), true)

ai.tools.register('stream-hidden-tool', {
  exposeToModel: false,
  run: function () { hiddenToolExecuted += 1; throw new Error('hidden tool must not run') },
})
let hiddenToolRequests = 0
let hiddenToolExecuted = 0
ai.registerTransport('stream-hidden-tool-flow', {
  send: function (connection, request) {
    hiddenToolRequests += 1
    assert.equal(request.tools.includes('stream-hidden-tool'), false)
    if (hiddenToolRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_hidden', toolId: 'stream-hidden-tool', args: {} }],
      }
    }
    return { role: 'assistant', content: 'continued after unavailable tool' }
  },
})
ai.registerConnection('stream-hidden-tool-flow', { auth: { type: 'none' }, transport: { type: 'stream-hidden-tool-flow' }, configDefaults: {} })
const hiddenToolAgent = ai.createAgent({
  name: 'Hidden Tool Guard',
  connection: 'stream-hidden-tool-flow',
  permissionMode: 'full',
})
await ai.message.send(hiddenToolAgent.id, { content: 'try hidden tool' }, 'user').promise
assert.equal(hiddenToolRequests, 2)
const hiddenToolMessage = byId(ai.agents(), hiddenToolAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls[0] && message.toolCalls[0].toolId === 'stream-hidden-tool'
})
assert.equal(hiddenToolMessage.toolCalls[0].status, 'failed')
assert.match(hiddenToolMessage.toolCalls[0].error, /not available/)
assert.equal(hiddenToolExecuted, 0)
assert.equal(byId(ai.agents(), hiddenToolAgent.id).messages.some(function (message) {
  return message.role === 'tool' && /not available/.test(message.content)
}), true)
assert.equal(byId(ai.agents(), hiddenToolAgent.id).messages.some(function (message) {
  return message.role === 'tool' && /not allowed/.test(message.content)
}), false)
assert.equal(byId(ai.agents(), hiddenToolAgent.id).messages.some(function (message) {
  return message.content === 'continued after unavailable tool'
}), true)

ai.tools.register('stream-approval-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('stream-approval-flow', {
  send: function () {
    return {
      deltas: (async function* () {
        yield { text: 'Need approval before editing. ' }
        yield { toolCalls: [{ index: 0, id: 'call_stream_approval', type: 'function', function: { name: 'stream-approval-edit', arguments: '{"before":1,"after":2}' } }] }
      })(),
    }
  },
})
ai.registerConnection('stream-approval-flow', { auth: { type: 'none' }, transport: { type: 'stream-approval-flow' }, configDefaults: {} })
const streamApproval = ai.createAgent({
  name: 'Stream Approval',
  connection: 'stream-approval-flow',
  permissionMode: 'auto',
  toolRefs: ['stream-approval-edit'],
})
ai.updateAgent(streamApproval.id, { stream: true })
await ai.message.send(streamApproval.id, { content: 'needs approval' }, 'user').promise
assert.equal(byId(ai.agents(), streamApproval.id).status, 'waiting_approval')
assert.equal(ai.peekActiveRunState(streamApproval.id).state, 'waiting_approval')
assert.equal(ai.peekActiveRunState(streamApproval.id).previewTail, 'Need approval before editing. ')
assert.equal(ai.peekActiveRunState(streamApproval.id).modelTail, 'Need approval before editing. stream-approval-edit{"before":1,"after":2}')
assert.equal(ai.peekActiveRunState(streamApproval.id).activityText, 'previewing stream-approval-edit · {"before":1,"after":2}')
assert.equal(ai.stopAgent(streamApproval.id), true)

ai.registerTransport('stream-reasoning-flow', {
  send: function () {
    return {
      deltas: (async function* () {
        yield { reasoning_content: 'hidden ' }
        yield { reasoning_content: 'thought', text: 'visible' }
      })(),
    }
  },
})
ai.registerConnection('stream-reasoning-flow', { auth: { type: 'none' }, transport: { type: 'stream-reasoning-flow' }, configDefaults: {} })
const reasoningAgent = ai.createAgent({
  name: 'Stream Reasoning',
  connection: 'stream-reasoning-flow',
})
ai.updateAgent(reasoningAgent.id, { stream: true })
const reasoningRun = ai.message.send(reasoningAgent.id, { content: 'reason' }, 'user')
await reasoningRun.promise
const reasoningMessage = byId(ai.agents(), reasoningAgent.id).messages.find(function (message) {
  return message.role === 'assistant'
})
assert.equal(reasoningMessage.content, 'visible')
assert.equal(reasoningMessage.reasoning_content, 'hidden thought')
assert.equal(ai.peekActiveRunState(reasoningAgent.id).modelTail, 'hidden thoughtvisible')

ai.tools.register('circular-tool-result', {
  run: function () {
    const out = { ok: true }
    out.self = out
    return out
  },
})
let circularRequests = 0
ai.registerTransport('stream-circular-tool-flow', {
  send: function () {
    circularRequests += 1
    if (circularRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_circular', toolId: 'circular-tool-result', args: {} }],
      }
    }
    return { role: 'assistant', content: 'continued after unserializable tool result' }
  },
})
ai.registerConnection('stream-circular-tool-flow', { auth: { type: 'none' }, transport: { type: 'stream-circular-tool-flow' }, configDefaults: {} })
const circularAgent = ai.createAgent({
  name: 'Circular Tool',
  connection: 'stream-circular-tool-flow',
  permissionMode: 'full',
  toolRefs: ['circular-tool-result'],
})
const circularRun = ai.message.send(circularAgent.id, { content: 'use circular tool' }, 'user')
await circularRun.promise
assert.equal(byId(ai.agents(), circularAgent.id).status, 'idle')
assert.equal(circularRequests, 2)
assert.equal(byId(ai.agents(), circularAgent.id).messages.some(function (message) {
  return message.role === 'tool' && /\[Circular\]/.test(message.content)
}), true)
assert.equal(ai.peekActiveRunState(circularAgent.id).state, 'idle')

console.log('ai stream tests ok')

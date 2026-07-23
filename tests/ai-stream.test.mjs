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
  'src/ai/schema.js',
  'src/ai/trace.js',
  'src/ai/registries.js',
  'src/ai/context.js',
  'src/ai/reference.js',
  'src/ai/request.js',
  'src/ai/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai

function byId(items, id) {
  return items.find(function (item) { return item.id === id })
}

async function flush(count = 1) {
  for (let i = 0; i < count; i++) await new Promise(function (resolve) { setTimeout(resolve, 0) })
}

let streamRequest = null
let streamCtx = null
ai.registerTransport('stream-capture', {
  toolProtocol: 'native',
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
assert.deepEqual(streamedReply.meta.chunks, ['alpha', 'beta', 'gamma'])
assert.equal(streamedReply.meta.runId, streamRequest.runId)
assert.equal(streamedReply.meta.responseId, sent.message.id)
assert.equal(byId(ai.agents(), streamed.id).status, 'idle')
assert.equal(ai.peekActiveRunState(streamed.id).state, 'idle')
assert.equal(ai.peekActiveRunState(streamed.id).previewTail, 'alphabetagamma')

let releaseDelegatedStream
const delegatedStreamGate = new Promise(function (resolve) { releaseDelegatedStream = resolve })
let delegatedStreamRequest = null
ai.registerTransport('delegated-stream', {
  toolProtocol: 'native',
  send: function (connection, request) {
    delegatedStreamRequest = request
    return {
      deltas: (async function* () {
        yield { text: 'first child chunk ' }
        await delegatedStreamGate
        yield { text: 'second child chunk' }
      })(),
    }
  },
})
ai.registerConnection('delegated-stream', { auth: { type: 'none' }, transport: { type: 'delegated-stream' }, configDefaults: { stream: true } })
const delegatedParent = ai.createAgent({ name: 'Delegated Parent', connection: 'delegated-stream' })
const delegatedChild = ai.createAgent({ name: 'Delegated Child', parentAgentId: delegatedParent.id, connection: 'delegated-stream' })
const delegatedQuest = ai.agent.send(delegatedChild.id, {
  fromAgentId: delegatedParent.id,
  content: 'first delegated request',
})
await flush(3)
assert.equal(delegatedStreamRequest.stream, true)
assert.equal(ai.peekActiveRunState(delegatedChild.id).state, 'receiving')
assert.equal(ai.peekActiveRunState(delegatedChild.id).previewTail, 'first child chunk ')
assert.equal(ai.findQuest(delegatedChild.id, delegatedQuest.questId).status, 'running')
releaseDelegatedStream()
await flush(5)
assert.equal(ai.findQuest(delegatedChild.id, delegatedQuest.questId).status, 'completed')

let disabledStreamRequest = null
ai.registerTransport('stream-disabled', {
  toolProtocol: 'native',
  send: function (connection, request) {
    disabledStreamRequest = request
    return { role: 'assistant', content: 'non-stream response' }
  },
})
ai.registerConnection('stream-disabled', { auth: { type: 'none' }, transport: { type: 'stream-disabled' }, capabilities: { stream: true }, configDefaults: { stream: false } })
const disabledStreamAgent = ai.createAgent({ name: 'Disabled Stream', connection: 'stream-disabled' })
await ai.message.send(disabledStreamAgent.id, { content: 'do not stream' }, 'user').promise
assert.equal(disabledStreamRequest.stream, false)

let release
const held = new Promise(function (resolve) { release = resolve })
let abortCtx = null
ai.registerTransport('stream-hold', {
  toolProtocol: 'native',
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
  toolProtocol: 'native',
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

const structuredBridgeArgs = {
  enabled: true,
  count: 0,
  nothing: null,
  rows: [[1, 2], [3, 4]],
  jsonLiteral: '{"keep":"string"}',
  nested: { values: [false, null, '[1,2]'] },
}
let receivedStructuredBridgeArgs = null
let structuredBridgeRequests = 0
ai.tools.register('structured-bridge-tool', {
  run: function (args) {
    receivedStructuredBridgeArgs = args
    return { ok: true }
  },
})
ai.registerTransport('structured-bridge-flow', {
  toolProtocol: 'native',
  send: function () {
    structuredBridgeRequests += 1
    if (structuredBridgeRequests === 1) {
      return {
        deltas: (async function* () {
          yield {
            toolCalls: [{
              index: 0,
              id: 'call_structured_bridge',
              type: 'function',
              function: { name: 'structured-bridge-tool', arguments: structuredBridgeArgs },
            }],
          }
        })(),
      }
    }
    return { role: 'assistant', content: 'structured bridge complete' }
  },
})
ai.registerConnection('structured-bridge-flow', { auth: { type: 'none' }, transport: { type: 'structured-bridge-flow' }, configDefaults: {} })
const structuredBridgeAgent = ai.createAgent({
  name: 'Structured Bridge',
  connection: 'structured-bridge-flow',
  permissionMode: 'full',
  toolRefs: ['structured-bridge-tool'],
})
await ai.message.send(structuredBridgeAgent.id, { content: 'preserve structured arguments' }, 'user').promise
assert.deepEqual(receivedStructuredBridgeArgs, structuredBridgeArgs)
assert.equal(receivedStructuredBridgeArgs.jsonLiteral, '{"keep":"string"}')
assert.equal(structuredBridgeRequests, 2)

let operationProjectionRequests = 0
let operationProjectionExecutions = 0
let operationProjectionApplies = 0
ai.operations.register('stream.setValue', {
  title: 'Set stream value',
  exposeToModel: true,
  inputSchema: {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: { value: { type: 'number' } },
  },
  preview: function (input) {
    operationProjectionExecutions += 1
    return { title: 'Set stream value', next: input.value }
  },
  apply: function () { operationProjectionApplies += 1; return { applied: true } },
})
ai.operations.register('stream.dynamic', {
  exposeToModel: true,
  inputSchema: {
    type: 'object',
    additionalProperties: { type: 'string' },
  },
  preview: function () { throw new Error('incompatible sibling must not execute') },
  apply: function () { return { applied: true } },
})
ai.registerTransport('operation-projection', {
  toolProtocol: 'native',
  toolArguments: 'json',
  strictToolArguments: true,
  send: function (connection, request) {
    operationProjectionRequests += 1
    if (operationProjectionRequests === 1) {
      const strictSpec = request.toolSpecs.find(function (tool) {
        return tool.id === 'stream.setValue'
      })
      const fallbackSpec = request.toolSpecs.find(function (tool) {
        return tool.id === 'stream.dynamic'
      })
      assert.equal(strictSpec.argumentMode, 'strict')
      assert.equal(fallbackSpec.argumentMode, 'json')
      assert.equal(request.toolSpecs.some(function (tool) {
        return tool.id.indexOf('aiditor.previewOperation') >= 0 || tool.id.indexOf('aiditor.applyOperation') >= 0
      }), false)
      const wire = ai.openAiTools(request).find(function (tool) {
        return tool.function.description.indexOf('Public tool id: stream.setValue') >= 0
      })
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'call_operation_projection',
          type: 'function',
          function: { name: wire.function.name, arguments: '{"value":4}' },
        }],
      }
    }
    return { role: 'assistant', content: 'operation projection complete' }
  },
})
ai.registerConnection('operation-projection', {
  auth: { type: 'none' },
  transport: { type: 'operation-projection' },
  configDefaults: {},
  capabilities: { toolArguments: 'strict' },
})
const operationProjectionAgent = ai.createAgent({
  name: 'Operation Projection',
  connection: 'operation-projection',
  permissionMode: 'full',
  toolRefs: ['aiditor.applyOperation'],
})
const operationProjectionRun = ai.message.send(operationProjectionAgent.id, { content: 'preview value 4' }, 'user')
const operationProjectionReply = await operationProjectionRun.promise
assert.equal(operationProjectionReply.content, 'operation projection complete')
assert.equal(operationProjectionExecutions, 1)
assert.equal(operationProjectionApplies, 1)
assert.equal(operationProjectionRequests, 2)
const operationProjectionCall = byId(ai.agents(), operationProjectionAgent.id).messages
  .flatMap(function (message) { return message.toolCalls || [] })
  .find(function (call) { return call.id === 'call_operation_projection' })
assert.equal(operationProjectionCall.toolId, 'stream.setValue')
assert.equal(operationProjectionCall.providerToolId, 'stream.setValue')
assert.deepEqual(operationProjectionCall.providerArgs, { value: 4 })
assert.deepEqual(operationProjectionCall.args, { value: 4 })
assert.equal(operationProjectionCall.executorToolId, 'aiditor.applyOperation')
assert.deepEqual(operationProjectionCall.executorArgs, { op: 'stream.setValue', input: { value: 4 } })
const operationProjectionReplay = ai.openAiMessages([{
  role: 'assistant',
  content: '',
  toolCalls: [operationProjectionCall],
}, {
  role: 'tool',
  toolCallId: operationProjectionCall.id,
  content: '{"ok":true}',
}], operationProjectionRun.request)
assert.deepEqual(JSON.parse(operationProjectionReplay[0].tool_calls[0].function.arguments), { value: 4 })
assert.equal(ai.trace.list(operationProjectionRun.request.runId).some(function (event) {
  return event.type === 'tool_started' && event.entry === 'stream.setValue'
}), true)
assert.equal(ai.permissionAuditRecords().some(function (entry) {
  return entry.entry === 'stream.setValue'
}), true)

let operationProjectionRecoveryRequests = 0
ai.registerTransport('operation-projection-recovery', {
  toolProtocol: 'native',
  toolArguments: 'json',
  strictToolArguments: true,
  send: function (connection, request) {
    operationProjectionRecoveryRequests += 1
    if (operationProjectionRecoveryRequests <= 2) {
      const wire = ai.openAiTools(request).find(function (tool) {
        return tool.function.description.indexOf('Public tool id: stream.setValue') >= 0
      })
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'call_operation_projection_recovery_' + operationProjectionRecoveryRequests,
          type: 'function',
          function: {
            name: wire.function.name,
            arguments: operationProjectionRecoveryRequests === 1 ? '{"value":"bad"}' : '{"value":5}',
          },
        }],
      }
    }
    return { role: 'assistant', content: 'operation projection recovery complete' }
  },
})
ai.registerConnection('operation-projection-recovery', {
  auth: { type: 'none' },
  transport: { type: 'operation-projection-recovery' },
  configDefaults: {},
  capabilities: { toolArguments: 'strict' },
})
const operationProjectionRecoveryAgent = ai.createAgent({
  name: 'Operation Projection Recovery',
  connection: 'operation-projection-recovery',
  permissionMode: 'full',
  toolRefs: ['aiditor.applyOperation'],
})
const operationProjectionRecoveryRun = ai.message.send(operationProjectionRecoveryAgent.id, { content: 'recover projected operation arguments' }, 'user')
const operationProjectionRecoveryReply = await operationProjectionRecoveryRun.promise
assert.equal(operationProjectionRecoveryReply.content, 'operation projection recovery complete')
assert.equal(operationProjectionRecoveryRequests, 3)
assert.equal(operationProjectionExecutions, 2)
assert.equal(operationProjectionApplies, 2)
assert.equal(ai.trace.list(operationProjectionRecoveryRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_recovery_completed' }).length, 1)
assert.equal(ai.trace.list(operationProjectionRecoveryRun.request.runId).find(function (event) {
  return event.type === 'tool_arguments_recovery_started'
}).meta.path, '$.value')

let recoveredToolExecutions = 0
let recoveryRequests = 0
let recoveryReportErrors = 0
let recoveryRequest = null
ai.tools.register('recover-json-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function (args) {
    recoveredToolExecutions += 1
    return { ok: true, value: args.value }
  },
})
ai.registerTransport('tool-arguments-recovery', {
  toolProtocol: 'native',
  toolArguments: 'json',
  strictToolArguments: true,
  send: function (connection, request) {
    recoveryRequests += 1
    if (recoveryRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_recover_bad', type: 'function', function: { name: 'recover-json-tool', arguments: '{"value":' } }],
      }
    }
    if (recoveryRequests === 2) {
      recoveryRequest = request
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_recover_good', type: 'function', function: { name: 'recover-json-tool', arguments: '{"value":7}' } }],
      }
    }
    return { role: 'assistant', content: 'recovery complete' }
  },
})
ai.registerConnection('tool-arguments-recovery', { auth: { type: 'none' }, transport: { type: 'tool-arguments-recovery' }, configDefaults: {}, capabilities: { toolArguments: 'strict' } })
const recoveryAgent = ai.createAgent({
  name: 'Tool Arguments Recovery',
  connection: 'tool-arguments-recovery',
  permissionMode: 'full',
  toolRefs: ['recover-json-tool'],
})
const originalReportError = window.aiditor.reportError
window.aiditor.reportError = function () { recoveryReportErrors += 1 }
const recoveredRun = ai.message.send(recoveryAgent.id, { content: 'recover malformed arguments' }, 'user')
const recoveredReply = await recoveredRun.promise
window.aiditor.reportError = originalReportError
assert.equal(recoveredReply.content, 'recovery complete')
assert.equal(recoveryRequests, 3)
assert.equal(recoveredToolExecutions, 1)
assert.equal(recoveryReportErrors, 0)
assert.match(recoveryRequest.messages.at(-1).content, /TOOL_CALL_RECOVERY/)
assert.match(recoveryRequest.messages.at(-1).content, /No Tool from that response was executed/)
assert.deepEqual(recoveryRequest.tools, ['recover-json-tool'])
assert.deepEqual(recoveryRequest.toolChoice, { mode: 'required', tools: ['recover-json-tool'] })
assert.equal(recoveryRequest.toolSpecs[0].argumentMode, 'strict')
assert.equal(byId(ai.agents(), recoveryAgent.id).messages.some(function (message) { return message.status === 'error' }), false)
assert.equal(ai.trace.list(recoveredRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_recovery_started' }).length, 1)
assert.equal(ai.trace.list(recoveredRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_recovery_completed' }).length, 1)
assert.equal(ai.trace.list(recoveredRun.request.runId).filter(function (event) { return event.type === 'run_failed' }).length, 0)

let failedRecoveryRequests = 0
let failedRecoveryExecutions = 0
let failedRecoveryReports = 0
ai.tools.register('fail-json-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function () { failedRecoveryExecutions += 1; return { ok: true } },
})
ai.registerTransport('tool-arguments-recovery-fails', {
  toolProtocol: 'native',
  toolArguments: 'json',
  strictToolArguments: true,
  send: function () {
    failedRecoveryRequests += 1
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{
        id: 'call_fail_' + failedRecoveryRequests,
        type: 'function',
        function: { name: 'fail-json-tool', arguments: failedRecoveryRequests === 1 ? '{"value":' : '{"value":}' },
      }],
    }
  },
})
ai.registerConnection('tool-arguments-recovery-fails', { auth: { type: 'none' }, transport: { type: 'tool-arguments-recovery-fails' }, configDefaults: {}, capabilities: { toolArguments: 'strict' } })
const failedRecoveryAgent = ai.createAgent({
  name: 'Tool Arguments Recovery Fails',
  connection: 'tool-arguments-recovery-fails',
  permissionMode: 'full',
  toolRefs: ['fail-json-tool'],
})
window.aiditor.reportError = function () { failedRecoveryReports += 1 }
const failedRecoveryRun = ai.message.send(failedRecoveryAgent.id, { content: 'fail malformed arguments twice' }, 'user')
await failedRecoveryRun.promise
window.aiditor.reportError = originalReportError
assert.equal(failedRecoveryRequests, 3)
assert.equal(failedRecoveryExecutions, 0)
assert.equal(failedRecoveryReports, 1)
const failedRecoveryMessage = byId(ai.agents(), failedRecoveryAgent.id).messages.find(function (message) {
  return message.role === 'assistant' && message.status === 'error'
})
assert.equal(failedRecoveryMessage.meta.errorCode, 'TOOL_ARGUMENTS_INVALID_JSON')
assert.equal(failedRecoveryMessage.meta.toolArguments.toolName, 'fail-json-tool')
assert.equal(failedRecoveryMessage.meta.toolArguments.callId, 'call_fail_3')
assert.equal(failedRecoveryMessage.meta.toolArguments.argumentLength, 10)
assert.equal(Object.prototype.hasOwnProperty.call(failedRecoveryMessage.meta.toolArguments, 'parsePosition'), true)
assert.equal(failedRecoveryMessage.meta.toolArguments.argumentSnippet, '{"value":}')
assert.equal(failedRecoveryMessage.meta.toolArguments.recoveryAttempted, true)
assert.equal(ai.trace.list(failedRecoveryRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_recovery_started' }).length, 1)
assert.equal(ai.trace.list(failedRecoveryRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_recovery_completed' }).length, 0)
assert.equal(ai.trace.list(failedRecoveryRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_correction_requested' }).length, 1)

let validBatchExecutions = 0
let repairedBatchExecutions = 0
let batchRecoveryRequests = 0
ai.tools.register('batch-valid-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function () { validBatchExecutions += 1; return { ok: true } },
})
ai.tools.register('batch-repaired-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function () { repairedBatchExecutions += 1; return { ok: true } },
})
ai.registerTransport('tool-arguments-batch-recovery', {
  toolProtocol: 'native',
  toolArguments: 'json',
  strictToolArguments: true,
  send: function () {
    batchRecoveryRequests += 1
    if (batchRecoveryRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_batch_valid_first', type: 'function', function: { name: 'batch-valid-tool', arguments: '{"value":1}' } },
          { id: 'call_batch_bad', type: 'function', function: { name: 'batch-repaired-tool', arguments: '{"value":"bad"}' } },
        ],
      }
    }
    if (batchRecoveryRequests === 2) {
      assert.equal(validBatchExecutions, 0)
      assert.equal(repairedBatchExecutions, 0)
      return {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_batch_valid_retry', type: 'function', function: { name: 'batch-valid-tool', arguments: '{"value":1}' } },
          { id: 'call_batch_repaired_retry', type: 'function', function: { name: 'batch-repaired-tool', arguments: '{"value":2}' } },
        ],
      }
    }
    return { role: 'assistant', content: 'batch recovery complete' }
  },
})
ai.registerConnection('tool-arguments-batch-recovery', { auth: { type: 'none' }, transport: { type: 'tool-arguments-batch-recovery' }, configDefaults: {}, capabilities: { toolArguments: 'strict' } })
const batchRecoveryAgent = ai.createAgent({
  name: 'Tool Arguments Batch Recovery',
  connection: 'tool-arguments-batch-recovery',
  permissionMode: 'full',
  toolRefs: ['batch-valid-tool', 'batch-repaired-tool'],
})
await ai.message.send(batchRecoveryAgent.id, { content: 'run an atomic tool-call batch' }, 'user').promise
assert.equal(batchRecoveryRequests, 3)
assert.equal(validBatchExecutions, 1)
assert.equal(repairedBatchExecutions, 1)

let schemaCorrectionRequests = 0
let schemaCorrectionExecutions = 0
let schemaCorrectionToolResult = null
ai.tools.register('schema-correction-tool', {
  schema: {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: { value: { type: 'number' } },
  },
  run: function (args) {
    schemaCorrectionExecutions += 1
    return { ok: true, value: args.value }
  },
})
ai.registerTransport('schema-correction-flow', {
  toolProtocol: 'native',
  toolArguments: 'json',
  send: function (connection, request) {
    schemaCorrectionRequests += 1
    if (schemaCorrectionRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_schema_bad', toolId: 'schema-correction-tool', args: { value: 'bad' } }],
      }
    }
    if (schemaCorrectionRequests === 2) {
      assert.equal(schemaCorrectionExecutions, 0)
      const failedAssistant = request.messages.find(function (message) {
        return message.role === 'assistant' && message.toolCalls && message.toolCalls.some(function (call) { return call.id === 'call_schema_bad' })
      })
      assert.ok(failedAssistant, JSON.stringify(request.messages))
      assert.deepEqual(failedAssistant.toolCalls[0].args, { value: 'bad' })
      const toolResult = request.messages.find(function (message) {
        return message.role === 'tool' && message.meta && message.meta.toolCallId === 'call_schema_bad'
      })
      schemaCorrectionToolResult = JSON.parse(toolResult.content)
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_schema_good', toolId: 'schema-correction-tool', args: { value: 7 } }],
      }
    }
    return { role: 'assistant', content: 'schema correction complete' }
  },
})
ai.registerConnection('schema-correction-flow', { auth: { type: 'none' }, transport: { type: 'schema-correction-flow' }, configDefaults: {} })
const schemaCorrectionAgent = ai.createAgent({
  name: 'Schema Correction',
  connection: 'schema-correction-flow',
  permissionMode: 'full',
  toolRefs: ['schema-correction-tool'],
})
const schemaCorrectionRun = ai.message.send(schemaCorrectionAgent.id, { content: 'correct invalid schema arguments' }, 'user')
const schemaCorrectionReply = await schemaCorrectionRun.promise
assert.equal(schemaCorrectionReply.content, 'schema correction complete')
assert.equal(schemaCorrectionRequests, 3)
assert.equal(schemaCorrectionExecutions, 1)
assert.equal(schemaCorrectionToolResult.code, 'TOOL_ARGUMENTS_SCHEMA_INVALID')
assert.equal(schemaCorrectionToolResult.toolName, 'schema-correction-tool')
assert.equal(schemaCorrectionToolResult.callId, 'call_schema_bad')
assert.equal(schemaCorrectionToolResult.argumentMode, 'json')
assert.equal(schemaCorrectionToolResult.path, '$.value')
assert.equal(schemaCorrectionToolResult.keyword, 'type')
assert.match(schemaCorrectionToolResult.argumentHash, /^fnv1a32:/)
assert.equal(schemaCorrectionToolResult.argumentSummary, '{"value":"bad"}')
assert.equal(schemaCorrectionToolResult.retryable, true)
const schemaFailureMessage = byId(ai.agents(), schemaCorrectionAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.some(function (call) { return call.id === 'call_schema_bad' })
})
assert.deepEqual(schemaFailureMessage.toolCalls[0].args, { value: 'bad' })
assert.equal(ai.trace.list(schemaCorrectionRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_correction_requested' }).length, 1)

let nestedUnionRequests = 0
let nestedUnionExecutions = 0
let nestedUnionToolResult = null
ai.tools.register('nested-union-correction-tool', {
  schema: {
    type: 'object',
    required: ['actions'],
    properties: {
      actions: {
        type: 'array',
        items: {
          oneOf: [{
            type: 'object',
            required: ['action', 'clipKey', 'payload'],
            properties: {
              mode: { enum: ['replace'] },
              action: { const: 'edit_keys' },
              clipKey: { type: 'string' },
              payload: {
                oneOf: [{
                  type: 'object',
                  required: ['type', 'value'],
                  properties: { type: { const: 'scalar' }, value: { type: 'number' } },
                }, {
                  type: 'object',
                  required: ['type', 'values'],
                  properties: { type: { const: 'vector' }, values: { type: 'array', minItems: 2 } },
                }],
              },
            },
          }, {
            type: 'object',
            required: ['action', 'name'],
            properties: { action: { const: 'create_clip' }, name: { type: 'string' } },
          }],
        },
      },
    },
  },
  run: function () { nestedUnionExecutions += 1; return { ok: true } },
})
ai.registerTransport('nested-union-correction-flow', {
  toolProtocol: 'native',
  toolArguments: 'json',
  send: function (connection, request) {
    nestedUnionRequests += 1
    if (nestedUnionRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'call_nested_union_bad',
          toolId: 'nested-union-correction-tool',
          args: { actions: [{ mode: 'replace', payload: { type: 'scalar', value: 1 }, action: 'edit_keys' }] },
        }],
      }
    }
    if (nestedUnionRequests === 2) {
      assert.equal(nestedUnionExecutions, 0)
      const toolResult = request.messages.find(function (message) {
        return message.role === 'tool' && message.meta && message.meta.toolCallId === 'call_nested_union_bad'
      })
      nestedUnionToolResult = JSON.parse(toolResult.content)
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'call_nested_union_good',
          toolId: 'nested-union-correction-tool',
          args: { actions: [{ mode: 'replace', action: 'edit_keys', clipKey: 'walk', payload: { type: 'scalar', value: 1 } }] },
        }],
      }
    }
    return { role: 'assistant', content: 'nested union correction complete' }
  },
})
ai.registerConnection('nested-union-correction-flow', { auth: { type: 'none' }, transport: { type: 'nested-union-correction-flow' }, configDefaults: {} })
const nestedUnionAgent = ai.createAgent({
  name: 'Nested Union Correction',
  connection: 'nested-union-correction-flow',
  permissionMode: 'full',
  toolRefs: ['nested-union-correction-tool'],
})
const nestedUnionReply = await ai.message.send(nestedUnionAgent.id, { content: 'correct nested union arguments' }, 'user').promise
assert.equal(nestedUnionReply.content, 'nested union correction complete')
assert.equal(nestedUnionRequests, 3)
assert.equal(nestedUnionExecutions, 1)
assert.equal(nestedUnionToolResult.path, '$.actions[0].clipKey')
assert.equal(nestedUnionToolResult.keyword, 'required')

let samePathCorrectionRequests = 0
let samePathCorrectionExecutions = 0
ai.tools.register('same-path-correction-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function () { samePathCorrectionExecutions += 1; return { ok: true } },
})
ai.registerTransport('same-path-correction-flow', {
  toolProtocol: 'native',
  toolArguments: 'json',
  send: function () {
    samePathCorrectionRequests += 1
    if (samePathCorrectionRequests <= 3) {
      const args = samePathCorrectionRequests === 1
        ? { value: 'first' }
        : (samePathCorrectionRequests === 2 ? { value: 'second' } : { value: 9 })
      return { role: 'assistant', content: '', toolCalls: [{ id: 'call_same_path_' + samePathCorrectionRequests, toolId: 'same-path-correction-tool', args: args }] }
    }
    return { role: 'assistant', content: 'same-path correction complete' }
  },
})
ai.registerConnection('same-path-correction-flow', { auth: { type: 'none' }, transport: { type: 'same-path-correction-flow' }, configDefaults: {} })
const samePathCorrectionAgent = ai.createAgent({
  name: 'Same Path Correction',
  connection: 'same-path-correction-flow',
  permissionMode: 'full',
  toolRefs: ['same-path-correction-tool'],
})
const samePathCorrectionReply = await ai.message.send(samePathCorrectionAgent.id, { content: 'correct two distinct values' }, 'user').promise
assert.equal(samePathCorrectionReply.content, 'same-path correction complete')
assert.equal(samePathCorrectionRequests, 4)
assert.equal(samePathCorrectionExecutions, 1)

let repeatedCorrectionRequests = 0
let repeatedCorrectionExecutions = 0
ai.tools.register('repeated-correction-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function () { repeatedCorrectionExecutions += 1; return { ok: true } },
})
ai.registerTransport('repeated-correction-flow', {
  toolProtocol: 'native',
  toolArguments: 'json',
  send: function () {
    repeatedCorrectionRequests += 1
    return { role: 'assistant', content: '', toolCalls: [{ id: 'call_repeated_' + repeatedCorrectionRequests, toolId: 'repeated-correction-tool', args: { value: 'same' } }] }
  },
})
ai.registerConnection('repeated-correction-flow', { auth: { type: 'none' }, transport: { type: 'repeated-correction-flow' }, configDefaults: {} })
const repeatedCorrectionAgent = ai.createAgent({
  name: 'Repeated Correction',
  connection: 'repeated-correction-flow',
  permissionMode: 'full',
  toolRefs: ['repeated-correction-tool'],
})
await ai.message.send(repeatedCorrectionAgent.id, { content: 'repeat the same invalid arguments' }, 'user').promise
assert.equal(repeatedCorrectionRequests, 2)
assert.equal(repeatedCorrectionExecutions, 0)
const repeatedCorrectionError = byId(ai.agents(), repeatedCorrectionAgent.id).messages.find(function (message) {
  return message.role === 'assistant' && message.status === 'error'
})
assert.equal(repeatedCorrectionError.meta.toolArguments.correctionReason, 'repeated')

let correctionBudgetRequests = 0
let correctionBudgetExecutions = 0
ai.tools.register('correction-budget-tool', {
  schema: {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: { value: { type: 'number' } },
  },
  run: function () { correctionBudgetExecutions += 1; return { ok: true } },
})
ai.registerTransport('correction-budget-flow', {
  toolProtocol: 'native',
  toolArguments: 'json',
  send: function () {
    correctionBudgetRequests += 1
    const args = correctionBudgetRequests === 1
      ? { value: 'bad' }
      : (correctionBudgetRequests === 2 ? {} : { value: 1, extra: true })
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_budget_' + correctionBudgetRequests, toolId: 'correction-budget-tool', args: args }],
    }
  },
})
ai.registerConnection('correction-budget-flow', { auth: { type: 'none' }, transport: { type: 'correction-budget-flow' }, configDefaults: {} })
const correctionBudgetAgent = ai.createAgent({
  name: 'Correction Budget',
  connection: 'correction-budget-flow',
  permissionMode: 'full',
  toolRefs: ['correction-budget-tool'],
})
const correctionBudgetRun = ai.message.send(correctionBudgetAgent.id, { content: 'exhaust correction budget' }, 'user')
await correctionBudgetRun.promise
assert.equal(correctionBudgetRequests, 3)
assert.equal(correctionBudgetExecutions, 0)
const correctionBudgetError = byId(ai.agents(), correctionBudgetAgent.id).messages.find(function (message) {
  return message.role === 'assistant' && message.status === 'error'
})
assert.equal(correctionBudgetError.meta.toolArguments.retryable, false)
assert.equal(correctionBudgetError.meta.toolArguments.recoveryAttempted, false)
assert.equal(ai.trace.list(correctionBudgetRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_correction_requested' }).length, 2)

let bestEffortRequests = 0
let bestEffortExecutions = 0
let bestEffortReports = 0
ai.tools.register('best-effort-json-tool', {
  schema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'number' } } },
  run: function () { bestEffortExecutions += 1; return { ok: true } },
})
ai.registerTransport('best-effort-tool-arguments', {
  toolProtocol: 'native',
  toolArguments: 'json',
  send: function () {
    bestEffortRequests += 1
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_best_effort', type: 'function', function: { name: 'best-effort-json-tool', arguments: '{"value":' } }],
    }
  },
})
ai.registerConnection('best-effort-tool-arguments', { auth: { type: 'none' }, transport: { type: 'best-effort-tool-arguments' }, configDefaults: {} })
const bestEffortAgent = ai.createAgent({
  name: 'Best Effort Tool Arguments',
  connection: 'best-effort-tool-arguments',
  permissionMode: 'full',
  toolRefs: ['best-effort-json-tool'],
})
window.aiditor.reportError = function () { bestEffortReports += 1 }
const bestEffortRun = ai.message.send(bestEffortAgent.id, { content: 'do not weakly retry malformed arguments' }, 'user')
await bestEffortRun.promise
window.aiditor.reportError = originalReportError
assert.equal(bestEffortRequests, 2)
assert.equal(bestEffortExecutions, 0)
assert.equal(bestEffortReports, 1)
const bestEffortMessage = byId(ai.agents(), bestEffortAgent.id).messages.find(function (message) {
  return message.role === 'assistant' && message.status === 'error'
})
assert.equal(bestEffortMessage.meta.toolArguments.argumentMode, 'json')
assert.equal(bestEffortMessage.meta.toolArguments.recoveryAttempted, false)
assert.equal(bestEffortMessage.meta.toolArguments.retryable, false)
assert.equal(ai.trace.list(bestEffortRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_recovery_started' }).length, 0)
assert.equal(ai.trace.list(bestEffortRun.request.runId).filter(function (event) { return event.type === 'tool_arguments_correction_requested' }).length, 1)

ai.tools.register('stream-hidden-tool', {
  exposeToModel: false,
  run: function () { hiddenToolExecuted += 1; throw new Error('hidden tool must not run') },
})
let hiddenToolRequests = 0
let hiddenToolExecuted = 0
ai.registerTransport('stream-hidden-tool-flow', {
  toolProtocol: 'native',
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
  toolProtocol: 'native',
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
await ai.message.send(streamApproval.id, { content: 'needs approval' }, 'user').promise
assert.equal(byId(ai.agents(), streamApproval.id).status, 'waiting_approval')
assert.equal(ai.peekActiveRunState(streamApproval.id).state, 'waiting_approval')
assert.equal(ai.peekActiveRunState(streamApproval.id).previewTail, 'Need approval before editing. ')
assert.equal(ai.peekActiveRunState(streamApproval.id).modelTail, 'Need approval before editing. stream-approval-edit{"before":1,"after":2}')
assert.equal(ai.peekActiveRunState(streamApproval.id).activityText, 'previewing stream-approval-edit · {"before":1,"after":2}')
assert.equal(ai.stopAgent(streamApproval.id), true)

ai.registerTransport('stream-reasoning-flow', {
  toolProtocol: 'native',
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
  toolProtocol: 'native',
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

let textProtocolRequests = 0
let textProtocolCalls = 0
ai.tools.register('stream-text-tool', {
  run: function () { textProtocolCalls += 1; return { ok: true } },
})
ai.registerTransport('stream-text-protocol', {
  toolProtocol: 'text',
  send: function () {
    textProtocolRequests += 1
    if (textProtocolRequests === 1) {
      return {
        deltas: (async function* () {
          yield { text: '```json\n' }
          yield { text: '{"aiditor_tool_calls":[{"toolId":"stream-text-tool","args":{}}]}\n```' }
        })(),
      }
    }
    return { role: 'assistant', content: 'text protocol complete' }
  },
})
ai.registerConnection('stream-text-protocol', { auth: { type: 'none' }, transport: { type: 'stream-text-protocol' }, configDefaults: {} })
const textProtocolAgent = ai.createAgent({
  name: 'Text Protocol',
  connection: 'stream-text-protocol',
  toolRefs: ['stream-text-tool'],
})
await ai.message.send(textProtocolAgent.id, { content: 'use text protocol tool' }, 'user').promise
assert.equal(textProtocolCalls, 1)
assert.equal(textProtocolRequests, 2)
assert.equal(byId(ai.agents(), textProtocolAgent.id).messages.at(-1).content, 'text protocol complete')

const restoredStreamingAgent = ai.createAgent({ name: 'Restored Streaming', connection: 'stream-capture' })
const restoredStreamingId = restoredStreamingAgent.id
ai.restore(ai.snapshot())
assert.equal(Object.prototype.hasOwnProperty.call(ai.findAgent(restoredStreamingId), 'stream'), false)
const restoredStreamingRun = ai.message.send(restoredStreamingId, { content: 'stream after restore' }, 'user')
assert.equal(restoredStreamingRun.request.stream, true)
await restoredStreamingRun.promise

console.log('ai stream tests ok')

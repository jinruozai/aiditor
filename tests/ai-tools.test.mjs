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
  'src/ai/request.js',
  'src/ai/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai

ai.tools.register('dupe.tool', { run: function () { return 'one' } })
assert.throws(function () {
  ai.tools.register('dupe.tool', { run: function () { return 'hidden overwrite' } })
}, /duplicate name "dupe.tool"/)
ai.tools.register('dupe.tool', { run: function () { return 'two' } }, { replace: true })
assert.equal(ai.tools.get('dupe.tool').run(), 'two')
ai.tools.unregister('dupe.tool')

ai.context.register('dupe.context', { capture: function () { return 'one' } })
assert.throws(function () {
  ai.context.register('dupe.context', { capture: function () { return 'hidden overwrite' } })
}, /duplicate name "dupe.context"/)
ai.context.register('dupe.context', { capture: function () { return 'two' } }, { replace: true })
assert.equal(ai.context.get('dupe.context').capture(), 'two')
ai.context.unregister('dupe.context')

ai.skills.register('dupe.skill', { title: 'One' })
assert.throws(function () {
  ai.skills.register('dupe.skill', { title: 'Hidden overwrite' })
}, /duplicate name "dupe.skill"/)
ai.skills.register('dupe.skill', { title: 'Two' }, { replace: true })
assert.equal(ai.skills.get('dupe.skill').title, 'Two')
ai.skills.unregister('dupe.skill')

ai.agentTemplates.register('dupe.agent', { title: 'One' })
assert.throws(function () {
  ai.agentTemplates.register('dupe.agent', { title: 'Hidden overwrite' })
}, /duplicate name "dupe.agent"/)
ai.agentTemplates.register('dupe.agent', { title: 'Two' }, { replace: true })
assert.equal(ai.agentTemplates.get('dupe.agent').title, 'Two')
ai.agentTemplates.unregister('dupe.agent')

ai.bundles.register('dupe.bundle', {})
assert.throws(function () {
  ai.bundles.register('dupe.bundle', {})
}, /duplicate name "dupe.bundle"/)
ai.bundles.register('dupe.bundle', {}, { replace: true })
assert.equal(ai.bundles.get('dupe.bundle') != null, true)
ai.bundles.unregister('dupe.bundle')

function latestCall(agentId) {
  const agent = ai.findAgent(agentId)
  const message = agent.messages[agent.messages.length - 1]
  return message.toolCalls[message.toolCalls.length - 1]
}

const agent = ai.createAgent({
  name: 'Tool Runner',
  path: 'tools/root',
  connection: 'mock',
  toolRefs: ['edit-record'],
})

let previewCtx = null
let runCtx = null
let applyCtx = null
ai.tools.register('edit-record', {
  title: 'Edit Record',
  description: 'Preview, run, and apply a record edit.',
  schema: { type: 'object', required: ['id'] },
  permissions: ['tool.call', 'tool.apply'],
  preview: function (args, ctx) {
    previewCtx = ctx
    return { kind: 'diff', before: args.before, after: args.after }
  },
  run: function (args, ctx) {
    runCtx = ctx
    return { ok: true, id: args.id, after: args.after }
  },
  apply: function (result, ctx) {
    applyCtx = ctx
    return { applied: true, id: result.id, after: result.after }
  },
})

const defaultToolAgent = ai.createAgent({
  name: 'Default Tool Agent',
  path: 'tools/default',
  connection: 'mock',
})
const defaultToolRequest = ai.makeRequest(defaultToolAgent, null, 'run_default_tools', 'user', 0)
assert.deepEqual(defaultToolRequest.tools, ['edit-record'])
assert.equal(defaultToolRequest.toolSpecs.length, 1)
assert.equal(defaultToolRequest.toolSpecs[0].id, 'edit-record')
assert.equal(defaultToolRequest.toolSpecs[0].capabilities.apply, true)
assert.equal(defaultToolRequest.toolSpecs[0].capabilities.risk, 'write')

ai.tools.register('hidden-by-default', {
  exposeToModel: false,
  run: function () { return true },
})
ai.tools.register('currently-unavailable', {
  available: function () { return false },
  run: function () { return true },
})
let availableCtx = null
ai.tools.register('ctx-visible', {
  available: function (ctx) {
    availableCtx = ctx
    return typeof ctx.canRead === 'function' && ctx.canRead(defaultToolAgent.id, 'agent.full')
  },
  run: function () { return true },
})
const filteredToolRequest = ai.makeRequest(ai.createAgent({
  name: 'Filtered Tool Agent',
  path: 'tools/filtered',
  connection: 'mock',
}), null, 'run_filtered_tools', 'user', 0)
assert.equal(filteredToolRequest.tools.includes('hidden-by-default'), false)
assert.equal(filteredToolRequest.tools.includes('currently-unavailable'), false)
assert.equal(filteredToolRequest.tools.includes('ctx-visible'), true)
assert.equal(availableCtx.actor, 'user')
const explicitToolRequest = ai.makeRequest(ai.createAgent({
  name: 'Explicit Tool Agent',
  path: 'tools/explicit',
  connection: 'mock',
  toolRefs: ['hidden-by-default', 'currently-unavailable', 'edit-record'],
}), null, 'run_explicit_tools', 'user', 0)
assert.deepEqual(explicitToolRequest.tools, ['hidden-by-default', 'edit-record'])

const proposed = ai.createToolCall(agent.id, {
  toolId: 'edit-record',
  args: { id: 'sword', before: 10, after: 12 },
}, 'user')
assert.equal(proposed.status, 'proposed')
assert.equal(proposed.actor, 'user')
assert.equal(proposed.toolId, 'edit-record')
assert.equal(ai.findAgent(agent.id).messages.length, 1)
assert.equal(ai.getToolCallActionState(agent.id, proposed.id, 'user').capabilities.apply, true)

const previewed = ai.previewToolCall(agent.id, proposed.id, 'user')
assert.equal(previewed.status, 'previewed')
assert.deepEqual(previewed.preview, { kind: 'diff', before: 10, after: 12 })
assert.equal(previewCtx.canRead('agent.full'), true)
assert.equal(previewCtx.canApply(), true)

const approved = ai.approveToolCall(agent.id, proposed.id, 'user')
assert.equal(approved.status, 'approved')

const running = ai.runToolCall(agent.id, proposed.id, 'user')
assert.equal(running.toolCall.status, 'running')
const completed = await running.promise
assert.equal(completed.status, 'completed')
assert.deepEqual(completed.result, { ok: true, id: 'sword', after: 12 })
assert.equal(runCtx.toolCall.id, proposed.id)

const applied = ai.applyToolCall(agent.id, proposed.id, 'user')
assert.equal(applied.status, 'applied')
assert.deepEqual(applied.applyResult, { applied: true, id: 'sword', after: 12 })
assert.equal(applyCtx.toolCall.id, proposed.id)

ai.tools.register('semantic-fail', {
  run: function () { return { patch: { type: 'gde.patch' } } },
  apply: function () {
    return {
      ok: false,
      validation: { errors: [{ path: 'ops[0]', message: 'invalid patch' }] },
    }
  },
})
const semanticFail = ai.createToolCall(agent.id, { toolId: 'semantic-fail' }, 'user')
assert.equal(ai.approveToolCall(agent.id, semanticFail.id, 'user').status, 'approved')
const semanticRun = ai.runToolCall(agent.id, semanticFail.id, 'user')
await semanticRun.promise
const semanticApplied = ai.applyToolCall(agent.id, semanticFail.id, 'user')
assert.equal(semanticApplied.status, 'failed')
assert.match(semanticApplied.error, /invalid patch/)
assert.equal(semanticApplied.errorDetails.ok, false)
assert.equal(semanticApplied.errorDetails.phase, 'apply')

ai.tools.register('invalid-preview', {
  preview: function () {
    return { ok: false, errors: [{ path: 'prop', message: 'unknown property' }] }
  },
  apply: function () {
    return { applied: true }
  },
})
assert.equal(ai.tools.get('edit-record'), ai.tools.get('edit-record'))
ai.tools.register('case.extra', { run: function () { return 'extra' } })
assert.deepEqual(ai.tools.list('case'), ['case.extra'])
assert.deepEqual(ai.tools.unregisterPrefix('case'), ['case.extra'])
assert.equal(ai.tools.get('case.extra'), undefined)
const invalidPreviewCall = ai.createToolCall(agent.id, { toolId: 'invalid-preview' }, 'user')
const invalidPreview = ai.previewToolCall(agent.id, invalidPreviewCall.id, 'user')
assert.equal(invalidPreview.status, 'failed')
assert.match(invalidPreview.error, /unknown property/)
const invalidPreviewState = ai.getToolCallActionState(agent.id, invalidPreviewCall.id, 'user')
assert.equal(invalidPreviewState.canApply, false)
assert.equal(invalidPreviewState.canPreview, false)

ai.tools.register('run-semantic-fail', {
  run: function () {
    return { ok: false, code: 'NO_WORKSPACE', message: 'No workspace is selected', hint: 'Open a workspace first.' }
  },
})
const runSemanticCall = ai.createToolCall(agent.id, { toolId: 'run-semantic-fail' }, 'user')
assert.equal(ai.approveToolCall(agent.id, runSemanticCall.id, 'user').status, 'approved')
const runSemantic = ai.runToolCall(agent.id, runSemanticCall.id, 'user')
const runSemanticFailed = await runSemantic.promise
assert.equal(runSemanticFailed.status, 'failed')
assert.equal(runSemanticFailed.result.ok, false)
assert.equal(runSemanticFailed.errorDetails.code, 'NO_WORKSPACE')
assert.match(runSemanticFailed.errorDetails.hint, /Open a workspace/)

ai.tools.register('async-apply', {
  run: function () { return { id: 'async' } },
  apply: function (result) {
    return Promise.resolve({ applied: true, id: result.id })
  },
})
const asyncCall = ai.createToolCall(agent.id, { toolId: 'async-apply' }, 'user')
assert.equal(ai.approveToolCall(agent.id, asyncCall.id, 'user').status, 'approved')
const asyncRun = ai.runToolCall(agent.id, asyncCall.id, 'user')
await asyncRun.promise
const asyncApply = ai.applyToolCall(agent.id, asyncCall.id, 'user')
assert.equal(asyncApply.toolCall.status, 'applying')
const asyncDone = await asyncApply.promise
assert.equal(asyncDone.status, 'applied')
assert.deepEqual(asyncDone.applyResult, { applied: true, id: 'async' })

ai.tools.register('async-apply-fail', {
  run: function () { return { id: 'async-fail' } },
  apply: function () {
    return Promise.reject(new Error('async apply failed'))
  },
})
const asyncFailCall = ai.createToolCall(agent.id, { toolId: 'async-apply-fail' }, 'user')
assert.equal(ai.approveToolCall(agent.id, asyncFailCall.id, 'user').status, 'approved')
const asyncFailRun = ai.runToolCall(agent.id, asyncFailCall.id, 'user')
await asyncFailRun.promise
const asyncFailApply = ai.applyToolCall(agent.id, asyncFailCall.id, 'user')
const asyncFailed = await asyncFailApply.promise
assert.equal(asyncFailed.status, 'failed')
assert.equal(asyncFailed.error, 'async apply failed')

ai.registerTransport('generated-tool-calls', {
  send: function () {
    return {
      role: 'assistant',
      content: '',
      toolCalls: [
        { toolId: 'edit-record', args: { id: 'first' } },
        { toolId: 'edit-record', args: { id: 'second' } },
      ],
    }
  },
})
ai.registerConnection('generated-tool-calls', { auth: { type: 'none' }, transport: { type: 'generated-tool-calls' }, configDefaults: {} })
const generatedCallAgent = ai.createAgent({
  name: 'Generated Calls',
  path: 'tools/generated',
  connection: 'generated-tool-calls',
})
const normalizedRun = ai.message.send(generatedCallAgent.id, 'make calls', 'user')
await normalizedRun.promise
const generatedMessage = ai.findAgent(generatedCallAgent.id).messages.find(function (message) {
  return message.role === 'assistant'
})
assert.notEqual(generatedMessage.toolCalls[0].id, generatedMessage.toolCalls[1].id)

const decodedTextTool = ai.decodeTextToolResponse('Before\n```json\n{"aiditor_tool_calls":[{"toolId":"read-number","args":{"id":"answer"}}]}\n```\nAfter')
assert.equal(decodedTextTool.content, 'Before\n\nAfter')
assert.equal(decodedTextTool.toolCalls.length, 1)
assert.equal(decodedTextTool.toolCalls[0].toolId, 'read-number')

const rejected = ai.createToolCall(agent.id, {
  toolId: 'edit-record',
  args: { id: 'shield', before: 4, after: 5 },
}, 'user')
assert.equal(ai.rejectToolCall(agent.id, rejected.id, 'not needed').status, 'rejected')
assert.equal(latestCall(agent.id).error, 'not needed')

ai.tools.register('explode', {
  run: function () { throw new Error('boom') },
})
const failing = ai.createToolCall(agent.id, { toolId: 'explode' }, 'user')
assert.equal(ai.approveToolCall(agent.id, failing.id, 'user').status, 'approved')
const failedRun = ai.runToolCall(agent.id, failing.id, 'user')
const failed = await failedRun.promise
assert.equal(failed.status, 'failed')
assert.equal(failed.error, 'boom')
assert.equal(failed.result.ok, false)
assert.equal(failed.result.code, 'TOOL_FAILED')
assert.equal(failed.errorDetails.message, 'boom')
const failedState = ai.getToolCallActionState(agent.id, failing.id, 'user')
assert.equal(failedState.canPreview, false)
assert.equal(failedState.canApply, false)
assert.equal(failedState.canApprove, false)
assert.equal(failedState.canRun, false)

const calls = []
ai.setPermissionResolver(function (ctx, next) {
  calls.push({ actor: ctx.actor, scope: ctx.scope, toolId: ctx.toolId, phase: ctx.phase, runId: ctx.runId, risk: ctx.risk })
  if (ctx.actor === 'blocked') return false
  if (ctx.scope === 'tool.apply') return false
  return next(ctx)
})

assert.equal(ai.canUseTool('user', agent.id, 'edit-record', 'call'), true)
assert.equal(ai.canUseTool('user', agent.id, 'edit-record', 'apply'), false)
const permissionCall = ai.createToolCall(agent.id, { toolId: 'edit-record' }, 'user')
ai.updateMessage(agent.id, permissionCall.messageId, { meta: { runId: 'run_permission_test' } })
assert.equal(ai.getToolCallActionState(agent.id, permissionCall.id, 'user').canApply, false)
assert.equal(ai.permissionAuditRecords().some(function (item) {
  return item.scope === 'tool.apply' && item.entry === 'edit-record' && item.decision === 'deny' && item.runId === 'run_permission_test' && item.risk === 'write'
}), true)
assert.equal(ai.createToolCall(agent.id, { toolId: 'edit-record' }, 'blocked'), null)
assert.equal(ai.applyToolCall(agent.id, permissionCall.id, 'user'), null)
assert.deepEqual(calls.some(function (call) {
  return call.scope === 'tool.apply' && call.toolId === 'edit-record' && call.phase === 'apply' && call.runId === 'run_permission_test' && call.risk === 'write'
}), true)
ai.setPermissionResolver(null)

let loopRequests = []
ai.tools.register('read-number', {
  title: 'Read Number',
  schema: { id: 'string' },
  run: function (args) {
    return { id: args.id, value: 42 }
  },
})
ai.registerTransport('tool-loop', {
  send: function (connection, request) {
    loopRequests.push(request)
    if (loopRequests.length === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', toolId: 'read-number', args: { id: 'answer' } }],
      }
    }
    const last = request.messages[request.messages.length - 1]
    assert.equal(last.role, 'tool')
    assert.equal(last.toolCallId || (last.meta && last.meta.toolCallId), 'call_1')
    return { role: 'assistant', content: 'Tool says ' + JSON.parse(last.content).value }
  },
})
ai.registerConnection('tool-loop', { auth: { type: 'none' }, transport: { type: 'tool-loop' }, configDefaults: {} })
const loopAgent = ai.createAgent({
  name: 'Loop Agent',
  connection: 'tool-loop',
  toolRefs: ['read-number'],
})
const loopRun = ai.message.send(loopAgent.id, 'start', 'user')
const loopReply = await loopRun.promise
assert.equal(loopReply.content, 'Tool says 42')
assert.equal(loopRequests.length, 2)
assert.equal(ai.findAgent(loopAgent.id).messages.some(function (message) { return message.role === 'tool' }), true)

let autoSkillCalls = 0
ai.skills.register('auto.once', {
  title: 'Auto Once',
  rules: ['Auto once rule'],
  auto: function (ctx) {
    autoSkillCalls += 1
    return ctx.agent && ctx.agent.id === loopAgent.id
  },
})
const autoSkillRequest = ai.makeRequest(loopAgent, null, 'run_auto_skill', 'user', 0)
assert.deepEqual(autoSkillRequest.skills.filter(function (id) { return id === 'auto.once' }), ['auto.once'])
assert.equal(autoSkillRequest.skillSpecs.some(function (skill) { return skill.id === 'auto.once' }), true)
assert.match(autoSkillRequest.messages[0].content, /Auto once rule/)
assert.equal(autoSkillCalls, 1)
ai.skills.unregister('auto.once')

ai.bundles.register('bundle.case', {
  connections: [{ id: 'bundle.connection', auth: { type: 'none' }, transport: { type: 'mock' }, configDefaults: {} }],
  skills: [{ id: 'bundle.skill', title: 'Bundle Skill' }],
  tools: [{ id: 'bundle.tool', run: function () { return true } }],
  contextProviders: [{ id: 'bundle.context', capture: function () { return 'ctx' } }],
  agentTemplates: [{ id: 'bundle.agent', title: 'Bundle Agent' }],
})
assert.equal(ai.getConnection('bundle.connection').id, 'bundle.connection')
assert.equal(ai.skills.get('bundle.skill').title, 'Bundle Skill')
assert.equal(ai.tools.get('bundle.tool').run(), true)
assert.equal(ai.context.get('bundle.context').capture(), 'ctx')
assert.equal(ai.agentTemplates.get('bundle.agent').title, 'Bundle Agent')
assert.equal(ai.bundles.unregister('bundle.case'), true)
assert.equal(ai.getConnection('bundle.connection'), undefined)
assert.equal(ai.skills.get('bundle.skill'), undefined)
assert.equal(ai.tools.get('bundle.tool'), undefined)
assert.equal(ai.context.get('bundle.context'), undefined)
assert.equal(ai.agentTemplates.get('bundle.agent'), undefined)

console.log('ai tools tests ok')

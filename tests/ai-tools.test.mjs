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
  'src/ai/schema.js',
  'src/ai/trace.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/skill/runtime.js',
  'src/ai/tool/scheduler.js',
  'src/ai/tool/runtime.js',
  'src/ai/reference.js',
  'src/ai/rich-prompt.js',
  'src/ai/request.js',
  'src/ai/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai
const TEST_META = { owner: 'test:tools' }
function registerTool(name, spec, meta) { return ai.tools.register(name, spec, meta || TEST_META) }
function registerSkill(name, spec, meta) { return ai.skills.register(name, spec, meta || TEST_META) }
function registerContext(name, spec, meta) { return ai.context.register(name, spec, meta || TEST_META) }

assert.throws(function () { ai.tools.register('owner.missing', {}) }, /owner is required/)
assert.throws(function () {
  registerTool('invalid.permission-hint', { permissionDeniedHint: function () {}, run: function () {} })
}, /permissionDeniedHint must be a string/)
assert.throws(function () { ai.skills.register('owner.missing', {}) }, /owner is required/)
assert.throws(function () { ai.context.register('owner.missing', {}) }, /owner is required/)

registerTool('dupe.tool', { run: function () { return 'one' } })
assert.throws(function () {
  registerTool('dupe.tool', { run: function () { return 'hidden overwrite' } })
}, /duplicate name "dupe.tool"/)
assert.throws(function () {
  registerTool('dupe.tool', { run: function () { return 'foreign' } }, { owner: 'test:foreign', replace: true })
}, /owner mismatch/)
registerTool('dupe.tool', { run: function () { return 'two' } }, { owner: 'test:tools', replace: true })
assert.equal(ai.tools.get('dupe.tool').run(), 'two')
ai.tools.unregister('dupe.tool', TEST_META)

registerContext('dupe.context', { capture: function () { return 'one' } })
assert.throws(function () {
  registerContext('dupe.context', { capture: function () { return 'hidden overwrite' } })
}, /duplicate name "dupe.context"/)
registerContext('dupe.context', { capture: function () { return 'two' } }, { owner: 'test:tools', replace: true })
assert.equal(ai.context.get('dupe.context').capture(), 'two')
ai.context.unregister('dupe.context', TEST_META)

registerSkill('dupe.skill', { title: 'One' })
assert.throws(function () {
  registerSkill('dupe.skill', { title: 'Hidden overwrite' })
}, /duplicate name "dupe.skill"/)
registerSkill('dupe.skill', { title: 'Two' }, { owner: 'test:tools', replace: true })
assert.equal(ai.skills.get('dupe.skill').title, 'Two')
ai.skills.unregister('dupe.skill', TEST_META)

function latestCall(agentId) {
  const agent = ai.findAgent(agentId)
  const message = agent.messages[agent.messages.length - 1]
  return message.toolCalls[message.toolCalls.length - 1]
}

ai.registerTransport('tool-test', {
  toolProtocol: 'native',
  send: function () { return { role: 'assistant', content: 'done' } },
})
ai.registerConnection('tool-test', { auth: { type: 'none' }, transport: { type: 'tool-test' }, configDefaults: {} })

const agent = ai.createAgent({
  name: 'Tool Runner',
  path: 'tools/root',
  connection: 'tool-test',
})
registerContext('mors.editor.summary', {
  capture: function () {
    return {
      kind: 'mors.editor',
      summary: 'Current MORS editor state.',
      activeScene: 'project://scene.morscn',
      activeSceneRevision: 3,
      sceneRoot: { uri: 'mors://meta?document=project%3A%2F%2Fscene.morscn&local=root', local: 'root' },
      selection: [],
    }
  },
})
const runtimeContextRequest = ai.planRequest(agent, null, 'runtime_context_values', 'user', 0)
const runtimeContextMessage = runtimeContextRequest.messages.find(function (message) {
  return message.role === 'system' && String(message.content || '').indexOf('Current editor runtime context') >= 0
})
assert.match(runtimeContextMessage.content, /project:\/\/scene\.morscn/)
assert.match(runtimeContextMessage.content, /activeSceneRevision\":3/)
assert.match(runtimeContextMessage.content, /local\":\"root/)
assert.doesNotMatch(runtimeContextMessage.content, /navigation summary/)
ai.context.unregister('mors.editor.summary', TEST_META)

let previewCtx = null
let runCtx = null
let applyCtx = null
registerTool('edit-record', {
  title: 'Edit Record',
  description: 'Preview, run, and apply a record edit.',
  schema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string' },
      before: {},
      after: {},
    },
  },
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
  connection: 'tool-test',
})
const defaultToolRequest = ai.planRequest(defaultToolAgent, null, 'run_default_tools', 'user', 0)
assert.deepEqual(defaultToolRequest.tools, ['skill.list', 'skill.activate'])
assert.equal(defaultToolRequest.toolSpecs.length, 2)

registerTool('hidden-by-default', {
  exposeToModel: false,
  run: function () { return true },
})
registerTool('currently-unavailable', {
  available: function () { return false },
  run: function () { return true },
})
let availableCtx = null
registerTool('ctx-visible', {
  available: function (ctx) {
    availableCtx = ctx
    return typeof ctx.canRead === 'function' && ctx.canRead(defaultToolAgent.id, 'agent.full')
  },
  run: function () { return true },
})
registerSkill('filtered-tools', {
  title: 'Filtered Tools',
  systemPrompt: 'Use only the filtered tool surface.',
  tools: ['hidden-by-default', 'currently-unavailable', 'ctx-visible'],
}, { owner: 'test:filtered', layer: 'app', source: 'test-suite' })
const filteredToolRequest = ai.planRequest(ai.createAgent({
  name: 'Filtered Tool Agent',
  path: 'tools/filtered',
  connection: 'tool-test',
  skillRefs: ['filtered-tools'],
}), null, 'run_filtered_tools', 'user', 0)
assert.equal(filteredToolRequest.tools.includes('hidden-by-default'), true)
assert.equal(filteredToolRequest.tools.includes('currently-unavailable'), false)
assert.equal(filteredToolRequest.tools.includes('ctx-visible'), true)
assert.equal(filteredToolRequest.skillActivations.length, 1)
assert.equal(filteredToolRequest.skillActivations[0].reason, 'configured')
assert.equal(filteredToolRequest.skillActivations[0].owner, 'test:filtered')
assert.equal(filteredToolRequest.skillActivations[0].source, 'test-suite')
assert.equal(filteredToolRequest.skillActivations[0].promptChars > 0, true)
assert.deepEqual(filteredToolRequest.skillActivations[0].tools, ['hidden-by-default', 'currently-unavailable', 'ctx-visible'])
const filteredActivationTrace = ai.trace.list('run_filtered_tools').find(function (event) { return event.type === 'skill_activated' })
assert.equal(filteredActivationTrace.entry, 'filtered-tools')
assert.equal(filteredActivationTrace.meta.reason, 'configured')
assert.equal(filteredActivationTrace.meta.owner, 'test:filtered')
assert.equal(ai.trace.list('run_filtered_tools').find(function (event) { return event.type === 'request_built' }).meta.skillPromptChars > 0, true)
ai.skills.configureDefaults(['filtered-tools'], { owner: 'test:host-default' })
const hostDefaultRequest = ai.planRequest(ai.createAgent({
  name: 'Host Default Skill Agent',
  connection: 'tool-test',
}), null, 'run_host_default_skill', 'user', 0)
assert.equal(hostDefaultRequest.skillActivations[0].id, 'filtered-tools')
assert.equal(hostDefaultRequest.skillActivations[0].reason, 'host')
assert.equal(hostDefaultRequest.tools.includes('ctx-visible'), true)
assert.equal(ai.skills.clearDefaults({ owner: 'test:host-default' }), true)
assert.equal(availableCtx.actor, 'user')
let explicitSkillDraft = ai.richPrompt.insertSkill(ai.richPrompt.empty(), 0, {
  id: 'filtered-tools',
  title: 'Filtered Tools',
})
explicitSkillDraft = ai.richPrompt.insertText(explicitSkillDraft, explicitSkillDraft.text.length, ' inspect this')
const explicitSkillRequest = ai.planRequest(ai.createAgent({
  name: 'Explicit Skill Agent',
  connection: 'tool-test',
}), {
  id: 'explicit-skill-message',
  role: 'user',
  content: ai.richPrompt.content(explicitSkillDraft),
}, 'run_explicit_skill', 'user', 0)
assert.equal(explicitSkillRequest.skillActivations[0].id, 'filtered-tools')
assert.equal(explicitSkillRequest.skillActivations[0].reason, 'explicit')
assert.deepEqual(explicitSkillRequest.tools, ['skill.list', 'skill.activate', 'hidden-by-default', 'ctx-visible'])
registerContext('tool-surface', {
  capture: function () { return { title: 'Current surface', tools: ['ctx-visible'] } },
})
const contextToolRequest = ai.planRequest(ai.createAgent({
  name: 'Context Tool Agent',
  connection: 'tool-test',
}), null, 'run_context_tools', 'user', 0)
assert.deepEqual(contextToolRequest.tools, ['skill.list', 'skill.activate'])
ai.context.unregister('tool-surface', TEST_META)
registerSkill('explicit-tools', { title: 'Explicit Tools', tools: ['hidden-by-default', 'currently-unavailable', 'edit-record'] })
const explicitToolRequest = ai.planRequest(ai.createAgent({
  name: 'Explicit Tool Agent',
  path: 'tools/explicit',
  connection: 'tool-test',
  skillRefs: ['explicit-tools'],
}), null, 'run_explicit_tools', 'user', 0)
assert.deepEqual(explicitToolRequest.tools, ['skill.list', 'skill.activate', 'hidden-by-default', 'edit-record'])

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

registerTool('semantic-fail', {
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

registerTool('invalid-preview', {
  preview: function () {
    return { ok: false, errors: [{ path: 'prop', message: 'unknown property' }] }
  },
  apply: function () {
    return { applied: true }
  },
})
assert.equal(ai.tools.get('edit-record'), ai.tools.get('edit-record'))
registerTool('case.extra', { run: function () { return 'extra' } }, { owner: 'test:case' })
assert.deepEqual(ai.tools.list('case'), ['case.extra'])
assert.deepEqual(ai.tools.unregisterOwner('test:case'), ['case.extra'])
assert.equal(ai.tools.get('case.extra'), undefined)
const invalidPreviewCall = ai.createToolCall(agent.id, { toolId: 'invalid-preview' }, 'user')
const invalidPreview = ai.previewToolCall(agent.id, invalidPreviewCall.id, 'user')
assert.equal(invalidPreview.status, 'failed')
assert.match(invalidPreview.error, /unknown property/)
const invalidPreviewState = ai.getToolCallActionState(agent.id, invalidPreviewCall.id, 'user')
assert.equal(invalidPreviewState.canApply, false)
assert.equal(invalidPreviewState.canPreview, false)

registerTool('run-semantic-fail', {
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

registerTool('async-apply', {
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

registerTool('async-apply-fail', {
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
  toolProtocol: 'native',
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

registerTool('explode', {
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
ai.permissions.setResolver(function (ctx, next) {
  calls.push({ actor: ctx.actor, scope: ctx.scope, entry: ctx.entry, phase: ctx.phase, runId: ctx.runId, risk: ctx.risk })
  if (ctx.actor === 'blocked') return false
  if (ctx.scope === 'tool.apply') return false
  return next(ctx)
})

assert.equal(ai.permissions.decide('user', agent.id, 'tool.call', { entry: 'edit-record', phase: 'run', target: 'edit-record', risk: 'read' }).allowed, true)
assert.equal(ai.permissions.decide('user', agent.id, 'tool.apply', { entry: 'edit-record', phase: 'apply', target: 'edit-record', risk: 'write' }).allowed, false)
const permissionCall = ai.createToolCall(agent.id, { toolId: 'edit-record' }, 'user')
ai.updateMessage(agent.id, permissionCall.messageId, { meta: { runId: 'run_permission_test' } })
assert.equal(ai.getToolCallActionState(agent.id, permissionCall.id, 'user').canApply, false)
assert.equal(ai.permissionAuditRecords().some(function (item) {
  return item.scope === 'tool.apply' && item.entry === 'edit-record' && item.decision === 'deny' && item.runId === 'run_permission_test' && item.risk === 'write'
}), true)
const blockedCall = ai.createToolCall(agent.id, { toolId: 'edit-record' }, 'blocked')
assert.equal(ai.getToolCallActionState(agent.id, blockedCall.id, 'blocked').canApprove, false)
assert.equal(ai.applyToolCall(agent.id, permissionCall.id, 'user'), null)
assert.deepEqual(calls.some(function (call) {
  return call.scope === 'tool.apply' && call.entry === 'edit-record' && call.phase === 'apply' && call.runId === 'run_permission_test' && call.risk === 'write'
}), true)
ai.permissions.setResolver(null)

let loopRequests = []
registerTool('read-number', {
  title: 'Read Number',
  schema: { id: 'string' },
  run: function (args) {
    return { id: args.id, value: 42 }
  },
})
registerSkill('loop.explicit', {
  title: 'Explicit Tool Loop',
  rules: ['Keep this skill active for the whole model/tool turn.'],
  tools: ['read-number'],
})
ai.registerTransport('tool-loop', {
  toolProtocol: 'native',
  send: function (connection, request) {
    loopRequests.push(request)
    assert.equal(request.skillActivations.find(function (item) { return item.id === 'loop.explicit' }).reason, loopRequests.length === 1 ? 'explicit' : 'selected')
    assert.equal(request.tools.includes('read-number'), true)
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
})
const loopRun = ai.message.send(loopAgent.id, {
  content: 'start',
  meta: { skillRefs: ['loop.explicit'] },
})
const loopReply = await loopRun.promise
assert.equal(loopReply.content, 'Tool says 42')
assert.equal(loopRequests.length, 2)
assert.equal(ai.findAgent(loopAgent.id).messages.some(function (message) { return message.role === 'tool' }), true)
ai.skills.unregister('loop.explicit', TEST_META)

let skillBoundValue = 0
let skillBoundAvailable = true
ai.operations.register('case.skillBound', {
  title: 'Skill-bound operation',
  exposeToModel: true,
  available: function (ctx) { return skillBoundAvailable && (ctx.skillRefs || []).indexOf('operation.run-context') >= 0 },
  inputSchema: {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: { value: { type: 'number' } },
  },
  preview: function (input) { return { next: input.value } },
  apply: function (preview) {
    skillBoundValue = preview.next
    return { value: skillBoundValue }
  },
}, TEST_META)
registerSkill('operation.run-context', {
  title: 'Run context operation',
  tools: ['aiditor.applyOperation'],
})
const operationRequests = []
ai.registerTransport('operation-run-context', {
  toolProtocol: 'native',
  send: function (connection, request) {
    operationRequests.push(request)
    if (operationRequests.length === 1) {
      assert.equal(request.toolSpecs.some(function (tool) { return tool.id === 'case.skillBound' }), true)
      skillBoundAvailable = false
      return { role: 'assistant', content: '', toolCalls: [{ toolId: 'case.skillBound', args: { value: 17 } }] }
    }
    const result = JSON.parse(request.messages[request.messages.length - 1].content)
    assert.equal(result.value, 17)
    return { role: 'assistant', content: 'operation complete' }
  },
})
ai.registerConnection('operation-run-context', { auth: { type: 'none' }, transport: { type: 'operation-run-context' }, configDefaults: {} })
const operationAgent = ai.createAgent({ name: 'Operation run context', connection: 'operation-run-context', permissionMode: 'full', skillRefs: ['operation.run-context'] })
const operationReply = await ai.message.send(operationAgent.id, 'apply operation', 'user').promise
assert.equal(operationReply.content, 'operation complete')
assert.equal(skillBoundValue, 17)
ai.skills.unregister('operation.run-context', TEST_META)
ai.operations.unregister('case.skillBound', TEST_META)

registerSkill('dynamic.read', {
  title: 'Dynamic Read',
  description: 'Read a number after run-scoped activation.',
  tools: ['read-number'],
})
const dynamicRequests = []
ai.registerTransport('dynamic-skill', {
  toolProtocol: 'native',
  send: function (connection, request) {
    dynamicRequests.push(request)
    if (dynamicRequests.length === 1) {
      assert.deepEqual(request.tools, ['skill.list', 'skill.activate'])
      return { role: 'assistant', content: '', toolCalls: [{ toolId: 'skill.activate', args: { id: 'aiditor://skills/dynamic.read' } }] }
    }
    if (dynamicRequests.length === 2) {
      assert.equal(request.tools.includes('read-number'), true)
      assert.equal(request.skillActivations.find(function (item) { return item.id === 'dynamic.read' }).reason, 'selected')
      return { role: 'assistant', content: '', toolCalls: [{ toolId: 'read-number', args: { id: 'dynamic' } }] }
    }
    return { role: 'assistant', content: 'dynamic complete' }
  },
})
ai.registerConnection('dynamic-skill', { auth: { type: 'none' }, transport: { type: 'dynamic-skill' }, configDefaults: {} })
const dynamicAgent = ai.createAgent({ name: 'Dynamic Skill Agent', connection: 'dynamic-skill', permissionMode: 'full' })
const dynamicRun = ai.message.send(dynamicAgent.id, 'discover and read', 'user')
const dynamicReply = await dynamicRun.promise
assert.equal(dynamicReply.content, 'dynamic complete')
assert.equal(dynamicRequests.length, 3)
ai.skills.unregister('dynamic.read', TEST_META)

registerTool('diagnostic.readNumber', {
  title: 'Diagnostic Read Number',
  schema: { id: 'string' },
  run: function (args) { return { id: args.id, value: 42 } },
})
registerSkill('diagnostic.read', {
  title: 'Diagnostic Read',
  description: 'Read a number after explicit run-scoped activation.',
  tools: ['diagnostic.readNumber'],
})
const diagnosticRequests = []
ai.registerTransport('diagnostic-skill', {
  toolProtocol: 'native',
  send: function (connection, request) {
    diagnosticRequests.push(request)
    const index = diagnosticRequests.length
    if (index === 1) {
      assert.deepEqual(request.tools, ['skill.list', 'skill.activate'])
      const state = ai.tools.get('skill.list').run({}, { runId: request.runId }).skills.find(function (skill) { return skill.id === 'diagnostic.read' })
      assert.equal(state.available, true)
      assert.equal(state.active, false)
      assert.equal(state.configured, false)
      assert.equal(state.lifetime, 'run')
      return { role: 'assistant', content: '', toolCalls: [{ toolId: 'skill.activate', args: { id: 'diagnostic.read' } }] }
    }
    if (index === 2) {
      assert.equal(request.tools.includes('diagnostic.readNumber'), true)
      const state = ai.tools.get('skill.list').run({}, { runId: request.runId }).skills.find(function (skill) { return skill.id === 'diagnostic.read' })
      assert.equal(state.active, true)
      assert.equal(state.configured, false)
      assert.equal(state.lifetime, 'run')
      return { role: 'assistant', content: 'first request complete' }
    }
    if (index === 3) {
      assert.deepEqual(request.tools, ['skill.list', 'skill.activate'])
      return { role: 'assistant', content: '', toolCalls: [{ function: { name: 'diagnostic__readNumber', arguments: '{"id":"stale"}' } }] }
    }
    if (index === 4) {
      const payload = JSON.parse(request.messages[request.messages.length - 1].content)
      assert.equal(payload.code, 'SKILL_ACTIVATION_REQUIRED')
      assert.equal(payload.toolId, 'diagnostic.readNumber')
      assert.equal(payload.providerName, 'diagnostic__readNumber')
      assert.deepEqual(payload.skillIds, ['diagnostic.read'])
      assert.equal(payload.lifetime, 'run')
      assert.match(payload.hint, /Call skill\.activate/)
      assert.match(payload.hint, /earlier request does not carry over/)
      return { role: 'assistant', content: '', toolCalls: [{ toolId: 'skill.activate', args: { id: 'diagnostic.read' } }] }
    }
    if (index === 5) {
      assert.equal(request.tools.includes('diagnostic.readNumber'), true)
      const activation = JSON.parse(request.messages[request.messages.length - 1].content)
      assert.equal(activation.lifetime, 'run')
      return { role: 'assistant', content: '', toolCalls: [{ function: { name: 'diagnostic__readNumber', arguments: '{"id":"recovered"}' } }] }
    }
    if (index === 7) {
      const state = ai.tools.get('skill.list').run({}, { runId: request.runId }).skills.find(function (skill) { return skill.id === 'diagnostic.read' })
      assert.equal(state.active, true)
      assert.equal(state.configured, true)
      assert.equal(state.lifetime, 'agent')
      return { role: 'assistant', content: 'configured request complete' }
    }
    return { role: 'assistant', content: 'second request recovered' }
  },
})
ai.registerConnection('diagnostic-skill', { auth: { type: 'none' }, transport: { type: 'diagnostic-skill' }, configDefaults: {} })
const diagnosticAgent = ai.createAgent({ name: 'Diagnostic Skill Agent', connection: 'diagnostic-skill', permissionMode: 'full' })
assert.equal((await ai.message.send(diagnosticAgent.id, 'activate once', 'user').promise).content, 'first request complete')
assert.equal((await ai.message.send(diagnosticAgent.id, 'use it again', 'user').promise).content, 'second request recovered')
assert.equal(diagnosticRequests.length, 6)
const unavailableCall = ai.findAgent(diagnosticAgent.id).messages.flatMap(function (message) { return message.toolCalls || [] }).find(function (call) {
  return call.toolId === 'diagnostic.readNumber' && call.args && call.args.id === 'stale'
})
assert.equal(unavailableCall.errorDetails.code, 'SKILL_ACTIVATION_REQUIRED')
assert.equal(unavailableCall.providerName, 'diagnostic__readNumber')

const configuredDiagnostic = ai.createAgent({ name: 'Configured Diagnostic Skill', connection: 'diagnostic-skill', skillRefs: ['diagnostic.read'] })
assert.equal(ai.planRequest(configuredDiagnostic, null, 'run_configured_one', 'user', 0).tools.includes('diagnostic.readNumber'), true)
assert.equal(ai.planRequest(configuredDiagnostic, null, 'run_configured_two', 'user', 0).tools.includes('diagnostic.readNumber'), true)
assert.equal((await ai.message.send(configuredDiagnostic.id, 'configured skill', 'user').promise).content, 'configured request complete')
assert.equal(diagnosticRequests.length, 7)
ai.skills.unregister('diagnostic.read', TEST_META)
ai.tools.unregister('diagnostic.readNumber', TEST_META)

registerSkill('manual.once', {
  title: 'Manual Once',
  rules: ['Manual once rule'],
})
const inactiveSkillRequest = ai.planRequest(loopAgent, null, 'run_inactive_skill', 'user', 0)
assert.equal(inactiveSkillRequest.skills.includes('manual.once'), false)
assert.equal(ai.skills.catalog({}, { query: 'manual' })[0].id, 'manual.once')
ai.updateAgent(loopAgent.id, { skillRefs: ['manual.once'] })
const configuredSkillRequest = ai.planRequest(ai.findAgent(loopAgent.id), null, 'run_manual_skill', 'user', 0)
assert.equal(configuredSkillRequest.skillActivations.find(function (item) { return item.id === 'manual.once' }).reason, 'configured')
assert.match(configuredSkillRequest.messages[0].content, /Manual once rule/)
ai.skills.unregister('manual.once', TEST_META)

registerSkill('removed.skill', { title: 'Removed', rules: ['Never exposed'] })
const staleSkillAgent = ai.createAgent({ name: 'Stale Skill Agent', connection: 'tool-test', skillRefs: ['removed.skill'] })
ai.skills.unregister('removed.skill', TEST_META)
const staleSkillRequest = ai.planRequest(staleSkillAgent, null, 'run_stale_skill', 'user', 0)
assert.deepEqual(staleSkillRequest.skills, [])
assert.deepEqual(staleSkillRequest.skillActivations, [])

registerTool('owner.tool', { run: function () { return true } }, { owner: 'test:owner' })
registerSkill('owner.skill', { title: 'Owner Skill' }, { owner: 'test:owner' })
registerContext('owner.context', { capture: function () { return 'ctx' } }, { owner: 'test:owner' })
assert.deepEqual(ai.tools.unregisterOwner('test:owner'), ['owner.tool'])
assert.deepEqual(ai.skills.unregisterOwner('test:owner'), ['owner.skill'])
assert.deepEqual(ai.context.unregisterOwner('test:owner'), ['owner.context'])

console.log('ai tools tests ok')

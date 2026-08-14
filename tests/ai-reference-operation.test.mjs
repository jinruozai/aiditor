import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/log.js', 'utf8'), { filename: 'log.js' })
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/ai/name-generator.js', 'utf8'), { filename: 'ai/name-generator.js' })
vm.runInThisContext(readFileSync('src/ai/serialize.js', 'utf8'), { filename: 'ai/serialize.js' })
vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
vm.runInThisContext(readFileSync('src/ai/store.js', 'utf8'), { filename: 'ai/store.js' })
vm.runInThisContext(readFileSync('src/ai/connection.js', 'utf8'), { filename: 'ai/connection.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
for (const file of ['src/ai/contribution-registry.js', 'src/ai/tool/registry.js', 'src/ai/context/registry.js', 'src/ai/skill/registry.js']) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
vm.runInThisContext(readFileSync('src/ai/tool/scheduler.js', 'utf8'), { filename: 'ai/tool/scheduler.js' })
vm.runInThisContext(readFileSync('src/ai/tool/runtime.js', 'utf8'), { filename: 'ai/tool/runtime.js' })
vm.runInThisContext(readFileSync('src/ai/reference.js', 'utf8'), { filename: 'ai/reference.js' })
vm.runInThisContext(readFileSync('src/ai/request.js', 'utf8'), { filename: 'ai/request.js' })

const ai = window.aiditor.ai
const TEST_META = { owner: 'test:reference-operation' }
let nextSkill = 1
function skillRefs(tools) {
  const id = 'test.operation.' + nextSkill++
  ai.skills.register(id, { title: id, tools: tools }, TEST_META)
  return [id]
}
function registerReference(name, spec, meta) { return ai.references.register(name, spec, meta || TEST_META) }
function registerOperation(name, spec, meta) { return ai.operations.register(name, spec, meta || TEST_META) }
assert.throws(function () { ai.references.register('owner.missing', {}) }, /owner is required/)
assert.throws(function () { ai.operations.register('owner.missing', {}) }, /owner is required/)
ai.registerTransport('reference-test', { toolProtocol: 'native' })
ai.registerConnection('reference-test', { auth: { type: 'none' }, transport: { type: 'reference-test' }, configDefaults: {} })
ai.setActiveConnection('reference-test')
let value = 1
let previewCalls = 0
let unavailableOperationEnabled = false
const tx = []

registerReference('case', {
  read: function (ref) {
    return { uri: ref.uri, value }
  },
  schema: function () {
    return { type: 'object', properties: { value: { type: 'number' } } }
  },
  capabilities: function () {
    return [{ op: 'case.setValue', risk: 'edit' }]
  },
  search: function (query) {
    return query.kind === 'case.item' ? [{ uri: 'case://item/one', kind: 'case.item', title: 'One' }] : []
  },
  selection: function () {
    return [{ uri: 'case://item/one', kind: 'case.item', title: 'One' }]
  },
})
registerReference('case.extra', {}, { owner: 'test:reference-extra' })
assert.deepEqual(ai.references.list('case.extra'), ['case.extra'])
assert.deepEqual(ai.references.unregisterOwner('test:reference-extra'), ['case.extra'])
assert.equal(ai.references.get('case.extra'), null)
registerReference('case.replace', { read: function () { return 'one' } })
assert.throws(function () {
  registerReference('case.replace', { read: function () { return 'hidden overwrite' } })
}, /duplicate name "case.replace"/)
registerReference('case.replace', { read: function () { return 'two' } }, { owner: 'test:reference-operation', replace: true })
assert.equal(ai.references.get('case.replace').read(), 'two')
ai.references.unregister('case.replace', TEST_META)

ai.transactions.configure({
  run(label, fn, meta) {
    tx.push({ label, meta })
    return fn()
  },
})

registerOperation('case.setValue', {
  title: 'Set Value',
  exposeToModel: true,
  inputSchema: {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: { value: { type: 'number' } },
  },
  risk: 'edit',
  preview: function (input) {
    previewCalls++
    return {
      title: 'Set value',
      summary: `${value} -> ${input.value}`,
      changes: [{ ref: 'case://item/one', field: 'value', before: value, after: input.value }],
      next: input.value,
    }
  },
  apply: function (preview) {
    value = preview.next
    return { applied: true, value }
  },
})
registerOperation('case.hidden', {
  inputSchema: { type: 'object', properties: {} },
  preview: function () { return { ok: true } },
})
registerOperation('case.unavailable', {
  exposeToModel: true,
  inputSchema: { type: 'object', properties: {} },
  available: function () { return unavailableOperationEnabled },
  preview: function () { return { ok: true } },
  apply: function () { return { applied: true } },
})
assert.throws(function () {
  registerOperation('case.legacySchema', { schema: { type: 'object' } })
}, /use inputSchema instead of schema/)
assert.throws(function () {
  registerOperation('case.missingSchema', { exposeToModel: true })
}, /model-visible operation requires inputSchema/)
assert.throws(function () {
  registerOperation('case.missingApply', {
    exposeToModel: true,
    inputSchema: { type: 'object', properties: {} },
    preview: function () { return { ok: true } },
  })
}, /model-visible operation requires apply/)
registerOperation('case.extra', {}, { owner: 'test:operation-extra' })
assert.deepEqual(ai.operations.list('case.extra'), ['case.extra'])
assert.deepEqual(ai.operations.unregisterOwner('test:operation-extra'), ['case.extra'])
assert.equal(ai.operations.get('case.extra'), null)
registerOperation('case.replace', { preview: function () { return 'one' } })
assert.throws(function () {
  registerOperation('case.replace', { preview: function () { return 'hidden overwrite' } })
}, /duplicate name "case.replace"/)
registerOperation('case.replace', { preview: function () { return 'two' } }, { owner: 'test:reference-operation', replace: true })
assert.equal(ai.operations.get('case.replace').preview(), 'two')
ai.operations.unregister('case.replace', TEST_META)

const ref = ai.references.normalize('case://item/one')
assert.equal(ref.resolver, 'case')
assert.deepEqual(ai.references.read(ref), { uri: 'case://item/one', value: 1 })
assert.equal(ai.references.schema(ref).properties.value.type, 'number')
assert.deepEqual(ai.references.capabilities(ref), [{ op: 'case.setValue', risk: 'edit' }])
assert.equal(ai.references.search({ kind: 'case.item' })[0].uri, 'case://item/one')
assert.equal(ai.references.selection()[0].uri, 'case://item/one')

const invalid = ai.operations.preview('case.setValue', { value: 'bad' })
assert.equal(invalid.ok, false)
assert.equal(invalid.code, 'OPERATION_INPUT_INVALID')
assert.equal(invalid.errors[0].path, '$.value')
assert.equal(previewCalls, 0)
assert.equal(value, 1)

const preview = ai.operations.preview('case.setValue', { value: 7 })
assert.equal(preview.ok, true)
assert.equal(previewCalls, 1)
assert.equal(preview.risk, 'edit')
assert.equal(preview.changes[0].after, 7)
const applied = ai.operations.apply(preview)
assert.equal(applied.applied, true)
assert.equal(value, 7)
assert.equal(tx[0].label, 'Set value')
assert.equal(tx[0].meta.op, 'case.setValue')

const agent = ai.createAgent({ name: 'Reference Agent' })
const defaultRequest = ai.planRequest(agent, null, 'inspect', 'user', 0)
assert.equal(defaultRequest.tools.includes('aiditor.previewOperation'), false)
assert.equal(defaultRequest.tools.includes('aiditor.applyOperation'), false)
const explicitRequest = ai.planRequest(ai.createAgent({
  name: 'Explicit Operation Agent',
  skillRefs: skillRefs(['aiditor.previewOperation', 'aiditor.applyOperation']),
}), null, 'inspect_explicit', 'user', 0)
assert.deepEqual(explicitRequest.tools, ['aiditor.previewOperation', 'aiditor.applyOperation'])
const operationToolSpec = explicitRequest.toolSpecs.find(function (tool) { return tool.id === 'case.setValue' })
assert.equal(operationToolSpec.schema.properties.value.type, 'number')
assert.equal(operationToolSpec.schema.additionalProperties, false)
assert.deepEqual(operationToolSpec.route, { toolId: 'aiditor.applyOperation', inputKey: 'input', args: { op: 'case.setValue' } })
assert.equal(explicitRequest.toolSpecs.some(function (tool) { return tool.id.indexOf('aiditor.previewOperation') >= 0 }), false)
assert.equal(explicitRequest.toolSpecs.some(function (tool) { return tool.id.indexOf('aiditor.applyOperation') >= 0 }), false)

const pointSchema = {
  type: 'object',
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
}
registerOperation('case.sharedSchema', {
  exposeToModel: true,
  inputSchema: {
    type: 'object',
    properties: {
      first: { type: 'array', items: pointSchema },
      second: { type: 'array', items: pointSchema },
    },
  },
  preview: function () { return { ok: true } },
  apply: function () { return { applied: true } },
})
const sharedSchemaRequest = ai.planRequest(ai.createAgent({
  name: 'Shared Schema Agent',
  skillRefs: skillRefs(['aiditor.applyOperation']),
}), null, 'inspect_shared_schema', 'user', 0)
const sharedSchemaSpec = sharedSchemaRequest.toolSpecs.find(function (tool) {
  return tool.id === 'case.sharedSchema'
})
assert.deepEqual(sharedSchemaSpec.schema.properties.first.items.required, ['x', 'y'])
assert.deepEqual(sharedSchemaSpec.schema.properties.second.items.required, ['x', 'y'])
ai.operations.unregister('case.sharedSchema', TEST_META)

unavailableOperationEnabled = true
const requestWithAvailableOperation = ai.planRequest(ai.createAgent({
  name: 'Available Operation Agent',
  skillRefs: skillRefs(['aiditor.applyOperation']),
}), null, 'inspect_available', 'user', 0)
assert.deepEqual(
  requestWithAvailableOperation.toolSpecs.map(function (tool) { return tool.route.args.op }),
  ['case.setValue', 'case.unavailable']
)
unavailableOperationEnabled = false

ai.tools.register('case.setValue', {
  schema: { type: 'object', properties: {} },
  run: function () { return null },
}, TEST_META)
assert.throws(function () {
  ai.planRequest(ai.createAgent({
    name: 'Conflicting Operation Agent',
    skillRefs: skillRefs(['case.setValue', 'aiditor.applyOperation']),
  }), null, 'inspect_conflict', 'user', 0)
}, /Model Tool id conflict: case\.setValue/)
ai.tools.unregister('case.setValue', TEST_META)

const previewGateway = ai.tools.get('aiditor.previewOperation')
const unknownOperation = previewGateway.run({ op: 'case.missing', input: {} }, { actor: 'user', agent: agent })
assert.equal(unknownOperation.ok, false)
assert.equal(unknownOperation.code, 'OPERATION_NOT_FOUND')
assert.deepEqual(unknownOperation.allowedValues, ['case.setValue'])
const unavailableOperation = previewGateway.run({ op: 'case.unavailable', input: {} }, { actor: 'user', agent: agent })
assert.equal(unavailableOperation.code, 'OPERATION_NOT_AVAILABLE')
assert.deepEqual(unavailableOperation.allowedValues, ['case.setValue'])
assert.throws(function () {
  ai.operations.preview('case.missing', {})
}, /Operation not found/)

const invalidGatewayPreview = previewGateway.run({ op: 'case.setValue', input: { value: 'bad' } }, { actor: 'user', agent: agent })
assert.equal(invalidGatewayPreview.code, 'OPERATION_INPUT_INVALID')
assert.equal(previewCalls, 1)
const missingPreview = ai.tools.get('aiditor.applyOperation').preview({ previewId: 'opv_missing' }, { actor: 'user', agent: agent })
assert.equal(missingPreview.code, 'OPERATION_PREVIEW_NOT_FOUND')
assert.equal(missingPreview.previewId, 'opv_missing')
const hostOnlyPreview = ai.operations.preview('case.unavailable', {})
const hiddenPreview = ai.tools.get('aiditor.applyOperation').preview({ previewId: hostOnlyPreview.id }, { actor: 'user', agent: agent })
assert.equal(hiddenPreview.code, 'OPERATION_NOT_AVAILABLE')

const fallbackPermissionCalls = []
ai.permissions.setResolver(function (ctx, next) {
  fallbackPermissionCalls.push({ scope: ctx.scope, entry: ctx.entry, phase: ctx.phase })
  if (ctx.scope === 'tool.apply') return false
  return next(ctx)
})
const projectedTargets = ai.tools.permissionTargets('aiditor.applyOperation', { op: 'case.setValue', input: { value: 8 } }, { actor: 'user', agent: agent }, 'apply')
assert.equal(projectedTargets[0].entry, 'case.setValue')
assert.equal(projectedTargets[0].risk, 'write')
assert.equal(ai.permissions.decideMany('user', agent.id, 'tool.apply', projectedTargets).allowed, false)
ai.permissions.setResolver(null)
assert.equal(fallbackPermissionCalls[0].entry, 'case.setValue')
assert.equal(fallbackPermissionCalls[0].phase, 'apply')

const runTool = ai.createToolCall(agent.id, { toolId: 'aiditor.readReference', args: { uri: 'case://item/one' } }, 'user')
ai.approveToolCall(agent.id, runTool.id, 'user')
const run = ai.runToolCall(agent.id, runTool.id, 'user')
await run.promise
assert.equal(ai.findToolCall(agent.id, runTool.id).toolCall.result.value, 7)

const applyTool = ai.createToolCall(agent.id, { toolId: 'aiditor.applyOperation', args: { op: 'case.setValue', input: { value: 9 } } }, 'user')
ai.previewToolCall(agent.id, applyTool.id, 'user')
assert.equal(ai.findToolCall(agent.id, applyTool.id).toolCall.preview.changes[0].after, 9)
ai.approveToolCall(agent.id, applyTool.id, 'user')
ai.applyToolCall(agent.id, applyTool.id, 'user')
assert.equal(value, 9)

console.log('ai reference operation tests ok')

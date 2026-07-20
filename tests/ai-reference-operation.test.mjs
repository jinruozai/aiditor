import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/log.js', 'utf8'), { filename: 'log.js' })
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/ai/name-generator.js', 'utf8'), { filename: 'ai/name-generator.js' })
vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
vm.runInThisContext(readFileSync('src/ai/store.js', 'utf8'), { filename: 'ai/store.js' })
vm.runInThisContext(readFileSync('src/ai/connection.js', 'utf8'), { filename: 'ai/connection.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
vm.runInThisContext(readFileSync('src/ai/registries.js', 'utf8'), { filename: 'ai/registries.js' })
vm.runInThisContext(readFileSync('src/ai/context.js', 'utf8'), { filename: 'ai/context.js' })
vm.runInThisContext(readFileSync('src/ai/reference.js', 'utf8'), { filename: 'ai/reference.js' })
vm.runInThisContext(readFileSync('src/ai/request.js', 'utf8'), { filename: 'ai/request.js' })

const ai = window.aiditor.ai
ai.registerTransport('reference-test', { toolProtocol: 'native' })
ai.registerConnection('reference-test', { auth: { type: 'none' }, transport: { type: 'reference-test' }, configDefaults: {} })
ai.setActiveConnection('reference-test')
let value = 1
const tx = []

ai.references.register('case', {
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
ai.references.register('case.extra', {})
assert.deepEqual(ai.references.list('case.extra'), ['case.extra'])
assert.deepEqual(ai.references.unregisterPrefix('case.extra'), ['case.extra'])
assert.equal(ai.references.get('case.extra'), null)
ai.references.register('case.replace', { read: function () { return 'one' } })
assert.throws(function () {
  ai.references.register('case.replace', { read: function () { return 'hidden overwrite' } })
}, /duplicate name "case.replace"/)
ai.references.register('case.replace', { read: function () { return 'two' } }, { replace: true })
assert.equal(ai.references.get('case.replace').read(), 'two')
ai.references.unregister('case.replace')

ai.transactions.configure({
  run(label, fn, meta) {
    tx.push({ label, meta })
    return fn()
  },
})

ai.operations.register('case.setValue', {
  title: 'Set Value',
  schema: { type: 'object', required: ['value'], properties: { value: { type: 'number' } } },
  risk: 'edit',
  preview: function (input) {
    if (typeof input.value !== 'number') return { ok: false, errors: [{ path: 'value', message: 'value must be number' }] }
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
ai.operations.register('case.extra', {})
assert.deepEqual(ai.operations.list('case.extra'), ['case.extra'])
assert.deepEqual(ai.operations.unregisterPrefix('case.extra'), ['case.extra'])
assert.equal(ai.operations.get('case.extra'), null)
ai.operations.register('case.replace', { preview: function () { return 'one' } })
assert.throws(function () {
  ai.operations.register('case.replace', { preview: function () { return 'hidden overwrite' } })
}, /duplicate name "case.replace"/)
ai.operations.register('case.replace', { preview: function () { return 'two' } }, { replace: true })
assert.equal(ai.operations.get('case.replace').preview(), 'two')
ai.operations.unregister('case.replace')

const ref = ai.references.normalize('case://item/one')
assert.equal(ref.resolver, 'case')
assert.deepEqual(ai.references.read(ref), { uri: 'case://item/one', value: 1 })
assert.equal(ai.references.schema(ref).properties.value.type, 'number')
assert.deepEqual(ai.references.capabilities(ref), [{ op: 'case.setValue', risk: 'edit' }])
assert.equal(ai.references.search({ kind: 'case.item' })[0].uri, 'case://item/one')
assert.equal(ai.references.selection()[0].uri, 'case://item/one')

const invalid = ai.operations.preview('case.setValue', { value: 'bad' })
assert.equal(invalid.ok, false)
assert.equal(value, 1)

const preview = ai.operations.preview('case.setValue', { value: 7 })
assert.equal(preview.ok, true)
assert.equal(preview.risk, 'edit')
assert.equal(preview.changes[0].after, 7)
const applied = ai.operations.apply(preview)
assert.equal(applied.applied, true)
assert.equal(value, 7)
assert.equal(tx[0].label, 'Set value')
assert.equal(tx[0].meta.op, 'case.setValue')

const agent = ai.createAgent({ name: 'Reference Agent' })
const defaultRequest = ai.makeRequest(agent, null, 'inspect', 'user', 0)
assert.equal(defaultRequest.tools.includes('aiditor.previewOperation'), false)
assert.equal(defaultRequest.tools.includes('aiditor.applyOperation'), false)
const explicitRequest = ai.makeRequest(ai.createAgent({
  name: 'Explicit Operation Agent',
  toolRefs: ['aiditor.previewOperation', 'aiditor.applyOperation'],
}), null, 'inspect_explicit', 'user', 0)
assert.deepEqual(explicitRequest.tools, ['aiditor.previewOperation', 'aiditor.applyOperation'])

const savedCanUseOperation = ai.canUseOperation
const savedCanUseTool = ai.canUseTool
const fallbackPermissionCalls = []
ai.canUseOperation = null
ai.canUseTool = function (actor, target, toolId, phase) {
  fallbackPermissionCalls.push({ actor, target, toolId, phase })
  return phase !== 'apply'
}
try {
  ai.tools.get('aiditor.previewOperation').run({ op: 'case.setValue', input: { value: 8 } }, { actor: 'user', agent: agent })
  const deniedApply = ai.tools.get('aiditor.applyOperation').apply({ op: 'case.setValue', ok: true, risk: 'edit', next: 8 }, { actor: 'user', agent: agent })
  assert.equal(deniedApply.applied, false)
} finally {
  ai.canUseOperation = savedCanUseOperation
  ai.canUseTool = savedCanUseTool
}
assert.equal(fallbackPermissionCalls[0].toolId, 'aiditor.previewOperation')
assert.equal(fallbackPermissionCalls[0].phase, 'call')
assert.equal(fallbackPermissionCalls[1].toolId, 'aiditor.applyOperation')
assert.equal(fallbackPermissionCalls[1].phase, 'apply')

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

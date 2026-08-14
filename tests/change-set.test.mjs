import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
global.aiditor = global.window.aiditor

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/ai/name-generator.js',
  'src/ai/permission.js',
  'src/ai/store.js',
  'src/ai/change-set.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const cs = aiditor.changeSet.create({
  title: 'Edit price',
  resources: [{
    uri: 'gde://entity/data%2Fitems/100',
    kind: 'gde.entity',
    title: 'Iron Sword',
    changes: [{ kind: 'gde.field', path: 'price', before: 10, after: 12 }],
  }],
  apply: { mode: 'atomic', adapter: 'test.patch', payload: { value: 12 } },
})

assert.equal(cs.type, 'aiditor.changeSet')
assert.equal(cs.summary.changeCount, 1)
assert.equal(cs.summary.updates, 1)
assert.equal(aiditor.changeSet.find(cs.id).id, cs.id)

let appliedPayload = null
aiditor.changeSet.registerAdapter('test.patch', {
  apply: function (set, scope) {
    appliedPayload = set.apply.payload
    assert.deepEqual(scope, { type: 'all' })
    return Promise.resolve({ applied: true, payload: set.apply.payload })
  },
})

const applied = await aiditor.changeSet.apply(cs.id, { type: 'all' }, 'user')
assert.equal(applied.status, 'applied')
assert.deepEqual(appliedPayload, { value: 12 })
assert.equal(applied.resources[0].changes[0].status, 'applied')

const failed = aiditor.changeSet.create({
  title: 'Bad edit',
  resources: [{ uri: 'x', changes: [{ before: 1, after: 2 }] }],
  apply: { mode: 'atomic', adapter: 'bad.patch', payload: {} },
})
aiditor.changeSet.registerAdapter('bad.patch', {
  apply: function () {
    return { ok: false, validation: { errors: [{ path: 'ops[0]', message: 'bad' }] } }
  },
})
const failedResult = await aiditor.changeSet.apply(failed, { type: 'all' }, 'user')
assert.equal(failedResult.status, 'failed')
assert.match(failedResult.meta.error, /bad/)

const rejected = await aiditor.changeSet.reject(failed.id, { type: 'all' }, 'user')
assert.equal(rejected.status, 'rejected')

console.log('change set tests ok')

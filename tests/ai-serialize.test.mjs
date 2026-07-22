import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/ai/serialize.js', 'utf8'), { filename: 'ai/serialize.js' })

const serialize = window.aiditor.ai.serialize
const shared = { value: 7 }
const sharedClone = serialize.clone({ first: shared, second: shared })
assert.deepEqual(sharedClone, { first: { value: 7 }, second: { value: 7 } })
assert.notEqual(sharedClone.first, sharedClone.second)
assert.equal(serialize.stringify({ first: shared, second: shared }).includes('[Circular]'), false)

const required = ['x', 'y']
const point = {
  type: 'object',
  required: required,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
}
const schemaClone = serialize.clone({ first: point, second: point })
assert.deepEqual(schemaClone.first.required, ['x', 'y'])
assert.deepEqual(schemaClone.second.required, ['x', 'y'])

const circular = { id: 'root' }
circular.self = circular
assert.deepEqual(serialize.clone(circular), { id: 'root', self: '[Circular]' })

console.log('ai serialize tests ok')

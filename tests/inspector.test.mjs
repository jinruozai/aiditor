import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/bus.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/schema.js',
  'src/ui/inspector.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const store = {
  a: { name: 'A', hp: 10, locked: false },
  b: { name: 'B', hp: 20, locked: false },
  c: { name: 'C', locked: true },
}

aiditor.inspector.registerProvider('case.unit', {
  inspect(targets) {
    return {
      schema: {
        name: { type: 'string' },
        hp: { type: 'int' },
      },
      values: targets.map(function (target) { return store[target.id] }),
      canWrite: function (_target, _field, value) { return !value.locked },
      write: function (field, change, ctx) {
        ctx.targets.forEach(function (target, index) {
          store[target.id][field] = ctx.valueForChange(change, target, index, ctx)
        })
      },
    }
  },
})

const targets = [
  { type: 'case.unit', id: 'a', title: 'A' },
  { type: 'case.unit', id: 'b', title: 'B' },
]
aiditor.inspector.select(targets)
assert.deepEqual(aiditor.inspector.selection.peek().map(function (target) { return target.id }), ['a', 'b'])
const atomicStates = []
const stopAtomic = aiditor.effect(function () {
  const selection = aiditor.inspector.selection()
  const meta = aiditor.inspector.meta()
  atomicStates.push({ primary: selection[0] && selection[0].id, workspaceId: meta.workspaceId || '' })
})
aiditor.inspector.select(targets, { workspaceId: 'project-a' })
assert.deepEqual(atomicStates.slice(-1), [{ primary: 'a', workspaceId: 'project-a' }])
assert.equal(atomicStates.length, 2)
stopAtomic()
let refreshed = 0
const stopRefresh = aiditor.effect(function () {
  aiditor.inspector.selection()
  refreshed++
})
aiditor.inspector.refresh()
assert.equal(refreshed, 2)
stopRefresh()

const inspection = aiditor.inspector.inspect(aiditor.inspector.selection.peek())
assert.equal(inspection.values[0].name, 'A')
assert.equal(aiditor.inspector.canEditField(inspection, 'hp', inspection.values, inspection.schema.hp), true)
const providerReturned = aiditor.inspector.providerFor(targets).inspect(targets, {})
assert.equal(Object.prototype.hasOwnProperty.call(providerReturned, 'targets'), false)

inspection.write('name', aiditor.inspector.literalChange('name', 'Renamed'), {
  targets: inspection.targets,
  values: inspection.values,
  valueForChange: aiditor.inspector.valueForChange,
})
assert.equal(store.a.name, 'Renamed')
assert.equal(store.b.name, 'Renamed')

assert.deepEqual(aiditor.inspector.parseFieldPath('aaa.metalist[5].transform.pos.x'), ['aaa', 'metalist', 5, 'transform', 'pos', 'x'])
assert.equal(aiditor.inspector.formatFieldPath(['fruit', 'red.pear', 'weight']), 'fruit["red.pear"].weight')
assert.deepEqual(aiditor.inspector.pathChange('hp', 30), { field: 'hp', mode: 'path', value: 30 })

const encodedSchema = {
  transform: {
    type: 'struct',
    struct_def: {
      pos: {
        type: 'struct',
        struct_def: {
          x: 'int',
          y: 'int',
          z: 'int',
        },
      },
      enabled: 'bool',
    },
  },
  items: {
    type: 'array',
    type_agv: {
      elem_type: {
        type: 'struct',
        struct_def: {
          id: 'string',
          num: 'int',
        },
      },
    },
  },
  fruit: {
    type: 'dict',
    type_agv: {
      value_type: {
        type: 'struct',
        struct_def: {
          id: 'string',
          weight: 'float',
        },
      },
    },
  },
}
const encodedValue = {
  transform: [[1, 2, 3], 1],
  items: [['a', 1], ['b', 2]],
  fruit: {
    apple: ['101', 0.8],
    'red.pear': ['102', 0.6],
  },
}
const changedTransform = aiditor.inspector.applyChange(encodedValue, aiditor.inspector.pathChange('transform.pos.x', 10), encodedSchema)
assert.deepEqual(changedTransform.transform, [[10, 2, 3], 1])
assert.deepEqual(encodedValue.transform, [[1, 2, 3], 1])

const changedItem = aiditor.inspector.applyChange(encodedValue, aiditor.inspector.pathChange('items[1].num', 3), encodedSchema)
assert.deepEqual(changedItem.items, [['a', 1], ['b', 3]])

const changedDict = aiditor.inspector.applyChange(encodedValue, aiditor.inspector.pathChange('fruit["red.pear"].weight', 0.7), encodedSchema)
assert.deepEqual(changedDict.fruit, {
  apple: ['101', 0.8],
  'red.pear': ['102', 0.7],
})

const literalApplied = aiditor.inspector.applyChange(encodedValue, aiditor.inspector.literalChange('transform', [[4, 5, 6], 0]), encodedSchema)
assert.deepEqual(literalApplied.transform, [[4, 5, 6], 0])

const locked = aiditor.inspector.inspect([
  { type: 'case.unit', id: 'a' },
  { type: 'case.unit', id: 'c' },
])
assert.equal(aiditor.inspector.canEditField(locked, 'hp', locked.values, locked.schema.hp), false)
assert.equal(aiditor.inspector.canEditField(locked, 'name', locked.values, locked.schema.name), false)

assert.equal(aiditor.inspector.inspect([
  { type: 'case.unit', id: 'a' },
  { type: 'case.other', id: 'x' },
]), null)

aiditor.inspector.registerProvider('case.mixed', {
  accept: function () { return true },
  inspect: function (items) { return { values: items, schema: { id: { type: 'string' } } } },
})
assert.equal(aiditor.inspector.inspect([
  { type: 'case.mixed', id: 'one' },
  { type: 'case.other', id: 'two' },
]).values.length, 2)

assert.throws(function () {
  aiditor.inspector.registerProvider('case.unit', { inspect: function () { return {} } })
}, /duplicate provider/)

aiditor.inspector.registerProvider('case.throw', {
  inspect: function () { throw new Error('inspect failed') },
})
assert.equal(aiditor.inspector.inspect([{ type: 'case.throw', id: 'x' }]), null)
assert.equal(aiditor.log.peek().some(function (entry) {
  return entry.source.scope === 'inspector' && entry.source.action === 'inspect'
}), true)

aiditor.inspector.registerProvider('case.throwField', {
  inspect: function () {
    return {
      values: [{ name: 'A' }],
      schema: { name: { type: 'string' } },
      canWrite: function () { throw new Error('field failed') },
    }
  },
})
const throwingField = aiditor.inspector.inspect([{ type: 'case.throwField', id: 'x' }])
assert.equal(aiditor.inspector.canEditField(throwingField, 'name', throwingField.values, throwingField.schema.name), false)

assert.deepEqual(aiditor.inspector.unregisterOwner('none'), [])

console.log('inspector tests ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
global.document = {}
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'src/core/signal.js' })
vm.runInThisContext(readFileSync('src/core/workspace-state.js', 'utf8'), { filename: 'src/core/workspace-state.js' })

const aiditor = window.aiditor
aiditor.safeCall = function (_, fn) { return fn() }
aiditor.reportError = function () {}
aiditor.inspector = {}
vm.runInThisContext(readFileSync('src/ui/inspector-folding.js', 'utf8'), { filename: 'src/ui/inspector-folding.js' })

const folding = aiditor.inspector
const fieldTransform = folding.foldingPath.field('transform')
const fieldPosition = folding.foldingPath.field('transform.position')
const groupRender = folding.foldingPath.group('', 'render')
assert.equal(fieldTransform, JSON.stringify(['field', 'transform']))
assert.equal(fieldPosition, JSON.stringify(['field', 'transform.position']))
assert.equal(groupRender, JSON.stringify(['group', '', 'render']))

const primary = { id: 'fallback-id', stable: 'primary-a' }
const secondary = { id: 'secondary', stable: 'secondary-b' }
const resolvedScope = folding.foldingScope({
  type: 'case.material',
  provider: { targetId: function (target) { return target.stable } },
}, [primary, secondary], { workspaceId: 'project-a' })
assert.deepEqual(resolvedScope, {
  workspaceId: 'project-a',
  providerType: 'case.material',
  primaryId: 'primary-a',
  persistent: true,
})
assert.equal(folding.foldingScope({ type: 'case.material', provider: {} }, [primary], {}).primaryId, 'fallback-id')
const anonymousPrimary = {}
const anonymousA = folding.foldingScope({ type: 'case.material', provider: {} }, [anonymousPrimary], { workspaceId: 'project-a' })
const anonymousB = folding.foldingScope({ type: 'case.material', provider: {} }, [anonymousPrimary], { workspaceId: 'project-a' })
assert.equal(anonymousA.primaryId, anonymousB.primaryId)
assert.equal(anonymousA.persistent, false)

function scope(workspaceId, providerType, primaryId) {
  return { workspaceId: workspaceId, providerType: providerType, primaryId: primaryId, persistent: true }
}

function memoryState(initial) {
  const values = new Map(Object.entries(initial || {}))
  const writes = []
  return {
    values: values,
    writes: writes,
    load(workspaceId) { return Promise.resolve(values.get(workspaceId) || null) },
    save(workspaceId, key, value) {
      const snapshot = JSON.parse(JSON.stringify(value))
      values.set(workspaceId, snapshot)
      writes.push({ kind: 'save', workspaceId: workspaceId, key: key, value: snapshot })
      return Promise.resolve()
    },
    remove(workspaceId, key) {
      values.delete(workspaceId)
      writes.push({ kind: 'remove', workspaceId: workspaceId, key: key })
      return Promise.resolve()
    },
  }
}

const state = memoryState()
const store = folding.createFoldingStateStore({ workspaceState: state, throttleMs: 10000 })
const scopeSig = aiditor.signal(scope('project-a', 'case.material', 'primary-a'))
const panelA = store.bind(scopeSig, fieldTransform)
const panelB = store.bind(scope('project-a', 'case.material', 'primary-a'), fieldTransform)
await Promise.resolve()
assert.equal(panelA.peek(), false)
assert.equal(panelB.peek(), false)
panelA.set(true)
assert.equal(panelA.peek(), true)
assert.equal(panelB.peek(), true)

scopeSig.set(scope('project-a', 'case.material', 'primary-b'))
assert.equal(panelA.peek(), false)
assert.equal(panelB.peek(), true)
panelA.set(true)
scopeSig.set(scope('project-b', 'case.material', 'primary-a'))
assert.equal(panelA.peek(), false)
panelA.set(true)
assert.equal(store.snapshot('project-a').entries.length, 2)
assert.equal(store.snapshot('project-b').entries.length, 1)

scopeSig.set(scope('project-a', 'case.material', 'primary-a'))
assert.equal(panelA.peek(), true)
panelB.set(false)
assert.equal(panelA.peek(), false)
assert.equal(panelB.peek(), false)
assert.deepEqual(store.snapshot('project-a').entries.map(function (entry) { return entry.primaryId }), ['primary-b'])
await store.flush()
assert.equal(state.writes.some(function (write) { return write.workspaceId === 'project-a' }), true)
assert.equal(state.writes.some(function (write) { return write.workspaceId === 'project-b' }), true)
panelA.dispose()
panelB.dispose()
store.dispose()

const lruState = memoryState()
const lruStore = folding.createFoldingStateStore({ workspaceState: lruState, maxEntries: 2, throttleMs: 10000 })
const loadBinding = lruStore.bind(scope('lru-project', 'case.material', 'load'), fieldTransform)
await Promise.resolve()
loadBinding.dispose()
function expandOnce(primaryId) {
  const binding = lruStore.bind(scope('lru-project', 'case.material', primaryId), fieldTransform)
  binding.set(true)
  binding.dispose()
}
expandOnce('a')
expandOnce('b')
const touchA = lruStore.bind(scope('lru-project', 'case.material', 'a'), fieldPosition)
touchA.dispose()
expandOnce('c')
assert.deepEqual(lruStore.snapshot('lru-project').entries.map(function (entry) { return entry.primaryId }), ['a', 'c'])
const collapseA = lruStore.bind(scope('lru-project', 'case.material', 'a'), fieldTransform)
collapseA.set(false)
collapseA.dispose()
assert.deepEqual(lruStore.snapshot('lru-project').entries.map(function (entry) { return entry.primaryId }), ['c'])
lruStore.dispose()

let resolveDelayedLoad
const delayedState = {
  load: function () { return new Promise(function (resolve) { resolveDelayedLoad = resolve }) },
  save: function () { return Promise.resolve() },
  remove: function () { return Promise.resolve() },
}
const delayedStore = folding.createFoldingStateStore({ workspaceState: delayedState, throttleMs: 10000 })
const delayedScope = scope('delayed-project', 'case.material', 'primary-a')
const delayedBinding = delayedStore.bind(delayedScope, fieldTransform)
delayedBinding.set(true)
delayedBinding.set(false)
resolveDelayedLoad({
  version: 1,
  entries: [{ providerType: 'case.material', primaryId: 'primary-a', expanded: [fieldTransform] }],
})
await Promise.resolve()
await Promise.resolve()
assert.equal(delayedBinding.peek(), false)
assert.deepEqual(delayedStore.snapshot('delayed-project').entries, [])
delayedBinding.dispose()
delayedStore.dispose()

const hydratedState = memoryState({
  'hydrated-project': {
    version: 1,
    entries: [
      { providerType: 'case.material', primaryId: 'oldest', expanded: [fieldTransform] },
      { providerType: 'case.material', primaryId: 'middle', expanded: [fieldPosition, 'invalid'] },
      { providerType: 'case.material', primaryId: 'newest', expanded: [groupRender] },
    ],
  },
})
const hydratedStore = folding.createFoldingStateStore({ workspaceState: hydratedState, maxEntries: 2, throttleMs: 10000 })
const hydratedBinding = hydratedStore.bind(scope('hydrated-project', 'case.material', 'newest'), groupRender)
await Promise.resolve()
await Promise.resolve()
assert.equal(hydratedBinding.peek(), true)
assert.deepEqual(hydratedStore.snapshot('hydrated-project').entries.map(function (entry) { return entry.primaryId }), ['middle', 'newest'])
assert.deepEqual(hydratedStore.snapshot('hydrated-project').entries[0].expanded, [fieldPosition])
await hydratedStore.flush()
assert.equal(hydratedState.writes.at(-1).kind, 'save')
hydratedBinding.dispose()
hydratedStore.dispose()

console.log('inspector folding state tests ok')

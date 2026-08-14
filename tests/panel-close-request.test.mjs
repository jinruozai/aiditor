import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/bus.js',
  'src/tree/tree.js',
  'src/dock/runtime.js',
  'src/core/context.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor

function panel(id) {
  return { id: id, component: 'case.panel', title: id }
}

function tree() {
  return {
    type: 'dock',
    id: 'dock-a',
    toolbar: null,
    panels: [panel('panel-a'), panel('panel-b'), panel('panel-c')],
    activeId: 'panel-a',
  }
}

let requests = []
let decide
const treeSig = aiditor.signal(tree())
const layout = aiditor._dock.createLayoutRuntime({}, treeSig, {
  hooks: {
    onPanelCloseRequest: function (request) {
      requests.push(request)
      return new Promise(function (resolve) { decide = resolve })
    },
  },
})

const canceled = layout.requestClosePanels(['panel-b', 'panel-c', 'panel-b'], 'close-others')
assert.deepEqual(requests[0].panelIds, ['panel-b', 'panel-c'])
assert.deepEqual(requests[0].panels.map(function (item) { return item.id }), ['panel-b', 'panel-c'])
assert.equal(requests[0].reason, 'close-others')
assert.equal(treeSig.peek().panels.length, 3)
decide(false)
assert.equal(await canceled, false)
assert.equal(treeSig.peek().panels.length, 3)

const stale = layout.requestClosePanels(['panel-b'], 'close')
treeSig.set(aiditor.updatePanel(treeSig.peek(), 'panel-b', { dirty: true }))
decide(true)
assert.equal(await stale, false)
assert.equal(aiditor.findPanel(treeSig.peek(), 'panel-b').panel.dirty, true)

let saveHookCalls = 0
const saveTree = aiditor.signal(aiditor.updatePanel(tree(), 'panel-b', { dirty: true }))
const saveLayout = aiditor._dock.createLayoutRuntime({}, saveTree, {
  hooks: {
    onPanelCloseRequest: async function (request) {
      saveHookCalls++
      assert.equal(request.panels[0].dirty, true)
      saveTree.set(aiditor.updatePanel(saveTree.peek(), 'panel-b', { dirty: false }))
      return true
    },
  },
})
assert.equal(await saveLayout.requestClosePanels(['panel-b'], 'close'), true)
assert.equal(saveHookCalls, 1)
assert.equal(aiditor.findPanel(saveTree.peek(), 'panel-b'), null)

let finishRedirty
const redirtyTree = aiditor.signal(aiditor.updatePanel(tree(), 'panel-b', { dirty: true }))
const redirtyLayout = aiditor._dock.createLayoutRuntime({}, redirtyTree, {
  hooks: {
    onPanelCloseRequest: function () { return new Promise(function (resolve) { finishRedirty = resolve }) },
  },
})
const redirtyClose = redirtyLayout.requestClosePanels(['panel-b'], 'close')
redirtyTree.set(aiditor.updatePanel(redirtyTree.peek(), 'panel-b', { dirty: false }))
redirtyTree.set(aiditor.updatePanel(redirtyTree.peek(), 'panel-b', { dirty: true }))
finishRedirty(true)
assert.equal(await redirtyClose, false)
assert.equal(aiditor.findPanel(redirtyTree.peek(), 'panel-b').panel.dirty, true)

let finishChanged
const changedTree = aiditor.signal(aiditor.updatePanel(tree(), 'panel-b', { dirty: true }))
const changedLayout = aiditor._dock.createLayoutRuntime({}, changedTree, {
  hooks: {
    onPanelCloseRequest: function () { return new Promise(function (resolve) { finishChanged = resolve }) },
  },
})
const changedClose = changedLayout.requestClosePanels(['panel-b'], 'close')
changedTree.set(aiditor.updatePanel(changedTree.peek(), 'panel-b', { dirty: false, title: 'saved elsewhere' }))
finishChanged(true)
assert.equal(await changedClose, false)
assert.equal(aiditor.findPanel(changedTree.peek(), 'panel-b').panel.title, 'saved elsewhere')

let publishes = 0
const stop = aiditor.effect(function () { treeSig(); publishes++ })
const allowed = layout.requestClosePanels(['panel-b', 'panel-c'], 'close-all')
decide(true)
assert.equal(await allowed, true)
assert.deepEqual(treeSig.peek().panels.map(function (item) { return item.id }), ['panel-a'])
assert.equal(publishes, 2)
stop()

const callsBeforeForce = requests.length
layout.removePanel('panel-a')
assert.equal(requests.length, callsBeforeForce)
assert.equal(treeSig.peek().panels.length, 0)

const errorTree = aiditor.signal(tree())
const errorLayout = aiditor._dock.createLayoutRuntime({}, errorTree, {
  hooks: {
    onPanelCloseRequest: async function () { throw new Error('host close failed') },
  },
})
assert.equal(await errorLayout.requestClosePanels(['panel-a'], 'close'), false)
assert.equal(errorTree.peek().panels.length, 3)
assert.equal(aiditor.log.peek().some(function (entry) { return entry.message === 'host close failed' }), true)

const noHookTree = aiditor.signal(tree())
const noHookLayout = aiditor._dock.createLayoutRuntime({}, noHookTree, {})
assert.equal(await noHookLayout.requestClosePanels(['panel-a'], 'close'), true)
assert.deepEqual(noHookTree.peek().panels.map(function (item) { return item.id }), ['panel-b', 'panel-c'])

const contextCalls = []
const contextRuntime = {
  kind: 'panel',
  component: 'case.panel',
  panelId: 'panel-a',
  active: aiditor.signal(true),
  data: aiditor.signal(tree().panels[0]),
  dockRef: aiditor.signal('dock-a'),
  cleanups: [],
}
const contextLayout = {
  treeSig: aiditor.signal(tree()),
  requestClosePanels: function (ids, reason) { contextCalls.push({ ids: ids, reason: reason }); return Promise.resolve(true) },
  promotePanel: function () {},
  setTree: function () {},
}
const ctx = aiditor._dock.makeContext(contextRuntime, contextLayout)
await ctx.panel.close('close')
await ctx.dock.requestClosePanel('panel-b', 'close-others')
assert.deepEqual(contextCalls, [
  { ids: ['panel-a'], reason: 'close' },
  { ids: ['panel-b'], reason: 'close-others' },
])

console.log('panel close request tests ok')

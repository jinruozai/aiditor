import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const tabCalls = []

global.window = {
  aiditor: {
    ui: {
      tab: function (opts) {
        tabCalls.push(opts)
        return { classList: { add: function () {} } }
      },
    },
  },
}

for (const file of [
  'src/core/signal.js',
  'src/core/names.js',
  'src/core/registry.js',
  'src/ui/panel/dock-tabs.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor

aiditor.registerComponent('case.emptyScene', {
  defaults: function () {
    return { title: 'Empty Scene', icon: 'box', props: { grid: true } }
  },
  factory: function () { return {} },
})

function makeCtx() {
  const added = []
  const closeRequests = []
  return {
    added: added,
    closeRequests: closeRequests,
    ctx: {
      dock: {
        panels: function () { return [] },
        activeId: function () { return null },
        activatePanel: function () {},
        requestClosePanel: function (id, reason) { closeRequests.push({ id: id, reason: reason }); return Promise.resolve(true) },
        addPanel: function (partial) { added.push(partial); return { panelId: 'new-panel' } },
        id: function () { return 'dock-a' },
      },
    },
  }
}

const tabs = aiditor.resolveComponent('tab-standard')

let env = makeCtx()
tabs.factory({ peek: function () { return {} } }, env.ctx)
assert.equal(tabCalls[0].addable, false)
await tabCalls[0].onClose('panel-a')
assert.deepEqual(env.closeRequests, [{ id: 'panel-a', reason: 'close' }])
tabCalls[0].onAdd()
assert.equal(env.added.length, 0)

env = makeCtx()
tabs.factory({
  peek: function () {
    return {
      addPanel: {
        component: 'case.emptyScene',
        title: 'Scene',
        props: { grid: false },
      },
    }
  },
}, env.ctx)
assert.equal(tabCalls[1].addable, true)
tabCalls[1].onAdd()
assert.deepEqual(env.added, [{
  title: 'Scene',
  icon: 'box',
  props: { grid: false },
  component: 'case.emptyScene',
}])

console.log('dock tabs tests ok')

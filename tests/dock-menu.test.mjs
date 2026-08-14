import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/commands.js', 'utf8'), { filename: 'commands.js' })
vm.runInThisContext(readFileSync('src/core/registry.js', 'utf8'), { filename: 'registry.js' })
vm.runInThisContext(readFileSync('src/tree/tree.js', 'utf8'), { filename: 'tree.js' })
vm.runInThisContext(readFileSync('src/dock/menu.js', 'utf8'), { filename: 'dock-menu.js' })

const aiditor = window.aiditor

let tree = {
  type: 'dock',
  id: 'dock-a',
  toolbar: null,
  focused: false,
  panels: [
    { id: 'panel-a', component: 'editor', title: 'Editor', transient: true },
    { id: 'panel-b', component: 'log', title: 'Log' },
  ],
  activeId: 'panel-a',
}

const closeRequests = []
let promoted = null
const layout = {
  dockMenu: true,
  treeSig: { peek: function () { return tree } },
  setTree: function (next) { tree = next },
  requestClosePanels: function (ids, reason) { closeRequests.push({ ids: ids.slice(), reason: reason }); return Promise.resolve(true) },
  promotePanel: function (id) { promoted = id },
}

aiditor._dock.installDefaultDockMenu()
aiditor._dock.installDefaultDockMenu()
assert.equal(aiditor.commands.list({ owner: 'aiditor:dock-menu' }).length, 11)
aiditor.commands.unregisterOwner('aiditor:dock-menu')
assert.equal(aiditor.commands.list({ owner: 'aiditor:dock-menu' }).length, 0)
aiditor._dock.installDefaultDockMenu()
assert.equal(aiditor.commands.list({ owner: 'aiditor:dock-menu' }).length, 11)

const dock = aiditor.findDock(tree, 'dock-a').node
const items = aiditor.commands.menuUiItems('dock.context', {
  pos: { x: 1, y: 2 },
  dockId: 'dock-a',
  layout: layout,
  dock: dock,
  activeId: dock.activeId,
  active: dock.panels[0],
})

assert.deepEqual(items.map(function (item) { return item.label }), ['Add Panel', 'Focus Panel', '', 'Panel', 'Toolbar'])

items.find(function (item) { return item.label === 'Focus Panel' }).onSelect()
assert.equal(aiditor.findDock(tree, 'dock-a').node.focused, true)

const panelMenu = items.find(function (item) { return item.label === 'Panel' })
assert.equal(panelMenu.items.find(function (item) { return item.label === 'Pin Active' }).disabled, false)
panelMenu.items.find(function (item) { return item.label === 'Pin Active' }).onSelect()
assert.equal(promoted, 'panel-a')

const removeWhenEmpty = panelMenu.items.find(function (item) { return item.label === 'Remove Dock When Empty' })
assert.equal(removeWhenEmpty.icon, 'check')
removeWhenEmpty.onSelect()
assert.equal(aiditor.findDock(tree, 'dock-a').node.removeWhenEmpty, false)

panelMenu.items.find(function (item) { return item.label === 'Close Active' }).onSelect()
assert.deepEqual(closeRequests.shift(), { ids: ['panel-a'], reason: 'close' })

panelMenu.items.find(function (item) { return item.label === 'Close Others' }).onSelect()
assert.deepEqual(closeRequests.shift(), { ids: ['panel-b'], reason: 'close-others' })

panelMenu.items.find(function (item) { return item.label === 'Close All' }).onSelect()
assert.deepEqual(closeRequests.shift(), { ids: ['panel-a', 'panel-b'], reason: 'close-all' })

let opened = null
aiditor.ui = { contextMenu: function (_, menuItems) { opened = menuItems } }
aiditor._dock.openDockMenu({ x: 0, y: 0 }, 'dock-a', Object.assign({}, layout, { dockMenu: false }))
assert.equal(opened, null)
aiditor._dock.openDockMenu({ x: 0, y: 0 }, 'dock-a', layout)
assert.equal(opened.length, 5)

console.log('dock menu tests ok')

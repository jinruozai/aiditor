import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/core/commands.js', 'utf8'), { filename: 'commands.js' })

const aiditor = window.aiditor
let ran = null

aiditor.commands.register('case.refresh', {
  title: 'Refresh',
  description: 'Refresh current state.',
  argumentHint: '[scope]',
  icon: 'refresh-cw',
  run: function (input, ctx) {
    ran = { input, ctx }
    return 'ok'
  },
}, { owner: 'extension:case', layer: 'app' })

aiditor.commands.registerMenu('case.refresh.menu', {
  target: 'dock.panel.context',
  command: 'case.refresh',
  order: 2,
}, { owner: 'extension:case', layer: 'app' })

aiditor.commands.register('case.extra', { run: function () {} })
aiditor.commands.registerMenu('case.extra.menu', { target: 'dock.panel.context', command: 'case.extra' })

assert.deepEqual(aiditor.commands.list({ owner: 'extension:case' }), ['case.refresh'])
assert.equal(aiditor.commands.meta('case.refresh').layer, 'app')
assert.equal(aiditor.commands.run('case.refresh', { id: 1 }, { actor: 'user' }), 'ok')
assert.deepEqual(ran.input, { id: 1 })
assert.equal(ran.ctx.command, 'case.refresh')

const menu = aiditor.commands.menuItems('dock.panel.context')
assert.equal(menu.length, 2)
const refreshMenu = menu.find(function (item) { return item.id === 'case.refresh.menu' })
assert.equal(refreshMenu.label, 'Refresh')
assert.equal(refreshMenu.name, 'case.refresh')
assert.equal(refreshMenu.description, 'Refresh current state.')
assert.equal(refreshMenu.argumentHint, '[scope]')
assert.equal(refreshMenu.icon, 'refresh-cw')

const uiItem = aiditor.commands.menuUiItems('dock.panel.context').find(function (item) { return item.id === 'case.refresh.menu' })
uiItem.onSelect()
assert.deepEqual(ran.input, {})

aiditor.commands.register('case.choice', {
  run: function (input, ctx) {
    ran = { input, ctx }
  },
}, { owner: 'extension:case', layer: 'app' })

aiditor.commands.registerMenu('case.parent.menu', {
  target: 'dock.panel.context',
  label: function (ctx) { return ctx.title },
  childrenTarget: 'case.children',
  order: 1,
}, { owner: 'extension:case', layer: 'app' })

aiditor.commands.registerMenu('case.child.menu', {
  target: 'case.children',
  command: 'case.choice',
  label: 'Child',
  input: function (ctx) { return { id: ctx.id } },
  disabled: function (ctx) { return ctx.locked },
}, { owner: 'extension:case', layer: 'app' })

const parent = aiditor.commands.menuUiItems('dock.panel.context', { title: 'Actions', id: 7, locked: false })
  .find(function (item) { return item.id === 'case.parent.menu' })
assert.equal(parent.label, 'Actions')
assert.equal(parent.items.length, 1)
assert.equal(parent.items[0].disabled, false)
parent.items[0].onSelect()
assert.deepEqual(ran.input, { id: 7 })

const lockedParent = aiditor.commands.menuUiItems('dock.panel.context', { title: 'Actions', id: 8, locked: true })
  .find(function (item) { return item.id === 'case.parent.menu' })
assert.equal(lockedParent.items[0].disabled, true)
assert.equal(lockedParent.items[0].onSelect, null)

aiditor.commands.unregisterOwner('extension:case')
assert.deepEqual(aiditor.commands.list({ owner: 'extension:case' }), [])
assert.equal(aiditor.commands.menuItems('dock.panel.context').length, 1)

assert.deepEqual(aiditor.commands.unregisterPrefix('case'), ['case.extra', 'case.extra.menu'])
assert.deepEqual(aiditor.commands.menuItems('dock.panel.context'), [])

console.log('commands tests ok')

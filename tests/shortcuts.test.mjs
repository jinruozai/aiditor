import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const memory = {}
const listeners = {}

Object.defineProperty(globalThis, 'navigator', {
  value: { platform: 'Win32' },
  configurable: true,
})

global.window = {
  aiditor: {},
  localStorage: {
    getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null },
    setItem(key, value) { memory[key] = String(value) },
    removeItem(key) { delete memory[key] },
  },
}

global.document = {
  addEventListener(type, fn) { listeners[type] = fn },
  removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type] },
}

vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/core/runtime.js', 'utf8'), { filename: 'runtime.js' })
vm.runInThisContext(readFileSync('src/core/shortcuts.js', 'utf8'), { filename: 'shortcuts.js' })
vm.runInThisContext(readFileSync('src/core/commands.js', 'utf8'), { filename: 'commands.js' })

const aiditor = window.aiditor

function element(opts = {}) {
  const el = {
    nodeName: opts.nodeName || opts.tagName || (opts.editable ? 'INPUT' : 'DIV'),
    tagName: opts.nodeName || opts.tagName || (opts.editable ? 'INPUT' : 'DIV'),
    type: opts.type || 'text',
    disabled: !!opts.disabled,
    isConnected: opts.isConnected !== false,
    parentElement: opts.parentElement || null,
    attributes: opts.attributes || {},
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn },
    removeEventListener(type, fn) { if (this.listeners[type] === fn) delete this.listeners[type] },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null },
    closest(selector) {
      if (selector.indexOf('input') >= 0 && this.editable) return this
      if (selector.indexOf('[contenteditable]') >= 0 && Object.prototype.hasOwnProperty.call(this.attributes, 'contenteditable')) return this
      if (selector.indexOf('[role="textbox"]') >= 0 && this.attributes.role === 'textbox') return this
      if (selector.indexOf('[role="searchbox"]') >= 0 && this.attributes.role === 'searchbox') return this
      if (selector.indexOf('.aiditor-ui-menu') >= 0 && this.menu) return this
      if (selector.indexOf('.aiditor-ui-modal') >= 0 && this.modal) return this
      return this.parentElement && this.parentElement.closest ? this.parentElement.closest(selector) : null
    },
  }
  if (opts.editable) el.editable = true
  if (opts.menu) el.menu = true
  if (opts.modal) el.modal = true
  return el
}

function keyEvent(key, opts = {}) {
  const ev = {
    key,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    target: opts.target || element(),
    defaultPrevented: !!opts.defaultPrevented,
    prevented: false,
    preventDefault() {
      this.prevented = true
      this.defaultPrevented = true
    },
  }
  return ev
}

function dispatch(ev) {
  assert.equal(typeof listeners.keydown, 'function')
  listeners.keydown(ev)
}

assert.equal(aiditor.shortcuts.normalizeKey('Shift+Ctrl+S'), 'Mod+Shift+S')
assert.equal(aiditor.shortcuts.normalizeKey('Ctrl+Shift+S'), 'Mod+Shift+S')
assert.equal(aiditor.shortcuts.normalizeKey('Cmd+S', { platform: 'MacIntel' }), 'Mod+S')
assert.equal(aiditor.shortcuts.normalizeKey('Ctrl+S', { platform: 'MacIntel' }), 'Ctrl+S')
assert.equal(aiditor.shortcuts.formatShortcut('Mod+Shift+S', { platform: 'MacIntel' }), '⌘⇧S')
assert.equal(aiditor.shortcuts.formatShortcut('Mod+Shift+S', { platform: 'Win32' }), 'Ctrl+Shift+S')
assert.equal(aiditor.shortcuts.risks('Mod+S')[0].code, 'browser_risky')

let ran = []
aiditor.commands.register('case.save', {
  run(input, ctx) { ran.push({ command: 'case.save', input, ctx }) },
}, { owner: 'test' })
aiditor.commands.register('case.other', {
  run(input, ctx) { ran.push({ command: 'case.other', input, ctx }) },
}, { owner: 'test' })
aiditor.commands.register('case.local', {
  run(input, ctx) { ran.push({ command: 'case.local', input, ctx }) },
}, { owner: 'test' })
aiditor.commands.register('case.dup', {
  run(input, ctx) { ran.push({ command: 'case.dup', input, ctx }) },
}, { owner: 'test' })
aiditor.commands.register('case.panel', {
  run(input, ctx) { ran.push({ command: 'case.panel', input, ctx }) },
}, { owner: 'test' })
aiditor.commands.register('case.global', {
  run(input, ctx) { ran.push({ command: 'case.global', input, ctx }) },
}, { owner: 'test' })
aiditor.commands.register('case.fallback', {
  run(input, ctx) { ran.push({ command: 'case.fallback', input, ctx }) },
}, { owner: 'test' })

aiditor.shortcuts.registerScope({ id: 'editor.panel', label: 'Editor Panel', owner: 'test' })
assert.deepEqual(aiditor.shortcuts.listScopes(), ['editor.panel'])
assert.equal(aiditor.shortcuts.scopeMeta('editor.panel').owner, 'test')

const panel = element()
const input = element({ parentElement: panel, editable: true })
const disposeSurface = aiditor.shortcuts.attachPanelSurface(panel, {
  panelId: 'panel-1',
  component: 'case.editor',
  scope: 'editor.panel',
  meta: { documentKey: 'doc-a' },
})

aiditor.shortcuts.register({
  id: 'case.save.shortcut',
  command: 'case.save',
  keys: ['Mod+S'],
  layer: 'panel',
  scope: 'editor.panel',
  editablePolicy: 'allow',
  args: { mode: 'quick' },
  owner: 'test',
}, { owner: 'test' })

dispatch(keyEvent('s', { ctrlKey: true, target: input }))
assert.equal(ran.length, 1)
assert.equal(ran[0].input.mode, 'quick')
assert.equal(ran[0].ctx.layer, 'editable')
assert.equal(ran[0].ctx.scope, 'editor.panel')
assert.equal(ran[0].ctx.target.panelId, 'panel-1')
assert.equal(ran[0].ctx.target.meta.documentKey, 'doc-a')

ran = []
assert.equal(aiditor.shortcuts.dispatchKey({
  key: 's',
  code: 'KeyS',
  phase: 'down',
  ctrlKey: true,
  repeat: true,
}, {
  layer: 'panel',
  panelId: 'panel-native',
  component: 'case.editor',
  scope: 'editor.panel',
  meta: { documentKey: 'doc-native' },
}), true)
assert.equal(ran.length, 1)
assert.equal(ran[0].ctx.event, null)
assert.equal(ran[0].ctx.input.code, 'KeyS')
assert.equal(ran[0].ctx.input.repeat, true)
assert.equal(ran[0].ctx.target.panelId, 'panel-native')
assert.equal(ran[0].ctx.target.meta.documentKey, 'doc-native')
assert.equal(aiditor.shortcuts.dispatchKey({ key: 's', phase: 'up', ctrlKey: true }), false)
assert.equal(ran.length, 1)

ran = []
assert.equal(aiditor.shortcuts.dispatchKey({
  type: 'keyDown',
  key: 's',
  code: 'KeyS',
  control: true,
  isAutoRepeat: false,
}, {
  layer: 'panel',
  scope: 'editor.panel',
}), true)
assert.equal(ran.length, 1)
assert.equal(ran[0].ctx.input.ctrlKey, true)
assert.equal(ran[0].ctx.input.repeat, false)
ran = []
assert.equal(aiditor.shortcuts.dispatchKey({ key: 's', code: 'KeyS' }, {
  layer: 'panel',
  scope: 'editor.panel',
}), false)
assert.equal(ran.length, 0)

aiditor.shortcuts.register({
  id: 'case.local.shortcut',
  command: 'case.local',
  keys: ['Mod+K'],
  layer: 'panel',
  scope: 'editor.panel',
  editablePolicy: 'local',
  owner: 'test',
}, { owner: 'test' })

const localEvent = keyEvent('k', { ctrlKey: true, target: input })
aiditor.shortcuts.markHandled(localEvent)
dispatch(localEvent)
assert.equal(ran.some(item => item.command === 'case.local'), false)

aiditor.shortcuts.register({
  id: 'case.block.editable.shortcut',
  command: 'case.local',
  keys: ['Mod+E'],
  layer: 'panel',
  scope: 'editor.panel',
  owner: 'test',
}, { owner: 'test' })
const richEditor = element({
  parentElement: panel,
  nodeName: 'DIV',
  attributes: { contenteditable: 'plaintext-only' },
})
dispatch(keyEvent('e', { ctrlKey: true, target: richEditor }))
assert.equal(ran.some(item => item.command === 'case.local'), false)

aiditor.shortcuts.register({
  id: 'case.other.shortcut',
  command: 'case.other',
  keys: ['Mod+A'],
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.updateUserOverride('case.other.shortcut', { keys: ['Mod+B'] })
dispatch(keyEvent('a', { ctrlKey: true }))
assert.equal(ran.some(item => item.command === 'case.other'), false)
dispatch(keyEvent('b', { ctrlKey: true }))
assert.equal(ran.some(item => item.command === 'case.other'), true)
assert.deepEqual(aiditor.shortcuts.getShortcutsForCommand('case.other'), ['Mod+B'])

aiditor.shortcuts.register({
  id: 'case.override.dup.shortcut',
  command: 'case.dup',
  keys: ['Mod+J'],
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.updateUserOverride('case.override.dup.shortcut', { keys: ['Ctrl+C', 'Mod+C'] })
assert.equal(aiditor.shortcuts.diagnostics({ code: 'equivalent_key' }).some(function (item) {
  return item.bindingIds && item.bindingIds[0] === 'case.override.dup.shortcut'
}), true)

aiditor.shortcuts.register({
  id: 'case.global.shortcut',
  command: 'case.global',
  keys: ['Mod+G'],
  source: 'user',
  priority: 100,
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.register({
  id: 'case.panel.shortcut',
  command: 'case.panel',
  keys: ['Mod+G'],
  layer: 'panel',
  scope: 'editor.panel',
  source: 'app',
  priority: 0,
  owner: 'test',
}, { owner: 'test' })
ran = []
dispatch(keyEvent('g', { ctrlKey: true, target: panel }))
assert.deepEqual(ran.map(item => item.command), ['case.panel'])
ran = []
dispatch(keyEvent('g', { ctrlKey: true }))
assert.deepEqual(ran.map(item => item.command), ['case.global'])

aiditor.commands.registerMenu('case.other.menu', { target: 'case.menu', command: 'case.other' }, { owner: 'test' })
assert.equal(aiditor.commands.menuUiItems('case.menu')[0].kbd, 'Ctrl+B')

aiditor.shortcuts.configureStorage({ namespace: 'case', schemaVersion: 2 })
await aiditor.shortcuts.save()
assert.equal(JSON.parse(memory['aiditor.shortcuts.case.v2'])['case.other.shortcut'].keys[0], 'Mod+B')
aiditor.shortcuts.resetAllOverrides()
assert.deepEqual(aiditor.shortcuts.getShortcutsForCommand('case.other'), ['Mod+A'])
await aiditor.shortcuts.load()
assert.deepEqual(aiditor.shortcuts.getShortcutsForCommand('case.other'), ['Mod+B'])

aiditor.shortcuts.register({
  id: 'case.missing.shortcut',
  command: 'case.missing',
  keys: ['Mod+R', 'Ctrl+R'],
  layer: 'panel',
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.register({
  id: 'case.fallback.shortcut',
  command: 'case.fallback',
  keys: ['Mod+R'],
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.register({
  id: 'case.missing.only.shortcut',
  command: 'case.missing',
  keys: ['Mod+I'],
  owner: 'test',
}, { owner: 'test' })
ran = []
const fallbackEvent = keyEvent('r', { ctrlKey: true, target: panel })
assert.doesNotThrow(function () { dispatch(fallbackEvent) })
assert.deepEqual(ran.map(item => item.command), ['case.fallback'])
assert.equal(fallbackEvent.defaultPrevented, true)
ran = []
const missingOnlyEvent = keyEvent('i', { ctrlKey: true })
assert.doesNotThrow(function () { dispatch(missingOnlyEvent) })
assert.deepEqual(ran, [])
assert.equal(missingOnlyEvent.defaultPrevented, false)
assert.equal(aiditor.shortcuts.isHandled(missingOnlyEvent), false)
aiditor.shortcuts.register({
  id: 'case.conflict.a',
  command: 'case.other',
  keys: ['Mod+Y'],
  layer: 'panel',
  scope: 'editor.panel',
  when: { component: 'conflict.a' },
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.register({
  id: 'case.conflict.b',
  command: 'case.other',
  keys: ['Mod+Y'],
  layer: 'panel',
  scope: 'editor.panel',
  when: { component: 'conflict.b', panelId: 'panel-b' },
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.register({
  id: 'case.conflict.c',
  command: 'case.other',
  keys: ['Mod+Y'],
  layer: 'panel',
  scope: 'editor.panel',
  when: { component: 'conflict.b' },
  owner: 'test',
}, { owner: 'test' })
aiditor.shortcuts.updateUserOverride('case.unknown.shortcut', { keys: ['Mod+U'] })
assert.throws(function () {
  aiditor.shortcuts.register({
    id: 'case.other.shortcut',
    command: 'case.other',
    keys: ['Mod+C'],
  })
}, /duplicate id/)
const codes = aiditor.shortcuts.diagnostics().map(item => item.code)
assert.equal(codes.includes('duplicate_binding'), true)
assert.equal(codes.includes('unknown_command'), true)
assert.equal(codes.includes('ambiguous_panel_scope'), true)
assert.equal(codes.includes('browser_reserved'), true)
assert.equal(codes.includes('equivalent_key'), true)
assert.equal(codes.includes('unknown_binding'), true)
assert.equal(codes.includes('global_key_overlap'), true)
assert.equal(aiditor.shortcuts.diagnostics({ code: 'key_conflict' }).some(function (item) {
  return item.bindingIds && item.bindingIds.indexOf('case.conflict.b') >= 0 && item.bindingIds.indexOf('case.conflict.c') >= 0
}), true)
assert.equal(aiditor.shortcuts.diagnostics({ code: 'global_key_overlap' }).some(function (item) {
  return item.bindingIds && item.bindingIds.indexOf('case.global.shortcut') >= 0 && item.bindingIds.indexOf('case.panel.shortcut') >= 0
}), true)

aiditor.shortcuts.register({
  id: 'case.after.duplicate',
  command: 'case.other',
  keys: ['Mod+M'],
  owner: 'test',
}, { owner: 'test' })
assert.equal(aiditor.shortcuts.diagnostics({ code: 'duplicate_binding' }).length, 0)

panel.listeners.pointerenter()
panel.isConnected = false
const staleHover = aiditor.shortcuts.context(keyEvent('x'))
assert.equal(staleHover.target.layer, 'global')

disposeSurface()
const afterDispose = aiditor.shortcuts.context(keyEvent('x', { target: input }))
assert.equal(afterDispose.target.layer, 'editable')
assert.equal(afterDispose.target.panelId, undefined)

const removed = aiditor.runtime.unloadOwner('test')
assert.equal(removed.shortcuts.includes('case.save.shortcut'), true)
assert.equal(removed.shortcuts.includes('editor.panel'), true)
assert.equal(aiditor.shortcuts.getBindings({ owner: 'test' }).length, 0)

console.log('shortcuts tests ok')

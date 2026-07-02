import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class ClassList {
  constructor(el) { this.el = el; this.items = new Set() }
  refresh() { this.items = new Set(String(this.el.className || '').split(/\s+/).filter(Boolean)) }
  add(cls) { this.refresh(); this.items.add(cls); this.sync() }
  remove(cls) { this.refresh(); this.items.delete(cls); this.sync() }
  contains(cls) { this.refresh(); return this.items.has(cls) }
  toggle(cls, force) {
    this.refresh()
    const next = force == null ? !this.items.has(cls) : !!force
    if (next) this.items.add(cls)
    else this.items.delete(cls)
    this.sync()
  }
  set(value) {
    this.items = new Set(String(value || '').split(/\s+/).filter(Boolean))
    this.sync()
  }
  sync() { this.el.className = Array.from(this.items).join(' ') }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.nodeName = this.tagName
    this.localName = String(tag).toLowerCase()
    this.children = []
    this.parentNode = null
    this.style = {}
    this.attributes = {}
    this.events = {}
    this.classList = new ClassList(this)
    this.className = ''
    this.textContent = ''
    this.value = ''
    this.hidden = false
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    this.children.push(child)
    child.parentNode = this
    return child
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  get firstChild() { return this.children[0] || null }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'class') this.classList.set(value)
    else this[name] = String(value)
  }
  removeAttribute(name) {
    delete this.attributes[name]
    if (name === 'class') this.classList.set('')
    else delete this[name]
  }
  addEventListener(type, fn) {
    if (!this.events[type]) this.events[type] = []
    this.events[type].push(fn)
  }
  dispatch(type, event) {
    const ev = event || {}
    ev.type = type
    if (!ev.target) ev.target = this
    const list = this.events[type] || []
    for (let i = 0; i < list.length; i++) list[i].call(this, ev)
    return ev
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) {
    const out = []
    const match = selector[0] === '.'
      ? function (el) { return String(el.className || '').split(/\s+/).indexOf(selector.slice(1)) >= 0 }
      : function (el) { return el.localName === selector.toLowerCase() }
    function visit(el) {
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i]
        if (match(child)) out.push(child)
        visit(child)
      }
    }
    visit(this)
    return out
  }
}

global.HTMLElement = FakeEl
global.document = {
  activeElement: null,
  createElement(tag) { return new FakeEl(tag) },
}
global.window = { aiditor: {} }
window.HTMLElement = FakeEl

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/bus.js',
  'src/core/names.js',
  'src/core/commands.js',
  'src/core/registry.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_edit-session.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui

ui.icon = function (opts) {
  const el = ui.h('span', 'aiditor-ui-icon')
  el.textContent = opts && opts.name || ''
  return el
}
ui.iconButton = function (opts) {
  const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' })
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}

vm.runInThisContext(readFileSync('src/ui/base/actionMenu.js', 'utf8'), { filename: 'src/ui/base/actionMenu.js' })
vm.runInThisContext(readFileSync('src/ui/base/actionBar.js', 'utf8'), { filename: 'src/ui/base/actionBar.js' })

for (const file of [
  'src/ui/form/input.js',
  'src/ui/form/searchInput.js',
  'src/ui/inspector.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

let formOptions = null
ui.PROP_GROUP_LABELS = { transform: 'Transform', render: 'Render' }
ui.propertyForm = function (opts) {
  formOptions = opts
  return ui.h('div', 'aiditor-ui-property-form')
}

vm.runInThisContext(readFileSync('src/ui/panel/inspector.js', 'utf8'), { filename: 'src/ui/panel/inspector.js' })

const selectionValue = {
  name: 'Fill Light',
  position: [0, 1, 2],
  rotation: [0, 0, 0],
  color: '#ffffff',
}
let inspectorFieldCtx = null

aiditor.inspector.registerProvider('case.light', {
  inspect() {
    return {
      title: 'Meta',
      subtitle: 'fill_light',
      actions: [{ id: 'add', icon: 'plus', label: 'Add' }],
      groups: {
        transform: { label: 'Transform', actions: [{ id: 'transform-menu', icon: 'more-vertical', label: 'Transform actions' }] },
      },
      groupActions: function (groupCtx) {
        return groupCtx.groupId === 'render'
          ? [{ id: 'render-menu', icon: 'more-vertical', label: 'Render actions' }]
          : null
      },
      fieldContextActions: function (fieldCtx) {
        inspectorFieldCtx = fieldCtx
        return [{ id: 'copy-field', label: 'Copy field', args: { field: fieldCtx.field } }]
      },
      schema: {
        name: { type: 'string', label: 'Name', desc: 'Readable display name' },
        position: { type: 'vector', label: 'Position', group: 'transform', desc: 'World space location' },
        rotation: { type: 'vector', label: 'Rotation', group: 'transform', desc: 'World rotation' },
        color: { type: 'color', label: 'Color', group: 'render', desc: 'Tint color' },
      },
      values: [selectionValue],
      write() {},
    }
  },
})

aiditor.inspector.registerProvider('case.custom', {
  inspect() {
    return {
      title: 'Custom',
      subtitle: 'renderer',
      render: function () { return ui.h('div', 'custom-inspector', { text: 'custom' }) },
    }
  },
})

const cleanups = []
const ctx = {
  panel: {},
  bus: aiditor.bus,
  onCleanup(fn) { cleanups.push(fn) },
}
aiditor.inspector.select({ type: 'case.light', id: 'fill_light' })
const root = aiditor.resolveComponent('inspector').factory(aiditor.signal({}), ctx)

const titleLine = root.querySelector('.aiditor-inspector-title-line')
const title = root.querySelector('.aiditor-inspector-title')
const subtitle = root.querySelector('.aiditor-inspector-subtitle')
assert.equal(title.parentNode, titleLine)
assert.equal(subtitle.parentNode, titleLine)
assert.equal(title.textContent, 'Meta')
assert.equal(subtitle.textContent, 'fill_light')
const actions = root.querySelector('.aiditor-inspector-actions')
assert.equal(actions.parentNode, titleLine)
assert.equal(actions.querySelectorAll('.aiditor-ui-icon-btn').length, 1)

const search = root.querySelector('.aiditor-inspector-search')
assert.equal(search.hidden, false)
assert.deepEqual(Object.keys(formOptions.schema.peek()), ['name', 'position', 'rotation', 'color'])
assert.equal(formOptions.groups.peek().transform.label, 'Transform')
assert.equal(formOptions.groups.peek().transform.actions.length, 1)
const groupActionCtx = formOptions.groupActionCtx({ groupId: 'render', label: 'Render', fields: ['color'], targets: [selectionValue], ctx: null })
assert.equal(groupActionCtx.source, 'inspector')
assert.equal(groupActionCtx.targets[0].id, 'fill_light')
assert.equal(groupActionCtx.primary.id, 'fill_light')
assert.equal(groupActionCtx.values[0], selectionValue)
assert.equal(formOptions.groupActions(groupActionCtx).length, 1)
const fieldActions = formOptions.fieldContextActions({
  field: 'name',
  label: 'Name',
  value: 'Fill Light',
  targets: [selectionValue],
  rawField: { type: 'string', label: 'Name' },
  resolvedField: { type: 'string' },
  ctx: { source: 'aiditor-inspector' },
})
assert.equal(fieldActions.length, 1)
assert.equal(inspectorFieldCtx.source, 'inspector')
assert.equal(inspectorFieldCtx.targets[0].id, 'fill_light')
assert.equal(inspectorFieldCtx.primary.id, 'fill_light')
assert.equal(inspectorFieldCtx.values[0], selectionValue)
assert.equal(inspectorFieldCtx.primaryValue, selectionValue)
assert.equal(inspectorFieldCtx.value, 'Fill Light')

const input = search.querySelector('input')
input.value = 'position'
input.dispatch('input', { target: input })
assert.deepEqual(Object.keys(formOptions.schema.peek()), ['position'])

input.value = 'Transform'
input.dispatch('input', { target: input })
assert.deepEqual(Object.keys(formOptions.schema.peek()), ['position', 'rotation'])

input.value = 'tint'
input.dispatch('input', { target: input })
assert.deepEqual(Object.keys(formOptions.schema.peek()), ['color'])

input.value = ''
input.dispatch('input', { target: input })
assert.deepEqual(Object.keys(formOptions.schema.peek()), ['name', 'position', 'rotation', 'color'])

aiditor.inspector.select({ type: 'case.custom', id: 'custom' })
assert.equal(search.hidden, true)

const formCss = readFileSync('src/style/ui-form.css', 'utf8')
const containerCss = readFileSync('src/style/ui-container.css', 'utf8')
assert.match(formCss, /\.aiditor-inspector-head\s*\{[\s\S]*?gap:\s*var\(--aiditor-space-1\);[\s\S]*?padding:\s*var\(--aiditor-space-2\);/)
assert.match(formCss, /\.aiditor-inspector-body\s*\{[\s\S]*?padding:\s*6px var\(--aiditor-space-2\) var\(--aiditor-space-2\);/)
assert.match(formCss, /\.aiditor-ui-property-section\s*\{[\s\S]*?border:\s*0;/)
assert.match(formCss, /\.aiditor-ui-property-section\s*>\s*\.aiditor-ui-section-head\s*\{[\s\S]*?border-radius:/)
assert.match(formCss, /\.aiditor-ui-property-section\s*>\s*\.aiditor-ui-section-body\s*\{[\s\S]*?background:\s*transparent;/)
assert.match(containerCss, /\.aiditor-ui-section\s*\{[\s\S]*?border:\s*var\(--aiditor-surface-border-w\) solid var\(--aiditor-border\);/)
assert.match(containerCss, /\.aiditor-ui-section-body\s*\{[\s\S]*?background:\s*var\(--aiditor-view-bg\);/)

cleanups.forEach(function (fn) { fn() })

console.log('inspector panel tests ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class ClassList {
  constructor(el) { this.el = el; this.items = new Set() }
  add(cls) { this.items.add(cls); this.sync() }
  remove(cls) { this.items.delete(cls); this.sync() }
  contains(cls) { return this.items.has(cls) }
  toggle(cls, force) {
    const next = force == null ? !this.items.has(cls) : !!force
    if (next) this.items.add(cls)
    else this.items.delete(cls)
    this.sync()
  }
  sync() { this.el._className = Array.from(this.items).join(' ') }
  set(value) {
    this.items = new Set(String(value || '').split(/\s+/).filter(Boolean))
    this.sync()
  }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.nodeName = this.tagName
    this.localName = String(tag).toLowerCase()
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.dataset = {}
    this.events = {}
    this.classList = new ClassList(this)
    this._className = ''
    this.textContent = ''
    this.value = ''
    this.disabled = false
    this.hidden = false
    this.readOnly = false
  }
  get className() { return this._className }
  set className(value) {
    this._className = String(value || '')
    if (this.classList) this.classList.items = new Set(this._className.split(/\s+/).filter(Boolean))
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
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child)
    const index = before ? this.children.indexOf(before) : -1
    if (index >= 0) this.children.splice(index, 0, child)
    else this.children.push(child)
    child.parentNode = this
    return child
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  replaceChildren() {
    while (this.children.length) this.removeChild(this.children[0])
    for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i])
  }
  get firstChild() { return this.children[0] || null }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'class') this.classList.set(value)
    else this[name] = String(value)
  }
  removeAttribute(name) {
    delete this.attributes[name]
    if (name === 'class') this.classList.set('')
  }
  addEventListener(type, fn) {
    if (!this.events[type]) this.events[type] = []
    this.events[type].push(fn)
  }
  removeEventListener(type, fn) {
    const list = this.events[type]
    if (!list) return
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  }
  dispatch(type, event) {
    const ev = event || {}
    ev.type = type
    if (!ev.target) ev.target = this
    const list = this.events[type] || []
    for (let i = 0; i < list.length; i++) list[i].call(this, ev)
    return ev
  }
  dispatchEvent(event) { return this.dispatch(event.type, event) }
  click(extra) {
    return this.dispatch('click', Object.assign({
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
    }, extra || {}))
  }
  focus() { document.activeElement = this }
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
  closest(selector) {
    let el = this
    while (el) {
      if (selector.indexOf(el.localName) >= 0) return el
      el = el.parentNode
    }
    return null
  }
}

global.HTMLElement = FakeEl
const documentEvents = {}
global.document = {
  activeElement: null,
  createElement(tag) { return new FakeEl(tag) },
  addEventListener(type, fn) {
    if (!documentEvents[type]) documentEvents[type] = []
    documentEvents[type].push(fn)
  },
  removeEventListener(type, fn) {
    const list = documentEvents[type]
    if (!list) return
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  },
  dispatch(type, event) {
    const ev = event || {}
    ev.type = type
    const list = documentEvents[type] || []
    for (let i = 0; i < list.length; i++) list[i](ev)
    return ev
  },
}
global.window = { aiditor: {} }
window.HTMLElement = FakeEl

for (const file of [
  'src/core/signal.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_edit-session.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui

aiditor.shortcuts = {
  markHandled(ev) { ev.__aiditorHandled = true },
}
ui.button = function (opts) {
  const el = ui.h('button', 'aiditor-ui-btn', { type: 'button' })
  if (opts && opts.text) el.textContent = opts.text
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.iconButton = function (opts) {
  const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' })
  if (opts && opts.title) el.setAttribute('title', opts.title)
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}

for (const file of [
  'src/ui/form/input.js',
  'src/ui/form/arrayEditor.js',
  'src/ui/form/arrayInput.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/schema.js',
  'src/ui/form/editorFor.js',
  'src/ui/form/structInput.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

function key(el, name, extra) {
  const ev = Object.assign({
    key: name,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }, extra || {})
  el.dispatch('keydown', ev)
  return ev
}

function ids(items) {
  return items.map(function (item) { return item.id })
}

function pointer(el, type, extra) {
  return el.dispatch(type, Object.assign({
    button: 0,
    clientY: 0,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }, extra || {}))
}

{
  const value = aiditor.signal(['red'])
  const el = ui.arrayInput({ value: value })
  el.querySelector('.aiditor-ui-array-editor-add').click()
  assert.deepEqual(value.peek(), ['red', ''])

  const input = el.querySelector('input')
  input.value = 'blue'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), ['blue', ''])

  el.querySelector('.aiditor-ui-icon-btn').click()
  assert.deepEqual(value.peek(), [''])
}

{
  const value = aiditor.signal(['red'])
  const readonly = aiditor.derived(function () { return value() })
  assert.throws(function () {
    ui.arrayInput({ value: readonly })
  }, /writable/)
  readonly.dispose()
}

{
  const value = aiditor.signal(['red'])
  const readonly = aiditor.derived(function () { return value() })
  const el = ui.arrayEditor({ items: readonly })
  assert.equal(el.querySelector('input').readOnly, true)
  readonly.dispose()
}

{
  const items = aiditor.signal([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])
  const selected = aiditor.signal([])
  const active = aiditor.signal(null)
  const el = ui.arrayEditor({
    items: items,
    selected: selected,
    active: active,
    getKey: function (item) { return item.id },
    selectionMode: 'multi',
    capabilities: { add: false, delete: true, duplicate: false, reorder: true },
    renderItem: function (_, __, ctx) {
      const label = aiditor.derived(function () { return ctx.value().label })
      const input = ui.input({
        value: label,
        onChange: function (v) { ctx.writeItem(Object.assign({}, ctx.value.peek(), { label: v })) },
      })
      ui.collect(input, label.dispose)
      return input
    },
  })
  el.querySelector('input').click()
  assert.deepEqual(selected.peek(), [])
  el.querySelector('.aiditor-ui-array-editor-index').click()
  assert.deepEqual(selected.peek(), ['a'])
  assert.equal(active.peek(), 'a')
}

{
  const items = aiditor.signal([{ id: 'a' }, { id: 'b' }])
  const selected = aiditor.signal([])
  const el = ui.arrayEditor({
    items: items,
    selected: selected,
    getKey: function (item) { return item.id },
    selectionMode: 'single',
    capabilities: { add: false, delete: false, duplicate: false, reorder: false },
    renderItem: function (item, index, ctx) {
      const label = ui.h('span', 'row-state')
      ui.bind(label, ctx.state.selected, function (v) { label.textContent = v ? 'selected' : 'idle' })
      return label
    },
  })
  assert.equal(el.querySelector('.row-state').textContent, 'idle')
  el.querySelector('.aiditor-ui-array-editor-index').click()
  assert.equal(el.querySelector('.row-state').textContent, 'selected')
}

{
  const items = aiditor.signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  const selected = aiditor.signal(['a'])
  const active = aiditor.signal('a')
  const el = ui.arrayEditor({
    items: items,
    selected: selected,
    active: active,
    getKey: function (item) { return item.id },
    selectionMode: 'multi',
    capabilities: { add: false, delete: false, duplicate: false, reorder: true },
    renderItem: function (item) { return ui.h('span', null, { text: item.id }) },
  })
  const ev = key(el, 'ArrowDown', { altKey: true })
  assert.equal(ev.defaultPrevented, true)
  assert.equal(ev.__aiditorHandled, true)
  assert.deepEqual(ids(items.peek()), ['b', 'a', 'c'])
  assert.deepEqual(selected.peek(), ['a'])
  assert.equal(active.peek(), 'a')
}

{
  const items = aiditor.signal([{ id: 'a' }, { id: 'b' }])
  const selected = aiditor.signal(['a', 'b'])
  const el = ui.arrayEditor({
    items: items,
    selected: selected,
    getKey: function (item) { return item.id },
    selectionMode: 'multi',
    capabilities: { add: false, delete: true, duplicate: false, reorder: false },
    canDeleteSelection: function () { return false },
    renderItem: function (item) { return ui.h('span', null, { text: item.id }) },
  })
  key(el, 'Delete')
  assert.deepEqual(ids(items.peek()), ['a', 'b'])
}

{
  const source = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const items = aiditor.signal(source)
  const selected = aiditor.signal(['b', 'c'])
  const active = aiditor.signal('b')
  let reorder = null
  const el = ui.arrayEditor({
    items: items,
    selected: selected,
    active: active,
    getKey: function (item) { return item.id },
    selectionMode: 'multi',
    capabilities: { add: false, delete: false, duplicate: false, reorder: true },
    onReorder: function (meta) {
      reorder = meta
      items.set(meta.nextItems)
    },
    renderItem: function (item) { return ui.h('span', null, { text: item.id }) },
  })
  key(el, 'ArrowDown', { altKey: true })
  assert.deepEqual(reorder.keys, ['b', 'c'])
  assert.deepEqual(reorder.indices, [1, 2])
  assert.equal(reorder.insertIndex, 2)
  assert.equal(reorder.insertBeforeKey, null)
  assert.deepEqual(ids(items.peek()), ['a', 'd', 'b', 'c'])
}

{
  const items = aiditor.signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  const previews = []
  let cancelled = null
  const el = ui.arrayEditor({
    items: items,
    getKey: function (item) { return item.id },
    selectionMode: 'multi',
    capabilities: { add: false, delete: false, duplicate: false, reorder: true },
    onPreviewReorder: function (_, __, meta) {
      previews.push(meta)
      return false
    },
    onCancel: function (meta) { cancelled = meta },
    renderItem: function (item) { return ui.h('span', null, { text: item.id }) },
  })
  const rows = el.querySelectorAll('.aiditor-ui-array-editor-row')
  for (let i = 0; i < rows.length; i++) {
    rows[i].getBoundingClientRect = function () { return { top: i * 10, height: 10 } }
  }
  const handle = rows[1].querySelector('.aiditor-ui-array-editor-index')
  pointer(handle, 'pointerdown', { clientY: 15 })
  document.dispatch('pointermove', {
    clientY: 17,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  })
  assert.equal(previews.length, 0)
  document.dispatch('pointermove', {
    clientY: 40,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  })
  assert.equal(previews.length, 1)
  assert.equal(el.classList.contains('is-drop-reject'), true)
  assert.ok(el.querySelector('.aiditor-ui-array-editor-drop-line'))
  document.dispatch('pointerup', { clientY: 40 })
  assert.equal(cancelled.insertIndex, 2)
  assert.deepEqual(ids(items.peek()), ['a', 'b', 'c'])
  assert.equal(documentEvents.pointermove.length, 0)
  assert.equal(documentEvents.pointerup.length, 0)
}

{
  const value = aiditor.signal(['a', 'b'])
  const el = ui.editorFor({
    type: 'array',
    type_render: 'array_editor',
    type_agv: { elem_type: 'string' },
  }, value, function (next) { value.set(next) })
  el.querySelector('.aiditor-ui-array-editor-index').click()
  assert.equal(el.querySelectorAll('.is-selected').length, 0)
  const ev = key(el, 'ArrowDown', { altKey: true })
  assert.equal(ev.defaultPrevented, false)
  assert.deepEqual(value.peek(), ['a', 'b'])
}

{
  const value = aiditor.signal([
    ['a', '1'],
    ['b', '2'],
  ])
  const el = ui.editorFor({
    type: 'array',
    type_agv: {
      elem_type: {
        type: 'struct',
        struct_def: {
          id: 'string',
          num: 'string',
        },
      },
    },
  }, value, function (next) { value.set(next) })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, 'a')
  assert.equal(inputs[1].value, '1')
  assert.equal(inputs[2].value, 'b')
  assert.equal(inputs[3].value, '2')
  inputs[3].value = '3'
  inputs[3].dispatch('input', { target: inputs[3] })
  assert.deepEqual(value.peek(), [
    ['a', '1'],
    ['b', '3'],
  ])
}

{
  const value = aiditor.signal([
    ['a', '1'],
    ['b', '2'],
  ])
  const writes = []
  const el = ui.editorFor({
    type: 'array',
    type_render: 'array_editor',
    type_agv: {
      elem_type: {
        type: 'struct',
        struct_def: {
          id: 'string',
          num: 'string',
        },
      },
    },
  }, value, function (next, meta) {
    writes.push({ next: next, change: meta && meta.change })
    value.set(next)
  }, { fieldPath: 'items' })
  const inputs = el.querySelectorAll('input')
  inputs[3].value = '4'
  inputs[3].dispatch('input', { target: inputs[3] })
  assert.deepEqual(writes.at(-1).change, { field: 'items[1].num', mode: 'path', value: '4' })
  assert.deepEqual(value.peek(), [
    ['a', '1'],
    ['b', '4'],
  ])
}

{
  const css = readFileSync('src/style/ui-form.css', 'utf8')
  assert.match(
    css,
    /\.aiditor-ui-array-editor-row\s*{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\) auto;/s,
    'arrayEditor row chrome must size to content instead of a fixed label column'
  )
  assert.match(
    css,
    /\.aiditor-ui-array-editor-row\s*{[^}]*gap:\s*2px;/s,
    'arrayEditor row chrome must keep a tight gap between index, item, and actions'
  )
  assert.match(
    css,
    /\.aiditor-ui-array-editor-index\s*{[^}]*min-width:\s*0;/s,
    'arrayEditor index button must not reserve a wide fixed minimum'
  )
  assert.match(
    css,
    /\.aiditor-ui-array-editor-index\s*{[^}]*padding:\s*0 2px;/s,
    'arrayEditor index button must only keep minimal horizontal padding'
  )
  assert.match(
    css,
    /\.aiditor-ui-array-editor-index-none \.aiditor-ui-array-editor-row\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    'arrayEditor indexMode none must remove the index column entirely'
  )
  assert.match(
    css,
    /\.aiditor-ui-array-editor-cell > \.aiditor-ui-struct-input \.aiditor-ui-struct-input-row\s*{[^}]*grid-template-columns:\s*minmax\(36px, 48px\) minmax\(0, 1fr\);/s,
    'nested structInput inside arrayEditor must use a compact label column'
  )
}

console.log('array-editor tests passed')

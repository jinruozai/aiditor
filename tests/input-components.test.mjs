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
  sync() { this.el.className = Array.from(this.items).join(' ') }
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
    this.style = {}
    this.attributes = {}
    this.dataset = {}
    this.events = {}
    this.classList = new ClassList(this)
    this.className = ''
    this.textContent = ''
    this.innerHTML = ''
    this.value = ''
    this.disabled = false
    this.hidden = false
    this.readOnly = false
    this.selectionStart = 0
    this.selectionEnd = 0
    this.scrollTop = 0
    this.scrollLeft = 0
    this.files = []
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
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null }
  removeAttribute(name) {
    delete this.attributes[name]
    if (name === 'class') this.classList.set('')
  }
  toggleAttribute(name, force) {
    const next = force == null ? !this.attributes[name] : !!force
    if (next) this.setAttribute(name, '')
    else this.removeAttribute(name)
    return next
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
  click() {
    return this.dispatch('click', {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
    })
  }
  focus() {
    document.activeElement = this
    this.dispatch('focus', { target: this })
  }
  blur() {
    if (document.activeElement === this) document.activeElement = null
    this.dispatch('blur', { target: this })
  }
  select() {
    this.selectionStart = 0
    this.selectionEnd = String(this.value || '').length
  }
  setPointerCapture() {}
  releasePointerCapture() {}
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

const created = []
global.HTMLElement = FakeEl
global.document = {
  activeElement: null,
  body: new FakeEl('body'),
  createElement(tag) {
    const el = new FakeEl(tag)
    created.push(el)
    return el
  },
}
global.requestAnimationFrame = function (fn) { fn() }

const revoked = []
let urlIndex = 0
global.URL = {
  createObjectURL(file) { return 'blob:' + file.name + ':' + (++urlIndex) },
  revokeObjectURL(url) { revoked.push(url) },
}

global.window = { aiditor: {}, EyeDropper: undefined }
window.HTMLElement = FakeEl
window.URL = global.URL

for (const file of [
  'src/core/signal.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_edit-session.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui

aiditor.safeCall = function (_, fn) { return fn() }
aiditor.reportError = function () {}
const commandRuns = []
aiditor.commands = {
  run(id, input, ctx) { commandRuns.push({ id, input, ctx }) },
}
aiditor.shortcuts = {
  markHandled(ev) { ev.__aiditorHandled = true },
}
ui.icon = function (opts) {
  const el = ui.h('span', 'aiditor-ui-icon')
  el.textContent = opts && (opts.name && opts.name.peek ? opts.name.peek() : opts.name) || ''
  return el
}
ui.iconButton = function (opts) {
  const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' })
  if (opts && opts.title) el.setAttribute('title', opts.title)
  if (opts && opts.disabled) el.disabled = true
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.button = function (opts) {
  const el = ui.h('button', 'aiditor-ui-btn', { type: 'button' })
  if (opts && opts.text) el.textContent = opts.text
  if (opts && opts.disabled) el.disabled = true
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.tag = function (opts) {
  const el = ui.h('span', 'aiditor-ui-tag', { text: opts && opts.text || '' })
  if (opts && opts.onClose) {
    const close = ui.h('button', 'aiditor-ui-tag-close', { type: 'button' })
    close.addEventListener('click', opts.onClose)
    el.appendChild(close)
  }
  return el
}
ui.dropzone = function (el, opts) { el.__dropzone = opts; return function () {} }
ui.dragsource = function (el, opts) { el.__dragsource = opts; return function () {} }
ui.segmented = function (opts) {
  const el = ui.h('div', 'aiditor-ui-seg')
  const value = opts && opts.value
  const options = opts && opts.options || []
  options.forEach(function (option) {
    const btn = ui.h('button', 'aiditor-ui-seg-btn', { type: 'button', text: option.label || option.value })
    btn.addEventListener('click', function () { if (value && value.set) value.set(option.value) })
    el.appendChild(btn)
  })
  return el
}
ui.attachDrag = function () { return function () {} }
ui.popover = function (opts) {
  document.body.appendChild(opts.content)
  return {
    close() {
      ui.dispose(opts.content)
      if (opts.onDismiss) opts.onDismiss()
    },
  }
}
const openedMenus = []
let closedMenuCount = 0
ui.menu = function (opts) {
  const record = Object.assign({ closed: false }, opts)
  record.close = function () {
    if (record.closed) return
    record.closed = true
    closedMenuCount++
    if (opts.onDismiss) opts.onDismiss()
  }
  openedMenus.push(record)
  return record
}

for (const file of [
  'src/ui/form/input.js',
  'src/ui/form/searchInput.js',
  'src/ui/form/numberInput.js',
  'src/ui/form/tagInput.js',
  'src/ui/form/colorInput.js',
  'src/ui/form/vectorInput.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/schema.js',
  'src/ui/form/structInput.js',
  'src/ui/base/actionMenu.js',
  'src/ui/base/actionBar.js',
  'src/ui/form/dictInput.js',
  'src/ui/form/arrayEditor.js',
  'src/ui/form/arrayInput.js',
  'src/ui/form/editorFor.js',
  'src/ui/container/section.js',
  'src/ui/form/propertyForm.js',
  'src/ui/inspector.js',
  'src/ui/form/propertyList.js',
  'src/ui/editor/codeInput.js',
  'src/ui/editor/filePathInput.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

function key(el, name, extra) {
  const ev = Object.assign({
    key: name,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }, extra || {})
  el.dispatch('keydown', ev)
  return ev
}

function contextmenu(el, target, extra) {
  const ev = Object.assign({
    target: target || el,
    clientX: 10,
    clientY: 20,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
  }, extra || {})
  el.dispatch('contextmenu', ev)
  return ev
}

{
  const value = aiditor.signal('a')
  const el = ui.codeInput({ value })
  const ta = el.querySelector('textarea')
  assert.equal(ta.wrap, 'off')
  ta.selectionStart = 1
  ta.selectionEnd = 1
  const ev = key(ta, 'Tab')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(ev.__aiditorHandled, true)
  assert.equal(value.peek(), 'a  ')
  assert.equal(ta.selectionStart, 3)
}

{
  const value = aiditor.signal('a\nb')
  const el = ui.codeInput({ value })
  const ta = el.querySelector('textarea')
  ta.selectionStart = 0
  ta.selectionEnd = ta.value.length
  key(ta, 'Tab')
  assert.equal(value.peek(), '  a\n  b')
  ta.selectionStart = 0
  ta.selectionEnd = ta.value.length
  key(ta, 'Tab', { shiftKey: true })
  assert.equal(value.peek(), 'a\nb')
}

{
  ui.registerRenderer('test_vector_column', function (a) {
    return ui.vectorInput({ value: a.sig, onChange: a.write, layout: 'column' })
  }, { replace: true })
  const targets = aiditor.signal([{
    name: 'Node',
    transform: [
      [0, 0, 0],
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
    ],
  }])
  const form = ui.propertyForm({
    targets,
    schema: {
      name: { type: 'string' },
      transform: {
        type: 'struct',
        label: false,
        group: 'geometry',
        struct_def: {
          position: { type: 'var', type_render: 'test_vector_column' },
          nested: {
            type: 'struct',
            struct_def: {
              rotation: { type: 'var', type_render: 'test_vector_column' },
              scale:    { type: 'var', type_render: 'test_vector_column' },
            },
          },
        },
      },
    },
  })
  const allStructs = form.querySelectorAll('.aiditor-ui-struct-input')
  const topStructs = form.querySelectorAll('.aiditor-ui-property-form-struct')
  const topRows = form.querySelectorAll('.aiditor-ui-struct-input-row')
  const hiddenRows = form.querySelectorAll('.aiditor-ui-struct-input-row-label-hidden')
  const nestedStructs = allStructs.filter(function (el) {
    return !el.classList.contains('aiditor-ui-property-form-struct')
  })
  assert.equal(topStructs.length, 2)
  assert.ok(nestedStructs.length >= 2)
  assert.equal(form.querySelectorAll('.aiditor-ui-property-section').length, 1)
  assert.equal(topRows[0].classList.contains('aiditor-ui-struct-input-row-label-visible'), true)
  assert.equal(hiddenRows.length, 1)
  assert.equal(hiddenRows[0].children[0].classList.contains('aiditor-ui-struct-input-label-hidden'), true)
  assert.equal(hiddenRows[0].children[1].classList.contains('aiditor-ui-struct-input-cell'), true)
  assert.ok(form.querySelector('.aiditor-ui-vec-column'))
  assert.equal(form.querySelectorAll('.aiditor-ui-vec-axis-field').length, 9)
}

{
  commandRuns.length = 0
  const targets = aiditor.signal([{ a: 1, b: 2, c: 3 }])
  const groups = aiditor.signal({
    static: {
      label: 'Static',
      actions: [{
        id: 'static',
        icon: 'more-vertical',
        label: 'Static action',
        command: 'case.static',
        args: function (ctx) { return { owner: ctx.owner, count: ctx.targets.length } },
      }],
    },
    empty: {
      label: 'Empty',
      actions: [{ id: 'hidden-by-empty-array', icon: 'more-vertical', label: 'Hidden' }],
    },
  })
  const form = ui.propertyForm({
    targets,
    schema: {
      a: { type: 'string', group: 'static' },
      b: { type: 'string', group: 'override' },
      c: { type: 'string', group: 'empty' },
    },
    groups,
    groupActions: function (groupCtx) {
      if (groupCtx.groupId === 'override') {
        return [{ id: 'override', icon: 'more-vertical', label: 'Override action' }]
      }
      if (groupCtx.groupId === 'empty') return []
      return null
    },
    groupActionCtx: function (groupCtx) {
      return Object.assign({}, groupCtx, { owner: 'mapped' })
    },
  })
  const sections = form.querySelectorAll('.aiditor-ui-property-section')
  assert.equal(sections.length, 3)
  assert.equal(form.querySelectorAll('.aiditor-ui-icon-btn').length, 2)
  assert.ok(sections[0].querySelector('.aiditor-ui-section-head'))
  assert.ok(sections[0].querySelector('.aiditor-ui-section-toggle'))
  assert.ok(sections[0].querySelector('.aiditor-ui-section-actions'))
  sections[0].querySelector('.aiditor-ui-icon-btn').click()
  assert.deepEqual(commandRuns[0].input, { owner: 'mapped', count: 1 })
  assert.equal(commandRuns[0].ctx.groupId, 'static')
  assert.equal(sections[2].querySelector('.aiditor-ui-icon-btn'), null)
  const staticBody = sections[0].querySelector('.aiditor-ui-section-body')
  groups.set({
    static: {
      label: 'Static Updated',
      actions: [{ id: 'static-next', icon: 'more-vertical', label: 'Static next' }],
    },
  })
  assert.equal(sections[0].querySelector('.aiditor-ui-section-body'), staticBody)
  assert.equal(sections[0].querySelector('.aiditor-ui-section-title').textContent, 'Static Updated')
  const sectionCss = readFileSync('src/style/ui-container.css', 'utf8')
  assert.match(sectionCss, /\.aiditor-ui-section-head\s*\{[\s\S]*?width:\s*100%;[\s\S]*?padding:\s*0 var\(--aiditor-space-2\);[\s\S]*?box-sizing:\s*border-box;/)
  assert.match(sectionCss, /\.aiditor-ui-section-toggle\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?min-width:\s*0;/)
  assert.match(sectionCss, /\.aiditor-ui-section-actions\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-width:\s*0;/)
}

{
  commandRuns.length = 0
  const targets = aiditor.signal([{ a: 'one', b: 'two', c: 'three' }])
  const form = ui.propertyForm({
    targets,
    schema: {
      a: {
        type: 'string',
        actions: [{
          id: 'schema-action',
          icon: 'edit',
          title: 'Schema action',
          command: 'case.schemaAction',
          args: function (ctx) { return { field: ctx.field, value: ctx.value } },
        }],
      },
      b: { type: 'string' },
      c: { type: 'string', label: false },
    },
    fieldActions: function (fieldCtx) {
      if (fieldCtx.field === 'b') {
        return [{ id: 'field-action', icon: 'edit', title: 'Field action', command: 'case.fieldAction' }]
      }
      return null
    },
  })
  const rows = form.querySelectorAll('.aiditor-ui-struct-input-row')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].classList.contains('aiditor-ui-struct-input-row-has-actions'), true)
  assert.equal(rows[0].classList.contains('aiditor-ui-struct-input-row-actions-empty'), false)
  assert.equal(rows[1].classList.contains('aiditor-ui-struct-input-row-has-actions'), true)
  assert.equal(rows[1].classList.contains('aiditor-ui-struct-input-row-actions-empty'), false)
  assert.equal(rows[2].classList.contains('aiditor-ui-struct-input-row-label-hidden'), true)
  assert.equal(rows[2].classList.contains('aiditor-ui-struct-input-row-has-actions'), true)
  assert.equal(rows[2].classList.contains('aiditor-ui-struct-input-row-actions-empty'), true)
  assert.equal(form.querySelectorAll('.aiditor-ui-struct-input-actions').length, 3)
  assert.equal(form.querySelectorAll('.aiditor-ui-icon-btn').length, 2)
  form.querySelectorAll('.aiditor-ui-icon-btn')[0].click()
  assert.deepEqual(commandRuns[0].input, { field: 'a', value: 'one' })
  assert.equal(commandRuns[0].ctx.field, 'a')
}

{
  const changed = []
  const targets = aiditor.signal([{ name: 'custom', compact: 'changed' }])
  const form = ui.propertyForm({
    targets,
    defaults: { name: 'default', compact: 'base' },
    schema: {
      name: { type: 'string', label: 'Name' },
      compact: { type: 'string', label: false },
    },
    onChange: function (field, value, editedTargets, meta) {
      changed.push({ field, value, mode: meta.change.mode })
      targets.set(editedTargets.map(function (item) {
        const next = Object.assign({}, item)
        next[field] = value
        return next
      }))
    },
  })
  const rows = form.querySelectorAll('.aiditor-ui-struct-input-row')
  assert.equal(rows[0].classList.contains('aiditor-ui-struct-input-row-has-label-actions'), true)
  assert.equal(rows[1].classList.contains('aiditor-ui-struct-input-row-label-hidden'), true)
  assert.equal(rows[1].classList.contains('aiditor-ui-struct-input-row-has-label-actions'), true)
  assert.equal(rows[0].children[0].classList.contains('aiditor-ui-struct-input-label'), true)
  assert.equal(rows[0].children[0].querySelectorAll('.aiditor-ui-icon-btn').length, 1)
  assert.equal(rows[0].children[1].querySelectorAll('.aiditor-ui-icon-btn').length, 0)
  assert.equal(rows[1].children[0].querySelectorAll('.aiditor-ui-icon-btn').length, 1)
  rows[0].children[0].querySelector('.aiditor-ui-icon-btn').click()
  assert.deepEqual(changed[0], { field: 'name', value: 'default', mode: 'path' })
  assert.equal(targets.peek()[0].name, 'default')
}

{
  commandRuns.length = 0
  openedMenus.length = 0
  const seen = []
  const targets = aiditor.signal([{ a: 'one', b: 'two' }])
  const form = ui.propertyForm({
    targets,
    schema: {
      a: { type: 'string', label: 'Alpha' },
      b: { type: 'string', label: 'Beta' },
    },
    ctx: function (field) { return { source: 'test-form', field } },
    fieldContextActions: function (fieldCtx) {
      seen.push(fieldCtx)
      if (fieldCtx.field !== 'a') return []
      return [{
        id: 'copy',
        label: 'Copy Value',
        icon: 'copy',
        command: 'case.fieldAction',
        args: function (ctx) { return { field: ctx.field, value: ctx.value, source: ctx.ctx.source } },
      }]
    },
  })
  const rows = form.querySelectorAll('.aiditor-ui-struct-input-row')
  const labels = form.querySelectorAll('.aiditor-ui-struct-input-label')
  const ev = contextmenu(rows[0], labels[0], { clientX: 32, clientY: 48 })
  assert.equal(ev.defaultPrevented, true)
  assert.equal(ev.propagationStopped, true)
  assert.equal(openedMenus.length, 1)
  assert.deepEqual(openedMenus[0].point, { x: 32, y: 48 })
  assert.equal(openedMenus[0].items[0].label, 'Copy Value')
  assert.equal(seen[0].field, 'a')
  assert.equal(seen[0].label, 'Alpha')
  assert.equal(seen[0].value, 'one')
  assert.equal(seen[0].resolvedField.type, 'string')
  openedMenus[0].items[0].onSelect()
  assert.deepEqual(commandRuns.at(-1).input, { field: 'a', value: 'one', source: 'test-form' })

  const emptyEv = contextmenu(rows[1], labels[1])
  assert.equal(emptyEv.defaultPrevented, false)
  assert.equal(openedMenus.length, 1)

  const inputEv = contextmenu(rows[0], rows[0].querySelector('input'))
  assert.equal(inputEv.defaultPrevented, false)
  assert.equal(openedMenus.length, 1)
}

{
  openedMenus.length = 0
  closedMenuCount = 0
  const form = ui.propertyForm({
    targets: aiditor.signal([{ a: 'one', b: 'two' }]),
    schema: {
      a: { type: 'string', label: 'Alpha' },
      b: { type: 'string', label: 'Beta' },
    },
    fieldContextActions: function (fieldCtx) {
      return [{ id: 'ctx-' + fieldCtx.field, label: 'Menu ' + fieldCtx.field, command: 'case.fieldAction' }]
    },
  })
  const rows = form.querySelectorAll('.aiditor-ui-struct-input-row')
  const labels = form.querySelectorAll('.aiditor-ui-struct-input-label')
  contextmenu(rows[0], labels[0])
  assert.equal(openedMenus.length, 1)
  assert.equal(openedMenus[0].behavior, 'context')
  assert.equal(openedMenus[0].closed, false)
  contextmenu(rows[0], labels[0])
  assert.equal(openedMenus.length, 2)
  assert.equal(openedMenus[0].closed, true)
  assert.equal(openedMenus[1].closed, false)
  assert.equal(closedMenuCount, 1)
  contextmenu(rows[1], labels[1])
  assert.equal(openedMenus.length, 3)
  assert.equal(openedMenus[1].closed, true)
  assert.equal(openedMenus[2].closed, false)
  assert.equal(closedMenuCount, 2)
  openedMenus[2].close()
  assert.equal(closedMenuCount, 3)
  contextmenu(rows[0], labels[0])
  assert.equal(openedMenus.length, 4)
  assert.equal(closedMenuCount, 3)
}

{
  openedMenus.length = 0
  let resolveActions
  const form = ui.propertyForm({
    targets: aiditor.signal([{ a: 'one' }]),
    schema: { a: { type: 'string' } },
    fieldContextActions: function () {
      return new Promise(function (resolve) { resolveActions = resolve })
    },
  })
  const row = form.querySelector('.aiditor-ui-struct-input-row')
  const ev = contextmenu(row, row.querySelector('.aiditor-ui-struct-input-label'))
  assert.equal(ev.defaultPrevented, true)
  assert.equal(openedMenus.length, 1)
  assert.equal(openedMenus[0].items[0].type, 'header')
  assert.equal(openedMenus[0].items[0].label, 'Loading...')
  resolveActions([{ id: 'loaded', label: 'Loaded', command: 'case.fieldAction' }])
  await new Promise(function (resolve) { setTimeout(resolve, 0) })
  assert.equal(openedMenus.length, 2)
  assert.equal(openedMenus[1].items[0].label, 'Loaded')
}

{
  commandRuns.length = 0
  const items = aiditor.signal([
    { id: 'first', title: 'First', meta: 'string', value: { key: 'first', type: 'string' } },
    { id: 'second', title: 'Second', meta: 'int', value: { key: 'second', type: 'int' } },
  ])
  const changes = []
  const list = ui.propertyList({
    items,
    getKey: function (item) { return item.id },
    title: function (itemCtx) { return itemCtx.value.key },
    meta: function (itemCtx) { return itemCtx.value.type },
    schema: {
      key: { type: 'string' },
      type: { type: 'string', actions: [{ id: 'edit-type', icon: 'edit', command: 'case.editType' }] },
    },
    actions: function (itemCtx) {
      return [{ id: 'delete', icon: 'trash', variant: 'danger', command: 'case.delete', args: { id: itemCtx.id } }]
    },
    fieldActions: function (fieldCtx) {
      if (fieldCtx.field === 'key') return [{ id: 'edit-key', icon: 'edit', command: 'case.editKey' }]
      return null
    },
    onFieldChange: function (itemId, field, value) {
      changes.push({ itemId: itemId, field: field, value: value })
    },
  })
  const sections = list.querySelectorAll('.aiditor-ui-property-list-item')
  assert.equal(sections.length, 2)
  const firstSection = sections[0]
  const firstInput = firstSection.querySelector('input')
  firstInput.focus()
  items.set([
    { id: 'second', title: 'Second+', meta: 'int+', value: { key: 'second', type: 'int+' } },
    { id: 'first', title: 'First+', meta: 'string+', value: { key: 'first+', type: 'string+' } },
  ])
  const reordered = list.querySelectorAll('.aiditor-ui-property-list-item')
  assert.equal(reordered[1], firstSection)
  assert.equal(reordered[1].querySelector('input'), firstInput)
  assert.equal(document.activeElement, firstInput)
  assert.equal(reordered[1].querySelector('.aiditor-ui-section-title').textContent, 'first+')
  assert.equal(reordered[1].querySelector('.aiditor-ui-section-meta').textContent, 'string+')
  firstInput.value = 'first-edited'
  firstInput.dispatch('input', { target: firstInput })
  assert.deepEqual(changes[0], { itemId: 'first', field: 'key', value: 'first-edited' })
  reordered[1].querySelectorAll('.aiditor-ui-icon-btn')[0].click()
  assert.equal(commandRuns.at(-1).id, 'case.delete')
  assert.deepEqual(commandRuns.at(-1).input, { id: 'first' })
  assert.equal(reordered[1].querySelectorAll('.aiditor-ui-icon-btn').length, 3)
}

{
  const value = aiditor.signal({ a: 1, b: 2, c: 3 })
  const el = ui.structInput({
    value,
    fields: [
      { key: 'a', label: 'A', editor: function (sig, write) { return ui.input({ value: sig, onChange: write }) } },
      { key: 'b', label: false, editor: function (sig, write) { return ui.input({ value: sig, onChange: write }) } },
      { key: 'c', labelMode: 'sr-only', label: 'Hidden C', editor: function (sig, write) { return ui.input({ value: sig, onChange: write }) } },
    ],
  })
  assert.equal(el.querySelectorAll('.aiditor-ui-struct-input-row-label-visible').length, 1)
  assert.equal(el.querySelectorAll('.aiditor-ui-struct-input-row-label-hidden').length, 1)
  assert.equal(el.querySelectorAll('.aiditor-ui-struct-input-row-label-sr-only').length, 1)
}

{
  const targets = aiditor.signal([{ transform: [['1', '2'], 'enabled'] }])
  const messages = aiditor.signal({
    'transform.pos.x': [{ kind: 'error', message: 'X is required.', code: 'required' }],
  })
  const form = ui.propertyForm({
    targets,
    fieldMessages: messages,
    schema: {
      transform: {
        type: 'struct',
        struct_def: {
          pos: {
            type: 'struct',
            struct_def: { x: 'string', y: 'string' },
          },
          state: 'string',
        },
      },
    },
  })
  const input = form.querySelector('input')
  const messageBox = form.querySelector('.aiditor-ui-field-messages')
  assert.equal(messageBox.querySelector('.aiditor-ui-field-message-error').textContent, 'X is required.')
  assert.equal(input.attributes['aria-invalid'], 'true')
  assert.equal(input.attributes['aria-describedby'], messageBox.id)
  input.focus()

  messages.set({ 'transform.pos.x': [{ kind: 'warning', message: 'Check X.' }] })
  assert.equal(form.querySelector('input'), input)
  assert.equal(document.activeElement, input)
  assert.equal(messageBox.querySelector('.aiditor-ui-field-message-warning').textContent, 'Check X.')
  assert.equal(input.attributes['aria-invalid'], undefined)

  messages.set({})
  assert.equal(messageBox.hidden, true)
  assert.equal(input.attributes['aria-describedby'], undefined)
}

{
  const targets = aiditor.signal([{
    transform: [
      [1, 2, 3],
      [4, 5, 6],
      [1, 1, 1],
    ],
  }])
  const form = ui.propertyForm({
    targets,
    schema: {
      transform: {
        type: 'struct',
        label: 'Transform',
        fieldLayout: 'block',
        struct_def: {
          pos: { type: 'var', type_render: 'test_vector_column' },
          rot: { type: 'var', type_render: 'test_vector_column' },
          scale: { type: 'var', type_render: 'test_vector_column' },
        },
      },
    },
  })
  const row = form.querySelector('.aiditor-ui-struct-input-row')
  assert.equal(row.classList.contains('aiditor-ui-struct-input-row-layout-block'), true)
  assert.equal(row.children[0].querySelector('.aiditor-ui-struct-input-label-text').textContent, 'Transform')
  assert.equal(row.children[1].classList.contains('aiditor-ui-struct-input-cell'), true)
  assert.ok(row.children[1].querySelector('.aiditor-ui-struct-input'))
  assert.equal(form.querySelectorAll('.aiditor-ui-vec-axis-field').length, 9)
}

{
  const value = aiditor.signal({ transform: [[1, 2, 3]] })
  const el = ui.structInput({
    value,
    fields: [{
      key: 'transform',
      label: 'Transform',
      fieldLayout: 'section',
      defaultCollapsed: true,
      editor: function () { return ui.h('div', 'inner-editor') },
    }],
  })
  const row = el.querySelector('.aiditor-ui-struct-input-row')
  const toggle = el.querySelector('.aiditor-ui-struct-input-section-toggle')
  assert.equal(row.classList.contains('aiditor-ui-struct-input-row-layout-section'), true)
  assert.equal(row.classList.contains('aiditor-ui-struct-input-row-collapsed'), true)
  assert.equal(toggle.attributes['aria-expanded'], 'false')
  toggle.click()
  assert.equal(row.classList.contains('aiditor-ui-struct-input-row-collapsed'), false)
  assert.equal(toggle.attributes['aria-expanded'], 'true')
}

{
  const value = aiditor.signal({ hidden: 1 })
  const el = ui.structInput({
    value,
    fields: [{
      key: 'hidden',
      label: false,
      fieldLayout: 'section',
      editor: function (sig, write) { return ui.input({ value: sig, onChange: write }) },
    }],
  })
  const row = el.querySelector('.aiditor-ui-struct-input-row')
  assert.equal(row.classList.contains('aiditor-ui-struct-input-row-layout-block'), true)
  assert.equal(el.querySelectorAll('.aiditor-ui-struct-input-section-toggle').length, 0)
}

{
  assert.deepEqual(ui.resolveType('struct').default, [])
}

{
  assert.equal(ui.resolveType('vec2').base_type, 'struct')
  assert.equal(ui.resolveType('vec3').type_render, 'vector')
  assert.deepEqual(ui.resolveType('vec4').default, [0, 0, 0, 0])
  assert.deepEqual(Object.keys(ui.resolveType('vec3').struct_def), ['x', 'y', 'z'])
  assert.deepEqual(ui.resolveType('vec2').support_render, ['vector', 'struct'])
  assert.deepEqual(ui.resolveType('vec3').support_render, ['vector', 'struct', 'color'])
  assert.deepEqual(ui.resolveType('vec4').support_render, ['vector', 'struct', 'color'])
  assert.equal(ui.resolveFieldDef({ type: 'vec3', type_render: 'color' }).type_agv.valueKind, 'vec3')
  assert.equal(ui.resolveFieldDef({ type: 'vec4', type_render: 'color' }).type_agv.valueKind, 'vec4')
}

{
  assert.deepEqual(ui.resolveType('dict').default, {})
}

{
  const value = aiditor.signal([1, 2, 3])
  const writes = []
  const el = ui.editorFor({ type: 'vec3' }, value, function (next) { writes.push(next); value.set(next) })
  assert.equal(el.classList.contains('aiditor-ui-vec'), true)
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs.length, 3)
  assert.equal(inputs[0].value, '1.00')
  assert.equal(inputs[1].value, '2.00')
  assert.equal(inputs[2].value, '3.00')
  el.querySelectorAll('.aiditor-ui-num')[1].dispatch('dblclick', { target: inputs[1] })
  inputs[1].value = '8'
  key(inputs[1], 'Enter')
  assert.deepEqual(writes.at(-1), [1, 8, 3])
  assert.deepEqual(value.peek(), [1, 8, 3])
}

{
  const value = aiditor.signal([1, 2, 3])
  const el = ui.editorFor({ type: 'vec3', type_render: 'struct' }, value)
  assert.equal(el.classList.contains('aiditor-ui-struct-input'), true)
}

{
  const value = aiditor.signal(['old-id', 'old-num'])
  const writes = []
  const el = ui.editorFor({
    type: 'struct',
    struct_def: {
      id: 'string',
      num: 'string',
    },
  }, value, function (next) { writes.push(next); value.set(next) })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, 'old-id')
  assert.equal(inputs[1].value, 'old-num')
  inputs[0].value = 'new-id'
  inputs[0].dispatch('input', { target: inputs[0] })
  assert.deepEqual(writes.at(-1), ['new-id', 'old-num'])
  assert.deepEqual(value.peek(), ['new-id', 'old-num'])
}

{
  const value = aiditor.signal(['x'])
  const el = ui.editorFor({
    type: 'struct',
    struct_def: {
      x: { type: 'string', default: 'dx' },
      y: { type: 'string', default: 'dy' },
      z: { type: 'string', default: 'dz' },
    },
  }, value, function (next) { value.set(next) })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, 'x')
  assert.equal(inputs[1].value, 'dy')
  assert.equal(inputs[2].value, 'dz')
  inputs[2].value = 'zz'
  inputs[2].dispatch('input', { target: inputs[2] })
  assert.deepEqual(value.peek(), ['x', 'dy', 'zz'])
}

{
  const value = aiditor.signal([['a', 'b'], 'enabled'])
  const el = ui.editorFor({
    type: 'struct',
    struct_def: {
      inner: {
        type: 'struct',
        struct_def: {
          left: 'string',
          right: 'string',
        },
      },
      state: 'string',
    },
  }, value, function (next) { value.set(next) })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, 'a')
  assert.equal(inputs[1].value, 'b')
  assert.equal(inputs[2].value, 'enabled')
  inputs[1].value = 'bb'
  inputs[1].dispatch('input', { target: inputs[1] })
  assert.deepEqual(value.peek(), [['a', 'bb'], 'enabled'])
}

{
  const changes = []
  const el = ui.propertyForm({
    targets: [{ transform: [['1', '2', '3'], ['0', '0', '0']] }],
    schema: {
      transform: {
        type: 'struct',
        struct_def: {
          pos: {
            type: 'struct',
            struct_def: {
              x: 'string',
              y: 'string',
              z: 'string',
            },
          },
          rot: {
            type: 'struct',
            struct_def: {
              x: 'string',
              y: 'string',
              z: 'string',
            },
          },
        },
      },
    },
    onChange: function (field, value, _targets, meta) {
      changes.push({ field: field, value: value, change: meta.change })
    },
  })
  const input = el.querySelector('input')
  input.value = '10'
  input.dispatch('input', { target: input })
  assert.deepEqual(changes.at(-1), {
    field: 'transform.pos.x',
    value: '10',
    change: { field: 'transform.pos.x', mode: 'path', value: '10' },
  })
}

{
  const value = aiditor.signal({ id: 'object-id', num: 'object-num' })
  const el = ui.editorFor({
    type: 'struct',
    struct_def: {
      id: 'string',
      num: 'string',
    },
  }, value, function (next) { value.set(next) })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, '')
  assert.equal(inputs[1].value, '')
  inputs[1].value = 'tuple-num'
  inputs[1].dispatch('input', { target: inputs[1] })
  assert.deepEqual(value.peek(), ['', 'tuple-num'])
}

{
  const value = aiditor.signal({ health: '100', speed: '4' })
  const el = ui.dictInput({
    value,
    valueType: 'string',
  })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, 'health')
  assert.equal(inputs[1].value, '100')
  assert.equal(inputs[2].value, 'speed')
  assert.equal(inputs[3].value, '4')
  inputs[1].value = '120'
  inputs[1].dispatch('input', { target: inputs[1] })
  assert.deepEqual(value.peek(), { health: '120', speed: '4' })
}

{
  const value = aiditor.derived(function () { return { health: '100' } })
  const changes = []
  const el = ui.dictInput({
    value,
    valueType: 'string',
    onValueChange: function (key, next) { changes.push({ key: key, next: next }) },
  })
  const input = el.querySelectorAll('input')[1]
  input.value = '130'
  input.dispatch('input', { target: input })
  assert.deepEqual(changes, [{ key: 'health', next: '130' }])
}

{
  const value = aiditor.signal({ health: '100' })
  const el = ui.dictInput({
    value,
    renderValue: function (sig, write) { return ui.input({ value: sig, onChange: write }) },
    createKey: function () { return 'speed' },
    createValue: function () { return '4' },
  })
  el.querySelector('.aiditor-ui-dict-input-add').click()
  assert.deepEqual(value.peek(), { health: '100', speed: '4' })
  const speedRow = el.querySelectorAll('.aiditor-ui-dict-input-row')[1]
  const inputs = el.querySelectorAll('input')
  inputs[2].value = 'hp'
  inputs[2].blur()
  assert.deepEqual(value.peek(), { health: '100', hp: '4' })
  assert.equal(el.querySelectorAll('.aiditor-ui-dict-input-row')[1], speedRow)
  el.querySelectorAll('.aiditor-ui-action-btn')[0].click()
  assert.deepEqual(value.peek(), { hp: '4' })
}

{
  const value = aiditor.signal({ health: '100', speed: '4' })
  const el = ui.dictInput({
    value,
    renderValue: function (sig, write) { return ui.input({ value: sig, onChange: write }) },
  })
  const row = el.querySelector('.aiditor-ui-dict-input-row')
  const keyInput = el.querySelector('input')
  keyInput.value = 'speed'
  keyInput.blur()
  assert.deepEqual(value.peek(), { health: '100', speed: '4' })
  assert.equal(row.classList.contains('has-error'), true)
}

{
  const value = aiditor.signal({
    apple: ['101', '0.8'],
    pear: ['102', '0.6'],
  })
  const el = ui.editorFor({
    type: 'dict',
    type_agv: {
      value_type: {
        type: 'struct',
        struct_def: {
          id: 'string',
          weight: 'string',
        },
      },
    },
  }, value, function (next) { value.set(next) })
  const inputs = el.querySelectorAll('input')
  assert.equal(inputs[0].value, 'apple')
  assert.equal(inputs[1].value, '101')
  assert.equal(inputs[2].value, '0.8')
  assert.equal(inputs[3].value, 'pear')
  assert.equal(inputs[4].value, '102')
  assert.equal(inputs[5].value, '0.6')
  inputs[5].value = '0.7'
  inputs[5].dispatch('input', { target: inputs[5] })
  assert.deepEqual(value.peek(), {
    apple: ['101', '0.8'],
    pear: ['102', '0.7'],
  })
}

{
  const value = aiditor.signal([
    ['a', '1'],
    ['b', '2'],
  ])
  const writes = []
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
  }, value, function (next, meta) {
    writes.push({ next: next, change: meta.change })
    value.set(next)
  }, { fieldPath: 'items' })
  const inputs = el.querySelectorAll('input')
  inputs[3].value = '3'
  inputs[3].dispatch('input', { target: inputs[3] })
  assert.deepEqual(writes.at(-1).change, { field: 'items[1].num', mode: 'path', value: '3' })
  assert.deepEqual(value.peek(), [
    ['a', '1'],
    ['b', '3'],
  ])
}

{
  const value = aiditor.signal({
    'red.pear': ['102', '0.6'],
  })
  const writes = []
  const el = ui.editorFor({
    type: 'dict',
    type_agv: {
      value_type: {
        type: 'struct',
        struct_def: {
          id: 'string',
          weight: 'string',
        },
      },
    },
  }, value, function (next, meta) {
    writes.push({ next: next, change: meta.change })
    value.set(next)
  }, { fieldPath: 'fruit' })
  const inputs = el.querySelectorAll('input')
  inputs[2].value = '0.7'
  inputs[2].dispatch('input', { target: inputs[2] })
  assert.deepEqual(writes.at(-1).change, { field: 'fruit["red.pear"].weight', mode: 'path', value: '0.7' })
  assert.deepEqual(value.peek(), {
    'red.pear': ['102', '0.7'],
  })
}

{
  const source = aiditor.signal('abc')
  const readOnly = aiditor.derived(function () { return source() })
  const writes = []
  const el = ui.searchInput({ value: readOnly, onChange: function (v) { writes.push(v) } })
  const input = el.querySelector('input')
  input.value = 'abcd'
  input.dispatch('input', { target: input })
  assert.deepEqual(writes, ['abcd'])
  assert.equal(source.peek(), 'abc')
  el.querySelector('.aiditor-ui-search-clear').click()
  assert.deepEqual(writes, ['abcd', ''])
}

{
  const value = aiditor.signal(1)
  const disabled = aiditor.signal(true)
  const el = ui.numberInput({ value, disabled })
  const buttons = el.querySelectorAll('button')
  assert.equal(buttons[0].disabled, true)
  assert.equal(buttons[1].disabled, true)
  buttons[1].click()
  assert.equal(value.peek(), 1)
  disabled.set(false)
  buttons[1].click()
  assert.equal(value.peek(), 2)

  const input = el.querySelector('input')
  const ev = key(input, 'Enter')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(ev.__aiditorHandled, true)
}

{
  const value = aiditor.signal(['old'])
  const el = ui.tagInput({ value })
  const input = el.querySelector('input')
  input.value = 'new'
  const enter = key(input, 'Enter')
  assert.equal(enter.defaultPrevented, true)
  assert.equal(enter.__aiditorHandled, true)
  assert.deepEqual(value.peek(), ['old', 'new'])
  input.value = ''
  const backspace = key(input, 'Backspace')
  assert.equal(backspace.defaultPrevented, true)
  assert.equal(backspace.__aiditorHandled, true)
  assert.deepEqual(value.peek(), ['old'])
}

{
  const value = aiditor.signal('')
  const el = ui.filePathInput({ value, kind: 'image' })
  assert.equal(el.__dropzone.canDrop({ types: ['Files'], fileMimes: ['image/png'] }), true)
  assert.equal(el.__dropzone.canDrop({ types: ['Files'], fileMimes: ['application/pdf'] }), false)
  assert.equal(el.__dropzone.canDrop({ types: ['Files'], files: [{ name: 'one.png', type: 'image/png' }] }), true)
  assert.equal(el.__dropzone.canDrop({ types: ['Files'], files: [{ name: 'doc.pdf', type: 'application/pdf' }] }), false)
  el.querySelector('.aiditor-ui-file-path-preview').click()
  let fileInput = created.filter(function (item) { return item.localName === 'input' && item.type === 'file' }).pop()
  fileInput.files = [{ name: 'one.png', type: 'image/png' }]
  fileInput.dispatch('change', { target: fileInput })
  assert.equal(value.peek(), 'blob:one.png:1')
  assert.deepEqual(revoked, [])

  el.querySelector('.aiditor-ui-file-path-preview').click()
  fileInput = created.filter(function (item) { return item.localName === 'input' && item.type === 'file' }).pop()
  fileInput.files = [{ name: 'two.png', type: 'image/png' }]
  fileInput.dispatch('change', { target: fileInput })
  assert.equal(value.peek(), 'blob:two.png:2')
  assert.deepEqual(revoked, ['blob:one.png:1'])

  ui.dispose(el)
  assert.deepEqual(revoked, ['blob:one.png:1', 'blob:two.png:2'])
}

{
  openedMenus.length = 0
  const actions = []
  const value = aiditor.signal('project://sound/theme.ogg')
  const el = ui.filePathInput({
    value,
    kind: 'audio',
    onAction: function (ctx) { actions.push(ctx.action + ':' + ctx.value) },
    actions: function (ctx) {
      return [{
        id: 'showInFiles',
        label: 'Show in Files',
        icon: 'folder',
        onSelect: function () { actions.push('show:' + ctx.value + ':' + ctx.directory) },
      }]
    },
  })
  el.querySelector('.aiditor-ui-file-path-actions').click()
  assert.equal(openedMenus.length, 1)
  assert.equal(openedMenus[0].items[0].label, 'Load')
  assert.equal(openedMenus[0].items[1].label, 'Clear')
  assert.equal(openedMenus[0].items[3].label, 'Show in Files')

  openedMenus[0].items[3].onSelect()
  assert.deepEqual(actions, ['show:project://sound/theme.ogg:project://sound'])

  openedMenus[0].items[1].onSelect()
  assert.equal(value.peek(), '')
  assert.equal(actions[1], 'clear:')
}

{
  let browseCtx = null
  const value = aiditor.signal('project://textures/wall.png')
  const el = ui.filePathInput({
    value,
    kind: 'image',
    onBrowse: function (_current, ctx) {
      browseCtx = ctx
      return 'project://textures/floor.png'
    },
  })
  el.querySelector('.aiditor-ui-file-path-actions').click()
  openedMenus[openedMenus.length - 1].items[0].onSelect()
  assert.equal(value.peek(), 'project://textures/floor.png')
  assert.equal(browseCtx.action, 'load')
  assert.equal(browseCtx.directory, 'project://textures')
}

{
  global.localStorage = {
    getItem() { throw new Error('storage denied') },
    setItem() { throw new Error('storage denied') },
  }
  window.localStorage = global.localStorage
  const el = ui.colorInput({ value: '#112233' })
  assert.doesNotThrow(function () { el.querySelector('.aiditor-ui-color-swatch').click() })
  const addFavorite = document.body.querySelectorAll('button').find(function (btn) {
    return btn.attributes.title === 'Add to favorites'
  })
  assert.ok(addFavorite)
  assert.doesNotThrow(function () { addFavorite.click() })
  const modeButtons = document.body.querySelectorAll('.aiditor-ui-seg-btn')
  modeButtons[1].click()
  assert.equal(document.body.querySelectorAll('.aiditor-ui-color-channel-input').length, 0)
  const channels = document.body.querySelectorAll('.aiditor-ui-color-channel')
  assert.equal(channels.length, 4)
  assert.equal(channels.filter(function (channel) { return !!channel.querySelector('.aiditor-ui-num') }).length, 4)
}

{
  const value = aiditor.signal([1, 0.5, 0])
  const el = ui.colorInput({ value, valueKind: 'vec3' })
  const input = el.querySelector('.aiditor-ui-color-text').querySelector('input')
  assert.equal(input.value, '#FF8000')
  input.value = '#336699'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), [0.2, 0.4, 0.6])
}

{
  const value = aiditor.signal([1, 0, 0, 0.5])
  const el = ui.colorInput({ value, valueKind: 'vec4' })
  const input = el.querySelector('.aiditor-ui-color-text').querySelector('input')
  assert.equal(input.value, '#80FF0000')
  input.value = '#336699'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), [0.2, 0.4, 0.6, 0.5])
  input.value = '#40336699'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), [0.2, 0.4, 0.6, 0.25098])
}

{
  const value = aiditor.signal([255, 128, 0])
  const el = ui.colorInput({ value, valueKind: 'vec3', valueScale: 255 })
  const input = el.querySelector('.aiditor-ui-color-text').querySelector('input')
  assert.equal(input.value, '#FF8000')
  input.value = '#336699'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), [51, 102, 153])
}

{
  const value = aiditor.signal([0, 128, 255, 64])
  const el = ui.editorFor({
    type: 'var',
    type_render: 'color',
    type_agv: { valueKind: 'vec4', valueScale: 255 },
  }, value)
  const input = el.querySelector('.aiditor-ui-color-text').querySelector('input')
  assert.equal(input.value, '#400080FF')
  input.value = '#80336699'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), [51, 102, 153, 128])
}

{
  const value = aiditor.signal([1, 0, 0])
  const el = ui.editorFor({ type: 'vec3', type_render: 'color' }, value)
  const input = el.querySelector('.aiditor-ui-color-text').querySelector('input')
  assert.equal(input.value, '#FF0000')
  input.value = '#336699'
  input.dispatch('input', { target: input })
  assert.deepEqual(value.peek(), [0.2, 0.4, 0.6])
}

{
  const css = readFileSync('src/style/ui-form.css', 'utf8')
  assert.match(
    css,
    /\.aiditor-ui-struct-input-row-layout-block,\s*\.aiditor-ui-struct-input-row-layout-section\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    'block and section struct rows must put the editor on a full-width line'
  )
  assert.match(
    css,
    /\.aiditor-ui-property-form \.aiditor-ui-property-form-struct > \.aiditor-ui-struct-input-row-layout-block,\s*\.aiditor-ui-property-form \.aiditor-ui-property-form-struct > \.aiditor-ui-struct-input-row-layout-section\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    'propertyForm block and section rows must override the inspector label column'
  )
  assert.match(
    css,
    /\.aiditor-ui-struct-input-row-collapsed > \.aiditor-ui-struct-input-cell\s*{[^}]*display:\s*none;/s,
    'section field rows must hide their editor cell when collapsed'
  )
  assert.doesNotMatch(
    css,
    /\.aiditor-ui-struct-input-label\[data-has-tip\]\s*{[^}]*cursor:/s,
    'tooltip markers should not change the mouse cursor'
  )
  assert.match(
    css,
    /\.aiditor-ui-color-picker\s*{[^}]*width:\s*330px;/s,
    'color picker should provide enough width for four standard channel editors'
  )
  assert.match(
    css,
    /\.aiditor-ui-color-sv\s*{[^}]*height:\s*195px;/s,
    'color picker saturation/value plane should scale with the wider picker'
  )
  assert.doesNotMatch(
    css,
    /\.aiditor-ui-color-channel-input\s*{/,
    'color channels should use standard numberInput, not a custom raw input'
  )
  assert.match(
    css,
    /\.aiditor-ui-field-message-error\s*{[^}]*color:\s*var\(--aiditor-error\);/s,
    'field error messages should use the shared semantic danger token'
  )
}

console.log('input component tests ok')

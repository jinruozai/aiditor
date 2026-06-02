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
    this.dataset = {}
    this.events = {}
    this.classList = new ClassList(this)
    this.className = ''
    this.textContent = ''
    this.value = ''
    this.hidden = false
    this.disabled = false
    this.readOnly = false
    this.selectionStart = 0
    this.selectionEnd = 0
    this.captured = []
    this.released = []
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
    if (!ev.preventDefault) ev.preventDefault = function () {}
    const list = this.events[type] || []
    for (let i = 0; i < list.length; i++) list[i].call(this, ev)
    return ev
  }
  setPointerCapture(pointerId) { this.captured.push(pointerId) }
  releasePointerCapture(pointerId) { this.released.push(pointerId) }
  focus() { document.activeElement = this }
  blur() { if (document.activeElement === this) document.activeElement = null }
  select() {
    this.selectionStart = 0
    this.selectionEnd = String(this.value || '').length
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
global.requestAnimationFrame = function (fn) { fn() }
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

aiditor.shortcuts = { markHandled() {} }
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

for (const file of [
  'src/ui/base/actionBar.js',
  'src/ui/form/input.js',
  'src/ui/form/searchInput.js',
  'src/ui/form/numberInput.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/editorFor.js',
  'src/ui/form/structInput.js',
  'src/ui/container/section.js',
  'src/ui/form/propertyForm.js',
  'src/ui/inspector.js',
  'src/ui/panel/inspector.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

let value = 1
let inspectCount = 0
aiditor.inspector.registerProvider('case.numeric', {
  inspect() {
    inspectCount++
    return {
      title: 'Numeric',
      subtitle: 'stable-refresh',
      groups: {
        numeric: { label: 'Numeric ' + inspectCount },
      },
      schema: {
        amount: {
          type: 'float',
          group: 'numeric',
          label: 'Amount',
          type_agv: { step: 0.1, decimal_places: 2 },
        },
      },
      values: [{ amount: value }],
      write: function (_field, change) {
        value = change.value
        aiditor.inspector.refresh()
      },
    }
  },
})

const cleanups = []
const ctx = {
  panel: {},
  bus: aiditor.bus,
  onCleanup(fn) { cleanups.push(fn) },
}
aiditor.inspector.select({ type: 'case.numeric', id: 'n1' })
const root = aiditor.resolveComponent('inspector').factory(aiditor.signal({}), ctx)
const num = root.querySelector('.aiditor-ui-num')
const body = root.querySelector('.aiditor-ui-section-body')

num.dispatch('pointerdown', { button: 0, target: num, clientX: 0, pointerId: 4 })
assert.deepEqual(num.captured, [4])
num.dispatch('pointermove', { target: num, clientX: 10, pointerId: 4, shiftKey: false, ctrlKey: false, metaKey: false })
assert.equal(value, 2)
assert.equal(root.querySelector('.aiditor-ui-num'), num)
assert.equal(root.querySelector('.aiditor-ui-section-body'), body)
assert.equal(num.parentNode != null, true)

num.dispatch('pointermove', { target: num, clientX: 20, pointerId: 4, shiftKey: false, ctrlKey: false, metaKey: false })
assert.equal(value, 3)
assert.equal(root.querySelector('.aiditor-ui-num'), num)
num.dispatch('pointerup', { target: num, pointerId: 4 })
assert.deepEqual(num.released, [4])

cleanups.forEach(function (fn) { fn() })

console.log('inspector refresh stability tests ok')

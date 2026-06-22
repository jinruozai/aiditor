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
    this.events = {}
    this.classList = new ClassList(this)
    this.className = ''
    this.textContent = ''
    this.value = ''
    this.disabled = false
    this.hidden = false
    this.scrollIntoViewCalls = 0
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
    if (!ev.preventDefault) ev.preventDefault = function () { this.defaultPrevented = true }
    const list = this.events[type] || []
    for (let i = 0; i < list.length; i++) list[i].call(this, ev)
    return ev
  }
  click() { return this.dispatch('click', {}) }
  focus() {
    document.activeElement = this
    this.dispatch('focus', { target: this })
  }
  blur() {
    if (document.activeElement === this) document.activeElement = null
    this.dispatch('blur', { target: this })
  }
  select() {}
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
  getBoundingClientRect() { return { width: 180, height: 20, left: 0, right: 180, top: 0, bottom: 20 } }
  scrollIntoView() { this.scrollIntoViewCalls++ }
}

global.HTMLElement = FakeEl
global.document = {
  activeElement: null,
  body: new FakeEl('body'),
  createElement(tag) { return new FakeEl(tag) },
}
global.window = { aiditor: {} }
window.HTMLElement = FakeEl
global.requestAnimationFrame = function (fn) { fn() }
global.setTimeout = function (fn) { fn(); return 1 }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_edit-session.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui

ui.icon = function (opts) {
  return ui.h('span', 'aiditor-ui-icon', { text: opts && opts.name || '' })
}
ui.iconButton = function (opts) {
  const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' })
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.popover = function (opts) {
  const frame = ui.h('div', 'aiditor-ui-popover')
  frame.appendChild(opts.content)
  document.body.appendChild(frame)
  return {
    el: frame,
    close() {
      ui.dispose(opts.content)
      frame.remove()
      if (opts.onDismiss) opts.onDismiss()
    },
  }
}

for (const file of [
  'src/ui/form/input.js',
  'src/ui/form/searchInput.js',
  'src/ui/overlay/quickPick.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

function keyEvent(key) {
  return {
    key,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }
}

const anchor = new FakeEl('button')
document.body.appendChild(anchor)
const items = aiditor.signal([
  { id: 'alpha', label: 'Alpha', description: 'animal', detail: 'data/livestock', icon: 'box', group: 'A' },
  { id: 'beta', label: 'Beta', description: 'blocked', detail: 'data/blocked', group: 'A', disabled: true },
  { id: 'gamma', label: 'Gamma', description: 'plant', detail: 'data/plants', group: 'B' },
])
const selected = []
const picker = ui.quickPick({
  anchor,
  items,
  getKey: function (item) { return item.id },
  getSearchText: function (item) { return [item.id, item.label, item.detail] },
  onSelect: function (item, ctx) {
    selected.push({ item, ctx })
    return new Promise(function () {})
  },
  placeholder: 'Pick...',
})

const root = picker.el.querySelector('.aiditor-ui-quick-pick')
const input = root.querySelector('input')
const keyTarget = root.querySelector('.aiditor-ui-quick-pick-input')
assert.equal(input.attributes.role, 'combobox')
assert.equal(root.querySelector('.aiditor-ui-quick-pick-list').attributes.role, 'listbox')
assert.equal(root.querySelectorAll('.aiditor-ui-quick-pick-row').length, 3)
assert.equal(root.querySelectorAll('.aiditor-ui-quick-pick-row-disabled').length, 1)
assert.equal(root.querySelectorAll('.aiditor-ui-quick-pick-group').length, 2)

let rows = root.querySelectorAll('.aiditor-ui-quick-pick-row')
assert.equal(rows[0].classList.contains('aiditor-ui-quick-pick-row-active'), true)
rows[1].click()
assert.equal(selected.length, 0)
assert.ok(picker.el.parentNode)

keyTarget.dispatch('keydown', keyEvent('ArrowDown'))
rows = root.querySelectorAll('.aiditor-ui-quick-pick-row')
assert.equal(rows[2].classList.contains('aiditor-ui-quick-pick-row-active'), true)
assert.equal(rows[2].scrollIntoViewCalls > 0, true)
keyTarget.dispatch('keydown', keyEvent('Enter'))
assert.equal(selected.length, 1)
assert.equal(selected[0].item.id, 'gamma')
assert.equal(selected[0].ctx.query, '')
assert.equal(picker.el.parentNode, null)

const customItems = aiditor.signal([
  { id: 'one', label: 'One', path: 'kind/one' },
  { id: 'two', label: 'Two', path: 'kind/two' },
  { id: 'three', label: 'Three', path: 'kind/three' },
])
const custom = ui.quickPick({
  anchor,
  items: customItems,
  getKey: function (item) { return item.id },
  getLabel: function (item) { return item.label },
  getDetail: function (item) { return item.path },
  getSearchText: function (item) { return [item.id, item.label, item.path] },
  getDisabled: function (item) { return item.disabled },
  renderItem: function (item, ctx) {
    const el = ui.h('span', 'custom-content', { text: ctx.label + ':' + ctx.detail })
    el.datasetKey = ctx.key
    return el
  },
})
const customRoot = custom.el.querySelector('.aiditor-ui-quick-pick')
const customInput = customRoot.querySelector('input')
const customKeyTarget = customRoot.querySelector('.aiditor-ui-quick-pick-input')
let customRows = customRoot.querySelectorAll('.aiditor-ui-quick-pick-row')
assert.equal(customRows[0].attributes.role, 'option')
assert.equal(customRows[0].querySelector('.custom-content').textContent, 'One:kind/one')

customKeyTarget.dispatch('keydown', keyEvent('ArrowDown'))
customKeyTarget.dispatch('keydown', keyEvent('ArrowDown'))
customRows = customRoot.querySelectorAll('.aiditor-ui-quick-pick-row')
assert.equal(customRows[2].classList.contains('aiditor-ui-quick-pick-row-active'), true)

customItems.set([
  { id: 'one', label: 'One+', path: 'kind/one' },
  { id: 'two', label: 'Two', path: 'kind/two' },
  { id: 'three', label: 'Three', path: 'kind/three', disabled: true },
])
customRows = customRoot.querySelectorAll('.aiditor-ui-quick-pick-row')
assert.equal(customRows[0].querySelector('.custom-content').textContent, 'One+:kind/one')
assert.equal(customRows[0].classList.contains('aiditor-ui-quick-pick-row-active'), true)

customInput.value = 'kind/two'
customInput.dispatch('input', {})
assert.equal(customRoot.querySelectorAll('.aiditor-ui-quick-pick-row').length, 1)
customItems.set([
  { id: 'two', label: 'Two+', path: 'kind/two' },
  { id: 'four', label: 'Four', path: 'kind/four' },
])
customRows = customRoot.querySelectorAll('.aiditor-ui-quick-pick-row')
assert.equal(customRows.length, 1)
assert.equal(customRows[0].querySelector('.custom-content').textContent, 'Two+:kind/two')

custom.close()
assert.equal(custom.el.parentNode, null)

console.log('quick pick tests ok')

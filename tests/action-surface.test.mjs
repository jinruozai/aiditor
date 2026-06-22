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
    this.disabled = false
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
  click() {
    return this.dispatch('click', {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.propagationStopped = true },
    })
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
  createElement(tag) { return new FakeEl(tag) },
}
global.window = { aiditor: {} }
window.HTMLElement = FakeEl

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/core/commands.js',
  'src/ui/_internal/_signal.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui

ui.icon = function (opts) {
  return ui.h('span', 'aiditor-ui-icon', { text: opts && (opts.name || opts.glyph) || '' })
}
ui.iconButton = function (opts) {
  const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' })
  el.disabled = !!(opts && opts.disabled)
  if (opts && opts.title) el.setAttribute('title', opts.title)
  if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.menu = function (opts) {
  openedMenu = opts
  return { close: function () { menuClosed++ } }
}

vm.runInThisContext(readFileSync('src/ui/base/actionMenu.js', 'utf8'), { filename: 'src/ui/base/actionMenu.js' })
vm.runInThisContext(readFileSync('src/ui/base/actionBar.js', 'utf8'), { filename: 'src/ui/base/actionBar.js' })
vm.runInThisContext(readFileSync('src/ui/container/section.js', 'utf8'), { filename: 'src/ui/container/section.js' })

let ran = null
let openedMenu = null
let menuClosed = 0

aiditor.commands.register('case.add', {
  run(input, ctx) { ran = { input, ctx } },
})
aiditor.commands.register('case.delete', {
  run(input, ctx) { ran = { input, ctx } },
})
aiditor.commands.register('case.asyncFail', {
  run() { return Promise.reject(new Error('async action failed')) },
})

const actionCtx = aiditor.signal({ id: 7, source: 'test' })
const bar = ui.actionBar({
  ctx: actionCtx,
  actions: [
    { id: 'add', icon: 'plus', label: 'Add', command: 'case.add', args: function (ctx) { return { id: ctx.id } } },
    { id: 'hidden', icon: 'x', hidden: true, command: 'case.add' },
  ],
})
assert.equal(bar.querySelectorAll('.aiditor-ui-icon-btn').length, 1)
bar.querySelector('.aiditor-ui-icon-btn').click()
assert.deepEqual(ran.input, { id: 7 })
assert.equal(ran.ctx.action, 'add')
assert.equal(ran.ctx.source, 'test')

const menuBar = ui.actionBar({
  ctx: { id: 8 },
  actions: [{
    id: 'more',
    icon: 'more-vertical',
    label: 'More',
    menu: [
      { label: 'Delete', icon: 'trash', variant: 'danger', command: 'case.delete', args: { id: 8 } },
    ],
  }],
})
menuBar.querySelector('.aiditor-ui-icon-btn').click()
assert.equal(openedMenu.behavior, 'dropdown')
assert.equal(openedMenu.items.length, 1)
assert.equal(openedMenu.items[0].danger, true)
openedMenu.items[0].onSelect()
assert.deepEqual(ran.input, { id: 8 })
assert.equal(ran.ctx.action, '')

const failBar = ui.actionBar({
  actions: [{ id: 'fail', icon: 'x', label: 'Fail', command: 'case.asyncFail' }],
})
failBar.querySelector('.aiditor-ui-icon-btn').click()
await new Promise(function (resolve) { setTimeout(resolve, 0) })
assert.equal(aiditor.log.peek().some(function (entry) {
  return entry.level === 'error' && entry.source.scope === 'ui.actionBar' && entry.message === 'async action failed'
}), true)

const collapsed = aiditor.signal(false)
let selected = 0
const section = ui.section({
  title: 'Rule',
  collapsed: collapsed,
  actions: [{ id: 'more', icon: 'more-vertical', label: 'More', onSelect: function () { selected++ } }],
})
section.querySelector('.aiditor-ui-icon-btn').click()
assert.equal(selected, 1)
assert.equal(collapsed.peek(), false)
section.querySelector('.aiditor-ui-section-toggle').click()
assert.equal(collapsed.peek(), true)
ui.dispose(section)
assert.equal(menuClosed >= 0, true)

console.log('action surface tests ok')

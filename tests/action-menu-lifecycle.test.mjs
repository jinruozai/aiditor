import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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
    this.textContent = ''
    this.id = ''
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
  contains(target) {
    let n = target
    while (n) {
      if (n === this) return true
      n = n.parentNode
    }
    return false
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'id') this.id = String(value)
    else this[name] = String(value)
  }
  removeAttribute(name) {
    delete this.attributes[name]
    if (name === 'id') this.id = ''
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
  querySelectorAll(selector) {
    const out = []
    const match = selector[0] === '#'
      ? function (el) { return el.id === selector.slice(1) }
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
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  getBoundingClientRect() {
    return { left: 0, right: 80, top: 0, bottom: 24, width: 80, height: 24 }
  }
  focus() { document.activeElement = this }
}

const documentEvents = {}
global.document = {
  activeElement: null,
  body: new FakeEl('body'),
  createElement(tag) { return new FakeEl(tag) },
  getElementById(id) { return this.body.querySelector('#' + id) },
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
  dispatch(type, target) {
    const ev = {
      type,
      target,
      stopPropagation() { this.propagationStopped = true },
      preventDefault() { this.defaultPrevented = true },
    }
    const list = documentEvents[type] || []
    for (let i = 0; i < list.length; i++) list[i](ev)
    return ev
  },
}
global.window = { aiditor: {}, innerWidth: 1000, innerHeight: 800 }
global.HTMLElement = FakeEl
window.HTMLElement = FakeEl

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_portal.js',
  'src/ui/_internal/_floating.js',
  'src/ui/_internal/_scope.js',
  'src/ui/_internal/_overlay.js',
  'src/ui/base/popover.js',
  'src/ui/overlay/menu.js',
  'src/ui/base/actionMenu.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui
const row = document.createElement('div')
document.body.appendChild(row)

ui.actionMenu({
  anchor: row,
  point: { x: 20, y: 20 },
  behavior: 'context',
  actions: [{ label: 'Context action' }],
})
await new Promise(function (resolve) { setTimeout(resolve, 0) })
assert.equal(ui._overlay.depth(), 1)
const menuRoot = document.getElementById('aiditor-portal-root').children[0]
document.dispatch('pointerdown', menuRoot)
assert.equal(ui._overlay.depth(), 1)
document.dispatch('pointerdown', row)
assert.equal(ui._overlay.depth(), 0)

ui.actionMenu({
  anchor: row,
  point: { x: 20, y: 20 },
  behavior: 'dropdown',
  actions: [{ label: 'Dropdown action' }],
})
await new Promise(function (resolve) { setTimeout(resolve, 0) })
assert.equal(ui._overlay.depth(), 1)
document.dispatch('pointerdown', row)
assert.equal(ui._overlay.depth(), 1)

ui._overlay.depth() && document.dispatch('pointerdown', document.body)
assert.equal(ui._overlay.depth(), 0)

console.log('action menu lifecycle tests ok')

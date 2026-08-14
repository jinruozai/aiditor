import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.localName = String(tag).toLowerCase()
    this.children = []
    this.parentNode = null
    this.style = {}
    this.attributes = {}
    this.events = {}
    this.className = ''
    this.id = ''
    this.tabIndex = 0
    const classes = new Set()
    this.classList = {
      add(name) { classes.add(name) },
      remove(name) { classes.delete(name) },
      contains(name) { return classes.has(name) },
    }
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
  contains(target) {
    let current = target
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'id') this.id = String(value)
  }
  removeAttribute(name) {
    delete this.attributes[name]
    if (name === 'id') this.id = ''
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
    const isFocusable = selector.indexOf('button:not') >= 0
    const match = selector[0] === '#'
      ? function (el) { return el.id === selector.slice(1) }
      : isFocusable
        ? function (el) { return ['button', 'input', 'select', 'textarea', 'a', 'area'].indexOf(el.localName) >= 0 }
        : function (el) { return el.localName === selector.toLowerCase() }
    function visit(root) {
      for (let i = 0; i < root.children.length; i++) {
        const child = root.children[i]
        if (match(child)) out.push(child)
        visit(child)
      }
    }
    visit(this)
    return out
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  getBoundingClientRect() {
    return { left: 10, right: 90, top: 10, bottom: 34, width: 80, height: 24 }
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
  dispatch(type, target, extra) {
    const event = Object.assign({
      type: type,
      target: target,
      stopPropagation() { this.propagationStopped = true },
      preventDefault() { this.defaultPrevented = true },
    }, extra || {})
    const list = (documentEvents[type] || []).slice()
    for (let i = 0; i < list.length; i++) list[i](event)
    return event
  },
}
global.window = { aiditor: {}, innerWidth: 1000, innerHeight: 800 }
global.HTMLElement = FakeEl
window.HTMLElement = FakeEl
global.requestAnimationFrame = function (fn) { fn(); return 1 }

for (const file of [
  'src/core/signal.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_portal.js',
  'src/ui/_internal/_floating.js',
  'src/ui/_internal/_scope.js',
  'src/ui/_internal/_overlay.js',
  'src/ui/base/popover.js',
  'src/ui/overlay/menu.js',
  'src/ui/overlay/modal.js',
  'src/ui/overlay/drawer.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui
const anchor = document.createElement('button')
document.body.appendChild(anchor)
anchor.focus()

assert.equal(ui.isSignal(ui.modalDepth), true)
assert.equal(ui.modalDepth.peek(), 0)
assert.equal(ui.modalDepth.set, undefined)
assert.equal(ui.modalDepth.update, undefined)
assert.equal(ui.modalDepth.dispose, undefined)

const observed = []
const stop = aiditor.effect(function () { observed.push(ui.modalDepth()) })

const popover = ui.popover({ anchor: anchor, content: document.createElement('span') })
assert.equal(ui.modalDepth.peek(), 0)
assert.deepEqual(observed, [0])
popover.close()
assert.equal(ui.modalDepth.peek(), 0)

const drawer = ui.drawer({ ariaLabel: 'Drawer' })
assert.equal(ui.modalDepth.peek(), 1)
ui.dispose(drawer.el)
assert.equal(ui.modalDepth.peek(), 0)

const outer = ui.modal({ ariaLabel: 'Outer' })
assert.equal(ui.modalDepth.peek(), 1)
const inner = ui.modal({ ariaLabel: 'Inner' })
assert.equal(ui.modalDepth.peek(), 2)
inner.close()
assert.equal(ui.modalDepth.peek(), 1)
inner.close()
assert.equal(ui.modalDepth.peek(), 1)
outer.close()
assert.equal(ui.modalDepth.peek(), 0)

const escapeModal = ui.modal({ ariaLabel: 'Escape modal' })
const menu = ui.menu({ anchor: anchor, items: [] })
assert.equal(ui.modalDepth.peek(), 1)
const beforeMenuEscape = observed.length
document.dispatch('keydown', menu.el, { key: 'Escape' })
assert.equal(ui.modalDepth.peek(), 1)
assert.equal(observed.length, beforeMenuEscape)
const escapeEvent = document.dispatch('keydown', escapeModal.el, { key: 'Escape' })
assert.equal(escapeEvent.propagationStopped, true)
assert.equal(ui.modalDepth.peek(), 0)

const backdropModal = ui.modal({ ariaLabel: 'Backdrop modal' })
await new Promise(function (resolve) { setTimeout(resolve, 0) })
const backdrop = backdropModal.el.parentNode
document.dispatch('pointerdown', backdrop)
assert.equal(ui.modalDepth.peek(), 0)

let disposeCloseCount = 0
const disposableModal = ui.modal({
  ariaLabel: 'Disposable modal',
  onClose() { disposeCloseCount++ },
})
assert.equal(ui.modalDepth.peek(), 1)
ui.dispose(disposableModal.el)
assert.equal(ui.modalDepth.peek(), 0)
assert.equal(ui._overlay.depth(), 0)
assert.equal(disposeCloseCount, 1)

assert.deepEqual(observed, [0, 1, 0, 1, 2, 1, 0, 1, 0, 1, 0, 1, 0])
stop()

console.log('overlay modal state tests ok')

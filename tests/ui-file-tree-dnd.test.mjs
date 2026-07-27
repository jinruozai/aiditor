import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class ClassList {
  constructor(el) { this.el = el; this.items = new Set() }
  refresh() { this.items = new Set(String(this.el.className || '').split(/\s+/).filter(Boolean)) }
  add() { this.refresh(); for (let i = 0; i < arguments.length; i++) this.items.add(arguments[i]); this.sync() }
  remove() { this.refresh(); for (let i = 0; i < arguments.length; i++) this.items.delete(arguments[i]); this.sync() }
  contains(cls) { this.refresh(); return this.items.has(cls) }
  toggle(cls, force) { this.refresh(); const next = force == null ? !this.items.has(cls) : !!force; if (next) this.items.add(cls); else this.items.delete(cls); this.sync(); return next }
  set(value) { this.items = new Set(String(value || '').split(/\s+/).filter(Boolean)); this.sync() }
  sync() { this.el.className = Array.from(this.items).join(' ') }
}

class FakeEl {
  constructor(tag) {
    this.nodeType = 1
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
    this.scrollTop = 0
    this.scrollLeft = 0
    this.clientHeight = 240
  }
  appendChild(child) { return this.insertBefore(child, null) }
  insertBefore(child, before) { if (child.parentNode) child.parentNode.removeChild(child); const index = before ? this.children.indexOf(before) : -1; if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); child.parentNode = this; return child }
  replaceChildren() { while (this.firstChild) this.removeChild(this.firstChild); for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i]) }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  get firstChild() { return this.children[0] || null }
  get nextSibling() { if (!this.parentNode) return null; const index = this.parentNode.children.indexOf(this); return this.parentNode.children[index + 1] || null }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.classList.set(value); else this[name] = String(value) }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'class') this.classList.set(''); else delete this[name] }
  toggleAttribute(name, force) { const next = force == null ? this.getAttribute(name) == null : !!force; if (next) this.setAttribute(name, ''); else this.removeAttribute(name); return next }
  addEventListener(type, fn) { if (!this.events[type]) this.events[type] = []; this.events[type].push(fn) }
  removeEventListener(type, fn) { const list = this.events[type] || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
  dispatch(type, event) { const ev = event || {}; ev.type = type; if (!ev.target) ev.target = this; if (!ev.preventDefault) ev.preventDefault = function () { this.defaultPrevented = true }; if (!ev.stopPropagation) ev.stopPropagation = function () { this.propagationStopped = true }; const list = this.events[type] || []; for (let i = 0; i < list.length; i++) list[i].call(this, ev); return ev }
  click() { return this.dispatch('click', {}) }
  focus() { document.activeElement = this }
  setPointerCapture() {}
  releasePointerCapture() {}
  scrollIntoView() {}
  matches(selector) { if (selector[0] === '.') return this.classList.contains(selector.slice(1)); if (selector[0] === '[') return this.getAttribute(selector.slice(1, -1).split('=')[0]) != null; return this.localName === selector.toLowerCase() }
  closest(selector) { let node = this; while (node) { if (node.matches && node.matches(selector)) return node; node = node.parentNode } return null }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) { const out = []; function visit(el) { for (let i = 0; i < el.children.length; i++) { const child = el.children[i]; if (child.matches && child.matches(selector)) out.push(child); visit(child) } } visit(this); return out }
  getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 24, width: 100, height: 24 } }
}

class FakeText { constructor(text) { this.nodeType = 3; this.textContent = String(text); this.parentNode = null } }

global.HTMLElement = FakeEl
global.document = {
  activeElement: null,
  body: new FakeEl('body'),
  createElement(tag) { return new FakeEl(tag) },
  createTextNode(text) { return new FakeText(text) },
  createDocumentFragment() { return new FakeEl('fragment') },
}
global.window = { aiditor: {} }
window.HTMLElement = FakeEl
global.requestAnimationFrame = function (fn) { fn(); return 1 }
global.DataTransferItem = function () {}
DataTransferItem.prototype.webkitGetAsEntry = function () {}

for (const file of ['src/core/signal.js', 'src/core/log.js', 'src/ui/_internal/_signal.js', 'src/ui/_internal/_edit-session.js']) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui
const flush = function () { return new Promise(function (resolve) { setImmediate(resolve) }) }
ui.icon = function (opts) { return ui.h('span', 'aiditor-ui-icon', { text: opts && opts.name || '' }) }
ui.iconButton = function (opts) { const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' }); if (opts && opts.onClick) el.addEventListener('click', opts.onClick); return el }
ui.menu = function () { return { close() {} } }

for (const file of ['src/ui/form/input.js', 'src/ui/form/searchInput.js', 'src/ui/_internal/_dnd.js', 'src/ui/data/tree.js', 'src/ui/data/fileBrowser.js']) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const treeItems = aiditor.signal([{ id: 'root', label: 'Root', hasChildren: true }])
const expanded = aiditor.signal(new Set())
const treeSelected = aiditor.signal(['root'])
const loads = []
const tree = ui.tree({
  items: treeItems,
  expanded,
  selected: treeSelected,
  loadChildren(node, signal) { return new Promise(function (resolve, reject) { loads.push({ node, signal, resolve, reject }) }) },
})
tree.scrollTop = 37
tree.__aiditorTree.toggle('root')
assert.equal(loads.length, 1)
assert.equal(tree.__aiditorTree.loadState('root'), 'loading')
assert.equal(tree.__aiditorTree.getFlat()[0].loading, true)
assert.equal(tree.__aiditorTree.getRowEl('root').attributes['aria-busy'], 'true')
assert.equal(tree.__aiditorTree.getRowEl('root').attributes['aria-label'], 'Root, loading')
loads[0].resolve([{ id: 'child', label: 'Child' }])
await flush()
assert.equal(tree.__aiditorTree.loadState('root'), 'loaded')
assert.deepEqual(tree.__aiditorTree.getFlat().map(function (row) { return row.node.id }), ['root', 'child'])
assert.deepEqual(treeSelected.peek(), ['root'])
assert.equal(tree.scrollTop, 37)

tree.__aiditorTree.invalidateChildren('root')
assert.equal(loads.length, 2)
loads[1].reject(new Error('read failed'))
await flush()
assert.equal(tree.__aiditorTree.loadState('root'), 'error')
assert.equal(tree.__aiditorTree.getFlat()[0].error.message, 'read failed')
assert.equal(tree.__aiditorTree.getRowEl('root').attributes['aria-label'], 'Root, loading failed')
const retry = tree.__aiditorTree.retry('root')
assert.equal(loads.length, 3)
loads[2].resolve([{ id: 'child-2', label: 'Child 2' }])
await retry; await flush()
assert.equal(tree.__aiditorTree.getFlat()[1].node.id, 'child-2')

tree.__aiditorTree.invalidateChildren('root')
assert.equal(loads.length, 4)
tree.__aiditorTree.toggle('root')
assert.equal(loads[3].signal.aborted, true)
tree.__aiditorTree.toggle('root')
assert.equal(loads.length, 5)
treeItems.set([])
assert.equal(loads[4].signal.aborted, true)
ui.dispose(tree)

const syncErrorTree = ui.tree({
  items: [{ id: 'sync', label: 'Sync', hasChildren: true }],
  defaultExpanded: ['sync'],
  loadChildren() { throw new Error('sync read failed') },
})
await flush()
assert.equal(syncErrorTree.__aiditorTree.loadState('sync'), 'error')
assert.equal(syncErrorTree.__aiditorTree.getFlat()[0].error.message, 'sync read failed')
ui.dispose(syncErrorTree)

function fileEntry(name, file, fail) { return { name, isDirectory: false, file(resolve, reject) { if (fail) reject(new Error('cannot read')); else resolve(file) } } }
function directoryEntry(name, children) {
  return { name, isDirectory: true, createReader() { let done = false; return { readEntries(resolve) { const batch = done ? [] : children; done = true; resolve(batch) } } } }
}
const logo = { name: 'logo.png', type: 'image/png', size: 12 }
const bad = { name: 'bad.txt', type: 'text/plain', size: 2 }
const legacyRoot = directoryEntry('images', [fileEntry('logo.png', logo), fileEntry('bad.txt', bad, true)])
const external = await ui.dnd.readExternalEntries({ items: [{ kind: 'file', webkitGetAsEntry() { return legacyRoot }, getAsFile() { return null } }] })
assert.deepEqual(external.entries.map(function (entry) { return [entry.kind, entry.relativePath] }), [['directory', 'images'], ['file', 'images/logo.png']])
assert.equal(external.entries[1].file, logo)
assert.equal('entry' in external.entries[0], false)
assert.equal('handle' in external.entries[0], false)
assert.equal(external.errors.length, 1)
assert.equal(external.errors[0].path, 'images/bad.txt')
assert.equal(ui.dnd.capabilities().directories, true)

const browserEntries = aiditor.signal([
  { id: 'b.txt', name: 'b.txt', path: 'b.txt', kind: 'file', size: 2 },
  { id: 'folder', name: 'folder', path: 'folder', kind: 'directory' },
  { id: 'a.txt', name: 'a.txt', path: 'a.txt', kind: 'file', size: 1 },
])
const browserPath = aiditor.signal('')
const browserSelected = aiditor.signal([])
const browserView = aiditor.signal('icons')
const browserSort = aiditor.signal({ by: 'name', direction: 'asc' })
const browser = ui.fileBrowser({ entries: browserEntries, path: browserPath, selected: browserSelected, view: browserView, sort: browserSort })
let rows = browser.querySelectorAll('.aiditor-ui-fileitem')
assert.deepEqual(rows.map(function (row) { return row.dataset.key }), ['folder', 'a.txt', 'b.txt'])
const retained = rows[2]
browserEntries.set([
  { id: 'b.txt', name: 'b-renamed.txt', path: 'b.txt', kind: 'file', size: 2 },
  { id: 'folder', name: 'folder', path: 'folder', kind: 'directory' },
  { id: 'a.txt', name: 'a.txt', path: 'a.txt', kind: 'file', size: 1 },
])
rows = browser.querySelectorAll('.aiditor-ui-fileitem')
assert.equal(rows[2], retained)
assert.equal(retained.querySelector('.aiditor-ui-filename').textContent, 'b-renamed.txt')
rows[1].dispatch('click', { ctrlKey: false, metaKey: false, shiftKey: false })
assert.deepEqual(browserSelected.peek(), ['a.txt'])
rows[0].dispatch('dblclick', {})
assert.equal(browserPath.peek(), 'folder')
browserView.set('list')
assert.equal(browser.querySelector('.aiditor-ui-filegrid').classList.contains('aiditor-ui-filegrid-list'), true)
assert.equal(browser.querySelector('.aiditor-ui-filethumb').querySelector('.aiditor-ui-icon').textContent, 'folder')
const searchInput = browser.querySelector('input')
searchInput.value = 'renamed'
searchInput.dispatch('input', { target: searchInput })
assert.deepEqual(browser.__aiditorFileBrowser.getVisibleEntries().map(function (entry) { return entry.id }), ['b.txt'])
ui.dispose(browser)

console.log('file browser, async tree, and external drop tests ok')

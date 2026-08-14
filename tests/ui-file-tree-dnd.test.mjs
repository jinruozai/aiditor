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
    this.clientWidth = 320
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
  getBoundingClientRect() {
    const match = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(this.style.transform || '')
    const left = match ? Number(match[1]) : 0
    const top = match ? Number(match[2]) : 0
    const width = parseFloat(this.style.width) || this.clientWidth || 100
    const height = parseFloat(this.style.height) || this.clientHeight || 24
    return { left, top, right: left + width, bottom: top + height, width, height }
  }
}

class FakeText { constructor(text) { this.nodeType = 3; this.textContent = String(text); this.parentNode = null } }

global.HTMLElement = FakeEl
let pointElement = null
global.document = {
  activeElement: null,
  body: new FakeEl('body'),
  createElement(tag) { return new FakeEl(tag) },
  createTextNode(text) { return new FakeText(text) },
  createDocumentFragment() { return new FakeEl('fragment') },
  elementFromPoint() { return pointElement },
}
global.window = { aiditor: {} }
window.HTMLElement = FakeEl
const windowEvents = {}
window.addEventListener = function (type, fn) { if (!windowEvents[type]) windowEvents[type] = []; windowEvents[type].push(fn) }
window.removeEventListener = function (type, fn) { const list = windowEvents[type] || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
window.dispatch = function (type, event) { const list = (windowEvents[type] || []).slice(); for (let i = 0; i < list.length; i++) list[i](event) }
global.requestAnimationFrame = function (fn) { fn(); return 1 }
global.cancelAnimationFrame = function () {}
global.getComputedStyle = function (el) {
  return { getPropertyValue(name) { return el && el.style && el.style[name] || '' } }
}
global.DataTransferItem = function () {}
DataTransferItem.prototype.webkitGetAsEntry = function () {}

for (const file of ['src/core/signal.js', 'src/core/log.js', 'src/ui/_internal/_signal.js', 'src/ui/_internal/_css.js', 'src/ui/_internal/_edit-session.js']) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui
const flush = function () { return new Promise(function (resolve) { setImmediate(resolve) }) }
ui.menu = function () { return { close() {} } }

for (const file of ['src/ui/base/icon.js', 'src/ui/base/iconButton.js', 'src/ui/form/input.js', 'src/ui/form/searchInput.js', 'src/ui/_internal/_dnd.js', 'src/ui/data/tree.js', 'src/ui/data/tree-dnd.js', 'src/ui/data/collectionBrowser.js', 'src/ui/data/fileBrowser.js']) {
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
const retainedChild = tree.__aiditorTree.getRowEl('child')

const failedRefresh = tree.__aiditorTree.invalidateChildren('root')
assert.equal(loads.length, 2)
assert.deepEqual(tree.__aiditorTree.getFlat().map(function (row) { return row.node.id }), ['root', 'child'])
assert.equal(tree.__aiditorTree.getRowEl('child'), retainedChild)
loads[1].reject(new Error('read failed'))
await failedRefresh; await flush()
assert.equal(tree.__aiditorTree.loadState('root'), 'error')
assert.equal(tree.__aiditorTree.getFlat()[0].error.message, 'read failed')
assert.equal(tree.__aiditorTree.getRowEl('root').attributes['aria-label'], 'Root, loading failed')
assert.equal(tree.__aiditorTree.getRowEl('child'), retainedChild)
const retry = tree.__aiditorTree.retry('root')
assert.equal(loads.length, 3)
loads[2].resolve([{ id: 'child-2', label: 'Child 2' }])
await retry; await flush()
assert.equal(tree.__aiditorTree.getFlat()[1].node.id, 'child-2')

const explicitRefresh = tree.__aiditorTree.invalidateChildren('root')
assert.equal(loads.length, 4)
tree.__aiditorTree.toggle('root')
assert.equal(loads[3].signal.aborted, false)
loads[3].resolve([{ id: 'child-3', label: 'Child 3' }])
await explicitRefresh; await flush()
tree.__aiditorTree.toggle('root')
assert.equal(loads.length, 4)
assert.equal(tree.__aiditorTree.getFlat()[1].node.id, 'child-3')

treeItems.set([{ id: 'fresh', label: 'Fresh', hasChildren: true }])
expanded.set(new Set())
tree.__aiditorTree.toggle('fresh')
assert.equal(loads.length, 5)
tree.__aiditorTree.toggle('fresh')
assert.equal(loads[4].signal.aborted, true)
tree.__aiditorTree.toggle('fresh')
assert.equal(loads.length, 6)
treeItems.set([])
assert.equal(loads[5].signal.aborted, true)
ui.dispose(tree)

const ownershipItems = aiditor.signal([
  { id: 'lazy-leaf', label: 'Lazy to leaf', hasChildren: true },
  { id: 'lazy-empty', label: 'Lazy to empty static', hasChildren: true },
])
const ownershipLoads = []
const ownershipTree = ui.tree({
  items: ownershipItems,
  expanded: aiditor.signal(new Set(['lazy-leaf', 'lazy-empty'])),
  loadChildren(node, signal) {
    return new Promise(function (resolve) {
      ownershipLoads.push({ id: node.id, signal, resolve })
    })
  },
})
ownershipLoads.find(function (load) { return load.id === 'lazy-leaf' }).resolve([{ id: 'cached-leaf-child' }])
ownershipLoads.find(function (load) { return load.id === 'lazy-empty' }).resolve([{ id: 'cached-empty-child' }])
await flush(); await flush()
assert.deepEqual(flatIds(ownershipTree), ['lazy-leaf', 'cached-leaf-child', 'lazy-empty', 'cached-empty-child'])
const staleOwnershipRefresh = ownershipTree.__aiditorTree.invalidateChildren(['lazy-leaf', 'lazy-empty'])
assert.equal(ownershipLoads.length, 4)
ownershipItems.set([
  { id: 'lazy-leaf', label: 'Now a leaf', hasChildren: false },
  { id: 'lazy-empty', label: 'Now static empty', hasChildren: true, children: [] },
])
await staleOwnershipRefresh; await flush()
assert.deepEqual(flatIds(ownershipTree), ['lazy-leaf', 'lazy-empty'])
assert.equal(ownershipLoads[2].signal.aborted, true)
assert.equal(ownershipLoads[3].signal.aborted, true)
assert.equal(ownershipTree.__aiditorTree.loadState('lazy-leaf'), 'idle')
assert.equal(ownershipTree.__aiditorTree.loadState('lazy-empty'), 'idle')
await ownershipTree.__aiditorTree.invalidateChildren(['lazy-leaf', 'lazy-empty'])
assert.equal(ownershipLoads.length, 4)
ownershipItems.set([
  { id: 'lazy-leaf', label: 'Still a leaf', hasChildren: false },
  { id: 'lazy-empty', label: 'Lazy again', hasChildren: true },
])
assert.equal(ownershipLoads.length, 5)
ownershipLoads[4].resolve([{ id: 'fresh-lazy-child' }])
await flush()
assert.deepEqual(flatIds(ownershipTree), ['lazy-leaf', 'lazy-empty', 'fresh-lazy-child'])
ui.dispose(ownershipTree)

const stableItems = aiditor.signal([
  { id: 'a', label: 'A', icon: 'file-a' },
  { id: 'b', label: 'B', icon: 'file-b' },
  { id: 'c', label: 'C', icon: 'file-c' },
])
let stableActionBuilds = 0
const stableActionMode = aiditor.signal('action')
const stableTree = ui.tree({
  items: stableItems,
  selected: aiditor.signal(['a']),
  actions(node) {
    stableActionBuilds++
    return [{ id: 'open', icon: stableActionMode() + '-' + node.label, title: 'Open ' + node.label, onClick() {} }]
  },
})
assert.equal(stableActionBuilds, 3)
stableTree.scrollTop = 41
const rowA = stableTree.__aiditorTree.getRowEl('a')
const rowB = stableTree.__aiditorTree.getRowEl('b')
const rowC = stableTree.__aiditorTree.getRowEl('c')
const labelA = rowA.querySelector('.aiditor-ui-tree-label')
const actionA = rowA.querySelector('button')
const nodeIconA = rowA.querySelector('.aiditor-ui-tree-leading').querySelector('.aiditor-ui-icon')
const actionIconA = actionA.querySelector('.aiditor-ui-icon')
assert.equal(nodeIconA.textContent, 'file-a')
assert.equal(actionIconA.textContent, 'action-A')
stableActionMode.set('alternate')
assert.equal(stableActionBuilds, 3)
assert.equal(actionIconA.textContent, 'action-A')
stableActionMode.set('action')
assert.equal(stableActionBuilds, 3)
actionA.focus()
stableItems.set([
  { id: 'a', label: 'A updated', icon: 'file-a-updated' },
  { id: 'b', label: 'B updated', icon: 'file-b' },
  { id: 'c', label: 'C updated', icon: 'file-c' },
])
assert.equal(stableActionBuilds, 6)
assert.equal(stableTree.__aiditorTree.getRowEl('a'), rowA)
assert.equal(stableTree.__aiditorTree.getRowEl('b'), rowB)
assert.equal(stableTree.__aiditorTree.getRowEl('c'), rowC)
assert.equal(rowA.querySelector('.aiditor-ui-tree-label'), labelA)
assert.equal(labelA.textContent, 'A updated')
assert.equal(rowA.querySelector('button'), actionA)
assert.equal(rowA.querySelector('.aiditor-ui-tree-leading').querySelector('.aiditor-ui-icon'), nodeIconA)
assert.equal(actionA.querySelector('.aiditor-ui-icon'), actionIconA)
assert.equal(nodeIconA.textContent, 'file-a-updated')
assert.equal(actionIconA.textContent, 'action-A updated')
assert.equal(document.activeElement, actionA)
assert.equal(stableTree.scrollTop, 41)

const stableWindow = rowA.parentNode
const insertBefore = stableWindow.insertBefore.bind(stableWindow)
let movedRows = 0
stableWindow.insertBefore = function (child, before) {
  if (child.parentNode === stableWindow) movedRows++
  return insertBefore(child, before)
}
stableItems.set([
  { id: 'b', label: 'B updated', icon: 'file-b' },
  { id: 'c', label: 'C updated', icon: 'file-c' },
  { id: 'a', label: 'A updated', icon: 'file-a-updated' },
])
assert.equal(stableActionBuilds, 9)
assert.equal(movedRows, 1)
assert.deepEqual(stableTree.__aiditorTree.getFlat().map(function (row) { return row.node.id }), ['b', 'c', 'a'])
assert.equal(stableTree.__aiditorTree.getRowEl('a'), rowA)
assert.equal(stableTree.__aiditorTree.getRowEl('b'), rowB)
assert.equal(stableTree.__aiditorTree.getRowEl('c'), rowC)
assert.equal(document.activeElement, actionA)
assert.equal(stableTree.scrollTop, 41)
ui.dispose(stableTree)

const movedNode = { id: 'static-moving', label: 'Static moving' }
const unrelatedNode = { id: 'unrelated', label: 'Unrelated' }
const staticParents = aiditor.signal([
  { id: 'parent-a', label: 'Parent A', children: [movedNode] },
  { id: 'parent-b', label: 'Parent B', children: [] },
  unrelatedNode,
])
const slotNodes = new Map()
let unrelatedUpdates = 0
const staticMoveTree = ui.tree({
  items: staticParents,
  expanded: aiditor.signal(new Set(['parent-a', 'parent-b'])),
  trailingSlot(node) {
    if (node.id === 'unrelated') unrelatedUpdates++
    if (!slotNodes.has(node.id)) slotNodes.set(node.id, ui.h('span', '', { text: node.id }))
    return slotNodes.get(node.id)
  },
})
const staticMovingRow = staticMoveTree.__aiditorTree.getRowEl('static-moving')
const unrelatedRow = staticMoveTree.__aiditorTree.getRowEl('unrelated')
assert.equal(unrelatedUpdates, 1)
staticParents.set([
  { id: 'parent-a', label: 'Parent A', children: [] },
  { id: 'parent-b', label: 'Parent B', children: [movedNode] },
  unrelatedNode,
])
assert.equal(staticMoveTree.__aiditorTree.getRowEl('static-moving'), staticMovingRow)
assert.equal(staticMoveTree.__aiditorTree.getRowEl('unrelated'), unrelatedRow)
assert.equal(unrelatedUpdates, 1)
ui.dispose(staticMoveTree)

function flatIds(treeEl) {
  return treeEl.__aiditorTree.getFlat().map(function (row) { return row.node.id })
}
function assertUniqueProjection(treeEl) {
  const ids = flatIds(treeEl)
  assert.equal(new Set(ids).size, ids.length)
}

const batchLoads = []
const batchTree = ui.tree({
  items: [
    { id: 'x', label: 'X', hasChildren: true },
    { id: 'y', label: 'Y', hasChildren: true },
  ],
  expanded: aiditor.signal(new Set(['x', 'y'])),
  loadChildren(node, signal) {
    return new Promise(function (resolve, reject) {
      batchLoads.push({ id: node.id, signal, resolve, reject })
    })
  },
})
assert.equal(batchLoads.length, 2)
batchLoads.find(function (load) { return load.id === 'x' }).resolve([{ id: 'moving', label: 'Moving' }])
batchLoads.find(function (load) { return load.id === 'y' }).resolve([])
await flush(); await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'moving', 'y'])
const movingRow = batchTree.__aiditorTree.getRowEl('moving')

const moveBatch = batchTree.__aiditorTree.invalidateChildren(['x', 'y'])
assert.equal(batchLoads.length, 4)
batchLoads[3].resolve([{ id: 'moving', label: 'Moving at Y' }])
await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'moving', 'y'])
assertUniqueProjection(batchTree)
assert.equal(batchTree.__aiditorTree.getRowEl('moving'), movingRow)
batchLoads[2].resolve([])
await moveBatch; await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'y', 'moving'])
assertUniqueProjection(batchTree)
assert.equal(batchTree.__aiditorTree.getRowEl('moving'), movingRow)

const failedBatch = batchTree.__aiditorTree.invalidateChildren(['x', 'y'])
batchLoads[4].resolve([{ id: 'moving', label: 'Moving at X' }])
await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'y', 'moving'])
batchLoads[5].reject(new Error('Y refresh failed'))
await failedBatch; await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'y', 'moving'])
assert.equal(batchTree.__aiditorTree.loadState('x'), 'error')
assert.equal(batchTree.__aiditorTree.loadState('y'), 'error')
assert.equal(batchTree.__aiditorTree.getRowEl('moving'), movingRow)

const retryBatch = batchTree.__aiditorTree.retry('x')
assert.equal(batchLoads.length, 8)
batchLoads[6].resolve([{ id: 'moving', label: 'Moving at X' }])
batchLoads[7].resolve([])
await retryBatch; await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'moving', 'y'])
assert.equal(batchTree.__aiditorTree.getRowEl('moving'), movingRow)

const duplicateBatch = batchTree.__aiditorTree.invalidateChildren(['x', 'y'])
batchLoads[8].resolve([{ id: 'moving', label: 'Moving duplicate X' }])
batchLoads[9].resolve([{ id: 'moving', label: 'Moving duplicate Y' }])
await duplicateBatch; await flush()
assert.deepEqual(flatIds(batchTree), ['x', 'moving', 'y'])
assert.equal(batchTree.__aiditorTree.loadState('x'), 'error')
assert.equal(batchTree.__aiditorTree.loadState('y'), 'error')
assert.equal(batchTree.__aiditorTree.getFlat()[0].error.refreshCause.name, 'AiditorTreeDuplicateIdError')
assert.equal(batchTree.__aiditorTree.getRowEl('moving'), movingRow)
ui.dispose(batchTree)

let dndLoad = null
let dropped = 0
const dndTree = ui.tree({
  items: [{ id: 'dnd-root', label: 'DnD root', hasChildren: true }],
  expanded: aiditor.signal(new Set(['dnd-root'])),
  loadChildren(node, signal) {
    return new Promise(function (resolve) { dndLoad = { node, signal, resolve } })
  },
  dnd: {
    onDrop() { dropped++ },
  },
})
dndLoad.resolve([{ id: 'dnd-child', label: 'DnD child' }])
await flush()
dndTree.getBoundingClientRect = function () { return { left: 0, top: -100, right: 200, bottom: 300, width: 200, height: 400 } }
const dndRootRow = dndTree.__aiditorTree.getRowEl('dnd-root')
const dndChildRow = dndTree.__aiditorTree.getRowEl('dnd-child')
pointElement = dndRootRow
dndTree.dispatch('pointerdown', { button: 0, clientX: 8, clientY: 12, target: dndRootRow })
pointElement = dndChildRow
window.dispatch('pointermove', { clientX: 40, clientY: 12 })
window.dispatch('pointerup', { clientX: 40, clientY: 12 })
assert.equal(dropped, 0)
ui.dispose(dndTree)

let policyAllowsDrop = true
let policyChecks = 0
let dropZoneChecks = 0
let policyDrops = 0
const policyTree = ui.tree({
  items: [{ id: 'policy-source' }, { id: 'policy-target' }],
  dnd: {
    dropZones() { dropZoneChecks++; return ['inside'] },
    canDrop() { policyChecks++; return policyAllowsDrop },
    onDrop() { policyDrops++ },
  },
})
policyTree.getBoundingClientRect = function () { return { left: 0, top: -100, right: 200, bottom: 300, width: 200, height: 400 } }
const policySourceRow = policyTree.__aiditorTree.getRowEl('policy-source')
const policyTargetRow = policyTree.__aiditorTree.getRowEl('policy-target')
pointElement = policySourceRow
policyTree.dispatch('pointerdown', { button: 0, clientX: 8, clientY: 12, target: policySourceRow })
pointElement = policyTargetRow
window.dispatch('pointermove', { clientX: 40, clientY: 12 })
assert.equal(policyChecks, 1)
assert.equal(dropZoneChecks, 1)
policyAllowsDrop = false
window.dispatch('pointerup', { clientX: 40, clientY: 12 })
assert.equal(policyChecks, 2)
assert.equal(dropZoneChecks, 2)
assert.equal(policyDrops, 0)
ui.dispose(policyTree)

const movingTarget = { id: 'moving-target', label: 'Moving target' }
const movingDndItems = aiditor.signal([
  { id: 'moving-source', label: 'Moving source', children: [] },
  movingTarget,
])
let movingPolicyChecks = 0
let movingDrops = 0
const movingDndTree = ui.tree({
  items: movingDndItems,
  expanded: aiditor.signal(new Set(['moving-source'])),
  dnd: {
    canDrop() { movingPolicyChecks++; return true },
    onDrop() { movingDrops++ },
  },
})
movingDndTree.getBoundingClientRect = function () { return { left: 0, top: -100, right: 200, bottom: 300, width: 200, height: 400 } }
const movingSourceRow = movingDndTree.__aiditorTree.getRowEl('moving-source')
const movingTargetRow = movingDndTree.__aiditorTree.getRowEl('moving-target')
pointElement = movingSourceRow
movingDndTree.dispatch('pointerdown', { button: 0, clientX: 8, clientY: 12, target: movingSourceRow })
pointElement = movingTargetRow
window.dispatch('pointermove', { clientX: 40, clientY: 12 })
assert.equal(movingPolicyChecks, 1)
movingDndItems.set([{
  id: 'moving-source', label: 'Moving source', children: [movingTarget],
}])
assert.equal(movingDndTree.__aiditorTree.getRowEl('moving-target'), movingTargetRow)
window.dispatch('pointerup', { clientX: 40, clientY: 12 })
assert.equal(movingDrops, 0)
ui.dispose(movingDndTree)

assert.throws(function () {
  ui.tree({ items: [{ id: 'duplicate' }, { id: 'duplicate' }] })
}, /duplicate node\.id/)

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
let rows = browser.querySelectorAll('.aiditor-ui-collection-item')
assert.deepEqual(rows.map(function (row) { return row.dataset.key }), ['folder', 'a.txt', 'b.txt'])
const retained = rows[2]
browserEntries.set([
  { id: 'b.txt', name: 'b-renamed.txt', path: 'b.txt', kind: 'file', size: 2 },
  { id: 'folder', name: 'folder', path: 'folder', kind: 'directory' },
  { id: 'a.txt', name: 'a.txt', path: 'a.txt', kind: 'file', size: 1 },
])
rows = browser.querySelectorAll('.aiditor-ui-collection-item')
assert.equal(rows[2], retained)
assert.equal(retained.querySelector('.aiditor-ui-filename').textContent, 'b-renamed.txt')
rows[1].dispatch('click', { ctrlKey: false, metaKey: false, shiftKey: false })
assert.deepEqual(browserSelected.peek(), ['a.txt'])
rows[0].dispatch('dblclick', {})
assert.equal(browserPath.peek(), 'folder')
browserView.set('list')
assert.equal(browser.querySelector('.aiditor-ui-collection-viewport').dataset.layout, 'list')
assert.equal(browser.querySelector('.aiditor-ui-filethumb').querySelector('.aiditor-ui-icon').textContent, 'folder')
const searchInput = browser.querySelector('input')
searchInput.value = 'renamed'
searchInput.dispatch('input', { target: searchInput })
assert.deepEqual(browser.__aiditorFileBrowser.getVisibleEntries().map(function (entry) { return entry.id }), ['b.txt'])
ui.dispose(browser)

const collectionItems = aiditor.signal(Array.from({ length: 1000 }, function (_, index) {
  return { id: 'item-' + index, label: 'Item ' + index, detail: 'Detail ' + index }
}))
const collectionSelected = aiditor.signal([])
const collectionView = aiditor.signal('rows')
let renderCount = 0
let disposeCount = 0
let readonlyChecked = false
let activated = null
const collection = ui.collectionBrowser({
  items: collectionItems,
  selected: collectionSelected,
  view: collectionView,
  views: [{ id: 'rows', layout: 'list', label: 'Rows' }],
  searchable: false,
  getKey(item) { return item.id },
  getLabel(item) { return item.label },
  renderItem(itemSignal, ctx) {
    renderCount++
    readonlyChecked = readonlyChecked || (
      typeof itemSignal.set === 'undefined' &&
      typeof ctx.index.set === 'undefined' &&
      typeof ctx.selected.set === 'undefined' &&
      typeof ctx.focused.set === 'undefined' &&
      typeof ctx.view.set === 'undefined'
    )
    const el = document.createElement('div')
    ui.bind(el, itemSignal, function (item) { el.textContent = item.label })
    ui.collect(el, function () { disposeCount++ })
    return el
  },
  onActivate(item) { activated = item.id },
})
const collectionHandle = collection.__aiditorCollectionBrowser
let rendered = collection.querySelectorAll('.aiditor-ui-collection-item')
assert.equal(readonlyChecked, true)
assert.equal(rendered.length < 40, true)
assert.equal(renderCount, rendered.length)
const firstItemEl = rendered.find(function (row) { return row.dataset.key === 'item-0' })
const updatedItems = collectionItems.peek().slice()
updatedItems[0] = { id: 'item-0', label: 'Updated item 0', detail: 'Updated' }
collectionItems.set(updatedItems)
assert.equal(collection.querySelectorAll('.aiditor-ui-collection-item').find(function (row) { return row.dataset.key === 'item-0' }), firstItemEl)
assert.equal(firstItemEl.children[0].textContent, 'Updated item 0')

assert.equal(collectionHandle.scrollToKey('item-500'), true)
rendered = collection.querySelectorAll('.aiditor-ui-collection-item')
assert.equal(rendered.length < 40, true)
const item500 = rendered.find(function (row) { return row.dataset.key === 'item-500' })
assert.ok(item500)
assert.equal(item500.getAttribute('aria-posinset'), '501')
assert.equal(item500.getAttribute('aria-setsize'), '1000')
const reordered = collectionItems.peek().slice()
const moved = reordered[500]
reordered[500] = reordered[501]
reordered[501] = moved
collectionItems.set(reordered)
assert.equal(collection.querySelectorAll('.aiditor-ui-collection-item').find(function (row) { return row.dataset.key === 'item-500' }), item500)
assert.equal(item500.getAttribute('aria-posinset'), '502')

item500.dispatch('click', {})
assert.deepEqual(collectionSelected.peek(), ['item-500'])
const collectionViewport = collection.querySelector('.aiditor-ui-collection-viewport')
collectionViewport.dispatch('keydown', { key: 'ArrowDown', shiftKey: true })
assert.deepEqual(collectionSelected.peek(), ['item-500', 'item-502'])
collectionViewport.dispatch('keydown', { key: 'a', ctrlKey: true })
assert.equal(collectionSelected.peek().length, 1000)
collectionViewport.dispatch('keydown', { key: 'Escape' })
assert.deepEqual(collectionSelected.peek(), [])
item500.dispatch('click', {})
collectionViewport.dispatch('keydown', { key: 'Enter' })
assert.equal(activated, 'item-500')

const previousRaf = global.requestAnimationFrame
let marqueeTick = null
global.requestAnimationFrame = function (fn) { marqueeTick = fn; return 77 }
collectionViewport.dispatch('pointerdown', { button: 0, pointerId: 4, clientX: 300, clientY: 120 })
collectionViewport.dispatch('pointermove', { pointerId: 4, clientX: 310, clientY: 239 })
assert.ok(marqueeTick)
const beforeMarqueeScroll = collectionViewport.scrollTop
marqueeTick()
assert.equal(collectionViewport.scrollTop > beforeMarqueeScroll, true)
collectionViewport.dispatch('pointercancel', { pointerId: 4 })
global.requestAnimationFrame = previousRaf

const originalDragSource = ui.dragsource
const originalDropzone = ui.dropzone
let dragSourceUses = 0
let dropzoneUses = 0
let capturedDropzone = null
let latestDropContext = null
let collectionDropped = false
ui.dragsource = function (el, options) { dragSourceUses++; return originalDragSource(el, options) }
ui.dropzone = function (el, options) { dropzoneUses++; capturedDropzone = options; return originalDropzone(el, options) }
const dndCollection = ui.collectionBrowser({
  items: [{ id: 'drag', label: 'Drag' }],
  selected: aiditor.signal(['drag']),
  view: aiditor.signal('icons'),
  searchable: false,
  getKey(item) { return item.id },
  dragData() { return { 'text/plain': 'drag' } },
  canDrop(ctx) { latestDropContext = ctx; return true },
  async onDrop(ctx) { latestDropContext = ctx; collectionDropped = true },
})
assert.equal(dragSourceUses, 1)
assert.equal(dropzoneUses, 1)
const dndRow = dndCollection.querySelector('.aiditor-ui-collection-item')
assert.equal(capturedDropzone.canDrop({ text: 'drag' }, { type: 'dragover', target: dndRow, clientY: 12 }), true)
assert.equal(latestDropContext.phase, 'hover')
assert.deepEqual(latestDropContext.selectedItems.map(function (item) { return item.id }), ['drag'])
assert.equal('items' in latestDropContext, false)
capturedDropzone.onDrop({ text: 'drag' }, { type: 'drop', target: dndRow, clientY: 12 })
assert.equal(collectionDropped, true)
assert.equal(latestDropContext.phase, 'drop')
assert.equal(dndCollection.querySelector('.aiditor-ui-collection-default-label').textContent, 'Drag')
ui.dispose(dndCollection)
ui.dragsource = originalDragSource
ui.dropzone = originalDropzone

assert.throws(function () {
  ui.collectionBrowser({
    items: [{ id: 'same' }, { id: 'same' }],
    selected: aiditor.signal([]),
    searchable: false,
    getKey(item) { return item.id },
  })
}, /duplicate key/)

const mountedBeforeDispose = collectionHandle.getRenderedKeys().length
ui.dispose(collection)
assert.equal(disposeCount >= mountedBeforeDispose, true)
assert.equal(disposeCount, renderCount)

console.log('collection/file browser, async tree, and external drop tests ok')

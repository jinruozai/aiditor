import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function makeClassList(el) {
  return {
    add: function () {
      for (let i = 0; i < arguments.length; i++) {
        if (!el._classes.includes(arguments[i])) el._classes.push(arguments[i])
      }
      el.className = el._classes.join(' ')
    },
    remove: function () {
      for (let i = 0; i < arguments.length; i++) {
        const at = el._classes.indexOf(arguments[i])
        if (at >= 0) el._classes.splice(at, 1)
      }
      el.className = el._classes.join(' ')
    },
    toggle: function (name, value) {
      const has = el._classes.includes(name)
      const next = value == null ? !has : !!value
      if (next && !has) this.add(name)
      if (!next && has) this.remove(name)
    },
    contains: function (name) { return el._classes.includes(name) },
  }
}

function setConnected(el, value) {
  if (!el || el.isConnected === value) return
  el.isConnected = value
  if (!value && el.disconnectedCallback) el.disconnectedCallback()
  if (!value && el.__resizeObservers) {
    for (let i = 0; i < el.__resizeObservers.length; i++) {
      if (el.__resizeObservers[i].active && el.__probeName) stat(el.__probeName).resizeDisconnects++
    }
  }
  for (let i = 0; i < el.children.length; i++) setConnected(el.children[i], value)
}

function element(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    className: '',
    _classes: [],
    children: [],
    parentNode: null,
    parentElement: null,
    dataset: {},
    style: {},
    attrs: {},
    events: {},
    textContent: '',
    isConnected: false,
    replaceChildrenCount: 0,
    replaceChildCount: 0,
    classList: null,
    appendChild: function (child) { return this.insertBefore(child, null) },
    insertBefore: function (child, before) {
      if (child === before) return child
      if (child.parentNode) child.parentNode.removeChild(child)
      const at = before ? this.children.indexOf(before) : -1
      if (at >= 0) this.children.splice(at, 0, child)
      else this.children.push(child)
      child.parentNode = this
      child.parentElement = this
      if (this.isConnected) setConnected(child, true)
      return child
    },
    replaceChild: function (next, prev) {
      const at = this.children.indexOf(prev)
      if (at < 0) throw new Error('replaceChild: child not found')
      this.replaceChildCount++
      if (next.parentNode) next.parentNode.removeChild(next)
      setConnected(prev, false)
      prev.parentNode = null
      prev.parentElement = null
      this.children[at] = next
      next.parentNode = this
      next.parentElement = this
      if (this.isConnected) setConnected(next, true)
      return prev
    },
    removeChild: function (child) {
      const at = this.children.indexOf(child)
      if (at < 0) throw new Error('removeChild: child not found')
      this.children.splice(at, 1)
      if (this.isConnected) setConnected(child, false)
      child.parentNode = null
      child.parentElement = null
      return child
    },
    replaceChildren: function () {
      this.replaceChildrenCount++
      while (this.firstChild) this.removeChild(this.firstChild)
      for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i])
    },
    remove: function () { if (this.parentNode) this.parentNode.removeChild(this) },
    setAttribute: function (name, value) { this.attrs[name] = String(value) },
    addEventListener: function (type, fn) {
      if (!this.events[type]) this.events[type] = []
      this.events[type].push(fn)
    },
    removeEventListener: function () {},
    setPointerCapture: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } },
    closest: function (selector) {
      if (!selector || selector[0] !== '.') return null
      const cls = selector.slice(1)
      let cur = this
      while (cur) {
        if (cur.classList && cur.classList.contains(cls)) return cur
        cur = cur.parentElement
      }
      return null
    },
    querySelectorAll: function (selector) {
      if (selector !== ':scope > .aiditor-split-child') return []
      return this.children.filter(function (child) { return child.classList && child.classList.contains('aiditor-split-child') })
    },
  }
  Object.defineProperty(el, 'firstChild', { get: function () { return this.children[0] || null } })
  Object.defineProperty(el, 'childNodes', { get: function () { return this.children } })
  Object.defineProperty(el, 'firstElementChild', { get: function () { return this.children.find(function (child) { return child.nodeType === 1 }) || null } })
  Object.defineProperty(el, 'nextSibling', {
    get: function () {
      if (!this.parentNode) return null
      const at = this.parentNode.children.indexOf(this)
      return at >= 0 ? this.parentNode.children[at + 1] || null : null
    },
  })
  Object.defineProperty(el, 'nextElementSibling', {
    get: function () {
      let next = this.nextSibling
      while (next && next.nodeType !== 1) next = next.nextSibling
      return next
    },
  })
  el.classList = makeClassList(el)
  return el
}

const listeners = {}
const stats = {}

function stat(name) {
  if (!stats[name]) stats[name] = { mounts: 0, disconnects: 0, disposes: 0, resizeDisconnects: 0 }
  return stats[name]
}

function resetProbe(name) {
  const s = stat(name)
  s.disconnects = 0
  s.disposes = 0
  s.resizeDisconnects = 0
}

global.window = {
  aiditor: {
    ui: {},
  },
  addEventListener: function (type, fn) {
    if (!listeners[type]) listeners[type] = []
    listeners[type].push(fn)
  },
  removeEventListener: function () {},
}
global.document = {
  createElement: function (tag) { return element(tag) },
  body: element('body'),
}
global.MutationObserver = function () {
  this.observe = function () {}
  this.disconnect = function () {}
}
global.ResizeObserver = function () {
  this.active = true
  this.observe = function (el) {
    if (!el.__resizeObservers) el.__resizeObservers = []
    el.__resizeObservers.push(this)
  }
  this.disconnect = function () { this.active = false }
}

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/bus.js',
  'src/core/names.js',
  'src/core/registry.js',
  'src/tree/tree.js',
  'src/core/context.js',
  'src/dock/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
aiditor._dock.attachCornerDrag = function () {}
aiditor._dock.attachSplitterDrag = function () {}

for (const file of [
  'src/dock/render.js',
  'src/dock/layout.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

function registerProbe(name) {
  aiditor.registerComponent('probe.' + name, {
    factory: function () {
      const s = stat(name)
      s.mounts++
      const el = document.createElement('probe-' + name)
      el.__probeName = name
      el.textContent = name
      el.disconnectedCallback = function () { s.disconnects++ }
      const ro = new ResizeObserver(function () {})
      ro.observe(el)
      return el
    },
    dispose: function () { stat(name).disposes++ },
  })
}

;['left-a', 'left-b', 'right-chat', 'nested-a', 'nested-b', 'solo-move'].forEach(registerProbe)
aiditor.registerComponent('probe.split-view', {
  defaults: function () {
    return { title: 'Default Split', props: { uri: 'default://empty' } }
  },
  factory: function () {
    const s = stat('split-view')
    s.mounts++
    const el = document.createElement('probe-split-view')
    el.__probeName = 'split-view'
    return el
  },
  dispose: function () { stat('split-view').disposes++ },
})

const leftA = aiditor.panel({ component: 'probe.left-a', title: 'Left A', transient: true })
const leftB = aiditor.panel({ component: 'probe.left-b', title: 'Left B' })
const rightChat = aiditor.panel({ component: 'probe.right-chat', title: 'Right Chat' })
const leftDock = aiditor.dock({ name: 'left', panels: [leftA, leftB] })
const rightDock = aiditor.dock({ name: 'right', panels: [rightChat] })
const tree = aiditor.split('horizontal', [leftDock, rightDock], [0.35, 0.65])
const container = document.createElement('div')
setConnected(container, true)
const layout = aiditor.createDockLayout(container, { tree: tree })

const rightRuntime = layout._runtime.dockRuntimes.get(rightDock.id)
const rightEl = rightRuntime.contentEl.firstChild
assert.equal(rightEl.isConnected, true)
assert.equal(stat('right-chat').mounts, 1)

resetProbe('right-chat')
const replaceChildrenCount = container.replaceChildrenCount
layout.activatePanel(leftB.id)
assert.equal(rightRuntime.contentEl.firstChild, rightEl)
assert.equal(rightEl.isConnected, true)
assert.equal(stat('right-chat').disconnects, 0)
assert.equal(stat('right-chat').disposes, 0)
assert.equal(stat('right-chat').mounts, 1)
assert.equal(stat('right-chat').resizeDisconnects, 0)
assert.equal(container.replaceChildrenCount, replaceChildrenCount)

layout.promotePanel(leftA.id)
assert.equal(rightRuntime.contentEl.firstChild, rightEl)
assert.equal(rightEl.isConnected, true)
assert.equal(stat('right-chat').disconnects, 0)
assert.equal(stat('right-chat').disposes, 0)
assert.equal(stat('right-chat').resizeDisconnects, 0)

const movedLeftB = layout._runtime.dockRuntimes.get(leftDock.id).panelRuntimes.get(leftB.id).contentEl
layout.movePanel(leftB.id, rightDock.id)
const movedRuntime = layout._runtime.dockRuntimes.get(rightDock.id).panelRuntimes.get(leftB.id)
assert.equal(movedRuntime.contentEl, movedLeftB)
assert.equal(stat('left-b').mounts, 1)
assert.equal(stat('left-b').disposes, 0)
assert.equal(movedRuntime.contentEl.isConnected, true)

const soloPanel = aiditor.panel({ component: 'probe.solo-move', title: 'Solo Move' })
const soloSource = aiditor.dock({ name: 'solo-source', panels: [soloPanel] })
const soloDest = aiditor.dock({ name: 'solo-dest', panels: [] })
const soloContainer = document.createElement('div')
setConnected(soloContainer, true)
const soloLayout = aiditor.createDockLayout(soloContainer, {
  tree: aiditor.split('horizontal', [soloSource, soloDest], [0.5, 0.5]),
})
const soloEl = soloLayout._runtime.dockRuntimes.get(soloSource.id).contentEl.firstChild
soloLayout.movePanel(soloPanel.id, soloDest.id)
const soloDestRuntime = soloLayout._runtime.dockRuntimes.get(soloDest.id)
const soloMovedRuntime = soloDestRuntime.panelRuntimes.get(soloPanel.id)
assert.equal(soloMovedRuntime.contentEl, soloEl)
assert.equal(stat('solo-move').mounts, 1)
assert.equal(stat('solo-move').disposes, 0)
assert.equal(soloMovedRuntime.contentEl.isConnected, true)

const nestedA1 = aiditor.panel({ component: 'probe.nested-a', title: 'Nested A1' })
const nestedA2 = aiditor.panel({ component: 'probe.left-a', title: 'Nested A2' })
const nestedB = aiditor.panel({ component: 'probe.nested-b', title: 'Nested B' })
const nestedDockA = aiditor.dock({ name: 'nested-a', panels: [nestedA1, nestedA2] })
const nestedDockB = aiditor.dock({ name: 'nested-b', panels: [nestedB] })
const nestedTree = aiditor.split('horizontal', [
  aiditor.split('vertical', [nestedDockA, nestedDockB], [0.5, 0.5]),
  aiditor.dock({ name: 'empty-side' }),
], [0.6, 0.4])
const nestedContainer = document.createElement('div')
setConnected(nestedContainer, true)
const nestedLayout = aiditor.createDockLayout(nestedContainer, { tree: nestedTree })
const nestedBRuntime = nestedLayout._runtime.dockRuntimes.get(nestedDockB.id)
const nestedBEl = nestedBRuntime.contentEl.firstChild
resetProbe('nested-b')
nestedLayout.activatePanel(nestedA2.id)
assert.equal(nestedBRuntime.contentEl.firstChild, nestedBEl)
assert.equal(nestedBEl.isConnected, true)
assert.equal(stat('nested-b').disconnects, 0)
assert.equal(stat('nested-b').disposes, 0)
assert.equal(stat('nested-b').resizeDisconnects, 0)

const splitPanelA = aiditor.panel({ component: 'probe.left-a', title: 'Inactive' })
const splitPanelB = aiditor.panel({
  component: 'probe.split-view',
  title: 'Cube Scene',
  icon: 'box',
  dirty: true,
  badge: '2',
  sourcePath: 'scene/cube.js',
  props: { uri: 'project://cube.scene', nested: { x: 1 } },
  toolbarItems: [{ component: 'probe.left-b', props: { tool: 'move' }, align: 'end' }],
})
const splitSourceDock = aiditor.dock({
  name: 'split-source',
  toolbar: { direction: 'bottom', items: [{ component: 'probe.left-a', props: { tabs: true } }] },
  accept: ['probe.split-view', 'probe.left-a'],
  removeWhenEmpty: false,
  panels: [splitPanelA, splitPanelB],
  activeId: splitPanelB.id,
})
const splitLayoutContainer = document.createElement('div')
setConnected(splitLayoutContainer, true)
const splitLayout = aiditor.createDockLayout(splitLayoutContainer, { tree: splitSourceDock })
const splitResult = splitLayout.splitDock(splitSourceDock.id, 'horizontal', 'after', 0.4)
const splitDock = aiditor.findDock(splitLayout.tree(), splitResult.newDockId).node
const seeded = splitDock.panels[0]
assert.equal(splitDock.toolbar.direction, 'bottom')
assert.equal(splitDock.accept[0], 'probe.split-view')
assert.equal(splitDock.removeWhenEmpty, false)
assert.equal(splitDock.name, undefined)
assert.equal(splitDock.collapsed, undefined)
assert.equal(splitDock.focused, undefined)
assert.notEqual(seeded.id, splitPanelB.id)
assert.equal(seeded.component, 'probe.split-view')
assert.equal(seeded.title, 'Cube Scene')
assert.equal(seeded.icon, 'box')
assert.equal(seeded.dirty, true)
assert.equal(seeded.badge, '2')
assert.equal(seeded.sourcePath, 'scene/cube.js')
assert.deepEqual(seeded.props, { uri: 'project://cube.scene', nested: { x: 1 } })
assert.notEqual(seeded.props, splitPanelB.props)
assert.equal(seeded.toolbarItems[0].component, 'probe.left-b')
assert.equal(seeded.toolbarItems[0].props.tool, 'move')
assert.equal(splitDock.activeId, seeded.id)
assert.equal(aiditor.findDock(splitLayout.tree(), splitSourceDock.id).node.panels[1].props.uri, 'project://cube.scene')
assert.equal(seeded.props.uri, 'project://cube.scene')

console.log('dock reconcile tests ok')

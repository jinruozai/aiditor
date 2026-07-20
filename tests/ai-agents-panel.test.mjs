import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class ClassList {
  constructor(el) { this.el = el }
  values() { return String(this.el.className || '').split(/\s+/).filter(Boolean) }
  add() {
    const out = new Set(this.values())
    for (let i = 0; i < arguments.length; i++) out.add(arguments[i])
    this.el.className = Array.from(out).join(' ')
  }
  remove() {
    const out = new Set(this.values())
    for (let i = 0; i < arguments.length; i++) out.delete(arguments[i])
    this.el.className = Array.from(out).join(' ')
  }
  contains(value) { return this.values().indexOf(value) >= 0 }
  toggle(value, force) {
    const next = force == null ? !this.contains(value) : !!force
    if (next) this.add(value)
    else this.remove(value)
  }
}

class FakeEl {
  constructor(tag) {
    this.localName = String(tag).toLowerCase()
    this.tagName = this.localName.toUpperCase()
    this.children = []
    this.parentNode = null
    this.className = ''
    this.classList = new ClassList(this)
    this.attributes = {}
    this.dataset = {}
    this.events = {}
    this.style = {}
    this.textContent = ''
    this.hidden = false
    this.disabled = false
    this.scrollTop = 0
    this.clientHeight = 240
  }
  appendChild(child) { return this.insertBefore(child, null) }
  insertBefore(child, before) {
    if (child === before) return child
    if (child.parentNode) child.parentNode.removeChild(child)
    const index = before ? this.children.indexOf(before) : -1
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
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
  get nextSibling() {
    if (!this.parentNode) return null
    const index = this.parentNode.children.indexOf(this)
    return this.parentNode.children[index + 1] || null
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  removeAttribute(name) { delete this.attributes[name] }
  addEventListener(type, fn) {
    if (!this.events[type]) this.events[type] = []
    this.events[type].push(fn)
  }
  removeEventListener(type, fn) {
    const list = this.events[type] || []
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  }
  dispatch(type, event) {
    const ev = event || {}
    ev.type = type
    if (!ev.target) ev.target = this
    ev.currentTarget = this
    if (!ev.preventDefault) ev.preventDefault = function () { this.defaultPrevented = true }
    if (!ev.stopPropagation) ev.stopPropagation = function () { this.cancelBubble = true }
    const list = (this.events[type] || []).slice()
    for (let i = 0; i < list.length; i++) list[i].call(this, ev)
    if (!ev.cancelBubble && this.parentNode) this.parentNode.dispatch(type, ev)
    return ev
  }
  closest(selector) {
    let el = this
    while (el) {
      if (selector[0] === '.' && el.classList.contains(selector.slice(1))) return el
      el = el.parentNode
    }
    return null
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) {
    const out = []
    const matches = selector[0] === '.'
      ? function (el) { return el.classList.contains(selector.slice(1)) }
      : function (el) { return el.localName === selector.toLowerCase() }
    function visit(el) {
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i]
        if (matches(child)) out.push(child)
        visit(child)
      }
    }
    visit(this)
    return out
  }
  contains(node) {
    if (node === this) return true
    for (let i = 0; i < this.children.length; i++) if (this.children[i].contains(node)) return true
    return false
  }
  focus() {}
}

global.HTMLElement = FakeEl
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel' }, configurable: true })
global.document = {
  createElement(tag) { return new FakeEl(tag) },
  createDocumentFragment() { return new FakeEl('fragment') },
}
global.requestAnimationFrame = function (fn) { fn() }
global.window = { aiditor: {} }
window.HTMLElement = FakeEl

for (const file of [
  'src/core/signal.js',
  'src/ui/_internal/_signal.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const aiditor = window.aiditor
const ui = aiditor.ui
const components = {}

aiditor.registerComponent = function (name, spec) { components[name] = spec }
ui.icon = function (opts) { return ui.h('span', 'aiditor-ui-icon', { text: opts.name }) }
ui.iconButton = function (opts) {
  const el = ui.h('button', 'aiditor-ui-icon-btn', { type: 'button' })
  el.appendChild(ui.icon({ name: opts.icon }))
  el.addEventListener('click', opts.onClick)
  return el
}
ui.button = function (opts) {
  const el = ui.h('button', 'aiditor-ui-btn', { text: opts.text })
  el.addEventListener('click', opts.onClick)
  return el
}
ui.view = function (opts) {
  const el = ui.h('div', 'aiditor-ui-view ' + (opts.className || ''))
  el.appendChild(opts.children)
  return el
}
ui.tooltip = function () {}
ui.contextMenu = function () {}
ui.prompt = function () { return Promise.resolve(null) }

vm.runInThisContext(readFileSync('src/ui/data/tree.js', 'utf8'), { filename: 'src/ui/data/tree.js' })

const agents = aiditor.signal([
  { id: 'root', name: 'Root', status: 'idle', parentAgentId: null, queue: [], inbox: [], messages: [] },
  { id: 'child', name: 'Child', status: 'idle', parentAgentId: 'root', queue: [{ id: 'q1' }], inbox: [], messages: [] },
])
const activeAgentId = aiditor.signal('root')
const deleted = []
const selected = []

aiditor.ai = {
  agents: agents,
  activeAgentId: activeAgentId,
  selectAgent(id) { selected.push(id); activeAgentId.set(id) },
  deleteAgent(id) { deleted.push(id) },
  createAgent() {},
  renameAgent() {},
  reparentAgent() {},
  isDescendant() { return false },
}

vm.runInThisContext(readFileSync('src/ai/panels/agents.js', 'utf8'), { filename: 'src/ai/panels/agents.js' })

const root = components['ai-agents-list'].factory()
const tree = root.querySelector('.aiditor-ai-agent-tree')
const rootRow = tree.__aiditorTree.getRowEl('agent:root')
const childRow = tree.__aiditorTree.getRowEl('agent:child')
const childDelete = childRow.querySelector('button')
const childTail = childRow.querySelector('.aiditor-ai-agent-tail')

assert.ok(rootRow)
assert.ok(childRow)
assert.equal(childTail.children.length, 2, 'count and actions occupy separate flex slots')
assert.equal(childTail.children[0].textContent, '1')
assert.equal(childTail.children[1].contains(childDelete), true)

// A pooled template keeps one set of row listeners when collapsed and reused.
const rootArrow = rootRow.querySelector('.aiditor-ui-tree-arrow')
rootArrow.dispatch('click', {})
assert.equal(tree.__aiditorTree.getRowEl('agent:child'), null)
rootArrow.dispatch('click', {})
assert.equal(tree.__aiditorTree.getRowEl('agent:child'), childRow)
childRow.dispatch('click', {})
assert.deepEqual(selected, ['child'])
activeAgentId.set('root')

// Message-only streaming updates do not touch the tree projection at all.
agents.set(agents.peek().map(function (agent) {
  return agent.id === 'child' ? Object.assign({}, agent, { messages: [{ id: 'm1', content: 'chunk' }] }) : agent
}))
assert.equal(tree.__aiditorTree.getRowEl('agent:child'), childRow)
assert.equal(childRow.querySelector('button'), childDelete)

// A visible status update patches the template in place, preserving the
// pointer target between pointerdown and click.
childRow.dispatch('pointerdown', { button: 0 })
agents.set(agents.peek().map(function (agent) {
  return agent.id === 'child' ? Object.assign({}, agent, { status: 'running' }) : agent
}))
assert.equal(tree.__aiditorTree.getRowEl('agent:child'), childRow)
assert.equal(childRow.querySelector('button'), childDelete)
assert.equal(childRow.querySelector('.aiditor-ai-agent-dot').classList.contains('aiditor-ai-agent-dot-running'), true)
childRow.dispatch('click', {})
assert.equal(activeAgentId.peek(), 'child')
assert.deepEqual(selected, ['child', 'child'])
assert.equal(childRow.classList.contains('aiditor-ui-tree-row-active'), true)

// The stable action survives another refresh and still targets the live node.
childDelete.dispatch('pointerdown', { button: 0 })
agents.set(agents.peek().map(function (agent) {
  return agent.id === 'child' ? Object.assign({}, agent, { status: 'idle', queue: [] }) : agent
}))
childDelete.dispatch('click', {})
assert.deepEqual(deleted, ['child'])
assert.equal(childTail.children[0].hidden, true)

const css = readFileSync('src/style/ui-ai.css', 'utf8')
const actionRule = css.match(/\.aiditor-ai-agent-actions\s*\{([^}]*)\}/)
assert.ok(actionRule)
assert.doesNotMatch(actionRule[1], /position\s*:\s*absolute/)

console.log('AI agents panel tests ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class FakeText {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = String(value || '')
    this.parentNode = null
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
}

class FakeEl {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.localName = String(tag).toLowerCase()
    this.children = []
    this.parentNode = null
    this.className = ''
    this.dataset = {}
    this.attributes = {}
    this.events = {}
    this.style = {
      values: {},
      setProperty(name, value) { this.values[name] = String(value) },
    }
    this.classList = {
      add: (...names) => {
        const items = new Set(this.className.split(/\s+/).filter(Boolean))
        for (let i = 0; i < names.length; i++) items.add(names[i])
        this.className = Array.from(items).join(' ')
      },
      remove: (...names) => {
        const items = new Set(this.className.split(/\s+/).filter(Boolean))
        for (let i = 0; i < names.length; i++) items.delete(names[i])
        this.className = Array.from(items).join(' ')
      },
      toggle: (name, force) => {
        const items = new Set(this.className.split(/\s+/).filter(Boolean))
        const next = force == null ? !items.has(name) : !!force
        if (next) items.add(name)
        else items.delete(name)
        this.className = Array.from(items).join(' ')
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    }
  }
  get childNodes() { return this.children }
  get firstChild() { return this.children[0] || null }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    this.children.push(child)
    child.parentNode = this
    return child
  }
  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'class') this.className = String(value)
    else this[name] = String(value)
  }
  removeAttribute(name) { delete this.attributes[name] }
  addEventListener(type, fn) { (this.events[type] = this.events[type] || []).push(fn) }
  dispatch(type, input) {
    const ev = Object.assign({
      type: type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true },
    }, input || {})
    const listeners = this.events[type] || []
    for (let i = 0; i < listeners.length; i++) listeners[i](ev)
    return ev
  }
  querySelector(selector) {
    const match = selector[0] === '.'
      ? (el) => el.nodeType === 1 && el.className.split(/\s+/).includes(selector.slice(1))
      : () => false
    const visit = (node) => {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        if (match(child)) return child
        if (child.nodeType === 1) {
          const found = visit(child)
          if (found) return found
        }
      }
      return null
    }
    return visit(this)
  }
  focus() {}
  getBoundingClientRect() { return { height: 200, width: 600 } }
  setPointerCapture() {}
  releasePointerCapture() {}
}

global.document = {
  createElement(tag) { return new FakeEl(tag) },
  createTextNode(value) { return new FakeText(value) },
}
global.window = { aiditor: {}, addEventListener() {}, removeEventListener() {} }

for (const file of [
  'src/core/signal.js',
  'src/ui/_internal/_signal.js',
  'src/ai/rich-prompt.js',
  'src/ai/panels/rich-prompt-input.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui
const rich = aiditor.ai.richPrompt

const inlineValue = aiditor.signal(rich.empty())
let inlineSubmits = 0
const inline = ui.richPromptInput({
  value: inlineValue,
  singleLine: true,
  onSubmit() { inlineSubmits++ },
})
const inlineEditor = inline.__aiditorRichPromptEditor

assert.equal(inline.classList.contains('aiditor-richprompt-single-line'), true)
assert.equal(inlineEditor.attributes['aria-multiline'], 'false')
const inlineEnter = inlineEditor.dispatch('keydown', { key: 'Enter', shiftKey: true })
assert.equal(inlineEnter.defaultPrevented, true)
assert.equal(inlineSubmits, 1)
assert.equal(inlineValue.peek().text, '')

inlineEditor.dispatch('paste', {
  clipboardData: {
    getData(type) { return type === 'text/plain' ? 'first\nsecond\r\nthird' : '' },
  },
})
assert.equal(inlineValue.peek().text, 'first second third')

const standardValue = aiditor.signal(rich.empty())
let standardSubmits = 0
const standard = ui.richPromptInput({
  value: standardValue,
  onSubmit() { standardSubmits++ },
})
const standardEditor = standard.__aiditorRichPromptEditor
assert.equal(standard.classList.contains('aiditor-richprompt-single-line'), false)
assert.equal(standardEditor.attributes['aria-multiline'], 'true')
const standardShiftEnter = standardEditor.dispatch('keydown', { key: 'Enter', shiftKey: true })
assert.equal(standardShiftEnter.defaultPrevented, true)
assert.equal(standardSubmits, 0)
assert.equal(standardValue.peek().text, '\n')

const components = {}
aiditor.registerComponent = function (name, spec) { components[name] = spec }
aiditor.resolveComponent = function (name) { return components[name] }
components['ai-messages'] = { factory() { return new FakeEl('div') } }
components['ai-chatinput'] = { factory(propsSig) {
  const el = new FakeEl('div')
  el.inputProps = propsSig.peek()
  return el
} }

vm.runInThisContext(readFileSync('src/ai/panels/chat-combined.js', 'utf8'), { filename: 'src/ai/panels/chat-combined.js' })

const combined = components['ai-chat']
const inlineCombined = combined.factory({ peek() { return { input: { layout: 'inline' } } } }, {})
assert.equal(inlineCombined.classList.contains('aiditor-ai-chat-combined-inline'), true)
assert.equal(inlineCombined.children.length, 2)
assert.equal(inlineCombined.querySelector('.aiditor-ai-chat-combined-splitter'), null)

const standardCombined = combined.factory({ peek() { return {} } }, {})
assert.equal(standardCombined.classList.contains('aiditor-ai-chat-combined-inline'), false)
assert.equal(standardCombined.children.length, 3)
assert.ok(standardCombined.querySelector('.aiditor-ai-chat-combined-splitter'))
assert.equal(standardCombined.style.values['--aiditor-ai-chat-input-size'], '230px')

console.log('ai chat input tests ok')

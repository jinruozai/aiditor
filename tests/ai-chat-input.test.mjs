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
  removeEventListener(type, fn) {
    const list = this.events[type]
    if (!list) return
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  }
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
  focus() { document.activeElement = this }
  getBoundingClientRect() { return { height: this.rectHeight || 200, width: 600 } }
  setPointerCapture() {}
  releasePointerCapture() {}
}

global.document = {
  activeElement: null,
  documentElement: new FakeEl('html'),
  createElement(tag) { return new FakeEl(tag) },
  createTextNode(value) { return new FakeText(value) },
}
global.window = { aiditor: {}, addEventListener() {}, removeEventListener() {} }
global.getComputedStyle = function () {
  return {
    minHeight: '64px',
    getPropertyValue(name) {
      if (name === '--aiditor-ai-chat-multiline-min-h') return '104px'
      if (name === '--aiditor-ai-chat-input-min-h') return '64px'
      return ''
    },
  }
}

const resizeObservers = []
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback
    this.target = null
    this.disconnected = false
    resizeObservers.push(this)
  }
  observe(target) { this.target = target }
  disconnect() { this.disconnected = true }
  emit(height) { this.callback([{ target: this.target, contentRect: { height: height } }]) }
}
global.ResizeObserver = FakeResizeObserver
window.ResizeObserver = FakeResizeObserver

for (const file of [
  'src/core/signal.js',
  'src/core/i18n.js',
  'src/ai/i18n.js',
  'src/ui/_internal/_signal.js',
  'src/ui/_internal/_css.js',
  'src/ai/context/rich-prompt.js',
  'src/ai/panels/rich-prompt-input.js',
  'src/ai/panels/composer-slash.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ui = aiditor.ui
const rich = aiditor.ai.richPrompt
const iconButtons = []
let openedMenu = null

const inlineValue = aiditor.signal(rich.empty())
const inlineMode = aiditor.signal(true)
let inlineSubmits = 0
const inline = ui.richPromptInput({
  value: inlineValue,
  singleLine: inlineMode,
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
inlineMode.set(false)
assert.equal(inline.classList.contains('aiditor-richprompt-single-line'), false)
assert.equal(inlineEditor.attributes['aria-multiline'], 'true')
inlineMode.set(true)
assert.equal(inline.classList.contains('aiditor-richprompt-single-line'), true)
assert.equal(inlineEditor.attributes['aria-multiline'], 'false')

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
ui.view = function (opts) { return ui.h('div', 'aiditor-ui-view ' + (opts.className || '')) }
ui.icon = function () { return new FakeEl('span') }
ui.iconButton = function (opts) {
  const el = new FakeEl('button')
  el.__opts = opts
  iconButtons.push(el)
  if (opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.button = function (opts) {
  const el = new FakeEl('button')
  if (opts.onClick) el.addEventListener('click', opts.onClick)
  return el
}
ui.select = function () { return new FakeEl('div') }
ui.menu = function (opts) { openedMenu = opts }
ui.tooltip = function () {}

aiditor.settings = {
  values() {},
  get() { return null },
}
aiditor.ai.defaultConnection = 'mock'
aiditor.ai.connections = aiditor.signal([])
aiditor.ai.models = aiditor.signal({})
aiditor.ai.agents = aiditor.signal([{
  id: 'agent-1',
  name: 'Agent',
  status: 'idle',
  connection: 'mock',
  model: 'mock-model',
  permissionMode: 'full',
  messages: [],
  compactions: [],
}])
aiditor.ai.attachments = aiditor.signal([])
aiditor.ai.activeAgentId = aiditor.signal('agent-1')
aiditor.ai.connectionOptions = function () { return [] }
aiditor.ai.getConnectionConfig = function () { return { defaultModel: 'mock-model' } }
aiditor.ai.response = { read() { return null } }
aiditor.ai.updateAgent = function () {}
aiditor.ai.message = { send() {} }
aiditor.ai.currentWorkspace = function () { return null }
aiditor.ai.workspaceMeta = function () { return null }
aiditor.ai.workspaceVersion = function () { return 0 }
aiditor.ai.currentGit = function () { return null }
aiditor.ai.gitVersion = function () { return 0 }
aiditor.ai.currentVerify = function () { return {} }
aiditor.ai.verifyVersion = function () { return 0 }

vm.runInThisContext(readFileSync('src/ai/panels/chat.js', 'utf8'), { filename: 'src/ai/panels/chat.js' })

const chatInput = components['ai-chatinput']
const chatRoot = chatInput.factory({ peek() { return {} } }, {})
const environmentButton = iconButtons.find(function (button) {
  const label = button.__opts.ariaLabel
  return (typeof label === 'function' ? label() : label) === 'Agent environment capabilities'
})
assert.ok(environmentButton)
environmentButton.dispatch('click', { currentTarget: environmentButton })
assert.deepEqual(openedMenu.items.slice(1).map(function (item) { return item.label }), [
  'Workspace · Not open',
  'Git · Not configured',
  'Verify · Ready',
])
aiditor.i18n.setLocale('zh')
environmentButton.dispatch('click', { currentTarget: environmentButton })
assert.equal(openedMenu.items[0].label, 'Agent 环境')
assert.equal(openedMenu.items[1].label, '工作区 · 未打开')
aiditor.i18n.setLocale('en')
const chatObserver = resizeObservers.at(-1)
const composer = chatRoot.querySelector('.aiditor-ai-composer')
const prompt = chatRoot.querySelector('.aiditor-richprompt')
const promptEditor = prompt.__aiditorRichPromptEditor

assert.equal(chatRoot.classList.contains('aiditor-ai-chat-standard'), true)
assert.equal(composer.classList.contains('aiditor-ai-composer-standard'), true)
chatObserver.emit(80)
assert.equal(chatRoot.classList.contains('aiditor-ai-chat-inline'), true)
assert.equal(composer.classList.contains('aiditor-ai-composer-inline'), true)
assert.equal(prompt.classList.contains('aiditor-richprompt-single-line'), true)
assert.equal(prompt.__aiditorRichPromptEditor, promptEditor)
promptEditor.focus()
chatObserver.emit(140)
assert.equal(chatRoot.classList.contains('aiditor-ai-chat-standard'), true)
assert.equal(prompt.classList.contains('aiditor-richprompt-single-line'), false)
assert.equal(prompt.__aiditorRichPromptEditor, promptEditor)
assert.equal(document.activeElement, promptEditor)
chatObserver.emit(0)
assert.equal(chatRoot.classList.contains('aiditor-ai-chat-standard'), true)

components['ai-messages'] = { factory() { return new FakeEl('div') } }

vm.runInThisContext(readFileSync('src/ai/panels/chat-combined.js', 'utf8'), { filename: 'src/ai/panels/chat-combined.js' })

const combined = components['ai-chat']
const standardCombined = combined.factory({ peek() { return {} } }, {})
assert.equal(standardCombined.children.length, 3)
assert.ok(standardCombined.querySelector('.aiditor-ai-chat-combined-splitter'))
assert.equal(standardCombined.style.values['--aiditor-ai-chat-input-size'], '230px')

const aiCss = readFileSync('src/style/ui-ai.css', 'utf8')
assert.match(aiCss, /\.aiditor-ai-chat-combined-messages\s*\{[^}]*flex:\s*1 1 0;/)
assert.match(aiCss, /\.aiditor-ai-chat-combined-input\s*\{[^}]*flex:\s*0 1 var\(--aiditor-ai-chat-input-size\);[^}]*min-height:\s*var\(--aiditor-ai-chat-input-min-h\);/)
assert.ok(aiCss.includes('--aiditor-ai-chat-multiline-min-h: 104px'))
assert.ok(aiCss.includes('--aiditor-ai-chat-input-min-h: 64px'))

chatInput.dispose(chatRoot)
assert.equal(chatObserver.disconnected, true)
combined.dispose(standardCombined)

console.log('ai chat input tests ok')

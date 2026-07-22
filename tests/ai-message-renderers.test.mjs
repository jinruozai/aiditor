import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class FakeText {
  constructor(text) {
    this.nodeType = 3
    this.nodeValue = String(text || '')
    this.parentNode = null
  }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.childNodes = this.children
    this.parentNode = null
    this.className = ''
    this.dataset = {}
    this.attributes = {}
    this.events = {}
    this.style = {}
    this.textContent = ''
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
  setAttribute(name, value) { this.attributes[name] = String(value) }
  addEventListener(type, fn) {
    if (!this.events[type]) this.events[type] = []
    this.events[type].push(fn)
  }
}

function collectText(node) {
  if (!node) return ''
  if (node.nodeType === 3) return node.nodeValue
  let out = node.textContent || ''
  for (let i = 0; i < (node.children || []).length; i++) out += collectText(node.children[i])
  return out
}

function load() {
  global.document = {
    createElement: function (tag) { return new FakeEl(tag) },
    createTextNode: function (text) { return new FakeText(text) },
  }
  global.window = { aiditor: {} }
  const aiditor = window.aiditor
  aiditor.ui = {
    h: function (tag, cls, attrs) {
      const el = document.createElement(tag)
      if (cls) el.className = cls
      if (attrs) {
        Object.keys(attrs).forEach(function (key) {
          if (key === 'text') el.textContent = String(attrs[key])
          else el[key] = attrs[key]
        })
      }
      return el
    },
    dispose: function () {},
    copyButton: function (opts) {
      const el = this.h('button', 'copy', { text: 'Copy' })
      el.__copyText = opts && opts.text
      return el
    },
    icon: function (name) { return this.h('span', 'icon-' + name, { text: name }) },
    modal: function () {},
  }
  vm.runInThisContext(readFileSync('src/ai/serialize.js', 'utf8'), { filename: 'ai/serialize.js' })
  vm.runInThisContext(readFileSync('src/ai/message-markdown.js', 'utf8'), { filename: 'ai/message-markdown.js' })
  vm.runInThisContext(readFileSync('src/ai/message-renderers.js', 'utf8'), { filename: 'ai/message-renderers.js' })
  return window.aiditor.ai
}

function assertProviderPartsNormalizeAndRender() {
  const ai = load()
  const parts = ai.messageParts({
    content: [
      { type: 'output_text', text: 'hello' },
      { type: 'image_url', image_url: { url: 'blob:test-image' }, mime: 'image/png', title: 'preview.png' },
    ],
  })
  assert.equal(parts[0].type, 'text')
  assert.equal(parts[1].type, 'image')
  assert.equal(parts[1].src, 'blob:test-image')
  assert.equal(ai.messageParts({
    content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
  })[0].src, 'data:image/png;base64,AAAA')
  assert.equal(ai.messageParts({
    content: [{ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }],
  })[0].src, 'data:image/jpeg;base64,BBBB')
  const root = document.createElement('div')
  ai.messageRenderers.renderParts(root, { parts: parts }, {})
  assert.match(collectText(root), /hello/)
  assert.match(collectText(root), /preview\.png/)
}

function assertCustomCardRenderer() {
  const ai = load()
  ai.messageRenderers.register('game.item', {
    match: function (part) { return part.type === 'card' && part.kind === 'game.item' },
    render: function (part) {
      return window.aiditor.ui.h('div', 'game-card', { text: part.data.name })
    },
    copyText: function (part) { return 'Item: ' + part.data.name },
  }, { owner: 'game' })
  const message = { parts: [{ type: 'card', kind: 'game.item', data: { name: 'Iron Sword' } }] }
  const root = document.createElement('div')
  ai.messageRenderers.renderParts(root, message, {})
  assert.match(collectText(root), /Iron Sword/)
  assert.equal(ai.messageCopyText(message), 'Item: Iron Sword')
  ai.messageRenderers.unregisterOwner('game')
  assert.equal(ai.messageRenderers.list().some(function (item) { return item.owner === 'game' }), false)
}

function assertToolCopyIncludesStructuredData() {
  const ai = load()
  const text = ai.messageCopyText({
    content: 'done',
    toolCalls: [{
      id: 'call-1',
      toolId: 'workspace.writeText',
      status: 'completed',
      args: { path: 'a.txt' },
      result: { ok: true },
    }],
  })
  assert.match(text, /done/)
  assert.match(text, /\[Tool\] workspace\.writeText \(completed\)/)
  assert.match(text, /Args:\n/)
  assert.match(text, /a\.txt/)
  assert.match(text, /Result:\n/)
  assert.match(text, /ok/)
}

function assertReasoningUsesThinkingLabel() {
  const ai = load()
  const root = document.createElement('div')
  ai.messageRenderers.renderParts(root, { parts: [{ type: 'reasoning', text: 'work' }] }, {})
  assert.match(collectText(root), /Thinking/)
}

function assertReasoningPatchesWithoutResettingDisclosure() {
  const ai = load()
  const disclosureState = {}
  const first = { id: 'streaming-message', parts: [{ type: 'reasoning', text: 'first' }] }
  const root = document.createElement('div')
  ai.messageRenderers.renderParts(root, first, { message: first, disclosureState: disclosureState })
  const details = root.children[0]
  details.open = true
  const toggles = details.events.toggle || []
  for (let i = 0; i < toggles.length; i++) toggles[i]()

  const next = { id: 'streaming-message', parts: [{ type: 'reasoning', text: 'first second' }] }
  ai.messageRenderers.patchParts(root, next, { message: next, disclosureState: disclosureState })
  assert.equal(root.children[0], details)
  assert.equal(details.open, true)
  assert.match(collectText(details), /first second/)

  const remounted = document.createElement('div')
  ai.messageRenderers.renderParts(remounted, next, { message: next, disclosureState: disclosureState })
  assert.equal(remounted.children[0].open, true)
}

assertProviderPartsNormalizeAndRender()
assertCustomCardRenderer()
assertToolCopyIncludesStructuredData()
assertReasoningUsesThinkingLabel()
assertReasoningPatchesWithoutResettingDisclosure()

console.log('ai message renderer tests ok')

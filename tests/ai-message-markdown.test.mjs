import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class FakeText {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = String(value || '')
    this.parentNode = null
  }
  get firstChild() { return null }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1
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
  setAttribute(name, value) { this.attributes[name] = String(value) }
  addEventListener(type, fn) {
    if (!this.events[type]) this.events[type] = []
    this.events[type].push(fn)
  }
  get firstChild() { return this.children[0] || null }
}

function collectText(node) {
  if (!node) return ''
  if (node.nodeType === 3) return node.nodeValue
  let out = node.textContent || ''
  for (let i = 0; i < node.children.length; i++) out += collectText(node.children[i])
  return out
}

function collect(node, predicate, out) {
  out = out || []
  if (node && node.nodeType === 1 && predicate(node)) out.push(node)
  const children = node && node.children || []
  for (let i = 0; i < children.length; i++) collect(children[i], predicate, out)
  return out
}

function byTag(root, tag) {
  const upper = tag.toUpperCase()
  return collect(root, function (el) { return el.tagName === upper })
}

function byClass(root, name) {
  return collect(root, function (el) { return String(el.className || '').split(/\s+/).includes(name) })
}

function load() {
  global.document = {
    createElement: function (tag) { return new FakeElement(tag) },
    createTextNode: function (value) { return new FakeText(value) },
  }
  global.window = { aiditor: {} }
  const aiditor = window.aiditor
  aiditor.ui = {
    h: function (tag, cls, attrs) {
      const el = document.createElement(tag)
      if (cls) el.className = cls
      if (attrs) Object.keys(attrs).forEach(function (key) {
        if (key === 'text') el.textContent = String(attrs[key])
        else el[key] = attrs[key]
      })
      return el
    },
    dispose: function (el) { if (el && el.remove) el.remove() },
    copyButton: function (opts) {
      const el = this.h('button', 'aiditor-ui-copy-btn', { text: 'Copy' })
      el.__copyText = opts.text
      return el
    },
    modal: function () {},
  }
  vm.runInThisContext(readFileSync('src/ai/serialize.js', 'utf8'), { filename: 'ai/serialize.js' })
  vm.runInThisContext(readFileSync('src/ai/message-markdown.js', 'utf8'), { filename: 'ai/message-markdown.js' })
  vm.runInThisContext(readFileSync('src/ai/message-renderers.js', 'utf8'), { filename: 'ai/message-renderers.js' })
  return aiditor.ai
}

function assertRichMarkdownRendering() {
  const ai = load()
  const source = [
    '# Result',
    '',
    'A **strong** answer with `inline()` and [docs](https://example.com/docs).',
    '',
    '- first',
    '- [x] verified',
    '  - nested',
    '',
    '> quoted **detail**',
    '',
    '| Name | Value |',
    '| --- | ---: |',
    '| count | 3 |',
    '',
    '![preview](https://example.com/preview.png "Preview")',
    '',
    '```js',
    'const count = 3',
    '```',
  ].join('\n')
  const root = ai.messageMarkdown.render(source)
  assert.equal(byTag(root, 'h1').length, 1)
  assert.equal(byTag(root, 'strong').length, 2)
  assert.equal(byTag(root, 'ul').length, 2)
  assert.equal(byTag(root, 'blockquote').length, 1)
  assert.equal(byTag(root, 'table').length, 1)
  assert.equal(byTag(root, 'a')[0].href, 'https://example.com/docs')
  assert.equal(byTag(root, 'img')[0].src, 'https://example.com/preview.png')
  assert.equal(byClass(root, 'aiditor-ai-message-code-wrap').length, 1)
  assert.match(collectText(root), /const count = 3/)
}

function assertUntrustedTextStaysSafe() {
  const ai = load()
  const root = ai.messageMarkdown.render('<script>alert(1)</script>\n\n[unsafe](javascript:alert(2))')
  assert.equal(byTag(root, 'script').length, 0)
  assert.equal(byTag(root, 'a').length, 0)
  assert.match(collectText(root), /<script>alert\(1\)<\/script>/)
  assert.match(collectText(root), /unsafe/)
}

function assertStreamingPatchKeepsRootAndPlainTextNode() {
  const ai = load()
  const root = ai.messageMarkdown.render('hello')
  const textNode = root.firstChild
  const returned = ai.messageMarkdown.patch(root, 'hello world')
  assert.equal(returned, root)
  assert.equal(root.firstChild, textNode)
  assert.equal(root.firstChild.nodeValue, 'hello world')
  ai.messageMarkdown.patch(root, '# Heading')
  assert.equal(byTag(root, 'h1').length, 1)
}

function assertProviderNormalizationKeepsTextDocument() {
  const ai = load()
  const markdown = '# Title\n\n```js\nconst x = 1\n```'
  const parts = ai.messageParts({ content: markdown, reasoning_content: '**checking**' })
  assert.equal(parts.length, 2)
  assert.equal(parts[0].type, 'reasoning')
  assert.equal(parts[1].type, 'text')
  assert.equal(parts[1].text, markdown)

  const mcpImage = ai.messageParts({
    content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
  })[0]
  assert.equal(mcpImage.type, 'image')
  assert.equal(mcpImage.src, 'data:image/png;base64,AAAA')

  const generated = ai.messageParts({
    content: [{ type: 'image_generation_call', result: 'BBBB' }],
  })[0]
  assert.equal(generated.type, 'image')
  assert.equal(generated.src, 'data:image/png;base64,BBBB')
}

assertRichMarkdownRendering()
assertUntrustedTextStaysSafe()
assertStreamingPatchKeepsRootAndPlainTextNode()
assertProviderNormalizationKeepsTextDocument()

console.log('ai message markdown tests ok')

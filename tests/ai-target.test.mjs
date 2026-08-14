import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/ai/name-generator.js', 'utf8'), { filename: 'ai/name-generator.js' })
vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
vm.runInThisContext(readFileSync('src/ai/store.js', 'utf8'), { filename: 'ai/store.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
for (const file of ['src/ai/contribution-registry.js', 'src/ai/tool/registry.js', 'src/ai/context/registry.js', 'src/ai/skill/registry.js']) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
vm.runInThisContext(readFileSync('src/ai/tool/runtime.js', 'utf8'), { filename: 'ai/tool/runtime.js' })
vm.runInThisContext(readFileSync('src/ai/reference.js', 'utf8'), { filename: 'ai/reference.js' })
vm.runInThisContext(readFileSync('src/ai/request.js', 'utf8'), { filename: 'ai/request.js' })
vm.runInThisContext(readFileSync('src/ai/target.js', 'utf8'), { filename: 'ai/target.js' })

const ai = window.aiditor.ai

ai.registerTargetProvider('case', {
  match: function (source) { return source && source.kind === 'case-source' },
  capture: function (source) {
    return {
      uri: 'case://item/' + source.id,
      kind: 'case.item',
      title: source.title,
      meta: { id: source.id },
      tools: ['case.read'],
    }
  },
})

assert.deepEqual(ai.listTargetProviders(), ['case'])

const captured = ai.captureTarget({ kind: 'case-source', id: 'a', title: 'A' })
assert.equal(captured.uri, 'case://item/a')
assert.equal(captured.resolver, 'case')
assert.deepEqual(captured.meta, { id: 'a' })

const resource = ai.addTarget(captured)
const same = ai.addTarget(captured)
assert.equal(resource.id, same.id)
assert.equal(ai.attachments().length, 1)

const agent = ai.createAgent({ name: 'Target Agent', path: 'target-agent' })
ai.attachTargetToAgent(agent.id, captured)
ai.attachTargetsToAgent(agent.id, [captured, { uri: 'case://item/b', kind: 'case.item', title: 'B' }])

const after = ai.findAgent(agent.id)
assert.equal(after.contextRefs.length, 2)
assert.equal(ai.attachments().length, 2)

const request = ai.makeRequest(after, { attachments: [{ uri: 'case://item/c', kind: 'case.item', title: 'C' }] }, 'run-1', 'user', 0)
assert.equal(request.contextRefs.length, 3)
assert.equal(request.attachmentRefs.some(function (ref) { return ref.uri === 'case://item/c' }), true)

let dragPayload = {}
const dragEvent = {
  dataTransfer: {
    effectAllowed: '',
    setData: function (type, value) { dragPayload[type] = value },
    getData: function (type) { return dragPayload[type] || '' },
    types: ['application/x-aiditor-target-list'],
  },
}
ai.writeTargetDragData(dragEvent, [captured])
assert.equal(JSON.parse(dragPayload['application/x-aiditor-target']).uri, captured.uri)
assert.equal(ai.readTargetFromDragEvent(dragEvent)[0].uri, captured.uri)

function mockElement(tag) {
  const el = {
    tagName: tag || 'div',
    dataset: {},
    attrs: {},
    parentElement: null,
    listeners: {},
    setAttribute: function (name, value) { this.attrs[name] = String(value) },
    getAttribute: function (name) { return this.attrs[name] },
    hasAttribute: function (name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) },
    removeAttribute: function (name) { delete this.attrs[name] },
    addEventListener: function (type, fn) { this.listeners[type] = fn },
    removeEventListener: function (type) { delete this.listeners[type] },
    querySelector: function (selector) { return this.children && this.children.find(function (child) { return child.selector === selector }) || null },
    matches: function (selector) {
      const parts = selector.split(',').map(function (part) { return part.trim() })
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === this.tagName) return true
        if (parts[i] === '[role="slider"]' && this.attrs.role === 'slider') return true
        if (parts[i] === '[data-aiditor-ai-drag-ignore]' && this.attrs['data-aiditor-ai-drag-ignore'] != null) return true
        if (parts[i] === '[data-aiditor-ai-drag-handle]' && this.attrs['data-aiditor-ai-drag-handle'] != null) return true
      }
      return false
    },
  }
  return el
}

const cardEl = mockElement('div')
const handleEl = mockElement('div')
handleEl.selector = '.drag-handle'
handleEl.parentElement = cardEl
cardEl.children = [handleEl]
ai.attach(cardEl, captured, { dragHandle: '.drag-handle' })
assert.equal(cardEl.attrs.draggable, undefined)
assert.equal(handleEl.draggable, true)
let handleDragPayload = {}
handleEl.listeners.dragstart({
  target: handleEl,
  dataTransfer: {
    effectAllowed: '',
    setData: function (type, value) { handleDragPayload[type] = value },
  },
  preventDefault: function () { this.prevented = true },
})
assert.equal(JSON.parse(handleDragPayload['application/x-aiditor-target']).uri, captured.uri)

const rootEl = mockElement('div')
const sliderEl = mockElement('div')
sliderEl.attrs.role = 'slider'
sliderEl.parentElement = rootEl
ai.attach(rootEl, captured)
let prevented = false
rootEl.listeners.dragstart({
  target: sliderEl,
  dataTransfer: { setData: function () {} },
  preventDefault: function () { prevented = true },
})
assert.equal(prevented, true)

const textFileTarget = await ai.fileToTarget({
  name: 'note.txt',
  size: 11,
  type: 'text/plain',
  lastModified: 123,
  text: () => Promise.resolve('hello world'),
})
assert.equal(textFileTarget.resolver, 'file')
assert.equal(textFileTarget.kind, 'file.text')
assert.equal(textFileTarget.title, 'note.txt')
assert.equal(textFileTarget.meta.text, 'hello world')

let dropped = null
const dropEl = {
  classList: { add: () => {}, remove: () => {} },
  addEventListener: function (type, fn) { this[type] = fn },
  removeEventListener: function () {},
}
ai.installTargetDrop(dropEl, { onDrop: (targets) => { dropped = targets } })
const fileDropEvent = {
  preventDefault: () => {},
  dataTransfer: {
    dropEffect: '',
    types: ['Files'],
    files: [{ name: 'drop.md', size: 4, type: 'text/markdown', lastModified: 456, text: () => Promise.resolve('test') }],
    getData: () => '',
  },
}
dropEl.dragover(fileDropEvent)
dropEl.drop(fileDropEvent)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(dropped.length, 1)
assert.equal(dropped[0].uri.startsWith('file://upload/drop.md'), true)
assert.equal(dropped[0].meta.text, 'test')

console.log('ai target tests ok')

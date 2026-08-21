import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/core/commands.js',
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/context/rich-prompt.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ai = aiditor.ai
const rich = ai.richPrompt
const opened = []

aiditor.ui = {
  quickPick: function (opts) {
    const handle = {
      opts: opts,
      closed: false,
      close: function () {
        if (handle.closed) return
        handle.closed = true
        if (opts.onDismiss) opts.onDismiss()
      },
      handleKeyDown: function (ev) {
        if (ev.key !== 'Escape') return false
        ev.preventDefault()
        handle.close()
        return true
      },
    }
    opened.push(handle)
    return handle
  },
}

vm.runInThisContext(readFileSync('src/ai/panels/composer-slash.js', 'utf8'), { filename: 'composer-slash.js' })

ai.skills.register('review.code', {
  title: 'Code Review',
  description: 'Review a bounded change.',
  argumentHint: '[path]',
  tools: ['workspace.readTextRange'],
}, { owner: 'test:skills', layer: 'workspace', source: 'project' })
ai.skills.register('background.only', {
  title: 'Background Only',
}, { owner: 'test:skills' })
ai.tools.register('raw.tool', { title: 'Raw Tool', run: function () {} }, { owner: 'test:tools' })

let commandRuns = 0
let commandContext = null
aiditor.commands.register('test.status', {
  title: 'Show status',
  run: function (input, ctx) {
    commandRuns++
    commandContext = ctx
    return input.value
  },
})
aiditor.commands.registerMenu('test.status.composer', {
  target: 'ai.composer.slash',
  command: 'test.status',
  name: 'status',
  label: 'Show status',
  description: 'Show current state.',
  input: { value: 7 },
})

const projected = ai.composerSlash.items(rich.empty(), { agentId: 'agent-1' }, true)
assert.deepEqual(projected.map(function (item) { return item.key }), [
  'command:test.status.composer',
  'skill:background.only',
  'skill:review.code',
])
assert.equal(projected.some(function (item) { return item.id === 'background.only' }), true)
assert.equal(projected.some(function (item) { return item.id === 'raw.tool' }), false)

const slash = rich.insertText(rich.empty(), 0, '/')
assert.deepEqual(ai.composerSlash.triggerFor(slash, { start: 1, end: 1, collapsed: true }), {
  start: 0,
  end: 1,
  query: '',
  commands: true,
})
const path = rich.insertText(rich.empty(), 0, '/src/file')
assert.equal(ai.composerSlash.triggerFor(path, { start: 9, end: 9, collapsed: true }), null)

const value = aiditor.signal(rich.empty())
let selection = { start: 0, end: 0, collapsed: true }
let focused = 0
const editorListeners = {}
const editorApi = {
  editor: {
    addEventListener: function (type, fn) { editorListeners[type] = fn },
    removeEventListener: function (type, fn) {
      if (editorListeners[type] === fn) delete editorListeners[type]
    },
  },
  selectionRange: function () { return selection },
  replaceRange: function (start, end, fragment) {
    const base = rich.deleteRange(value.peek(), start, end)
    const next = rich.insertDraft(base, start, fragment)
    value.set(next)
    selection = { start: start + fragment.text.length, end: start + fragment.text.length, collapsed: true }
    return next
  },
  focus: function () { focused++ },
}
const controller = ai.composerSlash.install({
  input: { __aiditorRichPromptApi: editorApi },
  value: value,
  context: function () { return { agentId: 'agent-1' } },
})

selection = { start: 1, end: 1, collapsed: true }
value.set(slash)
assert.equal(opened.length, 1)
assert.equal(opened[0].opts.query.peek(), '')
const skillItem = opened[0].opts.items.peek().find(function (item) { return item.id === 'review.code' })
opened[0].opts.onSelect(skillItem)
assert.deepEqual(rich.skills(value.peek()), ['review.code'])
assert.equal(focused, 1)

value.set(rich.empty())
selection = { start: 1, end: 1, collapsed: true }
value.set(slash)
const latest = opened[opened.length - 1]
const commandItem = latest.opts.items.peek().find(function (item) { return item.kind === 'command' })
assert.equal(latest.opts.onSelect(commandItem), 7)
assert.equal(commandRuns, 1)
assert.equal(commandContext.source, 'ai.composer.slash')
assert.equal(commandContext.agentId, 'agent-1')
assert.equal(rich.toPlainText(value.peek()), '')

value.set(rich.empty())
selection = { start: 1, end: 1, collapsed: true }
value.set(slash)
const escape = { key: 'Escape', preventDefault: function () { this.defaultPrevented = true } }
assert.equal(controller.handleKeyDown(escape), true)
assert.equal(escape.defaultPrevented, true)
assert.equal(rich.toPlainText(value.peek()), '/')

value.set(rich.empty())
selection = { start: 1, end: 1, collapsed: true }
value.set(slash)
const overlayFirst = opened[opened.length - 1]
const openedBeforeOverlayEscape = opened.length
overlayFirst.close()
editorListeners.keyup({ type: 'keyup', key: 'Escape' })
editorListeners.keyup({ type: 'keyup', key: 'ArrowLeft' })
assert.equal(opened.length, openedBeforeOverlayEscape)

controller.dispose()
assert.deepEqual(editorListeners, {})

console.log('ai composer slash tests ok')

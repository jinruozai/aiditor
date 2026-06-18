import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function storage() {
  const data = {}
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null },
    setItem: function (key, value) { data[key] = String(value) },
    removeItem: function (key) { delete data[key] },
  }
}

function quotaStorage() {
  let attempts = 0
  return {
    getItem: function () { return null },
    setItem: function () {
      attempts++
      const err = new Error('Quota exceeded')
      err.name = 'QuotaExceededError'
      err.code = 22
      throw err
    },
    removeItem: function () {},
    attempts: function () { return attempts },
  }
}

function storedBytes(store, key) {
  const text = store.getItem(key) || ''
  return text.length * 2
}

function loadRuntime(store, location) {
  global.window = { aiditor: {}, localStorage: store }
  if (location) global.window.location = location
  vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
  vm.runInThisContext(readFileSync('src/ai/name-generator.js', 'utf8'), { filename: 'ai/name-generator.js' })
  vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
  vm.runInThisContext(readFileSync('src/ai/store.js', 'utf8'), { filename: 'ai/store.js' })
  return window.aiditor.ai
}

const memory = storage()
let ai = loadRuntime(memory)
ai.configurePersistence({ key: 'test.ai', load: false })
ai.setLastSelectedModel({ connection: 'persisted-connection', model: 'persisted-model' })
const parent = ai.createAgent({ name: 'Saved Parent' })
const agent = ai.createAgent({
  name: 'Saved Agent',
  parentAgentId: parent.id,
  messages: [{ role: 'user', content: 'hello' }],
})
const res = ai.addAttachment({ resolver: 'case', uri: 'case://one', title: 'One' })
ai.updateAgent(agent.id, { contextRefs: [res.id] })
ai.updateAgent(agent.id, {
  status: 'running',
  statusText: 'doing work',
  activeMessageId: agent.messages[0].id,
  queue: [{ messageId: agent.messages[0].id }],
  messages: agent.messages.concat([{
    role: 'assistant',
    content: 'in flight',
    status: 'running',
    toolCalls: [{ id: 'big_tool', toolId: 'demo.project.writeFile', args: { text: 'x'.repeat(50000) }, applyResult: { text: 'x'.repeat(50000) } }],
  }]),
  quests: [{ id: 'q1', requestMessageId: 'q1', status: 'running' }],
})
ai.save()

const stored = JSON.parse(window.localStorage.getItem('test.ai'))
assert.equal(stored.version, 2)
assert.deepEqual(stored.preferences, { lastConnection: 'persisted-connection', lastModel: 'persisted-model' })
assert.equal(stored.agents.length, 2)
assert.equal(stored.attachments.length, 1)
assert.equal('groups' in stored, false)
assert.equal('path' in stored.agents[1], false)
assert.equal('groupId' in stored.agents[1], false)
assert.deepEqual(stored.agents[1].contextRefs, [])
assert.equal(stored.agents[1].messages[1].toolCalls[0].args.text.length < 13000, true)

ai = loadRuntime(memory)
ai.configurePersistence({ key: 'test.ai' })

assert.deepEqual(ai.getLastSelectedModel(), { connection: 'persisted-connection', model: 'persisted-model' })
const inherited = ai.createAgent({ name: 'Inherited Model', select: false })
assert.equal(inherited.connection, 'persisted-connection')
assert.equal(inherited.model, 'persisted-model')
ai.deleteAgent(inherited.id)

const restored = ai.agents().find(function (item) { return item.id === agent.id })
assert.equal(restored.name, 'Saved Agent')
assert.equal(restored.parentAgentId, parent.id)
assert.equal(restored.messages[0].content, 'hello')
assert.equal(restored.status, 'idle')
assert.equal(restored.statusText, '')
assert.equal(restored.activeMessageId, null)
assert.equal(restored.queue.length, 0)
assert.equal(restored.messages[1].status, 'stopped')
assert.equal(restored.quests[0].status, 'stopped')
assert.deepEqual(restored.contextRefs, [])
assert.equal(ai.attachments()[0].uri, 'case://one')
assert.equal(ai.activeAgentId(), agent.id)

ai.clearStoredState()
assert.equal(window.localStorage.getItem('test.ai'), null)

window.localStorage.setItem('too.big.ai', 'x'.repeat(5000001))
ai.configurePersistence({ key: 'too.big.ai' })
assert.equal(window.localStorage.getItem('too.big.ai'), null)

const defaultMemory = storage()
defaultMemory.setItem('aiditor.ai.v2', JSON.stringify({
  version: 2,
  agents: [{ id: 'legacy-agent', name: 'Legacy Default Key' }],
  attachments: [],
  activeAgentId: 'legacy-agent',
}))
ai = loadRuntime(defaultMemory)
assert.equal(ai.agents().length, 0)
ai.createAgent({ name: 'Default Key Agent' })
ai.save()
assert.equal(!!window.localStorage.getItem('aiditor.ai'), true)
assert.equal(!!window.localStorage.getItem('aiditor.ai.v2'), true)

const locatedMemory = storage()
ai = loadRuntime(locatedMemory, { origin: 'https://example.test', pathname: '/editor/index.html' })
ai.createAgent({ name: 'Located Agent' })
ai.save()
assert.equal(!!window.localStorage.getItem('aiditor.ai.https_example.test_editor_index.html'), true)
assert.equal(window.localStorage.getItem('aiditor.ai'), null)

const namespaceMemory = storage()
ai = loadRuntime(namespaceMemory)
ai.createAgent({ name: 'Before Namespace' })
ai.configurePersistence({ namespace: 'app one', load: false })
assert.equal(ai.agents().length, 0)
ai.createAgent({ name: 'Namespaced Agent' })
ai.save()
assert.equal(!!window.localStorage.getItem('aiditor.ai.app_one'), true)

window.localStorage.setItem('aiditor.ai.one', JSON.stringify({
  version: 2,
  agents: [{ id: 'agent-one', name: 'Agent One' }],
  attachments: [],
  activeAgentId: 'agent-one',
}))
window.localStorage.setItem('aiditor.ai.two', JSON.stringify({
  version: 2,
  agents: [{ id: 'agent-two', name: 'Agent Two' }],
  attachments: [],
  activeAgentId: 'agent-two',
}))
ai.configurePersistence({ namespace: 'one' })
assert.equal(ai.agents().length, 1)
assert.equal(ai.agents()[0].name, 'Agent One')
ai.configurePersistence({ namespace: 'two' })
assert.equal(ai.agents().length, 1)
assert.equal(ai.agents()[0].name, 'Agent Two')
ai.clearStoredState()
assert.equal(window.localStorage.getItem('aiditor.ai.two'), null)

{
  const compactMemory = storage()
  ai = loadRuntime(compactMemory)
  ai.configurePersistence({ key: 'compact.ai', maxBytes: 18000, maxMessagesPerAgent: 2, load: false })
  const compactAgent = ai.createAgent({ name: 'Compact Agent' })
  for (let i = 0; i < 6; i++) {
    ai.appendMessage(compactAgent.id, { role: i % 2 ? 'assistant' : 'user', content: 'message-' + i + ':' + 'x'.repeat(20000) })
  }
  const saved = ai.save()
  const storedCompact = JSON.parse(window.localStorage.getItem('compact.ai'))
  assert.equal(storedCompact.persistence.compacted, true)
  assert.equal(saved.persistence.compacted, true)
  assert.equal(storedCompact.agents[0].messages.length, 2)
  assert.equal(storedCompact.agents[0].messages[0].content.length < 1600, true)
  assert.equal(storedCompact.agents[0].meta.persistence.omittedMessages, 4)
  assert.equal(storedBytes(window.localStorage, 'compact.ai') <= 18000, true)

  ai = loadRuntime(compactMemory)
  ai.configurePersistence({ key: 'compact.ai', maxBytes: 18000, maxMessagesPerAgent: 2 })
  assert.equal(ai.agents()[0].messages.length, 2)
  assert.equal(ai.agents()[0].messages[0].content.indexOf('[truncated for persistence]') > 0, true)
}

{
  const toolMemory = storage()
  ai = loadRuntime(toolMemory)
  ai.configurePersistence({ key: 'tool.ai', maxBytes: 50000, maxMessagesPerAgent: 5, toolResultPolicy: 'metadata-only', load: false })
  const toolAgent = ai.createAgent({ name: 'Tool Agent' })
  const calls = []
  for (let i = 0; i < 24; i++) {
    calls.push({
      id: 'tool-' + i,
      toolId: 'demo.tool',
      name: 'demo.tool',
      args: { text: 'a'.repeat(4000), index: i },
      result: { text: 'r'.repeat(12000), rows: Array(50).fill({ value: 'row' }) },
      preview: { text: 'p'.repeat(12000) },
      applyResult: { text: 'w'.repeat(12000) },
      status: 'completed',
    })
  }
  ai.appendMessage(toolAgent.id, { role: 'assistant', content: 'tools', toolCalls: calls })
  ai.save()
  const storedTools = JSON.parse(window.localStorage.getItem('tool.ai'))
  const savedCall = storedTools.agents[0].messages[0].toolCalls[0]
  assert.equal(storedBytes(window.localStorage, 'tool.ai') <= 50000, true)
  assert.equal(savedCall.id, 'tool-0')
  assert.equal(savedCall.toolId, 'demo.tool')
  assert.equal(savedCall.status, 'completed')
  assert.equal('args' in savedCall, true)
  assert.equal('result' in savedCall, false)
  assert.equal('preview' in savedCall, false)
  assert.equal('applyResult' in savedCall, false)
}

{
  const circularMemory = storage()
  ai = loadRuntime(circularMemory)
  ai.configurePersistence({ key: 'circular.ai', maxBytes: 50000, load: false })
  const circularAgent = ai.createAgent({ name: 'Circular Agent' })
  const state = { label: 'root' }
  state.self = state
  ai.updateAgent(circularAgent.id, { state: state })
  ai.save()
  const storedCircular = JSON.parse(window.localStorage.getItem('circular.ai'))
  assert.equal(storedCircular.persistence.compacted, true)
  assert.equal(storedCircular.agents[0].state.self, '[Circular]')
}

{
  const failing = quotaStorage()
  ai = loadRuntime(failing)
  let reports = 0
  window.aiditor.reportError = function () { reports++ }
  ai.configurePersistence({ key: 'quota.ai', maxBytes: 50000, load: false })
  const quotaAgent = ai.createAgent({ name: 'Quota Agent' })
  ai.appendMessage(quotaAgent.id, { role: 'assistant', content: 'x'.repeat(2000) })
  ai.save()
  ai.appendMessage(quotaAgent.id, { role: 'assistant', content: 'again' })
  ai.save()
  assert.equal(reports, 1)
  assert.equal(failing.attempts(), 2)
}

console.log('ai persistence tests ok')

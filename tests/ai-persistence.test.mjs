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

console.log('ai persistence tests ok')

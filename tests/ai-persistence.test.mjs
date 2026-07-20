import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function localStorage() {
  const data = {}
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null },
    setItem: function (key, value) { data[key] = String(value) },
    removeItem: function (key) { delete data[key] },
  }
}

function memoryAdapter(records) {
  records = records || new Map()
  return {
    records: records,
    load: function (key) { return Promise.resolve(records.get(key) || null) },
    save: function (key, value) {
      records.set(key, JSON.parse(JSON.stringify(value)))
      return Promise.resolve()
    },
    remove: function (key) { records.delete(key); return Promise.resolve() },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise(function (yes, no) { resolve = yes; reject = no })
  return { promise: promise, resolve: resolve, reject: reject }
}

function loadRuntime(storage, location) {
  const windowEvents = {}
  const documentEvents = {}
  global.document = {
    visibilityState: 'visible',
    addEventListener: function (type, fn) { (documentEvents[type] = documentEvents[type] || []).push(fn) },
  }
  global.window = {
    aiditor: {},
    localStorage: storage,
    location: location,
    addEventListener: function (type, fn) { (windowEvents[type] = windowEvents[type] || []).push(fn) },
  }
  for (const file of [
    'src/core/signal.js',
    'src/core/log.js',
    'src/ai/name-generator.js',
    'src/ai/serialize.js',
    'src/ai/schema.js',
    'src/ai/permission.js',
    'src/ai/store.js',
    'src/ai/persistence.js',
  ]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
  return { ai: window.aiditor.ai, windowEvents: windowEvents, documentEvents: documentEvents }
}

{
  const storage = localStorage()
  const adapter = memoryAdapter()
  let runtime = loadRuntime(storage)
  let ai = runtime.ai
  ai.configurePersistence({ key: 'complete.ai', adapter: adapter, load: false, debounceMs: 10000 })
  ai.setLastSelectedModel({ connection: 'persisted-connection', model: 'persisted-model' })
  const parent = ai.createAgent({ name: 'Saved Parent' })
  const agent = ai.createAgent({ name: 'Saved Agent', parentAgentId: parent.id })
  ai.appendMessage(agent.id, { role: 'user', content: 'old:' + 'x'.repeat(50000) })
  ai.appendMessage(agent.id, {
    role: 'assistant',
    content: 'new:' + 'y'.repeat(50000),
    toolCalls: [{ id: 'tool-1', toolId: 'demo.large', status: 'completed', result: { text: 'z'.repeat(50000) } }],
  })
  await ai.save()

  const envelope = adapter.records.get('complete.ai')
  assert.equal(envelope.state.agents[1].messages.length, 2)
  assert.equal(envelope.state.agents[1].messages[0].content.length, 50004)
  assert.equal(envelope.state.agents[1].messages[1].toolCalls[0].result.text.length, 50000)
  const bootstrap = JSON.parse(storage.getItem('complete.ai'))
  assert.equal(bootstrap.kind, 'aiditor.ai.bootstrap')
  assert.equal(Object.prototype.hasOwnProperty.call(bootstrap.agents[0], 'messages'), false)
  assert.equal(JSON.stringify(bootstrap).includes('old:'), false)

  runtime = loadRuntime(storage)
  ai = runtime.ai
  ai.configurePersistence({ key: 'complete.ai', adapter: adapter })
  await ai.persistence.ready()
  const restored = ai.findAgent(agent.id)
  assert.deepEqual(ai.getLastSelectedModel(), { connection: 'persisted-connection', model: 'persisted-model' })
  assert.equal(restored.messages.length, 2)
  assert.equal(restored.messages[0].content.length, 50004)
  assert.equal(restored.messages[1].toolCalls[0].result.text.length, 50000)
  assert.equal(ai.activeAgentId(), agent.id)

  await ai.clearStoredState()
  assert.equal(adapter.records.has('complete.ai'), false)
  assert.equal(storage.getItem('complete.ai'), null)
}

{
  const storage = localStorage()
  storage.setItem('race.ai', JSON.stringify({
    version: 1,
    kind: 'aiditor.ai.bootstrap',
    agents: [{ id: 'agent-race', name: 'Race', updatedAt: 1 }],
    activeAgentId: 'agent-race',
  }))
  const pendingLoad = deferred()
  const adapter = {
    load: function () { return pendingLoad.promise },
    save: function () { return Promise.resolve() },
    remove: function () { return Promise.resolve() },
  }
  const ai = loadRuntime(storage).ai
  ai.configurePersistence({ key: 'race.ai', adapter: adapter, debounceMs: 0 })
  ai.appendMessage('agent-race', { id: 'message-c', role: 'user', content: 'C' })
  pendingLoad.resolve({
    version: 1,
    savedAt: 1,
    state: {
      version: 2,
      agents: [{
        id: 'agent-race',
        name: 'Race',
        updatedAt: 1,
        messages: [
          { id: 'message-a', role: 'user', content: 'A' },
          { id: 'message-b', role: 'assistant', content: 'B' },
        ],
      }],
      attachments: [],
      preferences: {},
      activeAgentId: 'agent-race',
    },
  })
  await ai.persistence.ready()
  assert.deepEqual(ai.findAgent('agent-race').messages.map(function (message) { return message.content }), ['A', 'B', 'C'])
}

{
  const storage = localStorage()
  const firstSave = deferred()
  const calls = []
  const records = new Map()
  const adapter = {
    load: function () { return Promise.resolve(null) },
    save: function (key, envelope) {
      calls.push(envelope)
      if (calls.length === 1) return firstSave.promise.then(function () { records.set(key, envelope) })
      records.set(key, envelope)
      return Promise.resolve()
    },
    remove: function () { return Promise.resolve() },
  }
  const ai = loadRuntime(storage).ai
  ai.configurePersistence({ key: 'ordered.ai', adapter: adapter, load: false, debounceMs: 10000 })
  const agent = ai.createAgent({ name: 'Ordered' })
  ai.appendMessage(agent.id, { id: 'one', role: 'user', content: 'one' })
  const saveOne = ai.save()
  ai.appendMessage(agent.id, { id: 'two', role: 'assistant', content: 'two' })
  const saveTwo = ai.save()
  await new Promise(function (resolve) { setTimeout(resolve, 0) })
  assert.equal(calls.length, 1)
  firstSave.resolve()
  await Promise.all([saveOne, saveTwo])
  assert.equal(calls.length, 2)
  assert.deepEqual(records.get('ordered.ai').state.agents[0].messages.map(function (message) { return message.id }), ['one', 'two'])
}

{
  const storage = localStorage()
  storage.setItem('legacy.ai', JSON.stringify({
    version: 2,
    agents: [{ id: 'legacy-agent', name: 'Legacy', messages: [{ id: 'legacy-message', role: 'user', content: 'keep me' }] }],
    attachments: [],
    activeAgentId: 'legacy-agent',
  }))
  const adapter = memoryAdapter()
  const ai = loadRuntime(storage).ai
  ai.configurePersistence({ key: 'legacy.ai', adapter: adapter })
  await ai.persistence.ready()
  assert.equal(adapter.records.get('legacy.ai').state.agents[0].messages[0].content, 'keep me')
  assert.equal(JSON.parse(storage.getItem('legacy.ai')).kind, 'aiditor.ai.bootstrap')
}

{
  const storage = localStorage()
  let attempts = 0
  const adapter = {
    load: function () { return Promise.resolve(null) },
    save: function () { attempts++; return Promise.reject(new Error('quota')) },
    remove: function () { return Promise.resolve() },
  }
  const runtime = loadRuntime(storage)
  const ai = runtime.ai
  ai.configurePersistence({ key: 'failure.ai', adapter: adapter, load: false })
  ai.createAgent({ name: 'Failure' })
  await ai.save().catch(function () {})
  await ai.save().catch(function () {})
  assert.equal(attempts, 2)
  assert.equal(window.aiditor.log().filter(function (entry) { return entry.error && entry.error.code === 'AI_PERSISTENCE_SAVE_FAILED' }).length, 1)
  assert.equal(ai.agents().length, 1)
}

{
  const storage = localStorage()
  const adapter = memoryAdapter()
  const runtime = loadRuntime(storage)
  const ai = runtime.ai
  ai.configurePersistence({ key: 'lifecycle.ai', adapter: adapter, load: false, debounceMs: 10000 })
  ai.createAgent({ name: 'Lifecycle' })
  runtime.windowEvents.pagehide[0]()
  await ai.persistence.flush()
  assert.equal(adapter.records.get('lifecycle.ai').state.agents[0].name, 'Lifecycle')
}

{
  const storage = localStorage()
  const adapter = memoryAdapter()
  const ai = loadRuntime(storage, { origin: 'https://example.test', pathname: '/editor/index.html' }).ai
  ai.configurePersistence({ namespace: 'one', adapter: adapter, load: false })
  ai.createAgent({ name: 'One' })
  await ai.save()
  ai.configurePersistence({ namespace: 'two', adapter: adapter, load: false })
  assert.equal(ai.agents().length, 0)
  ai.createAgent({ name: 'Two' })
  await ai.save()
  ai.configurePersistence({ namespace: 'one', adapter: adapter })
  await ai.persistence.ready()
  assert.equal(ai.agents()[0].name, 'One')
  assert.equal(adapter.records.has('aiditor.ai.two'), true)
}

console.log('ai persistence tests ok')

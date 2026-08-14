import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function loadCore(storage) {
  global.document = { visibilityState: 'visible', addEventListener: function () {} }
  global.window = { aiditor: {}, localStorage: storage || null, addEventListener: function () {} }
  vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
  vm.runInThisContext(readFileSync('src/core/log.js', 'utf8'), { filename: 'log.js' })
  vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
  vm.runInThisContext(readFileSync('src/core/commands.js', 'utf8'), { filename: 'commands.js' })
  vm.runInThisContext(readFileSync('src/ai/name-generator.js', 'utf8'), { filename: 'ai/name-generator.js' })
  vm.runInThisContext(readFileSync('src/ai/serialize.js', 'utf8'), { filename: 'ai/serialize.js' })
  vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
  vm.runInThisContext(readFileSync('src/ai/store.js', 'utf8'), { filename: 'ai/store.js' })
  vm.runInThisContext(readFileSync('src/ai/persistence.js', 'utf8'), { filename: 'ai/persistence.js' })
  vm.runInThisContext(readFileSync('src/ai/memory.js', 'utf8'), { filename: 'ai/memory.js' })
  vm.runInThisContext(readFileSync('src/ai/compaction.js', 'utf8'), { filename: 'ai/compaction.js' })
}

function loadRequestRuntime() {
  vm.runInThisContext(readFileSync('src/ai/connection.js', 'utf8'), { filename: 'ai/connection.js' })
  vm.runInThisContext(readFileSync('src/ai/adapter.js', 'utf8'), { filename: 'ai/adapter.js' })
  vm.runInThisContext(readFileSync('src/ai/provider.js', 'utf8'), { filename: 'ai/provider.js' })
  vm.runInThisContext(readFileSync('src/ai/provider-auth.js', 'utf8'), { filename: 'ai/provider-auth.js' })
  vm.runInThisContext(readFileSync('src/ai/provider-transports.js', 'utf8'), { filename: 'ai/provider-transports.js' })
  vm.runInThisContext(readFileSync('src/ai/provider-connections.js', 'utf8'), { filename: 'ai/provider-connections.js' })
  vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
for (const file of ['src/ai/contribution-registry.js', 'src/ai/tool/registry.js', 'src/ai/context/registry.js', 'src/ai/skill/registry.js']) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
  vm.runInThisContext(readFileSync('src/ai/tool/scheduler.js', 'utf8'), { filename: 'ai/tool/scheduler.js' })
vm.runInThisContext(readFileSync('src/ai/tool/runtime.js', 'utf8'), { filename: 'ai/tool/runtime.js' })
  vm.runInThisContext(readFileSync('src/ai/request.js', 'utf8'), { filename: 'ai/request.js' })
  vm.runInThisContext(readFileSync('src/ai/runtime.js', 'utf8'), { filename: 'ai/runtime.js' })
}

function storage() {
  const data = {}
  const records = new Map()
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null },
    setItem: function (key, value) { data[key] = String(value) },
    removeItem: function (key) { delete data[key] },
    adapter: {
      load: function (key) { return Promise.resolve(records.get(key) || null) },
      save: function (key, value) { records.set(key, JSON.parse(JSON.stringify(value))); return Promise.resolve() },
      remove: function (key) { records.delete(key); return Promise.resolve() },
    },
  }
}

function requestText(request) {
  return request.messages.map(function (message) { return String(message.content || '') }).join('\n---\n')
}

function assertCompactionRecordAndRequestView() {
  loadCore()
  loadRequestRuntime()
  const ai = window.aiditor.ai
  ai.compaction.configure({ tailMessages: 2, minMessages: 3, softLimitRatio: 0.01, maxRecordsInRequest: 4 })

  const messages = []
  for (let i = 0; i < 8; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', content: 'old transcript line ' + i })
  messages[1].content = 'Decision: Keep dock panel runtime detached when inactive.'
  messages[2].content = 'Fact: Workspace writes must use baseHash.'
  messages[3].content = 'Todo: Add visual compaction inspector later.'
  messages[4] = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'verify-call', toolId: 'verify.run', status: 'failed', error: 'lint failed' }],
  }
  messages[5] = {
    role: 'tool',
    from: 'tool:verify.run',
    content: 'lint failed at src/app.js',
    meta: { sourceMessageId: 'verify-source', toolCallId: 'verify-call', toolId: 'verify.run' },
    status: 'error',
  }
  messages.push({ role: 'user', content: 'recent raw one' })
  messages.push({ role: 'assistant', content: 'recent raw two' })
  const agent = ai.createAgent({
    name: 'Compactable',
    model: 'deepseek-v4',
    memory: { decisions: ['Keep UI component model single.'] },
    messages: messages,
  })
  const transcriptBefore = ai.snapshot().agents[0].messages.map(function (message) { return message.content })

  const plan = ai.compaction.plan(agent.id, null, { force: true })
  assert.ok(plan)
  assert.deepEqual(plan.messageIds, messages.slice(0, 8).map(function (_, i) { return agent.messages[i].id }))

  const record = ai.compaction.run(agent.id, plan)
  assert.deepEqual(ai.snapshot().agents[0].messages.map(function (message) { return message.content }), transcriptBefore)
  assert.equal(record.messageIds.length, 8)
  assert.match(record.summary, /Compacted 8 older messages/)
  assert.equal(record.decisions[0].text, 'Keep dock panel runtime detached when inactive.')
  assert.equal(record.facts[0].text, 'Workspace writes must use baseHash.')
  assert.equal(record.openItems[0].text, 'Add visual compaction inspector later.')
  assert.equal(record.verification.length >= 1, true)
  assert.equal(record.risks.length >= 1, true)
  const updatedMemory = ai.findAgent(agent.id).memory
  assert.equal(updatedMemory.decisions.includes('Keep dock panel runtime detached when inactive.'), true)
  assert.equal(updatedMemory.facts.includes('Workspace writes must use baseHash.'), true)
  assert.equal(updatedMemory.openItems.includes('Add visual compaction inspector later.'), true)
  assert.equal(ai.compaction.records(agent.id).length, 1)

  const request = ai.planRequest(ai.findAgent(agent.id), null, 'run-test', 'user', 0)
  const text = requestText(request)
  const requestIds = request.messages.map(function (message) { return message.id }).filter(Boolean)
  assert.match(text, /Compact durable agent memory/)
  assert.match(text, /Compacted older transcript ranges/)
  assert.equal(requestIds.includes(agent.messages[0].id), false)
  assert.match(text, /recent raw one/)
  assert.match(text, /recent raw two/)
}

function assertOpenToolSequenceIsProtected() {
  loadCore()
  const ai = window.aiditor.ai
  ai.compaction.configure({ tailMessages: 1, minMessages: 1 })
  const agent = ai.createAgent({
    name: 'Tool Boundary',
    messages: [
      { role: 'user', content: 'safe old request' },
      { role: 'assistant', content: 'safe old answer' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-open', toolId: 'workspace.writeText', status: 'proposed', args: { path: 'x.js' } }],
      },
      { role: 'user', content: 'latest raw tail' },
    ],
  })
  const plan = ai.compaction.plan(agent.id, null, { force: true })
  assert.ok(plan)
  assert.deepEqual(plan.messageIds, agent.messages.slice(0, 2).map(function (message) { return message.id }))
}

function assertToolGroupBudgetStaysTogether() {
  loadCore()
  loadRequestRuntime()
  const ai = window.aiditor.ai
  const agent = ai.createAgent({
    name: 'Tool Group',
    contextBudgetTokens: 1200,
    messages: [
      { role: 'user', content: 'older noise ' + 'x'.repeat(1200) },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', toolId: 'workspace.readText', status: 'completed', args: { path: 'a.js' } }],
      },
      {
        role: 'tool',
        from: 'tool:workspace.readText',
        content: 'read file result',
        meta: { sourceMessageId: null, toolCallId: 'call-1', toolId: 'workspace.readText' },
      },
      { role: 'user', content: 'current task' },
    ],
  })
  const assistant = agent.messages[1]
  const tool = agent.messages[2]
  ai.updateMessage(agent.id, tool.id, { meta: { sourceMessageId: assistant.id, toolCallId: 'call-1', toolId: 'workspace.readText' } })
  const current = ai.findAgent(agent.id).messages[3]
  const request = ai.planRequest(ai.findAgent(agent.id), current, 'run-budget', 'user', 0)
  const ids = request.messages.map(function (message) { return message.id }).filter(Boolean)
  if (ids.includes(assistant.id)) assert.equal(ids.includes(tool.id), true)
}

function assertRuntimeSafePointCompactsBeforeRequest() {
  loadCore()
  loadRequestRuntime()
  const ai = window.aiditor.ai
  ai.compaction.configure({ tailMessages: 1, minMessages: 3, softLimitRatio: 0.01 })
  let requestSeen = null
  ai.registerTransport('capture-compaction', {
    toolProtocol: 'native',
    send: function (connection, request) {
      requestSeen = request
      return { role: 'assistant', content: 'done' }
    },
  })
  ai.registerConnection('capture-compaction', { auth: { type: 'none' }, transport: { type: 'capture-compaction' }, configDefaults: {} })
  const history = []
  for (let i = 0; i < 6; i++) history.push({ role: i % 2 ? 'assistant' : 'user', content: 'runtime old ' + i })
  const agent = ai.createAgent({ name: 'Runtime Compact', connection: 'capture-compaction', contextBudgetTokens: 1024, messages: history })
  const firstOldMessageId = agent.messages[0].id
  const sent = ai.message.send(agent.id, { content: 'new task' })
  return sent.promise.then(function () {
    assert.ok(requestSeen)
    const text = requestText(requestSeen)
    const ids = requestSeen.messages.map(function (message) { return message.id }).filter(Boolean)
    assert.match(text, /Compacted older transcript ranges/)
    assert.equal(ids.includes(firstOldMessageId), false)
    assert.match(text, /new task/)
  })
}

async function assertCompactionsPersist() {
  const s = storage()
  loadCore(s)
  let ai = window.aiditor.ai
  ai.configurePersistence({ key: 'test.compaction', adapter: s.adapter, load: false })
  const agent = ai.createAgent({
    name: 'Persistent Compact',
    messages: [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ],
  })
  const record = ai.compaction.run(agent.id, ai.compaction.plan(agent.id, null, { force: true, tailMessages: 1, minMessages: 1 }))
  await ai.save()
  assert.ok(record)

  loadCore(s)
  ai = window.aiditor.ai
  ai.configurePersistence({ key: 'test.compaction', adapter: s.adapter })
  await ai.persistence.ready()
  const restored = ai.findAgent(agent.id)
  assert.equal(restored.compactions.length, 1)
  assert.equal(restored.compactions[0].id, record.id)
}

function assertCommandsWrapService() {
  loadCore()
  const ai = window.aiditor.ai
  const agent = ai.createAgent({
    name: 'Command Compact',
    messages: [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
      { role: 'user', content: 'five' },
    ],
  })
  const compacted = window.aiditor.commands.run('ai.compactCurrentAgent', { tailMessages: 1, minMessages: 1 })
  assert.equal(compacted.compacted, true)
  assert.equal(compacted.records.length, 1)
  assert.equal(window.aiditor.commands.run('ai.listCurrentAgentCompactions').length, 1)
  const cleared = window.aiditor.commands.run('ai.clearCurrentAgentCompactions')
  assert.equal(cleared.length, 1)
  assert.equal(ai.compaction.records(agent.id).length, 0)
}

assertCompactionRecordAndRequestView()
assertOpenToolSequenceIsProtected()
assertToolGroupBudgetStaysTogether()
await assertRuntimeSafePointCompactsBeforeRequest()
await assertCompactionsPersist()
assertCommandsWrapService()

console.log('ai compaction tests ok')

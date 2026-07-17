import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/ai/name-generator.js',
  'src/ai/permission.js',
  'src/ai/store.js',
  'src/ai/connection.js',
  'src/ai/adapter.js',
  'src/ai/provider.js',
  'src/ai/provider-auth.js',
  'src/ai/provider-transports.js',
  'src/ai/provider-connections.js',
  'src/ai/registries.js',
  'src/ai/context.js',
  'src/ai/orchestration.js',
  'src/ai/request.js',
  'src/ai/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai
const replies = []
const requests = []

async function flush(count = 1) {
  for (let i = 0; i < count; i++) await new Promise(function (resolve) { setTimeout(resolve, 0) })
}

ai.registerTransport('quest-capture', {
  send: function (connection, request) {
    requests.push(request)
    return { role: 'assistant', content: replies.shift() || 'done' }
  },
})
ai.registerConnection('quest-capture', { auth: { type: 'none' }, transport: { type: 'quest-capture' }, configDefaults: {} })

const parent = ai.createAgent({ name: 'Parent', connection: 'quest-capture' })
const child = ai.createAgent({ name: 'Child', parentAgentId: parent.id, connection: 'quest-capture' })

replies.push('first result')
const quest = ai.agent.send(child.id, {
  fromAgentId: parent.id,
  content: 'first task',
})
assert.equal(quest.agentId, child.id)
assert.equal(quest.questId, quest.messageId)
assert.equal(ai.message.read(child.id, quest.messageId, parent.id).content, 'first task')

await flush()

const completed = ai.quest.read(child.id, quest.questId, parent.id)
assert.equal(completed.status, 'completed')
const result = ai.message.read(child.id, completed.resultId, parent.id)
assert.equal(result.content, 'first result')
assert.equal(ai.quest.result(child.id, quest.questId, parent.id).content, 'first result')
assert.equal(result.resultForQuestId, quest.questId)
assert.equal(ai.agent.messages(child.id, { limit: 1 }, parent.id)[0].id, result.id)
assert.equal(ai.agent.messages(child.id, { includeToolMessages: true }, parent.id).length >= 2, true)
const sibling = ai.createAgent({ name: 'Sibling', connection: 'quest-capture' })
assert.equal(ai.quest.read(child.id, quest.questId, sibling.id), null)
assert.equal(ai.message.read(child.id, completed.resultId, sibling.id), null)
assert.equal(ai.agent.messages(child.id, {}, sibling.id).length, 0)

replies.push('second result')
const second = ai.agent.send(child.id, {
  fromAgentId: parent.id,
  content: 'second task',
})
await flush()

assert.equal(ai.quest.read(child.id, quest.questId, parent.id).resultId, completed.resultId)
assert.equal(ai.message.read(child.id, ai.quest.read(child.id, second.questId, parent.id).resultId, parent.id).content, 'second result')
assert.equal(ai.findAgent(parent.id).inbox.some(function (event) {
  return event.type === 'quest.completed' && event.questId === quest.questId
}), true)

let release
const held = new Promise(function (resolve) { release = resolve })
ai.registerTransport('quest-hold', {
  send: function () { return held.then(function () { return { role: 'assistant', content: 'released' } }) },
})
ai.registerConnection('quest-hold', { auth: { type: 'none' }, transport: { type: 'quest-hold' }, configDefaults: {} })
const queued = ai.createAgent({ name: 'Queued', parentAgentId: parent.id, connection: 'quest-hold' })
const firstQueued = ai.message.send(queued.id, { content: 'hold' })
assert.equal(ai.findAgent(queued.id).status, 'running')
const secondQueued = ai.message.send(queued.id, { content: 'after' })
assert.equal(ai.message.read(queued.id, secondQueued.messageId, 'user').status, 'queued')
assert.equal(ai.findAgent(queued.id).queue.length, 1)
const guidedQueued = ai.message.send(queued.id, { content: 'guided after', guidance: 'Prefer this after the held task.' })
assert.equal(ai.findAgent(queued.id).queue.length, 2)
const guidedRequest = ai.makeRequest(ai.findAgent(queued.id), ai.message.read(queued.id, firstQueued.messageId, 'user'), 'run_guided_queue', queued.id, 1)
assert.equal(guidedRequest.messages.some(function (message) {
  return message.role === 'system' && message.content.includes('Queued user messages') && message.content.includes('guided after') && message.content.includes('Prefer this after the held task.')
}), true)
release()
await firstQueued.promise
await flush()
assert.equal(ai.findAgent(queued.id).messages.some(function (message) {
  return message.content === 'after' && message.status === 'done'
}), true)
assert.equal(ai.findAgent(queued.id).queue.length, 0)

ai.registerTransport('delegate-parent', {
  send: function (connection, request) {
    if (request.messages.some(function (message) { return message.role === 'tool' })) {
      return { role: 'assistant', content: 'delegated' }
    }
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{ toolId: 'agent.send', args: { agentId: child.id, content: 'delegated task' } }],
    }
  },
})
ai.registerConnection('delegate-parent', { auth: { type: 'none' }, transport: { type: 'delegate-parent' }, configDefaults: {} })
ai.updateAgent(parent.id, { connection: 'delegate-parent', toolRefs: ['agent.send'] })
const delegated = ai.message.send(parent.id, { content: 'delegate to child' })
await delegated.promise
assert.equal(ai.findAgent(child.id).quests.some(function (item) {
  return item.fromAgentId === parent.id && item.requestMessageId === item.id
}), true)
const parentAfterDelegate = ai.findAgent(parent.id)
assert.notEqual(parentAfterDelegate.status, 'waiting_quest')
await flush()

let approvalRequests = 0
ai.tools.register('approval-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('approval-flow', {
  send: function () {
    approvalRequests += 1
    if (approvalRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ toolId: 'approval-edit', args: { before: 1, after: 2 } }],
      }
    }
    return { role: 'assistant', content: 'applied and continued' }
  },
})
ai.registerConnection('approval-flow', { auth: { type: 'none' }, transport: { type: 'approval-flow' }, configDefaults: {} })
const approvalAgent = ai.createAgent({ name: 'Approval', parentAgentId: parent.id, connection: 'approval-flow', permissionMode: 'auto', toolRefs: ['approval-edit'] })
const approvalRun = ai.message.send(approvalAgent.id, { content: 'needs approval' })
await approvalRun.promise
assert.equal(ai.findAgent(approvalAgent.id).status, 'waiting_approval')
const approvalMessage = ai.findAgent(approvalAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.length
})
const approvalCall = approvalMessage.toolCalls[0]
assert.equal(ai.applyToolCall(approvalAgent.id, approvalCall.id, 'user').status, 'applied')
const resumed = ai.resumeAgent(approvalAgent.id)
await resumed.promise
assert.equal(ai.findAgent(approvalAgent.id).status, 'idle')
assert.equal(ai.findAgent(approvalAgent.id).messages.some(function (message) {
  return message.content === 'applied and continued'
}), true)

let approvalRunRequests = 0
ai.tools.register('approval-run-edit', {
  run: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('approval-run-flow', {
  send: function () {
    approvalRunRequests += 1
    if (approvalRunRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ toolId: 'approval-run-edit', args: { before: 2, after: 3 } }],
      }
    }
    return { role: 'assistant', content: 'continued after run approval' }
  },
})
ai.registerConnection('approval-run-flow', { auth: { type: 'none' }, transport: { type: 'approval-run-flow' }, configDefaults: {} })
const approvalRunAgent = ai.createAgent({ name: 'Approval Run', parentAgentId: parent.id, connection: 'approval-run-flow', permissionMode: 'auto', toolRefs: ['approval-run-edit'] })
const approvalRunFlow = ai.message.send(approvalRunAgent.id, { content: 'needs approval after run' })
await approvalRunFlow.promise
assert.equal(ai.findAgent(approvalRunAgent.id).status, 'waiting_approval')
assert.equal(approvalRunRequests, 1)
const approvalRunMessage = ai.findAgent(approvalRunAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.length
})
const approvalRunCall = approvalRunMessage.toolCalls[0]
assert.equal(approvalRunCall.status, 'completed')
assert.equal(ai.applyToolCall(approvalRunAgent.id, approvalRunCall.id, 'user').status, 'applied')
const resumedRunApproval = ai.resumeAgent(approvalRunAgent.id)
await resumedRunApproval.promise
assert.equal(ai.findAgent(approvalRunAgent.id).messages.some(function (message) {
  return message.content === 'continued after run approval'
}), true)

let fullAccessRequests = 0
ai.tools.register('full-access-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('full-access-flow', {
  send: function () {
    fullAccessRequests += 1
    if (fullAccessRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ toolId: 'full-access-edit', args: { before: 'dark', after: 'dracula' } }],
      }
    }
    return { role: 'assistant', content: 'full access continued' }
  },
})
ai.registerConnection('full-access-flow', { auth: { type: 'none' }, transport: { type: 'full-access-flow' }, configDefaults: {} })
const fullAccessAgent = ai.createAgent({ name: 'Full Access', parentAgentId: parent.id, connection: 'full-access-flow', permissionMode: 'full', toolRefs: ['full-access-edit'] })
const fullAccessRun = ai.message.send(fullAccessAgent.id, { content: 'apply without asking' })
await fullAccessRun.promise
assert.equal(ai.findAgent(fullAccessAgent.id).status, 'idle')
assert.equal(fullAccessRequests, 2)
const fullAccessMessage = ai.findAgent(fullAccessAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.length
})
assert.equal(fullAccessMessage.toolCalls[0].status, 'applied')
assert.equal(ai.findAgent(fullAccessAgent.id).messages.some(function (message) {
  return message.content === 'full access continued'
}), true)

let cappedRequests = 0
ai.tools.register('capped-read', {
  run: function (args) { return { ok: true, id: args.id } },
})
ai.registerTransport('capped-tool-flow', {
  send: function (connection, request) {
    cappedRequests += 1
    if (cappedRequests === 1) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [{ toolId: 'capped-read', args: { id: 'host' } }],
      }
    }
    assert.equal(request.messages.some(function (message) { return message.role === 'tool' }), true)
    return { role: 'assistant', content: 'continued after capped tool' }
  },
})
ai.registerConnection('capped-tool-flow', { auth: { type: 'none' }, transport: { type: 'capped-tool-flow' }, configDefaults: {} })
ai.configureRuntime({ limits: { maxTurns: 1 } })
const cappedAgent = ai.createAgent({ name: 'Capped Tools', parentAgentId: parent.id, connection: 'capped-tool-flow', permissionMode: 'full', toolRefs: ['capped-read'] })
const cappedRun = ai.message.send(cappedAgent.id, { content: 'run capped read' })
await cappedRun.promise
assert.equal(cappedRequests, 1)
const cappedToolMessage = ai.findAgent(cappedAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.length
})
assert.equal(cappedToolMessage.status, 'stopped')
assert.equal(cappedToolMessage.toolCalls[0].status, 'completed')
assert.equal(ai.findAgent(cappedAgent.id).messages.some(function (message) {
  return message.role === 'tool' && message.meta && message.meta.toolCallId === cappedToolMessage.toolCalls[0].id
}), true)
const cappedContinue = ai.message.send(cappedAgent.id, { content: 'continue' })
await cappedContinue.promise
assert.equal(cappedRequests, 2)
assert.equal(ai.findAgent(cappedAgent.id).messages.some(function (message) {
  return message.content === 'continued after capped tool'
}), true)
ai.configureRuntime({ limits: { maxTurns: 32 } })

ai.tools.register('budget-read', {
  run: function () { return { ok: true } },
})
ai.registerTransport('budget-turns', {
  send: function () {
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{ toolId: 'budget-read', args: {} }],
    }
  },
})
ai.registerConnection('budget-turns', { auth: { type: 'none' }, transport: { type: 'budget-turns' }, configDefaults: {} })
const turnBudgetAgent = ai.createAgent({ name: 'Turn Budget', parentAgentId: parent.id, connection: 'budget-turns', permissionMode: 'full', toolRefs: ['budget-read'] })
const turnBudgetSend = ai.agent.send(turnBudgetAgent.id, {
  fromAgentId: parent.id,
  content: 'bounded turn task',
  budget: { maxTurns: 1 },
})
await flush(2)
const turnBudgetQuest = ai.quest.read(turnBudgetAgent.id, turnBudgetSend.questId, parent.id)
assert.equal(turnBudgetQuest.status, 'stopped')
assert.equal(turnBudgetQuest.stopReason, 'max_turns')
assert.equal(ai.findAgent(parent.id).inbox.some(function (event) {
  return event.type === 'quest.stopped' && event.questId === turnBudgetSend.questId && event.meta.stopReason === 'max_turns'
}), true)

ai.registerTransport('budget-tokens', {
  send: function () {
    return {
      role: 'assistant',
      content: '',
      usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
      toolCalls: [{ toolId: 'budget-read', args: {} }],
    }
  },
})
ai.registerConnection('budget-tokens', { auth: { type: 'none' }, transport: { type: 'budget-tokens' }, configDefaults: {} })
const tokenBudgetAgent = ai.createAgent({ name: 'Token Budget', parentAgentId: parent.id, connection: 'budget-tokens', permissionMode: 'full', toolRefs: ['budget-read'] })
const tokenBudgetSend = ai.agent.send(tokenBudgetAgent.id, {
  fromAgentId: parent.id,
  content: 'bounded token task',
  budget: { maxTokens: 10 },
})
await flush(2)
const tokenBudgetQuest = ai.quest.read(tokenBudgetAgent.id, tokenBudgetSend.questId, parent.id)
assert.equal(tokenBudgetQuest.status, 'stopped')
assert.equal(tokenBudgetQuest.stopReason, 'max_tokens')
assert.equal(tokenBudgetQuest.usage.totalTokens, 50)

let budgetApprovalRequests = 0
ai.registerTransport('budget-approval', {
  send: function () {
    budgetApprovalRequests++
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{ toolId: 'approval-edit', args: { before: 2, after: 3 } }],
    }
  },
})
ai.registerConnection('budget-approval', { auth: { type: 'none' }, transport: { type: 'budget-approval' }, configDefaults: {} })
const budgetApprovalAgent = ai.createAgent({ name: 'Budget Approval', parentAgentId: parent.id, connection: 'budget-approval', permissionMode: 'auto', toolRefs: ['approval-edit'] })
const budgetApprovalSend = ai.agent.send(budgetApprovalAgent.id, {
  fromAgentId: parent.id,
  content: 'bounded approval task',
  budget: { maxTurns: 1 },
})
await flush(2)
const budgetApprovalMessage = ai.findAgent(budgetApprovalAgent.id).messages.find(function (message) {
  return message.toolCalls && message.toolCalls.length
})
assert.equal(ai.applyToolCall(budgetApprovalAgent.id, budgetApprovalMessage.toolCalls[0].id, 'user').status, 'applied')
assert.equal(ai.resumeAgent(budgetApprovalAgent.id), null)
assert.equal(budgetApprovalRequests, 1)
assert.equal(ai.quest.read(budgetApprovalAgent.id, budgetApprovalSend.questId, parent.id).stopReason, 'max_turns')

let releaseTimeout
const timeoutHold = new Promise(function (resolve) { releaseTimeout = resolve })
ai.registerTransport('budget-timeout', {
  send: function () { return timeoutHold.then(function () { return { role: 'assistant', content: 'too late' } }) },
})
ai.registerConnection('budget-timeout', { auth: { type: 'none' }, transport: { type: 'budget-timeout' }, configDefaults: {} })
const timeoutBudgetAgent = ai.createAgent({ name: 'Timeout Budget', parentAgentId: parent.id, connection: 'budget-timeout' })
const timeoutBudgetSend = ai.agent.send(timeoutBudgetAgent.id, {
  fromAgentId: parent.id,
  content: 'bounded timeout task',
  budget: { timeoutMs: 20 },
})
await new Promise(function (resolve) { setTimeout(resolve, 40) })
const timeoutBudgetQuest = ai.quest.read(timeoutBudgetAgent.id, timeoutBudgetSend.questId, parent.id)
assert.equal(timeoutBudgetQuest.status, 'stopped')
assert.equal(timeoutBudgetQuest.stopReason, 'timeout')
releaseTimeout()
await flush(2)

let releaseInterrupt
const interruptedHold = new Promise(function (resolve) { releaseInterrupt = resolve })
ai.registerTransport('interrupt-hold', {
  send: function (connection, request, ctx) {
    const last = request.messages[request.messages.length - 1]
    if (last.content === 'slow') {
      return interruptedHold.then(function () { return { role: 'assistant', content: ctx.signal.aborted ? 'aborted slow' : 'slow done' } })
    }
    return { role: 'assistant', content: 'urgent done' }
  },
})
ai.registerConnection('interrupt-hold', { auth: { type: 'none' }, transport: { type: 'interrupt-hold' }, configDefaults: {} })
const interruptAgent = ai.createAgent({ name: 'Interrupt', parentAgentId: parent.id, connection: 'interrupt-hold' })
const slow = ai.message.send(interruptAgent.id, { content: 'slow' })
const urgent = ai.message.send(interruptAgent.id, { content: 'urgent', interrupt: true })
await urgent.promise
releaseInterrupt()
await slow.promise
const interruptMessages = ai.findAgent(interruptAgent.id).messages
assert.equal(interruptMessages.some(function (message) { return message.content === 'urgent done' }), true)
assert.equal(interruptMessages.some(function (message) { return message.content === 'slow' && message.status === 'stopped' }), true)

const budgetAgent = ai.createAgent({ name: 'Budget', parentAgentId: parent.id, connection: 'quest-capture', model: 'tiny', contextBudgetTokens: 160 })
for (let i = 0; i < 40; i++) {
  ai.appendMessage(budgetAgent.id, { role: 'user', content: 'old message ' + i + ' ' + 'x'.repeat(80) })
}
const budgetInput = ai.appendMessage(budgetAgent.id, { role: 'user', content: 'current message' })
const budgetRequest = ai.makeRequest(ai.findAgent(budgetAgent.id), budgetInput, 'run_budget', budgetAgent.id, 0)
assert.equal(budgetRequest.messages.some(function (message) { return message.id === budgetInput.id }), true)
assert.equal(budgetRequest.messages.length < 42, true)
assert.equal(budgetRequest.messages[0].role, 'system')
assert.equal(budgetRequest.messages[0].content.includes('Do not stop after a partial setup step'), false)
assert.equal(budgetRequest.messages[0].content.includes('NO_CURRENT_AI_WORKSPACE'), false)
assert.equal(budgetRequest.messages[0].content.includes('Complete the current request'), true)

const hugeToolAgent = ai.createAgent({ name: 'Huge Tool History', parentAgentId: parent.id, connection: 'quest-capture', model: 'tiny', contextBudgetTokens: 200000 })
const hugeSource = 'function (propsSig, ctx) {\n' + 'x'.repeat(120000) + '\n}'
ai.appendMessage(hugeToolAgent.id, {
  role: 'assistant',
  content: '',
  toolCalls: [{ id: 'call_huge', toolId: 'demo.project.writeFile', args: { path: 'src/huge.panel.js', text: hugeSource }, status: 'applied', applyResult: { text: hugeSource } }],
})
ai.appendMessage(hugeToolAgent.id, { role: 'tool', content: { applied: true, text: hugeSource }, meta: { toolCallId: 'call_huge' } })
const hugeInput = ai.appendMessage(hugeToolAgent.id, { role: 'user', content: 'next' })
const hugeRequest = ai.makeRequest(ai.findAgent(hugeToolAgent.id), hugeInput, 'run_huge', hugeToolAgent.id, 0)
const hugeAssistant = hugeRequest.messages.find(function (message) { return message.toolCalls && message.toolCalls.length })
assert.equal(hugeAssistant.toolCalls[0].args.text.omitted, true)
assert.equal(hugeAssistant.toolCalls[0].args.text.originalLength, hugeSource.length)
const hugeOpenAi = ai.openAiMessages(hugeRequest.messages, hugeRequest)
const hugeArgs = JSON.parse(hugeOpenAi.find(function (message) { return message.tool_calls }).tool_calls[0].function.arguments)
assert.equal(hugeArgs.text.omitted, true)
assert.equal(hugeArgs.text.originalLength, hugeSource.length)

let releaseLimitedA
let releaseLimitedB
const limitedA = new Promise(function (resolve) { releaseLimitedA = resolve })
const limitedB = new Promise(function (resolve) { releaseLimitedB = resolve })
let limitedRunning = 0
let limitedPeak = 0
ai.registerTransport('limited-concurrency', {
  send: function (connection, request) {
    limitedRunning++
    limitedPeak = Math.max(limitedPeak, limitedRunning)
    const text = request.messages[request.messages.length - 1].content
    const wait = text === 'a' ? limitedA : limitedB
    return wait.then(function () {
      limitedRunning--
      return { role: 'assistant', content: text + ' done' }
    })
  },
})
ai.registerConnection('limited-concurrency', { auth: { type: 'none' }, transport: { type: 'limited-concurrency' }, configDefaults: {} })
ai.configureRuntime({ maxConcurrentAgents: 1 })
const limitedOne = ai.createAgent({ name: 'Limited A', parentAgentId: parent.id, connection: 'limited-concurrency' })
const limitedTwo = ai.createAgent({ name: 'Limited B', parentAgentId: parent.id, connection: 'limited-concurrency' })
const limitedRunA = ai.message.send(limitedOne.id, { content: 'a' })
const limitedRunB = ai.message.send(limitedTwo.id, { content: 'b' })
assert.equal(ai.findAgent(limitedTwo.id).status, 'queued')
releaseLimitedA()
await limitedRunA.promise
await flush()
assert.equal(ai.findAgent(limitedTwo.id).status, 'running')
releaseLimitedB()
await limitedRunB.promise
assert.equal(limitedPeak, 1)
ai.configureRuntime({ maxConcurrentAgents: 8 })

let releaseBatchA
let releaseBatchB
const batchA = new Promise(function (resolve) { releaseBatchA = resolve })
const batchB = new Promise(function (resolve) { releaseBatchB = resolve })
const batchRequests = []
ai.registerTransport('batch-child', {
  send: function (connection, request) {
    return (request.agent.name === 'Batch A' ? batchA : batchB).then(function (text) {
      return { role: 'assistant', content: text }
    })
  },
})
ai.registerConnection('batch-child', { auth: { type: 'none' }, transport: { type: 'batch-child' }, configDefaults: {} })
ai.registerTransport('batch-parent', {
  send: function (connection, request) {
    batchRequests.push(request)
    const event = request.input && request.input.meta && request.input.meta.runtimeEvent
    if (event === 'post-delegation.continuation') return { role: 'assistant', content: 'local title' }
    if (event === 'inbox.continuation') return { role: 'assistant', content: 'handled ' + request.input.meta.events.length }
    return {
      role: 'assistant',
      content: 'premature local title',
      toolCalls: [
        { toolId: 'agent.delegate', args: { agentId: batchChildA.id, content: 'task a' } },
        { toolId: 'agent.delegate', args: { agentId: batchChildB.id, content: 'task b' } },
      ],
    }
  },
})
ai.registerConnection('batch-parent', { auth: { type: 'none' }, transport: { type: 'batch-parent' }, configDefaults: {} })
const batchParent = ai.createAgent({ name: 'Batch Parent', parentAgentId: parent.id, connection: 'batch-parent', toolRefs: ['agent.delegate', 'quest.result'] })
const batchChildA = ai.createAgent({ name: 'Batch A', parentAgentId: batchParent.id, connection: 'batch-child' })
const batchChildB = ai.createAgent({ name: 'Batch B', parentAgentId: batchParent.id, connection: 'batch-child' })
const batchRun = ai.message.send(batchParent.id, { content: 'delegate two and do local work' })
await batchRun.promise
await flush(3)
const batchParentMessages = ai.findAgent(batchParent.id).messages
const actionMessage = batchParentMessages.find(function (message) {
  return message.toolCalls && message.toolCalls.length === 2
})
assert.equal(actionMessage.content, '')
assert.equal(actionMessage.meta.actionNote, 'premature local title')
assert.equal(batchParentMessages.some(function (message) { return message.content === 'local title' }), true)
const postDelegationRequest = batchRequests.find(function (request) {
  return request.input && request.input.meta && request.input.meta.runtimeEvent === 'post-delegation.continuation'
})
assert.equal(postDelegationRequest.input.meta.delegated.length, 2)
assert.equal(postDelegationRequest.input.meta.delegated[0].agentId, batchChildA.id)
assert.equal(postDelegationRequest.input.meta.delegated[0].questId != null, true)
assert.equal(postDelegationRequest.input.meta.delegated[0].messageId != null, true)
releaseBatchA('result a')
await flush(5)
const firstInbox = batchRequests.find(function (request) {
  return request.input && request.input.meta && request.input.meta.runtimeEvent === 'inbox.continuation'
})
assert.equal(firstInbox.input.meta.events.length, 1)
assert.equal(firstInbox.input.meta.pendingQuests.length, 1)
assert.equal(ai.findAgent(batchParent.id).messages.some(function (message) { return message.content === 'handled 1' }), true)
releaseBatchB('result b')
await flush(5)
const inboxRequests = batchRequests.filter(function (request) {
  return request.input && request.input.meta && request.input.meta.runtimeEvent === 'inbox.continuation'
})
assert.equal(inboxRequests.length, 2)
assert.equal(inboxRequests[1].input.meta.events.length, 1)
assert.equal(inboxRequests[1].input.meta.pendingQuests.length, 0)

assert.equal(requests.length >= 2, true)
console.log('ai quest runtime tests ok')

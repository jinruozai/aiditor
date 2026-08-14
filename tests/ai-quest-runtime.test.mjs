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
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/tool/runtime.js',
  'src/ai/orchestration.js',
  'src/ai/request.js',
  'src/ai/runtime.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ai = window.aiditor.ai
const TEST_META = { owner: 'test:quest-runtime' }
let nextSkill = 1
function registerTool(name, spec) { return ai.tools.register(name, spec, TEST_META) }
function skillRefs(tools) {
  const id = 'test.quest.' + nextSkill++
  ai.skills.register(id, { title: id, tools: tools }, TEST_META)
  return [id]
}
const replies = []
const requests = []

async function flush(count = 1) {
  for (let i = 0; i < count; i++) await new Promise(function (resolve) { setTimeout(resolve, 0) })
}

ai.registerTransport('quest-capture', {
  toolProtocol: 'native',
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

ai.registerTransport('quest-failure', {
  toolProtocol: 'native',
  send: function () { throw new Error('child provider failed') },
})
ai.registerConnection('quest-failure', { auth: { type: 'none' }, transport: { type: 'quest-failure' }, configDefaults: {} })
const failingChild = ai.createAgent({ name: 'Failing Child', parentAgentId: parent.id, connection: 'quest-failure' })
const failedQuest = ai.agent.send(failingChild.id, {
  fromAgentId: parent.id,
  sourceResponseId: 'response-failure',
  content: 'fail this task',
})
await failedQuest.promise
await flush(2)
assert.equal(ai.findQuest(failingChild.id, failedQuest.questId).status, 'failed')
assert.equal(ai.findAgent(parent.id).inbox.some(function (event) {
  return event.type === 'quest.failed' &&
    event.questId === failedQuest.questId &&
    event.meta.responseId === 'response-failure'
}), true)

let release
const held = new Promise(function (resolve) { release = resolve })
ai.registerTransport('quest-hold', {
  toolProtocol: 'native',
  send: function () { return held.then(function () { return { role: 'assistant', content: 'released' } }) },
})
ai.registerConnection('quest-hold', { auth: { type: 'none' }, transport: { type: 'quest-hold' }, configDefaults: {} })
const queued = ai.createAgent({ name: 'Queued', parentAgentId: parent.id, connection: 'quest-hold' })
const firstQueued = ai.message.send(queued.id, { content: 'hold' })
assert.equal(ai.findAgent(queued.id).status, 'running')
const secondQueued = ai.message.send(queued.id, { content: 'after' })
assert.equal(ai.message.read(queued.id, secondQueued.messageId, 'user').status, 'queued')
assert.equal(ai.findAgent(queued.id).queue.length, 1)
const finalQueued = ai.message.send(queued.id, { content: 'final queued task' })
assert.equal(ai.findAgent(queued.id).queue.length, 2)
const queuedRequest = ai.makeRequest(ai.findAgent(queued.id), ai.message.read(queued.id, firstQueued.messageId, 'user'), 'run_queued_context', queued.id, 1)
assert.equal(queuedRequest.messages.some(function (message) {
  return message.role === 'system' && message.content.includes('Queued user messages') && message.content.includes('final queued task')
}), true)
release()
await firstQueued.promise
await flush()
assert.equal(ai.findAgent(queued.id).messages.some(function (message) {
  return message.content === 'after' && message.status === 'done'
}), true)
assert.equal(ai.findAgent(queued.id).queue.length, 0)

let releaseQueuedCancel
const queuedCancelHold = new Promise(function (resolve) { releaseQueuedCancel = resolve })
ai.registerTransport('quest-cancel-queued', {
  toolProtocol: 'native',
  send: function () { return queuedCancelHold.then(function () { return { role: 'assistant', content: 'active complete' } }) },
})
ai.registerConnection('quest-cancel-queued', { auth: { type: 'none' }, transport: { type: 'quest-cancel-queued' }, configDefaults: {} })
const queuedCancelAgent = ai.createAgent({ name: 'Queued Cancel', parentAgentId: parent.id, connection: 'quest-cancel-queued' })
const activeCancelQuest = ai.agent.send(queuedCancelAgent.id, { fromAgentId: parent.id, content: 'active quest' })
const queuedCancelQuest = ai.agent.send(queuedCancelAgent.id, { fromAgentId: parent.id, content: 'cancel queued quest' })
assert.equal(ai.findAgent(queuedCancelAgent.id).activeQuestId, activeCancelQuest.questId)
assert.equal(ai.findAgent(queuedCancelAgent.id).queue.length, 1)
const queuedCancellation = ai.quest.cancel(queuedCancelAgent.id, queuedCancelQuest.questId, parent.id)
assert.equal(queuedCancellation.cancelled, true)
assert.equal(queuedCancellation.outcome, 'cancelled')
assert.equal(queuedCancellation.previousStatus, 'queued')
assert.equal(queuedCancellation.status, 'stopped')
assert.equal(queuedCancellation.stopReason, 'cancelled')
assert.equal(ai.findAgent(queuedCancelAgent.id).activeQuestId, activeCancelQuest.questId)
assert.equal(ai.findAgent(queuedCancelAgent.id).queue.length, 0)
const repeatedQueuedCancellation = ai.quest.cancel(queuedCancelAgent.id, queuedCancelQuest.questId, parent.id)
assert.equal(repeatedQueuedCancellation.cancelled, false)
assert.equal(repeatedQueuedCancellation.outcome, 'already_terminal')
assert.equal(repeatedQueuedCancellation.previousStatus, 'stopped')
assert.equal(ai.quest.cancel(queuedCancelAgent.id, activeCancelQuest.questId, sibling.id), null)
releaseQueuedCancel()
await flush(2)

let releaseRunningCancel
const runningCancelHold = new Promise(function (resolve) { releaseRunningCancel = resolve })
ai.registerTransport('quest-cancel-running', {
  toolProtocol: 'native',
  send: function () { return runningCancelHold.then(function () { return { role: 'assistant', content: 'late result' } }) },
})
ai.registerConnection('quest-cancel-running', { auth: { type: 'none' }, transport: { type: 'quest-cancel-running' }, configDefaults: {} })
const runningCancelAgent = ai.createAgent({ name: 'Running Cancel', parentAgentId: parent.id, connection: 'quest-cancel-running' })
const runningCancelQuest = ai.agent.send(runningCancelAgent.id, { fromAgentId: parent.id, content: 'cancel active quest' })
const runningCancellation = ai.quest.cancel(runningCancelAgent.id, runningCancelQuest.questId, parent.id)
assert.equal(runningCancellation.cancelled, true)
assert.equal(runningCancellation.outcome, 'cancelled')
assert.equal(runningCancellation.previousStatus, 'running')
assert.equal(runningCancellation.status, 'stopped')
assert.equal(runningCancellation.stopReason, 'cancelled')
assert.equal(ai.findAgent(runningCancelAgent.id).status, 'idle')
releaseRunningCancel()
await flush(2)

ai.registerTransport('delegate-parent', {
  toolProtocol: 'native',
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
ai.updateAgent(parent.id, { connection: 'delegate-parent', skillRefs: skillRefs(['agent.send']) })
const delegated = ai.message.send(parent.id, { content: 'delegate to child' })
await delegated.promise
assert.equal(ai.findAgent(child.id).quests.some(function (item) {
  return item.fromAgentId === parent.id && item.requestMessageId === item.id
}), true)
const parentAfterDelegate = ai.findAgent(parent.id)
assert.notEqual(parentAfterDelegate.status, 'waiting_quest')
await flush()

let approvalRequests = 0
registerTool('approval-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('approval-flow', {
  toolProtocol: 'native',
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
const approvalAgent = ai.createAgent({ name: 'Approval', parentAgentId: parent.id, connection: 'approval-flow', permissionMode: 'auto', skillRefs: skillRefs(['approval-edit']) })
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
registerTool('approval-run-edit', {
  run: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('approval-run-flow', {
  toolProtocol: 'native',
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
const approvalRunAgent = ai.createAgent({ name: 'Approval Run', parentAgentId: parent.id, connection: 'approval-run-flow', permissionMode: 'auto', skillRefs: skillRefs(['approval-run-edit']) })
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
registerTool('full-access-edit', {
  preview: function (args) { return { before: args.before, after: args.after } },
  apply: function (preview) { return { applied: true, preview: preview } },
})
ai.registerTransport('full-access-flow', {
  toolProtocol: 'native',
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
const fullAccessAgent = ai.createAgent({ name: 'Full Access', parentAgentId: parent.id, connection: 'full-access-flow', permissionMode: 'full', skillRefs: skillRefs(['full-access-edit']) })
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
registerTool('capped-read', {
  run: function (args) { return { ok: true, id: args.id } },
})
ai.registerTransport('capped-tool-flow', {
  toolProtocol: 'native',
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
const cappedAgent = ai.createAgent({ name: 'Capped Tools', parentAgentId: parent.id, connection: 'capped-tool-flow', permissionMode: 'full', skillRefs: skillRefs(['capped-read']) })
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

registerTool('budget-read', {
  run: function () { return { ok: true } },
})
ai.registerTransport('budget-turns', {
  toolProtocol: 'native',
  send: function () {
    return {
      role: 'assistant',
      content: '',
      toolCalls: [{ toolId: 'budget-read', args: {} }],
    }
  },
})
ai.registerConnection('budget-turns', { auth: { type: 'none' }, transport: { type: 'budget-turns' }, configDefaults: {} })
const turnBudgetAgent = ai.createAgent({ name: 'Turn Budget', parentAgentId: parent.id, connection: 'budget-turns', permissionMode: 'full', skillRefs: skillRefs(['budget-read']) })
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
  toolProtocol: 'native',
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
const tokenBudgetAgent = ai.createAgent({ name: 'Token Budget', parentAgentId: parent.id, connection: 'budget-tokens', permissionMode: 'full', skillRefs: skillRefs(['budget-read']) })
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
  toolProtocol: 'native',
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
const budgetApprovalAgent = ai.createAgent({ name: 'Budget Approval', parentAgentId: parent.id, connection: 'budget-approval', permissionMode: 'auto', skillRefs: skillRefs(['approval-edit']) })
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
  toolProtocol: 'native',
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
  toolProtocol: 'native',
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
  toolProtocol: 'native',
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
  toolProtocol: 'native',
  send: function (connection, request) {
    return (request.agent.name === 'Batch A' ? batchA : batchB).then(function (text) {
      return { role: 'assistant', content: text }
    })
  },
})
ai.registerConnection('batch-child', { auth: { type: 'none' }, transport: { type: 'batch-child' }, configDefaults: {} })
ai.registerTransport('batch-parent', {
  toolProtocol: 'native',
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
const batchParent = ai.createAgent({ name: 'Batch Parent', parentAgentId: parent.id, connection: 'batch-parent', skillRefs: skillRefs(['agent.delegate', 'quest.result']) })
const batchChildA = ai.createAgent({ name: 'Batch A', parentAgentId: batchParent.id, connection: 'batch-child' })
const batchChildB = ai.createAgent({ name: 'Batch B', parentAgentId: batchParent.id, connection: 'batch-child' })
const batchRun = ai.message.send(batchParent.id, { content: 'delegate two and do local work' })
await batchRun.promise
await flush(3)
const batchParentMessages = ai.findAgent(batchParent.id).messages
const batchResponseId = batchRun.message.meta.responseId
assert.equal(batchResponseId, batchRun.message.id)
const actionMessage = batchParentMessages.find(function (message) {
  return message.toolCalls && message.toolCalls.length === 2
})
assert.equal(actionMessage.meta.responseId, batchResponseId)
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
assert.equal(postDelegationRequest.input.meta.responseId, batchResponseId)
assert.equal(ai.findAgent(batchParent.id).messages.find(function (message) { return message.content === 'local title' }).meta.responseId, batchResponseId)
assert.equal(ai.findQuest(batchChildA.id, postDelegationRequest.input.meta.delegated[0].questId).meta.sourceResponseId, batchResponseId)
assert.equal(ai.findAgent(batchParent.id).status, 'idle')
const waitingBatchResponse = ai.response.read(batchParent.id, batchResponseId)
assert.equal(waitingBatchResponse.agentId, batchParent.id)
assert.equal(waitingBatchResponse.responseId, batchResponseId)
assert.equal(waitingBatchResponse.status, 'waiting')
assert.equal(waitingBatchResponse.active, true)
assert.equal(waitingBatchResponse.stoppable, true)
assert.equal(waitingBatchResponse.startedAt, batchRun.message.createdAt)
assert.equal(waitingBatchResponse.pendingQuestCount, 2)
assert.equal(waitingBatchResponse.pendingAgentCount, 2)
assert.deepEqual(waitingBatchResponse.relatedAgentIds.sort(), [batchParent.id, batchChildA.id, batchChildB.id].sort())
assert.equal(waitingBatchResponse.metrics.startedAt, batchRun.message.createdAt)
assert.equal(waitingBatchResponse.metrics.completedAt, null)
assert.equal(waitingBatchResponse.metrics.providerTurnCount >= 1, true)
releaseBatchA('result a')
await flush(5)
const firstInbox = batchRequests.find(function (request) {
  return request.input && request.input.meta && request.input.meta.runtimeEvent === 'inbox.continuation'
})
assert.equal(firstInbox.input.meta.events.length, 1)
assert.equal(firstInbox.input.meta.pendingQuests.length, 1)
assert.equal(firstInbox.input.meta.responseId, batchResponseId)
assert.equal(ai.findAgent(batchParent.id).messages.some(function (message) { return message.content === 'handled 1' }), true)
releaseBatchB('result b')
await flush(5)
const inboxRequests = batchRequests.filter(function (request) {
  return request.input && request.input.meta && request.input.meta.runtimeEvent === 'inbox.continuation'
})
assert.equal(inboxRequests.length, 2)
assert.equal(inboxRequests[1].input.meta.events.length, 1)
assert.equal(inboxRequests[1].input.meta.pendingQuests.length, 0)
assert.equal(ai.response.read(batchParent.id, batchResponseId).status, 'completed')
assert.equal(ai.response.read(batchParent.id, batchResponseId).active, false)

const responseStopReleases = {}
ai.registerTransport('response-stop-child', {
  toolProtocol: 'native',
  send: function (connection, request) {
    return new Promise(function (resolve) { responseStopReleases[request.agent.id] = resolve })
  },
})
ai.registerConnection('response-stop-child', { auth: { type: 'none' }, transport: { type: 'response-stop-child' }, configDefaults: {} })
const responseStopParent = ai.createAgent({ name: 'Response Stop Parent', parentAgentId: parent.id, connection: 'quest-capture' })
const responseStopChild = ai.createAgent({ name: 'Response Stop Child', parentAgentId: responseStopParent.id, connection: 'response-stop-child' })
const responseStopGrandchild = ai.createAgent({ name: 'Response Stop Grandchild', parentAgentId: responseStopChild.id, connection: 'response-stop-child' })
const responseStopUnrelated = ai.createAgent({ name: 'Response Stop Unrelated', parentAgentId: responseStopParent.id, connection: 'response-stop-child' })
const responseStopRoot = ai.message.send(responseStopParent.id, { content: 'delegate a cancellable tree' })
await responseStopRoot.promise
const responseStopId = responseStopRoot.message.meta.responseId
const responseStopChildQuest = ai.agent.send(responseStopChild.id, {
  fromAgentId: responseStopParent.id,
  sourceResponseId: responseStopId,
  content: 'child task',
})
const responseStopGrandchildQuest = ai.agent.send(responseStopGrandchild.id, {
  fromAgentId: responseStopChild.id,
  sourceResponseId: responseStopChildQuest.messageId,
  content: 'grandchild task',
})
const responseStopUnrelatedQuest = ai.agent.send(responseStopUnrelated.id, {
  fromAgentId: responseStopParent.id,
  sourceResponseId: 'unrelated-response',
  content: 'unrelated task',
})
await flush(2)
assert.equal(ai.findAgent(responseStopParent.id).status, 'idle')
assert.equal(ai.response.read(responseStopParent.id, responseStopId).status, 'waiting')
assert.equal(ai.response.read(responseStopParent.id, responseStopId).pendingQuestCount, 2)
const stoppedResponse = ai.response.stop(responseStopParent.id, responseStopId)
assert.equal(stoppedResponse.outcome, 'stopped')
assert.equal(stoppedResponse.stopped, true)
assert.equal(stoppedResponse.cancelledQuestCount, 2)
assert.equal(ai.findQuest(responseStopChild.id, responseStopChildQuest.questId).status, 'stopped')
assert.equal(ai.findQuest(responseStopGrandchild.id, responseStopGrandchildQuest.questId).status, 'stopped')
assert.equal(ai.findQuest(responseStopUnrelated.id, responseStopUnrelatedQuest.questId).status, 'running')
assert.equal(ai.response.read(responseStopParent.id, responseStopId).status, 'stopped')
assert.equal(ai.response.read(responseStopParent.id, responseStopId).active, false)
assert.equal(ai.readMessage(responseStopParent.id, responseStopRoot.messageId).status, 'done')
assert.equal(ai.readMessage(responseStopParent.id, responseStopRoot.messageId).meta.responseStopReason, 'cancelled')
assert.equal(ai.response.stop(responseStopParent.id, responseStopId).outcome, 'already_terminal')
responseStopReleases[responseStopChild.id]({ role: 'assistant', content: 'late child result' })
responseStopReleases[responseStopGrandchild.id]({ role: 'assistant', content: 'late grandchild result' })
ai.quest.cancel(responseStopUnrelated.id, responseStopUnrelatedQuest.questId, 'user')
responseStopReleases[responseStopUnrelated.id]({ role: 'assistant', content: 'late unrelated result' })
await flush(3)
assert.equal(ai.findAgent(responseStopParent.id).inbox.filter(function (event) {
  return !event.consumed && event.meta && event.meta.responseId === responseStopId
}).length, 0)
assert.equal(ai.findAgent(responseStopChild.id).inbox.filter(function (event) {
  return !event.consumed && event.meta && event.meta.responseId === responseStopChildQuest.messageId
}).length, 0)

const scopedRequests = []
ai.registerTransport('response-scoped-inbox', {
  toolProtocol: 'native',
  send: function (connection, request) {
    scopedRequests.push(request)
    const event = request.input && request.input.meta && request.input.meta.runtimeEvent
    return { role: 'assistant', content: event ? 'handled current inbox' : String(request.input.content || '') }
  },
})
ai.registerConnection('response-scoped-inbox', { auth: { type: 'none' }, transport: { type: 'response-scoped-inbox' }, configDefaults: {} })
const scopedAgent = ai.createAgent({ name: 'Response Scoped Inbox', parentAgentId: parent.id, connection: 'response-scoped-inbox' })
const scopedFirst = ai.message.send(scopedAgent.id, { content: 'response a' })
await scopedFirst.promise
const scopedFirstResponseId = scopedFirst.message.meta.responseId
const staleBeforeNextInput = ai.appendInboxEvent(scopedAgent.id, {
  type: 'quest.completed',
  questId: 'stale-before-next-input',
  summary: 'old result',
  meta: { responseId: scopedFirstResponseId },
})
const scopedSecond = ai.message.send(scopedAgent.id, { content: 'only answer this' })
await scopedSecond.promise
await flush(2)
assert.deepEqual(scopedRequests.map(function (request) { return request.input.content }), ['response a', 'only answer this'])
assert.equal(ai.findAgent(scopedAgent.id).inbox.find(function (event) { return event.id === staleBeforeNextInput.id }).consumed, true)

const scopedSecondResponseId = scopedSecond.message.meta.responseId
const staleMixed = ai.appendInboxEvent(scopedAgent.id, {
  type: 'quest.completed',
  questId: 'stale-mixed',
  meta: { responseId: scopedFirstResponseId },
})
const unidentifiedMixed = ai.appendInboxEvent(scopedAgent.id, {
  type: 'quest.completed',
  questId: 'unidentified-mixed',
})
const currentMixed = ai.appendInboxEvent(scopedAgent.id, {
  type: 'quest.completed',
  questId: 'current-mixed',
  meta: { responseId: scopedSecondResponseId },
})
const scopedContinuation = ai.scheduleAgent(scopedAgent.id)
await scopedContinuation.promise
const scopedInboxRequest = scopedRequests.find(function (request) {
  return request.input && request.input.meta && request.input.meta.runtimeEvent === 'inbox.continuation'
})
assert.equal(scopedInboxRequest.input.meta.responseId, scopedSecondResponseId)
assert.deepEqual(scopedInboxRequest.input.meta.events.map(function (event) { return event.id }), [currentMixed.id])
assert.equal(ai.findAgent(scopedAgent.id).inbox.find(function (event) { return event.id === staleMixed.id }).consumed, true)
assert.equal(ai.findAgent(scopedAgent.id).inbox.find(function (event) { return event.id === unidentifiedMixed.id }).consumed, true)
assert.equal(ai.findAgent(scopedAgent.id).inbox.find(function (event) { return event.id === currentMixed.id }).consumed, true)

const supersedeRequests = []
ai.registerTransport('supersede-continuation', {
  toolProtocol: 'native',
  send: function (connection, request) {
    supersedeRequests.push(request)
    return { role: 'assistant', content: String(request.input.content || '') }
  },
})
ai.registerConnection('supersede-continuation', { auth: { type: 'none' }, transport: { type: 'supersede-continuation' }, configDefaults: {} })
const supersedeAgent = ai.createAgent({ name: 'Supersede Continuation', parentAgentId: parent.id, connection: 'supersede-continuation' })
const supersedeSeed = ai.message.send(supersedeAgent.id, { content: 'seed response' })
await supersedeSeed.promise
const queuedRuntime = ai.message.send(supersedeAgent.id, {
  from: 'system',
  role: 'user',
  content: 'queued stale continuation',
  meta: { runtimeEvent: 'inbox.continuation', responseId: supersedeSeed.message.meta.responseId },
  priority: -10,
  schedule: false,
})
const supersedeForeground = ai.message.send(supersedeAgent.id, { content: 'new foreground response' })
await supersedeForeground.promise
assert.equal(ai.readMessage(supersedeAgent.id, queuedRuntime.messageId).status, 'stopped')
assert.equal(ai.readMessage(supersedeAgent.id, queuedRuntime.messageId).meta.stopReason, 'superseded')
assert.equal(supersedeRequests.some(function (request) { return request.input.id === queuedRuntime.messageId }), false)

let releaseLateContinuationRoot
const lateContinuationRoot = new Promise(function (resolve) { releaseLateContinuationRoot = resolve })
const lateContinuationRequests = []
ai.registerTransport('late-continuation', {
  toolProtocol: 'native',
  send: function (connection, request) {
    lateContinuationRequests.push(request)
    if (request.input.content === 'running response a') return lateContinuationRoot
    return { role: 'assistant', content: String(request.input.content || '') }
  },
})
ai.registerConnection('late-continuation', { auth: { type: 'none' }, transport: { type: 'late-continuation' }, configDefaults: {} })
const lateContinuationAgent = ai.createAgent({ name: 'Late Continuation', parentAgentId: parent.id, connection: 'late-continuation' })
const lateRoot = ai.message.send(lateContinuationAgent.id, { content: 'running response a' })
await flush(2)
const lateForeground = ai.message.send(lateContinuationAgent.id, { content: 'queued response b' })
const lateRuntime = ai.message.send(lateContinuationAgent.id, {
  from: 'system',
  role: 'user',
  content: 'generated after response b was queued',
  meta: { runtimeEvent: 'post-delegation.continuation', responseId: lateRoot.message.meta.responseId },
  priority: -10,
  schedule: false,
})
releaseLateContinuationRoot({ role: 'assistant', content: 'response a done' })
await lateRoot.promise
await flush(5)
assert.equal(ai.readMessage(lateContinuationAgent.id, lateForeground.messageId).status, 'done')
assert.equal(ai.readMessage(lateContinuationAgent.id, lateRuntime.messageId).status, 'stopped')
assert.deepEqual(lateContinuationRequests.map(function (request) { return request.input.content }), ['running response a', 'queued response b'])

let releaseActiveRuntime
const activeRuntimeHeld = new Promise(function (resolve) { releaseActiveRuntime = resolve })
const activeSupersedeRequests = []
ai.registerTransport('supersede-active-continuation', {
  toolProtocol: 'native',
  send: function (connection, request) {
    activeSupersedeRequests.push(request)
    if (request.input && request.input.meta && request.input.meta.runtimeEvent) return activeRuntimeHeld
    return { role: 'assistant', content: String(request.input.content || '') }
  },
})
ai.registerConnection('supersede-active-continuation', { auth: { type: 'none' }, transport: { type: 'supersede-active-continuation' }, configDefaults: {} })
const activeSupersedeAgent = ai.createAgent({ name: 'Supersede Active Continuation', parentAgentId: parent.id, connection: 'supersede-active-continuation' })
const activeSupersedeSeed = ai.message.send(activeSupersedeAgent.id, { content: 'active seed' })
await activeSupersedeSeed.promise
const activeRuntime = ai.message.send(activeSupersedeAgent.id, {
  from: 'system',
  role: 'user',
  content: 'active stale continuation',
  meta: { runtimeEvent: 'inbox.continuation', responseId: activeSupersedeSeed.message.meta.responseId },
  priority: -10,
})
await flush(2)
const activeForeground = ai.message.send(activeSupersedeAgent.id, { content: 'foreground wins' })
await activeForeground.promise
assert.equal(ai.readMessage(activeSupersedeAgent.id, activeRuntime.messageId).status, 'stopped')
assert.equal(ai.readMessage(activeSupersedeAgent.id, activeRuntime.messageId).meta.runtimeEvent, 'inbox.continuation')
assert.equal(activeSupersedeRequests[activeSupersedeRequests.length - 1].input.content, 'foreground wins')
releaseActiveRuntime({ role: 'assistant', content: 'stale result' })
await activeRuntime.promise
assert.equal(ai.findAgent(activeSupersedeAgent.id).messages.some(function (message) {
  return message.content === 'stale result' && message.status === 'done'
}), false)

assert.equal(requests.length >= 2, true)
console.log('ai quest runtime tests ok')

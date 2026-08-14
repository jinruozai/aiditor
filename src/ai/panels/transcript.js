;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui

  function read(v) {
    return ui.isSignal(v) ? v() : v
  }

  function readList(v) {
    return read(v) || []
  }

  function disposeTree(el) {
    if (!el) return
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function activeAgent() {
    const id = read(aiditor.ai.activeAgentId)
    const list = readList(aiditor.ai.agents)
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
    return null
  }

  function messagesOf(agent) {
    return agent ? (agent.messages || agent.transcript || agent.history || []).filter(function (msg) {
      return (msg.role || msg.type) !== 'tool' && !isHiddenRuntimeMessage(msg)
    }) : []
  }

  function isHiddenRuntimeMessage(msg) {
    const event = msg && msg.meta && msg.meta.runtimeEvent
    return event === 'post-delegation.continuation'
  }

  function roleLabel(msg) {
    if (msg.empty) return msg.title
    if (msg.from && msg.from !== 'user') return msg.from
    return msg.role || msg.type || 'message'
  }

  function statusOf(msg) {
    return msg.status || (msg.meta && msg.meta.status) || 'done'
  }

  function formatTime(time) {
    if (!time) return ''
    const date = new Date(time)
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    return h + ':' + m
  }

  function displayText(v) {
    if (v == null) return ''
    if (typeof v === 'string') return v
    if (v && typeof v === 'object' && v.type === 'rich-prompt') {
      return v.renderedText || (aiditor.ai.richPrompt && aiditor.ai.richPrompt.toModelText ? aiditor.ai.richPrompt.toModelText(v) : '')
    }
    return JSON.stringify(v, null, 2)
  }

  function messageText(msg) {
    return displayText(msg.content != null ? msg.content : msg.text)
  }

  function copyBlock(title, value) {
    if (value == null) return ''
    const text = displayText(value).trim()
    return text ? title + ':\n' + text : ''
  }

  function toolCallCopyText(call) {
    const lines = []
    const status = toolStatus(call)
    lines.push('[Tool] ' + toolName(call) + (status ? ' (' + status + ')' : ''))
    if (call.description || call.title) lines.push('Description: ' + (call.description || call.title))
    const args = copyBlock('Args', call.args)
    if (args) lines.push(args)
    const preview = copyBlock('Preview', call.preview)
    if (preview) lines.push(preview)
    const result = copyBlock('Result', call.result)
    if (result) lines.push(result)
    const applied = copyBlock('Applied', call.applyResult)
    if (applied) lines.push(applied)
    const error = copyBlock('Error', call.error)
    if (error) lines.push(error)
    return lines.join('\n')
  }

  function messageCopyText(msg) {
    if (aiditor.ai.messageCopyText) return aiditor.ai.messageCopyText(msg, { source: 'transcript' })
    const parts = []
    const text = messageText(msg).trim()
    if (text) parts.push(text)
    const calls = toolCallsOf(msg)
    for (let i = 0; i < calls.length; i++) parts.push(toolCallCopyText(calls[i]))
    const error = statusOf(msg) === 'error' && msg.meta && msg.meta.error ? copyBlock('Error', msg.meta.error) : ''
    if (error) parts.push(error)
    return parts.join('\n\n')
  }

  function usageOf(msg) {
    return msg.usage || (msg.stats && msg.stats.usage) || (msg.meta && msg.meta.usage) || null
  }

  function usageNumber(usage, keys) {
    if (!usage) return 0
    for (let i = 0; i < keys.length; i++) {
      const v = Number(usage[keys[i]])
      if (v > 0) return v
    }
    return 0
  }

  function durationMs(msg) {
    const meta = msg.stats || msg.meta || {}
    if (meta.durationMs > 0) return meta.durationMs
    if (meta.startTime && (meta.completedAt || msg.time)) return (meta.completedAt || msg.time) - meta.startTime
    return 0
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return ''
    if (ms < 1000) return String(Math.max(1, Math.round(ms))) + ' ms'
    if (ms < 10000) return (ms / 1000).toFixed(1).replace(/\.0$/, '') + ' s'
    return String(Math.round(ms / 1000)) + ' s'
  }

  function metricText(msg) {
    const parts = []
    const ms = durationMs(msg)
    if (ms) parts.push(formatDuration(ms))
    const stats = msg.stats || msg.meta || {}
    if (stats.ttftMs > 0) parts.push('TTFT ' + formatDuration(stats.ttftMs))
    const usage = usageOf(msg)
    const out = usageNumber(usage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'])
    const total = usageNumber(usage, ['total_tokens', 'totalTokens'])
    if (total) parts.push(String(total) + ' tok')
    else if (out) parts.push(String(out) + ' out')
    const speedMs = (stats.generationMs > 0 ? stats.generationMs : ms)
    if (out && speedMs) parts.push((out / Math.max(speedMs / 1000, 0.001)).toFixed(1).replace(/\.0$/, '') + ' tok/s')
    const cost = msg.stats && msg.stats.cost
    if (cost && cost.amount > 0) parts.push(formatCost(cost))
    return parts.join(' · ')
  }

  function runIdOf(msg) {
    return (msg.meta && msg.meta.runId) || (msg.stats && msg.stats.runId) || ''
  }

  function responseIdOf(msg) {
    return (msg.meta && msg.meta.responseId) || runIdOf(msg)
  }

  function isAssistantMessage(msg) {
    return (msg.role || msg.type) === 'assistant'
  }

  function responseFooterInfo(agentId, messages) {
    const responseIds = {}
    const out = {}
    const relatedAgentIds = {}
    for (let i = 0; i < messages.length; i++) {
      const responseId = responseIdOf(messages[i])
      if (responseId) responseIds[responseId] = true
    }
    Object.keys(responseIds).forEach(function (responseId) {
      const response = aiditor.ai.response && aiditor.ai.response.read
        ? aiditor.ai.response.read(agentId, responseId)
        : null
      if (!response) return
      const agentIds = response.relatedAgentIds || [agentId]
      for (let i = 0; i < agentIds.length; i++) relatedAgentIds[agentIds[i]] = true
      if (response.active || !response.lastAssistantMessageId) return
      const content = []
      for (let i = 0; i < messages.length; i++) {
        if (responseIdOf(messages[i]) !== responseId || !isAssistantMessage(messages[i])) continue
        const text = messageCopyText(messages[i]).trim()
        if (text) content.push(text)
      }
      out[response.lastAssistantMessageId] = {
        content: content,
        metrics: response.metrics || null,
      }
    })
    return { items: out, agentIds: Object.keys(relatedAgentIds).sort() }
  }

  function responseMetricText(info, fallback) {
    const metrics = info && info.metrics
    if (!metrics) return fallback || ''
    const parts = []
    if (metrics.durationMs) parts.push(formatDuration(metrics.durationMs))
    if (metrics.totalTokens) parts.push(String(metrics.totalTokens) + ' tok')
    else if (metrics.outputTokens) parts.push(String(metrics.outputTokens) + ' out')
    if (metrics.tokensPerSecond > 0) parts.push(metrics.tokensPerSecond.toFixed(1).replace(/\.0$/, '') + ' tok/s')
    if (metrics.cost && metrics.cost.amount > 0) parts.push(formatCost(metrics.cost))
    return parts.join(' · ') || fallback || ''
  }

  function formatCost(cost) {
    const n = Number(cost.amount || 0)
    if (!n) return ''
    const digits = n < 0.0001 ? 6 : (n < 0.01 ? 5 : 4)
    return '$' + n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
  }

  function textPartItems(text) {
    const source = String(text == null ? '' : text)
    const parts = source.split(/```/g)
    const out = []
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i]
      if (!chunk) continue
      if (i % 2) {
        out.push({ type: 'code', text: chunk.replace(/^\w+\n/, '') })
      } else {
        const lines = chunk.split(/\n{2,}/g)
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j].trim()
          if (!line) continue
          out.push({ type: 'text', text: line })
        }
      }
    }
    if (!out.length) out.push({ type: 'text', text: '' })
    return out
  }

  function setStableText(el, text) {
    const s = String(text == null ? '' : text)
    if (el.childNodes && el.childNodes.length === 1 && el.firstChild && el.firstChild.nodeType === 3) {
      if (el.firstChild.nodeValue !== s) el.firstChild.nodeValue = s
      return
    }
    while (el.firstChild) el.removeChild(el.firstChild)
    el.appendChild(document.createTextNode(s))
  }

  function createTextPart(item) {
    const el = item.type === 'code'
      ? ui.h('pre', 'aiditor-ai-message-code aiditor-ui-scrollarea')
      : ui.h('p', 'aiditor-ai-message-text')
    el.dataset.messagePart = item.type
    setStableText(el, item.text)
    return el
  }

  function patchTextParts(parent, text) {
    const items = textPartItems(text)
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let child = parent.children[i]
      if (!child || child.dataset.messagePart !== item.type) {
        const next = createTextPart(item)
        if (child) {
          parent.insertBefore(next, child)
          disposeTree(child)
        } else {
          parent.appendChild(next)
        }
        child = next
      } else {
        setStableText(child, item.text)
      }
    }
    while (parent.children.length > items.length) {
      disposeTree(parent.children[parent.children.length - 1])
    }
  }

  function appendTextParts(parent, text) {
    const items = textPartItems(text)
    for (let i = 0; i < items.length; i++) parent.appendChild(createTextPart(items[i]))
  }

  function appendChips(parent, className, items) {
    if (!items || !items.length) return
    const wrap = ui.h('div', className)
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const label = typeof item === 'string'
        ? item
        : (item.title || item.label || item.name || item.uri || item.id || item.refId || 'context')
      const kind = typeof item === 'string' ? 'ref' : (item.kind || item.resolver || 'ref')
      const chip = ui.h('span', 'aiditor-ai-message-chip')
      chip.appendChild(ui.h('span', 'aiditor-ai-message-chip-kind', { text: kind }))
      chip.appendChild(ui.h('span', 'aiditor-ai-message-chip-title', { text: label }))
      wrap.appendChild(chip)
    }
    parent.appendChild(wrap)
  }

  function toolCallsOf(msg) {
    return msg.toolCalls || (msg.meta && msg.meta.toolCalls) || []
  }

  function toolName(call) {
    return call.name || call.toolId || call.tool || call.id || 'tool'
  }

  function toolStatus(call) {
    return call.status || call.state || 'proposed'
  }

  function isAgentSendCall(call) {
    return (call.toolId || call.name || call.tool) === 'agent.send'
  }

  function isQuestProducingCall(call) {
    const id = call.toolId || call.name || call.tool
    return id === 'agent.send' || id === 'agent.delegate'
  }

  function questActivity(call) {
    const result = call.result || call.applyResult || {}
    if (!result || !result.questId || !result.agentId) return null
    const quest = aiditor.ai.quest && aiditor.ai.quest.read ? aiditor.ai.quest.read(result.agentId, result.questId, 'user') : null
    return {
      agentId: result.agentId,
      questId: result.questId,
      status: (quest && quest.status) || result.status || toolStatus(call),
      resultId: quest && quest.resultId,
      summary: (quest && quest.summary) || '',
      completedAt: quest && quest.completedAt,
      createdAt: quest && quest.createdAt,
    }
  }

  function renderQuestActivity(call) {
    const quest = questActivity(call)
    if (!quest) return null
    const row = ui.h('div', 'aiditor-ai-quest-activity aiditor-ai-quest-' + quest.status)
    row.appendChild(ui.h('span', 'aiditor-ai-quest-agent', { text: quest.agentId }))
    row.appendChild(ui.h('span', 'aiditor-ai-quest-status', { text: quest.status }))
    row.appendChild(ui.h('span', 'aiditor-ai-quest-id', { text: quest.questId }))
    if (quest.completedAt && quest.createdAt) row.appendChild(ui.h('span', 'aiditor-ai-quest-time', { text: formatDuration(quest.completedAt - quest.createdAt) }))
    if (quest.resultId) {
      row.appendChild(ui.button({
        text: 'View result',
        size: 'sm',
        onClick: function () {
          const message = aiditor.ai.message && aiditor.ai.message.read ? aiditor.ai.message.read(quest.agentId, quest.resultId, 'user') : null
          ui.alert({
            title: 'Quest Result',
            message: message ? displayText(message.content) : 'Result message is not readable.',
          })
        },
      }))
    }
    return row
  }

  function runtimeEventsOf(msg) {
    return msg && msg.meta && msg.meta.runtimeEvent === 'inbox.continuation'
      ? (msg.meta.events || [])
      : []
  }

  function questKey(agentId, questId) {
    return String(agentId || '') + '::' + String(questId || '')
  }

  function visibleQuestKeys(messages) {
    const keys = {}
    for (let i = 0; i < messages.length; i++) {
      if (runtimeEventsOf(messages[i]).length) continue
      const calls = toolCallsOf(messages[i])
      for (let j = 0; j < calls.length; j++) {
        if (!isQuestProducingCall(calls[j])) continue
        const result = calls[j].result || calls[j].applyResult || {}
        if (result.agentId && result.questId) keys[questKey(result.agentId, result.questId)] = true
      }
    }
    return keys
  }

  function withRuntimeEvents(msg, events) {
    const meta = Object.assign({}, msg.meta || {}, { events: events })
    return Object.assign({}, msg, { meta: meta })
  }

  function agentLabel(agentId) {
    const list = readList(aiditor.ai.agents)
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === agentId) return list[i].name || list[i].path || list[i].id
    }
    return agentId || 'runtime'
  }

  function eventState(event) {
    const type = String(event && event.type || '')
    if (type.indexOf('failed') >= 0 || type.indexOf('error') >= 0) return 'failed'
    if (type.indexOf('stopped') >= 0 || type.indexOf('cancel') >= 0) return 'stopped'
    if (type.indexOf('completed') >= 0 || type.indexOf('done') >= 0) return 'completed'
    return 'pending'
  }

  function projectedMessages(messages) {
    const out = []
    const seenQuest = visibleQuestKeys(messages)
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const events = runtimeEventsOf(msg)
      const visibleEvents = events.filter(function (event) {
        return !seenQuest[questKey(event.fromAgentId, event.questId)]
      })
      if (events.length && !visibleEvents.length) continue
      const nextMsg = events.length ? withRuntimeEvents(msg, visibleEvents) : msg
      const isEvent = visibleEvents.length > 0
      const prev = out[out.length - 1]
      if (isEvent && prev && (prev.role || prev.type) === 'assistant') {
        out[out.length - 1] = nextMsg
        out.push(prev)
      } else {
        out.push(nextMsg)
      }
    }
    return out
  }

  function renderRuntimeEvent(agent, msg) {
    const row = ui.h('div', 'aiditor-ai-message-row aiditor-ai-message-row-runtime aiditor-ai-message-row-status-' + statusOf(msg))
    const stack = ui.h('div', 'aiditor-ai-message-stack')
    const events = runtimeEventsOf(msg)
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const card = ui.h('div', 'aiditor-ai-runtime-event aiditor-ai-runtime-event-' + eventState(event))
      card.appendChild(ui.h('span', 'aiditor-ai-runtime-event-label', { text: 'event:' }))
      card.appendChild(ui.h('span', 'aiditor-ai-runtime-event-agent', { text: agentLabel(event.fromAgentId) }))
      card.appendChild(ui.h('span', 'aiditor-ai-runtime-event-summary', { text: event.summary || event.type || 'Runtime event' }))
      const btn = ui.h('button', 'aiditor-ai-runtime-event-action', { text: 'View' })
      btn.type = 'button'
      btn.addEventListener('click', function () {
        const message = event.resultMessageId && aiditor.ai.message && aiditor.ai.message.read
          ? aiditor.ai.message.read(event.fromAgentId, event.resultMessageId, 'user')
          : null
        ui.alert({
          title: 'Agent Event',
          message: 'Event\n' + displayText(event) + (message ? '\n\nResult\n' + displayText(message.content) : ''),
        })
      })
      card.appendChild(btn)
      stack.appendChild(card)
    }
    row.appendChild(stack)
    return row
  }

  function appendToolBlock(parent, title, value, className, opts) {
    if (value == null) return
    opts = opts || {}
    if ((title === 'Preview' || title === 'Applied' || title === 'Result') && !isChangeSet(value)) return
    const block = ui.h('div', 'aiditor-ai-tool-call-block ' + className)
    if (isChangeSet(value)) {
      block.appendChild(ui.changeReview({
        changeSet: value,
        allowApply: !!(opts.state && opts.state.canApply),
        allowReject: !!(opts.state && opts.state.canReject),
        onApply: function () { return afterToolAction(opts.agentId, aiditor.ai.applyToolCall(opts.agentId, opts.call.id, 'user')) },
        onReject: function () {
          const rejected = aiditor.ai.rejectToolCall(opts.agentId, opts.call.id, 'Rejected by user', 'user')
          if (aiditor.ai.resumeAgent) aiditor.ai.resumeAgent(opts.agentId, 'user')
          return rejected
        },
      }))
      parent.appendChild(block)
      return
    }
    const pre = ui.h('pre', 'aiditor-ai-tool-call-code aiditor-ui-scrollarea')
    pre.textContent = displayText(value)
    block.appendChild(pre)
    parent.appendChild(block)
  }

  function isChangeSet(value) {
    return !!(aiditor.changeSet && aiditor.changeSet.isChangeSet && aiditor.changeSet.isChangeSet(value))
  }

  function appendToolButton(parent, text, enabled, fn, kind) {
    if (!enabled) return
    parent.appendChild(ui.button({
      text: text,
      size: 'sm',
      kind: kind || 'default',
      disabled: !enabled,
      onClick: fn,
    }))
  }

  function translatedText(owner, key, vars) {
    const text = aiditor.i18n.text(key, vars)
    ui.collect(owner, text.dispose)
    return text
  }

  function performToolCallSmart(agentId, call) {
    let state = aiditor.ai.getToolCallActionState ? aiditor.ai.getToolCallActionState(agentId, call.id, 'user') : null
    if (!state) return null
    if (state.canApply) return aiditor.ai.applyToolCall(agentId, call.id, 'user')
    if (state.canPreview) {
      const preview = aiditor.ai.previewToolCall(agentId, call.id, 'user')
      if (preview && preview.promise) {
        return {
          promise: preview.promise.then(function () {
            const next = aiditor.ai.getToolCallActionState(agentId, call.id, 'user')
            const applied = next && next.canApply ? aiditor.ai.applyToolCall(agentId, call.id, 'user') : null
            return applied && applied.promise ? applied.promise : applied
          }),
        }
      }
      state = aiditor.ai.getToolCallActionState(agentId, call.id, 'user')
      if (state && state.canApply) return aiditor.ai.applyToolCall(agentId, call.id, 'user')
      return null
    }
    if (state.canApprove) {
      aiditor.ai.approveToolCall(agentId, call.id, 'user')
      state = aiditor.ai.getToolCallActionState(agentId, call.id, 'user')
    }
    return state && state.canRun ? aiditor.ai.runToolCall(agentId, call.id, 'user') : null
  }

  function rememberKey(agentId, callId) {
    return String(agentId || '') + '/' + String(callId || '')
  }

  function rememberChoice(viewState, agentId, call) {
    const key = rememberKey(agentId, call.id)
    if (viewState && viewState.rememberToolCalls[key]) return true
    return !!(aiditor.ai.isToolCallGranted && aiditor.ai.isToolCallGranted(agentId, call.id))
  }

  function clearRememberChoice(viewState, agentId, call) {
    if (viewState) delete viewState.rememberToolCalls[rememberKey(agentId, call.id)]
  }

  function rememberSuccessfulAction(agentId, call, action, remember, viewState) {
    if (!action || !remember) return action
    function done(value) {
      const found = aiditor.ai.findToolCall && aiditor.ai.findToolCall(agentId, call.id)
      const status = found && found.toolCall && found.toolCall.status
      if (status === 'applied' || status === 'completed') {
        if (aiditor.ai.setToolCallGranted) aiditor.ai.setToolCallGranted(agentId, call.id, true)
        clearRememberChoice(viewState, agentId, call)
      }
      return value
    }
    if (action.promise) return Object.assign({}, action, { promise: Promise.resolve(action.promise).then(done) })
    done(action)
    return action
  }

  function applyToolCallSmart(agentId, call, viewState) {
    const action = performToolCallSmart(agentId, call)
    return afterToolAction(agentId, rememberSuccessfulAction(agentId, call, action, rememberChoice(viewState, agentId, call), viewState))
  }

  function afterToolAction(agentId, action) {
    if (!action) return action
    function done() {
      if (aiditor.ai.flushToolResults) aiditor.ai.flushToolResults(agentId)
      if (aiditor.ai.resumeAgent) aiditor.ai.resumeAgent(agentId, 'user')
    }
    if (action.promise) {
      action.promise.then(done)
      return action
    }
    done()
    return action
  }

  function renderToolActions(card, agentId, call, viewState) {
    if (!call.approvalPhase) return
    const state = aiditor.ai.getToolCallActionState
      ? aiditor.ai.getToolCallActionState(agentId, call.id, 'user')
      : null
    const actions = ui.h('div', 'aiditor-ai-tool-call-actions')
    const hasForwardAction = state && (state.canPreview || state.canApply || state.canApprove || state.canRun)
    if (hasForwardAction) {
      const rememberLabel = translatedText(actions, 'ai.tool.remember')
      const rememberHint = translatedText(actions, 'ai.tool.remember_hint')
      const remember = ui['switch']({
        value: rememberChoice(viewState, agentId, call),
        label: rememberLabel,
        onChange: function (value) {
          const key = rememberKey(agentId, call.id)
          if (value) viewState.rememberToolCalls[key] = true
          else {
            delete viewState.rememberToolCalls[key]
            if (aiditor.ai.setToolCallGranted) aiditor.ai.setToolCallGranted(agentId, call.id, false)
          }
        },
      })
      ui.tooltip(remember, {
        text: rememberHint,
        side: 'top',
        delay: 250,
      })
      actions.appendChild(remember)
    }
    appendToolButton(actions, translatedText(actions, 'ai.tool.reject'), state && state.canReject, function () {
      clearRememberChoice(viewState, agentId, call)
      aiditor.ai.rejectToolCall(agentId, call.id, 'Rejected by user', 'user')
      if (aiditor.ai.resumeAgent) aiditor.ai.resumeAgent(agentId, 'user')
    }, 'danger')
    appendToolButton(actions, translatedText(actions, 'ai.tool.apply'), state && (state.canApply || state.canPreview || state.canApprove || state.canRun), function () {
      applyToolCallSmart(agentId, call, viewState)
    }, 'primary')
    if (actions.firstChild) card.appendChild(actions)

    if (state && (!state.callAllowed || (state.hasApply && !state.applyAllowed))) {
      card.appendChild(ui.h('div', 'aiditor-ai-tool-call-permission', {
        text: !state.callAllowed
          ? 'Tool call permission is not granted for this agent.'
          : 'Tool apply permission is not granted for this agent.',
      }))
    }
  }

  function runStateKey(agentId, messageId, callId) {
    return String(agentId || '') + '/' + String(messageId || '') + '/' + String(callId || '')
  }

  function renderToolCall(agentId, messageId, call, viewState) {
    const status = toolStatus(call)
    const card = ui.h('details', 'aiditor-ai-tool-call aiditor-ai-tool-call-' + status)
    const key = runStateKey(agentId, messageId, call.id)
    if (viewState && viewState.expandedToolCalls[key]) card.open = true
    card.addEventListener('toggle', function () {
      if (!viewState) return
      if (card.open) viewState.expandedToolCalls[key] = true
      else delete viewState.expandedToolCalls[key]
    })
    const head = ui.h('summary', 'aiditor-ai-tool-call-head')
    const right = ui.h('div', 'aiditor-ai-tool-call-head-right')
    right.addEventListener('click', function (ev) { ev.stopPropagation() })
    head.appendChild(ui.h('span', 'aiditor-ai-tool-call-name', { text: toolName(call) }))
    if (status !== 'previewed') right.appendChild(ui.h('span', 'aiditor-ai-tool-call-status', { text: status }))
    const args = call.args && Object.keys(call.args).length ? compactArgs(call.args) : ''
    if (args) head.appendChild(ui.h('span', 'aiditor-ai-tool-call-summary', { text: args }))

    const state = aiditor.ai.getToolCallActionState
      ? aiditor.ai.getToolCallActionState(agentId, call.id, 'user')
      : null
    renderToolActions(right, agentId, call, viewState)
    head.appendChild(right)
    card.appendChild(head)
    if (call.description || call.title) {
      card.appendChild(ui.h('div', 'aiditor-ai-tool-call-desc', { text: call.description || call.title }))
    }
    const opts = { agentId: agentId, call: call, state: state }
    appendToolBlock(card, 'Args', call.args, 'aiditor-ai-tool-call-args', opts)
    if (isQuestProducingCall(call)) {
      const quest = renderQuestActivity(call)
      if (quest) card.appendChild(quest)
    }
    appendToolBlock(card, 'Preview', call.preview, 'aiditor-ai-tool-call-preview', opts)
    appendToolBlock(card, 'Result', call.result, 'aiditor-ai-tool-call-result', opts)
    appendToolBlock(card, 'Applied', call.applyResult, 'aiditor-ai-tool-call-apply-result', opts)
    appendToolBlock(card, 'Error', call.error, 'aiditor-ai-tool-call-error', opts)
    return card
  }

  function compactArgs(args) {
    const keys = Object.keys(args || {})
    if (!keys.length) return ''
    const shown = keys.slice(0, 3).map(function (key) {
      const value = args[key]
      if (value == null) return key + ': null'
      if (typeof value === 'string') return key + ': ' + (value.length > 28 ? value.slice(0, 25) + '...' : value)
      if (typeof value === 'number' || typeof value === 'boolean') return key + ': ' + String(value)
      return key + ': ' + (Array.isArray(value) ? '[' + value.length + ']' : '{...}')
    })
    if (keys.length > shown.length) shown.push('+' + String(keys.length - shown.length))
    return shown.join(' · ')
  }

  function actionableToolCalls(agentId, calls) {
    return (calls || []).filter(function (call) {
      if (!call.approvalPhase) return false
      const state = aiditor.ai.getToolCallActionState
        ? aiditor.ai.getToolCallActionState(agentId, call.id, 'user')
        : null
      return !!(state && (state.canApply || state.canPreview || state.canApprove || state.canRun))
    })
  }

  function applyToolCallBatch(agentId, calls, viewState) {
    let chain = Promise.resolve()
    for (let i = 0; i < calls.length; i++) {
      chain = chain.then(function () {
        const call = calls[i]
        const action = performToolCallSmart(agentId, call)
        const remembered = rememberSuccessfulAction(agentId, call, action, rememberChoice(viewState, agentId, call), viewState)
        return remembered && remembered.promise ? remembered.promise : remembered
      })
    }
    return afterToolAction(agentId, { promise: chain })
  }

  function rejectToolCallBatch(agentId, calls, viewState) {
    for (let i = 0; i < calls.length; i++) {
      const state = aiditor.ai.getToolCallActionState
        ? aiditor.ai.getToolCallActionState(agentId, calls[i].id, 'user')
        : null
      if (!state || !state.canReject) continue
      clearRememberChoice(viewState, agentId, calls[i])
      aiditor.ai.rejectToolCall(agentId, calls[i].id, 'Rejected by user', 'user')
    }
    return afterToolAction(agentId, {})
  }

  function renderToolBatchActions(parent, agentId, calls, viewState) {
    const actionable = actionableToolCalls(agentId, calls)
    if (actionable.length < 2) return
    const row = ui.h('div', 'aiditor-ai-tool-batch-actions')
    const countText = translatedText(row, 'ai.tool.pending_actions', { count: actionable.length })
    const count = ui.h('span', 'aiditor-ai-tool-batch-count')
    ui.bindText(count, countText)
    row.appendChild(count)
    const reject = ui.button({
      text: translatedText(row, 'ai.tool.reject_all'),
      size: 'sm',
      kind: 'danger',
      onClick: function () { rejectToolCallBatch(agentId, actionable, viewState) },
    })
    const apply = ui.button({
      text: translatedText(row, 'ai.tool.apply_all'),
      size: 'sm',
      kind: 'primary',
      onClick: function () { applyToolCallBatch(agentId, actionable, viewState) },
    })
    const applyHint = translatedText(row, 'ai.tool.apply_all_hint')
    ui.tooltip(apply, {
      text: applyHint,
      side: 'top',
      delay: 250,
    })
    row.appendChild(reject)
    row.appendChild(apply)
    parent.appendChild(row)
  }

  function renderToolCalls(parent, agentId, messageId, calls, viewState) {
    if (!calls || !calls.length) return
    const wrap = ui.h('div', 'aiditor-ai-tool-calls')
    renderToolBatchActions(wrap, agentId, calls, viewState)
    for (let i = 0; i < calls.length; i++) wrap.appendChild(renderToolCall(agentId, messageId, calls[i], viewState))
    parent.appendChild(wrap)
  }

  function disclosureStateFor(viewState, agentId) {
    if (!viewState.disclosureStates[agentId]) viewState.disclosureStates[agentId] = {}
    return viewState.disclosureStates[agentId]
  }

  function renderPayload(msg, viewState, agentId) {
    const wrap = ui.h('div', 'aiditor-ai-message-content')
    wrap.dataset.messagePayload = 'parts'
    if (aiditor.ai.messageRenderers && aiditor.ai.messageRenderers.renderParts) {
      aiditor.ai.messageRenderers.renderParts(wrap, msg, {
        source: 'transcript',
        message: msg,
        disclosureState: disclosureStateFor(viewState, agentId),
        options: { includeToolCalls: false, includeRelated: true, includeError: true },
      })
    } else {
      appendTextParts(wrap, displayText(msg.content != null ? msg.content : msg.text))
    }
    return wrap
  }

  function patchPayload(body, msg, viewState, agentId) {
    const current = body.querySelector('[data-message-payload]')
    if (current) {
      if (aiditor.ai.messageRenderers && aiditor.ai.messageRenderers.patchParts) {
        aiditor.ai.messageRenderers.patchParts(current, msg, {
          source: 'transcript',
          message: msg,
          disclosureState: disclosureStateFor(viewState, agentId),
          options: { includeToolCalls: false, includeRelated: true, includeError: true },
        })
        return
      }
      patchTextParts(current, displayText(msg.content != null ? msg.content : msg.text))
      return
    }
    body.insertBefore(renderPayload(msg, viewState, agentId), body.firstChild || null)
  }

  function renderEmpty(item) {
    const row = ui.h('div', 'aiditor-ai-empty-state')
    row.appendChild(ui.h('div', 'aiditor-ai-empty-title', { text: item.title }))
    row.appendChild(ui.h('div', 'aiditor-ai-empty-body', { text: item.content }))
    return row
  }

  function messageRowClass(role, status) {
    return 'aiditor-ai-message-row aiditor-ai-message-row-' + role + ' aiditor-ai-message-row-status-' + status
  }

  function renderMessageFooter(msg, responseFooters) {
    const role = msg.role || msg.type || 'message'
    const responseId = responseIdOf(msg)
    const responseFooter = responseId && responseFooters ? responseFooters[msg.id] : null
    if (responseId && isAssistantMessage(msg) && !responseFooter) return null

    const copyText = responseFooter && responseFooter.content.length ? responseFooter.content.join('\n\n') : messageCopyText(msg)
    const footer = ui.h('div', 'aiditor-ai-message-footer')
    footer.appendChild(ui.copyButton({ text: copyText, title: responseFooter ? 'Copy response' : 'Copy message', size: 'sm' }))
    const calls = toolCallsOf(msg)
    const callCount = responseFooter && responseFooter.metrics ? responseFooter.metrics.toolCallCount : calls.length
    if (callCount) footer.appendChild(ui.h('span', 'aiditor-ai-message-metrics', { text: callCount + ' tool call' + (callCount === 1 ? '' : 's') }))
    if (role !== 'user') {
      const metrics = responseFooter ? responseMetricText(responseFooter, metricText(msg)) : metricText(msg)
      if (metrics) footer.appendChild(ui.h('span', 'aiditor-ai-message-metrics', { text: metrics }))
    }
    return footer
  }

  function patchError(body, msg) {
    const existing = body.querySelector('.aiditor-ai-message-error')
    const text = statusOf(msg) === 'error' && msg.meta && msg.meta.error ? msg.meta.error : ''
    if (!text) {
      if (existing) disposeTree(existing)
      return
    }
    if (existing) setStableText(existing, text)
    else body.appendChild(ui.h('div', 'aiditor-ai-message-error', { text: text }))
  }

  function patchToolCalls(body, agentId, messageId, calls, viewState) {
    const existing = body.querySelector('.aiditor-ai-tool-calls')
    if (existing) disposeTree(existing)
    renderToolCalls(body, agentId, messageId, calls, viewState)
  }

  function patchChips(card, className, items) {
    const existing = card.querySelector('.' + className)
    if (existing) disposeTree(existing)
    appendChips(card, className, items)
  }

  function patchFooter(stack, msg, responseFooters) {
    const existing = stack.querySelector('.aiditor-ai-message-footer')
    const next = renderMessageFooter(msg, responseFooters)
    if (!next) {
      if (existing) disposeTree(existing)
      return
    }
    if (existing) stack.replaceChild(next, existing)
    else stack.appendChild(next)
  }

  function patchMessageRow(entry, agent, msg, responseFooters, viewState, listVersion, version, footerVersion) {
    if (!entry || entry.patchable === false || msg.empty || runtimeEventsOf(msg).length) return false
    const row = entry.el
    const stack = row.querySelector('.aiditor-ai-message-stack')
    const card = row.querySelector('.aiditor-ai-message')
    const body = row.querySelector('.aiditor-ai-message-body')
    if (!stack || !card || !body) return false
    const role = msg.role || msg.type || 'message'
    const status = statusOf(msg)
    row.className = messageRowClass(role, status)
    patchPayload(body, msg, viewState, agent.id)
    patchToolCalls(body, agent.id, msg.id, toolCallsOf(msg), viewState)
    patchFooter(stack, msg, responseFooters)
    entry.version = version
    entry.listVersion = listVersion
    entry.footerVersion = footerVersion
    return true
  }

  function renderMessage(agent, msg, responseFooters, viewState) {
    if (msg.empty) return renderEmpty(msg)
    if (runtimeEventsOf(msg).length) return renderRuntimeEvent(agent, msg)

    const role = msg.role || msg.type || 'message'
    const status = statusOf(msg)
    const row = ui.h('div', messageRowClass(role, status))
    const stack = ui.h('div', 'aiditor-ai-message-stack')
    const card = ui.h('div', 'aiditor-ai-message')

    const body = ui.h('div', 'aiditor-ai-message-body')
    body.appendChild(renderPayload(msg, viewState, agent.id))
    renderToolCalls(body, agent.id, msg.id, toolCallsOf(msg), viewState)
    card.appendChild(body)
    stack.appendChild(card)

    const footer = renderMessageFooter(msg, responseFooters)
    if (footer) stack.appendChild(footer)
    row.appendChild(stack)
    return row
  }

  function clearChildren(el) {
    while (el.firstChild) {
      const child = el.firstChild
      if (child.remove) child.remove()
      else el.removeChild(child)
    }
  }

  function setSpacerHeight(el, height) {
    el.style.height = Math.max(0, Math.round(height)) + 'px'
  }

  function containsNode(root, node) {
    return !!(root && node && (node === root || root.contains(node.nodeType === 3 ? node.parentNode : node)))
  }

  function hasTextSelectionInside(root) {
    if (!window.getSelection) return false
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false
    return containsNode(root, sel.anchorNode) || containsNode(root, sel.focusNode)
  }

  function factory(propsSig, ctx) {
    const root = ui.h('div', 'aiditor-ai-panel aiditor-ai-transcript')

    const scroll = ui.view({ children: [], scroll: 'both', className: 'aiditor-ai-message-scroll' })
    root.appendChild(scroll)
    const topSpacer = ui.h('div', 'aiditor-ai-message-virtual-spacer')
    const windowEl = ui.h('div', 'aiditor-ai-message-window')
    const bottomSpacer = ui.h('div', 'aiditor-ai-message-virtual-spacer')
    const liveStrip = aiditor.ai.createMessageLiveStrip()
    scroll.appendChild(topSpacer)
    scroll.appendChild(windowEl)
    scroll.appendChild(bottomSpacer)
    scroll.appendChild(liveStrip.el)

    const viewState = { expandedToolCalls: {}, disclosureStates: {}, rememberToolCalls: {} }
    const rows = {}
    const virtualizer = aiditor.ai.createMessageVirtualizer({ estimateHeight: 96, overscanPx: 640 })
    const visibleRevision = aiditor.signal(0)
    let cacheAgentId = null
    let cacheListVersion = -1
    let cacheMessages = []
    let cacheResponseFooters = {}
    let cacheResponseAgentIds = []
    let cacheGraphVersion = ''
    let cacheFooterVersion = 0
    let emptyEl = null
    let stickToBottom = true
    let selectingTranscript = false
    let selectionWasInside = false
    let selectionTimer = null
    function selectionActive() {
      return selectingTranscript || hasTextSelectionInside(root)
    }
    function releaseSelectionDrag() {
      if (selectionTimer) clearTimeout(selectionTimer)
      selectionTimer = setTimeout(function () {
        selectionTimer = null
        selectingTranscript = false
        if (!hasTextSelectionInside(root)) scheduleRender()
      }, 160)
    }
    function onSelectionChange() {
      const inside = hasTextSelectionInside(root)
      if (inside) {
        selectionWasInside = true
        stickToBottom = false
        return
      }
      if (selectionWasInside && !selectingTranscript) scheduleRender()
      selectionWasInside = false
    }
    scroll.addEventListener('scroll', function () {
      stickToBottom = selectionActive() ? false : scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 32
      visibleRevision.set(visibleRevision.peek() + 1)
    }, { passive: true })
    scroll.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return
      const target = ev.target
      if (target && target.closest && target.closest('.aiditor-ai-message-row')) {
        selectingTranscript = true
        stickToBottom = false
      }
    }, true)
    if (window.addEventListener) {
      window.addEventListener('pointerup', releaseSelectionDrag)
      window.addEventListener('pointercancel', releaseSelectionDrag)
      window.addEventListener('blur', releaseSelectionDrag)
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('selectionchange', onSelectionChange)
    }

    function disposeRows() {
      Object.keys(rows).forEach(function (id) {
        disposeTree(rows[id].el)
        delete rows[id]
      })
      clearChildren(windowEl)
      emptyEl = null
    }

    function removeEmpty() {
      if (!emptyEl) return
      if (emptyEl.remove) emptyEl.remove()
      else if (emptyEl.parentNode) emptyEl.parentNode.removeChild(emptyEl)
      emptyEl = null
    }

    function showEmpty(item) {
      disposeRows()
      setSpacerHeight(topSpacer, 0)
      setSpacerHeight(bottomSpacer, 0)
      const next = renderEmpty(item)
      windowEl.appendChild(next)
      emptyEl = next
    }

    function sourceMessagesForAgent(agentId) {
      const ids = aiditor.ai.agentMessageIds ? aiditor.ai.agentMessageIds(agentId) : []
      const out = []
      if (ids.length) {
        for (let i = 0; i < ids.length; i++) {
          const msg = aiditor.ai.readMessage(agentId, ids[i])
          if (msg && (msg.role || msg.type) !== 'tool') out.push(msg)
        }
        return out
      }
      const agent = activeAgent()
      return agent ? (agent.messages || agent.transcript || agent.history || []).filter(function (msg) {
        return (msg.role || msg.type) !== 'tool'
      }) : []
    }

    function messagesForAgent(source) {
      return projectedMessages(source.filter(function (msg) { return !isHiddenRuntimeMessage(msg) }))
    }

    function graphVersion(agentIds) {
      if (!aiditor.ai.agentVersion) return ''
      return agentIds.map(function (id) { return id + ':' + aiditor.ai.agentVersion(id) }).join('|')
    }

    function ensureCache(agentId) {
      const version = aiditor.ai.messageListVersion ? aiditor.ai.messageListVersion(agentId) : 0
      const nextGraphVersion = graphVersion(cacheResponseAgentIds)
      if (cacheAgentId === agentId && cacheListVersion === version && cacheGraphVersion === nextGraphVersion) return
      cacheAgentId = agentId
      cacheListVersion = version
      const source = sourceMessagesForAgent(agentId)
      cacheMessages = messagesForAgent(source)
      const footerInfo = responseFooterInfo(agentId, source)
      cacheResponseFooters = footerInfo.items
      cacheResponseAgentIds = footerInfo.agentIds
      cacheGraphVersion = graphVersion(cacheResponseAgentIds)
      cacheFooterVersion++
      virtualizer.setMessages(cacheMessages)
    }

    function rangeForViewport() {
      return virtualizer.range(scroll.scrollTop || 0, scroll.clientHeight || 480)
    }

    function visibleMessage(agentId, msg) {
      if (aiditor.ai.messageVersion) aiditor.ai.messageVersion(agentId, msg.id)
      return aiditor.ai.readMessage(agentId, msg.id) || msg
    }

    function updateRow(agent, msg) {
      const id = msg.id
      const version = aiditor.ai.messageVersion ? aiditor.ai.messageVersion(agent.id, id) : 0
      const entry = rows[id]
      if (entry && entry.version === version && entry.listVersion === cacheListVersion && entry.footerVersion === cacheFooterVersion) return entry.el
      if (entry && patchMessageRow(entry, agent, msg, cacheResponseFooters, viewState, cacheListVersion, version, cacheFooterVersion)) return entry.el
      const next = renderMessage(agent, msg, cacheResponseFooters, viewState)
      if (entry) {
        if (entry.el.parentNode && entry.el.parentNode.replaceChild) entry.el.parentNode.replaceChild(next, entry.el)
        else {
          if (entry.el.remove) entry.el.remove()
          windowEl.appendChild(next)
        }
        disposeTree(entry.el)
      }
      rows[id] = { el: next, version: version, listVersion: cacheListVersion, footerVersion: cacheFooterVersion, patchable: !msg.empty && !runtimeEventsOf(msg).length }
      return next
    }

    function measureRows() {
      let changed = false
      Object.keys(rows).forEach(function (id) {
        const el = rows[id].el
        const height = el && (el.offsetHeight || (el.getBoundingClientRect && el.getBoundingClientRect().height)) || 0
        if (virtualizer.setRowHeight(id, height)) changed = true
      })
      return changed
    }

    function placeRows(agentId, range) {
      const agent = { id: agentId }
      const wanted = {}
      const nodes = []
      for (let i = range.start; i < range.end; i++) {
        const msg = visibleMessage(agentId, cacheMessages[i])
        wanted[msg.id] = true
        nodes.push(updateRow(agent, msg))
      }
      Object.keys(rows).forEach(function (id) {
        if (wanted[id]) return
        disposeTree(rows[id].el)
        delete rows[id]
      })
      for (let j = 0; j < nodes.length; j++) {
        const at = windowEl.children && windowEl.children[j] || null
        if (at === nodes[j]) continue
        if (windowEl.insertBefore) windowEl.insertBefore(nodes[j], at)
        else if (nodes[j].parentNode !== windowEl) windowEl.appendChild(nodes[j])
      }
    }

    let renderTimer = null
    let renderQueued = false

    function scheduleRender() {
      renderQueued = true
      if (renderTimer) return
      renderTimer = setTimeout(function () {
        renderTimer = null
        if (!renderQueued) return
        renderQueued = false
        render()
      }, 100)
    }

    function render() {
      const shouldStick = stickToBottom || scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 32
      const agentId = read(aiditor.ai.activeAgentId)
      if (!agentId) {
        showEmpty({ title: 'No active agent', content: 'Select an agent to inspect its transcript.' })
        return
      }
      ensureCache(agentId)
      if (!cacheMessages.length) {
        showEmpty({ title: 'No messages yet', content: 'Send a message from AI Chat to start this transcript.' })
        return
      }
      removeEmpty()
      const range = rangeForViewport()
      setSpacerHeight(topSpacer, range.before)
      setSpacerHeight(bottomSpacer, range.after)
      placeRows(agentId, range)
      requestAnimationFrame(function () {
        if (measureRows()) visibleRevision.set(visibleRevision.peek() + 1)
        if (shouldStick && !selectionActive()) scroll.scrollTop = scroll.scrollHeight
      })
    }

    ui.collect(root, function () {
      if (renderTimer) clearTimeout(renderTimer)
      if (selectionTimer) clearTimeout(selectionTimer)
      renderTimer = null
      selectionTimer = null
      disposeRows()
    })
    ui.collect(root, function () {
      if (window.removeEventListener) {
        window.removeEventListener('pointerup', releaseSelectionDrag)
        window.removeEventListener('pointercancel', releaseSelectionDrag)
        window.removeEventListener('blur', releaseSelectionDrag)
      }
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('selectionchange', onSelectionChange)
      }
    })
    const liveTimer = setInterval(function () { liveStrip.tick() }, 1000)
    if (liveTimer && liveTimer.unref) liveTimer.unref()
    ui.collect(root, function () { clearInterval(liveTimer) })
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () { visibleRevision.set(visibleRevision.peek() + 1) })
      ro.observe(scroll)
      ui.collect(root, function () { ro.disconnect() })
    }
    render()
    ui.collect(root, aiditor.effect(function () {
      const agentId = read(aiditor.ai.activeAgentId)
      visibleRevision()
      if (agentId) {
        ensureCache(agentId)
        const range = rangeForViewport()
        for (let i = range.start; i < range.end; i++) {
          if (cacheMessages[i] && aiditor.ai.messageVersion) aiditor.ai.messageVersion(agentId, cacheMessages[i].id)
        }
      }
      scheduleRender()
    }))
    ui.collect(root, aiditor.effect(function () {
      const agentId = read(aiditor.ai.activeAgentId)
      if (aiditor.ai.agents) aiditor.ai.agents()
      let state = agentId && aiditor.ai.activeRunState ? aiditor.ai.activeRunState(agentId) : null
      const response = agentId && aiditor.ai.response ? aiditor.ai.response.read(agentId) : null
      if (response && response.active) {
        const waiting = response.status === 'waiting'
        const metrics = response.metrics || {}
        if (!state || state.state === 'idle') state = {
          agentId: agentId,
          state: waiting ? 'waiting' : 'connecting',
          activityText: waiting
            ? (response.pendingQuestCount === 1
              ? 'waiting for 1 delegated task'
              : 'waiting for ' + response.pendingQuestCount + ' delegated tasks')
            : 'continuing response',
          previewTail: '',
          modelTail: '',
        }
        state = Object.assign({}, state, {
          responseMetrics: true,
          startedAt: metrics.startedAt || response.startedAt || state.startedAt,
          completedAt: null,
          generationMs: metrics.generationMs || 0,
          promptTokens: metrics.promptTokens || 0,
          outputTokens: metrics.outputTokens || 0,
          totalTokens: metrics.totalTokens || 0,
          cost: metrics.cost || null,
          turn: null,
          firstTokenAt: null,
          usage: null,
        })
      }
      liveStrip.update(state)
    }))
    return root
  }

  aiditor.registerComponent('ai-messages', {
    category: 'panel',
    label: 'AI Messages',
    icon: 'message-circle',
    defaults: function () { return { title: 'AI Messages', icon: 'message-circle', props: {} } },
    factory: factory,
    dispose: disposeTree,
  })
})(window.aiditor = window.aiditor || {})

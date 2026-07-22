// aiditor.ai provider adapters.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function messageText(content) {
    if (content && typeof content === 'object' && content.type === 'rich-prompt') {
      return content.renderedText || (ai.richPrompt && ai.richPrompt.toModelText ? ai.richPrompt.toModelText(content) : '')
    }
    if (Array.isArray(content)) {
      return content.map(function (item) { return typeof item === 'string' ? item : (item.text || item.content || '') }).join('')
    }
    return content == null ? '' : String(content)
  }

  function dataUrlInfo(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.*)$/)
    return match ? { mediaType: match[1], base64: match[2], url: dataUrl } : null
  }

  function imageAttachments(request) {
    const refs = request.attachmentRefs || []
    const resolved = request.attachments || request.resolvedAttachments || []
    const out = []
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i] || {}
      const payload = resolved[i] || {}
      const dataUrl = (payload && payload.dataUrl) || (ref.meta && ref.meta.dataUrl)
      const info = dataUrlInfo(dataUrl)
      if (info && ((ref.kind || payload.kind) === 'file.image' || String(info.mediaType).indexOf('image/') === 0)) {
        out.push({
          title: ref.title || ref.uri || 'image',
          mediaType: info.mediaType,
          base64: info.base64,
          url: info.url,
        })
      }
    }
    return out
  }

  function toolNameBase(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '__').slice(0, 64)
  }

  function hashText(text) {
    let hash = 2166136261
    const value = String(text || '')
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
  }

  function toolAliasMap(request) {
    const specs = request && request.toolSpecs || []
    const byId = {}
    const byName = {}
    for (let i = 0; i < specs.length; i++) {
      const id = String(specs[i].id || '')
      let name = toolNameBase(id)
      if (!name) throw new Error('Tool id cannot produce a provider alias')
      if (byName[name] && byName[name] !== id) {
        const suffix = '__' + hashText(id)
        name = name.slice(0, 64 - suffix.length) + suffix
      }
      if (byName[name] && byName[name] !== id) throw new Error('Provider tool alias collision: ' + id + ' and ' + byName[name])
      byId[id] = name
      byName[name] = id
    }
    return { byId: byId, byName: byName }
  }

  function toolName(id, request) {
    const map = toolAliasMap(request || {})
    return map.byId[id] || toolNameBase(id)
  }

  function toolIdFromName(name, request) {
    const map = toolAliasMap(request || {})
    return map.byName[name] || name
  }

  function toolDescription(tool) {
    const description = tool.description || tool.title || ''
    return 'Public tool id: ' + tool.id + (description ? '. ' + description : '')
  }

  function openAiTools(request) {
    const specs = request.toolSpecs || []
    return specs.map(function (tool) {
      return {
        type: 'function',
        function: {
          name: toolName(tool.id, request),
          description: toolDescription(tool),
          parameters: ai.normalizeToolSchema(tool.schema),
        },
      }
    })
  }

  function hasOwn(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key)
  }

  function decodeToolArguments(value) {
    if (value === undefined || value === '') return {}
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch (cause) {
      const err = new Error('Provider returned invalid JSON tool arguments')
      err.code = 'TOOL_ARGUMENTS_INVALID_JSON'
      err.cause = cause
      throw err
    }
  }

  function toolCallArgs(call) {
    const fn = call && call.function || null
    if (hasOwn(call, 'args')) return call.args === undefined ? {} : call.args
    if (hasOwn(fn, 'arguments')) return decodeToolArguments(fn.arguments)
    if (hasOwn(call, 'arguments')) return decodeToolArguments(call.arguments)
    return {}
  }

  function mergeArgumentDelta(current, delta) {
    if (typeof delta === 'string') return (typeof current === 'string' ? current : '') + delta
    return delta
  }

  function mergeToolCallDeltas(existing, deltas) {
    const out = (existing || []).slice()
    for (let i = 0; i < (deltas || []).length; i++) {
      const delta = deltas[i] || {}
      const index = delta.index != null ? delta.index : findToolCallIndex(out, delta)
      const at = index >= 0 ? index : out.length
      const next = Object.assign({}, out[at] || {})
      if (delta.id) next.id = delta.id
      if (delta.type) next.type = delta.type
      if (delta.toolId) next.toolId = delta.toolId
      if (delta.name) next.name = delta.name
      if (hasOwn(delta, 'args')) next.args = delta.args
      if (hasOwn(delta, 'arguments')) next.arguments = mergeArgumentDelta(next.arguments, delta.arguments)
      if (delta.function) {
        const fn = Object.assign({}, next.function || {})
        if (delta.function.name) fn.name = delta.function.name
        if (hasOwn(delta.function, 'arguments')) fn.arguments = mergeArgumentDelta(fn.arguments, delta.function.arguments)
        next.function = fn
      }
      out[at] = next
    }
    return out
  }

  function findToolCallIndex(calls, delta) {
    if (delta.id) {
      for (let i = 0; i < calls.length; i++) if (calls[i].id === delta.id) return i
    }
    return -1
  }

  function normalizeOpenAiToolCalls(calls, request) {
    return (calls || []).map(function (call) {
      const fn = call.function || {}
      const providerName = fn.name || call.providerName || call.name || call.toolId || call.id
      const id = toolIdFromName(providerName, request)
      return {
        id: call.id || null,
        toolId: id,
        name: id,
        providerName: providerName,
        args: toolCallArgs(call),
      }
    })
  }

  function toolCallId(call) {
    return call && (call.providerCallId || call.id)
  }

  function toolResponseId(message) {
    return message && (message.toolCallId || (message.meta && message.meta.toolCallId) || message.id)
  }

  function normalizeToolMessageOrder(messages) {
    const toolMessages = {}
    const body = []
    for (let i = 0; i < (messages || []).length; i++) {
      const message = messages[i]
      if (message && message.role === 'tool') {
        const id = toolResponseId(message)
        if (id && !toolMessages[id]) toolMessages[id] = message
      } else {
        body.push(message)
      }
    }
    const out = []
    for (let i = 0; i < body.length; i++) {
      const message = body[i]
      const calls = message && message.toolCalls || []
      if (!calls.length) {
        out.push(message)
        continue
      }
      const complete = []
      for (let j = 0; j < calls.length; j++) {
        const id = toolCallId(calls[j])
        if (id && toolMessages[id]) complete.push(calls[j])
      }
      out.push(complete.length === calls.length
        ? message
        : Object.assign({}, message, { toolCalls: complete }))
      for (let j = 0; j < complete.length; j++) out.push(toolMessages[toolCallId(complete[j])])
    }
    return out
  }

  function openAiMessages(messages, request) {
    const normalized = normalizeToolMessageOrder(messages || [])
    const outMessages = normalized.map(function (m) {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId || (m.meta && m.meta.toolCallId) || m.id,
          content: messageText(m.content),
        }
      }
      const out = { role: m.role || 'user', content: messageText(m.content) }
      const reasoning = m.reasoning_content != null ? m.reasoning_content : m.reasoningContent
      if ((m.role || 'user') === 'assistant' && reasoning && isDeepSeekRequest(request)) out.reasoning_content = reasoning
      const calls = m.toolCalls || []
      if (calls.length) {
        out.tool_calls = calls.map(function (call) {
          return {
            id: call.providerCallId || call.id,
            type: 'function',
            function: {
              name: call.providerName || toolName(call.toolId || call.name, request),
              arguments: ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(toolCallArgs(call)) : JSON.stringify(toolCallArgs(call)),
            },
          }
        })
      }
      return out
    })
    const images = imageAttachments(request || {})
    if (!images.length) return outMessages
    for (let i = outMessages.length - 1; i >= 0; i--) {
      if (outMessages[i].role !== 'user') continue
      const text = messageText(outMessages[i].content)
      const content = []
      if (text) content.push({ type: 'text', text: text })
      for (let j = 0; j < images.length; j++) {
        content.push({ type: 'image_url', image_url: { url: images[j].url } })
      }
      outMessages[i] = Object.assign({}, outMessages[i], { content: content })
      return outMessages
    }
    return outMessages
  }

  function isDeepSeekRequest(request) {
    return String((request && (request.connectionName || request.connection || request.provider)) || '').toLowerCase() === 'deepseek'
      || String(request && request.model || '').toLowerCase().indexOf('deepseek') >= 0
  }

  function anthropicPayloadMessages(messages, request) {
    const out = []
    const images = imageAttachments(request || {})
    let imagesAttached = false
    for (let i = 0; i < (messages || []).length; i++) {
      const m = messages[i]
      if (m.role === 'system') continue
      if (m.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: toolResponseId(m),
          content: messageText(m.content),
        }
        const previous = out[out.length - 1]
        if (previous && previous.role === 'user' && Array.isArray(previous.content) && previous.content.length && previous.content[0].type === 'tool_result') {
          previous.content.push(block)
        } else {
          out.push({ role: 'user', content: [block] })
        }
        continue
      }
      const role = m.role === 'assistant' ? 'assistant' : 'user'
      let content = messageText(m.content)
      const calls = m.toolCalls || []
      if (role === 'assistant' && calls.length) {
        const blocks = []
        if (content) blocks.push({ type: 'text', text: content })
        for (let j = 0; j < calls.length; j++) {
          const call = calls[j]
          blocks.push({
            type: 'tool_use',
            id: toolCallId(call),
            name: call.providerName || toolName(call.toolId || call.name, request),
            input: toolCallArgs(call),
          })
        }
        out.push({ role: role, content: blocks })
        continue
      }
      if (role === 'user' && images.length && !imagesAttached) {
        const blocks = []
        if (content) blocks.push({ type: 'text', text: content })
        for (let j = 0; j < images.length; j++) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: images[j].mediaType,
              data: images[j].base64,
            },
          })
        }
        out.push({ role: role, content: blocks })
        imagesAttached = true
        continue
      }
      out.push({
        role: role,
        content: content,
      })
    }
    return out
  }

  function anthropicTools(request) {
    const specs = request.toolSpecs || []
    return specs.map(function (tool) {
      return {
        name: toolName(tool.id, request),
        description: toolDescription(tool),
        input_schema: ai.normalizeToolSchema(tool.schema),
      }
    })
  }

  function normalizeAnthropicContent(content, request) {
    const chunks = Array.isArray(content) ? content : []
    const text = []
    const toolCalls = []
    for (let i = 0; i < chunks.length; i++) {
      const item = chunks[i] || {}
      if (item.type === 'text' && item.text) text.push(item.text)
      if (item.type !== 'tool_use') continue
      const id = toolIdFromName(item.name || '', request)
      toolCalls.push({
        id: item.id || null,
        toolId: id,
        name: id,
        providerName: item.name || '',
        args: hasOwn(item, 'input') ? item.input : {},
      })
    }
    return { content: text.join(''), toolCalls: toolCalls }
  }

  function anthropicSystem(messages) {
    const parts = []
    for (let i = 0; i < (messages || []).length; i++) {
      if (messages[i].role === 'system') parts.push(messageText(messages[i].content))
    }
    return parts.join('\n\n')
  }

  function textToolProtocol(request) {
    const tools = request.toolSpecs || []
    if (!tools.length) return ''
    const compact = tools.map(function (tool) {
      return {
        id: tool.id,
        title: tool.title || tool.id,
        description: tool.description || '',
        schema: tool.schema || null,
      }
    })
    return [
      'SYSTEM: AIditor text tool bridge. Use only tools listed in AVAILABLE_TOOLS.',
      'When an action requires a tool, end the reply with exactly one JSON code block using this shape:',
      '```json',
      '{"aiditor_tool_calls":[{"toolId":"tool.id","args":{}}]}',
      '```',
      'Multiple calls may appear in that one array. Do not claim execution unless the matching call is emitted.',
      'For normal conversation, answer without an aiditor_tool_calls block.',
      'CURRENT_AGENT_ID: ' + ((request.agent && request.agent.id) || ''),
      'AVAILABLE_TOOLS: ' + JSON.stringify(compact),
    ].join('\n')
  }

  function transcriptText(request) {
    const messages = request.messages || []
    const out = []
    const toolText = textToolProtocol(request)
    if (toolText) out.push(toolText)
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] || {}
      if (msg.status === 'running') continue
      const text = messageText(msg.content != null ? msg.content : msg.text).trim()
      if (!text) continue
      out.push(String(msg.role || msg.from || 'message').toUpperCase() + ': ' + text)
    }
    return out.join('\n\n')
  }

  function imageInputItems(request) {
    const refs = request.attachmentRefs || []
    const payloads = request.attachments || request.resolvedAttachments || []
    const out = []
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i] || {}
      const payload = payloads[i] || {}
      const kind = String(ref.kind || payload.kind || '')
      if (payload.path && kind.indexOf('image') >= 0) out.push({ type: 'localImage', path: payload.path })
      else if (payload.url && kind.indexOf('image') >= 0) out.push({ type: 'image', url: payload.url })
      else if (payload.dataUrl && kind.indexOf('image') >= 0) out.push({ type: 'image', url: payload.dataUrl })
    }
    return out
  }

  function encodeTextToolRequest(request) {
    const inputItems = []
    const text = transcriptText(request)
    if (text) inputItems.push({ type: 'text', text: text })
    return Object.assign({}, request, {
      inputItems: inputItems.concat(imageInputItems(request)),
    })
  }

  function parseTextToolCalls(text) {
    const source = String(text || '')
    const calls = []
    const re = /```(?:json)?\s*([\s\S]*?)```/gi
    let cleaned = source
    let match
    while ((match = re.exec(source))) {
      const raw = match[1].trim()
      let data = null
      try { data = JSON.parse(raw) } catch (_) { continue }
      const list = data && (data.aiditor_tool_calls || data.toolCalls || data.tool_calls)
      if (!Array.isArray(list)) continue
      for (let i = 0; i < list.length; i++) {
        const item = list[i] || {}
        calls.push({
          toolId: item.toolId || item.name || item.tool || '',
          name: item.toolId || item.name || item.tool || '',
          args: hasOwn(item, 'args') ? item.args : (hasOwn(item, 'arguments') ? item.arguments : {}),
        })
      }
      cleaned = cleaned.replace(match[0], '').trim()
    }
    const rawRe = /(^|\n)\s*(\{[^\n]*"aiditor_tool_calls"[^\n]*\})\s*(?=\n|$)/g
    while ((match = rawRe.exec(cleaned))) {
      const raw = match[2].trim()
      let data = null
      try { data = JSON.parse(raw) } catch (_) { continue }
      const list = data && (data.aiditor_tool_calls || data.toolCalls || data.tool_calls)
      if (!Array.isArray(list)) continue
      for (let i = 0; i < list.length; i++) {
        const item = list[i] || {}
        calls.push({
          toolId: item.toolId || item.name || item.tool || '',
          name: item.toolId || item.name || item.tool || '',
          args: hasOwn(item, 'args') ? item.args : (hasOwn(item, 'arguments') ? item.arguments : {}),
        })
      }
      cleaned = cleaned.replace(raw, '').trim()
    }
    return { content: calls.length ? cleaned : (cleaned || source), toolCalls: calls }
  }

  function decodeTextToolResponse(result) {
    const message = result && result.message ? result.message : result
    if (typeof message === 'string') {
      const parsed = parseTextToolCalls(message)
      return { role: 'assistant', content: parsed.content, toolCalls: parsed.toolCalls }
    }
    const content = messageText(message && message.content)
    const parsed = parseTextToolCalls(content)
    return Object.assign({}, message || {}, {
      role: (message && message.role) || 'assistant',
      content: parsed.content,
      toolCalls: (message && message.toolCalls && message.toolCalls.length) ? message.toolCalls : parsed.toolCalls,
    })
  }

  ai.messageText = ai.messageText || messageText
  ai.toolArguments = {
    read: toolCallArgs,
    mergeDeltas: mergeToolCallDeltas,
  }
  ai.toolAliasMap = toolAliasMap
  ai.openAiTools = openAiTools
  ai.openAiMessages = openAiMessages
  ai.normalizeOpenAiToolCalls = normalizeOpenAiToolCalls
  ai.anthropicPayloadMessages = anthropicPayloadMessages
  ai.anthropicTools = anthropicTools
  ai.normalizeAnthropicContent = normalizeAnthropicContent
  ai.anthropicSystem = anthropicSystem
  ai.encodeTextToolRequest = encodeTextToolRequest
  ai.decodeTextToolResponse = decodeTextToolResponse
})(window.aiditor = window.aiditor || {})

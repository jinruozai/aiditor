// aiditor.ai built-in transports.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const http = ai.provider

  function mergeToolCallDeltas(calls) {
    const out = []
    for (let i = 0; i < (calls || []).length; i++) {
      const delta = calls[i]
      const index = delta.index != null ? delta.index : findToolCallIndex(out, delta)
      const at = index >= 0 ? index : out.length
      const cur = out[at] || {}
      const next = Object.assign({}, cur)
      if (delta.id) next.id = delta.id
      if (delta.type) next.type = delta.type
      if (delta.function) {
        const fn = Object.assign({}, next.function || {})
        if (delta.function.name) fn.name = delta.function.name
        if (delta.function.arguments != null) fn.arguments = String(fn.arguments || '') + String(delta.function.arguments)
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

  function configuredMaxTokens(config, fallback) {
    const n = Number(config.maxTokens || config.maxOutputTokens || config.max_tokens || config.max_completion_tokens || 0)
    return n > 0 ? n : fallback
  }

  ai.registerTransport('mock', {
    toolProtocol: 'none',
    outputProtocol: 'text',
    send: function (connection, request, ctx) {
      const config = ai.getConnectionConfig(connection.id)
      if (ctx.signal && ctx.signal.aborted) throw new Error('aborted')
      const last = request.messages[request.messages.length - 1]
      const text = last && last.content ? ai.messageText(last.content) : ''
      return {
        role: 'assistant',
        content: text ? (config.responsePrefix || 'Echo:') + ' ' + text : 'Mock assistant response.',
      }
    },
  })

  ai.registerTransport('openai-compatible', {
    toolProtocol: 'native',
    outputProtocol: 'text',
    models: function (connection, config) {
      return http.requestJson(http.joinUrl(config.baseUrl, '/models'), {
        method: 'GET',
        headers: http.authHeaders(config, 'openai'),
      }).then(function (data) {
        return http.normalizeModels((data.data || data.models || []).map(function (item) { return item.id || item.name || item.model || item }))
      })
    },
    send: function (connection, request, ctx) {
      const config = ai.getConnectionConfig(connection.id)
      const model = request.model || config.defaultModel
      const tools = ai.openAiTools(request)
      const stream = !!(request.stream && config.stream)
      const body = {
        model: model,
        messages: ai.openAiMessages(request.messages, request),
        stream: stream,
        stream_options: stream ? { include_usage: true } : undefined,
        max_tokens: configuredMaxTokens(config, 8192),
      }
      if (tools.length) {
        body.tools = tools
        body.tool_choice = 'auto'
      }
      if (request.outputSchema && request.connectionCapabilities && request.connectionCapabilities.outputProtocol === 'native') {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'aiditor_output', schema: request.outputSchema },
        }
      }
      return http.requestMaybeStream(http.joinUrl(config.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: http.authHeaders(config, 'openai'),
        signal: ctx.signal,
        body: JSON.stringify(body),
      }, function (data) {
        const choice = data.choices && data.choices[0]
        const hasDelta = !!(choice && choice.delta)
        const delta = choice && (choice.delta || choice.message)
        if (!delta) return data.usage ? { usage: data.usage } : ''
        const out = {
          text: ai.messageText(delta.content),
          reasoning_content: delta.reasoning_content || delta.reasoningContent || '',
          toolCalls: delta.tool_calls || delta.toolCalls || [],
          usage: data.usage || null,
          finishReason: choice.finish_reason || choice.finishReason || null,
        }
        if (!hasDelta && delta.content != null) {
          out.snapshot = ai.messageText(delta.content)
          delete out.text
        }
        return out
      }).then(function (data) {
        if (data.streamed && data.deltas) return { deltas: data.deltas }
        if (data.streamed) {
          return {
            role: 'assistant',
          content: data.content,
          reasoning_content: data.reasoning_content || null,
          toolCalls: ai.normalizeOpenAiToolCalls(mergeToolCallDeltas(data.toolCalls || []), request),
          usage: data.usage || null,
          finishReason: data.finishReason || null,
        }
        }
        data = data.data
        const choice = data.choices && data.choices[0]
        const message = (choice && choice.message) || {}
        return {
          role: message.role || 'assistant',
          content: ai.messageText(message.content),
          reasoning_content: message.reasoning_content || message.reasoningContent || null,
          toolCalls: ai.normalizeOpenAiToolCalls(message.tool_calls || message.toolCalls || [], request),
          usage: data.usage || null,
          finishReason: choice && (choice.finish_reason || choice.finishReason) || null,
        }
      })
    },
  })

  ai.registerTransport('anthropic', {
    toolProtocol: 'native',
    outputProtocol: 'text',
    models: function (connection, config) {
      const headers = http.authHeaders(config, 'anthropic')
      headers['anthropic-version'] = '2023-06-01'
      return http.requestJson(http.joinUrl(config.baseUrl, '/v1/models'), {
        method: 'GET',
        headers: headers,
      }).then(function (data) {
        return http.normalizeModels((data.data || data.models || []).map(function (item) { return item.id || item.name }))
      })
    },
    send: function (connection, request, ctx) {
      const config = ai.getConnectionConfig(connection.id)
      const headers = http.authHeaders(config, 'anthropic')
      const body = {
        model: request.model || config.defaultModel,
        messages: ai.anthropicPayloadMessages(request.messages, request),
        max_tokens: configuredMaxTokens(config, 8192),
        stream: !!(request.stream && config.stream),
      }
      const tools = ai.anthropicTools(request)
      if (tools.length) body.tools = tools
      headers['anthropic-version'] = '2023-06-01'
      const system = ai.anthropicSystem(request.messages)
      if (system) body.system = system
      return http.requestMaybeStream(http.joinUrl(config.baseUrl, '/v1/messages'), {
        method: 'POST',
        headers: headers,
        signal: ctx.signal,
        body: JSON.stringify(body),
      }, function (data) {
        if (data.type === 'content_block_delta' && data.delta) {
          if (data.delta.type === 'input_json_delta') {
            return { toolCalls: [{ index: data.index, function: { arguments: data.delta.partial_json || '' } }] }
          }
          return data.delta.text || ''
        }
        if (data.type === 'content_block_start' && data.content_block) {
          if (data.content_block.type === 'tool_use') {
            return {
              toolCalls: [{
                index: data.index,
                id: data.content_block.id,
                type: 'function',
                function: {
                  name: data.content_block.name,
                  arguments: Object.keys(data.content_block.input || {}).length ? JSON.stringify(data.content_block.input) : '',
                },
              }],
            }
          }
          return data.content_block.text || ''
        }
        if (data.type === 'message_delta' && data.delta) return { finishReason: data.delta.stop_reason || data.delta.stopReason || '', usage: data.usage || null }
        return ''
      }).then(function (data) {
        if (data.streamed && data.deltas) return { deltas: data.deltas }
        if (data.streamed) return { role: 'assistant', content: data.content, usage: data.usage || null }
        data = data.data
        const normalized = ai.normalizeAnthropicContent(data.content || [], request)
        return {
          role: 'assistant',
          content: normalized.content,
          toolCalls: normalized.toolCalls,
          usage: data.usage || null,
          finishReason: data.stop_reason || data.stopReason || null,
        }
      })
    },
  })

  ai.registerTransport('local-bridge', {
    toolProtocol: 'native',
    outputProtocol: 'text',
    models: function (connection, config) {
      return http.requestJson(http.joinUrl(config.baseUrl, '/models'), {
        method: 'GET',
        headers: http.authHeaders(config, 'openai'),
      }).then(function (data) {
        return http.normalizeModels(data.models || data.data || [])
      })
    },
    send: function (connection, request, ctx) {
      const config = ai.getConnectionConfig(connection.id)
      return http.requestMaybeStream(http.joinUrl(config.baseUrl, '/chat'), {
        method: 'POST',
        headers: http.authHeaders(config, 'openai'),
        signal: ctx.signal,
        body: JSON.stringify(Object.assign({}, request, {
          model: request.model || config.defaultModel,
          stream: !!(request.stream && config.stream),
        })),
      }, function (data) {
        if (data.delta != null) return { text: ai.messageText(data.delta) }
        if (data.content != null) return { snapshot: ai.messageText(data.content) }
        return ''
      }).then(function (data) {
        if (data.streamed && data.deltas) return { deltas: data.deltas }
        if (data.streamed) return { role: 'assistant', content: data.content, usage: data.usage || null }
        data = data.data
        if (typeof data === 'string') return { role: 'assistant', content: data }
        return data.message || data.result || data
      })
    },
  })

  ai.registerTransport('codex-bridge', {
    toolProtocol: 'text',
    outputProtocol: 'text',
    models: function (connection, config) {
      return http.requestJson(http.joinUrl(config.baseUrl, '/connections/' + connection.id + '/models'), { method: 'GET' })
        .then(function (data) { return http.normalizeModels(data.models || data.data || []) })
    },
    send: function (connection, request, ctx) {
      const config = ai.getConnectionConfig(connection.id)
      const encoded = ai.encodeTextToolRequest(Object.assign({}, request, {
        model: request.model || config.defaultModel,
        stream: !!(request.stream && config.stream),
      }))
      return http.requestMaybeStream(http.joinUrl(config.baseUrl, '/connections/' + connection.id + '/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctx.signal,
        body: JSON.stringify(encoded),
      }, function (data) {
        if (data.delta != null) return { text: ai.messageText(data.delta) }
        if (data.content != null) return { snapshot: ai.messageText(data.content) }
        return ''
      }).then(function (data) {
        if (data.streamed && data.deltas) return { deltas: data.deltas }
        if (data.streamed) return { role: 'assistant', content: data.content, usage: data.usage || null }
        data = data.data
        return ai.decodeTextToolResponse(data.message || data.result || data)
      })
    },
  })
})(window.aiditor = window.aiditor || {})

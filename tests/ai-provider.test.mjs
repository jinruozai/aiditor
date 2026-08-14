import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/core/settings.js', 'utf8'), { filename: 'settings.js' })
vm.runInThisContext(readFileSync('src/ai/connection.js', 'utf8'), { filename: 'ai/connection.js' })
vm.runInThisContext(readFileSync('src/ai/adapter.js', 'utf8'), { filename: 'ai/adapter.js' })
vm.runInThisContext(readFileSync('src/ai/provider.js', 'utf8'), { filename: 'ai/provider.js' })
vm.runInThisContext(readFileSync('src/ai/provider-auth.js', 'utf8'), { filename: 'ai/provider-auth.js' })
vm.runInThisContext(readFileSync('src/ai/provider-transports.js', 'utf8'), { filename: 'ai/provider-transports.js' })
vm.runInThisContext(readFileSync('src/ai/provider-connections.js', 'utf8'), { filename: 'ai/provider-connections.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
for (const file of ['src/ai/contribution-registry.js', 'src/ai/tool/registry.js', 'src/ai/context/registry.js', 'src/ai/skill/registry.js']) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const aiditor = window.aiditor
const ai = aiditor.ai
const calls = []

global.fetch = function (url, opts) {
  calls.push({ url, opts: opts || {} })
  if (String(url).startsWith('https://stream.test')) {
    const body = JSON.parse((opts && opts.body) || '{}')
    const last = body.messages && body.messages[body.messages.length - 1]
    if (last && last.content === 'stream tool') {
      return Promise.resolve(streamResponse([
        'data: {"choices":[{"delta":{"content":"checking "}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stream","type":"function","function":{"name":"editor__searchReferences","arguments":"{\\\"query\\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"dock\\\",\\\"limit\\\":2}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]))
    }
    if (last && last.content === 'stream reasoning') {
      return Promise.resolve(streamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"more","content":"answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ]))
    }
    if (last && last.content === 'cumulative stream') {
      return Promise.resolve(streamResponse([
        'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"AB"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ABC"}}]}\n\n',
        'data: [DONE]\n\n',
      ]))
    }
    return Promise.resolve(streamResponse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]))
  }
  if (String(url).startsWith('https://codex-stream.test')) {
    return Promise.resolve(streamResponse([
      'data: {"content":"A"}\n\n',
      'data: {"content":"AB"}\n\n',
      'data: {"content":"ABC"}\n\n',
      'data: [DONE]\n\n',
    ]))
  }
  if (String(url).endsWith('/models')) {
    return Promise.resolve(response({
      data: [{ id: 'model-a' }, { id: 'model-b' }],
      models: [{ id: 'bridge-a' }],
    }))
  }
  if (String(url).endsWith('/chat/completions')) {
    const body = JSON.parse((opts && opts.body) || '{}')
    const last = body.messages && body.messages[body.messages.length - 1]
    if (last && last.content === 'deepseek tool') {
      return Promise.resolve(response({
        choices: [{
          message: {
            role: 'assistant',
            content: 'checking project',
            reasoning_content: 'I need to inspect the project summary first.',
            tool_calls: [{
              id: 'call_ds_summary',
              type: 'function',
              function: { name: 'gde__getProjectSummary', arguments: '{}' },
            }],
          },
        }],
      }))
    }
    return Promise.resolve(response({
      choices: [{ message: { role: 'assistant', content: 'openai reply' } }],
    }))
  }
  if (String(url).endsWith('/v1/messages')) {
    const body = JSON.parse((opts && opts.body) || '{}')
    const last = body.messages && body.messages[body.messages.length - 1]
    if (last && last.content === 'anthropic tool') {
      return Promise.resolve(response({
        content: [{ type: 'tool_use', id: 'call_claude', name: 'agent__create', input: { name: 'worker' } }],
        stop_reason: 'tool_use',
      }))
    }
    return Promise.resolve(response({
      content: [{ type: 'text', text: 'anthropic reply' }],
    }))
  }
  if (String(url).endsWith('/chat')) {
    return Promise.resolve(response({
      message: { role: 'assistant', content: 'bridge reply' },
    }))
  }
  return Promise.resolve(response({}, false, 'not found'))
}

function response(body, ok = true, statusText = 'OK') {
  return {
    ok,
    statusText,
    headers: { get: function () { return 'application/json' } },
    text: function () { return Promise.resolve(JSON.stringify(body)) },
  }
}

function streamResponse(chunks) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok: true,
    statusText: 'OK',
    headers: { get: function () { return 'text/event-stream' } },
    body: {
      getReader: function () {
        return {
          read: function () {
            if (index >= chunks.length) return Promise.resolve({ done: true })
            return Promise.resolve({ done: false, value: encoder.encode(chunks[index++]) })
          },
        }
      },
    },
    text: function () { throw new Error('stream response should not be buffered') },
  }
}

assert.deepEqual(ai.listConnections(), [
  'mock',
  'openai-api',
  'openai-codex',
  'openrouter',
  'groq',
  'mistral',
  'xai',
  'deepseek',
  'ollama',
  'custom-openai',
  'anthropic-api',
  'claude-code',
  'local-bridge',
])
assert.equal(ai.connectionOptions()[1].label, 'OpenAI API')
assert.equal(ai.getConnectionConfig('deepseek').baseUrl, 'https://api.deepseek.com/v1')
assert.equal(ai.getConnectionConfig('ollama').baseUrl, 'http://127.0.0.1:11434/v1')
assert.equal(ai.getConnectionConfig('openai-codex').defaultModel, 'gpt-5.5')
assert.deepEqual(ai.modelHints('openai-codex').slice(0, 2), ['gpt-5.5', 'gpt-5.5-pro'])
assert.equal(ai.connectionCapabilities('deepseek').toolProtocol, 'native')
assert.equal(ai.connectionCapabilities('deepseek').toolCalling, true)
assert.equal(ai.connectionCapabilities('deepseek').toolArguments, 'json')
assert.equal(ai.connectionCapabilities('openai-api').toolArguments, 'strict')
assert.equal(ai.connectionCapabilities('anthropic-api').toolArguments, 'strict')
assert.equal(ai.connectionCapabilities('local-bridge').toolArguments, 'structured')
assert.equal(ai.connectionCapabilities('openai-codex').toolProtocol, 'text')
assert.equal(ai.connectionCapabilities('openai-codex').toolArguments, 'json')
assert.equal(ai.connectionCapabilities('mock').toolProtocol, 'none')
assert.equal(ai.connectionCapabilities('mock').toolArguments, 'none')
assert.equal(ai.connectionCapabilities('openai-api').outputProtocol, 'native')
assert.equal(ai.connectionCapabilities('deepseek').outputProtocol, 'text')
ai.registerTransport('invalid-protocol', { toolProtocol: 'xml' })
assert.throws(function () {
  ai.registerConnection('invalid-protocol', { transport: { type: 'invalid-protocol' }, configDefaults: {} })
}, /Unknown AI tool protocol/)

let reactiveDeepSeekKey = ''
const disposeConfigWatch = aiditor.effect(function () {
  reactiveDeepSeekKey = ai.getConnectionConfig('deepseek').apiKey
})
assert.equal(reactiveDeepSeekKey, '')
aiditor.settings.set(ai.connectionConfigKey('deepseek', 'apiKey'), 'deepseek-key')
assert.equal(reactiveDeepSeekKey, 'deepseek-key')
disposeConfigWatch()

const custom = ai.createCustomConnection({ label: 'Studio Gateway', baseUrl: 'https://studio.test/v1' })
assert.equal(custom.id, 'studio-gateway')
assert.equal(ai.getConnectionConfig(custom.id).baseUrl, 'https://studio.test/v1')
assert.equal(ai.getConnection(custom.id).custom, true)

aiditor.settings.set(ai.connectionConfigKey('openai-api', 'baseUrl'), 'https://openai.test/v1/')
aiditor.settings.set(ai.connectionConfigKey('openai-api', 'apiKey'), 'openai-key')
aiditor.settings.set(ai.connectionConfigKey('openai-api', 'defaultModel'), 'model-a')
aiditor.settings.set(ai.connectionConfigKey('openai-api', 'stream'), true)

const openAiModels = await ai.refreshModels('openai-api')
assert.deepEqual(openAiModels.map(function (m) { return m.id }), ['model-a', 'model-b'])
assert.equal(calls.at(-1).url, 'https://openai.test/v1/models')
assert.equal(calls.at(-1).opts.headers.Authorization, 'Bearer openai-key')

const openAiReply = await ai.sendViaConnection('openai-api', {
  model: '',
  stream: true,
  messages: [{ role: 'user', content: 'hello' }],
  toolSpecs: [],
}, { signal: null })
assert.equal(openAiReply.content, 'openai reply')
const openAiBody = JSON.parse(calls.at(-1).opts.body)
assert.equal(openAiBody.model, 'model-a')
assert.equal(openAiBody.stream, true)
assert.deepEqual(openAiBody.messages, [{ role: 'user', content: 'hello' }])

await ai.sendViaConnection('openai-api', {
  model: '',
  stream: false,
  messages: [{ role: 'user', content: 'structured' }],
  toolSpecs: [],
  outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
}, { signal: null })
const openAiStructuredBody = JSON.parse(calls.at(-1).opts.body)
assert.equal(openAiStructuredBody.response_format.type, 'json_schema')
assert.equal(openAiStructuredBody.response_format.json_schema.schema.properties.ok.type, 'boolean')

const imageDataUrl = 'data:image/png;base64,aGVsbG8='
await ai.sendViaConnection('openai-api', {
  model: '',
  stream: false,
  messages: [{ role: 'user', content: 'see image' }],
  attachmentRefs: [{ kind: 'file.image', title: 'icon.png', meta: { dataUrl: imageDataUrl } }],
  attachments: [{ dataUrl: imageDataUrl }],
  toolSpecs: [],
}, { signal: null })
const openAiImageBody = JSON.parse(calls.at(-1).opts.body)
assert.deepEqual(openAiImageBody.messages[0].content, [
  { type: 'text', text: 'see image' },
  { type: 'image_url', image_url: { url: imageDataUrl } },
])

const openAiToolReply = await ai.sendViaConnection('openai-api', {
  model: '',
  stream: true,
  messages: [{ role: 'user', content: 'use tool' }],
  toolSpecs: ai.toolArguments.prepareSpecs([{ id: 'gde.queryRows', title: 'Query Rows', description: 'Read rows', schema: { table: 'string', limit: 'number' } }], ai.connectionCapabilities('openai-api')),
  toolChoice: { mode: 'required', tools: ['gde.queryRows'] },
}, { signal: null })
const openAiToolBody = JSON.parse(calls.at(-1).opts.body)
assert.equal(openAiToolBody.stream, true)
assert.equal(openAiToolBody.tools[0].function.name, 'gde__queryRows')
assert.equal(openAiToolBody.tools[0].function.strict, true)
assert.deepEqual(openAiToolBody.tools[0].function.parameters.required, ['table', 'limit'])
assert.deepEqual(openAiToolBody.tool_choice, { type: 'function', function: { name: 'gde__queryRows' } })
assert.deepEqual(openAiToolBody.tools[0].function.parameters.properties.table, { type: ['string', 'null'] })
assert.deepEqual(openAiToolReply.toolCalls, [])

const deepSeekToolReply = await ai.sendViaConnection('deepseek', {
  model: 'deepseek-v4-flash',
  stream: false,
  messages: [{ role: 'user', content: 'deepseek tool' }],
  toolSpecs: [{ id: 'gde.getProjectSummary', title: 'Project Summary', description: 'Read project summary', schema: {} }],
}, { signal: null })
assert.equal(deepSeekToolReply.reasoning_content, 'I need to inspect the project summary first.')
assert.equal(deepSeekToolReply.toolCalls[0].toolId, 'gde.getProjectSummary')
const deepSeekReplay = ai.openAiMessages([
  { role: 'assistant', content: deepSeekToolReply.content, reasoning_content: deepSeekToolReply.reasoning_content, toolCalls: deepSeekToolReply.toolCalls },
  { role: 'tool', meta: { toolCallId: deepSeekToolReply.toolCalls[0].id }, content: { ok: true } },
], { connectionName: 'deepseek' })
assert.equal(deepSeekReplay[0].reasoning_content, 'I need to inspect the project summary first.')
assert.equal(deepSeekReplay[0].tool_calls[0].id, 'call_ds_summary')

aiditor.settings.set(ai.connectionConfigKey('deepseek', 'baseUrl'), 'https://stream.test/v1')
aiditor.settings.set(ai.connectionConfigKey('deepseek', 'defaultModel'), 'deepseek-v4-flash')
aiditor.settings.set(ai.connectionConfigKey('deepseek', 'stream'), true)
const streamedReply = await ai.sendViaConnection('deepseek', {
  model: '',
  stream: true,
  messages: [{ role: 'user', content: 'stream' }],
}, { signal: null })
assert.equal(typeof streamedReply.deltas[Symbol.asyncIterator], 'function')
const streamParts = []
let streamUsage = null
for await (const delta of streamedReply.deltas) {
  if (delta.text) streamParts.push(delta.text)
  if (delta.usage) streamUsage = delta.usage
}
assert.equal(streamParts.join(''), 'hello')
assert.deepEqual(streamUsage, { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 })

const streamedToolReply = await ai.sendViaConnection('deepseek', {
  model: '',
  stream: true,
  messages: [{ role: 'user', content: 'stream tool' }],
  toolSpecs: [{ id: 'aiditor.searchReferences', title: 'Search', schema: { query: 'string', limit: 'number' } }],
}, { signal: null })
assert.equal(typeof streamedToolReply.deltas[Symbol.asyncIterator], 'function')
const streamedToolDeltas = []
for await (const delta of streamedToolReply.deltas) streamedToolDeltas.push(delta)
assert.equal(streamedToolDeltas[0].text, 'checking ')
assert.equal(streamedToolDeltas[1].toolCalls[0].id, 'call_stream')
assert.equal(streamedToolDeltas[2].toolCalls[0].function.arguments, '"dock","limit":2}')

const streamedReasoningReply = await ai.sendViaConnection('deepseek', {
  model: '',
  stream: true,
  messages: [{ role: 'user', content: 'stream reasoning' }],
}, { signal: null })
let streamedReasoning = ''
let streamedReasoningText = ''
for await (const delta of streamedReasoningReply.deltas) {
  if (delta.reasoning_content) streamedReasoning += delta.reasoning_content
  if (delta.text) streamedReasoningText += delta.text
}
assert.equal(streamedReasoning, 'think more')
assert.equal(streamedReasoningText, 'answer')

const cumulativeOpenAiReply = await ai.sendViaConnection('deepseek', {
  model: '',
  stream: true,
  messages: [{ role: 'user', content: 'cumulative stream' }],
}, { signal: null })
let cumulativeOpenAiText = ''
for await (const delta of cumulativeOpenAiReply.deltas) {
  if (delta.text) cumulativeOpenAiText += delta.text
}
assert.equal(cumulativeOpenAiText, 'ABC')

aiditor.settings.set(ai.connectionConfigKey('openai-codex', 'baseUrl'), 'https://codex-stream.test')
aiditor.settings.set(ai.connectionConfigKey('openai-codex', 'stream'), true)
const codexSnapshotReply = await ai.sendViaConnection('openai-codex', {
  model: 'gpt-test',
  stream: true,
  messages: [{ role: 'user', content: 'snapshot stream' }],
  toolSpecs: [],
}, { signal: null })
let codexSnapshotText = ''
for await (const delta of codexSnapshotReply.deltas) {
  if (delta.text) codexSnapshotText += delta.text
}
assert.equal(codexSnapshotText, 'ABC')

aiditor.settings.set(ai.connectionConfigKey('anthropic-api', 'baseUrl'), 'https://anthropic.test')
aiditor.settings.set(ai.connectionConfigKey('anthropic-api', 'apiKey'), 'anthropic-key')
aiditor.settings.set(ai.connectionConfigKey('anthropic-api', 'defaultModel'), 'claude-test')

const anthropicReply = await ai.sendViaConnection('anthropic-api', {
  model: '',
  stream: false,
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hello' },
  ],
}, { signal: null })
assert.equal(anthropicReply.content, 'anthropic reply')
const anthropicCall = calls.at(-1)
const anthropicBody = JSON.parse(anthropicCall.opts.body)
assert.equal(anthropicCall.opts.headers['x-api-key'], 'anthropic-key')
assert.equal(anthropicCall.opts.headers['anthropic-version'], '2023-06-01')
assert.equal(anthropicBody.model, 'claude-test')
assert.equal(anthropicBody.system, 'be brief')
assert.deepEqual(anthropicBody.messages, [{ role: 'user', content: 'hello' }])

const anthropicToolReply = await ai.sendViaConnection('anthropic-api', {
  model: '',
  stream: false,
  messages: [{ role: 'user', content: 'anthropic tool' }],
  toolSpecs: ai.toolArguments.prepareSpecs([{ id: 'agent.create', description: 'Create an agent', schema: { name: 'string' } }], ai.connectionCapabilities('anthropic-api')),
  toolChoice: { mode: 'required', tools: ['agent.create'] },
}, { signal: null })
const anthropicToolBody = JSON.parse(calls.at(-1).opts.body)
assert.equal(anthropicToolBody.tools[0].name, 'agent__create')
assert.equal(anthropicToolBody.tools[0].strict, true)
assert.deepEqual(anthropicToolBody.tool_choice, { type: 'tool', name: 'agent__create' })
assert.deepEqual(anthropicToolBody.tools[0].input_schema.properties.name.type, ['string', 'null'])
assert.equal(anthropicToolReply.toolCalls[0].toolId, 'agent.create')
assert.equal(anthropicToolReply.toolCalls[0].args.name, 'worker')
assert.equal(anthropicToolReply.finishReason, 'tool_use')

await ai.sendViaConnection('anthropic-api', {
  model: '',
  stream: false,
  messages: [{ role: 'user', content: 'see image' }],
  attachmentRefs: [{ kind: 'file.image', title: 'icon.png', meta: { dataUrl: imageDataUrl } }],
  attachments: [{ dataUrl: imageDataUrl }],
}, { signal: null })
const anthropicImageBody = JSON.parse(calls.at(-1).opts.body)
assert.deepEqual(anthropicImageBody.messages[0].content, [
  { type: 'text', text: 'see image' },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
])

aiditor.settings.set(ai.connectionConfigKey('local-bridge', 'baseUrl'), 'http://bridge.test/')
aiditor.settings.set(ai.connectionConfigKey('local-bridge', 'defaultModel'), 'local-test')
const bridgeReply = await ai.sendViaConnection('local-bridge', {
  model: '',
  stream: false,
  messages: [{ role: 'user', content: 'hello' }],
  attachments: [{ uri: 'memory://one' }],
}, { signal: null })
assert.equal(bridgeReply.content, 'bridge reply')
const bridgeBody = JSON.parse(calls.at(-1).opts.body)
assert.equal(calls.at(-1).url, 'http://bridge.test/chat')
assert.equal(bridgeBody.model, 'local-test')
assert.deepEqual(bridgeBody.attachments, [{ uri: 'memory://one' }])

console.log('ai provider tests ok')

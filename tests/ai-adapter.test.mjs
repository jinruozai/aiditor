import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'core/names.js' })
vm.runInThisContext(readFileSync('src/ai/adapter.js', 'utf8'), { filename: 'ai/adapter.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
vm.runInThisContext(readFileSync('src/ai/registries.js', 'utf8'), { filename: 'ai/registries.js' })

const ai = window.aiditor.ai

const request = {
  agent: { id: 'a_main', name: 'main', parentAgentId: null },
  messages: [
    { role: 'system', content: 'You are exact.' },
    { role: 'user', content: 'Create a helper.' },
  ],
  toolSpecs: [{
    id: 'agent.create',
    title: 'Create Agent',
    description: 'Create a child agent.',
    schema: { name: 'string', parentAgentId: 'string' },
  }],
}

const encoded = ai.encodeTextToolRequest(request)
assert.equal(encoded.inputItems.length, 1)
assert.equal(encoded.inputItems[0].type, 'text')
assert.match(encoded.inputItems[0].text, /AVAILABLE_TOOLS/)
assert.match(encoded.inputItems[0].text, /CURRENT_AGENT_ID: a_main/)
assert.match(encoded.inputItems[0].text, /"aiditor_tool_calls"/)
assert.match(encoded.inputItems[0].text, /Do not claim execution unless the matching call is emitted/)
assert.doesNotMatch(encoded.inputItems[0].text, /"parentAgentId":"a_main"/)
assert.doesNotMatch(encoded.inputItems[0].text, /agent\/group\/resource/)
assert.doesNotMatch(encoded.inputItems[0].text, /For "create an agent"/)
assert.match(encoded.inputItems[0].text, /USER: Create a helper\./)

const decoded = ai.decodeTextToolResponse({
  role: 'assistant',
  content: [
    'I will create it.',
    '```json',
    '{"aiditor_tool_calls":[{"toolId":"agent.create","args":{"name":"helper","parentAgentId":"a_main"}}]}',
    '```',
  ].join('\n'),
})
assert.equal(decoded.content, 'I will create it.')
assert.equal(decoded.toolCalls.length, 1)
assert.equal(decoded.toolCalls[0].toolId, 'agent.create')
assert.equal(decoded.toolCalls[0].args.parentAgentId, 'a_main')

const rawDecoded = ai.decodeTextToolResponse({
  role: 'assistant',
  content: '{"aiditor_tool_calls":[{"toolId":"agent.send","args":{"agentId":"a_child","content":"write"}}]}',
})
assert.equal(rawDecoded.content, '')
assert.equal(rawDecoded.toolCalls.length, 1)
assert.equal(rawDecoded.toolCalls[0].toolId, 'agent.send')

const openAiTools = ai.openAiTools(request)
assert.equal(openAiTools[0].type, 'function')
assert.equal(openAiTools[0].function.name, 'agent__create')
assert.match(openAiTools[0].function.description, /Public tool id: agent\.create/)
assert.equal(openAiTools[0].function.parameters.type, 'object')

const collidingTools = ai.openAiTools({
  toolSpecs: [
    { id: 'same.name', schema: {} },
    { id: 'same__name', schema: {} },
  ],
})
assert.equal(collidingTools[0].function.name, 'same__name')
assert.notEqual(collidingTools[1].function.name, collidingTools[0].function.name)
const normalizedCollision = ai.normalizeOpenAiToolCalls([{
  id: 'call_collision',
  function: { name: collidingTools[1].function.name, arguments: '{}' },
}], {
  toolSpecs: [
    { id: 'same.name', schema: {} },
    { id: 'same__name', schema: {} },
  ],
})
assert.equal(normalizedCollision[0].toolId, 'same__name')

assert.throws(function () {
  ai.normalizeToolSchema({ type: 'object', required: ['missing'], properties: {} })
}, /required property is not defined/)

const anySchemaTool = ai.openAiTools({ toolSpecs: [{
  id: 'data.query',
  schema: { value: 'any', ids: 'array' },
}] })[0]
assert.deepEqual(anySchemaTool.function.parameters.properties.value, {})
assert.deepEqual(anySchemaTool.function.parameters.properties.ids, { type: 'array' })

const openAiMessages = ai.openAiMessages([
  { role: 'assistant', content: 'Done', toolCalls: [{ id: 'call_1', toolId: 'agent.create', args: { name: 'helper' } }] },
  { role: 'tool', id: 'tool_result_1', meta: { toolCallId: 'call_1' }, content: { ok: true } },
], request)
assert.equal(openAiMessages[0].tool_calls[0].function.name, 'agent__create')
assert.equal(openAiMessages[1].role, 'tool')
assert.equal(openAiMessages[1].tool_call_id, 'call_1')

const repairedToolOrder = ai.openAiMessages([
  { role: 'assistant', content: '', toolCalls: [{ id: 'call_repair', toolId: 'agent.create', args: { name: 'helper' } }] },
  { role: 'user', content: 'continue' },
  { role: 'tool', id: 'tool_repair', meta: { toolCallId: 'call_repair' }, content: { ok: true } },
], request)
assert.equal(repairedToolOrder[0].role, 'assistant')
assert.equal(repairedToolOrder[1].role, 'tool')
assert.equal(repairedToolOrder[1].tool_call_id, 'call_repair')
assert.equal(repairedToolOrder[2].role, 'user')

const strippedIncompleteToolCalls = ai.openAiMessages([
  { role: 'assistant', content: 'Need a tool.', toolCalls: [{ id: 'call_missing', toolId: 'agent.create', args: {} }] },
  { role: 'user', content: 'continue' },
], request)
assert.equal('tool_calls' in strippedIncompleteToolCalls[0], false)

const deepSeekMessages = ai.openAiMessages([
  { role: 'assistant', content: '', reasoning_content: 'Need project summary.', toolCalls: [{ id: 'call_ds', toolId: 'gde.getProjectSummary', args: {} }] },
], { connectionName: 'deepseek' })
assert.equal(deepSeekMessages[0].reasoning_content, 'Need project summary.')
const deepSeekReasoningWithoutTools = ai.openAiMessages([
  { role: 'assistant', content: 'I checked it.', reasoning_content: 'Reasoning must round trip.' },
], { connectionName: 'deepseek' })
assert.equal(deepSeekReasoningWithoutTools[0].reasoning_content, 'Reasoning must round trip.')
const openAiNoReasoning = ai.openAiMessages([
  { role: 'assistant', content: '', reasoning_content: 'Provider-specific thinking.', toolCalls: [{ id: 'call_openai', toolId: 'gde.getProjectSummary', args: {} }] },
], { connectionName: 'openai-api' })
assert.equal('reasoning_content' in openAiNoReasoning[0], false)

const normalized = ai.normalizeOpenAiToolCalls([{
  id: 'call_2',
  function: { name: 'agent__create', arguments: '{"name":"worker"}' },
}], request)
assert.equal(normalized[0].toolId, 'agent.create')
assert.equal(normalized[0].args.name, 'worker')
assert.equal(normalized[0].providerName, 'agent__create')

const fidelityArgs = {
  enabled: true,
  count: 0,
  empty: '',
  nothing: null,
  points: [[1, 2], [3, 4]],
  jsonLiteral: '{"must":"stay a string"}',
  nested: { values: [false, null, '[1,2]'] },
}
const normalizedJsonArgs = ai.normalizeOpenAiToolCalls([{
  id: 'call_json_args',
  function: { name: 'agent__create', arguments: JSON.stringify(fidelityArgs) },
}], request)
assert.deepEqual(normalizedJsonArgs[0].args, fidelityArgs)
assert.equal(normalizedJsonArgs[0].args.jsonLiteral, '{"must":"stay a string"}')

const structuredArguments = ai.normalizeOpenAiToolCalls([{
  id: 'call_structured_arguments',
  function: { name: 'agent__create', arguments: fidelityArgs },
}], request)
assert.equal(structuredArguments[0].args, fidelityArgs)

const canonicalArgs = ai.normalizeOpenAiToolCalls([{
  id: 'call_canonical_args',
  name: 'agent__create',
  args: fidelityArgs,
}], request)
assert.equal(canonicalArgs[0].args, fidelityArgs)

const mergedStringArguments = ai.toolArguments.mergeDeltas([], [
  { index: 0, id: 'call_fragmented', function: { name: 'agent__create', arguments: '{"nested":' } },
  { index: 0, function: { arguments: '{"value":"{\\"literal\\":true}"}}' } },
])
assert.deepEqual(ai.normalizeOpenAiToolCalls(mergedStringArguments, request)[0].args, {
  nested: { value: '{"literal":true}' },
})

const mergedStructuredArguments = ai.toolArguments.mergeDeltas([], [{
  index: 0,
  id: 'call_structured_delta',
  function: { name: 'agent__create', arguments: fidelityArgs },
}])
assert.equal(ai.normalizeOpenAiToolCalls(mergedStructuredArguments, request)[0].args, fidelityArgs)

assert.throws(function () {
  ai.normalizeOpenAiToolCalls([{
    id: 'call_invalid_args',
    function: { name: 'agent__create', arguments: '{"name":' },
  }], request)
}, function (error) {
  return error && error.code === 'TOOL_ARGUMENTS_INVALID_JSON'
})

const textFidelity = ai.decodeTextToolResponse({
  role: 'assistant',
  content: '```json\n' + JSON.stringify({
    aiditor_tool_calls: [{ toolId: 'agent.create', args: fidelityArgs }],
  }) + '\n```',
})
assert.deepEqual(textFidelity.toolCalls[0].args, fidelityArgs)

const anthropicTools = ai.anthropicTools(request)
assert.equal(anthropicTools[0].name, 'agent__create')
assert.equal(anthropicTools[0].input_schema.type, 'object')

const anthropicToolMessages = ai.anthropicPayloadMessages([
  { role: 'assistant', content: 'Checking.', toolCalls: [{ id: 'call_a', providerCallId: 'call_a', toolId: 'agent.create', args: { name: 'worker' } }] },
  { role: 'tool', meta: { toolCallId: 'call_a' }, content: '{"ok":true}' },
], request)
assert.equal(anthropicToolMessages[0].content[1].type, 'tool_use')
assert.equal(anthropicToolMessages[0].content[1].name, 'agent__create')
assert.equal(anthropicToolMessages[1].content[0].type, 'tool_result')
assert.equal(anthropicToolMessages[1].content[0].tool_use_id, 'call_a')

const normalizedAnthropic = ai.normalizeAnthropicContent([
  { type: 'text', text: 'Checking.' },
  { type: 'tool_use', id: 'call_b', name: 'agent__create', input: { name: 'worker' } },
], request)
assert.equal(normalizedAnthropic.content, 'Checking.')
assert.equal(normalizedAnthropic.toolCalls[0].toolId, 'agent.create')
assert.equal(normalizedAnthropic.toolCalls[0].providerName, 'agent__create')

const normalizedAnthropicFidelity = ai.normalizeAnthropicContent([
  { type: 'tool_use', id: 'call_b_fidelity', name: 'agent__create', input: fidelityArgs },
], request)
assert.equal(normalizedAnthropicFidelity.toolCalls[0].args, fidelityArgs)

const imageRequest = {
  attachmentRefs: [{ kind: 'file.image', title: 'icon.png' }],
  attachments: [{ dataUrl: 'data:image/png;base64,AAAA' }],
}
const anthropicMessages = ai.anthropicPayloadMessages([{ role: 'user', content: 'Look.' }], imageRequest)
assert.equal(anthropicMessages[0].content[0].type, 'text')
assert.equal(anthropicMessages[0].content[1].type, 'image')
assert.equal(anthropicMessages[0].content[1].source.media_type, 'image/png')

console.log('ai adapter tests ok')

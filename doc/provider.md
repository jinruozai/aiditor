# AI Provider System

The provider system connects the AI runtime to model backends.

It is split into:

```text
connection
auth driver
transport driver
provider helpers
request adapter
stream parser
```

## Connection

A connection is a named model backend configuration.

Implemented APIs:

```js
aiditor.ai.registerConnection(id, spec)
aiditor.ai.createCustomConnection(spec)
aiditor.ai.loadCustomConnections()
aiditor.ai.getConnection(id)
aiditor.ai.listConnections()
aiditor.ai.connectionOptions()
aiditor.ai.setActiveConnection(id)
aiditor.ai.getConnectionConfig(id, overrides)
aiditor.ai.connectionConfigKey(id, key)
aiditor.ai.modelHints(id)
aiditor.ai.refreshModels(id, overrides)
aiditor.ai.sendViaConnection(connectionId, request, context)
```

A connection points to an auth driver and a transport driver.

Connection state is exposed as lightweight signals so UI can render status
without polling:

```js
aiditor.ai.defaultConnection
aiditor.ai.connections
aiditor.ai.connectionModels(connectionId)
aiditor.ai.connectionStatus(connectionId)
aiditor.ai.connectionHealth
aiditor.ai.connectionHealthState(connectionId)
```

## Provider Capabilities

Connections expose a normalized capability view:

```js
aiditor.ai.connectionCapabilities(connectionId)
```

The default shape is:

```text
stream
toolProtocol       native | text | none
toolCalling
toolArguments      strict | structured | json | none
toolArgumentsFallback  structured | json | none
outputProtocol     native | text
reasoning
multimodal
maxInputTokens
local
```

`toolProtocol` is declared by the transport, not guessed from a provider or model
name. `toolCalling` is derived from it and is true unless the protocol is `none`.
`native` means the transport maps the provider's structured function/tool blocks
to AIditor's canonical tool-call shape. `text` is the explicit JSON envelope
fallback. `none` means no model-facing tools are exposed.

`toolArguments` is independent from `toolProtocol`:

```text
strict       the connection can constrain generation with each registered Tool schema
structured   the transport returns an already structured args value
json         the transport returns a JSON string parsed once by its adapter
none         Tool arguments are unavailable because Tool calling is unavailable
```

`toolProtocol: native` does not imply reliable arguments. A native envelope may
still carry best-effort JSON strings. A connection may declare `strict` only when
its transport implements schema-constrained Tool generation. The underlying
transport also declares its honest fallback (`structured` or `json`). A Tool
whose schema cannot be represented by the portable strict subset uses that
fallback for the request and exposes the actual mode on its request-local Tool
spec. No provider or model name is inspected at runtime to guess support.

Gateway Tools may produce multiple request-local model specs, but every
projection is forced to use that gateway as its internal executor. Model-facing
operation specs use the operation id and direct `inputSchema`; the hidden route
constructs the canonical `{ op, input }` executor arguments only after direct
validation. This lets each operation strict-compile independently without a
second registry or a wider permission surface. Runtime records the operation id
and direct input as the semantic ToolCall, while `executorToolId` and
`executorArgs` remain internal. Provider aliases are retained only to replay the
assistant Tool call in the original wire shape.

This is capability metadata, not a routing engine. The request builder includes
it on provider requests so tools, UI, and diagnostics can inspect the selected
connection without parsing provider ids or model names. Unsupported transports
must report `none`; capability flags must not pretend that a driver implements a
tool lifecycle it does not encode and decode.

`outputProtocol` describes structured final output separately from tool calling.
`native` lets the adapter use a provider JSON-schema wire format. `text` adds the
same provider-neutral final-output contract to model context and validates the
returned JSON in the runtime. Provider ids and model names are never used to
guess this capability.

## Auth Drivers

Implemented API:

```js
aiditor.ai.registerAuthDriver(type, driver)
aiditor.ai.authStatus(connectionId)
aiditor.ai.refreshAuthStatus(connectionId)
aiditor.ai.loginConnection(connectionId, options)
aiditor.ai.logoutConnection(connectionId)
```

Current auth driver types include:

```text
none
apiKey
localBridge
subscriptionBridge
```

## Transport Drivers

Implemented API:

```js
aiditor.ai.registerTransport(type, driver)
```

Current transport types include:

```text
mock
openai-compatible
anthropic
local-bridge
codex-bridge
```

Transport drivers declare `toolProtocol`, their argument representation, and
whether they implement strict Tool schemas. They return one canonical assistant
shape regardless of the provider:

```js
{
  role: 'assistant',
  content: '...',
  reasoning_content: '...',
  toolCalls: [{ id, toolId, args }],
  usage,
  finishReason,
}
```

OpenAI-compatible and Anthropic wire formats are adapter details. They must not
leak into the Agent Runtime.

The Runtime decodes every call in a response before it validates the batch and
executes nothing until every call is valid. Parseable failed arguments stay on
the semantic ToolCall for exact Provider replay. Diagnostics expose only a
bounded canonical summary and stable hash. Union-schema details are expanded
only for a uniquely tagged `const` or single-value `enum` branch; adapters do
not infer fields or repair argument JSON.

Streaming transports must classify Tool argument updates as `delta` or
`snapshot` before handing them to the shared merger. Prefix comparison is not a
protocol and must not be used to guess whether a provider sent an incremental
fragment or a cumulative snapshot.

## Reliability Contract

`sendViaConnection` applies one provider-neutral reliability policy around every
transport:

```js
aiditor.ai.registerConnection('service', {
  transport: { type: 'service' },
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 400,
    maxDelayMs: 4000,
    jitter: 0.2,
  },
})
```

Only errors explicitly marked `retryable` are retried. Built-in HTTP helpers mark
network failures, 408, 429, and 5xx responses as retryable and preserve
`status`, `code`, and `retryAfterMs`. Abort never retries. A response stream is
never replayed after its first chunk; stream failures update connection health
and propagate to the existing run failure path.

Connection health is diagnostic state:

```text
state                 unknown | healthy | degraded | rate_limited | offline
consecutiveFailures
lastSuccessAt
lastFailureAt
lastError             { code, message, status, retryable }
retryAfterMs
```

It is not a circuit breaker and does not make routing decisions. Hosts may show
the state or choose another connection, while the Agent Runtime remains
provider-neutral. Retry attempts emit compact `provider_retry` trace events.

## Streaming

Streaming is resolved once while building each provider request:

```text
effective stream = connection capability supports stream
                   AND connection config has not disabled stream
```

Agent records do not duplicate this setting. This keeps first-run delegation,
direct chat input, and persistence restore on the same transport path. A panel
may edit the selected Connection or its settings, but it must not make streaming
work by mutating transient Agent state.

Provider helpers support:

```js
aiditor.ai.provider.requestMaybeStream(url, options, extractDelta)
```

The stream path should emit text, reasoning text, tool call deltas, and usage as
soon as they are parsed. The UI should consume the runtime live state instead of
re-rendering the whole transcript for every chunk.

Stream parsers must tolerate partial chunks, empty keepalive chunks, late usage
metadata, and provider-specific reasoning/tool-call deltas. Parsed events should
carry `runId`, `requestId`, and provider timing metadata so UI, logs, and audit
records can be correlated.

## Request Adapter

Request assembly belongs to `src/ai/agent/request.js`: it builds the runtime,
workspace, task, context, attachment, memory, compaction, queue, and transcript
messages before a provider sees the request.

The adapter layer formats that assembled request for a provider. It converts
AIditor messages, images, tools, and text-tool fallbacks into provider payload
shapes without owning context selection policy.

Public tool ids remain dotted registry ids such as `agent.create`. Provider APIs
may require a restricted function name. The adapter therefore builds a stable,
collision-checked alias map for each request and uses the same map for request
schemas, assistant tool calls, replay, and response decoding. Aliases are wire
identifiers only; permission checks, execution, logs, and UI always use the
public tool id.

When provider output uses an alias, Runtime resolves it against registered Tool
ids. One unique candidate is restored to its canonical id; multiple candidates
remain ambiguous and must never be guessed. This is wire-name decoding, not a
request Tool-surface authorization check.

Tool schemas are normalized and validated when tools are registered. An object
schema with `required` entries must define matching `properties`; invalid schemas
are rejected before a provider request is made.

For a strict-capable connection, the request adapter derives a provider schema
from the registered Tool schema. Object properties are closed, optional
properties use a nullable wire representation where required by strict APIs,
and discriminated object unions remain constrained alternatives. The adapter
removes only the nullable wire placeholders it introduced; it does not coerce or
recursively parse field values. The Runtime then validates canonical `args`
against the original registered schema before any Tool executes.

## Structured Final Output

An Agent may define a provider-neutral JSON schema in `outputSchema`. Request
assembly adds a final-output instruction, adapters optionally select a native
provider format, and the runtime always parses and validates the final assistant
reply. Intermediate assistant turns containing tool calls are not final output.

```js
const agent = aiditor.ai.createAgent({
  outputSchema: {
    type: 'object',
    required: ['answer'],
    properties: { answer: { type: 'string' } },
  },
})
```

Validated data is stored in `message.output` and returned as
`quest.result(...).output`. Raw JSON text remains in `message.content` for
transcript and diagnostics. Malformed JSON fails with `OUTPUT_JSON_INVALID`;
schema mismatch fails with `OUTPUT_SCHEMA_INVALID`. The runtime accepts plain
JSON or one complete `json` fenced block, but does not extract JSON from prose.

Implemented helpers include:

```js
aiditor.ai.messageText(content)
aiditor.ai.openAiMessages(messages, request)
aiditor.ai.openAiTools(request)
aiditor.ai.normalizeOpenAiToolCalls(calls, request)
aiditor.ai.anthropicPayloadMessages(messages, request)
aiditor.ai.anthropicTools(request)
aiditor.ai.normalizeAnthropicContent(content, request)
aiditor.ai.anthropicSystem(messages)
aiditor.ai.encodeTextToolRequest(request)
aiditor.ai.decodeTextToolResponse(result)
```

The text tool protocol is a fallback for models or transports that do not expose
native function calling. It is enabled only by a transport that declares
`toolProtocol: 'text'`.

Text that merely resembles a tool call, such as `<invoke ...>`, is never parsed
and executed by a native transport. When a native-tool request returns explicit
tool-invocation markup without structured tool calls, the runtime reports
`TOOL_PROTOCOL_INVALID` and keeps the raw assistant text for diagnosis. This
prevents prompt text from becoming an execution channel.

## Provider Completion

The Agent Runtime classifies normalized `finishReason` values into:

```text
complete       normal stop or end turn
tool           provider stopped for structured tool calls
truncated      output token/length limit
blocked        provider content policy rejected the output
interrupted    provider or service stopped before completion
unknown        provider-specific reason not known to the runtime
```

`truncated`, `blocked`, and `interrupted` are failures with stable error codes;
they are not rendered as successful idle turns. A tool finish reason without
structured tool calls is also a protocol failure. Unknown reasons remain visible
in message metadata and trace events so adapters can be corrected without losing
the provider evidence.

## Usage And Cost

The provider helper can estimate usage cost for known providers:

```js
aiditor.ai.estimateUsageCost(provider, model, usage)
```

Cost estimation is optional metadata. The runtime should still operate when no
price information is available.

Hosts may set request budgets such as maximum tokens, maximum cost estimate, or
maximum wall-clock duration. Budget stops are run failures, not silent truncation.

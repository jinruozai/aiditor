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
```

## Provider Capabilities

Connections expose a normalized capability view:

```js
aiditor.ai.connectionCapabilities(connectionId)
```

The default shape is:

```text
stream
toolCalling
reasoning
multimodal
maxInputTokens
local
```

This is provider metadata, not a routing engine. The request builder includes it
on provider requests so tools, UI, and diagnostics can inspect what the selected
connection claims to support without parsing provider ids or model names.

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

Transport drivers send normalized requests and return normalized assistant
messages, tool calls, usage, and streaming deltas.

## Reliability Contract

Every transport should expose the same operational contract:

```text
timeoutMs
abort
retryPolicy
rateLimitState
capabilities
health
lastError
```

Retries must be bounded and should respect provider status codes such as 429.
Abort must stop local parsing and prevent late chunks from mutating the finished
run. Capability and model discovery may be cached, but cache entries need an
explicit refresh path.

## Streaming

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

Request assembly belongs to `src/ai/request.js`: it builds the runtime,
workspace, task, context, attachment, memory, compaction, queue, and transcript
messages before a provider sees the request.

The adapter layer formats that assembled request for a provider. It converts
AIditor messages, images, tools, and text-tool fallbacks into provider payload
shapes without owning context selection policy.

Implemented helpers include:

```js
aiditor.ai.messageText(content)
aiditor.ai.openAiMessages(messages, request)
aiditor.ai.openAiTools(request)
aiditor.ai.normalizeOpenAiToolCalls(calls, request)
aiditor.ai.anthropicPayloadMessages(messages, request)
aiditor.ai.anthropicSystem(messages)
aiditor.ai.encodeTextToolRequest(request)
aiditor.ai.decodeTextToolResponse(result)
```

The text tool protocol is a fallback for models or transports that do not expose
native function calling.

## Usage And Cost

The provider helper can estimate usage cost for known providers:

```js
aiditor.ai.estimateUsageCost(provider, model, usage)
```

Cost estimation is optional metadata. The runtime should still operate when no
price information is available.

Hosts may set request budgets such as maximum tokens, maximum cost estimate, or
maximum wall-clock duration. Budget stops are run failures, not silent truncation.

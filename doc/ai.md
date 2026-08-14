# AI Architecture

## Purpose

The optional AI Host lets agents talk to the user, read precise context, and ask
the host to run controlled actions. It is not part of the Core/UI kernel, and it
does not own product data models.

The design target is strong agentic editor behavior without a large editor
platform inside Core. Host apps teach the model through references, tools,
operations, skills, and normal registered UI components. They do not get a
private AI path.

Any AIditor module can contribute to AI by registering tools, context
references, or operations. `workspace.*`, `theme.*`, `dock.*`, `ui.*`, extension
prefixes, and product prefixes all use the same registries.

Skills are agent behavior profiles. They add prompt guidance and rules to an
agent; they are not tools, context references, or operations.

Generated API references are the exact-call companion to skills. Structured
comments in `src/` generate `doc/api`, `dist/aiditor-api.json`, and runtime
`aiditor://api/...` references. Skills may explain when to use a concept, but
agents should read generated API references before calling unfamiliar framework
APIs.

Skills are discoverable too. `aiditor://skills` lists registered skills and
when to use them; concrete skill URIs contain the full rules. This keeps the
default prompt small while still letting agents choose the correct AIditor
workflow.

## Public Concept Model

Expose six concepts at the architecture level:

```text
Agent             conversation, memory, runtime state
Skill             discoverable focused capability
Tool              Skill-owned executable action
Context Reference stable pointer to bounded readable context
Operation         previewable/applyable mutation
ChangeSet         grouped review/apply container
```

Targets, attachments, rich prompt ranges, quests, and inboxes are runtime or
UX details. They may have APIs, but they should not
become new architectural layers.

## Context Flow

AI uses one context flow:

```text
user points at thing -> Context Reference -> bounded Context
```

A reference is stable enough to put in chat or prompt data. Context providers
resolve references into bounded readable content for the model. Large data must
expose search, summaries, ranges, schemas, or projections instead of injecting
everything into the prompt.

Reference reads use the same request actor and permission context as tools. A
context provider may describe where to look, but exact mutable state should be
read through a bounded reference or tool before the model edits it.

## Tools

A tool is an action the model can call.

Examples:

```text
workspace.searchFiles
workspace.readText
workspace.editText
workspace.patchText
workspace.mkdir
workspace.copy
workspace.move
workspace.delete
theme.setMode
ui.setProp
gde.table.patchRows
```

Target API:

```js
aiditor.ai.tools.register(name, spec, meta)
aiditor.ai.tools.unregister(name, { owner })
aiditor.ai.tools.unregisterOwner(owner)
aiditor.ai.tools.get(name)
aiditor.ai.tools.list(prefix)
```

Tool names use dotted paths. Prefixes are public grouping. Extension lifecycle
cleanup uses owner metadata for exact removal.

The request builder sends only model-visible and currently available tools to
the provider:

```js
aiditor.ai.tools.register('workspace.readText', {
  available: function () { return !!aiditor.ai.currentWorkspace() },
  run: readText,
})
```

Low-level host escape hatches can stay registered for framework code while being
kept out of normal model requests with `exposeToModel: false`.

### Tool Argument Transport

`ToolCall.toolId` and `ToolCall.args` are the model-visible semantic Tool identity
and its canonical structured JSON input. Provider adapters decode the wire
protocol exactly once:

- OpenAI-compatible string `function.arguments` values are parsed once as JSON.
- Already structured `args` or `arguments` values pass through unchanged.
- Text-tool envelopes are parsed once; their nested `args` value is not parsed
  again.
- Streaming string fragments are concatenated, while cumulative string snapshots
  replace their previous prefix instead of being appended again. A structured
  streaming value is a complete snapshot and replaces the previous value.

Transport normalization marks string updates as `argumentUpdate: "delta"` or
`"snapshot"`. The shared merger follows that marker and never guesses update
semantics from string prefixes.

Adapters and bridges must not recursively parse JSON-looking strings, coerce
values according to field names, wrap malformed input in guessed objects, or add
domain-specific conversions. JSON strings remain strings even when their content
looks like an object or array.

Request-local projections may route a semantic Tool to an internal registered
executor. In that case `executorToolId` and `executorArgs` are Runtime-only
fields. Transcript UI, Tool Results, parameter diagnostics, traces, permission
audit, and provider replay continue to use the semantic `toolId` and `args`.

Connections describe Tool arguments separately from the Tool envelope:

```text
strict       provider generation is constrained by the request-local Tool schema
structured   adapter receives a structured value without a syntax guarantee from AIditor
json         adapter parses one best-effort JSON string
none         no Tool calling
```

`toolProtocol: native` is not a reliability claim. Strict-capable connections
compile each compatible request-local Tool schema into the provider's strict
wire shape. Incompatible schemas remain available through the transport's
honest fallback mode and are marked accordingly; the Host never pretends they
are strict. Pure `null`, nullable type declarations, and explicit nullable
`anyOf` branches retain their meaning. Optional non-null fields use nullable
wire placeholders which are removed at the adapter boundary; explicitly
nullable values are preserved. The original registered schema remains
authoritative.

Tool argument decoding and schema validation form one batch barrier: the Host
finishes normalizing and validating every call in a provider response before it
executes any Tool. Invalid JSON fails with `TOOL_ARGUMENTS_INVALID_JSON`;
structured data that misses the registered schema fails with
`TOOL_ARGUMENTS_SCHEMA_INVALID`. Either failure executes zero calls from the
batch. Parseable structured arguments remain attached to the failed ToolCall so
the next Provider request can replay the actual call; malformed JSON has no
invented argument object. Error metadata and traces contain only a bounded
canonical summary and stable argument hash, never the full argument payload.

Tool argument correction has one run-scoped budget, configured by
`maxToolArgumentCorrections` and defaulting to two. When every failed call has a
compiled strict schema, the first correction may be a hidden constrained request
that exposes exactly the original Tool-call set. Otherwise the Host records the
whole zero-execution batch as failed Tool calls, appends structured Tool Results,
and lets the model correct the call through the ordinary continuation path.
`json` and `structured` modes therefore remain honestly best-effort, but a
model-correctable argument error does not immediately terminate the run.

The correction state belongs to the current run, not a Tool or project. Its
fingerprint includes the Tool id, canonical argument hash, and concrete error
result. Only an identical Tool, argument value, and validation failure counts as
a repeat; a different argument may continue within the same bounded budget. An
exhausted budget terminates the turn. Network, authentication, cancellation,
provider completion, and run-budget errors never enter this correction path.
The Host does not repair JSON, recurse into JSON-looking strings, or infer
business fields.

A successful hidden recovery enters the ordinary Tool lifecycle exactly once
and emits `tool_arguments_recovery_started` /
`tool_arguments_recovery_completed` trace events without creating transcript or
log noise. A model-visible correction emits
`tool_arguments_correction_requested`; each failed call receives a Tool Result
with `code`, `toolName`, `callId`, `argumentMode`, `message`, `retryable`, and a
schema `path`/`keyword` or JSON `parsePosition`. Other calls in the same batch receive
`TOOL_BATCH_ABORTED`, because none were executed.

Final malformed-argument diagnostics are bounded and include Tool name, provider
call id, argument length, native parse position (`null` when the JavaScript
runtime does not report one), snippet offset, and a short source snippet. The
full malformed payload is not copied into trace or error metadata. Diagnostics
also include the effective argument mode, `recoveryAttempted`, `retryable`, and
the terminal correction reason/count when applicable. Schema errors include the
failing path, keyword, validation message, argument hash, and bounded canonical
summary. `oneOf` validation distinguishes no matching branch from multiple
matching branches. For object unions whose branches all declare one unique
`const` or single-value `enum` discriminator, validation reports the selected
branch's concrete `required`, `enum`, `type`, `minItems`, or
`additionalProperties` error. Ambiguous unions remain a generic union error
instead of guessing a business shape. Discriminator candidates are derived from
the Schema, not the input object's field order; a property missing from any
branch simply disqualifies that candidate. A valid registered Schema therefore
returns validation errors for arbitrary JSON Tool arguments instead of throwing
from union selection. Schema and argument fields use own-property lookup, so
legal JSON names such as `constructor` or `__proto__` neither read nor mutate the
JavaScript object prototype.

The local bridge transports the request and response envelopes through ordinary
JSON serialization. It may adapt the provider envelope, but it does not interpret
fields inside Tool arguments. Business validation remains with the registered
Tool schema and Tool implementation.

## Context References

Context references are stable pointers plus provider-backed readers.

Examples:

```text
selection.current
ui.componentCatalog
ui.panelState
workspace.fileSummary
gde.tableSchema
```

Target API:

```js
aiditor.ai.context.register(name, spec, meta)
aiditor.ai.context.unregister(name, { owner })
aiditor.ai.context.unregisterOwner(owner)
aiditor.ai.context.get(name)
aiditor.ai.context.list(prefix)
```

The API name is `context`; the public concept is "Context Reference" because
what the model sees should be bounded content, not an unbounded resource dump.

## Operations

An operation is a previewable change.

Examples:

```text
ui.setProp
dock.closePanel
theme.updateToken
gde.table.updateRows
ani.timeline.moveKeys
```

Target API:

```js
aiditor.ai.operations.register(name, spec, meta)
aiditor.ai.operations.unregister(name, { owner })
aiditor.ai.operations.unregisterOwner(owner)
aiditor.ai.operations.get(name)
aiditor.ai.operations.list(prefix)
aiditor.ai.operations.preview(name, input)
aiditor.ai.operations.apply(preview)
```

Operations are for changes that need validation, preview, review UI, host
history integration, or resource-version checks.

An operation has one stable input contract:

```js
aiditor.ai.operations.register('game.patch', {
  title: 'Patch game data',
  exposeToModel: true,
  available: function (ctx) { return !!ctx.workspace },
  inputSchema: {
    type: 'object',
    required: ['target', 'patch'],
    additionalProperties: false,
    properties: {
      target: { type: 'string' },
      patch: { type: 'object' },
    },
  },
  preview: function (input, ctx) {},
  apply: function (preview, ctx) {},
})
```

`inputSchema` is the only operation-input schema field. Model exposure is an
explicit opt-in: `exposeToModel: true` requires `inputSchema`, a preview function,
and an apply function. Operations without that flag remain available to trusted
host code but never enter the model surface.

`aiditor.previewOperation` and `aiditor.applyOperation` are canonical execution
gateways, not model Tools or operation catalogs. When the hidden apply gateway is
present in the effective capability set, the request builder projects every
model-exposed, currently available operation as one direct request-local Tool:

```text
example.domain.patch(<operation input>)
```

The Tool id is the operation id and its parameter schema is `inputSchema`
itself. The model never receives gateway names, `{ input }` wrappers,
`previewId`, or canonical routing fields. Each operation is strict-compiled
independently, so one incompatible schema falls back only for that operation and
cannot downgrade its siblings.

Runtime validates the direct input, preserves the operation id in the ToolCall,
then privately invokes `aiditor.applyOperation` with `{ op, input }`. That single
executor still owns preview, permission, approval, transaction, apply, history,
and audit. The projection cannot select a different executor and never becomes a
registry entry or second project API. Registration and `available(ctx)` changes
take effect on the next request. Provider name aliases are transport-only and
map transparently back to the original operation id. Duplicate model-visible ids
are rejected while building the request.

`aiditor.previewOperation` and preview-id application remain trusted host
programming APIs. They are not projected into the model surface, and a preview
id never widens permission or availability.

The framework validates operation input against `inputSchema` before calling the
host preview function. Validation paths are rooted directly at the operation
input, such as `$.patches[0]`, without an internal `$.input` prefix. This is
structural JSON Schema validation only; domain
rules, resource versions, permissions, history, and transaction policy remain
host responsibilities. Unknown or unavailable model operations return bounded
structured results with a stable code and `allowedValues`; low-level
`aiditor.ai.operations.preview()` still throws for an unregistered operation,
because that path is a trusted developer API.

AI registries reject duplicate names by default. Use `{ replace: true }` in the
registration metadata only when replacing an existing contribution is deliberate.

Workspace file-system review is a Core workspace concern, not a second AI
operation protocol. `workspace.previewOperation` and
`workspace.applyOperation` define generic file mutation semantics. AI operations
and tools may wrap those previews, but they must not redefine workspace conflict
rules.

Any low-level host bridge helpers should be hidden from normal model requests
unless a host has a specific reason to expose them.

## ChangeSet

`ChangeSet` is review infrastructure, not a fourth registry.

```text
Operation  one previewable action
ChangeSet  grouped review/apply container for many changes
```

Use operations for the model-facing preview/apply contract. Use ChangeSet when
the UI needs to review, apply, reject, audit, or persist several changes
together.

## Permissions

Permissions apply at every model-controlled boundary:

```text
tool run
operation preview/apply
ChangeSet apply
workspace mutation
extension install/update
host-adapter call
```

All decisions go through the unified resolver described in
[ai-permission-policy.md](./ai-permission-policy.md). Full access means the
resolver has already allowed that action for that actor, target, phase, and
scope; failed actions must never show apply controls.

## Streaming

Provider streaming and UI rendering are separate.

The provider adapter emits events as soon as bytes or parsed deltas arrive. The
message panel renders a lightweight live preview and updates the full transcript
at a controlled cadence.

The user should always be able to distinguish:

```text
waiting for provider
receiving text
receiving reasoning
receiving tool call arguments
running tool
waiting for user approval
done
failed
```

## Persistence

AI runtime persistence belongs to the optional AI Host. IndexedDB stores the
complete JSON-safe Agent transcript and runtime records; `localStorage` stores
only a small synchronous Agent bootstrap manifest. It does not store project
truth, workspace files, or editor history.

Model context compaction is a separate request-assembly concern and never
removes transcript rows shown in the UI. The persistence contract is defined in
[ai-persistence.md](./ai-persistence.md).

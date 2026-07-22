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

Expose only five concepts at the architecture level:

```text
Agent             conversation, memory, runtime state
Tool              model-callable action
Context Reference stable pointer to bounded readable context
Operation         previewable/applyable mutation
ChangeSet         grouped review/apply container
```

Targets, attachments, rich prompt ranges, quests, inboxes, bundles, and
templates are runtime or UX details. They may have APIs, but they should not
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
aiditor.ai.tools.unregister(name)
aiditor.ai.tools.unregisterOwner(owner)
aiditor.ai.tools.unregisterPrefix(prefix)
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

`ToolCall.args` is the canonical structured JSON value. Provider adapters decode
the wire protocol exactly once:

- OpenAI-compatible string `function.arguments` values are parsed once as JSON.
- Already structured `args` or `arguments` values pass through unchanged.
- Text-tool envelopes are parsed once; their nested `args` value is not parsed
  again.
- Streaming string fragments are concatenated. A structured streaming value is
  a complete snapshot and replaces the previous value.

Adapters and bridges must not recursively parse JSON-looking strings, coerce
values according to field names, wrap malformed input in guessed objects, or add
domain-specific conversions. JSON strings remain strings even when their content
looks like an object or array. Invalid wire JSON fails with
`TOOL_ARGUMENTS_INVALID_JSON`, and the Tool is not executed.

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
aiditor.ai.context.unregister(name, meta)
aiditor.ai.context.unregisterOwner(owner)
aiditor.ai.context.unregisterPrefix(prefix)
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
aiditor.ai.operations.unregister(name)
aiditor.ai.operations.unregisterOwner(owner)
aiditor.ai.operations.unregisterPrefix(prefix)
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
explicit opt-in: `exposeToModel: true` requires `inputSchema`; operations without
that flag remain available to trusted host code but never enter the model
gateway.

`aiditor.previewOperation` and `aiditor.applyOperation` are model gateways, not
operation catalogs. For each provider request, the request builder derives their
schema from operations that are both model-exposed and currently available. Each
operation becomes an exact `oneOf` branch with a single-value `op` enum and its
registered `inputSchema`. `applyOperation` additionally accepts the `previewId`
returned by an earlier preview. Registration changes and `available(ctx)` changes
therefore take effect on the next request without mutating a global tool schema.
Resolving or applying a `previewId` rechecks current model visibility and apply
permission; a preview id never widens the model's capability surface.

The framework validates operation input against `inputSchema` before calling the
host preview function. This is structural JSON Schema validation only; domain
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

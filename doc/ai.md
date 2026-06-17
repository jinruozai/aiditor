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

AI runtime persistence belongs to the optional AI Host. It stores bounded
recoverable agent state so a reload can restore agents, recent messages, active
agent selection, queues, quests, attachments, and compact tool-call history.

It does not store project truth, workspace files, editor history, or full
transcript archives in `localStorage`. The bounded local persistence contract is
defined in [ai-persistence.md](./ai-persistence.md).

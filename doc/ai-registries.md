# AI Registries

This document describes the registry shape used by the current implementation.

## Registry Shape

AI has three primary registries:

```text
tools
context
operations
```

No new model-facing registry should be added for attachments, references, or
skills.

Skills are separate from these registries. They shape agent behavior and prompt
rules, but they do not execute actions, read context, or apply changes.

Public API:

```js
aiditor.ai.tools.register(name, spec, meta)
aiditor.ai.tools.unregister(name)
aiditor.ai.tools.unregisterOwner(owner)
aiditor.ai.tools.unregisterPrefix(prefix)
aiditor.ai.tools.get(name)
aiditor.ai.tools.list(prefix)
aiditor.ai.tools.visible(name, requestContext, explicit)
aiditor.ai.tools.visibleList(names, requestContext, explicit)
aiditor.ai.tools.meta(name)

aiditor.ai.context.register(name, spec, meta)
aiditor.ai.context.unregister(name, meta)
aiditor.ai.context.unregisterOwner(owner)
aiditor.ai.context.unregisterPrefix(prefix)
aiditor.ai.context.get(name)
aiditor.ai.context.list(prefix)
aiditor.ai.context.meta(name)

aiditor.ai.operations.register(name, spec, meta)
aiditor.ai.operations.unregister(name, meta)
aiditor.ai.operations.unregisterOwner(owner)
aiditor.ai.operations.unregisterPrefix(prefix)
aiditor.ai.operations.get(name)
aiditor.ai.operations.list(prefixOrFilter)
aiditor.ai.operations.meta(name)
aiditor.ai.operations.risk(name, input, ctx)
aiditor.ai.operations.preview(name, input, ctx)
aiditor.ai.operations.apply(preview, ctx)
aiditor.ai.operations.getPreview(id)
```

Dotted names are the public grouping mechanism. Owner metadata is the exact
lifecycle key for installed extension contributions.

Registry registration is conservative: registering an existing name throws.
Callers must pass `meta.replace === true` to intentionally replace an entry.
That keeps host code from silently shadowing built-in tools, context providers,
reference providers, operations, skills, templates, or bundles.

Modules do not get separate AI channels. A module exposes model-facing behavior
by contributing named registry entries:

```text
workspace module -> workspace.* tools
theme module     -> theme.* tools / context
dock module      -> dock.* tools / operations
ui module        -> ui.* tools / context / operations
domain code      -> domain-prefix.* tools / context / operations
```

## Tool Registry

There is one tool facade:

```js
aiditor.ai.tools.register(name, spec, meta)
aiditor.ai.tools.unregister(name, meta)
aiditor.ai.tools.unregisterOwner(owner)
aiditor.ai.tools.unregisterPrefix(prefix)
aiditor.ai.tools.get(name)
aiditor.ai.tools.visible(name, requestContext, explicit)
aiditor.ai.tools.visibleList(names, requestContext, explicit)
aiditor.ai.tools.list(prefix)
aiditor.ai.tools.meta(name)
```

Do not create a second tool registry. New framework code should use
`aiditor.ai.tools.*`.

`meta.owner` and `meta.layer` may exist for diagnostics and safety checks.
`meta.replace === true` is the only overwrite path.
Extension lifecycle cleanup uses `unregisterOwner(owner)` so nested extension
ids such as `sample` and `sample.child` can coexist safely. Prefix cleanup
remains a low-level helper for plain dotted registries.

Built-in tool prefixes:

```text
workspace.*
code.*
git.*
verify.*
aiditor.*
agent.*
quest.*
message.*
```

`git.*` and `verify.*` are optional host-adapter prefixes. They should only be
registered when their adapter is configured, so the model never sees unavailable
tools.

Tool specs may also expose two model-visibility fields:

```js
{
  available: function (requestContext) { return true },
  exposeToModel: false,
}
```

`available` is for runtime state such as "a workspace is currently open".
`exposeToModel: false` is for low-level host escape hatches that remain callable
by framework code but should not appear in normal model requests. Direct
registry access is unchanged; the visibility rule only decides what the request
builder sends to the provider.

Tool specs also have a normalized capability view:

```js
aiditor.ai.tools.capabilities(name)
```

The returned shape is diagnostic/runtime metadata:

```text
preview
run
apply
mutates
read
write
delete
execute
network
install
idempotent
requiresApproval
risk
permissions
```

Capabilities do not create a second permission system and do not execute
anything. They let request assembly, trace/debug UI, approval surfaces, and host
policy code speak about the same tool without reverse-engineering whether it has
`preview`, `run`, or `apply` functions.

## Context, Reference, Target

Definitions:

```text
Context
  A registered readable model-context provider.

Reference
  A normalized pointer to one concrete thing, usually a URI plus kind and meta.

Target
  A user-facing attachable thing. When sent to chat, it becomes one or more
  references.
```

So the flow is:

```text
user action -> target -> reference -> context read/tool call
```

`context` is the registry. `references` is the pointer protocol. `targets` is the
interaction surface.

New API should use the name `context`, not `resources`.

Everything else should fold into that flow:

```text
attachment      runtime chat/session state
rich prompt ref inline reference inside message text
```

These are useful implementation pieces, not new architecture categories.

## References And Context

There are two related pieces:

1. `aiditor.ai.attachments` is a signal containing attached chat/session items.
2. `aiditor.ai.references` is a provider registry for readable editor
   references.

The public runtime attachment name is `attachments`; do not reintroduce
`resources` for chat attachments.

Public split:

```text
aiditor.ai.attachments      // runtime attached items in chat/session
aiditor.ai.context          // registry of readable model-context providers
aiditor.ai.references       // normalized reference protocol
```

Reference APIs:

```js
aiditor.ai.references.register(name, provider, meta)
aiditor.ai.references.unregister(name, meta)
aiditor.ai.references.unregisterOwner(owner)
aiditor.ai.references.unregisterPrefix(prefix)
aiditor.ai.references.get(name)
aiditor.ai.references.list(filter)
aiditor.ai.references.meta(name)
aiditor.ai.references.normalize(ref)
aiditor.ai.references.normalizeAll(refs)
aiditor.ai.references.describe(ref)
aiditor.ai.references.read(ref, options, ctx)
aiditor.ai.references.schema(ref, ctx)
aiditor.ai.references.capabilities(ref, ctx)
aiditor.ai.references.snapshot(ref, ctx)
aiditor.ai.references.search(query, ctx)
aiditor.ai.references.selection(ctx)
```

Reference providers receive the current request/tool context, including actor
and permission helpers. Providers should use that context when they expose
non-public editor or workspace state.

The reference protocol is valuable and should not be lost. It should remain a
small pointer/helper protocol under the context flow, not a competing registry
concept.

Reference providers, target providers, and rich prompt refs all support one
user-facing idea:

```text
the user points at something -> the model can read the right context
```

Keep that idea unified: UI selection and rich prompt helpers should always
produce normalized references that can be read through the reference protocol.

## Operations

Public operation API:

```js
aiditor.ai.operations.register(name, spec, meta)
aiditor.ai.operations.unregister(name, meta)
aiditor.ai.operations.unregisterOwner(owner)
aiditor.ai.operations.unregisterPrefix(prefix)
aiditor.ai.operations.get(name)
aiditor.ai.operations.list(prefixOrFilter)
aiditor.ai.operations.meta(name)
aiditor.ai.operations.risk(name, input, ctx)
aiditor.ai.operations.preview(name, input, ctx)
aiditor.ai.operations.apply(preview, ctx)
aiditor.ai.operations.getPreview(id)
```

Operations support validation, risk, preview storage, apply, and host history
integration.

Preview stores a reviewable operation preview. Apply consumes that preview and
returns the operation result.

Workspace file operations use the Core workspace review contract described in
[workspace-v2.md](./workspace-v2.md). AI operations may wrap workspace previews,
but they do not define separate file-system conflict semantics.

## Targets

Targets are things users can add to chat.

Implemented APIs:

```js
aiditor.ai.registerTargetProvider(name, provider)
aiditor.ai.getTargetProvider(name)
aiditor.ai.listTargetProviders()
aiditor.ai.captureTarget(input)
aiditor.ai.normalizeTarget(input)
aiditor.ai.addTarget(target)
aiditor.ai.attachTargetToAgent(agentId, target)
aiditor.ai.attachTargetsToAgent(agentId, targets)
aiditor.ai.addTargetsToChat(targets)
aiditor.ai.attach(el, targetOrFn, options)
aiditor.ai.installTargetDrop(el, options)
aiditor.ai.readTargetFromDragEvent(event)
aiditor.ai.writeTargetDragData(event, targets)
aiditor.ai.fileToTarget(file)
```

This is the implemented "add to chat" foundation. It must stay as a first-class
part of the AI layer implementation. Architecturally it belongs to the Context
Reference UX flow, not to the public five-concept model in [ai.md](./ai.md).

## Rich Prompt

`aiditor.ai.richPrompt` stores inline references inside text.

Inline reference tokens store `refId`; `resourceId` is not part of the final
schema.

Implemented APIs:

```js
aiditor.ai.richPrompt.empty()
aiditor.ai.richPrompt.normalize(draft)
aiditor.ai.richPrompt.insertText(draft, index, text)
aiditor.ai.richPrompt.insertRef(draft, index, reference)
aiditor.ai.richPrompt.insertRefs(draft, index, references)
aiditor.ai.richPrompt.deleteRange(draft, start, end)
aiditor.ai.richPrompt.slice(draft, start, end)
aiditor.ai.richPrompt.refs(draft)
aiditor.ai.richPrompt.toPlainText(draft)
aiditor.ai.richPrompt.toModelText(draft)
aiditor.ai.richPrompt.content(draft)
aiditor.ai.richPrompt.fromContent(value)
```

Rich prompt is a UI/data helper for message composition. It is not a separate
AI registry category.

## Change Set

`aiditor.changeSet` provides grouped reviewable changes.

Implemented APIs:

```js
aiditor.changeSet.items
aiditor.changeSet.create(input)
aiditor.changeSet.update(id, patch)
aiditor.changeSet.find(id)
aiditor.changeSet.list()
aiditor.changeSet.normalize(input)
aiditor.changeSet.isChangeSet(value)
aiditor.changeSet.apply(idOrSet, scope, actor)
aiditor.changeSet.reject(idOrSet, scope, actor)
aiditor.changeSet.registerAdapter(name, adapter)
aiditor.changeSet.getAdapter(name)
aiditor.changeSet.registerRenderer(name, renderer)
aiditor.changeSet.getRenderer(name)
aiditor.changeSet.rendererFor(change, resource, set)
```

Design relationship:

- Operation: one previewable action.
- ChangeSet: review UI and grouped application for many changes/targets.

ChangeSet should remain because it solves grouped review and partial apply.
When `aiditor.ai.canUseChangeSet` is available, applying a ChangeSet goes
through the unified permission resolver before the adapter runs. The permission
target is `source.agentId`, `meta.agentId`, or the actor when no owner agent is
recorded.

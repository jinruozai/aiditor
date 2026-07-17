# AI Context Assembly

This document defines how AIditor builds one provider request from an agent
transcript. It is an internal request-building contract, not a new public
registry.

## Principle

The transcript is the source of truth. A provider request is a budgeted view of
that transcript plus current runtime context.

The model should receive:

```text
enough structure to choose the right tool
not enough bulk data to drown the task
```

Exact files, rows, panels, logs, and tool results should enter by reference,
search, or range reads before they enter as full text.

For workspace-backed code work, the preferred Agent-Computer Interface flow is:

```text
workspace.fileSummary or code.map({ query })
workspace.searchFiles when exact text matters
workspace.readTextRange for the precise current range
workspace.editText / patchText / writeText with baseHash
verify.run / verify.diagnostics when available
```

See [ai-agent-computer-interface.md](./ai-agent-computer-interface.md).

## Context Pack

Every provider request also exposes a compact `contextPack` summary:

```js
{
  version: 1,
  items: [
    {
      id,
      kind,
      layer,
      title,
      summary,
      uri,
      source,
      priority,
      tokenEstimate,
      stale,
      meta
    }
  ],
  totalTokenEstimate
}
```

The pack is built from the same system context cards that are sent to the
provider. It is diagnostic and inspectable runtime state, not another registry
and not a second prompt channel. It lets UI, trace, and tests explain which
context layers were included without parsing the final provider messages.

## Context Layers

AIditor assembles context in this order:

```text
runtime        current AI runtime rules and active skills
workspace      current workspace boundary and recommended file workflow
task           current permission/queue/task state
skills         bounded child-skill catalog when orchestration is active
context        compact runtime context providers
attachments    user-attached references and selected editor objects
memory         durable agent memory
compaction     summaries of older closed transcript ranges
inbox          completed child-agent events waiting for this turn
queue          queued user messages behind this turn
transcript     budgeted recent raw transcript groups
input          current user message, preserved raw
```

These are request layers, not new APIs. Modules still contribute through the
existing registries:

```text
skills      behavior rules
context     compact runtime context providers
references  readable object pointers
tools       actions and exact reads
operations  preview/apply changes
```

Request construction resolves capabilities before serializing schemas:

```text
capture base request context
  -> resolve explicit and auto skills
  -> collect compact runtime context
  -> union agent.toolRefs + activeSkill.tools + runtimeContext.tools
  -> filter by tool.available
  -> serialize only the effective tool schemas
  -> assemble context cards and transcript
```

An empty `agent.toolRefs` no longer means every registered tool. An agent with
no active skill, direct tool, or context-contributed tool receives no model
tools. Exposure is not permission: every resulting call still passes through
the permission resolver.

## Budget Rules

Each system layer should be compact by default:

```text
runtime/workspace/task cards     short guidance and current state
attachments                      summaries plus references
memory/compaction                summaries with ids and changed refs
tool arguments/results           compacted, never full generated files by default
transcript                       recent raw groups only
```

The builder preserves tool-call groups. An assistant message with tool calls is
never included without its matching tool result messages.

## Workspace Context

When a workspace is bound and at least one workspace/code/verification tool is
effective for the current request, the request includes a small workspace card:

```text
workspace id / label / kind
recommended flow:
  fileSummary / code.map
  searchFiles
  readTextRange
  editText or writeText
  verify.run when available
```

No global `NO_CURRENT_AI_WORKSPACE` warning is injected into unrelated chat.
For durable UI authoring requests, the auto-activated authoring skill and one
compact blocker card tell the model that the user must open or select a
workspace. Workspace binding remains a host action.

## Task State

The task card summarizes volatile run state only when a quest, continuation,
queue, or current blocker makes that state relevant:

```text
permission mode
visible tool count and important tool prefixes
queued message count
turn number
current input id
```

This helps the model distinguish "the API is silent" from "the runtime is
working with restricted tools".

## Runtime Context Providers

`aiditor.ai.context` providers remain compact contributors. They are useful for
active selection, panel health, current schema, diagnostics, or host-specific
navigation hints.

Context provider output is navigation context, not source of truth. Before
modifying data, the model should call the relevant read/search tool to get exact
current content and version.

Attachment and reference resolution uses the same actor as the current request.
If `attachments.read` or an equivalent host policy denies access, the request
must omit both the readable value and the identifying descriptor for that
attachment.

## Invariants

1. No project concept is introduced.
2. Context assembly never bypasses permissions.
3. Current runtime state overrides older transcript claims.
4. Whole files and large tool outputs are not injected by default.
5. Workspace precision still comes from `searchFiles`, `readTextRange`, and
   `editText`.
6. Old history is summarized only at safe scheduler points.

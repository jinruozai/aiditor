# AI Context And Compaction

This document defines how AIditor keeps long agent sessions useful without
making every request carry the whole transcript.

The design borrows the durable lessons from mainstream coding agents:

- the transcript is the source of truth;
- the model request is a budgeted view over that transcript;
- large files, panels, tables, logs, and tool results enter by reference first;
- exact content is read on demand through tools or context entries;
- old noisy history is condensed into auditable summaries.

It does not add a project model to the framework. File access is still
`workspace.*`. Product semantics stay outside AIditor or in extensions.

## Mental Model

There are four context shapes:

```text
Transcript        append-only agent messages and tool records
Working context   the request payload sent to the provider for one turn
Memory            durable agent facts, preferences, decisions, and open items
Compaction        an auditable summary of an older closed transcript range
```

These are runtime shapes, not new AI registries.

The model-facing registries remain:

```text
tools      execute actions
context    provide bounded readable content
operations preview/apply changes
```

## Source Of Truth

The transcript stays append-only by default. Compaction does not delete source
messages. It decides which messages are omitted from the next provider request
and replaces them with compact records.

This keeps the system debuggable:

- UI can still show full history.
- A compaction record can cite source message ids.
- A later tool can reread exact workspace data instead of trusting a stale
  summary.
- Persistence truncation remains a storage safety limit, not semantic memory.

If a storage adapter archives raw messages, it must preserve enough ids, hashes,
and timestamps to make compaction records traceable.

## When To Compact

Compaction should run only at scheduler-safe points:

1. Before a provider request when estimated working context exceeds the soft
   limit.
2. After a completed run if the run produced large tool results, repeated
   reads, or many intermediate failed attempts.
3. When the user explicitly asks to compact or clear old context.
4. During idle background maintenance for an agent that is not running.

It must not run across an open tool-call sequence:

```text
assistant message with tool_calls
  -> required tool result messages
  -> continuation request
```

It must not compact while the run is waiting for approval unless the candidate
range is fully before the pending approval sequence.

Recommended thresholds:

```text
softLimit  = 70% to 80% of model context budget
hardLimit  = 90% of model context budget
tailWindow = recent raw messages that are always preserved
```

The hard limit may still use emergency clipping to avoid a failed request, but
that is a fallback. The normal path is semantic compaction.

## What Must Stay Raw

The request builder always preserves:

- runtime guide, active skills, permission state, and current workspace metadata;
- the current user input;
- queued interruption metadata;
- pending approvals and unresolved tool calls;
- the latest raw tail of the conversation;
- active inbox continuation events;
- active target/reference/context entries attached to the current input;
- failed checks, current errors, and unresolved questions relevant to the task.

Older closed spans are candidates for compaction.

## Compaction Unit

A compaction record summarizes one contiguous closed range of messages.

Recommended shape:

```js
{
  id: "cmp_x",
  agentId: "a_x",
  range: {
    fromMessageId: "m_1",
    toMessageId: "m_20",
  },
  messageIds: ["m_1", "m_2"],
  createdAt: 0,
  model: "summary-model",
  sourceHash: "sha256:...",
  summary: "",
  facts: [],
  decisions: [],
  openItems: [],
  changedRefs: [],
  toolObservations: [],
  verification: [],
  risks: [],
  omittedDetails: [],
  tokenEstimateBefore: 0,
  tokenEstimateAfter: 0,
}
```

The record should be short, but it must keep the information needed to continue
work safely:

- user goals and constraints;
- decisions and rejected approaches;
- files, panels, tables, or references that were touched;
- hashes, versions, or ids returned by tools;
- checks that passed, failed, or were not run;
- unresolved questions and pending follow-ups;
- known failure causes and repair hints.
- verification observations and compact risk records from failed tool calls.

Verbose search output, repeated file reads, long generated code, and obsolete
failed attempts should be summarized or omitted with a clear note.

## Memory Versus Compaction

Memory is not a transcript summary.

Use memory for stable information that should survive across tasks:

```text
facts        durable facts about the agent or workspace
preferences  user or agent preferences
decisions    durable architectural or product decisions
openItems    long-lived unresolved tasks
```

Use compaction for old conversation history that is too large to send raw.

Not every compaction updates memory. A compaction may contain temporary search
results or failed attempts that should not become durable memory.

The deterministic runtime updates memory conservatively. It promotes only
explicitly marked transcript lines, for example:

```text
Fact: workspace writes require baseHash
Decision: keep inactive panels detached from DOM
Todo: add a visual compaction inspector
```

Chinese marker forms such as `事实:`、`结论:`、`待办:` are treated the same way.
Ordinary assistant progress, raw tool output, verification failures, and
temporary search results remain inside compaction records. They are context for
continuing the task, not durable memory.

## Request Assembly

The request builder constructs a working context in the layered order described
in [ai-context-assembly.md](./ai-context-assembly.md). In compact form:

```text
runtime / skills
workspace and task state
attached references and bounded context payloads
memory and compaction records
inbox / queue runtime messages
recent raw transcript tail
current user input
```

Large context entries should enter as summaries and references first. The model
should call tools or context readers for exact ranges.

For workspace-backed work, this means:

```text
file tree / component catalog / schema summary
  -> exact file range or exact data rows
  -> base-hash patch or previewable operation
  -> check / inspect
```

The framework should not inject whole files, whole generated panels, whole
tables, or whole tool logs by default.

## Provider Use

Compaction may call a model, but the compactor is not an agent with tools.

Rules:

1. No tool calls during compaction.
2. No new workspace reads during compaction.
3. Input is only the transcript range and existing compact metadata.
4. Output is structured compaction data.
5. Failure to compact must not corrupt the transcript.

If a provider is unavailable, the runtime may fall back to deterministic
compression:

- truncate long tool payloads;
- keep tool ids, statuses, errors, hashes, and summaries;
- preserve recent raw messages;
- omit older verbose payloads with explicit `omittedDetails`.

## Subagents And Quests

Each agent owns its own transcript, memory, and compactions.

Parent agents should not receive full child transcripts by default. A completed
quest contributes:

```text
quest id
child agent id
status
summary
important refs
risks / open items
result message id
```

The parent can read exact child messages through existing message/quest tools
when needed. This keeps parallel exploration from flooding the parent context.

## Large Data And UI Context

For UI and data-heavy editors, context should stay typed:

```text
target -> reference -> context
```

Examples:

- selected table rows become row references plus schema summary;
- a panel becomes panel id, component name, props summary, health, and source
  reference;
- an error becomes stack excerpt plus panel/component ids;
- a file becomes path, hash, size, outline, and optional range.

Compaction should preserve references and hashes, not stale copies of large
payloads.

## API Surface

Final runtime service:

```js
aiditor.ai.compaction.configure(options)
aiditor.ai.compaction.plan(agentId, input)
aiditor.ai.compaction.run(agentId, plan)
aiditor.ai.compaction.records(agentId)
aiditor.ai.compaction.clear(agentId, options)
aiditor.ai.memory.configure(options)
aiditor.ai.memory.updateFromCompaction(agentId, record, options)
```

These are AI runtime services. They are not tool registries and not context
registries.

Optional human-facing commands may wrap it:

```text
ai.compactCurrentAgent
ai.clearCurrentAgentCompactions
ai.listCurrentAgentCompactions
```

If model-facing compaction tools are ever exposed, they should call the same
service and still obey normal tool permissions.

## Invariants

1. Provider message order must remain valid.
   Tool calls are never separated from their matching tool results.
2. Raw transcript remains the source of truth.
3. Compaction records are chronological and auditable.
4. Compaction cannot grant access to data the agent could not already see.
5. Current task, pending approvals, and active errors stay raw.
6. Workspace files are reread by path/hash/range when precision matters.
7. Emergency clipping is allowed only as a fallback, not the normal memory
   strategy.

## Current Implementation Notes

Current code already has useful pieces:

- `src/ai/request.js` estimates model context and budgets recent messages.
- `src/ai/request.js` truncates large strings, tool args, and context payloads.
- `src/ai/request.js` groups assistant tool-call messages with their matching
  tool results so provider history is not split by budgeting.
- `src/ai/store.js` owns the complete in-memory transcript and publishes a
  JSON-safe snapshot plus mutation version.
- `src/ai/persistence.js` stores that complete snapshot in IndexedDB. It does
  not reuse model-facing compaction or trim the transcript to satisfy a storage
  budget; see [ai-persistence.md](./ai-persistence.md).
- `src/ai/store.js` keeps messages, queue, inbox, quests, and runtime status in
  the agent record.
- `src/ai/memory.js` provides conservative durable memory updates from explicit
  compaction markers.
- `src/ai/compaction.js` provides deterministic semantic compaction records,
  safe range planning, request filtering, memory messages, and compaction
  context messages.
- `src/ai/compaction.js` registers command wrappers for compacting, listing, and
  clearing the current agent compactions.
- `src/ai/runtime.js` triggers compaction at scheduler-safe points before
  normal requests, tool continuations, and approval resumes.
- `src/ai/panels/message-live-strip.js` exposes live run state independently
  from transcript rendering.

What is still missing:

- optional model-based compactor output;
- optional richer memory extraction that still remains auditable and
  conservative;
- visual UI for inspecting compactions.

These pieces live inside the AI runtime. They should not add a project concept
to the framework.

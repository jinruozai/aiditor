# AI Persistence

This document defines how the optional AI Host persists recoverable runtime state
without turning browser `localStorage` into a full transcript database.

AI persistence is a framework responsibility because agents, messages, queues,
tool calls, attachments, and active agent state all live in `src/ai/store.js`.
Host projects still own their own project files, domain records, editor history,
and durable product data.

## Boundary

Local persistence has one job:

```text
restore a usable AI runtime session after reload
```

It is not:

- a complete transcript archive;
- a provider request compaction strategy;
- project or workspace persistence;
- editor history;
- a place to store blobs, screenshots, full tool logs, file contents, or host
  domain state.

`localStorage` stores only compact, recoverable state. A storage backend with a
larger quota may preserve full transcripts, but that is a different backend
contract. The default browser storage path must stay conservative and bounded.

## Public API

`aiditor.ai.configurePersistence(options)` owns all local AI runtime persistence
settings:

```js
aiditor.ai.configurePersistence({
  enabled: true,
  namespace: 'my-editor',
  key: null,
  load: true,
  maxBytes: 2 * 1024 * 1024,
  maxMessagesPerAgent: 80,
  toolResultPolicy: 'compact',
})
```

Options:

| Option | Meaning |
| --- | --- |
| `enabled` | Enables or disables AI runtime persistence. Disabling does not clear existing storage. |
| `namespace` | App or workspace identity used to derive the storage key. |
| `key` | Advanced exact storage-key override. When omitted, the key is derived from `namespace`. |
| `load` | When not `false`, reads stored state immediately after configuration. |
| `maxBytes` | Conservative serialized storage budget for the localStorage payload. |
| `maxMessagesPerAgent` | Maximum latest messages retained per agent in compact persistent state. |
| `toolResultPolicy` | `compact`, `metadata-only`, or `none`. Controls persisted tool result detail. |

The base key is always:

```text
aiditor.ai
```

With a namespace, the effective key is:

```text
aiditor.ai.<namespace>
```

If the host does not provide a namespace, the framework derives one from the
current app location. This makes separate AIditor apps on the same origin use
separate AI runtime state by default. If no location is available, the base key
`aiditor.ai` is used.

The storage key is identity, not schema. Do not put the snapshot format version
into the key. Format versioning belongs inside the stored snapshot's `version`
field so the runtime can parse or migrate stored data without changing app
identity.

The default `maxBytes` should be well below common per-origin storage limits.
The budget is for the single AI state key, not the whole origin. Other AIditor
systems, host code, and browser data may share the same quota.

`aiditor.ai.clearStoredState()` removes only the configured AI persistence key.
It must not clear project data, workspace snapshots, settings, or extension
state.

Changing `namespace` or `key` changes the AI runtime identity. The store clears
the current in-memory AI runtime and then restores from the new key. This avoids
leaking agents or transcript rows from one app/workspace identity into another.

## Snapshot Shape

Persistent snapshots keep the existing versioned state envelope:

```js
{
  version: 2,
  agents: [],
  attachments: [],
  activeAgentId: null,
}
```

The persisted state must preserve:

- agent identity, parent/child order, model/connection choices, permission mode,
  skills, tools, memory, compaction records, quests, inbox summaries, and active
  agent id;
- enough latest messages to continue the conversation after reload;
- tool call identity, name, status, timestamps, permission actor, error summary,
  and compact argument/result metadata;
- lightweight attachment and context reference metadata.

The persisted state must not preserve:

- full large message bodies beyond the configured budget;
- full tool result payloads, previews, apply results, or large argument objects;
- binary data;
- provider streaming buffers that are only useful for the current run;
- host-specific project truth.

Restore normalizes transient runtime state. Running, queued, waiting, stopped,
and failed activity must return to an idle or stopped state that the UI can
display safely after reload.

## Save Algorithm

Saving follows one deterministic path:

```text
runtime state
  -> full recoverable snapshot
  -> serialize once
  -> estimate storage bytes
  -> write if within budget
  -> compact if over budget
  -> emergency compact if setItem still reports quota
  -> disable persistence for this runtime session if storage still fails
```

Rules:

1. Serialization happens before `setItem`. The runtime checks the estimated
   byte size against `maxBytes` and does not knowingly attempt an oversized
   write.
2. Size estimation must be conservative for browser storage. UTF-16 character
   count times two is acceptable for `localStorage`.
3. Compaction is deterministic. The same runtime state and persistence options
   produce the same compact snapshot.
4. `setItem` quota failures trigger one emergency compaction attempt.
5. If emergency compaction still cannot be written, persistence is disabled for
   the current runtime session and the framework emits one throttled warning.
6. Reactive save ticks must not report the same quota failure repeatedly.

Quota failure is a storage degradation, not a project data failure. The user can
continue working with the in-memory AI runtime; only reload recovery is degraded
for that session.

## Compaction Policy

Persistence compaction is separate from model request compaction. It is a local
storage safety mechanism, not semantic memory.

### Agents

Compacted snapshots keep all agents, not only the active one. Agent metadata is
small and necessary for tree restoration. Per-agent message lists are reduced to
the latest `maxMessagesPerAgent` messages.

If old messages are omitted, the agent should retain a compact marker so UI and
debug tools can explain that the restored transcript is partial. This marker is
diagnostic metadata, not model context.

### Messages

Message content is truncated much more aggressively for persistence than for
in-memory transcript rendering. Recent messages are useful after reload, but
they must still fit the storage budget.

Recommended persistent message caps:

```text
content            small text summary window
reasoning_content  very small diagnostic excerpt
meta/stats/usage    keep scalar summaries, drop large nested payloads
contextRefs         normalize to lightweight refs
attachments         keep ids and light metadata only
```

The in-memory transcript stays unchanged. Only the serialized persistence
snapshot is compacted.

### Tool Calls

Tool calls keep identity and lifecycle information:

```text
id
providerCallId
toolId / name
status
actor
createdAt / updatedAt
error summary
args summary
preview/result/applyResult according to toolResultPolicy
```

`toolResultPolicy` meanings:

| Policy | Persisted tool detail |
| --- | --- |
| `compact` | Keep bounded structured summaries of args, preview, result, and applyResult. |
| `metadata-only` | Keep identity, status, tool name, timestamps, error summary, and a short args summary; drop result bodies. |
| `none` | Keep only tool identity/lifecycle metadata needed to render a historical row. |

No policy may persist raw blobs or unbounded strings.

### Attachments And Context Refs

Attachments and context refs are stored as normalized lightweight references:

```text
id
kind / resolver
uri
title
summary
createdAt / updatedAt
small scalar meta
```

They should not embed the referenced content. Exact content is resolved again
through registered context/reference providers when needed.

## Error Reporting

The persistence layer reports structured storage warnings through
`aiditor.reportError` or the log system with enough context for UI display:

```js
{
  scope: 'ai.persistence',
  key: 'aiditor.ai.my-editor',
  reason: 'quota_exceeded',
  maxBytes: 2097152,
  attemptedBytes: 0,
  compacted: true,
  disabledForSession: true,
}
```

Stable reasons:

```text
quota_exceeded
serialization_failed
storage_unavailable
parse_failed
oversized_stored_state
```

Repeated quota errors for the same key and runtime session are coalesced. The
runtime may expose state for diagnostics, but hosts should not need to poll or
special-case quota failures.

## Read Algorithm

Reading persisted state is also bounded:

1. If storage is unavailable, return no snapshot.
2. If the stored string is above the configured read budget, remove the key and
   return no snapshot.
3. If parsing fails, remove the key only when the failure is clearly caused by
   this AI persistence payload.
4. Restore versioned snapshots through the normal `makeAgent`, `makeMessage`,
   and runtime normalization path.

Compacted snapshots are valid snapshots. Restore must not require host projects
to understand compaction markers.

## Tests

Required coverage:

- an oversized message compacts before storage is written;
- many large tool calls compact below `maxBytes`;
- `QuotaExceededError` triggers emergency compaction and does not spam
  `reportError`;
- persistence disables itself for the current runtime session if storage still
  fails after emergency compaction;
- restored compacted messages and tool calls remain renderable and readable;
- `clearStoredState()` removes the configured key;
- stored strings above the read budget are removed on load.

## Non-Goals

- No project-specific persistence policy.
- No workspace file storage.
- No editor history or undo journal.
- No model-facing context compaction change.
- No hidden server requirement.
- No full transcript guarantee in `localStorage`.

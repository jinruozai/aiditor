# AI Persistence

AIditor persists the complete AI transcript independently from the working
context sent to a model. Persistence is a framework responsibility because
agents, messages, tool calls, quests, attachments, and active selection are AI
Host runtime records. It is not project truth or editor history.

## Invariants

1. The in-memory Store is the live source of truth.
2. Durable persistence preserves every JSON-safe transcript message. It does
   not truncate message content, reasoning, tool calls, or older rows to meet a
   model context budget.
3. Context compaction only derives a bounded provider request from the complete
   transcript. It never deletes UI history.
4. Reload restoration may normalize interrupted runtime states, but it does not
   silently remove completed history.
5. Persistence failure leaves the in-memory Store intact and reports one
   structured warning. It must not replace a newer transcript with a stale
   compact snapshot.

This is the same separation used by mature agent runtimes: durable messages are
stored as session records, while compaction produces a model-facing projection.

## Storage Layers

The browser implementation uses two deliberately different stores:

```text
IndexedDB     complete durable runtime snapshot; persistence source of truth
localStorage  small synchronous bootstrap manifest; never transcript content
```

IndexedDB is the default because it is asynchronous, transactional, supports
structured records, and is intended for substantially larger browser data than
Web Storage. It requires no server and works with AIditor's zero-dependency
runtime.

The bootstrap manifest exists only so classic scripts and panels can discover
the Agent tree and active Agent before the asynchronous durable load finishes.
It contains stable Agent identity/configuration, active Agent id, and last model
preference. Message arrays, tool results, quests, inbox events, memory, and
compaction records are never written to localStorage.

## Public API

```js
aiditor.ai.configurePersistence({
  enabled: true,
  namespace: 'my-editor',
  adapter: aiditor.ai.persistence.indexedDbAdapter(),
  debounceMs: 500,
  load: true,
})

await aiditor.ai.persistence.ready()
await aiditor.ai.persistence.flush()
await aiditor.ai.clearStoredState()
```

Options:

| Option | Meaning |
| --- | --- |
| `enabled` | Enables durable AI persistence without clearing stored state. |
| `namespace` | App/workspace identity used to derive the durable key. |
| `key` | Exact advanced identity override. |
| `adapter` | Async durable adapter. IndexedDB is the browser default. |
| `debounceMs` | Coalesces streaming updates before a durable write. |
| `load` | When not `false`, restores the selected durable identity. |

The identity base is `aiditor.ai`. A namespace produces
`aiditor.ai.<namespace>`. When omitted, AIditor derives a namespace from the app
location so different editor apps on the same origin do not share Agents.
Format versions remain inside stored records, never inside the storage key.

`persistence.status` is a signal with these stable states:

```text
loading | ready | saving | error | disabled | unavailable
```

Hosts that synchronously create a default Agent should wait for
`persistence.ready()` first. Panels may mount immediately; Store signals update
them when durable state is hydrated.

## Adapter Contract

```text
load(key)          -> Promise<envelope | null>
save(key, envelope)-> Promise<void>
remove(key)        -> Promise<void>
```

Envelope:

```js
{
  version: 1,
  savedAt: 0,
  state: {
    version: 3,
    agents: [],
    attachments: [],
    preferences: {},
    activeAgentId: null,
  },
}
```

The snapshot is JSON-safe at the framework boundary. DOM nodes, functions,
cycles, and other runtime-only values are normalized by `aiditor.ai.serialize`;
normal text and structured tool/message data are not shortened.

Desktop hosts may provide a SQLite or filesystem-backed adapter with the same
contract. The framework does not expose real filesystem paths or require a
server.

## Save And Restore

Store changes update the small bootstrap manifest immediately and debounce the
asynchronous durable write. Writes are serialized so an older save cannot land
after a newer one. If Store state changes while a write is in flight, another
write is scheduled.

`visibilitychange`, `pagehide`, and `beforeunload` start an immediate flush of
pending state. Browser teardown cannot make an asynchronous transaction
mathematically synchronous, so stable mutation points also schedule durable
writes rather than relying only on unload.

Restore order:

```text
read bootstrap manifest synchronously
  -> load durable envelope asynchronously
  -> validate and migrate the snapshot version
  -> restore complete transcript
  -> normalize interrupted runs/tool calls
  -> publish ready status
```

If local Store mutations occur while durable state is loading, restoration
merges records by stable Agent/message id and keeps the newer in-memory record.
This prevents hydration from discarding a message submitted during startup.

Version migration belongs only to this persistence boundary. A valid version-2
localStorage snapshot or durable envelope is normalized to version 3 before it
reaches the Store: transcript records and preferences are retained, while the
removed per-Agent `toolRefs` field is discarded. The normalized Store snapshot
is immediately saved as a version-3 durable envelope and localStorage is
rewritten as a bootstrap-only manifest.

An invalid durable envelope is not passed into the Store and does not leave
persistence permanently suspended. The failure is reported once, then the
current valid in-memory/bootstrap state is saved over that one transcript key as
a version-3 recovery envelope. The adapter database is never cleared, and the
repaired record therefore does not emit the same startup error again.

## Context Compaction

`aiditor.ai.compaction` owns model context pressure:

```text
complete durable transcript
  -> compaction records + recent raw tail
  -> bounded provider request
```

Compaction records cite source message ids and remain auditable. The transcript
panel always reads `agent.messages`, not the compact request projection. Storage
quotas and model token limits are unrelated policies.

## Runtime Checkpoints

`aiditor.ai.checkpoints` is a separate optional recovery primitive. It captures
queued work and execution state for host-controlled recovery. Transcript
persistence is always-on durable chat history; checkpoints are explicit run
recovery. They share the same small adapter shape but not lifecycle or policy.

## Errors

Persistence failures use stable codes:

```text
AI_PERSISTENCE_UNAVAILABLE
AI_PERSISTENCE_INVALID_TRANSCRIPT
AI_PERSISTENCE_LOAD_FAILED
AI_PERSISTENCE_SAVE_FAILED
AI_PERSISTENCE_REMOVE_FAILED
AI_PERSISTENCE_BOOTSTRAP_FAILED
```

Only one warning per operation/key is reported during a runtime session.
An automatic save failure suspends further debounced writes for the current
configuration; an explicit `flush()` retries, and reconfiguration clears the
suspension. Failures never clear the active Store and never trigger lossy
transcript compaction.

## Required Tests

- complete old and new messages survive repeated save/reload cycles;
- large message and tool-call content is restored without truncation;
- model context compaction does not alter persisted transcript rows;
- bootstrap localStorage contains no message bodies;
- a mutation during async load is merged rather than overwritten;
- serialized writes cannot land out of order;
- pending writes flush on lifecycle events;
- storage errors are structured and warning-coalesced;
- clearing removes both durable state and the bootstrap manifest;
- separate namespaces remain isolated.
- valid version-2 transcripts migrate once and retain messages;
- version-3 transcripts load without a rewrite;
- invalid envelopes recover to one valid version-3 record and do not report
  the same corruption again on the next startup.

## Non-Goals

- No project/workspace file persistence.
- No server requirement.
- No automatic transcript retention or deletion policy.
- No use of model context limits as storage limits.
- No resumable provider socket claim after page teardown.

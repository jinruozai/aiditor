# AI Request Assembly

Request assembly is deterministic and Skill-first. Capability planning is
synchronous; Reference payload hydration is asynchronous and abortable.

```text
Agent + input + run
  ├─ planRequest
  │  ├─ capture factual Context providers
  │  ├─ resolve explicit + configured + run-selected Skills
  │  ├─ evaluate Skill and Tool availability
  │  ├─ project model-visible Operations and Tool schemas
  │  └─ assemble bounded context cards and transcript shell
  └─ resolveRequest
     ├─ check each Reference through the unified Permission policy
     ├─ hydrate readable payloads concurrently
     └─ atomically publish the provider request
```

Context capture precedes Skill availability so project Skills may inspect the
current runtime snapshot. Context values are navigation and factual state only;
`tools` fields are ignored and should not be produced.

The request always contains a compact Skill catalog. Full instructions are
included only for active Skills. This provides progressive disclosure without
shipping the entire Tool catalog or every Skill body to the model.

Attachments and References do not authorize Tools. If a task needs semantic
editor access, activate `aiditor.editor-control`; if it needs workspace IO,
activate `aiditor.workspace-authoring`.

There is no Tool fallback. A request with no active domain Skill exposes only
`skill.list` and `skill.activate` when the connection supports Tool calling,
and no Tools when it does not.

Run-selected Skill ids are held by `src/ai/runtime.js`, not persisted in Agent
state. They survive normal Tool continuations and approval waits, and are
released at every terminal path.

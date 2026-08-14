# AI Host Runtime

AI Host is an optional layer above AIditor Core/UI. Core/UI never depends on it.

## Public model

```text
Agent        stable profile, transcript, queue, inbox, quests
Skill        discoverable focused capability and instructions
Tool         internal executable endpoint exposed through active Skills
Context      request-time facts
Reference    semantic resource identity and bounded read
Operation    semantic preview/apply mutation
ChangeSet    grouped user review and apply
Permission   centralized actor/target/scope decision and audit
```

Targets, attachments, rich-prompt ranges, checkpoints, and provider wire
formats are runtime/UX details rather than new capability models.

## Agent profile

An Agent owns stable configuration:

```js
{
  id,
  name,
  parentAgentId,
  connection,
  model,
  systemPrompt,
  outputSchema,
  contextRefs,
  skillRefs,
  permissionMode,
  permissions,
}
```

Direct Tool ids are not part of the Agent contract. Child creation,
configuration, and delegation accept `skillRefs` only.

## Run lifecycle

```text
queued input
  -> makeRequest
  -> provider turn
  -> assistant Tool calls?
       no  -> validate optional outputSchema -> finish
       yes -> decode whole batch -> schema validation -> permission
              -> run/preview/apply or wait for approval
              -> append Tool results -> makeRequest continuation
```

Each run has a stable `runId` and bounded `{maxTurns, timeoutMs, maxTokens}`.
Tool continuations reuse the same run. Dynamic Skill selection is stored per
run, survives approval waits, and is cleared on complete/fail/stop.

## Skill discovery

Connections with Tool calling always receive `skill.list` and
`skill.activate`. Domain Tools appear only through active Skills. A model may:

1. inspect the compact catalog already present in system context;
2. call `skill.list` for a focused query;
3. call `skill.activate` for one available Skill;
4. use the Skill Tools on the next continuation.

User `/skill`, rich-prompt tokens, configured `agent.skillRefs`, and model
activation all converge on the same request assembly. See
[ai-skills.md](./ai-skills.md).

## Tool lifecycle

Tools may implement:

- `run(input, ctx)` for direct execution;
- `preview(input, ctx)` and `apply(preview, ctx)` for reviewed mutation;
- `resolveSchema(ctx)` for request-time schema;
- `resolveModelSpecs(ctx)` for provider-facing semantic projections;
- `available(ctx)` for current host capability.

Skill activation never bypasses `available(ctx)` or Permission. Runtime decodes
and validates the entire provider batch before executing any call. Strict Tool
argument recovery is bounded and does not replay side effects.

## Context and references

Context providers capture small current facts, such as active editor identity
or selection summaries. References provide stable semantic resources and
bounded reads. Neither contributes Tools. Tool access is selected only through
Skills.

## Operations

A model-visible Operation declares:

```js
aiditor.ai.operations.register('scene.setValue', {
  exposeToModel: true,
  inputSchema: { type: 'object', properties: { value: {} } },
  preview: function (input, ctx) { /* ... */ },
  apply: function (preview, ctx) { /* ... */ },
}, { owner: 'project:game' })
```

The request projects each available Operation directly as its own provider Tool
while preserving the canonical Operation id for preview, apply, permission,
trace, and replay. The hidden gateway remains an implementation detail.

## Persistence

Snapshot schema version 3 stores complete JSON-safe transcripts in the
configured durable adapter. `localStorage` stores only a lightweight bootstrap
manifest. Model context compaction never deletes UI transcript history.

The version is exact; there is no legacy migration path in the framework.

## Orchestration

`aiditor.agent-orchestration` exposes bounded `agent.*`, `quest.*`, and
`message.*` Tools. Agents may create or manage descendants only. Delegation
selects focused child `skillRefs`; it does not pass raw Tool ids.

Quest result/cancel is the precise task lifecycle. `agent.stop` remains an
emergency current-run control, not the normal quest completion mechanism.

## File ownership

```text
src/ai/
  contribution-registry.js  shared exact-owner Registry primitive
  tool/
    registry.js              executable Tool definitions
    runtime.js               Tool-call lifecycle and run context
  context/
    registry.js              factual Context providers
  skill/
    registry.js              SkillSpec normalization/catalog
    runtime.js               skill.list / skill.activate
    builtins.js              framework Skill taxonomy
    packages.js              bounded SKILL.md discovery
    reference.js             Skill reference projection
  request.js                 deterministic request assembly
  runtime.js                 scheduler, run state, continuation, approval
  orchestration.js           Agent/Quest control Tools
  permission.js              centralized policy and audit
  store.js                   in-memory Agent state
  persistence.js             durable snapshot lifecycle
```

Provider, connection, reference, ChangeSet, compaction, and panel files remain
separate because each already has one cohesive responsibility.

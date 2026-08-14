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

Transient `statusText` is a bounded single-line projection of the current
input. Rich prompts use the shared message text normalization contract; runtime
state must never persist JavaScript object coercions such as `[object Object]`.

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
  -> planRequest (pure synchronous capability plan)
  -> resolveRequest (abortable asynchronous Reference hydration)
  -> provider turn
  -> assistant Tool calls?
       no  -> validate optional outputSchema -> finish
       yes -> decode whole batch -> schema validation -> permission
              -> run/preview/apply or wait for approval
              -> append Tool results -> plan/resolve continuation
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
- `permissionTargets(input, ctx, phase)` for exact Policy targets;
- `isConcurrencySafe(input)` to opt a call into bounded parallel scheduling;
- `timeoutMs` for an execution deadline.

Skill activation never bypasses `available(ctx)` or Permission. Runtime decodes
and validates the entire provider batch before executing any call. Strict Tool
argument recovery is bounded and does not replay side effects.

Tool batches preserve provider order. Consecutive calls run in parallel only
when every call explicitly opts in through `isConcurrencySafe`; every other
call is an exclusive barrier. `tool/runtime.js` remains the only ToolCall state
owner. Execution ids prevent a timed-out or cancelled promise from settling a
newer or terminal ToolCall.

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

Model-selected Skills remain run-scoped. When provider output calls a Tool from
an available but inactive Skill, Runtime reports `SKILL_ACTIVATION_REQUIRED`
with the canonical Tool id, original provider alias, and candidate Skill ids
instead of the ambiguous generic Tool-unavailable message. `skill.list`
separately reports `available`, `active`, `configured`, and activation lifetime.
Cross-request capability configuration remains owned by persisted
`agent.skillRefs`.

The runtime, not provider output, owns each ToolCall actor. `agent.create` and
new-agent `agent.delegate` resolve an omitted parent from that originating
actor, revalidate it at apply time, and fail if the caller or parent no longer
exists. Agent-originated creation can never fall back to a root Agent, and the
Store rejects orphan parent ids.

Quest result/cancel is the precise task lifecycle. `agent.stop` remains an
emergency current-run control, not the normal quest completion mechanism.
At the Agent boundary, an unreadable or missing Quest is reported uniformly as
`QUEST_UNAVAILABLE` so existence is not leaked across ownership boundaries.
User-originated diagnostics retain exact `AGENT_NOT_FOUND` and
`QUEST_NOT_FOUND` codes.

## File ownership

```text
src/ai/
  i18n.js                   built-in AI Host UI dictionaries
  contribution-registry.js  shared exact-owner Registry primitive
  tool/
    registry.js              executable Tool definitions
    scheduler.js             ordered parallel groups, barriers, deadline/abort
    runtime.js               Tool-call lifecycle and run context
  context/
    registry.js              factual Context providers
  skill/
    registry.js              SkillSpec normalization/catalog
    runtime.js               skill.list / skill.activate
    builtins.js              framework Skill taxonomy
    packages.js              bounded SKILL.md discovery
    reference.js             Skill reference projection
  request.js                 synchronous plan + async Reference hydration
  runtime.js                 Agent run state, continuation, approval
  orchestration.js           Agent/Quest control Tools
  permission.js              centralized policy and audit
  store.js                   in-memory Agent state
  persistence.js             durable snapshot lifecycle
```

Provider, connection, reference, ChangeSet, compaction, and panel files remain
separate because each already has one cohesive responsibility.

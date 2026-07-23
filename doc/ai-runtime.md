# AI Runtime

The AI runtime manages agents, skills, chat messages, queues, quests, tool
execution, streaming state, and persistence.

## Agents

Agents are runtime records. Implemented abilities include:

```js
aiditor.ai.createAgent(spec)
aiditor.ai.updateAgent(id, patch)
aiditor.ai.renameAgent(id, name)
aiditor.ai.moveAgent(id, order)
aiditor.ai.reparentAgent(id, parentAgentId)
aiditor.ai.deleteAgent(id)
aiditor.ai.selectAgent(id)
aiditor.ai.findAgent(id)
aiditor.ai.getActiveAgent()
```

Agents may have:

```text
id
name
parentAgentId
status
statusText
connection
model
permissionMode
messages
queue
quests
inbox
toolRefs
skillRefs
contextRefs
outputSchema
```

Parent/child is an agent relationship, not a new runtime layer.

`agent.status` describes only that Agent's scheduler: provider execution, queue,
approval wait, or idle. It does not claim that the user-visible response is
finished. A parent Agent may be `idle` while its response is waiting for
delegated Quests.

Streaming is connection-owned runtime behavior, not Agent state. Direct input,
delegated Quests, newly created Agents, and restored Agents all derive the same
effective stream mode from the selected Connection. UI panels must not write a
temporary `agent.stream` flag to initialize runtime behavior.

These JavaScript functions are trusted host APIs. In particular,
`aiditor.ai.updateAgent(id, patch)` is not exposed to the model as an arbitrary
state mutation tool. Model-driven profile changes use the constrained,
permission-checked `agent.configure` contract described below.

The tree is the primary agent topology. Child agents are not anonymous helper
threads; they are addressable runtime nodes with their own transcript, queue,
quests, inbox, model, permissions, context refs, skills, and tools. Delegation
should preserve that tree instead of flattening work into one global chat list.

Model-facing creation follows one ownership rule:

```text
explicit parentAgentId         validate inside the caller's manageable subtree
omitted parent + agent actor   parent is the calling agent
omitted parent + user actor    create a root agent
```

An agent cannot create or reparent a node to the root. The user may organize
root nodes directly. `agent.create` and `agent.delegate` use the same resolver,
so `create -> send` and one-step delegation have identical permission behavior.
The configurable `maxDelegationDepth` applies to model-created tree changes,
not user-managed tree organization.

New agents inherit the user's latest selected connection/model when no explicit
model is provided. This is AI runtime user preference, not project data. The
fallback order is:

```text
explicit spec.connection / spec.model
latest selected connection + model
active/default connection defaultModel
empty model, so UI asks the user to choose
```

Model hints are display suggestions only. The runtime must not silently choose a
hint as the agent model because hints may not be available for the user's
current account or provider configuration.

## Skills

A skill is an agent behavior profile. It can provide prompt guidance and rules
for an agent.

Implemented APIs:

```js
aiditor.ai.skills.register(name, skill, meta?)
aiditor.ai.skills.unregister(name, { owner? }?)
aiditor.ai.skills.unregisterOwner(owner)
aiditor.ai.skills.unregisterPrefix(prefix)
aiditor.ai.skills.get(name)
aiditor.ai.skills.list(prefixOrFilter?)
aiditor.ai.skills.meta(name)
aiditor.ai.skills.loadPackage(input, meta?)
aiditor.ai.skills.readResource(skillId, path)
```

Agents enable skills by listing skill ids in `agent.skillRefs`. During request
construction, enabled skills contribute `systemPrompt`, `rules`, and `tools`.
Tools remain entries in the one shared tool registry; the skill only controls
which existing tool schemas are disclosed for the current request.

The framework ships focused built-in authoring skills:

```text
aiditor.runtime-authoring   live editor agent: write workspace files, mount/replace dock panels
aiditor.library-authoring   repository agent: use AIditor as a plain JavaScript library
aiditor.authoring           compatibility alias for older combined guidance
```

They teach the model the AIditor component contract: plain `.js` files,
registered components, `factory(propsSig, ctx) -> HTMLElement`, `aiditor.ui.*`
controls, dock-responsive layout, generated API references, and no
React/TSX/import/export unless the workspace explicitly provides such a build
system. The request builder enables the runtime skill automatically for
UI/panel/dock authoring requests. Merely opening a workspace does not activate a
skill or grant tools to every agent.

The copyable documentation forms are:

- [skill/aiditor-runtime-authoring/SKILL.md](./skill/aiditor-runtime-authoring/SKILL.md)
- [skill/aiditor-library-authoring/SKILL.md](./skill/aiditor-library-authoring/SKILL.md)

The same registry is exposed to agents as references:

```text
aiditor://skills
aiditor://skills/aiditor.runtime-authoring
aiditor://skills/aiditor.library-authoring
```

Agents use this index to choose the right workflow instead of relying on a
large always-on prompt.

Skill registrations use the same exact-owner lifecycle as other runtime
contributions. File-backed `SKILL.md` packages are optional adapters over the
bounded workspace contract; package scripts are never executed. Request traces
record each effective skill's activation reason, owner/source/hash, prompt
characters, and referenced tools. See [ai-skills.md](./ai-skills.md) for the
complete contract.

Skills are not a fourth AI action registry:

```text
tools      execute actions
context    provide readable model context
operations preview/apply changes
skills     shape agent behavior
```

Extensions and domain code may register skills, but skills should stay small. A
package that installs a skill may also register its tools. The tools still live
in the shared tool registry; a skill must not hide a private tool system inside
itself.

Recommended skill shape:

```text
systemPrompt
rules
tools
auto(ctx)
```

Inactive skills are represented only by a bounded id/title/description catalog
when orchestration needs to choose a child profile. Full instructions and tool
schemas enter the request only after activation. Tool execution still goes
through the shared registry and permission system.

## Messages

Implemented message abilities:

```js
aiditor.ai.appendMessage(agentId, message)
aiditor.ai.insertMessageAfter(agentId, afterId, message)
aiditor.ai.readMessage(agentId, messageId)
aiditor.ai.updateMessage(agentId, messageId, patch)
aiditor.ai.agent.messages(agentId, options, actor)
```

Messages may contain text, rich prompt content, context refs, attachments, tool
calls, quest links, and runtime status.

Runtime-owned message metadata separates two identities:

```text
meta.runId       one provider/runtime execution, used by trace and diagnostics
meta.responseId  one user-visible response chain, used by transcript grouping
```

A response may contain several provider turns and may pause across delegated
quests. Tool continuations, post-delegation continuations, and matching inbox
continuations retain the originating `responseId`; each provider execution still
gets its own `runId`. A delegated child starts its own response chain, while its
quest carries the parent's source response id back in the completion event.

For each Agent, the latest non-runtime `user` message defines the foreground
response. This applies both to direct user input and to a parent Agent's Quest.
Runtime-owned continuation messages never advance that boundary. A background
result may resume the model only when its source `responseId` still equals the
foreground response; starting a newer input supersedes older automatic
continuations without deleting their Quest, message, or inbox records.

Trusted host UI can inspect and stop that response lifecycle:

```js
aiditor.ai.response.read(agentId, responseId?)
aiditor.ai.response.stop(agentId, responseId?)
```

`read` returns the response status (`running`, `waiting`, `completed`, or
`stopped`), whether it is active/stoppable, bounded pending Quest counts, the
canonical related Agent ids, the last root assistant message id, and one
response-level metrics snapshot. Omitting `responseId` selects the Agent's latest
non-runtime user response.

```js
{
  metrics: {
    startedAt,
    completedAt,
    durationMs,
    generationMs,
    promptTokens,
    outputTokens,
    totalTokens,
    tokensPerSecond,
    toolCallCount,
    providerTurnCount,
    cost: { currency: 'USD', amount }
  }
}
```

The summary walks canonical Quest edges (`fromAgentId` plus
`meta.sourceResponseId`) and counts each `{agentId, responseId}` once. It never
reconstructs orchestration ownership from rendered tool cards.

`stop` is the user-facing turn cancellation primitive. It closes the root
response, stops matching runtime continuations, and recursively cancels pending
descendant Quests created by that response. It does not delete Agents, rewrite
completed messages, or cancel unrelated responses. `agent.stop` remains the
lower-level operation for stopping one Agent's current provider run.

The built-in chat composer treats both `running` and `waiting` responses as
stoppable. While only descendants are active, the parent Agent remains `idle`
and the transcript live strip shows `waiting`; the UI must not falsify the
Agent scheduler state to keep the Stop control available.

The transcript renders the response footer only on the last assistant message in
that chain, after no chain message is queued/running and every quest dispatched by
the chain is terminal. Copy and usage metrics aggregate the complete response.
Internal run completion must never be presented as user-visible response
completion.

Footer metrics use one consistent response-tree scope. `durationMs` is wall-clock
latency from the root input being queued until the last related continuation
finishes; parallel child durations are not added together. `generationMs` is the
sum of model generation periods, and `tokensPerSecond` is aggregate output tokens
divided by that generation time rather than by wall-clock latency. Token, cost,
tool-call, and provider-turn counts include the root response plus recursively
delegated response chains. Copy text remains limited to the visible root
transcript rather than embedding child transcripts.

Transcript display uses the normalized message part pipeline defined in
[ai-message-rendering.md](./ai-message-rendering.md). Provider-specific content
blocks normalize into common parts such as text, code, image, file, reference,
attachment, error, and fallback card. Host projects may register display-only
renderers for domain card kinds without changing the built-in transcript panel.
Ordinary text is rendered as safe Markdown; structured provider blocks and host
cards continue through the renderer registry.

### Structured Output

`outputSchema` is an optional Agent profile field for final machine-readable
results. It is a JSON-schema subset shared with tool schema validation, not a
provider request object. It supports scalar/object/array types, required and
additional properties, enum/const, item and length/range constraints, and
`anyOf`/`oneOf`/`allOf`/`not` composition.

The final assistant turn is parsed only when it has no tool calls. On success,
the message keeps both forms:

```text
message.content    raw provider JSON text
message.output     parsed and schema-validated value
```

`quest.result` exposes the parsed value as `output`. Invalid structured output
is a run failure with the raw provider text retained for diagnosis. This is
output validation, not UI card inference: arbitrary JSON replies are not
automatically rendered as domain components.

## Queue

User and system work is queued before execution.

Implemented abilities:

```js
aiditor.ai.enqueueMessage(agentId, messageId, options)
aiditor.ai.dequeueMessage(agentId, messageId)
aiditor.ai.scheduleAgent(agentId)
aiditor.ai.message.send(agentId, spec)
```

The queue lets an agent finish current work cleanly while newer messages wait,
unless a message is marked as an interrupt.

`interrupt: false` appends the new message normally. `interrupt: true` stops the
target's current quest with `stopReason: "cancelled"`, places the new message at
the front of the queue, and starts it when the runtime slot is available. The
message `content` is the complete task instruction; there is no separate
guidance channel with weaker or ambiguous delivery semantics.

## Run Scheduler

The runtime owns one clear run loop per agent. It schedules work, streams model
output, executes tools, waits for approval, resumes after tool results, and
records completion or failure.

Implemented abilities:

```js
aiditor.ai.scheduleAgent(agentId)
aiditor.ai.stopAgent(agentId)
aiditor.ai.resumeAgent(agentId, actor)
aiditor.ai.flushToolResults(agentId)
aiditor.ai.configureRuntime(options)
aiditor.ai.createRunContext(request, controller)
```

The important invariant is message order:

```text
assistant message with tool calls
  -> matching tool result messages
  -> next model request
```

Approval UI must not leave orphan tool calls in the provider message history.
If a run is waiting for user approval, the runtime state should say so and the
next continuation should be scheduled only after the approval/reject result has
been appended.

Runtime configuration has one limits shape:

```js
aiditor.ai.configureRuntime({
  maxConcurrentAgents: 8,
  maxConcurrentMessagesPerAgent: 1,
  maxDelegationDepth: 4,
  maxToolArgumentCorrections: 2,
  limits: {
    maxTurns: 32,
    timeoutMs: 600000,
    maxTokens: null,
  },
})
```

`maxTurns` counts provider request turns, including tool continuations and
approval resumes. `timeoutMs` starts when execution starts, not while queued.
`maxTokens` uses reported provider usage; if a provider does not report usage,
the runtime does not pretend that token enforcement is available.
`maxToolArgumentCorrections` is a separate no-side-effect correction ceiling
inside one run; it does not expand any execution budget.

The built-in Agents panel creates user-facing agents with the focused
`orchestration` skill. Hosts using `aiditor.ai.createAgent()` directly choose
their own `skillRefs`; no global tool set is injected as a fallback.

Tool availability is resolved per request from the agent, active skills, runtime
context, permissions, and connection capability. An empty tool set stays empty;
the runtime never falls back to every registered tool. The request trace records
`skillRefs`, `toolRefs`, canonical `gatewayCount`, provider-facing `toolCount`,
`toolProtocol`, `toolArguments`, and strict/best-effort Tool counts. This is the
source of truth when diagnosing why a model did not receive a Tool or why one
request-local projection did not receive a strict schema.

This is also the discovery contract. The model receives the complete schemas for
its effective tools, a bounded catalog for inactive skills, and context/reference
ids captured by the host or attached to the task. A global registry-enumeration
tool is intentionally absent: it would reveal unavailable capabilities and
duplicate request-time filtering without making an allowed capability usable.

Model-visible tool names are provider-safe request aliases. Skills and host code
continue to use public dotted ids such as `agent.delegate`; aliases never enter
permissions, history, tool records, or project data. Models must invoke tools
through the provider's declared tool protocol and must not print XML-like tool
markup into assistant text.

`agent.send` and `agent.delegate` may provide a smaller per-quest `budget` with
the same three fields. A per-quest value can only tighten the runtime ceiling.
When a limit is reached the quest becomes `stopped` with stable `stopReason`
`max_turns`, `timeout`, or `max_tokens`, and its parent receives a
`quest.stopped` inbox event.

These are safety stops, not normal completion paths. Agents should exit earlier
with one of four clear states:

```text
done        the requested work is complete
waiting     user approval or confirmation is required
blocked     required workspace/files/schema/API/permission is missing
failed      the same operation shape has failed and retrying would be guessing
```

Manual `agent.stop` uses the same stop path with `stopReason: "cancelled"`.
It is an emergency control for the target's current run. When the caller knows
the delegated task identity, `quest.cancel` is the precise operation and does
not affect unrelated queued or running work.

The trusted host API `aiditor.ai.stopAgent(agentId)` returns a boolean because
the host already owns the reactive Agent state. The model-facing `agent.stop`
tool returns a self-describing result:

```text
outcome            stopped | not_running
stopped            boolean
agentId
questId            active quest before the operation, or null
messageId          active message before the operation, or null
previousStatus
status              current Agent status
stopReason          cancelled when stopped, otherwise null
```

Unknown targets and permission denial are tool errors, not successful outcome
values. `not_running` means the target exists but has no active run to stop.

## Quests

A quest is delegated work tracked across agents.

Implemented abilities:

```js
aiditor.ai.createQuest(agentId, spec)
aiditor.ai.findQuest(agentId, questId)
aiditor.ai.updateQuest(agentId, questId, patch)
aiditor.ai.updateQuestPlan(agentId, questId, plan)
aiditor.ai.updateQuestStep(agentId, questId, stepId, patch)
aiditor.ai.agent.send(toAgentId, spec)
aiditor.ai.quest.cancel(agentId, questId, actor)
```

Built-in orchestration tools include:

```text
agent.read
agent.create
agent.configure
agent.delegate
agent.reparent
agent.delete
agent.send
agent.stop
quest.read
quest.result
quest.cancel
message.read
```

These tools are part of the AI runtime, not product domain tools.

`agent.read` has two bounded modes:

```text
agentId present        return the readable profile and runtime summary
agentId omitted        list one readable tree level
recursive: true        include the readable subtree below parentAgentId
```

Without arguments an agent sees its direct children and the user sees root
agents. Exact reads include configuration, status, counts, and recent quest
summaries. They never return full messages, queue bodies, inbox bodies, memory,
or arbitrary state. Host code that owns the runtime can use the JavaScript store
APIs when it genuinely needs those records.

`agent.configure` updates an existing descendant's stable profile:

```text
name
connection
model
systemPrompt
outputSchema
contextRefs
skillRefs
toolRefs
```

It uses preview/apply, rejects unknown connection/skill/tool ids, and cannot
modify parentage, permissions, status, messages, memory, state, or metadata.
Agents cannot configure themselves. A configuration change affects requests
built after apply; an already running request retains its original snapshot.

`agent.delegate` has two exclusive modes:

```text
agentId present   send content/context/attachments/budget to an existing agent
agentId omitted   create a child with name/systemPrompt/model/connection/
                  skillRefs/toolRefs, then send the task
```

Creation fields are rejected in existing-agent mode instead of being silently
ignored. Model-facing creation does not accept raw permissions, memory, state,
or metadata. Child permissions are inherited as an upper bound and every tool
call still passes through the permission resolver.

Quest records may carry a compact plan:

```text
goal
plan[]             ordered generic steps
currentStepId
budget
usage
stopReason
```

Each step is a small runtime state record:

```text
id
title
status             pending | running | completed | failed | blocked | skipped
kind               work by default
summary
result
meta
```

This is not a project workflow engine. It is a lightweight task-state surface for
tree agents so a parent can understand what a child is doing, what completed,
and what blocked without reading a whole transcript.

`quest.read` reads one exact quest when `questId` is present. Without `questId`
it returns at most 20 readable quest summaries by default, newest first; callers
may filter by `status` (`queued`, `running`, `completed`, `failed`, or `stopped`)
and raise `limit` up to 50. The user may read all quests on a target; an agent may
read only quests it initiated.

`quest.cancel` is idempotent and task-specific:

```text
queued quest       remove its request message from the queue and stop the quest
running quest      abort only when it is the matching active quest
terminal quest     return the terminal state without changing it
```

Its result always includes the current Quest record plus:

```text
outcome            cancelled | already_terminal
cancelled          boolean
previousStatus     Quest status before the operation
```

Cancellation emits the normal `quest.stopped` inbox event to the initiating
agent. It never clears unrelated queued work. Only the user or the quest's
initiating agent may cancel it.

The model query surface intentionally remains structural rather than becoming a
runtime database API. `agent.read` reads an exact Agent, one child level, or an
explicit subtree; it does not add name/status search or cursor pagination.
`quest.read` is scoped to one target Agent and does not aggregate an ownership
subtree. Parents already receive push inbox events and bounded recent Quest
summaries; trusted host diagnostics can index `aiditor.ai.agents()` when a large
cross-tree operational view is genuinely needed.

## Inbox

Agents receive completion events through inbox events. This prevents child-agent
completion from interrupting an unrelated current run.

Implemented abilities:

```js
aiditor.ai.appendInboxEvent(agentId, event)
aiditor.ai.markInboxEventConsumed(agentId, eventId)
```

Inbox events have two delivery outcomes:

- **continuation**: the event has the foreground response's `responseId`, so the
  runtime may enqueue one hidden continuation containing only events from that
  response;
- **passive result**: the event belongs to an older response or has no stable
  response identity. The runtime marks it consumed without invoking the model.

Events from different responses are never mixed into one continuation and an
inbox continuation never uses a null `responseId`. Runtime continuations have
lower queue priority than explicit input. A new foreground input also supersedes
queued or active runtime-owned continuations from older responses. It does not
interrupt an explicit user task or parent-Agent Quest already in progress;
interrupting those remains an explicit caller policy.

Passive results remain available through the immutable Quest/message records and
the Agent inbox for diagnostics. Inbox is a push-based internal delivery
mechanism, not a model polling API. Parents recover exact task state through
bounded `agent.read`, `quest.read`, and `quest.result` calls instead of manually
driving inbox delivery.

## Message Records

Messages are append-only runtime facts. `message.read` retrieves one known
message id, while trusted host code may use `aiditor.ai.agent.messages()` for a
bounded transcript view. The model tool surface intentionally has no message
list, edit, or delete operation: rewriting history could invalidate provider
message order, tool-call/result pairing, compaction records, and audit trails.

## Active Run State

The runtime exposes lightweight live state for UI:

```js
aiditor.ai.activeRunState(agentId)
aiditor.ai.peekActiveRunState(agentId)
aiditor.ai.setActiveRunState(agentId, patch)
```

This state tracks:

```text
state
runId
traceId
previewTail
modelTail
activityText
startedAt
firstTokenAt
completedAt
usage
outputTokens
totalTokens
cost
error
```

The message UI should render this state cheaply so long conversations do not
force full transcript re-rendering.

## Context Budget And Compaction

The runtime prompt is a budgeted view over the agent transcript, not the
transcript itself.

Current implementation already estimates context size and keeps the newest
messages inside the model budget. The final design is semantic compaction:
closed older transcript ranges become auditable compaction records, while the
raw transcript remains the source of truth.

Implemented APIs:

```js
aiditor.ai.compaction.configure(options)
aiditor.ai.compaction.plan(agentId, input)
aiditor.ai.compaction.run(agentId, plan)
aiditor.ai.compaction.records(agentId)
aiditor.ai.compaction.clear(agentId, options)
```

Implemented command wrappers:

```text
ai.compactCurrentAgent
ai.clearCurrentAgentCompactions
ai.listCurrentAgentCompactions
```

See [ai-context-compaction.md](./ai-context-compaction.md).

## Message UI Performance

The AI panels are normal registered UI components, but their rendering rules are
stricter than ordinary panels because transcripts can become very large.

Implemented panel-side pieces:

```text
ai-messages
ai-chatinput
ai-chat
message-live-strip
message-virtualizer
```

`ai-chatinput` has one layout option. `standard` is the default multiline
composer. `inline` keeps the same attachments, permission, model, context, send,
and stop behavior in one compact row, with the prompt between the permission and
model controls:

```js
{
  component: 'ai-chatinput',
  props: { layout: 'inline' },
}
```

The combined panel forwards the same input contract:

```js
{
  component: 'ai-chat',
  props: { input: { layout: 'inline' } },
}
```

In this layout `ai-chat` sizes the composer from its content and omits the
multiline height splitter. Layout is panel configuration rather than an
in-composer preference, so the framework does not add a mode-switch button.
Internally the prompt uses `aiditor.ui.richPromptInput({ singleLine: true })`:
Enter submits, Shift+Enter cannot insert a line break, pasted line breaks become
spaces, and reference tokens retain their normal behavior.

`aiditor.ai.agentVersion(agentId)` is the keyed lifecycle/configuration revision
selector used by panels that depend on related Agents. It is intentionally
separate from per-message versions, so descendant streaming tokens do not force
the parent transcript to recompute response-tree metrics.

Rules:

1. The transcript renders only the visible window plus small overscan.
2. The live strip reads phase/preview data from `activeRunState`, but reads elapsed
   time and cumulative usage from `ai.response.read`; a new provider turn must not
   reset response-level metrics.
3. Streaming text, reasoning text, tool deltas, activity text, usage, and errors
   should update live state first.
4. Expanding a tool card is local UI state and should not be reset by unrelated
   stream chunks.
5. Long conversations should remain cheap because the number of mounted message
   rows is bounded by viewport size, not message count.
6. Streaming plain text patches its existing text node. Rich Markdown reparses
   only the changing text part while preserving its root and the surrounding
   message row.

The live strip is diagnostic UI. It should show the latest model/provider bytes
as soon as the runtime receives them while retaining response-level cumulative
metrics, then collapse back to idle only when the response is done.

## Trace And Audit

Every run creates a `runId`. The AI runtime exposes a compact append-only trace:

```js
aiditor.ai.trace.events()
aiditor.ai.trace.append(event)
aiditor.ai.trace.list(filter)
aiditor.ai.trace.clear(filter)
```

Provider requests, model messages, tool preview/run/apply phases, approval
waits, completion, stop, and failure events use the same `runId` as `traceId`.
Permission decisions remain in `aiditor.ai.permissionAudit`; host adapters and
workspace mutation layers should include the same `runId` when they have it.

The runtime should be able to answer:

```text
which user message started this run
which provider request produced this chunk
which tool call mutated this resource
which permission decision allowed or denied it
which resource version was inspected and committed
```

This trace is diagnostic infrastructure, not a new model-facing concept. It
connects `aiditor.log`, tool cards, ChangeSet review, provider usage, and the
permission audit log.

Trace events are deliberately compact. Large tool results, full files, and
provider payloads stay in transcript/tool/result storage; trace only records the
timeline and enough metadata to debug "what happened and why".

Provider completion failures use stable codes:

```text
PROVIDER_OUTPUT_TRUNCATED
PROVIDER_CONTENT_BLOCKED
PROVIDER_INTERRUPTED
TOOL_PROTOCOL_INVALID
TOOL_ARGUMENTS_INVALID_JSON
TOOL_ARGUMENTS_SCHEMA_INVALID
TOOL_ARGUMENTS_RECOVERY_FAILED
```

The raw `finishReason` is preserved in message metadata and trace events. The
runtime does not silently convert these failures into `idle`, and it does not
execute text that only imitates a tool call.

Invalid Tool arguments use one run-scoped correction state machine. Normalization
and original-schema validation remain a whole-response barrier, so mixed
valid/invalid batches execute zero Tools. A fully strict batch first gets one
hidden constrained regeneration of the exact Tool set. Other failures become
failed Tool calls with structured Tool Results and continue through the ordinary
Agent turn. This visible path also serves `json` and `structured` connections
without pretending that their generation is schema-constrained.

Parseable arguments are retained on the failed ToolCall and replayed unchanged to
the Provider. Traces and error metadata receive only a bounded canonical summary
and stable hash. Schema diagnostics expose a stable keyword and prefer concrete
branch errors. A `oneOf`/`anyOf` branch is selected only when every object branch
declares the same unique `const` or single-value `enum` discriminator; otherwise
the Host reports the generic union failure and does not infer a domain shape.
Candidate discovery follows Schema property order and ignores fields that are
not declared by every branch, so input key order and partial branch shapes cannot
turn a validation failure into a Runtime exception.

The default `maxToolArgumentCorrections` is two. A repeated fingerprint includes
the Tool id, canonical argument hash, and concrete error result, so different
arguments may continue within the budget while an identical failed call stops.
An exhausted budget ends the turn; successful correction executes the resulting
batch once. Corrections retain the same run, actor, permissions, execution
budget, and abort signal and cannot bypass preview/approval. Network,
authentication, cancellation, and budget failures remain terminal. Final
diagnostics state whether hidden recovery was attempted and whether the error is
still retryable.

## Tool Call Lifecycle

Tool calls have a lifecycle:

```text
proposed
previewed
approved
running
completed
applying
applied
rejected
failed
```

For ordinary Tools, the semantic and execution identities are the same. A
request-local Operation projection keeps them separate:

```text
toolId / args                  operation id and direct operation input
executorToolId / executorArgs hidden canonical gateway and { op, input }
```

Only the first pair is user/model-visible and appears in traces, errors, Tool
Results, permission entries, and provider replay. The executor pair exists only
to reuse the registered preview/apply lifecycle without creating a second Tool
or Operation system.

Implemented APIs include:

```js
aiditor.ai.createToolCall(agentId, spec, actor)
aiditor.ai.attachToolCalls(agentId, messageId, calls, actor)
aiditor.ai.previewToolCall(agentId, callId, actor)
aiditor.ai.approveToolCall(agentId, callId, actor)
aiditor.ai.rejectToolCall(agentId, callId, reason, actor)
aiditor.ai.runToolCall(agentId, callId, actor)
aiditor.ai.applyToolCall(agentId, callId, actor)
aiditor.ai.getToolCallActionState(agentId, callId, actor)
aiditor.ai.setToolAlwaysAllowed(agentId, toolId, allowed)
```

Failed calls should display failure and must not show apply controls.

Tool execution, operation apply, ChangeSet apply, extension install, workspace
mutation, and host-adapter calls all go through the resolver in
[ai-permission-policy.md](./ai-permission-policy.md). "Always allowed" is a
scoped cached decision, not a global bypass.

## Request Context Hooks

The runtime can assemble request context from small registered contributors.
These hooks are implementation helpers for prompt construction; they are not a
new model-facing registry beyond tools/context/operations.

Implemented APIs:

```js
aiditor.ai.context.register(name, provider)
aiditor.ai.context.get(name)
aiditor.ai.context.list()
```

Context providers may add compact state such as active selection, workspace
metadata, available UI affordances, or domain-specific guide text. Prefer
registered context entries for information the model should be able to request by
URI, search, or read on demand.

Reference providers turn normalized references into readable content:

```js
aiditor.ai.references.register(name, provider)
aiditor.ai.references.read(ref, options, ctx)
```

Use reference providers for URI/kind/meta pointers. Use `aiditor.ai.context`
for compact run-level context that should be included with a model request.

## Agent Templates And Bundles

The runtime also exposes small host-level registries:

```js
aiditor.ai.agentTemplates.register(name, template)
aiditor.ai.agentTemplates.unregister(name)
aiditor.ai.agentTemplates.unregisterPrefix(prefix)
aiditor.ai.agentTemplates.get(name)
aiditor.ai.agentTemplates.list(prefix)

aiditor.ai.bundles.register(name, bundle)
aiditor.ai.bundles.unregister(name)
aiditor.ai.bundles.unregisterPrefix(prefix)
aiditor.ai.bundles.get(name)
aiditor.ai.bundles.list(prefix)
```

Agent templates are presets for creating agents. They are not a separate agent
type.

`aiditor.ai.bundles` is only a convenience registry for registering AI runtime
entries together, such as connections, skills, tools, context providers, and
agent templates. It is not an Extension replacement; framework-wide packaging
belongs to `aiditor.extensions`.

## Persistence

Implemented persistence APIs:

```js
aiditor.ai.snapshot()
await aiditor.ai.save()
aiditor.ai.restore()
aiditor.ai.configurePersistence(options)
await aiditor.ai.clearStoredState()
await aiditor.ai.persistence.ready()
await aiditor.ai.persistence.flush()
```

Persistence belongs to the AI runtime. Domain persistence remains outside
AIditor Core.

Local browser persistence writes the complete JSON-safe transcript to IndexedDB.
The small `localStorage` record contains Agent bootstrap metadata only. Model
context compaction and optional runtime checkpoints remain separate projections;
neither is the transcript archive. See
[ai-persistence.md](./ai-persistence.md).

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
stream
permissionMode
messages
queue
quests
inbox
toolRefs
skillRefs
contextRefs
```

Parent/child is an agent relationship, not a new runtime layer.

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
aiditor.ai.skills.register(name, skill)
aiditor.ai.skills.unregister(name)
aiditor.ai.skills.unregisterPrefix(prefix)
aiditor.ai.skills.get(name)
aiditor.ai.skills.list(prefix)
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

Transcript display uses the normalized message part pipeline defined in
[ai-message-rendering.md](./ai-message-rendering.md). Provider-specific content
blocks normalize into common parts such as text, code, image, file, reference,
attachment, error, and fallback card. Host projects may register display-only
renderers for domain card kinds without changing the built-in transcript panel.
Ordinary text is rendered as safe Markdown; structured provider blocks and host
cards continue through the renderer registry.

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

## Run Scheduler

The runtime owns one clear run loop per agent. It schedules work, streams model
output, executes tools, waits for approval, resumes after tool results, and
records completion or failure.

Implemented abilities:

```js
aiditor.ai.scheduleAgent(agentId)
aiditor.ai.stopAgent(agentId, actor)
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

The built-in Agents panel creates user-facing agents with the focused
`orchestration` skill. Hosts using `aiditor.ai.createAgent()` directly choose
their own `skillRefs`; no global tool set is injected as a fallback.

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
```

Built-in orchestration tools include:

```text
agent.read
agent.create
agent.delegate
agent.reparent
agent.delete
agent.send
agent.stop
quest.read
quest.result
message.read
```

These tools are part of the AI runtime, not product domain tools.

`agent.read({})` lists every agent readable by the caller. Passing `agentId`
returns the full readable record. There is no separate `agent.list` concept.

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

## Inbox

Agents receive completion events through inbox events. This prevents child-agent
completion from interrupting an unrelated current run.

Implemented abilities:

```js
aiditor.ai.appendInboxEvent(agentId, event)
aiditor.ai.markInboxEventConsumed(agentId, eventId)
```

The runtime can enqueue a continuation when actionable inbox events exist.

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

Rules:

1. The transcript renders only the visible window plus small overscan.
2. The live strip reads `activeRunState` and updates independently from the full
   transcript.
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
as soon as the runtime receives them, then collapse back to idle when the run is
done.

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
aiditor.ai.save()
aiditor.ai.restore()
aiditor.ai.configurePersistence(options)
aiditor.ai.clearStoredState()
```

Persistence belongs to the AI runtime. Domain persistence remains outside
AIditor Core.

Local browser persistence is a compact recovery snapshot, not a full transcript
archive. The runtime must write bounded, deterministic snapshots, compact before
writing when the payload exceeds the configured budget, and avoid repeated quota
error loops. See [ai-persistence.md](./ai-persistence.md).

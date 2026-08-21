# AI Runtime

## Ownership

The AI Host keeps six model-facing concepts: Agent, Skill, Tool, Context
Reference, Operation, and ChangeSet.

```text
src/ai/agent/      Agent state, request, Run, orchestration, persistence
src/ai/skill/      stateless instructions, catalog, read/list, packages
src/ai/tool/       executable registry, ToolCall lifecycle, scheduling
src/ai/context/    factual request context, targets, Rich Prompt
src/ai/operation/  grouped review/apply
src/ai/provider*   provider protocol and transport
```

Agent owns conversation and execution state. Skill owns instructions. Tool owns
execution. Permission owns authorization. These concerns never grant or mutate
one another.

## Agent

An Agent profile stores model/connection configuration, optional
`systemPrompt`, context references, transcript, queue, quests, memory,
permissions, and runtime status. It does not store Tool or Skill capability
lists.

The default system prompt is:

```text
You are an AI agent.
Complete the user's request using the capabilities available in the current request.
Treat the current workspace, runtime state, and Tool results as the source of truth.
Never claim an action that was not completed.
If blocked, state the exact blocker.
Keep responses concise, clear, and limited to what is necessary.
```

`systemPrompt == null` uses this default. Any string replaces it completely;
an empty string omits the runtime system prompt. Framework instructions are
never appended to a project override.

## Request and Run

One Run starts from one user input and may contain multiple provider Turns due
to Tool calls. Explicit Skill instructions remain attached to that input across
those Turns without becoming persistent state.

A Run has no default turn, token, or wall-clock limit. Long work continues
through ordinary Tool Turns and context compaction until it completes, is
cancelled, becomes genuinely blocked, or encounters an unrecoverable error.
Hosts and delegated tasks may set `maxTurns`, `maxTokens`, or `timeoutMs` as
explicit budgets. Those values are opt-in policy, not hidden framework limits.
An unconstrained Run stores no budget; it does not materialize a placeholder
object filled with null limits.

For a Tool-capable connection, request assembly begins with `skill.read` and
adds `skill.list` only when the bounded catalog omitted entries. It then adds
currently available Tools from `always` Skills, explicitly selected Skills, and
successful main `skill.read` calls still present in conversation context.
Resource-only reads do not project Tools. Other registered Tools do not consume
provider-schema tokens until their Skill is selected or read.

Provider Tool calls are normalized from provider aliases and projection routes,
then executed by canonical Tool name and arguments. The execution path is:

```text
Tool Registry lookup
→ current available(ctx)
→ input schema validation
→ Permission decision/approval
→ preview/run/apply
→ normalized Tool result
```

There is no request capability snapshot, callable layer, Skill activation, or
loaded-Skill state. Request-local Tool projection is derived from Skill
configuration plus the visible transcript. Provider projection metadata is used
only to decode aliases and route direct Operation projections to their canonical
gateway.

## Tool Runtime

`ai.tools.invoke(name, args, ctx, phase)` is the internal execution primitive.
It resolves the registered Tool, rechecks current availability, validates input,
and invokes the requested phase. The persisted ToolCall lifecycle surrounds
this primitive with permission, preview/apply approval, tracing, cancellation,
deadlines, and result delivery.

An ordered Tool batch pauses at the first approval boundary. After that call is
resolved, the Run resumes the remaining ToolCalls in the same assistant message;
only a fully terminal batch may continue to the next provider Turn. ToolCall
statuses are the sole batch progress state.

A function that must not be model-callable is an internal API, not a Tool.
Sensitive Tools remain safe through `available(ctx)` and Permission, not model
visibility flags.

## Orchestration

Child Agents inherit runtime environment through the Host. Delegation accepts
task, model, connection, system prompt, output schema, context references, and
budget; it does not accept Skill or Tool ids. Agent ancestry and Permission
continue to bound read, send, configure, stop, and quest operations.

`agent.delegate` is the direct path when an Agent should perform work.
`agent.create` creates an idle profile only.

## Persistence and compaction

Persistence stores the complete Agent transcript and durable Agent fields.
There is no Skill activation state to persist or restore. Compaction operates on
messages and memory; when it removes a `skill.read` ToolCall from request context,
that Skill can be read again when its Tool schemas are needed.

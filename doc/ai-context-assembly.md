# AI Context Assembly

## Request order

`src/ai/agent/request.js` builds deterministic context in this order:

1. default or fully overridden Agent system prompt;
2. structured output contract, when configured;
3. complete compact Skill catalog;
4. explicitly selected Skill instructions, when present;
5. workspace, task, runtime Context, attachments, compaction/memory, inbox, and queue cards;
6. budgeted conversation messages.

Native Tool schemas are sent only through the provider `tools` field. The Skill
catalog contains one line per included Skill with id, concise description, and
Tool count. It does not duplicate Tool names, titles, descriptions, schemas, or
owner metadata.

## Skill catalog

The catalog uses at most 2% of the Agent context budget and never more than
2,000 tokens. It shortens descriptions before omitting entries. If entries are
omitted, the catalog reports the count and the request exposes deterministic
cursor-based `skill.list`; otherwise `skill.list` is absent. Complete
instructions are returned by `skill.read` or injected by an explicit Rich
Prompt Skill token.

## Tool surface

After factual request Context is captured, request assembly selects bootstrap,
`always`, explicitly selected, and context-read Skill Tools. It then
evaluates each selected Tool's `available(ctx)` predicate and projects only
available Tools to provider schema. Context providers cannot add or authorize
Tools.

A successful `skill.read` is identified from the structured ToolCall and Tool
result already present in the visible transcript. No second activation or
loaded-Skill state is maintained. A read with `resource` does not project Tools.

Tool execution rechecks current availability because runtime state may change
between request construction and execution. This is an ordinary Tool predicate,
not a stored request snapshot.

## Budgeting

Required context cards are bounded independently. Conversation history is kept
in complete semantic groups so assistant Tool calls stay paired with Tool
results. Current input is always retained. Large attachments and runtime values
are summarized before transcript budgeting.

## Debugging

When `ai.debug.logProviderRequest` is enabled, the provider boundary prints the
exact serialized request body sent over the network. The log includes final
messages, Tool schemas, model, and provider parameters after all assembly and
adapter transformations.

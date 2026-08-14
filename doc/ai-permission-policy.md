# AI Permission Policy

## Goal

Permission is one resolver, not a collection of per-tool special cases. Any
model-controlled action asks the resolver before it reads privileged context,
previews a mutation, applies a mutation, installs code, or calls a host adapter.

## Decision Input

Every decision is described by the same shape:

```text
actor        user | agent | extension | system
agentId      optional agent identity
entry        tool / operation / changeset / extension / adapter name
phase        read | preview | apply | run | install | delete
target       file, dock, setting, registry prefix, adapter command, or host root
workspace    active workspace root id when relevant
origin       builtin | extension:<id> | host:<id> | demo:<id>
risk         read | write | delete | execute | network | install
baseVersion  optional ResourceVersion inspected during preview
```

## Actor Semantics

`actor` is the caller asking for the action. It may be the user, an agent, an
extension, or system code acting through an explicit host policy.

`targetAgentId` is the agent run or conversation the action belongs to. It is not
automatically the actor. Helpers must preserve this distinction:

```text
canRead(actor, target, scope)
canSend(actor, target)
canManage(actor, target)
permissions.decide(actor, targetAgentId, scope, details)
permissions.decideMany(actor, targetAgentId, scope, targets)
```

Using the target agent as the actor silently widens permissions for delegated
agents and provider/runtime hooks, so it is a contract violation.

The actor that supplied a user message remains available to Context and
Reference hydration. Provider-emitted Tool calls are always attributed to the
running Agent; a user-originated prompt never turns subsequent model actions
into user actions. A transcript approval executes only that exact ToolCall as
the user.

The resolver returns:

```text
allow
deny
ask
unavailable
```

`unavailable` means prerequisites are missing, such as no workspace or no host
adapter. It must not render approval/apply controls.

## Policy Modes

Common host modes are only presets over the same resolver:

```text
read only              allow low-risk reads, deny mutations
ask before write       ask for write/delete/execute/install
full access workspace  allow declared writes inside the granted workspace
custom                 host-provided matrix
```

Full access is scoped. It does not automatically allow hidden tools, extension
code install, shell execution, network calls, or writes outside the granted
workspace.

## Scoped grants

"Always allow" is not a global bypass. It is a cached resolver decision scoped
to:

```text
agentId + entry + phase + target + workspace + origin + risk + contract
```

The Tool transcript may create or revoke these exact grants. Its localized
"Remember" control records approval intent only: the grant is persisted after
that ToolCall applies successfully, while rejection or execution failure never
creates a grant. Grants support expiry and are stored with the Agent. A changed
workspace root, extension origin, tool schema, or risk classification invalidates
the cached decision.

## Audit

Every decision writes a permission audit record. Executed actions remain in the
run trace, linked by the same run and entry fields:

```text
traceId
runId
agentId
messageId
entry
phase
target
origin
risk
decision
reason
baseVersion
resultVersion
startedAt
finishedAt
error
```

Audit records power logs, transcript tool cards, ChangeSet review, and debugging
of "why did the agent do that?" questions.

## Required Call Sites

These all use the same resolver:

```text
tool run
operation preview
operation apply
ChangeSet apply
workspace write/patch/delete
extension install/update/enable
host adapter call
context/reference read when it exposes non-public host state
```

A module may add helper APIs, but it must not invent a second permission system.

Tool permission calls should pass the current run metadata when available:

```text
runId
traceId
messageId
risk
capabilities
```

This keeps `permissionAudit` aligned with run trace, tool cards, and approval UI
without changing the permission resolver contract.

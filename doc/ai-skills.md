# AI Skills

`aiditor.ai.skills` is the behavior-profile layer of the optional AI Host. A
skill explains how an Agent should approach a class of work and which existing
tools may be disclosed for that work. It is not an executable plugin, a second
tool registry, a permission grant, or a project workflow.

## Boundary

```text
Skill       instructions, rules, discovery metadata, tool references
Tool        executable behavior guarded by availability and permission
Context     request-time captured state
Reference   on-demand readable knowledge
Operation   preview/apply mutation protocol
```

Activating a skill never makes an unavailable or unauthorized tool usable. A
skill only names entries in the shared Tool registry; request construction still
applies tool availability, connection capability, and permission rules.

## SkillSpec

```js
aiditor.ai.skills.register('review.code', {
  title: 'Code Review',
  description: 'Review a bounded code change for defects and regressions.',
  whenToUse: 'Use for review requests after the relevant files are available.',
  whenNotToUse: 'Do not use for implementing unrelated features.',
  systemPrompt: 'Review behavior and correctness before style.',
  rules: [
    'Lead with actionable findings.',
    'Ground findings in the available source.',
  ],
  examples: [],
  tools: ['workspace.readTextRange', 'workspace.searchFiles'],
  relatedApis: [],
  resources: [],
  auto: function (requestContext) { return false },
}, {
  owner: 'extension:review',
  layer: 'app',
  source: 'extension:review',
})
```

The registry normalizes the public id and list fields and computes a stable
content fingerprint. Registration metadata is separate from model-facing skill
content:

```text
owner    exact lifecycle identity
layer    diagnostic/runtime contribution layer
source   human-readable origin such as builtin, extension id, or package root
hash     stable content fingerprint or adapter-provided file hash
```

`auto(ctx)` is an optional host predicate. It is evaluated once while building
a request and runs at the user-contribution boundary. It selects a skill; it
does not execute a task or mutate Agent configuration.

## Registry API

```js
aiditor.ai.skills.register(name, spec, meta?)
aiditor.ai.skills.unregister(name, { owner? }?)
aiditor.ai.skills.unregisterOwner(owner)
aiditor.ai.skills.unregisterPrefix(prefix)
aiditor.ai.skills.get(name)
aiditor.ai.skills.list(prefixOrFilter?)
aiditor.ai.skills.meta(name)
```

`list({ owner, layer, source })` filters registration metadata. Duplicate public
ids throw unless the caller explicitly passes `replace: true`. Layers do not
silently shadow each other; replacement is always an explicit host decision.

Runtime script and Extension owners use the same exact-owner cleanup contract as
tools, context providers, references, and operations.

## Activation

An effective request can activate a skill from three sources:

```text
configured    the Agent profile contains the skill id in skillRefs
runtime       a framework runtime rule selects a built-in skill for this request
auto          the registered SkillSpec.auto predicate matches
```

Configured activation wins when more than one source selects the same skill.
Missing or unloaded ids remain in the Agent profile but are not reported as
active and expose no prompt or tools.

Request construction returns `skillActivations`. The trace emits one
`skill_activated` event per effective skill and keeps aggregate ids and prompt
characters on `request_built`:

```js
{
  id: 'review.code',
  reason: 'configured',
  owner: 'extension:review',
  layer: 'app',
  source: 'extension:review',
  hash: 'aiditor-fnv1a-...',
  promptChars: 240,
  toolRefs: ['workspace.readTextRange', 'workspace.searchFiles'],
}
```

This is diagnostic attribution, not a second runtime state store. Evals can use
the existing trace timeline to assert that a skill was or was not activated.

## Progressive Disclosure

AIditor uses three bounded levels:

1. Inactive skill metadata: id, title, description, and use guidance.
2. Active skill instructions: `systemPrompt` and `rules` enter the request.
3. Package resources: reference files are read only when requested through the
   skill reference provider.

The orchestration skill receives a compact catalog so it can assign only the
needed `skillRefs` to a child. Child Agents do not implicitly inherit the
parent's skill or tool surface.

Skill references use:

```text
aiditor://skills
aiditor://skills/<skill-id>
aiditor://skills/<skill-id>/resources/<resource-path>
```

## File-backed Packages

Hosts may load a standard folder containing `SKILL.md` from any bounded
workspace adapter:

```js
await aiditor.ai.skills.loadPackage({
  workspace: projectWorkspace, // defaults to aiditor.ai.currentWorkspace()
  root: '.agents/skills/code-review',
  id: 'review.code',            // optional; otherwise frontmatter name
  tools: ['workspace.readTextRange', 'aiditor.readReference'],
}, {
  owner: 'workspace:project',
  layer: 'workspace',
})
```

The package loader:

- reads `<root>/SKILL.md`;
- requires `name` and `description` frontmatter;
- uses the Markdown body as the active skill instructions;
- indexes `references/`, `assets/`, and `scripts/` without eagerly reading
  their contents;
- permits on-demand text reads only from indexed `references/` files;
- records the source path and file hash in registration metadata.

```js
aiditor.ai.skills.loadPackage(input, meta?) // Promise<SkillSpec>
aiditor.ai.skills.readResource(skillId, path) // Promise<ResourceResult>
```

`tools` is trusted host configuration, not authority taken from Markdown
frontmatter. Package scripts are metadata only: AIditor never executes arbitrary
skill scripts. A host that needs executable behavior must register a normal Tool
through the existing permission system.

Packages that expect the model to read indexed reference files include
`aiditor.readReference` in trusted `tools`. The loader does not add it
implicitly, because loading documentation must not silently widen an Agent's
tool surface.

The package root is workspace-relative. Parent traversal and reads outside the
indexed package resources are rejected. Resource discovery is bounded and fails
clearly when the configured maximum is exceeded; it never silently loads an
unbounded skill directory.

## Non-goals

AIditor Skills do not provide:

- a package marketplace or dependency solver;
- implicit skill inheritance;
- arbitrary script execution;
- a second permission or tool system;
- project/domain semantics;
- hidden layer precedence or automatic replacement;
- dynamic mutation of the provider tool schema during a running turn.

These boundaries preserve the framework's zero-dependency browser runtime while
allowing hosts and extensions to supply portable, inspectable skill packages.

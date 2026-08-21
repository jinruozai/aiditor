# AI Skills

## Contract

A Skill is a stateless, owner-scoped instruction package and the model-facing
organization unit for related Tools. It has no activation, enabled, loaded, or
availability state.

Every registered Skill appears in the bounded request catalog when it fits.
`toolDisclosure` controls whether its Tool schemas are sent before the Skill is
read:

```js
aiditor.ai.skills.register('scene.authoring', {
  title: 'Scene Authoring',
  description: 'Inspect and edit scene entities.',
  argumentHint: '[scene task]',
  instructions: 'Read current scene state before applying semantic edits.',
  toolDisclosure: 'onRead',
  tools: ['scene.read', 'scene.update'],
  resources: [{ path: 'references/components.md', kind: 'reference' }],
  readResource: function (path) {},
}, { owner: 'extension:scene', layer: 'extension' })
```

`SkillSpec` contains:

- `title`
- `description`
- `argumentHint`
- `instructions`
- `toolDisclosure`: `always | onRead`, default `onRead`
- `tools`
- `resources`
- optional `readResource(path)`

Owner metadata is supplied to `register`, not duplicated in the Skill.

## Tool disclosure

The catalog is a line-oriented list of Skill id, concise description, and Tool
count. It never duplicates Tool names, descriptions, titles, owner metadata, or
schemas. When some registered Tools are currently unavailable, the count uses
`available/registered`; otherwise it displays one total.

| Value | Provider Tool schema |
| --- | --- |
| `onRead` | Included after `skill.read({ id })` or explicit Skill selection |
| `always` | Included in every request while currently available |

Skill definitions store Tool ids only. Native schemas stay in the provider
`tools` field. Disclosure is context selection, not activation or authorization.

## Discovery, reading, and direct calls

Every request receives a bounded Skill catalog. The normal progressive
disclosure Tool is:

```js
skill.read({ id, resource? })
```

The catalog uses at most 2% of the Agent context budget, capped at 2,000 tokens.
It shortens descriptions before omitting entries. Only when entries are omitted
does the request expose deterministic pagination:

```js
skill.list({ cursor?, limit? }) // { skills, total, nextCursor }
```

Following `nextCursor` enumerates every Skill. There is no semantic Skill search
whose misses could be mistaken for absence.

A successful `skill.read({ id })` call and its result already belong to the
conversation transcript. On the following provider Turn, request assembly
recognizes that visible structured ToolCall and includes the Skill's currently
available Tool schemas. The model then calls those Tools directly by name and
arguments.

`skill.read({ id, resource })` reads only that resource and does not project the
Skill's Tools.

A main read returns only `id`, `instructions`, readable resource paths/kinds,
and current/total Tool counts. Model-facing Skill Tools never return owner,
layer, source, hash, Tool ids, or copied Tool schemas.

There is no parallel loaded-Skill collection, activation record, expiry rule,
or persisted capability state. If compaction removes the read call from model
context, its Tool schemas naturally stop being projected and the Skill can be
read again.

An explicit Slash/Rich Prompt Skill token injects the complete instructions and
projects the Skill's available Tool schemas immediately for that request and its
Tool continuations. It also creates no stored Skill state.

Default provider Tools are exactly:

```text
skill.read
+ skill.list only when the catalog omitted entries
+ available Tools from toolDisclosure: always Skills
+ available Tools from explicitly selected Skills
+ available Tools from Skills read in visible conversation context
```

Tool Runtime independently rechecks `available(ctx)`, validates arguments, and
applies Permission. Skill disclosure never authorizes a Tool.

## Built-in defaults

Editor Control uses `always`. Other built-in Skills use `onRead`. Host projects
and Extensions configure their own Skills; omission defaults to `onRead`.

## Packages

`ai.skills.loadPackage` loads bounded workspace packages with a required
`SKILL.md`. YAML frontmatter supplies `name`, `description`, and optional
`argument-hint` and `tool-disclosure`; the Markdown body becomes `instructions`.
Callers may also supply `toolDisclosure` and Tool ids when loading the package.

Only files under `references/`, `assets/`, and `scripts/` are indexed. Only
`reference` resources are readable through `skill.read({ id, resource })`.
Package paths remain workspace-relative and cannot traverse outside the package.

## Removed concepts

The architecture contains no `skill.search`, `skill.activate`, `skillRefs`,
active/configured status, activation lifetime, model/user invocability split,
or Skill availability predicate. `skill.list` is only bounded catalog overflow
pagination; it does not load or activate anything.

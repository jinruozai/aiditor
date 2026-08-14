# AI Skills

`Skill` is the only capability-selection surface exposed to an Agent or project.
It packages one focused intent, the instructions needed for that intent, and the
internal Tools that implement it.

```text
Agent / user / model
        │ selects
        ▼
      Skill ── instructions + Tool ids
        │
        ▼
 Tool availability ── Permission ── execution
```

This separation is strict:

- Agent profiles contain `skillRefs`, never Tool ids.
- Context providers capture facts and never contribute Tools.
- References describe resources and never contribute Tools.
- Skills make Tools discoverable; they do not bypass Tool availability or
  Permission.
- Tools remain the provider-facing execution protocol, not the project-facing
  capability catalog.

## SkillSpec

```js
aiditor.ai.skills.register('project.scene-authoring', {
  title: 'Scene Authoring',
  description: 'Inspect and edit the current scene.',
  argumentHint: '[scene task]',
  userInvocable: true,
  modelInvocable: true,
  whenToUse: 'Use for scene entity and component changes.',
  whenNotToUse: 'Do not use for raw repository maintenance.',
  systemPrompt: 'Edit the scene through semantic operations.',
  rules: ['Read current state before applying changes.'],
  tools: ['project.scene.read', 'project.scene.apply'],
  relatedApis: ['project.scene'],
  docPath: 'skills/scene-authoring/SKILL.md',
  available: function (ctx) { return !!ctx.scene },
  unavailableReason: 'Open a scene first.',
}, {
  owner: 'project:game',
  layer: 'project',
  source: 'skills/scene-authoring',
})
```

`owner` is required. It identifies the exact lifecycle boundary. Dotted Skill
ids are names and discovery keys; they are not ownership.

`userInvocable` controls the composer `/` catalog. `modelInvocable` controls
`skill.list` and `skill.activate`. `available(ctx)` is evaluated for every
request and activation. An unavailable configured or explicit Skill grants no
Tools and its reason remains visible in the Skill catalog.

Automatic keyword predicates are deliberately unsupported. The host must not
guess intent with framework-owned phrase matching.

## Activation

There are three explicit activation sources:

| reason | source | lifetime |
| --- | --- | --- |
| `explicit` | `/skill`, rich-prompt Skill token, request `skillRefs` | current run |
| `configured` | `agent.skillRefs` | Agent profile |
| `selected` | model call to `skill.activate` | current run |

Every tool-capable request also exposes two system controls:

- `skill.list({ query?, limit? })`: bounded current Skill catalog. Every entry
  distinguishes host capability `available` from current-run `active`, reports
  whether it is profile `configured`, and exposes `lifetime: "run" | "agent"`.
- `skill.activate({ id })`: activate one available model-invocable Skill for
  the current run.

Activation is run-scoped. It survives Tool continuations and approval waits,
then is released on completion, failure, or cancellation. It never mutates the
Agent profile or leaks into the next user task.

If a provider calls a registered Tool that belongs to an available but inactive
Skill, Runtime returns a structured `SKILL_ACTIVATION_REQUIRED` Tool result with
the canonical `toolId`, original `providerName`, candidate `skillIds`,
`lifetime: "run"`, and a recovery hint. This is distinct from an unknown Tool
or a Tool unavailable for another runtime reason. A Skill that must remain
active across requests belongs in the Agent profile `skillRefs`; that
configuration is part of the persisted Agent snapshot and may be changed only
by its user, host, or parent Agent—not by the Agent itself.

Request Tool ids are exactly:

```text
skill.list + skill.activate + union(activeSkill.tools)
  -> remove missing/unavailable Tools
  -> project dynamic Operation tools
  -> provider schema preparation
```

There is no all-Tools fallback.

## Built-in Skills

| id | responsibility |
| --- | --- |
| `aiditor.framework-authoring` | Core/UI/Dock/theme/host application development |
| `aiditor.runtime-authoring` | workspace-backed live panel authoring and dock placement |
| `aiditor.ai-host-authoring` | Agent/Skill/Tool/Context/provider/permission development |
| `aiditor.extension-authoring` | Extension manifest and contribution development |
| `aiditor.editor-control` | selection, Reference, and semantic Operation control |
| `aiditor.workspace-authoring` | bounded generic file and code work |
| `aiditor.verify-changes` | host-provided checks and diagnostics |
| `aiditor.version-control` | host-provided Git operations |
| `aiditor.extension-management` | installed Extension lifecycle |
| `aiditor.agent-orchestration` | child Agents, quests, and messages |

The ids are focused and non-overlapping. There is no compatibility umbrella.

## Package loading

`aiditor.ai.skills.loadPackage()` loads a standard `SKILL.md` directory from a
bounded workspace. It reads `SKILL.md`, lists the package root once, and walks
only standard subdirectories that actually exist:

- `references/`
- `assets/`
- `scripts/`

Unknown directories and `agents/` are ignored. Only `references/` resources
are readable through the Skill reference provider. Assets and scripts are
metadata only; the loader never executes them. Path containment and resource
limits apply to every package.

```js
await aiditor.ai.skills.loadPackage({
  root: 'skills/review',
  tools: ['workspace.readTextRange'],
}, { owner: 'project:game' })
```

Use `aiditor.runtime.unloadOwner('project:game')` or the corresponding Registry
`unregisterOwner()` to remove all contributions owned by the project.

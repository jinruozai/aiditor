# AIditor Skills

This directory stores copyable AI skills for agents that need to work inside
AIditor projects, live AIditor editor runtimes, or host apps.

The framework also ships runtime skills in `src/ai/skills.js`. They are loaded
by `aiditor-ai` and `aiditor-full`, and can be attached to AIditor agents
through `agent.skillRefs`.

Use the document form when an external AI system, a host app, or a project
workspace needs the same guidance outside the bundled runtime.

An AIditor host can also load one of these folders into the runtime through
`aiditor.ai.skills.loadPackage({ workspace, root }, meta)`. The loader reads
`SKILL.md`, indexes `references/`, `assets/`, and `scripts/`, and exposes only
reference text for on-demand reads. Scripts are never executed by the Skill
system; executable behavior remains a registered Tool.

Skills teach workflow and taste. Exact API signatures are generated from
structured source comments into `doc/api`, `dist/aiditor-api.json`, and runtime
AI references. Agents should search/read those references when an API detail
matters.

Runtime discovery mirrors that split:

```text
aiditor://skills  choose the right skill
aiditor://api     read exact API signatures
```

- [aiditor-runtime-authoring/SKILL.md](./aiditor-runtime-authoring/SKILL.md):
  for agents running inside AIditor, editing workspace files and mounting or
  replacing live dock panels.
- [aiditor-library-authoring/SKILL.md](./aiditor-library-authoring/SKILL.md):
  for Codex-like agents using AIditor as a library in a repository or host app.
- [aiditor-authoring/SKILL.md](./aiditor-authoring/SKILL.md): compatibility
  umbrella with the older combined guidance.

Skill folders may include `references/` files. Agents should load those
references only when the current task needs the extra detail.

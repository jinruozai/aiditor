# AIditor Design

AIditor is a zero-dependency frontend editor framework with optional upper
layers. Its goal is simple: keep the kernel small, then let host apps build
powerful editors and AI workflows on top of that small kernel.

```text
AIditor Kernel              core services, component registry, tree, dock runtime
AIditor UI                  optional widget and built-in panel layer
AIditor AI Host             optional agent/runtime layer
AIditor Extension Runtime   optional packaging/lifecycle layer
Host Adapters               privileged bridges owned by the host app
```

Applications built with AIditor, including Demo Project Runtime, sit outside
the framework. They may load workspace files, register components, and mount
panels, but they are examples of host code rather than AIditor architecture.

## Authority

Use documents in this order:

```text
AGENTS.md          current repo state, operating rules, and hard constraints
doc/README.md      current architecture index and boundary contract
doc/*.md           current architecture
```

## Boundary Summary

| Area | Responsibility | Does Not Own |
| --- | --- | --- |
| Kernel | Shared infrastructure: signals, log, bus, history, settings, commands, shortcuts, theme, i18n, workspace contracts, component registry, dock tree, and dock runtime. | Editor business rules, product project formats, app shortcut policy, or widget catalog breadth. |
| UI | `aiditor.ui.*` widgets, schema-driven `propertyForm`, generic Inspector selection/providers, settings UI, built-in tab/history/log/inspector panel components, and theme consumption. | AI execution or domain data semantics. |
| AI Host | Agents, providers, streaming, structured outputs, permissions, tools, context references, operations, ChangeSet, compaction, checkpoints, evals, and memory. | Product data models, workflow databases, or hidden host privileges. |
| Extension Runtime | Package, review, install, disable, and uninstall contributions through existing registries. | A second component/tool/context model. |
| Host Adapters | File-system bridges, provider transports, git, verification, and other privileged integrations. | Framework policy bypasses. |

Domain-specific editors, demos, project loaders, app menus, app shortcut
bindings, and workflow decisions are host code. Generic shortcut routing is
Core infrastructure; application shortcut policy is not.

## Distribution Contract

The repository may contain source, tests, demos, internal handoff files, and
archived notes. The published runtime package should stay small and public:

```text
dist/aiditor-theme.js
dist/aiditor-theme.css
dist/aiditor-mini.js
dist/aiditor-mini.css
dist/aiditor-editor.js
dist/aiditor-editor.css
dist/aiditor-core.js
dist/aiditor-core.css
dist/aiditor-full.js
dist/aiditor-full.css
dist/aiditor-kernel.js
dist/aiditor-kernel.css
dist/aiditor-ui.js
dist/aiditor-ui.css
dist/aiditor-ai.js
dist/aiditor-ai.css
dist/aiditor.js
dist/aiditor.css
dist/aiditor-api.json
README.md
LICENSE
```

Internal coordination files such as `AGENTS.md` and `CLAUDE.md`, source tests,
screenshots, tools, demos, and design documents are repository material, not npm
runtime package contents.

Optional layers must be optional in distribution as well as in architecture. The
runtime distribution should provide:

```text
aiditor-theme     standalone theme runtime + tokens + built-in themes
aiditor-mini      standalone website controls + minimal shared foundation
aiditor-editor    standalone complete generic editor UI
aiditor-kernel    Core services + tree + dock runtime
aiditor-ui        UI widget and built-in panel add-on
aiditor-ai        AI Host + Extension Runtime add-on
aiditor-core      classic Kernel + UI bundle
aiditor-full      Kernel + UI + AI Host + Extension Runtime
```

Host apps that only need dock layout should be able to load the kernel bundle.
Apps that need the classic UI framework can load `aiditor-core` without AI,
extension runtime, AI panels, or AI-specific styles.

`aiditor-theme`, `aiditor-mini`, and `aiditor-editor` are source projections,
not new architecture layers. Mini includes themes and the shared foundation
required by common website controls, while excluding editor-oriented widgets
and the component palette/registry. Mini consumers call `aiditor.ui.*`
directly.
Editor adds all generic UI primitives but still excludes Dock, Workspace,
History, Shortcuts, built-in panels, AI Host, and Extension Runtime. These are
standalone alternatives and must not be combined with Kernel/Core/Full.

## Core Principles

1. Keep the concept budget small.
   Public architecture has Kernel, UI, optional AI Host, and optional Extension
   Runtime. Host apps sit outside the framework.

2. Names are structure.
   Dotted names such as `workspace.readText`, `ui.setProp`, and
   `gde.table.patchRows` are the public grouping shape for registries. Owner
   metadata is used when an installed extension needs exact lifecycle cleanup.

3. Modules contribute to the same AI registries.
   `workspace`, `theme`, `dock`, `ui`, extensions, and domain modules expose
   model-facing behavior by registering tools, context references, or
   operations. There is no per-module AI path.

4. AI exposes six action/context concepts.
   Agent, Skill, Tool, Context Reference, Operation, and ChangeSet are the model
   developers need for work. Skill is the capability-selection surface; Tool is
   its executable protocol. Targets, attachments, rich prompt ranges, quests, and inboxes are
   runtime or UX details.

5. The framework has no built-in project model.
   `workspace` is bounded file access. Project descriptors, file loaders, and
   domain schemas belong to host apps.

6. Extensions package existing extension points.
   An extension installs contributions into normal registries and removes its
   owner from those registries. It does not create a parallel runtime.

7. Permission is one resolver.
   Tools, operations, ChangeSet apply, workspace writes, extension install, and
   host-adapter calls all pass through the same actor/target/scope decision
   model. Context and reference reads are not a bypass.

8. Versioned apply is mandatory for mutable resources.
   Previews bind to resource versions. Apply uses compare-and-set; stale
   previews must re-preview or rebase.

9. Domain meaning stays outside Core.
   Game data tables, animation clips, asset databases, scene graphs, and demo
   projects are host/domain concepts.

## Document Map

- [architecture.md](./architecture.md)
- [architecture-decisions.md](./architecture-decisions.md): user-ratified subsystem behavior contracts (dock split/merge, panel runtime, component registry, data model, bus).
- [architecture-decisions.md](./architecture-decisions.md): user-ratified subsystem behavior contracts (dock split/merge, panel runtime, component registry, data model, bus).: full layer model and naming rules.
- [core.md](./core.md): core infrastructure that already exists.
- [ui.md](./ui.md): component registry, dock layout/runtime, toolbar records, and UI library.
- [quick-pick.md](./quick-pick.md): generic quick filter picker for choosing one opaque item from a bounded collection.
- [schema-value-encoding.md](./schema-value-encoding.md): canonical schema value shapes, including `struct` tuple encoding and `dict` dictionary boundaries.
- [dict-input.md](./dict-input.md): generic dynamic key-value dictionary editor design and its relationship to `structInput`.
- [property-list.md](./property-list.md): keyed object property list design, field row actions, and reconcile stability contract.
- [inspector.md](./inspector.md): ordered selection, provider protocol, multi-target property editing, and the built-in Inspector panel.
- [file-browser.md](./file-browser.md): neutral file browsing, lazy trees, and external file/directory drop normalization.
- [ai.md](./ai.md): optional AI Host and the public AI concept model.
- [ai-runtime.md](./ai-runtime.md): agents, skills, messages, queues, live run state, compaction, and persistence.
- [ai-skills.md](./ai-skills.md): stateless SkillSpec, complete compact catalog, read/search, owner lifecycle, and bounded `SKILL.md` packages.
- [ai-persistence.md](./ai-persistence.md): complete IndexedDB transcript persistence, bootstrap metadata, hydration, and adapter contract.
- [ai-evals.md](./ai-evals.md): deterministic case/evaluator runner over Agent outputs and compact traces.
- [ai-permission-policy.md](./ai-permission-policy.md): unified permission resolver, audit, and always-allow policy.
- [ai-context-assembly.md](./ai-context-assembly.md): budgeted request context layers and model-facing context order.
- [ai-context-compaction.md](./ai-context-compaction.md): context budgeting, semantic compaction, memory, and long-session request assembly.
- [ai-registries.md](./ai-registries.md): concrete registry APIs and current implementation notes.
- [provider.md](./provider.md): connection, auth, transport, model, streaming, and reliability contract.
- [workspace.md](./workspace.md): the workspace final model - bounded file access, operation review, strict text/blob IO, snapshots, URL leases, workspace tool contributions, and host/framework boundaries.
- [host-file-workflow.md](./host-file-workflow.md): recommended host pattern for FileIndex, reference repair, FileOperationJournal, conflict UI, and domain validation on top of Workspace V2.
- [workspace-precise-editing.md](./workspace-precise-editing.md): search/read/exact-edit workflow for safe code mutation.
- [resource-versioning.md](./resource-versioning.md): versioned mutation contract, CAS apply, and conflict handling.
- [agent-workspace-editing.md](./agent-workspace-editing.md): recommended file-first agent workflow for demo workspace code edits.
- [extensions.md](./extensions.md): extension packaging, trust tiers, and lifecycle.
- [api/index.md](./api/index.md): generated API reference built from structured source comments.
- [skill/aiditor-runtime-authoring/SKILL.md](./skill/aiditor-runtime-authoring/SKILL.md): copyable AI skill for live AIditor agents that edit workspace files and mount panels into current docks.
- [skill/aiditor-library-authoring/SKILL.md](./skill/aiditor-library-authoring/SKILL.md): copyable AI skill for Codex-like agents using AIditor as a library in a repository or host app.
- [skill/aiditor-authoring/SKILL.md](./skill/aiditor-authoring/SKILL.md): compatibility umbrella for the older combined authoring guidance.
- [implementation-map.md](./implementation-map.md): source-file coverage map for current implementation.
- [architecture-notes.md](./architecture-notes.md): intentional implementation notes for review-sensitive areas.

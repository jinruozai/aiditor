# Implementation Map

This map links current source files to the new design documents. It is a guard
rail for refactors: if a file is listed here, its implemented behavior should be
preserved or deliberately replaced.

## Core

| Source | Document | Notes |
| --- | --- | --- |
| `src/core/signal.js` | [core.md](./core.md) | Signals, effects, derived values, cleanup. |
| `src/core/log.js` | [core.md](./core.md) | Log stream, error reporting, safe call boundary. |
| `src/core/names.js` | [core.md](./core.md), [architecture.md](./architecture.md) | Dotted-prefix name matching helper. |
| `src/core/runtime.js` | [core.md](./core.md), [agent-workspace-editing.md](./agent-workspace-editing.md) | Runtime script loader and owner-scoped contribution cleanup. |
| `src/core/bus.js` | [core.md](./core.md) | Pub/sub communication. |
| `src/core/history.js` | [core.md](./core.md) | Generic history, transactions, undo/redo. |
| `src/core/theme.js` | [core.md](./core.md), [ui.md](./ui.md) | Theme mode and tokens. |
| `src/style/theme-settings.js` | [core.md](./core.md), [ui.md](./ui.md) | Theme module settings contribution and built-in `theme-config` dock panel. |
| `src/core/i18n.js` | [core.md](./core.md) | Language strings. |
| `src/core/settings.js` | [core.md](./core.md) | Settings sections, schemas, pages, persistence, owner cleanup, and dotted-prefix helpers. |
| `src/core/commands.js` | [core.md](./core.md) | Commands, menus, owner cleanup, and dotted-prefix helpers. |
| `src/core/shortcuts.js` | [core.md](./core.md), [shortcuts.md](./shortcuts.md) | Shortcut runtime: key normalization, context resolution, command routing, diagnostics, user overrides, and panel surfaces. |
| `src/core/workspace.js` | [workspace.md](./workspace.md), [workspace-v2.md](./workspace-v2.md), [workspace-precise-editing.md](./workspace-precise-editing.md), [host-file-workflow.md](./host-file-workflow.md), [csv-editor.md](./csv-editor.md) | Workspace adapters, runtime adapter bindings, path safety, text/blob IO, path operations, operation review target, URL leases, snapshots, search, and exact text edit helpers. Host FileIndex/reference/journal policy stays above this file. |

## UI

| Source | Document | Notes |
| --- | --- | --- |
| `src/tree/tree.js` | [ui.md](./ui.md) | Immutable dock tree and pure layout functions. |
| `src/core/registry.js` | [ui.md](./ui.md) | Component registry, owner cleanup, and dotted-prefix helpers. |
| `src/core/context.js` | [ui.md](./ui.md), [core.md](./core.md) | Component context and cleanup. |
| `src/dock/runtime.js` | [ui.md](./ui.md) | Dock runtime, panel materialization, and detached DOM. |
| `src/dock/render.js` | [ui.md](./ui.md) | Dock reconciliation and toolbar rendering. |
| `src/dock/interactions.js` | [ui.md](./ui.md) | Splitter, split, merge, drag hover. |
| `src/dock/panel-drag.js` | [ui.md](./ui.md) | Panel/tab drag and dock drop. |
| `src/dock/menu.js` | [ui.md](./ui.md), [quick-pick.md](./quick-pick.md) | Optional built-in dock command/menu contribution. Add Panel should use the canonical `quickPick` primitive rather than a separate searchable menu concept. |
| `src/dock/migrate.js` | [ui.md](./ui.md) | Pop-out and cross-window migration. |
| `src/dock/layout.js` | [ui.md](./ui.md) | `createDockLayout`. |
| `src/ui/inspector.js` | [inspector.md](./inspector.md), [ui.md](./ui.md) | Ordered Inspector selection, provider registry, multi-target edit gates, and formula-ready change helpers. |
| `src/ui/panel/inspector.js` | [inspector.md](./inspector.md), [ui.md](./ui.md) | Built-in generic Inspector dock panel backed by `aiditor.inspector` and `aiditor.ui.propertyForm`. |
| `src/ui/data/collectionBrowser.js` | [file-browser.md](./file-browser.md), [ui.md](./ui.md) | Stable-key fixed-size two-dimensional virtual collection, controlled selection, keyboard/marquee interaction, and shared DnD/action routing. |
| `src/ui/data/fileBrowser.js` | [file-browser.md](./file-browser.md), [ui.md](./ui.md) | Thin file preset over collectionBrowser: breadcrumbs, file projection, metadata rendering, directory activation, and file-shaped contexts. |
| `src/ui/data/dataGrid.js` | [csv-editor.md](./csv-editor.md), [ui.md](./ui.md) | Controlled spreadsheet interaction surface with virtual rows; no CSV or persistence knowledge. |
| `src/ui/editor/textDocument.js` | [csv-editor.md](./csv-editor.md), [host-file-workflow.md](./host-file-workflow.md) | Shared format-neutral text file load/save, CAS dirty/stale state, and watch lifecycle. |
| `src/ui/editor/csv/*.js` | [csv-editor.md](./csv-editor.md), [schema-value-encoding.md](./schema-value-encoding.md) | Shared CSV row grammar, explicit `csv`/`gamecsv` formats, and the immutable typed single-table document. |
| `src/ui/panel/csv-*.js` | [csv-editor.md](./csv-editor.md), [inspector.md](./inspector.md) | Shared CSV sessions, commands, compact FieldDef cell projection, Inspector providers, and the one-file `csv-editor` Panel. |
| `src/ui/data/tree.js` | [file-browser.md](./file-browser.md), [ui.md](./ui.md) | Virtualized static/lazy tree with controlled selection/expansion and node-scoped async loading. |
| `src/ui/_internal/_dnd.js` | [file-browser.md](./file-browser.md), [ui.md](./ui.md) | Generic drag/drop transport plus external file/directory normalization. |
| `src/ui/_internal/_overlay.js` | [ui.md](./ui.md) | Single overlay stack authority for dismissal, focus, ARIA, root disposal, and the public read-only `modalDepth` projection. |
| `src/ui/panel/history.js` | [core.md](./core.md), [ui.md](./ui.md) | Built-in generic History dock panel backed by an `aiditor.history` instance or named binding. |
| `src/ui/panel/panel-list.js` | [ui.md](./ui.md) | Built-in searchable panel palette for registered generic panel components. |
| `src/ui/base/actionMenu.js` | [ui.md](./ui.md) | Shared UiAction-to-menu adapter used by actionBar menus and field context-menu action surfaces. |
| `src/ui/form/editorFor.js` | [ui.md](./ui.md), [schema-value-encoding.md](./schema-value-encoding.md), [dict-input.md](./dict-input.md) | Schema renderer dispatcher and canonical value encoding boundary; built-in `struct` projects tuple values to record UI, and built-in `dict` delegates dynamic key/value editing to `dictInput`. |
| `src/ui/form/propertyForm.js` | [ui.md](./ui.md), [inspector.md](./inspector.md) | Schema-driven single/multi-target adapter over the stable `structInput` field tree, including groups, conditions, actions, messages, and recursive display filtering. |
| `src/ui/form/propertyList.js` | [property-list.md](./property-list.md), [ui.md](./ui.md) | Keyed expandable object property-list primitive built from section/actionBar/propertyForm. |
| `src/ui/form/dictInput.js` | [dict-input.md](./dict-input.md), [schema-value-encoding.md](./schema-value-encoding.md), [ui.md](./ui.md) | Dynamic key-value dictionary editor primitive used by the built-in `dict` schema renderer. |
| `src/ui/form/arrayEditor.js` | [ui.md](./ui.md) | Generic array-row interaction primitive: keyed inline/section item shells, local collapse state, selection, atomic sync/async item construction, add/delete/duplicate, reorder feedback, and controlled mutation callbacks. |
| `src/ui/form/arrayInput.js` | [ui.md](./ui.md) | Simple property array facade over `arrayEditor`, including the shared `createItem` / `canAdd` protocol. |
| `src/ui/overlay/quickPick.js` | [quick-pick.md](./quick-pick.md), [ui.md](./ui.md) | Canonical anchored quick filter picker for opaque item collections. |
| `src/ui/**` | [ui.md](./ui.md) | Generic UI component library and built-in generic panel components. |
| `src/style/themes/*.css` | [ui.md](./ui.md) | One file per built-in theme; each file owns exactly one `[data-aiditor-theme="<id>"]` token block. |
| `src/style/**` | [ui.md](./ui.md) | Theme, dock, UI, AI, and settings styles. |

## AI Runtime

| Source | Document | Notes |
| --- | --- | --- |
| `src/ai/name-generator.js` | [ai-runtime.md](./ai-runtime.md) | Agent name generation. |
| `src/ai/i18n.js` | [ai-runtime.md](./ai-runtime.md) | Built-in AI Host UI dictionaries; Core i18n and the host own locale selection. |
| `src/ai/schema.js` | [ai-runtime.md](./ai-runtime.md), [provider.md](./provider.md) | Shared JSON-schema normalization, concrete tagged-union diagnostics, strict Tool wire-schema compilation, and structured-output parsing. |
| `src/ai/serialize.js` | [ai-runtime.md](./ai-runtime.md), [provider.md](./provider.md) | JSON-safe cloning plus canonical summaries and stable hashes for bounded AI diagnostics. |
| `src/ai/permission.js` | [ai-permission-policy.md](./ai-permission-policy.md), [ai-runtime.md](./ai-runtime.md) | Permission resolver, default hierarchy policy, path rules, and audit log. |
| `src/ai/tool/scheduler.js` | [ai-runtime.md](./ai-runtime.md) | Ordered Tool parallel groups, exclusive barriers, execution deadline, and cooperative cancellation. |
| `src/ai/store.js` | [ai-runtime.md](./ai-runtime.md), [ai-context-compaction.md](./ai-context-compaction.md), [ai-registries.md](./ai-registries.md) | Complete in-memory Agent/message/quest state, JSON-safe snapshots, mutation version, attachments, and permission-scoped read facades. |
| `src/ai/persistence.js` | [ai-persistence.md](./ai-persistence.md) | Complete IndexedDB transcript persistence, bootstrap manifest, async hydration merge, serialized saves, and storage adapters. |
| `src/ai/compaction.js` | [ai-context-compaction.md](./ai-context-compaction.md), [ai-runtime.md](./ai-runtime.md) | Semantic compaction records, safe range planning, request filtering, and compaction context messages. |
| `src/ai/runtime.js` | [ai-runtime.md](./ai-runtime.md) | Scheduler, runs, resume, Tool approval, canonical projection routing, batch argument fidelity, and bounded same-run correction. |
| `src/ai/checkpoints.js` | [ai-persistence.md](./ai-persistence.md) | Optional runtime checkpoint policy using the shared async storage adapter contract. |
| `src/ai/evals.js` | [ai-evals.md](./ai-evals.md) | Sequential deterministic eval cases, evaluators, reports, and trace association. |
| `src/ai/orchestration.js` | [ai-runtime.md](./ai-runtime.md) | Agent, quest, message tools. |
| `src/ai/request.js` | [ai-runtime.md](./ai-runtime.md), [ai-context-assembly.md](./ai-context-assembly.md), [ai-context-compaction.md](./ai-context-compaction.md), [ai-registries.md](./ai-registries.md) | Runtime request assembly: context cards, attachments, compaction, tool visibility, and budgeted transcript fallback. |
| `src/ai/message-markdown.js` | [ai-message-rendering.md](./ai-message-rendering.md), [ai-runtime.md](./ai-runtime.md) | Safe zero-dependency Markdown rendering for ordinary model text, including stable streaming patching. |
| `src/ai/message-renderers.js` | [ai-message-rendering.md](./ai-message-rendering.md), [ai-runtime.md](./ai-runtime.md) | Normalized message parts, built-in transcript part renderers, copy text, and host renderer extension points. |
| `src/ai/contribution-registry.js` | [ai-registries.md](./ai-registries.md) | Shared exact-owner contribution lifecycle. |
| `src/ai/tool/registry.js` | [ai-runtime.md](./ai-runtime.md), [ai-registries.md](./ai-registries.md) | Tool schema, capability, availability, and metadata registry. |
| `src/ai/tool/runtime.js` | [ai-runtime.md](./ai-runtime.md) | Tool-call lifecycle and run context helpers. |
| `src/ai/context/registry.js` | [ai-context-assembly.md](./ai-context-assembly.md) | Factual Context provider registry and capture. |
| `src/ai/skill/registry.js` | [ai-skills.md](./ai-skills.md) | SkillSpec normalization, availability, catalog, and exact-owner lifecycle. |
| `src/ai/skill/runtime.js` | [ai-skills.md](./ai-skills.md) | Model `skill.list` and run-scoped `skill.activate` controls. |
| `src/ai/skill/builtins.js` | [ai-skills.md](./ai-skills.md) | Complete non-overlapping framework Skill taxonomy. |
| `src/ai/skill/packages.js` | [ai-skills.md](./ai-skills.md) | Bounded workspace `SKILL.md` package loading and on-demand reference access. |
| `src/ai/skill/reference.js` | [ai-skills.md](./ai-skills.md) | Skill catalog and package reference projection. |
| `src/ai/reference.js` | [ai-registries.md](./ai-registries.md), [ai.md](./ai.md) | Reference/operation protocol and direct request-local Operation Tool projections routed through the canonical preview/apply lifecycle. |
| `src/ai/target.js` | [ai-registries.md](./ai-registries.md) | Add-to-chat targets, drag/drop, file targets. |
| `src/ai/rich-prompt.js` | [ai-registries.md](./ai-registries.md), [ai-skills.md](./ai-skills.md) | Inline references and explicit Skill tokens in prompt text. |
| `src/ai/change-set.js` | [ai-registries.md](./ai-registries.md) | Grouped review and apply/reject. |
| `src/ai/workdir.js` | [workspace.md](./workspace.md), [workspace-v2.md](./workspace-v2.md), [workspace-precise-editing.md](./workspace-precise-editing.md), [agent-workspace-editing.md](./agent-workspace-editing.md) | Workspace module tool contributions; mutating tools should consume Core operation preview/apply instead of defining separate file semantics. |

## Outside Framework Bundle

| Source | Document | Notes |
| --- | --- | --- |
| `demo/project.js` | [architecture-notes.md](./architecture-notes.md), [agent-workspace-editing.md](./agent-workspace-editing.md) | Demo-only workspace app loader and `demo.project.*` tools, intentionally outside `src/`. |

## Provider System

| Source | Document | Notes |
| --- | --- | --- |
| `src/ai/provider.js` | [provider.md](./provider.md) | Provider helper utilities and usage cost. |
| `src/ai/adapter.js` | [provider.md](./provider.md) | Provider message/tool formatting, one-time wire argument decoding, bounded diagnostics, and text Tool protocol. |
| `src/ai/connection.js` | [provider.md](./provider.md) | Connection, auth driver, transport driver registries. |
| `src/ai/provider-auth.js` | [provider.md](./provider.md) | Built-in auth drivers. |
| `src/ai/provider-transports.js` | [provider.md](./provider.md) | Built-in transport drivers. |
| `src/ai/provider-connections.js` | [provider.md](./provider.md) | Built-in connections. |

## Extensions

| Source | Document | Notes |
| --- | --- | --- |
| `src/extensions/manifest.js` | [extensions.md](./extensions.md), [architecture-notes.md](./architecture-notes.md) | Manifest normalization, public ids, trust helpers, and structural validation helpers. |
| `src/extensions/install.js` | [extensions.md](./extensions.md), [architecture-notes.md](./architecture-notes.md) | Installs extension contributions into existing component, AI, settings, and command registries. |
| `src/extensions/runtime.js` | [extensions.md](./extensions.md), [architecture-notes.md](./architecture-notes.md) | Optional Extension Runtime lifecycle: review, install/update/uninstall, storage, layers, recovery, and dock panel placement. |
| `src/extensions/ai.js` | [extensions.md](./extensions.md), [ai.md](./ai.md) | Bridge that exposes Extension Runtime lifecycle and dock-panel actions through AI operations/tools. |

## AI Panels

| Source | Document | Notes |
| --- | --- | --- |
| `src/ai/panels/agents.js` | [ai-runtime.md](./ai-runtime.md), [ui.md](./ui.md) | AI module component for the agent list panel. |
| `src/ai/panels/rich-prompt-input.js` | [ai-registries.md](./ai-registries.md), [ui.md](./ui.md) | AI-owned `aiditor.ui.richPromptInput` helper for inline references. |
| `src/ai/panels/composer-slash.js` | [ai-runtime.md](./ai-runtime.md), [ai-skills.md](./ai-skills.md), [quick-pick.md](./quick-pick.md) | AI composer slash discovery controller over Skill and Command contributions. |
| `src/ai/panels/settings-ai.js` | [ai-runtime.md](./ai-runtime.md), [core.md](./core.md) | AI module settings contribution. |
| `src/ai/panels/chat.js` | [ai-runtime.md](./ai-runtime.md), [ai-registries.md](./ai-registries.md) | AI module component for chat input. |
| `src/ai/panels/transcript.js` | [ai-runtime.md](./ai-runtime.md) | AI module component for message transcript. |
| `src/ai/panels/chat-combined.js` | [ai-runtime.md](./ai-runtime.md) | AI module component for combined chat. |
| `src/ai/panels/message-live-strip.js` | [ai-runtime.md](./ai-runtime.md), [provider.md](./provider.md) | AI module component for live run preview. |
| `src/ai/panels/message-virtualizer.js` | [ai-runtime.md](./ai-runtime.md) | Transcript rendering performance. |

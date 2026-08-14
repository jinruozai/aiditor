<p align="center">
  <img src="./logo.png" width="96" height="96" alt="AIditor logo">
</p>

<h1 align="center">AIditor</h1>

<p align="center">
  A pure frontend UI framework for building editors, with built-in AI Agent capabilities.
</p>

[![npm](https://img.shields.io/badge/npm-%40gooooo%2Faiditor-cb3837)](https://www.npmjs.com/package/@gooooo/aiditor)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-2ea44f.svg)](./package.json)
[![build](https://img.shields.io/badge/build-zero--build-555.svg)](./dist)

> [!WARNING]
> AIditor is in early development. Expect significant API and architecture changes between releases; production use is not recommended yet.

AIditor gives host applications the shared foundation most serious editor UIs
need: a Blender-style dock layout, panel/component runtime, themeable UI
controls, command/menu/shortcut infrastructure, history and settings services,
workspace contracts, optional AI agents, and optional extension loading. It is
plain browser JavaScript: no framework, no bundler, no module system, and no
runtime dependencies.

![AIditor editor workspace](./screenshots/screenshot_01.jpg)

![AIditor AI agent panel](./screenshots/screenshot_02.jpg)

```html
<div id="app" style="height:100vh"></div>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-core.css">
<script src="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-core.js"></script>
<script>
aiditor.registerComponent('demo.editor', {
  defaults: function () {
    return { title: 'Editor', icon: 'file-text', props: { file: 'main.js' } }
  },
  factory: function (propsSig, ctx) {
    var root = document.createElement('div')
    root.style.cssText = 'height:100%;min-height:0;padding:12px;box-sizing:border-box'
    ctx.onCleanup(aiditor.effect(function () {
      root.textContent = 'Editing ' + ((propsSig() || {}).file || 'untitled')
    }))
    return root
  },
})

var tree = aiditor.split('horizontal', [
  aiditor.dock({
    name: 'main',
    toolbar: { direction: 'top', items: [{ component: 'tab-standard' }] },
    panels: [
      aiditor.panel({ component: 'demo.editor', title: 'main.js', props: { file: 'main.js' } }),
      aiditor.panel({ component: 'demo.editor', title: 'style.css', props: { file: 'style.css' } }),
    ],
  }),
  aiditor.dock({
    name: 'side',
    toolbar: { direction: 'top', items: [{ component: 'tab-compact' }] },
    panels: [aiditor.panel({ component: 'log', title: 'Log', icon: 'list' })],
  }),
], [0.7, 0.3])

aiditor.createDockLayout(document.getElementById('app'), {
  tree: tree,
  dockMenu: true,
})
</script>
```

## Why AIditor

Editor applications often rebuild the same infrastructure before they can work
on their actual domain: docks, tabs, toolbars, property panels, settings,
themes, logs, command surfaces, workspace access, and now AI operations.
AIditor packages those generic editor primitives without turning them into a
specific editor product.

- **Pure frontend**: classic `<script>` files, IIFEs, and a single
  `window.aiditor` namespace.
- **Zero dependencies**: no React, Vue, Monaco, router, bundler, or runtime
  package dependency.
- **Zero build for consumers**: use the committed `dist/` files from npm,
  jsDelivr, or a local checkout.
- **Blender-style layout**: immutable split tree, resizable docks, merge/split
  interactions, tabbed panels, and pop-out windows.
- **Detached inactive panels**: inactive panel DOM is removed from layout and
  paint while JS/DOM state is preserved for fast tab switching.
- **Editor primitives**: commands, menus, shortcuts, settings, history,
  inspector, logs, workspace IO, and reusable UI controls.
- **Optional AI Host**: tree agents, providers, tools, structured outputs,
  context references, permissions, ChangeSet review, compaction, recoverable
  checkpoints, and deterministic eval primitives.
- **Optional Extension Runtime**: package, review, install, disable, and
  uninstall contributions into the existing registries.

## Mental Model

AIditor has one UI registration unit: `Component`.

```text
Layout
`-- Dock
    |-- Toolbar
    |   `-- Component
    `-- Panel
        `-- Component
```

Panels and toolbar items are plain data records that reference registered
components by name. Docks own geometry and active-panel state. Components own
rendered UI. Host applications own project formats, domain data, persistence,
privileged bridges, and application shortcuts.

`tab-standard` is a normal toolbar component. It does not show a `+` button
unless the toolbar item declares what panel to create:

```js
{ component: 'tab-standard', props: { addPanel: { component: 'demo.editor' } } }
```

Non-root docks are removed when their last panel is closed or moved away by
default. Use `removeWhenEmpty:false` on `aiditor.dock(...)` when the layout
should keep an empty dock placeholder.

## Packages

Install from npm:

```bash
npm install @gooooo/aiditor
```

Or load directly in the browser:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-full.css">
<script src="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-full.js"></script>
```

Published files are intentionally runtime-only:

| Bundle | Includes | Use When |
| --- | --- | --- |
| `aiditor-theme` | theme runtime, tokens, and all built-in themes | You only need AIditor theming. The CSS also works alone with `data-aiditor-theme`. |
| `aiditor-mini` | standalone theme + common controls, forms, layouts, and overlays | You are building a website and do not need editor-oriented widgets. |
| `aiditor-editor` | standalone theme + every generic `aiditor.ui.*` editor widget | You need Inspector, schema forms, data views, or advanced editors without the Dock shell. |
| `aiditor-kernel` | core services, component registry, tree, dock runtime, dock CSS | You want the smallest dock/component runtime. |
| `aiditor-ui` | UI widgets and built-in panel add-ons | You already loaded Kernel and want `aiditor.ui.*`. |
| `aiditor-ai` | AI Host and Extension Runtime | You already loaded Kernel/UI and want AI or extensions. |
| `aiditor-core` | Kernel + UI | You want the classic editor framework bundle. |
| `aiditor-full` | Kernel + UI + AI Host + Extension Runtime | You want everything in one file. |
| `aiditor` | Core alias | You want the short classic path. |

The lightweight standalone slices can be loaded directly:

```html
<!-- Theme only. The script is optional when only CSS tokens are needed. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-theme.css">
<script src="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-theme.js"></script>

<!-- Website UI: common controls, forms, layouts, overlays, and themes. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-mini.css">
<script src="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-mini.js"></script>

<!-- Or the complete generic editor UI without the Dock shell. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-editor.css">
<script src="https://cdn.jsdelivr.net/npm/@gooooo/aiditor@1/dist/aiditor-editor.js"></script>
```

`aiditor-mini` excludes Inspector, schema-driven forms, arrays/structs,
Tree/Table/CollectionBrowser/FileBrowser, advanced editors, built-in panels, and the editor
component palette/registry. Its controls are used directly through
`aiditor.ui.*`.
`aiditor-editor` includes those generic editor widgets. Both are standalone
alternatives to `aiditor-kernel` + `aiditor-ui`; do not load these bundles
together. Every distribution is generated from the same source files and uses
the same `window.aiditor` contracts.

## Core Concepts

### Components

```js
aiditor.registerComponent('example.panel', {
  defaults: function () {
    return { title: 'Example', icon: 'box', props: {} }
  },
  factory: function (propsSig, ctx) {
    var root = document.createElement('div')
    root.textContent = 'Hello from AIditor'
    return root
  },
  dispose: function (root) {},
  serialize: function (root) { return {} },
  deserialize: function (root, state) {},
})
```

Component rules are deliberately plain:

- props are JSON-serializable data;
- `propsSig.peek()` is for one-shot reads;
- `propsSig()` inside `aiditor.effect(...)` is reactive;
- `ctx.onCleanup(...)` owns effects, timers, subscriptions, and overlays;
- panel roots should fit resizable docks with `height:100%` and `min-height:0`.

### Component Context

Every component receives `ctx`:

```js
ctx.panel.title()
ctx.panel.setTitle('New Title')
ctx.panel.setDirty(true)
ctx.panel.updateProps({ file: 'next.js' })
ctx.panel.close()
ctx.panel.popOut()

ctx.dock.panels()
ctx.dock.activeId()
ctx.dock.addPanel({ component: 'example.panel', title: 'New' })
ctx.dock.activatePanel(panelId)
ctx.dock.requestClosePanel(panelId, 'close')
ctx.dock.toggleFocus()

ctx.bus.emit('topic', payload)
ctx.bus.on('topic', function (payload) {})

ctx.active
ctx.onCleanup(function () {})
```

Static toolbar components receive `ctx.dock` but no `ctx.panel`. Dynamic toolbar
items contributed by the active panel receive both.

### Layout Runtime

`createDockLayout` returns the runtime handle:

```js
layout.addPanel(dockIdOrName, partialPanel, opts)
layout.requestClosePanel(panelId, 'close')
layout.requestClosePanels(panelIds, 'close-all')
layout.removePanel(panelId) // forced cleanup; bypasses the close-request hook
layout.activatePanel(panelId)
layout.promotePanel(panelId)
layout.movePanel(panelId, targetDockIdOrName, targetIndex)
layout.splitDock(dockIdOrName, 'horizontal', 'after', 0.5)
layout.mergeDocks(winnerDockIdOrName, loserDockIdOrName)
layout.tree()
layout.setTree(nextTree)
layout.subscribe(function (tree) {})
layout.destroy()
```

User-initiated close actions route through `hooks.onPanelCloseRequest`. The hook
receives one atomic batch `{ reason, panelIds, panels }` and may resolve `true`
to allow it or `false` to cancel it. Save prompts and dirty policy belong to the
host. A hook may save a dirty panel before resolving: the close remains valid
only when an original `dirty:true` panel becomes `dirty:false` and every other
PanelData field is unchanged. Clean-to-dirty, re-dirty, replacement, and other
PanelData changes invalidate the whole close batch. Runtime teardown, extension
uninstall, and migration cleanup use the separate forced `removePanel()` path.

The same immutable tree helpers are also available as pure functions:

```js
aiditor.addPanel(tree, dockId, partial, opts)
aiditor.removePanel(tree, panelId)
aiditor.activatePanel(tree, panelId)
aiditor.movePanel(tree, panelId, targetDockId, targetIndex)
aiditor.movePanelToSplit(tree, panelId, targetDockId, direction, side, ratio)
aiditor.splitDock(tree, dockId, direction, side, ratio, opts)
aiditor.mergeDocks(tree, winnerDockId, loserDockId)
```

### Core Services

AIditor keeps common editor infrastructure in Core without adding application
semantics:

```text
aiditor.log
aiditor.bus
aiditor.settings
aiditor.commands
aiditor.shortcuts
aiditor.history
aiditor.workspace
aiditor.runtime
aiditor.theme
aiditor.i18n
```

Commands and menus are data-driven contribution surfaces. Shortcuts normalize
keys, resolve generic UI targets, and route to `aiditor.commands.run`; the
framework does not define app-level shortcut policy. History supports
sync/async `jump`, `undo`, and `redo`, and the built-in `history` panel binds to
named history instances without owning project saved state. Workspace is a
bounded file primitive layer: text/blob IO, stat/version checks, preview/apply,
snapshots, object URL leases, permission recovery, and optional desktop
`revealInSystem`, plus bounded save-target selection where the adapter supports
it.

### UI Library

`aiditor.ui.*` provides signal-first controls and editor-focused widgets:

```js
var name = aiditor.signal('world')
var input = aiditor.ui.input({ value: name, placeholder: 'Name' })
var button = aiditor.ui.button({
  text: 'Greet',
  onClick: function () { alert('Hello ' + name()) },
})
```

The UI layer includes base controls, form inputs, editor inputs, containers,
virtualized data views, overlays, property forms, settings UI, tab/history/log
panels, and the generic Inspector panel. It also includes reusable editor
primitives such as `actionBar`, `section` header actions, `arrayEditor`,
`propertyList`, `propertyForm`, `structInput`, and `vectorInput`.

`arrayEditor` owns generic list interactions such as selection, active row,
add/delete/duplicate, and reorder feedback while callers keep item structure,
validation, history, and persistence. `arrayInput` remains the simple
compatibility facade used by schema forms.

`propertyList` owns keyed expandable object chrome around `propertyForm`: title,
summary, item actions, field row actions, collapsed state, and stable refresh
without rebuilding unchanged item DOM.

### Inspector

Inspector is provider-based. Editor surfaces select typed targets; domain code
describes how those targets become editable fields and local actions.

```js
aiditor.inspector.registerProvider('app.node', {
  inspect: function (targets) {
    return {
      title: 'Node',
      subtitle: targets[0].id,
      actions: [{ id: 'add', icon: 'plus', command: 'app.node.addChild' }],
      schema: { name: { type: 'string' }, visible: { type: 'bool' } },
      groups: {
        main: {
          label: 'Main',
          actions: [{ id: 'more', icon: 'more-vertical', menu: [] }],
        },
      },
      values: targets.map(function (target) { return nodeStore.get(target.id) }),
      write: function (field, change, ctx) {
        ctx.targets.forEach(function (target, index) {
          nodeStore.patch(target.id, {
            [field]: ctx.valueForChange(change, target, index, ctx),
          })
        })
      },
    }
  },
})
```

The built-in Inspector panel provides a compact header, local search over schema
fields and groups, and action slots in the header and property group sections.
`label:false` or `labelMode:"hidden"` lets composite fields span the full row
when a section title already names the value. Domain validation, undo history,
persistence, and object semantics stay in the host app.

### Themes

Built-in theme metadata is exposed by `aiditor.theme`:

```js
aiditor.theme.modeOptions()
aiditor.theme.modeIds()
aiditor.theme.set('neon')
```

Custom themes should start from semantic authoring tokens such as
`--aiditor-surface-*`, `--aiditor-text-*`, `--aiditor-stroke-*`,
`--aiditor-brand`, and `--aiditor-state-*`. Visual style beyond color is also
themeable through appearance role tokens for control/surface radius, border
width, elevation, root texture, and small accent geometry.

Theme ids and labels are framework metadata, not demo-local constants. Runtime
consumers should read `aiditor.theme.modeOptions()` or
`aiditor.theme.modeIds()` instead of maintaining duplicate theme lists.

## Built-In AI Host

The optional AI Host is a framework layer for editor-aware agents. It keeps the
model-facing surface small:

```text
Agent
Tool
Context Reference
Operation
ChangeSet
```

Tools expose actions to the model:

```js
aiditor.ai.tools.register('workspace.summarizeOpenFile', {
  title: 'Summarize Open File',
  description: 'Read the active file summary.',
  schema: { type: 'object', properties: {} },
  permissions: ['tool.call'],
  run: function (input, ctx) {
    return { text: 'summary' }
  },
})
```

Context references expose bounded readable state. Operations expose previewable
and applyable mutations. ChangeSets group reviewed changes. Permission checks,
workspace writes, operation apply, extension install, and host-adapter calls all
go through one resolver.

AI transcripts are durably persisted in IndexedDB, independently from the
bounded context sent to a model:

```js
aiditor.ai.configurePersistence({
  namespace: 'my-editor',
})

await aiditor.ai.persistence.ready()
```

Persistence keeps the complete JSON-safe transcript, including older messages
and tool results. `localStorage` contains only a small synchronous Agent
bootstrap manifest. Separate apps should use separate namespaces; when omitted,
AIditor derives one from the current location. New agents inherit the last
selected connection/model when available, then fall back to the active/default
connection.

`aiditor-ai` and `aiditor-full` also include built-in authoring skills:

- `aiditor.runtime-authoring`: for agents running inside a live AIditor host,
  editing workspace files and mounting panels into current docks.
- `aiditor.library-authoring`: for agents using AIditor as a library in a
  repository or host app.

Generated API and skill references are available to agents through
`aiditor://api` and `aiditor://skills`.

Hosts can register inline `SkillSpec` profiles or load a standard `SKILL.md`
folder from the bounded workspace with `aiditor.ai.skills.loadPackage()`.
Package references are read on demand; package scripts are never executed and
all executable behavior remains in the permission-checked Tool registry.

## Extension Runtime

Extensions package contributions into existing registries:

```text
components
dock panels
tools
skills
context providers
reference providers
operations
settings
commands
menus
```

An extension does not create a second component model or AI model. Install means
registering contributions with `owner: "extension:<id>"`; disable/uninstall
removes that owner from the registries.

## Design Principles

- **Small kernel, optional layers**: Kernel stays generic; UI, AI, and
  extensions are layered on top.
- **Host apps own product decisions**: project formats, domain data,
  persistence, menus, app shortcuts, and privileged bridges stay outside the
  framework.
- **One component model**: panels, toolbar items, and built-ins all resolve
  through registered components.
- **Stateful but efficient panels**: inactive panels are detached from the DOM,
  not hidden with CSS.
- **File-first AI authoring**: durable generated UI should live in workspace
  files; dock data references registered component names.
- **No hidden build step**: generated `dist/` files are committed and published.

## Local Development

```bash
git clone https://gitee.com/lazygoo/aiditor.git
cd aiditor
node tools/build.mjs --watch
npx http-server -p 5570
```

Open `http://localhost:5570`.

After changing `src/`, rebuild and test:

```bash
node tools/build.mjs
npm run check
npm run check:dist
```

`dist/aiditor-api.json` and `doc/api/*` are generated from structured comments
in `src/`.

## Documentation

- [Design index](./doc/README.md)
- [Architecture](./doc/architecture.md)
- [Core](./doc/core.md)
- [UI and dock runtime](./doc/ui.md)
- [Workspace](./doc/workspace.md)
- [Shortcuts](./doc/shortcuts.md)
- [Inspector](./doc/inspector.md)
- [AI Host](./doc/ai.md)
- [AI persistence](./doc/ai-persistence.md)
- [AI evals](./doc/ai-evals.md)
- [Extension Runtime](./doc/extensions.md)
- [Generated API docs](./doc/api/index.md)
- [Runtime authoring skill](./doc/skill/aiditor-runtime-authoring/SKILL.md)
- [Library authoring skill](./doc/skill/aiditor-library-authoring/SKILL.md)

## License

[MIT](./LICENSE) (c) gooooo

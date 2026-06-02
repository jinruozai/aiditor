# UI

UI is the editor shell, the component registry, and the component library.

It contains:

```text
component registry
dock layout data
dock runtime
component context
UI library
Inspector
theme consumption
```

The most important rule:

```text
Component is the only UI registration unit.
PanelData and toolbar items are records that reference registered components.
```

There is no separate panel registry.

## Dock Tree

The dock layout is an immutable N-way split tree.

Data shape:

```text
Split tree
      -> DockData
       -> panels[]
            PanelData { id, component, title, icon, props, toolbarItems }
       -> toolbar.items[]
            Toolbar item { component, props }
```

`PanelData.component` and `toolbar.items[].component` both point to names in the
same component registry.

`DockData.removeWhenEmpty` controls whether a non-root dock disappears when its
last panel is closed or moved away. The default is `true`; set
`removeWhenEmpty:false` to keep an empty dock placeholder:

```js
aiditor.dock({
  name: 'side',
  removeWhenEmpty: false,
  toolbar: { direction: 'top', items: [{ component: 'tab-standard' }] },
})
```

The root dock is never removed. The same rule applies to explicit close
actions, tab dragging, and panel moves. When the built-in dock menu is enabled,
`Panel -> Remove Dock When Empty` toggles the same flag for the selected dock.

Implemented pure APIs include:

```js
aiditor.dock(...)
aiditor.panel(...)
aiditor.split(...)
aiditor.findDock(tree, id)
aiditor.findPanel(tree, id)
aiditor.findByName(tree, name)
aiditor.getAt(tree, path)
aiditor.replaceAt(tree, path, node)
aiditor.removeAt(tree, path)
aiditor.resizeAt(tree, path, sizes)
aiditor.updateDock(tree, dockId, patch)
aiditor.addPanel(tree, dockId, partial, opts)
aiditor.removePanel(tree, panelId)
aiditor.updatePanel(tree, panelId, patch)
aiditor.activatePanel(tree, panelId)
aiditor.promotePanel(tree, panelId)
aiditor.movePanel(tree, panelId, targetDockId, targetIndex)
aiditor.movePanelToSplit(tree, panelId, targetDockId, direction, side, ratio)
aiditor.reorderPanel(tree, panelId, newIndex)
aiditor.splitDock(tree, dockId, direction, side, ratio, opts)
aiditor.mergeDocks(tree, winnerDockId, loserDockId)
aiditor.swapDocks(tree, leftDockId, rightDockId)
aiditor.setCollapsed(tree, dockId, value)
aiditor.canCollapseDock(tree, dockId)
aiditor.setFocused(tree, dockId, value)
```

These functions operate on data. DOM behavior is in the dock runtime.

## Dock Runtime

`aiditor.createDockLayout(root, config)` mounts a layout into the DOM.

Implemented runtime abilities:

- active panel mounting
- detached DOM for inactive panels
- panel add, remove, activate, move, split, merge
- tab drag between docks
- dragging registered panels from external lists into docks
- focus mode
- pop-out windows
- cross-window migration
- panel health inspection for generated panels
- optional dock context menu, enabled by `config.dockMenu === true`

Inactive panels should be detached from DOM, not hidden with CSS, so heavy
panels do not keep layout and paint cost.

Dock reconcile patches the dock/split frame skeleton in place. Local changes
such as tab activation or panel promotion must not replace the whole layout
container or temporarily disconnect unrelated docks. Active panel content is
still attached/detached only by the dock runtime.

The framework does not force an application menu model. `dockMenu: true` installs
the built-in dock command/menu contribution and lets right-clicking the dock
corner open it. The default is off; hosts may use the same command/menu registry
to provide their own menus.

When a panel becomes active, the runtime does:

```text
PanelData.component
  -> aiditor.resolveComponent(name)
  -> spec.factory(propsSig, ctx)
  -> append returned element into dock content
```

## Component Registry

All UI types are registered as components:

```js
aiditor.registerComponent(name, spec, meta)
aiditor.resolveComponent(name)
aiditor.componentDefaults(name)
aiditor.listComponents(filter)
aiditor.unregisterComponent(name, meta)
aiditor.unregisterComponentPrefix(prefix)
aiditor.unregisterComponentOwner(owner)
aiditor.componentRegistration(name)
aiditor.componentRegistryVersion
```

A registered component may be used as:

```text
dock panel content
toolbar item
UI tree node
palette/gallery card
dynamic AI-created UI
```

Final naming should use dotted prefixes for grouping:

```text
ui.buttonDemo
gde.tablePanel
sample.panel
```

Current code also supports metadata for extension cleanup. This is a migration
topic, not a second conceptual grouping model.

## Declarative UI Tree

AI-created UI and extension manifests can describe UI with a plain data tree:

```js
aiditor.ui.renderUITree(node, ctx)
```

This is not a second component system. Each node still resolves through the same
component registry:

```text
UITree node.component -> aiditor.resolveComponent(name) -> component factory
```

The tree format exists so generated panels, palettes, and extension manifests
can be stored, reviewed, and recreated as data. Handwritten panels may still call
`aiditor.ui.*` functions directly.

## Component Spec

A component has:

```js
{
  factory(propsSig, ctx) {},
  defaults() {},
  dispose(el) {},
  serialize(el) {},
  deserialize(el, state) {}
}
```

Rules:

- Props should be JSON-serializable.
- `category: 'panel'` means the component is suitable as dock panel content.
  It does not create a different kind of component.
- Components communicate through `ctx.bus`, references, operations, or domain
  APIs.
- Components should use `aiditor.ui.*` widgets when available.
- View surfaces and scrollable panel content should prefer `aiditor.ui.view`; `aiditor.ui.scrollArea` is the lower-level scrollbar wrapper.
- Floating UI should prefer framework overlay helpers.

Registered component metadata may include palette and editor hints:

```text
category
schema
bindable
preview
```

These hints help galleries, generated UI, and property editors. They do not
change what a component is.

## Action Surfaces

`aiditor.ui.actionBar` renders local `UiAction` records into compact buttons and
menus:

```js
aiditor.ui.actionBar({
  ctx: { source: 'inspector', id: 'light' },
  actions: [{
    id: 'add',
    icon: 'plus',
    label: 'Add',
    command: 'case.add',
    args: function (ctx) { return { id: ctx.id } },
  }],
})
```

`UiAction` shape:

```js
{
  id,
  label,
  icon,
  title,
  variant,   // "default" | "danger"
  disabled,  // boolean | (ctx) => boolean
  hidden,    // boolean | (ctx) => boolean
  command,
  args,      // object | (ctx) => object
  onSelect,  // local UI-only behavior
  menu,      // items | (ctx) => items
}
```

The behavior boundary stays `aiditor.commands.run(command, args, actionCtx)`.
`onSelect` exists for local UI behavior such as opening a popover, copying, or
focusing; domain data mutations should prefer commands so history, permission,
and validation stay in the host layer.

`menu` reuses `aiditor.ui.menu`. Menu items accept the same `variant:"danger"`
shape; actionBar maps it to the existing danger menu styling.

There is no global `aiditor.actions` registry. An action surface is owned by the
UI component that renders it.

`aiditor.ui.section({ actions })` places an actionBar on the right side of the
section header. The header is split into a toggle button and a separate action
rail, so clicking a trailing action does not collapse or expand the section.

## Toolbar

Toolbar items are ordinary component references stored in toolbar data. Tabs are
not special framework objects; they are toolbar components that subscribe to
dock panel state.

Dock tab add buttons are explicit toolbar-item behavior. `tab-standard` does not
show a `+` button by default, because the framework cannot know what kind of
panel an application wants to create. A host that wants a tab add button
configures the tab toolbar item with `props.addPanel`:

```js
aiditor.dock({
  toolbar: {
    direction: 'top',
    items: [{
      component: 'tab-standard',
      props: {
        addPanel: { component: 'scene.empty', title: 'Scene' },
      },
    }],
  },
})
```

When clicked, the tab component resolves `componentDefaults(addPanel.component)`
and merges the configured `addPanel` record over those defaults before calling
`ctx.dock.addPanel(...)`. Empty docks therefore do not show inert add buttons;
applications that want Godot-style "new scene", editor-style "new file", or
domain-specific creation behavior must declare it in the toolbar item props.

Built-in panel components include:

```text
tab-standard
tab-compact
tab-collapsible
tab-sidebar
history
log
settings
inspector
panel-list
theme-config
ai-agents-list
ai-chatinput
ai-messages
ai-chat
```

## UI Library

The UI library provides reusable components and primitive constructors. Generic
components live under `src/ui/` by category:

```text
src/ui/base/        buttons, icons, text, badges, tags, tooltip, popover
src/ui/form/        input controls and schema-driven property editors
src/ui/editor/      editor-specific inputs such as code, curve, path, file
src/ui/container/   layout and containers such as vbox, hbox, absolute, view, scrollArea
src/ui/data/        list, tree, table, file/asset browser, change review
src/ui/overlay/     menu, modal, drawer, toast, dialogs
src/ui/panel/       generic dock panel components such as panel-list/log/settings/tabs
src/ui/_internal/   implementation helpers used by the UI library
```

AI-specific panel components live under `src/ai/panels/` because they belong to
the AI module, even though they are registered through `aiditor.registerComponent`
and usually use `category: 'panel'`.

Domain-specific components live outside `src/ui/`.

## Interaction State Priority

Selectable framework components use one shared visual contract:

1. `disabled`
2. drag/drop transient state
3. `selected` / `active`
4. `hover`
5. normal

Plain hover is only a neutral preview and should use `--aiditor-hover`. It must
not use success/green or another semantic state color. Selection and active
identity use `--aiditor-selected`, `--aiditor-selected-border`, and
`--aiditor-selected-fg`; `selected:hover` uses `--aiditor-selected-hover` so the
item remains visibly selected while the pointer is over it. Green/success colors
are reserved for status, confirmation, running/done indicators, and valid drop
feedback.

`aiditor.ui.fileBrowser` is the neutral file/list/grid browser primitive for
workspace-like entries. `aiditor.ui.assetBrowser` remains as a compatibility
alias for existing asset-oriented hosts. Both names use the same storage-agnostic
component; callers provide listing, preview URL, import, move, rename, and delete
hooks.

`aiditor.ui.arrayEditor` is the generic array-row interaction primitive. It owns
selection, active item, key-based row identity, optional add/delete/duplicate,
pointer reorder with insertion feedback, keyboard row actions, and controlled
`items`/`selected`/`active` signals. Items are opaque values: callers provide
`getKey`, `renderItem`, capability gates, and mutation callbacks or an
`onChange`/writable signal. It does not own history, transactions, validation,
asset semantics, tracks, vertices, or any project workflow.

Selection and active state use item keys. Callers that need selection, active
row behavior, keyboard row actions, or stable reorder should provide `getKey`.
When `getKey` is omitted, `arrayEditor` uses index keys for simple lists,
defaults selection to `none`, and leaves keyboard row actions off unless the
caller opts in.

`renderItem(item, index, ctx)` is called when a row is created, not on every
array update. Row renderers should read current data from `ctx.value()` and
write with `ctx.writeItem(next)`. The plain `ctx.selected`, `ctx.active`,
`ctx.disabled`, and `ctx.dragging` fields are current snapshots; reactive row
state is available through `ctx.state.selected`, `ctx.state.active`,
`ctx.state.disabled`, and `ctx.state.dragging`.

Mutation callbacks transfer ownership of the operation. If `onDelete`,
`onDuplicate`, or `onReorder` is provided, the callback must update items and
any selected/active state it wants to preserve. Without an operation callback,
`arrayEditor` writes through `onChange` or a writable `items` signal and applies
the generic selected/active maintenance it can safely infer.

`aiditor.ui.arrayInput` remains the simple array value input facade used by
existing property forms. It delegates to `arrayEditor` with selection disabled
and reorder/duplicate off, preserving the old add/delete/edit behavior while
keeping rich list interaction in one implementation.

The settings panel under `src/ui/panel/` is only the generic settings shell.
Concrete settings are registered by the owning module, for example theme
settings from `src/style/theme-settings.js` and AI settings from
`src/ai/panels/settings-ai.js`. The built-in `theme-config` dock panel reuses
the same theme settings implementation in a compact panel layout; it is not a
second theme editor.

## Schema Editors

The UI library includes schema-driven property editing:

```js
aiditor.ui.setTypeConfig(builtinTypes, options)
aiditor.ui.setTypeOverrides(overrides)
aiditor.ui.getTypeConfig()
aiditor.ui.resolveType(typeName)
aiditor.ui.resolveFieldDef(fieldDef)
aiditor.ui.registerRenderer(kind, fn)
aiditor.ui.getRenderer(kind)
aiditor.ui.listRenderKinds()
aiditor.ui.editorFor(fieldDef, value, onChange, ctx)
aiditor.ui.propertyForm(options)
```

`typeconfig` provides built-in field aliases and render hints. Domain schemas
can extend it, but property editing should remain a UI helper, not a separate
data model.

Array fields keep the classic `array` renderer by default. Hosts that need row
selection, active item, duplicate, or reorder can opt into the `array_editor`
renderer through `type_render: "array_editor"` and renderer args such as
`elem_type`, `selectionMode`, `indexMode`, `density`, `actions`, and
`capabilities`.

Composite fields can explicitly hide their row label with `label: false` or
`labelMode: "hidden"`. This is useful when a named Inspector section contains a
single struct field and repeating the same label would waste space:

```js
{
  transform: {
    type: 'struct',
    group: 'transform',
    label: false,
    struct_def: { position: 'vec3', rot: 'vec3', scale: 'vec3' },
  },
}
```

The editor then spans the full property row. `labelMode: "sr-only"` keeps the
label available to assistive technology while removing the visual column.

When `propertyForm` renders grouped fields, its group sections use Inspector
scoped styling through `.aiditor-ui-property-section`: compact bar headers,
transparent bodies, and small row insets. Generic `aiditor.ui.section` keeps its
normal card-like appearance outside property forms.

Grouped property sections can receive local actions:

```js
aiditor.ui.propertyForm({
  schema,
  targets,
  groups: {
    transform: {
      label: 'Transform',
      actions: [{ id: 'more', icon: 'more-vertical', menu: [] }],
    },
  },
  groupActions: function (groupCtx) {
    return groupCtx.groupId === 'render' ? renderActions : []
  },
  groupActionCtx: function (groupCtx) {
    return Object.assign({}, groupCtx, { source: 'my-panel' })
  },
})
```

`groupCtx` contains `groupId`, `label`, `fields`, `targets`, and the caller's
form `ctx`. It deliberately does not expose DOM nodes or domain semantics.
`groupActions` returning `null` / `undefined` falls back to
`groups[groupId].actions`; returning `[]` explicitly clears that group's
actions. `groupActionCtx` is only a context mapper for action predicates,
menus, args, and commands.

`propertyForm` keeps field editor DOM stable across value-only refreshes. It
builds rows from a structural schema key: field order, field keys, group ids,
labels, renderer/type configuration, and composite definitions. New `schema` or
`groups` object identities do not rebuild rows when that structure is
equivalent. Updating `targets` only updates the existing slot signals, and
updating group labels/actions only refreshes section header chrome. Real
structure changes, such as adding/removing a field or changing its renderer,
still rebuild the affected form structure.

The dock-level Inspector lives above this helper. It owns ordered selection and
provider dispatch, shows a compact inline `title` / `subtitle` header, and adds
a local property search for normal `schema + values + write` inspections. The
search filters display only by field key, label, `desc`, group id, and group
label; it does not affect provider state, values, writes, or selection. See
[inspector.md](./inspector.md).

Use `propertyForm` directly when a component already owns the objects it edits.
Use `aiditor.inspector` when selection can come from many editor surfaces and a
shared dock panel should inspect the current selection.

## Icons And Floating UI

Icons use a small registry:

```js
aiditor.ui.registerIcon(name, svgInnerMarkup)
```

Floating UI should use the shared portal, overlay stack, and scoped overlay
cleanup. Components that create floating DOM outside their root should register
it so it closes when the owning panel becomes inactive or is disposed:

```js
aiditor.ui.registerScopedOverlay(anchor, close, options)
```

This prevents tooltips, popovers, and menus from leaking across tabs or panels.

## Themes

Themes are token-driven and applied through `aiditor.theme`.

UI components should consume semantic role tokens, not domain-specific colors.

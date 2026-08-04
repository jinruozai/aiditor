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

Splitting a dock creates a new dock view from the source dock's current active
panel. The runtime clones the active panel's serializable `PanelData` and lets
the tree layer assign a fresh panel id. `props`, title, icon, source metadata,
dirty/badge state, and dynamic toolbar item records are preserved; DOM nodes and
component runtime objects are not shared. The source dock's shell options
`toolbar`, `accept`, and `removeWhenEmpty:false` are copied to the new dock.
`name`, `collapsed`, and `focused` are not copied.

This makes corner splitting a "same resource, new view" operation. Tab dragging
remains the operation that moves an existing panel/runtime between docks.

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

`aiditor.ui.menu` also accepts persistent boolean controls:

```js
{ type: 'checkbox', label: 'Grid', checked: true, onChange: function (next) {} }
```

Checkbox items use `menuitemcheckbox` semantics and update their checked state
in place. Dismissal is an independent item policy: every selectable item closes
by default, while `closeOnSelect: false` keeps either an action or checkbox item
open after activation. Outside pointer input and `Escape` still dismiss the
whole menu.

`aiditor.ui.actionMenu` is the shared adapter for local action menu surfaces.
It takes `UiAction[]`, the caller's `ctx`, and either an anchor or a mouse
point, resolves `disabled` / `hidden` / `args` / `menu`, then opens `ui.menu`.
It is not a registry and it is not a second command system; it only keeps
button menus and right-click menus on the same UiAction execution path. Use
`behavior:"dropdown"` for button-anchored menus, where clicking the anchor can
remain part of the dropdown interaction. Use `behavior:"context"` for
right-click menus, where clicking outside the menu, including the original row
or label, dismisses it.
`actionMenu` may accept an async action source. While a `Promise<UiAction[]>`
is pending it may show a small loading menu at the requested point; if the
resolved list is empty or all actions are hidden, it closes without running
anything.

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

`ai-chatinput` automatically uses a two-row composer when it can display at
least two prompt lines and a compact single-row composer when its panel becomes
shorter. Both states keep the same prompt and control DOM. `ai-chat` lets its
input pane shrink to the compact minimum instead of overflowing its Dock. The
underlying `aiditor.ui.richPromptInput` accepts a boolean or signal for
`singleLine`, allowing its ARIA and keyboard semantics to follow the layout
without remounting.

## UI Library

The UI library provides reusable components and primitive constructors. Generic
components live under `src/ui/` by category:

```text
src/ui/base/        buttons, icons, text, badges, tags, tooltip, popover
src/ui/form/        input controls and schema-driven property editors
src/ui/editor/      editor-specific inputs such as code, curve, path, file
src/ui/container/   layout and containers such as vbox, hbox, absolute, view, scrollArea
src/ui/data/        list, tree, table, file/asset browser, change review
src/ui/overlay/     menu, quickPick, modal, drawer, toast, dialogs
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

`aiditor.ui.fileBrowser` is the neutral current-directory list/icon browser.
It supports controlled path, selection, view and sort state plus generic
activation, context action, drag source and drop target hooks. It does not load
directories or own file mutations. Compose it with `aiditor.ui.tree` when an
expandable directory outline is required. `aiditor.ui.assetBrowser` is an
alternate name for the same neutral primitive, not a second asset model. See
[file-browser.md](./file-browser.md).

`aiditor.ui.tree` accepts optional `loadChildren(node, signal)` for nodes that
declare `hasChildren:true`. Lazy children are cached by node id without
mutating caller data. Loading/error/retry state is exposed through row context,
and the imperative tree handle can invalidate or retry one branch. Collapsing,
invalidating, removing, or disposing a loading branch cancels it. Search and
`expandAll()` only traverse already available nodes.

`aiditor.ui.dropzone` normalizes external files and recursively readable
directories into neutral `{ kind, name, relativePath, file? }` entries. Browser
file-system handles remain private implementation details. Directory support is
feature-detected through `aiditor.ui.dnd.capabilities()`; partial read failures
are returned as structured errors and traversal is cancellable.

`aiditor.ui.arrayEditor` is the generic array-row interaction primitive. It owns
selection, active item, key-based row identity, optional add/delete/duplicate,
pointer reorder with insertion feedback, keyboard row actions, and controlled
`items`/`selected`/`active` signals. Items are opaque values: callers provide
`getKey`, `renderItem`, capability gates, and mutation callbacks or an
`onChange`/writable signal. It does not own history, transactions, validation,
asset semantics, tracks, vertices, or any project workflow.

Array rows keep their chrome compact: the index/handle column sizes to its
content instead of reserving an inspector-style label column. This keeps
`arrayEditor` usable inside `propertyForm`, including arrays whose item editor
is a nested `structInput`, while preserving the same delete/action rail and
reorder handle semantics. When a `structInput` or `dictInput` is rendered as an
array row item, its label/key column also switches to a compact width so the
field name and editor stay visually connected.

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

`aiditor.ui.quickPick` is the generic quick filter picker primitive. Use it when
the user needs to search a bounded in-memory collection and choose one item.
Items are opaque objects; callers provide `getKey`, `getLabel`,
`getSearchText`, optional metadata/group/disabled accessors, optional
`renderItem`, and `onSelect`.
Quick Pick owns the popover, search input, active row, keyboard navigation,
hover state, disabled row behavior, grouping display, keyed row reconcile, and
selection callback. It does not own data mutation, commands, history,
validation, or domain semantics.

Quick Pick is the only public "search and pick from a list" primitive. It
replaces the older searchable-menu shape instead of living next to it as another
similar concept. `ui.menu` remains for actions, `ui.select` remains for short
form value selection, and `ui.combobox` remains for editable text with
suggestions. See [quick-pick.md](./quick-pick.md).

`aiditor.ui.propertyList` is the companion primitive for keyed object property
blocks. Use it when each item has a stable id, title, summary, header actions,
collapsed state, and an expanded schema-driven property body. It composes
`ui.section`, `ui.actionBar`, and `ui.propertyForm`; it is not a second schema
editor and it does not own add/delete/history/domain semantics.

`propertyList` accepts `items` as either an array or a signal. Refreshing the
items source must reconcile by stable `getKey(item, index)`: existing ids keep
their section DOM, title/meta/actions/value signals update in place, new ids are
created, removed ids are disposed, and reordered ids move without rebuild. This
is required so expanded state, focus, numberInput pointer capture, open row UI,
and editor-local DOM state survive ordinary host refreshes. See
[property-list.md](./property-list.md).

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
aiditor.ui.propertyList(options)
```

`typeconfig` provides built-in field aliases and render hints. Domain schemas
can extend it, but property editing should remain a UI helper, not a separate
data model.

Schema kinds have canonical value shapes. `array` is an ordered JavaScript
array. `struct` is a fixed JavaScript array tuple whose positions are defined by
`Object.keys(normalizedStructDef)`. `dict` is a dynamic key-value dictionary
whose keys are data. The built-in `struct` renderer may project tuple values
into a keyed UI record while editing, but writes must return tuple values.
Dictionary editing belongs to the `dict` renderer and `dictInput`. See
[schema-value-encoding.md](./schema-value-encoding.md) and
[dict-input.md](./dict-input.md).

`vec2`, `vec3`, and `vec4` are built-in TypeConfig aliases for fixed float
struct tuples. They are not dynamic `array` fields: `vec3` expands to
`struct_def: { x, y, z }` and stores `[x, y, z]`. Their default renderer is
`vector`, which uses `ui.vectorInput`. All vec types may opt into
`type_render: "struct"` for expanded field rows. `vec3` and `vec4` may also opt
into `type_render: "color"` and will use the same tuple value through the color
renderer.

Array fields keep the classic `array` renderer by default. Hosts that need row
selection, active item, duplicate, or reorder can opt into the `array_editor`
renderer through `type_render: "array_editor"` and renderer args such as
`elem_type`, `selectionMode`, `indexMode`, `density`, `actions`, and
`capabilities`.

Dictionary fields use `type: "dict"` and `type_agv.value_type`. They render as
dynamic key/value rows: the key cell follows `structInput`'s compact row visual
rhythm, while the value cell is produced by `editorFor(value_type)`. `dictInput`
owns add/delete/rename key interactions and stable rows for unchanged keys; it
does not reuse `structInput`'s fixed-field data model.

Color fields use the generic `color` renderer and can choose their storage
encoding with `type_agv.valueKind`: `"hex"` writes `#RRGGBB` / `#AARRGGBB`,
`"int"` writes a 24-bit RGB integer, `"vec3"` writes `[r, g, b]`, and
`"vec4"` writes `[r, g, b, a]`. Vec colors are RGBA arrays. They are not ARGB
arrays, even though the picker uses `#AARRGGBB` internally. `type_agv.valueScale`
may be `1` for normalized components or `255` for byte components. For `vec4`,
editing a 6-digit RGB text value preserves the existing alpha; alpha changes
only when the input/picker provides alpha.

File path fields use `type_render: "filepath"` and write a plain string path or
URL. The renderer uses `aiditor.ui.filePathInput`, which provides a path text
field, browse/drop entry points, `accept` filtering for native file selection
and drag affordance, and a leading kind-specific control. `kind: "image"` shows
an image preview, `kind: "audio"` shows a play/pause control, and `kind:
"text"` / `"file"` show neutral file icons. `img` and `snd` are shorthand
renderers for `filepath` with `kind: "image"` and `kind: "audio"`.

`filePathInput` is not a file importer and not an asset database. Hosts that
need workspace/project paths provide `resolveSrc(path)` for preview/playback,
`onBrowse(current)` for their picker, and `onFile(file, current)` for import.
If `onFile` is omitted, dropped or browsed browser `File` objects are converted
to temporary object URLs for demo-style use; persistent applications should
return their own stable path string from `onFile`.

The trailing menu on `filePathInput` only includes actions the component can
perform itself: Load and Clear. Load calls the same browse path as the preview
click and passes `onBrowse(current, ctx)`, where `ctx.directory` is the current
path's parent directory hint for desktop/FSA hosts. Clear writes an empty
string.

Host-specific actions such as Save As or Show in Files are injected explicitly
as UiAction records. At the form level, use `propertyForm({ filePathActions })`
or an Inspector provider's `inspection.filePathActions(fieldCtx)` to append
project actions to every `filepath` / `img` / `snd` field without adding
per-field schema noise. The framework renders the menu and runs UiActions; the
host owns file manager reveal, desktop save dialogs, downloads, and permission
policy.

Schema-driven value edits should propagate as path changes. `propertyForm`
starts the path with the top-level schema key, and nested renderers append their
own logical segment:

```js
{
  field: 'aaa.metalist[5].transform.pos.x',
  mode: 'path',
  value: 10,
}
```

This keeps `onChange(field, value, targets, meta)` simple: `field` is the same
canonical path string as `meta.change.field`, and `value` is the leaf value for
that path. `struct` renderers append field names from `struct_def`; real arrays
append `[index]`; dictionaries append key segments. Renderers must not bubble a
whole parent composite just because a child field changed.

Whole-value replacement remains explicit with `mode:"literal"` and should be
used only when a renderer intentionally replaces the complete value identified
by `field`.

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

Composite fields can also choose a field row layout:

```js
{
  transform: {
    type: 'struct',
    label: 'Transform',
    fieldLayout: 'block',
    struct_def: {
      pos: 'vec3',
      rot: 'vec3',
      scale: 'vec3',
    },
  },
}
```

`fieldLayout:"row"` is the default `label | editor` layout. Use it for compact
primitive fields and small controls.

`fieldLayout:"block"` puts the label on its own row and lets the editor span
the full width below it. This is the preferred layout for fixed composites such
as structs, vectors, curves, arrays, and dictionaries when horizontal room is
more valuable than one-line density.

`fieldLayout:"section"` uses the same full-width editor layout but makes the
field label a local collapsible header. It is still a field row, not a
`propertyForm` group. Use it for larger outer composites; nested child fields
remain normal rows unless their own schema explicitly asks for a different
layout. `defaultCollapsed:true` controls the initial local collapsed state.

If `fieldLayout:"section"` is combined with a hidden or screen-reader-only
label, the field uses block layout instead. A collapsible field must have a
visible header.

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

Individual property rows can also expose visible actions. `propertyForm` accepts
`fieldActions(fieldCtx)` and schema fields may carry `actions: UiAction[]`.
Those actions render through `ui.actionBar` on the row's right edge and support
the same `icon`, `title`, `menu`, `variant:"danger"`, `command`, and `args`
shape as header/group actions. Row actions are UI chrome only; mutations still
route through host commands or the form's normal `onChange` path.

Field-owned controls that belong with the label, such as `propertyForm`'s
reset-to-default button, live in the label chrome. They do not consume editor
width. For `fieldLayout: "block"` / `"section"`, the label and its controls
stay on the title row while the editor keeps the next row. `label: false` /
`labelMode: "hidden"` hides only the label text; label chrome actions remain
visible when present.

Property rows can also expose context-menu actions with one form-level strategy
function:

```js
aiditor.ui.propertyForm({
  schema: schema,
  targets: targets,
  ctx: editorCtx,
  fieldContextActions: function (fieldCtx) {
    if (fieldCtx.resolvedField.type === 'number') {
      return [
        { label: 'Reset', icon: 'refresh', command: 'field.reset' },
        { label: 'Copy Value', icon: 'copy', command: 'field.copyValue' },
      ]
    }
    return [{ label: 'Copy Value', icon: 'copy', command: 'field.copyValue' }]
  },
})
```

This is intentionally a single strategy function, not per-field event wiring.
The framework creates `fieldCtx` for the row that was right-clicked and calls
the same callback for every field. Callers branch by field key, resolved type,
group, target metadata inside `ctx`, or any other host-owned data.

`fieldContextActions(fieldCtx)` may return `UiAction[]` or
`Promise<UiAction[]>`. Async actions are for host-owned checks such as
permissions, reference lookups, or AI availability. The framework only owns the
loading/menu lifecycle; it does not interpret the result.

`fieldCtx` contains:

```js
{
  field,          // schema key
  label,          // displayed row label
  value,          // current displayed value
  targets,        // current propertyForm targets
  rawField,       // original schema field
  resolvedField,  // resolveFieldDef(rawField)
  ctx,            // caller-provided context
}
```

Right-click triggering is deliberately narrow:

- field label opens the field context menu;
- row chrome / non-editor empty space opens the field context menu;
- editor controls keep their own right-click behavior.

Events that originate inside `input`, `textarea`, `select`, `button`,
`[contenteditable]`, textbox/searchbox/spinbutton widgets, numberInput, sliders,
comboboxes, action bars, popovers, or other interactive editor content must not
open the field row menu. If no `fieldContextActions` is supplied, or if the
resolved action list is empty, the framework does not call `preventDefault` and
the browser/context owner keeps its normal menu.

Each `structInput` / `propertyForm` instance owns at most one open field
context menu. Opening a new field context menu closes the previous one in the
same form, and menu dismiss removes the tracked handle. Field context menus use
`actionMenu({ behavior:"context" })`, so a click on the original field row is
an outside click. Button dropdowns rendered by `actionBar` keep their dropdown
behavior.

Field row actions must not change the stability contract. Adding or updating
actions should refresh row chrome in place, not recreate the editor. With no
actions, rows keep the existing label/editor layout. With actions, rows become
`label | editor | actions`; hidden-label rows become `editor | actions`.

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

Theme configuration has two deliberately separate sources of truth:

- `src/core/theme.js` owns theme metadata: mode id, display label, color scheme,
  and public lookup helpers.
- `src/style/theme.css` owns the base theme contract, density, and shared
  reduced-motion rules.
- `src/style/themes/<id>.css` owns the visual token implementation for one
  built-in mode.

Do not derive theme metadata by parsing CSS selectors, and do not duplicate
theme mode arrays in settings panels, demo helpers, AI tools, or tests. CSS is
the visual contract; Core metadata is the runtime schema contract.

The public metadata surface is:

```js
aiditor.theme.modes()        // [{ id, label, scheme }]
aiditor.theme.modeIds()      // ['dark', 'dracula', ...]
aiditor.theme.modeOptions()  // [{ value, label }]
aiditor.theme.hasMode(id)
```

Consumers should use that surface:

```js
aiditor.ui.select({
  value: mode,
  options: aiditor.theme.modeOptions(),
})

const schema = {
  type: 'string',
  enum: aiditor.theme.modeIds(),
}
```

`aiditor.theme.set(mode[, root])` and `aiditor.theme.setDensity(density[, root])`
are low-level runtime APIs. They update the target root immediately and do not
persist by themselves, because scoped roots should not overwrite global user
preferences.

The built-in theme preference is owned by `aiditor.settings`:

```text
theme.mode
theme.density
```

`src/style/theme-settings.js` registers those settings, applies them on startup,
and the `theme-config` panel writes through the same settings surface. Legacy
standalone keys such as `aiditor-theme-mode` and `aiditor-theme-density` are
migrated into settings when no explicit setting exists. Custom authoring-token
overrides are restored from the theme override store before the settings effect
applies the active mode.

Adding a built-in theme requires exactly two authored changes:

1. Add metadata to `aiditor.theme` in `src/core/theme.js`.
2. Add `src/style/themes/<id>.css` with the matching
   `[data-aiditor-theme="<id>"]` token block, and add that file to
   `CSS_ORDER` in `tools/build.mjs`.

The settings UI, `theme-config` panel, demo AI theme tools, docs examples, and
tests must read the Core metadata instead of maintaining their own theme lists.

### Theme Appearance Contract

Theme quality is not only color. AIditor themes define a compact appearance
contract with five high-leverage axes:

```text
color
shape
stroke
elevation
surface texture
accent geometry
```

The design goal is to let themes express different visual languages, such as a
neutral Godot-like dark theme or a neon arcade poster theme, without adding
theme-specific component CSS. Components must not branch on a theme id.
They consume role tokens.

The existing color contract remains:

```css
--aiditor-bg-*
--aiditor-fg-*
--aiditor-border*
--aiditor-accent*
--aiditor-success / --aiditor-warn / --aiditor-error / --aiditor-info
```

The appearance contract adds role tokens for shape:

```css
--aiditor-radius-control
--aiditor-radius-surface
--aiditor-radius-overlay
--aiditor-radius-tab
--aiditor-radius-chip
```

For stroke:

```css
--aiditor-border-w
--aiditor-border-w-strong
--aiditor-border-w-focus
--aiditor-control-border-w
--aiditor-surface-border-w
--aiditor-overlay-border-w
--aiditor-dock-border-w
--aiditor-toolbar-border-w
```

For elevation:

```css
--aiditor-shadow-control
--aiditor-shadow-surface
--aiditor-shadow-raised
--aiditor-shadow-overlay
--aiditor-shadow-active
```

For root-level surface texture:

```css
--aiditor-root-bg-image
--aiditor-root-bg-size
--aiditor-root-bg-position
--aiditor-root-bg-blend
```

For small accent geometry:

```css
--aiditor-corner-accent-size
--aiditor-corner-accent-color
--aiditor-corner-accent-opacity
```

Dock tabs have one additional component-level appearance contract because their
shape depends on toolbar direction. Component CSS owns the geometry
(`top` / `bottom` / `left` / `right`), while the theme owns the active fill,
indicator, overlay, radius, gap, and per-direction shadow:

```css
--aiditor-dock-tab-bg
--aiditor-dock-tab-hover-bg
--aiditor-dock-tab-active-bg
--aiditor-dock-tab-border-w
--aiditor-dock-tab-border
--aiditor-dock-tab-hover-border
--aiditor-dock-tab-active-border
--aiditor-dock-tab-fg
--aiditor-dock-tab-hover-fg
--aiditor-dock-tab-active-fg
--aiditor-dock-tab-gap
--aiditor-dock-tab-radius-top
--aiditor-dock-tab-radius-bottom
--aiditor-dock-tab-radius-left
--aiditor-dock-tab-radius-right
--aiditor-dock-tab-indicator-bg
--aiditor-dock-tab-indicator-bg-vertical
--aiditor-dock-tab-indicator-size
--aiditor-dock-tab-indicator-inset
--aiditor-dock-tab-indicator-radius
--aiditor-dock-tab-indicator-opacity
--aiditor-dock-tab-active-overlay-top
--aiditor-dock-tab-active-overlay-bottom
--aiditor-dock-tab-active-overlay-left
--aiditor-dock-tab-active-overlay-right
--aiditor-dock-tab-active-shadow-top
--aiditor-dock-tab-active-shadow-bottom
--aiditor-dock-tab-active-shadow-left
--aiditor-dock-tab-active-shadow-right
```

Buttons have a small component-level color contract because bright themed
button fills need matching foreground colors to stay readable:

```css
--aiditor-button-bg
--aiditor-button-fg
--aiditor-button-border
--aiditor-button-hover-bg
--aiditor-button-hover-fg
--aiditor-button-hover-border
--aiditor-button-active-bg
--aiditor-button-active-fg
--aiditor-button-active-border
--aiditor-button-primary-bg
--aiditor-button-primary-fg
--aiditor-button-primary-border
--aiditor-button-primary-hover-bg
--aiditor-button-primary-hover-fg
--aiditor-button-primary-hover-border
--aiditor-button-primary-active-bg
--aiditor-button-primary-active-fg
```

Accent geometry is intentionally narrow. It is a small optional marker for
container-like surfaces, not a general clip-path or illustration system. Default
themes keep it disabled with zero size and transparent color. A geometric theme
can enable a small corner marker on dock, section, and card surfaces through
the shared component CSS.

Component consumption rules:

- Form controls use `radius-control`, `control-border-w`, and
  `shadow-control`.
- Dock bodies, views, cards, sections, property groups, and list containers use
  `radius-surface`, `surface-border-w`, and `shadow-surface`.
- Popovers, menus, modals, drawers, and toasts use `radius-overlay`,
  `overlay-border-w`, and `shadow-overlay`.
- Tabs use `radius-tab`; chips, badges, and pills use `radius-chip`.
- Dock tabs use the dock-tab token set above so themes can choose between an
  edge glow, a full active slab, a hard outline, or a flat indicator without
  changing dock renderer logic.
- AIditor root/view background may use `root-bg-*`. Ordinary panels and fields
  should not apply texture, because editor content must remain clear and dense.
- Components should keep semantic state tokens for hover, selected, active,
  focus, success, warning, danger, and info.

Non-goals:

- No theme-specific selectors such as `.theme-neon .aiditor-ui-button`.
- No component logic that checks a theme id.
- No full CSS parser or automatic theme discovery from selector names.
- No broad `clip-path` shape system for controls. It is hard to keep accessible,
  focusable, and text-safe in dense editor UIs.
- No per-component explosion such as `--aiditor-button-neon-corner-size`.

### Lightweight distribution

Theme consumers may load `dist/aiditor-theme.css` alone and select a built-in
mode with `data-aiditor-theme`. Loading `dist/aiditor-theme.js` additionally
provides `aiditor.theme` metadata and runtime switching.

Websites can load standalone `dist/aiditor-mini.css` and
`dist/aiditor-mini.js`. Mini contains themes, common buttons and inputs, basic
layouts, and overlays. It deliberately excludes Inspector, schema-driven
forms, arrays/structs, Tree/Table/FileBrowser, advanced editors, panels, and the
editor component palette/registry. Mini widgets are direct `aiditor.ui.*`
primitives.

Applications that need the complete generic editor UI without the editor shell
can load `dist/aiditor-editor.css` and `dist/aiditor-editor.js`. Editor includes
every generic `aiditor.ui.*` primitive while excluding Dock, Workspace,
History, Shortcuts, Settings, built-in panels, AI Host, and Extension Runtime.
Mini and Editor are standalone alternatives to Kernel/Core/Full, not add-ons.

The Neon arcade theme should therefore be expressed by assigning these
shared appearance roles:

```css
--aiditor-surface-canvas: #00020a;
--aiditor-surface-panel:  #030916;
--aiditor-surface-field:  #00040d;
--aiditor-text-primary:   #fbfcff;
--aiditor-brand:          #ff2b93;
--aiditor-state-info:     #13bfff;
--aiditor-state-warning:  #facf01;

--aiditor-border-w: 1px;
--aiditor-border-w-strong: 2px;
--aiditor-surface-border-w: 1px;
--aiditor-toolbar-border-w: 2px;

--aiditor-radius-control: 8px;
--aiditor-radius-surface: 12px;
--aiditor-radius-overlay: 12px;
--aiditor-radius-tab: 10px;

--aiditor-shadow-control:
  0 0 0 1px color-mix(in srgb, var(--aiditor-stroke-hover) 22%, transparent),
  0 0 10px color-mix(in srgb, var(--aiditor-state-info) 10%, transparent),
  inset 0 1px 0 color-mix(in srgb, #ffffff 14%, transparent);
--aiditor-shadow-surface:
  0 0 0 1px color-mix(in srgb, var(--aiditor-stroke-hover) 24%, transparent),
  0 0 18px rgba(0,234,255,.13),
  inset 0 0 24px rgba(19,191,255,.055);
--aiditor-shadow-overlay:
  0 0 0 1px color-mix(in srgb, var(--aiditor-stroke-hover) 42%, transparent),
  0 0 30px rgba(0,234,255,.22),
  0 0 46px rgba(255,43,147,.12),
  0 14px 42px rgba(0,0,0,.60);

--aiditor-root-bg-image:
  linear-gradient(112deg, transparent 0 58%, rgba(19,191,255,.18) 58.2% 59.4%, rgba(22,88,255,.28) 59.6% 61.4%, transparent 61.8% 100%),
  radial-gradient(circle at 78% 16%, rgba(19,191,255,.18), transparent 30%),
  radial-gradient(circle at 16% 86%, rgba(255,43,147,.20), transparent 30%),
  radial-gradient(circle, rgba(19,191,255,.13) 0 1px, transparent 1.4px),
  linear-gradient(135deg, #00020a, #000413 50%, #01030b);
--aiditor-root-bg-size: auto, auto, auto, 34px 34px, auto;

--aiditor-corner-accent-size: 14px;
--aiditor-corner-accent-color: var(--aiditor-accent);
--aiditor-corner-accent-opacity: .95;

--aiditor-selected: color-mix(in srgb, var(--aiditor-state-warning) 82%, #08357f);
--aiditor-selected-fg: #151000;
--aiditor-button-bg: linear-gradient(180deg, #125bff 0%, #0837a8 100%);
--aiditor-button-fg: #ffffff;
--aiditor-button-hover-bg: linear-gradient(180deg, #21f4ff 0%, #1687ff 100%);
--aiditor-button-hover-fg: #001426;
--aiditor-button-active-bg: #facf01;
--aiditor-button-active-fg: #171000;
--aiditor-dock-tab-hover-bg: linear-gradient(180deg, #13bfff 0%, #1658ff 100%);
--aiditor-dock-tab-active-bg: #facf01;
--aiditor-dock-tab-indicator-bg: var(--aiditor-state-warning);
--aiditor-dock-tab-indicator-bg-vertical: var(--aiditor-state-warning);
--aiditor-dock-tab-indicator-size: 2px;
--aiditor-dock-tab-indicator-inset: 8px;
--aiditor-dock-tab-active-overlay-top:
  linear-gradient(to bottom, rgba(255,255,255,.24), transparent 58%),
  radial-gradient(90px 24px at 50% 0, rgba(255,43,147,.40), transparent 74%);
```

This gives the theme a near-black editor stage, cyan neon rails, restrained
edge glow, magenta focus/selection energy, yellow arcade accents, sparse
geometric background energy, and direction-aware yellow dock tabs while keeping
ordinary fields readable and editor-dense.

The built-in `toybox-purple` theme applies the same appearance contract in a
compact light editor language. Purple owns focus, selection, primary actions,
and active Dock tabs. Gold is a restrained secondary register for warning and
attention emphasis instead of a global hover color. Pink stays an
optional supporting accent, while mint/blue/coral retain success, information,
and danger semantics. Lavender-gray work surfaces, short colored-base shadows,
and narrow top highlights preserve the dimensional toybox character without
turning dense editor views into large website cards. In this theme, Inspector
Property Form groups use a parent-owned `2px` gap so expanded and collapsed
sections keep the same compact rhythm.

# ui API

Generated from structured API comments in `src/`.

## `aiditor.ui.actionBar`

Render a compact local action surface. Actions can run commands, call local UI handlers, or open framework menus.

```js
aiditor.ui.actionBar(opts)
```

| Param | Type | Description |
|---|---|---|
| `opts` | `object` | Action bar options. |
| `opts.actions` | `Array\|Signal<Array>\|Function` | UiAction records, a signal of records, or a function of ctx. |
| `opts.ctx` | `object\|Signal<object>` | Context passed to action predicates, args, menus, and commands. |
| `opts.density` | `string` | Optional density, "compact" by default. |

Returns: `HTMLElement` Action bar root element.

Related: `aiditor.commands.run`

Source: `src/ui/base/actionBar.js`

## `aiditor.ui.actionMenu`

Open a ui.menu from UiAction records at an anchor or pointer position.

```js
aiditor.ui.actionMenu(opts)
```

| Param | Type | Description |
|---|---|---|
| `opts` | `object` | Menu options. |
| `opts.anchor` | `HTMLElement` | Owner/anchor element for lifecycle and fallback placement. |
| `opts.point` | `object` | Optional pointer position: { x, y }. |
| `opts.actions` | `Array\|Function\|Promise` | UiAction records, a function of ctx, or Promise<UiAction[]>. |
| `opts.ctx` | `object\|Signal<object>` | Context passed to action predicates, args, menus, and commands. |
| `opts.behavior` | `string` | Optional menu behavior: "dropdown" (default) or "context". |
| `opts.sourceScope` | `string` | Optional error/log source scope for actions opened from another surface. |

Returns: `object` Handle with close().

Related: `aiditor.ui.actionBar`, `aiditor.ui.menu`

Source: `src/ui/base/actionMenu.js`

## `aiditor.ui.propertyForm`

Render a schema-driven property editor for one target or a multi-target batch edit. Multi-target reads use the first target value; writes fan out only through enabled fields.

```js
aiditor.ui.propertyForm(opts)
```

| Param | Type | Description |
|---|---|---|
| `opts` | `object` | Form options. |
| `opts.targets` | `Signal<object[]>\|object[]` | Targets to edit. |
| `opts.schema` | `Signal<object>\|object` | Field schema passed to editorFor. |
| `opts.onChange` | `Function` | Optional persistence hook: (fieldPath, newValue, targets, meta) => void. |
| `opts.groups` | `object\|Signal<object>` | Optional grouped section metadata, including labels, actions, defaultCollapsed, and enabledBy. |
| `opts.groupActions` | `Function` | Optional per-group UiAction factory. Returning null/undefined falls back to groups[groupId].actions; returning [] explicitly clears actions. |
| `opts.groupActionCtx` | `Function` | Optional mapper for the context passed to group actions. |
| `opts.fieldActions` | `Function` | Optional per-field UiAction factory. Returning null/undefined falls back to schemaField.actions; returning [] explicitly clears actions. |
| `opts.fieldContextActions` | `Function` | Optional field context-menu UiAction factory. May return UiAction[] or Promise<UiAction[]>. |
| `opts.filePathActions` | `Function` | Optional UiAction factory appended to file path input menus. |
| `opts.searchQuery` | `string\|Signal<string>` | Optional display-only recursive field filter. |
| `opts.requireAllTargets` | `boolean` | When true, disable fields missing from any target. |
| `opts.canEdit` | `Function` | Optional field gate: (field, targets, rawField) => boolean. |

Returns: `HTMLElement` Property form root element.

```js
var form = aiditor.ui.propertyForm({
  targets: aiditor.signal([{ x: 0, color: '#44aaff' }]),
  schema: { x: { type: 'number' }, color: { type: 'color' } },
})
```

Related: `aiditor.inspector.registerProvider`

Source: `src/ui/form/propertyForm.js`

## `aiditor.ui.propertyList`

Render a stable keyed list of expandable schema-driven property blocks.

```js
aiditor.ui.propertyList(opts)
```

| Param | Type | Description |
|---|---|---|
| `opts` | `object` | Property list options. |
| `opts.items` | `Array\|Signal<Array>` | Item array or signal. Refreshes reconcile by stable key. |
| `opts.getKey` | `Function` | Stable item id resolver: (item, index) => id. |
| `opts.schema` | `Function` | Schema resolver, object, or signal for each item body. |
| `opts.onFieldChange` | `Function` | Optional field persistence hook: (itemId, field, value, meta) => void. |

Returns: `HTMLElement` Property list root element.

Related: `aiditor.ui.propertyForm`, `aiditor.ui.section`, `aiditor.ui.actionBar`

Source: `src/ui/form/propertyList.js`

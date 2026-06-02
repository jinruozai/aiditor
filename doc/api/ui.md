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
| `opts.onChange` | `Function` | Optional persistence hook: (field, newValue, targets, meta) => void. |
| `opts.groups` | `object\|Signal<object>` | Optional grouped section metadata, including labels and UiAction arrays. |
| `opts.groupActions` | `Function` | Optional per-group UiAction factory. Returning null/undefined falls back to groups[groupId].actions; returning [] explicitly clears actions. |
| `opts.groupActionCtx` | `Function` | Optional mapper for the context passed to group actions. |
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

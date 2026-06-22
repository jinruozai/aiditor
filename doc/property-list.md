# Property List

This document defines the framework-level design for editing a stable list of
property-backed objects. It is a generic UI primitive. It does not know about
GameData, rules, fields, assets, scene nodes, tracks, or project workflows.

## Purpose

Many editors need to edit a collection of child objects:

```text
object list
  object header: title / summary / actions
  object body: schema-driven properties
```

Examples include field definitions, import presets, slot definitions, keyframe
metadata rows, material parameter blocks, command presets, and plugin option
records. The shared UI problem is not the domain object. The shared UI problem
is stable keyed object chrome around a property form.

`aiditor.ui.propertyList` provides that chrome:

```text
propertyList
  -> keyed item reconcile
      -> ui.section title / meta / actions
      -> ui.propertyForm for that item's value
```

The host still owns object identity allocation, add/delete commands, validation,
history, persistence, dictionary-to-list projection, and domain semantics.

## Boundary

Property List owns:

- keyed object row/section lifecycle;
- per-item title, meta, collapsed state, and action surface rendering;
- stable value refresh without rebuilding unchanged item DOM;
- per-item `propertyForm` mounting;
- forwarding field changes with enough context for the host to commit them.

Property List does not own:

- project models;
- dictionary key rename semantics;
- rule/field/asset/scene concepts;
- undo/redo or command grouping;
- validation policy;
- persistence;
- add/delete/reorder business behavior.

The primitive must stay a composition layer over existing UI contracts, not a
second property editor.

## API Shape

```js
aiditor.ui.propertyList({
  items,                  // Array | Signal<Array>
  getKey,                 // (item, index) => stable id, required for rich usage

  title,                  // string | Signal | (itemCtx) => string
  meta,                   // string | Signal | (itemCtx) => string
  value,                  // (itemCtx) => object, default item.value || item
  schema,                 // object | Signal<object> | (itemCtx) => object
  groups,                 // object | Signal<object> | (itemCtx) => object

  actions,                // UiAction[] | (itemCtx) => UiAction[]
  fieldActions,           // (fieldCtx) => UiAction[]

  collapsed,              // Record<id, boolean> | Signal<Record<id, boolean>>
  defaultCollapsed,       // boolean
  onToggle,               // (itemId, collapsed, meta) => void

  onFieldChange,          // (itemId, field, value, meta) => void
  onItemChange,           // (itemId, nextValue, meta) => void

  density,                // "compact" | "comfortable"
  emptyText,
  ariaLabel,
  ctx,
})
```

`items` accepts either a plain array or a signal. A plain array is normalized to
an internal signal so the component has one reactive path. A host that refreshes
data updates the `items` signal with the new projected array.

`getKey` returns a stable framework identity for the item. It must not be
the editable display key when that key can change. For example, a field
definition editor uses a stable field definition id, while the visible
field key is only the section title and an editable property.

## Item Context

Each resolver receives an item context:

```js
{
  id,
  index,
  item,
  value,
  items,
  ctx
}
```

`id` is the stable key. `value` is the object passed to the inner
`propertyForm`. `ctx` is the caller-provided context and has no framework
meaning.

Item actions are local `UiAction` records rendered by `aiditor.ui.actionBar`.
Data-changing actions route through `aiditor.commands.run`; `onSelect`
is reserved for local UI behavior.

## Keyed Reconcile Contract

This is the core contract.

When `items` changes, `propertyList` must reconcile by stable id:

1. Existing ids keep their section DOM.
2. Existing ids update title, meta, actions, value signal, schema signal, and
   group/action chrome in place.
3. New ids create new sections.
4. Removed ids dispose only their own section.
5. Reordered ids move existing DOM nodes; they are not disposed and rebuilt.

Value-only refresh must not interrupt:

- text input focus;
- numberInput pointer capture or drag scrubbing;
- open menus/popovers owned by the row unless the owning action disappears;
- collapsed state;
- scroll position inside the row body;
- editor-local DOM state owned by unchanged field editors.

This mirrors the existing `propertyForm` stability contract: schema-equivalent
refreshes update slot signals, while structural changes rebuild only the
affected structure.

## Collapsed State

Collapsed state is keyed by item id.

If `collapsed` is supplied, the host owns the map and receives `onToggle`.
Without `collapsed`, `propertyList` owns an internal keyed map. Reordering or
refreshing items must preserve collapsed state for unchanged ids.

If an id disappears, its internal collapsed state is removed with that item.

## Field Row Actions

`propertyForm` and `structInput` need row-level action surfaces in addition to
existing group header actions.

Two declaration paths are supported:

```js
aiditor.ui.propertyForm({
  schema,
  targets,
  fieldActions: function (fieldCtx) {
    return [{ icon: 'edit', title: 'Edit', command: 'field.edit' }]
  },
})
```

or field-local schema:

```js
{
  type_render: {
    type: 'string',
    actions: [{ icon: 'edit', title: 'Edit', command: 'field.editRenderer' }]
  }
}
```

The effective action list is:

```text
fieldActions(fieldCtx) result when non-null
else rawField.actions
else []
```

Returning `[]` explicitly renders no actions.

Field action context:

```js
{
  field,
  label,
  rawField,
  resolvedField,
  value,
  targets,
  ctx
}
```

Actions are rendered through `aiditor.ui.actionBar` and use the same `UiAction`
shape as header and group actions: `icon`, `label`, `title`, `variant:"danger"`,
`disabled`, `hidden`, `menu`, `command`, `args`, and local `onSelect`.

Visible field row actions are separate from field context-menu actions.
`propertyForm` can also receive one `fieldContextActions(fieldCtx)` strategy
function. The same callback is used for every field; it receives the row's
`fieldCtx` and returns `UiAction[]` or `Promise<UiAction[]>`.

```js
aiditor.ui.propertyForm({
  schema,
  targets,
  fieldContextActions: function (fieldCtx) {
    return fieldCtx.resolvedField.type === 'number'
      ? [{ label: 'Reset', icon: 'refresh', command: 'field.reset' }]
      : []
  },
})
```

This is not per-field UI wiring. A `propertyList` item can pass its own
strategy down to the nested `propertyForm`, but the row DOM, menu placement,
loading state for async actions, and UiAction execution stay in the framework.
The caller owns the returned actions and their semantics.

## Field Row Layout

The row layout remains label + editor by default.

When actions are present, the row becomes:

```text
label | editor | actions
```

For hidden-label rows:

```text
editor | actions
```

The actions rail must be fixed to the right edge and must not shrink the editor
below its existing responsive minimum. With no actions, rows do not reserve
empty action space.

Action clicks must not:

- trigger section collapse;
- steal pointer capture from an active number input;
- rebuild the row;
- break current focus unless the action explicitly opens focusable UI.

Field context menus follow the same stability rule. Right-clicking a label or
row chrome can open a menu, but right-clicking inside text inputs, numberInput,
select, sliders, comboboxes, buttons, action rails, or popovers must keep the
control's native/component context behavior. If the strategy is absent or
resolves to no visible actions, the browser menu is not intercepted.

One `structInput` / nested `propertyForm` owns one field context menu at a
time. Opening a field menu closes the previous field menu in the same form, and
dismiss clears the tracked handle so later right-clicks do not close stale
menus. These menus use context-menu dismissal semantics: clicking the original
field row is outside the menu and closes it. Button dropdowns rendered by row
actions keep the normal dropdown anchor behavior.

## Relationship To Existing Components

`propertyList` is not a replacement for `arrayEditor`.

Use `arrayEditor` when the primary problem is list interaction: selection,
active row, row-level custom rendering, duplicate/delete/reorder, and drag
feedback.

Use `propertyList` when the primary problem is editing a keyed set of objects
where each object expands to a schema-driven property form.

Use `propertyForm` directly when there is one object or one multi-target
selection to edit.

Use Inspector when the current selection can come from many editor surfaces and
a shared dock panel should inspect it.

## Example

```js
aiditor.ui.propertyList({
  items: fieldDefsSig,
  getKey: function (item) { return item.id },
  title: function (itemCtx) { return itemCtx.value.key },
  meta: function (itemCtx) {
    return itemCtx.value.base_type + ' / ' + itemCtx.value.type_render
  },
  value: function (itemCtx) { return itemCtx.item.value },
  schema: fieldDefSchema,
  actions: function (itemCtx) {
    return [{
      icon: 'trash',
      title: 'Delete',
      variant: 'danger',
      command: 'fields.delete',
      args: { id: itemCtx.id },
    }]
  },
  fieldActions: function (fieldCtx) {
    if (fieldCtx.field === 'type_render') {
      return [{ icon: 'edit', title: 'Edit renderer', command: 'fields.editRenderer' }]
    }
    return []
  },
  onFieldChange: function (id, field, value) {
    aiditor.commands.run('fields.patch', { id: id, field: field, value: value })
  },
})
```

This example uses field-definition names because it is a useful shape, not
because `propertyList` understands field definitions.

## Tests

Framework tests should cover:

- plain array `items` and signal `items`;
- keyed refresh preserving existing item DOM;
- reorder preserving existing item DOM;
- removed item disposing only that item;
- collapsed state preserved by id;
- item title/meta/actions updating without body rebuild;
- `propertyForm` field actions from schema and from `fieldActions`;
- hidden-label rows with actions spanning correctly;
- numberInput drag continuing across value-only item refresh;
- action clicks not toggling the section.

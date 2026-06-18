# Inspector

Inspector is the framework-level property inspection shell. It is intentionally
small: the framework owns selection order, provider lookup, and the dock panel;
domain editors own object meaning, schemas, validation, persistence, and custom
sections.

## Model

```text
ordered targets -> provider.inspect(targets) -> Inspection -> inspector panel
                                                   |
                                                   v
                                             ui.propertyForm
```

The first selected target is the primary target. Inspector always displays the
primary target's values. There is no mixed-value state.

By default, every selected target must have the same `type` as the primary
target. Mixed-type selections are shown as unsupported unless the primary
target's provider explicitly opts in with `accept(targets)`.

For multi-target editing, a field is editable only when every selected target:

1. has that field in its inspected value,
2. passes the provider's `canWrite` rule, and
3. is not disabled by the field schema.

If any target lacks the field or cannot write it, the row remains visible with
the primary target's value, but the editor is disabled.

## Targets

Targets are lightweight references. They must keep user selection order.

```js
aiditor.inspector.select([
  {
    type: 'game.achievement',
    id: 'first-blood',
    title: 'First Blood',
    uri: 'game://achievement/first-blood',
    meta: { category: 'combat' },
  },
])
```

Target shape is intentionally open. The required field is `type` (or `kind` for
host compatibility). Providers decide how to resolve `id`, `uri`, and `meta`.

Call `aiditor.inspector.refresh()` when the selected object changed outside the
form and no provider `subscribe(refresh)` hook exists. It re-runs the current
selection through the active provider without changing selection.

## Provider

```js
aiditor.inspector.registerProvider('game.achievement', {
  accept: function (targets) {
    return targets.every(function (target) { return target.type === 'game.achievement' })
  },
  inspect: function (targets, ctx) {
    return {
      title: targets.length === 1 ? targets[0].title : targets.length + ' achievements',
      subtitle: 'Achievement',
      schema: {
        name: { type: 'string' },
        progress: { type: 'int' },
        unlocked: { type: 'bool' },
      },
      values: targets.map(function (target) {
        return achievementStore.get(target.id)
      }),
      canWrite: function (target, field, value) {
        return !value.locked
      },
      write: function (field, change, writeCtx) {
        writeCtx.targets.forEach(function (target, index) {
          achievementStore.patch(target.id, {
            [field]: writeCtx.valueForChange(change, target, index, writeCtx),
          })
        })
      },
      subscribe: function (refresh) {
        return achievementStore.onChange(refresh)
      },
    }
  },
})
```

Minimal object inspector:

```js
const cube = {
  position: { x: 0, y: 0, z: 0 },
  size: { x: 1, y: 1, z: 1 },
  color: '#ff6a00',
}

aiditor.inspector.registerProvider('three.cube', {
  inspect: function () {
    return {
      title: 'Cube',
      subtitle: 'Three.js object',
      schema: {
        position: {
          type: 'struct',
          struct_def: { x: 'float', y: 'float', z: 'float' },
        },
        size: {
          type: 'struct',
          struct_def: { x: 'float', y: 'float', z: 'float' },
        },
        color: { type: 'string', type_render: 'color', type_agv: { valueKind: 'hex' } },
      },
      values: [cube],
      write: function (field, change, ctx) {
        cube[field] = ctx.valueForChange(change, ctx.primary, 0, ctx)
        aiditor.inspector.refresh()
      },
    }
  },
})

aiditor.inspector.select({ type: 'three.cube', id: 'cube', title: 'Cube' })
```

`inspect(targets, ctx)` returns an Inspection object:

Provider-level `accept(targets)` is optional. Without it, Inspector only routes
same-type selections to the provider. With it, the provider owns the selection
compatibility decision, including mixed-type cases.

| Field | Purpose |
| --- | --- |
| `title` / `subtitle` | Header text for the panel. |
| `schema` | `ui.propertyForm` schema. |
| `values` | One plain value per target, in the same order. The first value is displayed. |
| `actions` | Optional `UiAction[]` rendered on the Inspector header's right side. |
| `groups` | Optional property group metadata passed to `ui.propertyForm`. |
| `groupActions(groupCtx)` | Optional per-group `UiAction[]` factory passed to `ui.propertyForm`. Returning `null` / `undefined` uses `groups[groupId].actions`; returning `[]` explicitly renders no actions. |
| `read(target)` | Optional alternative to `values`; called for each target. |
| `hasField(target, field, value, index)` | Optional field existence override. Default is own-property check on value. |
| `canWrite(target, field, value, index)` | Optional per-target write gate. |
| `write(field, change, ctx)` | Applies a field change. Absence makes the form read-only. |
| `readonly` | Disables the whole form. |
| `defaults` | Optional default values for reset buttons. |
| `subscribe(refresh, ctx)` | Optional external data subscription. Returns cleanup. |
| `render(ctx)` | Optional custom renderer for complex inspections. |

`render(ctx)` is for cases that are not just fields: table schema editors,
binding rows, layout pickers, texture lists, or tool buttons. When the complex
case is a keyed list of expandable property-backed objects, custom renderers
should prefer `aiditor.ui.propertyList` instead of rebuilding their own
accordion/property chrome. Use custom renderers sparingly; plain properties
should use `schema + values + write`.

## Action Surfaces

Inspector action surfaces are generic UI affordances. They do not define a
domain action model and they do not mutate data by themselves.

Header actions live in `inspection.actions` and render on the title line's
right side, above property search:

```js
{
  title: 'Object',
  subtitle: 'selected_item',
  actions: [{
    id: 'add',
    icon: 'plus',
    label: 'Add',
    command: 'selection.addItem',
    args: { id: 'selected_item' },
  }],
}
```

Grouped property actions live in `inspection.groups[groupId].actions` or
`inspection.groupActions(groupCtx)`. They render in the matching property
section header. If search filtering removes every field in a group, that group
and its actions disappear with it.

```js
{
  groups: {
    transform: {
      label: 'Transform',
      actions: [{
        id: 'more',
        icon: 'more-vertical',
        label: 'More',
        menu: [{
          label: 'Delete',
          icon: 'trash',
          variant: 'danger',
          command: 'selection.deleteGroupItem',
          args: { id: 'selected_item', group: 'transform' },
        }],
      }],
    },
  },
}
```

`groupCtx` contains only framework-level information:

```js
{
  source: 'inspector',
  groupId,
  label,
  fields,
  inspection,
  targets,      // inspector selection targets
  primary,
  values,       // current propertyForm values
  primaryValue,
  panel,
  bus,
  refresh,
}
```

The framework never interprets group ids as rules, components, materials,
tracks, or any other domain concept. Data changes should route through
`aiditor.commands.run`; `onSelect` is available for local UI-only behavior.

## Change Shape

PropertyForm currently emits literal changes:

```js
{ field: 'name', mode: 'literal', value: 'Name 1' }
```

The protocol reserves formula changes for future batch workflows:

```js
{ field: 'name', mode: 'formula', expression: 'Name ${index + 1}' }
```

The framework does not define a formula language yet and does not `eval`
expressions. Hosts can later install a formula evaluator with:

```js
aiditor.inspector.setFormulaEvaluator(function (change, target, index, ctx) {
  // return the value for this target
})
```

Provider `write` implementations should call `ctx.valueForChange(change,
target, index, ctx)` instead of reading `change.value` directly when they want
to be formula-ready.

## Panel

The built-in dock component is:

```js
{ component: 'inspector', title: 'Inspector', icon: 'settings' }
```

The panel is generic. It never listens to DOM clicks and never knows about game
data, animation tracks, scene nodes, assets, or demo projects. Editor surfaces
select objects explicitly with `aiditor.inspector.select(...)`.

The built-in panel header is intentionally compact: `title` and `subtitle`
share one ellipsized line, so a provider can show identity like `Meta
fill_light` without spending two rows. Multi-selection still uses the same
surface; providers can return a title such as `3 selected`, and the default
subtitle names the primary target type.

When a provider returns `actions`, the header shows them on the same line's
right side. The action surface is local to the Inspector panel and uses the
shared `UiAction` / `aiditor.ui.actionBar` primitive.

Normal `schema + values + write` inspections include a local property search
field below the header. The query is panel UI state only: it is not passed to
providers, does not enter history, and does not change selection. Filtering is
display-only and matches field key, field label, field `desc`, group id, and
group label. Empty groups disappear because the filtered schema no longer
contains rows for them. Clearing the query restores the original schema. Custom
`render(ctx)` inspections own their entire body UI and are not filtered by this
property search.

Inspector refreshes may return fresh `schema`, `groups`, and `values` objects.
The built-in panel keeps value updates separate from form structure updates:
equivalent schema/group structure reuses the existing `propertyForm` field DOM,
so dragging a number field, editing text, or holding focus is not interrupted by
a provider refresh. Only real field structure changes, or search filtering that
changes the visible field set, rebuild the form rows. Group labels and actions
update section header chrome without recreating the group body.

## Boundaries

- `propertyForm` is a UI form control.
- `inspector` is a dock panel.
- `inspector provider` adapts a domain object type to schema/read/write.
- `UiAction` is a local UI description routed through commands or local UI
  callbacks, not a domain action registry.
- Domain editors own selection rules, object IDs, validation, undo history, and
  persistence.

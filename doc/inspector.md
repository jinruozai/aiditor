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
          achievementStore.patch(target.id, field, writeCtx.valueForChange(change, target, index, writeCtx))
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
  position: [0, 0, 0],
  size: [1, 1, 1],
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
        tint: { type: 'var', type_render: 'color', type_agv: { valueKind: 'vec4', valueScale: 1 } },
      },
      values: [cube],
      write: function (field, change, ctx) {
        Object.assign(cube, ctx.applyChange(cube, change, ctx.schema))
        aiditor.inspector.refresh()
      },
    }
  },
})

aiditor.inspector.select({ type: 'three.cube', id: 'cube', title: 'Cube' })
```

`position` and `size` are `struct` fields, so their canonical values are tuple
arrays. `struct_def` provides the field names and order used by the UI; it does
not turn the value into a dictionary object. See
[schema-value-encoding.md](./schema-value-encoding.md).

`type_render: "color"` supports several storage encodings through
`type_agv.valueKind`: `"hex"` writes `#RRGGBB` / `#AARRGGBB`, `"int"` writes a
24-bit RGB integer, `"vec3"` writes `[r, g, b]`, and `"vec4"` writes
`[r, g, b, a]`. Vec arrays are RGBA, not ARGB. `type_agv.valueScale` may be
`1` for normalized floats or `255` for byte values. For `vec4`, a 6-digit RGB
text edit preserves the existing alpha; alpha changes only when the input or
picker supplies alpha.

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
| `fieldContextActions(fieldCtx)` | Optional field-row context-menu strategy passed to `ui.propertyForm`. Returns `UiAction[]` or `Promise<UiAction[]>`. |
| `fieldMessages` | Optional field-path message map, signal, promise, or async resolver. |
| `filePathActions(fieldCtx)` | Optional action strategy appended to `filepath` / `img` / `snd` input menus. |
| `read(target)` | Optional alternative to `values`; called for each target. |
| `hasField(target, field, value, index)` | Optional field existence override. Default is own-property check on value. |
| `canWrite(target, field, value, index)` | Optional per-target write gate. |
| `write(field, change, ctx)` | Applies a field change. `field` is `change.field`; for normal edits it is a full logical property path. Absence makes the form read-only. |
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

Field row context menus live in `inspection.fieldContextActions(fieldCtx)`.
The built-in Inspector only forwards the callback to its internal
`ui.propertyForm`; it does not add built-in field menu items.

```js
{
  fieldContextActions: function (fieldCtx) {
    return [
      {
        label: 'Copy Value',
        icon: 'copy',
        command: 'editor.copyInspectorField',
        args: { field: fieldCtx.field },
      },
    ]
  },
}
```

The callback is a single strategy for all fields. It may branch by
`fieldCtx.field`, `fieldCtx.resolvedField`, selection metadata stored in
`fieldCtx.ctx`, or host-owned permission state. It may return either
`UiAction[]` or `Promise<UiAction[]>`; async results are only a UI loading/menu
lifecycle concern for the framework.

`fieldCtx` contains the schema key, displayed label, current value, Inspector
selection targets, raw schema field, resolved schema field, and the provider
context. The framework does not interpret any of those values as rule ids,
component fields, asset paths, animation tracks, AI actions, or project data.

The trigger surface is narrow: right-clicking a field label or row chrome opens
the field context menu; right-clicking inside an editor control keeps that
control's native or component-level menu. If the provider does not supply
`fieldContextActions`, or if the resolved action list is empty, the browser
context menu is not blocked.

File path input menus use a separate strategy:
`inspection.filePathActions(fieldCtx)`. It appends host actions to the trailing
three-dot menu of `filepath`, `img`, and `snd` fields. The built-in menu only
contains Load and Clear; project actions such as Save As or Show in Files must
be returned explicitly by the provider.

```js
{
  filePathActions: function (fieldCtx) {
    if (!fieldCtx.value) return []
    return [{
      label: 'Show in Files',
      icon: 'folder',
      command: 'files.reveal',
      args: { path: fieldCtx.value },
    }]
  },
}
```

This keeps schema declarations focused on type/rendering while the provider
owns environment-specific file behavior.

## Field Messages

Schema-driven inspections may publish messages by logical field path:

```js
return {
  schema,
  values,
  fieldMessages: aiditor.signal({
    'transform.position[0]': [
      { kind: 'warning', message: 'Value is outside the recommended range.' },
    ],
  }),
  write,
}
```

The value can be a plain map, a signal, a promise, or a function receiving the
current Inspector context and an `AbortSignal`. A new inspection refresh clears
stale pending output, aborts the previous request, and ignores late results.
Setting a signal to `{}` clears all messages without rebuilding field editors.

Map keys use the same canonical logical paths as Inspector path changes,
including struct segments, array indices, and dictionary keys. Each value is a
message or message array:

```js
{ kind: 'info' | 'warning' | 'error', message: string, code?: string }
```

`propertyForm({ fieldMessages })` and `structInput` render messages in stable
field chrome beneath the editor. Nested `struct`, `array`, and `dict` renderers
reuse the same root message map and field-path composition; providers do not
render nested prompts manually. Error messages set `aria-invalid`, and all
message changes are associated with the field control through
`aria-describedby` and announced politely.

Field messages are presentation state. They do not change values, block writes,
enter history, or define domain validation policy. A provider decides when a
message is produced and whether an edit is allowed.

## Change Shape

Inspector changes describe what the user edited in the schema UI. They do not
describe project commands, undo groups, validation rules, or persistence.

Normal schema-driven edits emit path changes:

```js
{
  field: 'aaa.metalist[5].transform.pos.x',
  mode: 'path',
  value: 10,
}
```

`field` is the canonical logical path string. The same string is passed as the
first argument to provider `write(field, change, ctx)` so simple providers do
not need to open `change` just to route the write.

Path syntax is intentionally compact:

| Segment | Syntax | Example |
| --- | --- | --- |
| Struct field | `.name` | `transform.pos.x` |
| Dictionary/object key | `.name` when identifier-like | `render.material` |
| Array/list item | `[index]` | `metalist[5]` |
| Non-identifier key | `["key.with.dot"]` | `tags["ui.primary"]` |

The path is a UI/schema path, not a storage dump. A `struct` value may be stored
as a tuple array, but its path still uses `struct_def` field names. A real
array/list item uses its numeric index:

```js
// struct tuple encoding, but logical field path
{ field: 'transform.pos.x', mode: 'path', value: 10 }

// real array item path
{ field: 'vertices[3].x', mode: 'path', value: 10 }
```

`literal` remains the explicit whole-value replacement mode:

```js
{ field: 'transform', mode: 'literal', value: nextTransform }
```

Use `literal` only when a renderer or provider is replacing the complete value
identified by `field`. It is not the default for editing a nested property such
as `transform.pos.x`.

The Inspector helper surface should be:

```js
aiditor.inspector.pathChange(field, value)
aiditor.inspector.literalChange(field, value)
aiditor.inspector.parseFieldPath(field)
aiditor.inspector.formatFieldPath(segments)
aiditor.inspector.applyChange(targetValue, change, schema)
aiditor.inspector.valueForChange(change, target, index, ctx)
```

`parseFieldPath` and `formatFieldPath` are framework utilities so hosts do not
hand-roll parsers for bracket escaping. `applyChange` applies a `path` or
`literal` change to a plain inspected value using the schema to resolve struct
tuple positions. Providers that store plain objects can use it directly:

```js
write: function (field, change, ctx) {
  const next = ctx.applyChange(ctx.values[0], change, ctx.schema)
  store.replace(ctx.primary.id, next)
}
```

Providers with their own command system can route the path directly:

```js
write: function (field, change, ctx) {
  ctx.commands.run('object.setProperty', {
    target: ctx.primary,
    path: field,
    value: ctx.valueForChange(change, ctx.primary, 0, ctx),
  })
}
```

`valueForChange` resolves the value part of a change for one target. For
`mode:"path"` and `mode:"literal"` it returns `change.value`. It exists so
computed or batch modes can resolve target-specific values without changing the
provider write contract.

### Implementation Plan

The implementation should be a narrow Inspector/schema-form change, not a new
domain patch system.

1. Add path helpers in `src/ui/inspector.js`.
   - `pathChange(field, value)` creates `{ field, mode:"path", value }`.
   - `parseFieldPath(field)` parses dotted/bracket paths into segments.
   - `formatFieldPath(segments)` emits canonical strings, using `[index]` for
     numeric array segments and `["key.with.dot"]` for unsafe keys.
   - `applyChange(value, change, schema)` applies `path` and `literal` changes
     to canonical schema values.

2. Pass schema/write helpers through the built-in Inspector panel.
   - `writeCtx.schema` is the current inspection schema.
   - `writeCtx.applyChange` is `aiditor.inspector.applyChange`.
   - `writeCtx.valueForChange` remains available for providers that route
     command payloads directly.

3. Carry path context through schema renderers.
   - `propertyForm` starts a top-level field path from the schema key.
   - `editorFor` passes `ctx.fieldPath` to renderers.
   - `struct` appends field names from `struct_def`.
   - `array` appends `[index]` for item value editors.
   - `dict` appends key segments.

4. Let visual inputs stay visual.
   - `structInput` continues to edit keyed UI projections.
   - `dictInput` continues to own dynamic key rows.
   - `arrayEditor` continues to own row interaction.
   - These controls can forward `meta.change` from child editors, but they
     should not learn project semantics or canonical encoding rules.

5. Preserve value stability.
   - A child field edit emits the child `path` change.
   - The renderer still computes and writes the updated parent signal so the UI
     stays in sync.
   - The provider receives the child path, not the rewritten parent composite.

6. Test the path contract.
   - flat field: `name`;
   - nested struct tuple: `transform.pos.x`;
   - array item: `metalist[5].name`;
   - array of struct tuple: `items[1].num`;
   - dict key: `fruit.pear.weight`;
   - escaped key: `fruit["red.pear"].weight`;
   - `literal` whole replacement remains available;
   - `applyChange` preserves struct tuple, array, and dict canonical encoding.

If the implementation starts requiring `structInput` or `propertyForm` to know
about project objects, history, commands, or business validation, that is the
wrong direction. The path contract belongs to generic schema editing only.

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

Composite fields should not be forced into the default two-column property row
when that wastes the editor area. Providers can use `fieldLayout:"block"` on a
schema field to put the field label on one row and the composite editor below
it, spanning the full Inspector width. Use `fieldLayout:"section"` when that
field itself should be locally collapsible. This is distinct from `group`: a
group is an Inspector section that contains multiple fields, while
`fieldLayout` only changes one field row.

## Boundaries

- `propertyForm` is a UI form control.
- `inspector` is a dock panel.
- `inspector provider` adapts a domain object type to schema/read/write.
- `UiAction` is a local UI description routed through commands or local UI
  callbacks, not a domain action registry.
- Domain editors own selection rules, object IDs, validation, undo history, and
  persistence.

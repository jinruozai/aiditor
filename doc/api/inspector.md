# inspector API

Generated from structured API comments in `src/`.

## `aiditor.inspector.applyChange`

Apply a literal or path inspector change to a schema-encoded value without mutating the original value.

```js
aiditor.inspector.applyChange(value, change, schema)
```

| Param | Type | Description |
|---|---|---|
| `value` | `*` | Current top-level inspected value. |
| `change` | `object` | Change created by pathChange or literalChange. |
| `schema` | `object` | PropertyForm/Inspector schema used to preserve struct tuple, array, and dict encoding. |

Returns: `*` Updated value.

```js
const next = aiditor.inspector.applyChange(
  current,
  aiditor.inspector.pathChange('transform.pos.x', 12),
  schema
)
```

Related: `aiditor.inspector.pathChange`, `aiditor.inspector.literalChange`

Source: `src/ui/inspector.js`

## `aiditor.inspector.createFoldingStateStore`

Create the bounded project/primary folding-state owner used by PropertyForm field Sections, recursive StructInput Sections, and Groups.

```js
aiditor.inspector.createFoldingStateStore(options?)
```

| Param | Type | Description |
|---|---|---|
| `options` | `object` | Optional persistence, LRU, and throttling configuration. |

Returns: `object` FoldingStateStore with bind(scope,path), flush(), snapshot(workspaceId), and dispose().

Related: `aiditor.ui.propertyForm`, `aiditor.inspector.select`, `aiditor.workspaceState.configure`

Source: `src/ui/inspector-folding.js`

## `aiditor.inspector.formatFieldPath`

Format string and numeric path segments into the inspector field path syntax.

```js
aiditor.inspector.formatFieldPath(segments)
```

| Param | Type | Description |
|---|---|---|
| `segments` | `Array` | String field names and numeric array indices. |

Returns: `string` Formatted field path.

```js
aiditor.inspector.formatFieldPath(['items', 2, 'name'])
// 'items[2].name'
```

Related: `aiditor.inspector.parseFieldPath`, `aiditor.inspector.pathChange`

Source: `src/ui/inspector.js`

## `aiditor.inspector.literalChange`

Create a whole-field replacement change for providers that intentionally replace a complete top-level field value.

```js
aiditor.inspector.literalChange(field, value)
```

| Param | Type | Description |
|---|---|---|
| `field` | `string` | Top-level schema field name. |
| `value` | `*` | Replacement value for that field. |

Returns: `object` Change object with mode "literal".

```js
const change = aiditor.inspector.literalChange('transform', [[0, 1, 2], 1])
```

Related: `aiditor.inspector.pathChange`, `aiditor.inspector.applyChange`

Source: `src/ui/inspector.js`

## `aiditor.inspector.parseFieldPath`

Parse an inspector field path into string and numeric segments.

```js
aiditor.inspector.parseFieldPath(fieldPath)
```

| Param | Type | Description |
|---|---|---|
| `fieldPath` | `string` | Path such as "items[2].transform.pos.x". |

Returns: `Array` Path segments.

```js
aiditor.inspector.parseFieldPath('items[2].name')
// ['items', 2, 'name']
```

Related: `aiditor.inspector.formatFieldPath`, `aiditor.inspector.pathChange`

Source: `src/ui/inspector.js`

## `aiditor.inspector.pathChange`

Create a leaf-level inspector change whose field is a dotted/bracketed schema path such as transform.pos.x or items[2].name.

```js
aiditor.inspector.pathChange(fieldPath, value)
```

| Param | Type | Description |
|---|---|---|
| `fieldPath` | `string` | Schema path. Field keys are path tokens; keys containing "." or "[]" are invalid schema usage. |
| `value` | `*` | Leaf replacement value. |

Returns: `object` Change object with mode "path".

```js
const change = aiditor.inspector.pathChange('transform.pos.x', 12)
```

Related: `aiditor.inspector.applyChange`, `aiditor.inspector.formatFieldPath`

Source: `src/ui/inspector.js`

## `aiditor.inspector.refresh`

Notify inspector panels to re-read the current selection after external state changes.

```js
aiditor.inspector.refresh()
```

Returns: `void` No return value.

```js
cubeState.color = '#ffcc00'
aiditor.inspector.refresh()
```

Related: `aiditor.inspector.select`, `aiditor.inspector.registerProvider`

Source: `src/ui/inspector.js`

## `aiditor.inspector.registerProvider`

Register the editor-owned provider that turns selected targets of one type into an inspector schema, values, and write handlers.

```js
aiditor.inspector.registerProvider(type, provider, meta?)
```

| Param | Type | Description |
|---|---|---|
| `type` | `string` | Target type matched against target.type or target.kind. |
| `provider` | `object` | Provider with inspect(targets, ctx), plus optional accept(targets) and targetId(primary, targets) for stable per-primary UI state. |
| `meta` | `object` | Optional owner/layer metadata; pass { replace: true } only when intentionally replacing an existing provider. |

Returns: `Function` unregister callback.

```js
aiditor.inspector.registerProvider('cube', {
  inspect: function (targets) {
    return {
      schema: {
        x: { type: 'number', label: 'X', step: 0.1 },
        color: { type: 'color', label: 'Color' },
      },
      values: targets.map(function (target) { return target.value }),
      write: function (field, change, ctx) {
        ctx.targets.forEach(function (target, index) {
          target.value = ctx.applyChange(target.value, change, ctx.schema)
        })
      },
    }
  },
})
```

Avoid:

```js
aiditor.inspector.registerProvider({
  id: 'cube',
  getProperties: function () {},
  patchProperties: function () {},
})
```

Related: `aiditor.inspector.select`, `aiditor.inspector.refresh`, `aiditor.ui.propertyForm`

Source: `src/ui/inspector.js`

## `aiditor.inspector.select`

Set the ordered inspector selection. The first target is primary; multi-edit uses only fields present and writable on every target.

```js
aiditor.inspector.select(targets, meta?)
```

| Param | Type | Description |
|---|---|---|
| `targets` | `object\|object[]` | One target or ordered targets; each target should include type or kind. |
| `meta` | `object` | Optional selection metadata for the host/editor; workspaceId scopes persisted Inspector UI state. |

Returns: `void` No return value.

```js
aiditor.inspector.select([
  { type: 'cube', id: 'cube-1', value: cubeState },
])
```

Related: `aiditor.inspector.registerProvider`, `aiditor.inspector.refresh`

Source: `src/ui/inspector.js`

# Dict Input

`dict` is AIditor's generic schema type for dynamic key-value dictionaries.
`aiditor.ui.dictInput` is the matching UI primitive.

This is a framework-level capability. It does not know about GameData, rules,
fields, assets, scenes, resources, engines, importers, validation domains, or
history policy.

## Purpose

Many editors need to edit a value shaped like:

```js
{
  health: 100,
  speed: 4.5,
  displayName: 'Knight',
}
```

The keys are data. Users may add keys, delete keys, rename keys, and edit each
value. That makes `dict` different from `struct`:

- `struct` fields come from schema and are fixed.
- `dict` keys come from the value and are dynamic.

The UI can look similar because both render rows, but the data model and
interaction contract are different.

## Boundary

`dictInput` owns:

- dictionary row chrome;
- add/delete/rename key interactions;
- value editor mounting;
- keyed reconcile for unchanged keys;
- in-place preservation during rename started from this component;
- row actions through `aiditor.ui.actionBar`;
- compact editor styling that matches `structInput`.

`dictInput` does not own:

- project models;
- domain validation;
- undo/redo;
- command grouping;
- persistence;
- reference repair;
- schema migration;
- dictionary ordering as domain truth.

If a host needs stable domain ids, ordered records, or per-item schemas, it
should use `propertyList` or a host-owned projection. A plain dictionary's
framework identity is its key.

## Schema Type

`dict` is a built-in type:

```js
{
  name: 'Dictionary',
  base_type: 'dict',
  type_render: 'dict',
  default: {},
  type_agv: {
    value_type: 'string',
  },
}
```

Schema usage:

```js
{
  stats: {
    type: 'dict',
    type_agv: {
      value_type: 'float',
    },
  },
}
```

`value_type` may be a type name or inline FieldDef:

```js
{
  table: {
    type: 'dict',
    type_agv: {
      value_type: {
        type: 'struct',
        struct_def: {
          id: 'ref_id',
          weight: 'float',
        },
      },
    },
  },
}
```

Values stay dictionary objects:

```js
{
  apple: [101, 0.8],
  pear: [102, 0.6],
}
```

The value editor for each entry is still resolved through `editorFor`, so
`dict<string, struct>` naturally keeps each value's own canonical encoding.

## UI Primitive

Target API:

```js
aiditor.ui.dictInput({
  value,                 // object | Signal<object>
  valueType,             // type name | FieldDef; default "string"

  keyPlaceholder,
  createKey,             // (ctx) => string
  createValue,           // (ctx) => any
  normalizeKey,          // (rawKey, ctx) => string
  validateKey,           // (key, ctx) => true | string

  canAdd,                // (ctx) => boolean
  canDelete,             // (entryCtx) => boolean
  canRename,             // (entryCtx) => boolean
  canEditValue,          // (entryCtx) => boolean

  actions,               // UiAction[] | (entryCtx) => UiAction[]

  onChange,              // (nextValue, meta) => void
  onAdd,                 // (key, value, meta) => void
  onDelete,              // (key, meta) => void
  onRename,              // (fromKey, toKey, meta) => void
  onValueChange,         // (key, value, meta) => void

  density,               // "compact" | "comfortable"
  emptyText,
  ariaLabel,
  ctx,
})
```

If an operation-specific callback is supplied, that callback owns the operation.
Otherwise `onChange` receives the whole next dictionary. Otherwise, if `value`
is a writable signal, `dictInput` writes the next dictionary directly. If none
of those paths exists, mutating controls are disabled.

## Entry Context

Resolvers receive:

```js
{
  key,
  value,
  index,
  dict,
  ctx
}
```

`key` is the dictionary key. It has framework meaning only as dictionary row
identity. `ctx` is caller-provided and opaque to the framework.

## Key Rules

Dictionary keys are strings.

Default key policy:

- new keys are generated as unique strings;
- rename cannot commit an empty key;
- rename cannot collide with an existing different key;
- invalid rename stays in edit mode and shows an inline row error;
- exact key spelling is preserved after normalization.

Hosts that need different rules provide `normalizeKey` and `validateKey`.
Validation returns `true` for success or a human-readable error string for the
row UI.

## Reconcile Contract

`dictInput` reconciles by dictionary key:

1. Existing keys keep their row DOM.
2. Existing keys update value signals, actions, disabled state, and row chrome
   in place.
3. New keys create rows.
4. Removed keys dispose only their rows.
5. Display order follows `Object.keys(value)`.

When a rename is initiated by `dictInput`, the row DOM is preserved across the
old-key to new-key transition. External arbitrary key replacement is treated as
a structural dictionary change.

Value-only refresh must not interrupt:

- focused key or value inputs;
- numberInput pointer capture or drag scrubbing;
- open row-local menus unless the owning action disappears;
- row-local editor DOM state for unchanged keys.

## Visual Contract

`dictInput` should feel like a sibling of `structInput`.

It should use the same visual language:

- compact row height;
- label/editor/actions grid rhythm;
- the same row insets and border tone;
- the same action rail alignment;
- the same focus, hover, selected/error token family;
- no card-inside-card layout;
- no large decorative container.

Recommended structure:

```text
dictInput
  row
    key cell      // editable key, same visual weight as struct label column
    value cell    // editorFor(value_type)
    actions rail  // actionBar
  add row / empty state
```

The key cell is editable, but visually it should align with `structInput` labels
so a nested property form can mix fixed fields and dictionary fields without
changing rhythm.

## Renderer Ownership

The built-in `dict` renderer in `editorFor` should:

- resolve `type_agv.value_type`;
- create a `dictInput`;
- pass each value through `editorFor(valueFieldDef, ...)`;
- preserve dictionary object encoding on write;
- use `{}` as the empty value;
- not route dictionary values through `structInput`;
- not add project/domain semantics.

`structInput` remains a fixed-field keyed projection editor. `dictInput` may
share CSS tokens and small row helpers with it, but not its public data model.

## Tests

Framework tests should cover:

- default `dict` value is `{}`;
- editing a value writes a dictionary object;
- add creates a unique key;
- delete removes only that key;
- rename preserves the row during component-driven rename;
- rename rejects empty keys and collisions;
- `value_type` can be a type name;
- `value_type` can be inline `struct`, and nested struct values stay tuple
  encoded;
- unchanged keys keep focused editor DOM across value refresh;
- row actions render inside the row without breaking `structInput`-aligned
  layout;
- disabled capabilities hide or disable the matching affordance.

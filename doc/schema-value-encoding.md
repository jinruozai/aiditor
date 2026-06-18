# Schema Value Encoding

AIditor schema editors describe UI for values, but they must not invent a
second data model. Each schema kind has one canonical value shape. Renderers may
create internal projections for editing, but writes must preserve the canonical
shape owned by that schema kind.

This document is the framework contract for generic schema-driven UI such as
`editorFor`, `propertyForm`, `propertyList`, `arrayEditor`, and the built-in
Inspector. It contains no project, asset, scene, engine, or GameData semantics.

## Canonical Kinds

| Kind | Canonical value | Meaning |
| --- | --- | --- |
| `array` | JavaScript array | Ordered list. Element meaning comes from `elem_type` / renderer args. |
| `struct` | JavaScript array tuple | Fixed field layout. Field names come from `struct_def`; tuple positions store values. |
| `dict` | JavaScript object dictionary | Dynamic keyed record. Keys are data, not fixed field positions. |

`dict` and `struct` are different schema concepts:

- `dict` is a dictionary/map. It is appropriate when arbitrary keys are part of
  the data.
- `struct` is a fixed tuple. It is appropriate when `struct_def` defines the
  field layout and the runtime value stores members by position.

Framework code must not treat a `struct` value as a dictionary. Dictionary
editing belongs to `dict`, not to `struct`.

## Struct Contract

Given:

```js
const fieldDef = {
  type: 'struct',
  struct_def: {
    id: 'ref_id',
    num: 'int',
  },
}

const value = [123, 1]
```

The field order is:

```js
const order = Object.keys(normalizedStructDef) // ['id', 'num']
```

The tuple maps as:

```js
id  -> value[0] // 123
num -> value[1] // 1
```

The UI may edit through an internal record projection:

```js
{ id: 123, num: 1 }
```

That projection is not the canonical value. Writing `id = 456` must produce:

```js
[456, 1]
```

It must not produce:

```js
{ id: 456, num: 1 }
```

## Missing Members And Defaults

When a tuple is shorter than `struct_def`, missing members read as the resolved
field default. If the resolved field has no default, the read value is
`undefined`.

When writing one member:

- copy the current tuple;
- replace only the edited member index;
- materialize any earlier missing indexes required to reach that member;
- use each missing field's resolved default when available;
- otherwise leave the missing slot as `undefined`.

Editing one field must not rewrite unrelated tuple members.

Example:

```js
const fieldDef = {
  type: 'struct',
  struct_def: {
    x: { type: 'float', default: 0 },
    y: { type: 'float', default: 0 },
    z: { type: 'float', default: 1 },
  },
}

// edit z on a short tuple
[4] -> [4, 0, 9]
```

## Nested Structs

Each `struct` renderer preserves its own tuple encoding independently.

```js
const fieldDef = {
  type: 'struct',
  struct_def: {
    transform: {
      type: 'struct',
      struct_def: {
        position: 'vec3',
        scale: 'vec3',
      },
    },
    enabled: 'bool',
  },
}

const value = [
  [
    [0, 1, 2],
    [1, 1, 1],
  ],
  true,
]
```

Editing `transform.position.y` writes only the nested tuples needed for that
path. The outer value stays an array tuple, and the inner `transform` value
stays an array tuple.

## Array Of Struct

`array<struct>` uses the same rule for every element. The array renderer owns
the outer ordered list. The struct renderer owns each element's tuple
projection.

```js
const fieldDef = {
  type: 'array',
  type_agv: {
    elem_type: {
      type: 'struct',
      struct_def: {
        id: 'ref_id',
        num: 'int',
      },
    },
  },
}

const value = [
  [123, 1],
  [456, 2],
]
```

Editing the second element's `num` writes:

```js
[
  [123, 1],
  [456, 3],
]
```

## Dict Contract

Given:

```js
const fieldDef = {
  type: 'dict',
  type_agv: {
    value_type: 'float',
  },
}

const value = {
  health: 100,
  speed: 4.5,
}
```

The dictionary keys are data:

```js
health -> value.health // 100
speed  -> value.speed  // 4.5
```

Adding, deleting, or renaming a key changes the dictionary shape. Editing a
value changes only that key's value.

`value_type` may also be an inline FieldDef. If the value type is `struct`, each
dictionary value keeps its own tuple encoding:

```js
const fieldDef = {
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
}

const value = {
  apple: [101, 0.8],
  pear: [102, 0.6],
}
```

Editing `pear.weight` writes:

```js
{
  apple: [101, 0.8],
  pear: [102, 0.7],
}
```

## Implementation Ownership

`editorFor` is the public renderer boundary. Its built-in `struct` renderer
must:

- resolve and normalize `struct_def`;
- derive stable field order from `Object.keys(normalizedStructDef)`;
- project tuple values to record-shaped UI signals for `structInput`;
- write field changes back into a tuple;
- keep nested struct and array element encoding delegated to their own
  renderers;
- default an empty struct value to `[]`.

Its built-in `dict` renderer must:

- resolve `type_agv.value_type`;
- mount `dictInput`;
- pass each value through `editorFor(valueFieldDef, ...)`;
- preserve dictionary object encoding on write;
- default an empty dict value to `{}`.

`structInput` is the visual record editor used by the renderer. It may continue
to address fields by key internally, because it receives the renderer's editing
projection. It is not the owner of canonical struct encoding.

`dictInput` is the visual key-value editor used by the `dict` renderer. It owns
dynamic key rows, key rename, add/delete, and value editor mounting. It is not a
fixed-field struct editor.

`propertyForm`, `propertyList`, and Inspector should not special-case tuple or
dictionary logic. They pass field definitions and values into `editorFor`; value
encoding stays at the renderer boundary.

## Acceptance Tests

Framework tests should cover:

- struct reads tuple members by `struct_def` order;
- struct writes tuple values, not object dictionaries;
- field order follows `Object.keys(normalizedStructDef)`;
- missing members use field defaults or `undefined`;
- editing one member preserves other tuple members;
- nested structs preserve each layer's tuple encoding;
- `array` elements whose renderer is `struct` stay tuple encoded;
- empty struct default is `[]`;
- dictionary editing is not routed through the `struct` renderer;
- dict writes JavaScript object dictionaries;
- dict values keep their own renderer's canonical encoding.

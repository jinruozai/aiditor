# CSV Editor

The built-in CSV editor is one AIditor-native file editor, not a port of the
old VS Code/React runtime. One `csv-editor` Panel represents one file and one
view. It has no sheet tabs and no multi-table model.

## Product Shape

The Panel accepts an explicit `format` because header and cell semantics are
never guessed from file contents. The framework ships a standard `csv` format
and a registry so hosts can install their own.

```js
panel({
  component: 'csv-editor',
  props: { workspaceId: 'project', path: 'data/items.csv', format: 'csv' },
})
```

Views of the same `{workspaceId, path, format}` share one immutable document,
History timeline, dirty/stale state, and save operation. Selection, focus,
scroll, and transient controls remain view-local.

## Ownership

| Owner | Owns | Does not own |
| --- | --- | --- |
| `ui/editor/textDocument.js` | Format-neutral read/save/CAS/dirty/stale/watch lifecycle | CSV grammar or table state |
| `ui/data/dataGrid.js` | Virtual rows, selection, clipboard, fill, resize and reorder interaction | CSV, TypeConfig, files or project data |
| `ui/editor/csv/codec.js` | CSV row quoting, BOM and newline round-trip | Header or value semantics |
| `ui/editor/csv/format.js` | CSV-format registry and exact format selection | Auto-detection |
| `ui/editor/csv/format-csv.js` | Standard CSV header/cell mapping | Typed schema |
| `ui/editor/csv/model.js` | Immutable columns, rows, raw lexical values, diagnostics and mutations | IO or DOM |
| `ui/panel/csv-session.js` | Shared same-file session, History and transaction grouping | View selection |
| `ui/panel/csv-cell.js` | Type-to-cell projection and edit transaction boundary | Type definitions or persistence |
| `ui/panel/csv-drag.js` | CSV value drag payload and target compatibility over `ui.dragsource/dropzone` | Grid selection/fill or project import |
| `ui/panel/csv-inspector.js` | CSV target adapters to the existing Inspector | A CSV side panel |
| `ui/panel/csv-commands.js` | Host-bindable actions | Keyboard bindings |
| `ui/panel/csv-editor.js` | Panel composition and view-local state | Workspace or project policy |

## Formats

A format owns column and cell text conversion and is selected explicitly by
`props.format`. Formats live in `aiditor.ui.csv.formats`:

- `register(spec)` — install a format (throws on duplicate id)
- `resolve(id)` — return the format, or throw when unknown
- `extend(id, patch)` — merge patch into a registered format (throws when unknown)
- `ids()` — list installed format ids

The built-in `csv` format treats the first row as literal column names and
every cell as a string (an empty cell is `null`). Column resizing is view
state; standard CSV never persists a hidden schema or AIditor metadata.

The format spec is the extension point for hosts. A spec provides the core
`parseColumn` / `stringifyColumn` / `decodeCell` / `encodeCell` hooks, and may
optionally declare:

- `supportsColumnSchema` — enable column-definition editing
- `resolveField(fieldDef)` — map a column FieldDef to its resolved type
- `richCells` + `renderCellEditor(resolved, adapter, extras)` — supply custom
  cell editors for typed columns; return an element, or `undefined` to fall
  back to the default editor

A host installs any dialect with typed headers or specialized cell controls
through `csv.formats.register`; the CSV module itself stays generic.

### `gamecsv`

A plain header remains a `var` column. A typed header is a single-quoted object
whose `type`, `type_agv`, `type_render`, `default`, `mem`, `struct_def`, and
`tag` members map directly to the existing `FieldDef`:

```text
{'name':'Count','type':'int','width':96,'align':'right'}
{'name':'Tags','type':'array[string]'}
```

Scalar values use GameCSV text forms. Arrays and structs use nested tuple
syntax such as `('a','b')` and `((1001,'Mage'),(1002,'Rogue'))`; the format also
accepts GameCSV's unwrapped top-level comma sequence. Untouched headers and
cells retain their original text exactly. Editing produces one deterministic
canonical representation.

The format asks `ui.resolveFieldDef`, `ui.schema`, and `ui.editorFor` for type
meaning and presentation. It does not define `id_num`, `music`, project
references, or any other project alias. A host supplies those through the
existing TypeConfig overlay:

```js
aiditor.ui.setTypeOverrides({
  music: { base_type: 'string', type_render: 'snd' },
  id_string: {
    base_type: 'struct',
    type_render: 'struct',
    struct_def: { id_string: { id: 'ref_id', text: 'string' } },
  },
})
```

## Interaction and Lifecycle

`dataGrid` supplies virtual rows, range selection, the fill handle, TSV
copy/paste, semantic navigation/edit keys, column resize, and row/column drag
ordering. The Panel adds Save/Reload, formula editing, context actions, status,
and Inspector publication. It registers commands but binds no application
shortcuts.

Loading and saving are exactly the text-editor lifecycle:

1. resolve the bound Workspace by `workspaceId`;
2. `readText(path)` and decode with the selected format;
3. retain the returned hash as the CAS base;
4. derive dirty state from immutable document identity;
5. encode and `writeText(path, text, {baseHash})`;
6. reload a clean externally changed file or mark a dirty one stale.

## Performance and Correctness

- The shared model stores canonical values and raw lexical values once; raw
  values own lossless round-trip, while diagnostics store only stable row and
  column ids plus a message.
- Cell edits clone only the affected row/value arrays. History snapshots are
  immutable references, so capture is O(1).
- Only visible rows have DOM. Stable row/cell signals update a rich control in
  place, preserving focus and pointer capture instead of rebuilding the Grid on
  each keystroke.
- Composite projections are bounded by visible column width and expose the
  remaining count; no two-axis virtualization or second layout engine is added.
- Multiple views share parsing, saving and History; inactive Dock Panels use
  the framework's existing detached-DOM lifecycle.

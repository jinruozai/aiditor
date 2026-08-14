# CSV Editor

The built-in CSV editor is one AIditor-native file editor, not a port of the
old VS Code/React runtime. One `csv-editor` Panel represents one file and one
view. It has no sheet tabs and no multi-table model.

## Product Shape

The Panel accepts an explicit `format` because ordinary CSV and GameCSV use the
same extension but different, ambiguous header semantics. The framework never
guesses from file contents.

```js
panel({
  component: 'csv-editor',
  props: { workspaceId: 'project', path: 'data/items.csv', format: 'csv' },
})

panel({
  component: 'csv-editor',
  props: { workspaceId: 'project', path: 'data/units.csv', format: 'gamecsv' },
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
| `ui/editor/csv/format-gamecsv.js` | GameCSV header literal and typed tuple mapping | Type definitions or renderers |
| `ui/editor/csv/model.js` | Immutable columns, rows, raw lexical values, diagnostics and mutations | IO or DOM |
| `ui/panel/csv-session.js` | Shared same-file session, History and transaction grouping | View selection |
| `ui/panel/csv-cell.js` | Type-to-cell projection and edit transaction boundary | Type definitions or persistence |
| `ui/panel/csv-drag.js` | CSV value drag payload and target compatibility over `ui.dragsource/dropzone` | Grid selection/fill or project import |
| `ui/panel/csv-reference.js` | Immutable same-document ID index and `id/ref_id` projection | Cross-file topology or navigation |
| `ui/panel/csv-media.js` | Workspace-backed compact image/audio state and playback | Asset database or import policy |
| `ui/panel/csv-enum.js` | Compact enum selection with option colors | Enum type authority |
| `ui/panel/csv-range.js` | Range geometry adapter that preserves out-of-range raw values | Validation policy |
| `ui/panel/csv-number.js` | Numeric control adapter that preserves invalid numeric lexemes | Numeric type definitions |
| `ui/panel/csv-inspector.js` | CSV target adapters to the existing Inspector | A CSV side panel |
| `ui/panel/csv-commands.js` | Host-bindable actions | Keyboard bindings |
| `ui/panel/csv-editor.js` | Panel composition and view-local state | Workspace or project policy |

## Formats

Both formats use the same standards-based CSV row codec and preserve BOM,
newline style, final newline, quoting, embedded newlines, and untouched cell
lexemes.

### `csv`

The first row contains literal column names. Cell values are strings (an empty
cell is `null`). Column resizing is view state; standard CSV never persists a
hidden schema or AIditor metadata.

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

This is the sole type authority. GameCSV adds no parallel type registry. Its
`id/ref_id` presentation builds an O(1) index from the current immutable table:
the first `id` column supplies keys and its `type_agv.ref_column` selects the
display column. Missing references remain visible as errors. Cross-file
topology, navigation, asset import, and project validation remain project
responsibilities. Renderer context includes workspace/path and row/column ids,
so a project can add those policies without changing the CSV module.

## Interaction and Lifecycle

`dataGrid` supplies virtual rows, range selection, the fill handle, TSV
copy/paste, semantic navigation/edit keys, column resize, and row/column drag
ordering. The Panel adds Save/Reload, formula editing, context actions, status,
and Inspector publication. It registers commands but binds no application
shortcuts.

GameCSV cells project the existing FieldDefs directly. Validation diagnostics
are orthogonal to presentation: an invalid bool is still a switch, an
out-of-range value is still a range, and an invalid enum is still an enum.
CSV-local adapters exist only where the compact grid has requirements the
general form control does not: raw-lexeme preservation, option colors,
same-table references, and media playback/failure states. Arrays and structs
recursively reuse their element FieldDefs in a bounded one-row projection. The
existing Inspector remains the deeper edit surface. There is no CSV-specific
side editor.

`id`, `ref_id`, image, audio, and explicitly resource-tagged values expose a
drag source. Drops carry the source raw lexeme and are decoded by the target
FieldDef, so drag/drop does not create a second conversion path. The adapter
reuses AIditor's existing entity and file-path MIME contracts where applicable;
`ref_id` accepts `id/ref_id`, while image and audio targets accept matching
media. This value drag is independent from `dataGrid` row/column reorder and
selection fill.

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

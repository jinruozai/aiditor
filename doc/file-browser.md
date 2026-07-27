# File Browser, Async Tree, and External Drops

These primitives form the framework-level file browsing surface. They operate
on generic files and directories only. Workspace access, project identity,
assets, imports, commands, history, and persistence remain host concerns.

## Responsibility Split

| Primitive | Owns | Does not own |
| --- | --- | --- |
| `aiditor.ui.fileBrowser` | Current-directory presentation, local filtering, selection, view/sort controls, activation, context actions, and drag/drop hooks. | File IO, directory loading, mutation policy, project paths, or asset semantics. |
| `aiditor.ui.tree` | Hierarchical presentation, expansion, selection, virtualization, and optional node-level async child loading. | File semantics, persistence, or recursive eager loading. |
| `aiditor.ui.dropzone` | Native drag event ownership and normalization of external files/directories. | Import policy, target path decisions, writes, or business validation. |

A two-pane file explorer composes an async `ui.tree` for directory navigation
with a `ui.fileBrowser` for the selected directory. `fileBrowser` does not
duplicate tree expansion or async loading state.

## Neutral Entry Contract

File browser entries use this minimum shape:

```js
{
  id: 'src/main.js',
  name: 'main.js',
  path: 'src/main.js',
  kind: 'file', // 'file' | 'directory'
  size: 2451,
  mtime: 1770000000000,
  mime: 'text/javascript',
}
```

Only `id`, `name`, and `kind` are required by the default renderer. Applications
may attach opaque metadata. Custom accessors let callers use another data shape
without copying it.

## `aiditor.ui.fileBrowser`

```js
const browser = aiditor.ui.fileBrowser({
  entries,          // Signal<Entry[]> | Entry[] for the current directory
  path,             // optional Signal<string>, default ''
  selected,         // optional Signal<key[]>, default internal
  view,             // optional Signal<'icons' | 'list'>
  sort,             // optional Signal<{ by, direction }>

  getKey(entry),
  getName(entry),
  getPath(entry),
  getKind(entry),
  getSearchText(entry),
  renderItem(entry, index, ctx),

  onPathChange(path),
  onSelect(entries, meta),
  onActivate(entry, meta),
  contextActions(ctx),
  dragData(ctx),
  canDrop(ctx),
  onDrop(ctx),
})
```

`path`, `selected`, `view`, and `sort` follow the normal AIditor controlled
signal contract. A writable signal is updated directly; a read-only signal
requires the corresponding callback. Plain values create local component
state.

Directory activation writes `path` and calls `onPathChange`. File activation
calls `onActivate`. The browser never lists a directory itself; the host updates
`entries` when `path` changes.

Rows are keyed by `getKey(entry)`. Entry refreshes update retained row content
in place, so selection, focus, marquee interaction, and drag state are not
discarded merely because the caller supplied a new array.

`renderItem` renders item content only. The browser owns the selectable row or
tile shell, hover/selected state, ARIA, activation, context menu, and drag/drop
events. It runs once for a retained key; custom content reads current values
from `ctx.entry`, `ctx.index`, `ctx.selected`, and `ctx.view` signals.

`contextActions(ctx)` returns ordinary `UiAction[]`. `dragData(ctx)` returns a
MIME-to-string map for `ui.dragsource`. `canDrop(ctx)` and `onDrop(ctx)` receive
the normalized drop payload plus `targetEntry`, `targetPath`, and current
selection. No mutation action is built in.

`aiditor.ui.assetBrowser` is an alternate name for the same neutral primitive;
it does not introduce an asset-specific contract.

## Async `aiditor.ui.tree`

Static `node.children` continues to work. Lazy nodes declare
`hasChildren: true` and supply one loader for the tree:

```js
const tree = aiditor.ui.tree({
  items,
  expanded,
  selected,
  loadChildren(node, signal) {
    return workspace.list(node.path, { signal })
  },
})
```

The tree stores loaded children in an internal cache keyed by node id and never
mutates caller nodes. Each row context adds:

```js
ctx.row.loading
ctx.row.error
ctx.row.loadState // 'idle' | 'loading' | 'loaded' | 'error'
ctx.retry()
ctx.invalidate()
```

Expanding an unloaded lazy node starts one request. Collapsing, invalidating,
removing the node, or disposing the tree aborts its request. A stale promise
cannot overwrite a newer generation. Loading and error state belong to the
node, while expansion, selection, focus, and scroll position remain unchanged.

The imperative handle adds:

```js
tree.__aiditorTree.invalidateChildren(nodeId) // omit id to clear all
tree.__aiditorTree.retry(nodeId)
tree.__aiditorTree.loadState(nodeId)
```

Invalidating an expanded lazy node immediately reloads it. Search only visits
currently available children; it never expands the network or file-system work
set implicitly. `expandAll()` expands known nodes only for the same reason.

Default rows expose `aria-busy` while loading and a retry affordance on error.
Virtualized rows continue to provide explicit tree level and sibling position
metadata.

## External Directory Drops

`ui.dropzone` normalizes external files and directories before calling
`onDrop`:

```js
aiditor.ui.dropzone(el, {
  accept: ['Files'],
  signal,
  maxEntries: 10000,
  maxDepth: 64,
  onDrop(data) {
    // data.entries and data.errors are always arrays.
  },
})
```

The same normalization is available without attaching a drop target:

```js
const result = await aiditor.ui.dnd.readExternalEntries(dataTransfer, {
  signal,
  maxEntries: 10000,
  maxDepth: 64,
})
```

Each external entry is neutral:

```js
{
  kind: 'file', // 'file' | 'directory'
  name: 'icon.png',
  relativePath: 'textures/icon.png',
  file: File,   // file entries only
}
```

The result is a flat, pre-order list. Directory identity is preserved through
`kind` and `relativePath`; file content is represented by the standard `File`
object. Native `FileSystemHandle` and legacy `FileSystemEntry` objects never
cross the UI contract.

Directory traversal uses the best available browser capability, is cancellable,
and reports partial failures as bounded structured `data.errors`. A failed
child does not discard successfully read siblings. `ui.dnd.capabilities()`
reports whether external files and external directories can be normalized in
the current environment. Cancellation rejects the direct read with an
`AbortError`; a disposed `dropzone` suppresses that cancelled result.

No private API is treated as universally available. When directory traversal
is unsupported, ordinary external files continue to work and the capability is
reported accurately.

## Boundaries

These primitives do not:

- read or write a workspace;
- infer project or asset types;
- create an import pipeline;
- register commands or history entries;
- expose native file-system handles;
- eagerly load every lazy tree branch;
- invent rollback or transaction semantics.

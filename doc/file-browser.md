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

## Stable `aiditor.ui.tree` rows

`node.id` is the identity of a tree node. It must be globally unique within
the entire currently available projection, including collapsed nodes and
children already present in the lazy-load cache. Supplying a duplicate id is a
contract error; the tree reports `AiditorTreeDuplicateIdError` instead of
silently binding two nodes to one row runtime.

Visible and overscan rows reconcile by id. Replacing `items` with new node
objects updates the retained default row shell in place. Reordering siblings
or moving a node between parents moves the retained row DOM; unrelated rows
are not rebuilt. The reconciliation keeps the largest already-ordered DOM
subsequence, so moving the first sibling to the end performs one DOM move
rather than moving every sibling before it.

The stability boundary follows virtualization: nodes that remain inside the
rendered visible/overscan window keep DOM and nested focus. Rows that are
collapsed, filtered out, or scrolled outside that window may be disposed or
recycled. Selection, expansion, logical focus, and the scroll offset remain
id-based and do not depend on row DOM lifetime.

DOM reconciliation runs outside reactive dependency tracking. The Tree
bindings subscribe only to their explicit flattened projection and selection
signals; signals owned by icons, actions, slots, or custom renderers cannot
become accidental Tree dependencies or synchronously re-enter reconciliation.

The rendering levels are:

- The managed default row owns the arrow, icon, label, standard actions,
  interaction policy, and ARIA metadata. Those framework parts update in
  place. Custom slot content is replaced only inside its slot when the slot
  returns a different element.
- `renderRow(node, row, ctx)` remains a compatibility escape hatch. Because it
  returns an opaque element and has no update contract, the tree may replace
  that one row when its projection changes.
- `renderTemplate()` remains the stable custom-row protocol for complex,
  stateful row structures. It returns `{ root, update, reset?, dispose? }`.

Tree DnD treats hover feedback as advisory. Pointer release performs a fresh
hit test and recomputes source availability, the current parent chain,
`dropZones`, geometric position, and `canDrop` before calling `onDrop`. A target
that moved into a dragged source, disappeared, or became disallowed while the
pointer was down cannot commit from a stale hover decision.

## Async `aiditor.ui.tree`

The caller owns child data whenever `node.children` is an array, including an
empty array. That array is authoritative even when an older lazy snapshot
exists or `hasChildren` is still true. Lazy loading is eligible only when
`children` is not an array and `hasChildren: true`. Changing a lazy node into a
leaf or a static node cancels its refresh transaction and removes its lazy
cache before further invalidation can use it.

Lazy nodes supply one loader for the tree:

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
mutates caller nodes. Cached children are a published snapshot; request state
is tracked separately so a refresh never clears the snapshot first. Each row
context adds:

```js
ctx.row.loading
ctx.row.error
ctx.row.loadState // 'idle' | 'loading' | 'loaded' | 'error'
ctx.retry()
ctx.invalidate()
```

Expanding an unloaded lazy node starts one request. Collapsing that initial
expansion load aborts it. Explicit invalidation and retry continue even if the
row is subsequently collapsed, because they represent a requested consistency
refresh. Removing a node or disposing the tree cancels any transaction that
contains it. An older or cancelled transaction cannot publish late results.

During refresh, the old child snapshot remains available and the parent is
`loading`. Success replaces the complete snapshot once. Failure preserves the
old snapshot and marks the parent `error`; retry never requires the caller to
reconstruct old children.

The imperative handle adds:

```js
tree.__aiditorTree.invalidateChildren(nodeId)
tree.__aiditorTree.invalidateChildren([oldParentId, newParentId])
tree.__aiditorTree.invalidateChildren() // all cached lazy parents
tree.__aiditorTree.retry(nodeId)
tree.__aiditorTree.loadState(nodeId)
```

One invalidation call defines one atomic refresh transaction. All selected
parents are queried concurrently while every old snapshot remains published.
Results are staged, then the candidate full projection is checked for duplicate
node ids. The transaction publishes all child arrays with one reconciliation
only when every query succeeds and the candidate projection is valid.

If any query fails or the candidate contains a duplicate id, the whole
transaction retains its old snapshots. Every member exposes an error and retry
from any member retries the original group. This all-or-nothing value commit is
required for cross-parent moves: publishing successful branches from a partial
failure could otherwise make a node disappear or appear under both parents.
Call unrelated parents in separate invalidations when independent success is
desired.

Search only visits currently available children; it never expands the network
or file-system work set implicitly. `expandAll()` expands known nodes only for
the same reason.

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

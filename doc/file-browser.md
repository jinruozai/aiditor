# Collection Browser, File Browser, Async Tree, and External Drops

These primitives form the framework-level collection and file browsing
surface. Workspace access, project identity, assets, imports, commands,
history, and persistence remain host concerns.

## Responsibility Split

| Primitive | Owns | Does not own |
| --- | --- | --- |
| `aiditor.ui.collectionBrowser` | Stable keyed projection, controlled selection, fixed-size two-dimensional virtualization, Icon/List presentation, search/sort controls, keyboard, marquee, context actions, and drag/drop routing. | Domain models, loading, paging, persistence, or mutation policy. |
| `aiditor.ui.fileBrowser` | File accessors, breadcrumbs, file sorting and metadata rendering, directory activation, and file-shaped action/drop contexts. | Collection interaction, virtualization, File IO, directory loading, mutation policy, project paths, or asset semantics. |
| `aiditor.ui.tree` | Hierarchical presentation, expansion, selection, virtualization, and optional node-level async child loading. | File semantics, persistence, or recursive eager loading. |
| `aiditor.ui.dropzone` | Native drag event ownership and normalization of external files/directories. | Import policy, target path decisions, writes, or business validation. |

A two-pane file explorer composes an async `ui.tree` for directory navigation
with a `ui.fileBrowser` for the selected directory. `fileBrowser` does not
duplicate tree expansion or async loading state.

## `aiditor.ui.collectionBrowser`

`collectionBrowser` presents one flat, currently available keyed projection.
It is not a data source and does not load or page records. Hierarchical data
belongs in `ui.tree`; callers update `items` when their source changes.

```js
const browser = aiditor.ui.collectionBrowser({
  items,                 // Signal<Item[]> | Item[]
  selected,              // required writable Signal<string[]>
  view,                  // writable Signal<view id>
  views: [
    { id: 'cards', layout: 'grid', label: 'Cards', icon: 'grid' },
    { id: 'rows', layout: 'list', label: 'Rows', icon: 'list' },
  ],
  query,
  searchable: true,
  sort,
  sortOptions,

  getKey(item),
  getLabel(item),
  getIcon(item),
  getDescription(item),
  getSearchText(item),
  filter(item, normalizedQuery, sourceIndex),
  compare(a, b, sort),

  renderItem(itemSignal, ctx),
  renderToolbarLeading(ctx),
  onActivate(item, ctx),
  contextActions(ctx),
  dragData(ctx),
  canDrop(ctx),
  onDrop(ctx),
})
```

`getKey` must return a non-empty globally unique string. The complete source is
checked before filtering. `selected` is the only selection write path; there
is no parallel callback owner. Observers subscribe to that signal.

Views have stable ids and one implemented layout, `grid` or `list`. A view id
may be domain-friendly, such as `cards`, without introducing another layout
engine. `searchable:false` hides the built-in input; an externally supplied
query still filters the projection.

The default renderer reads `getIcon`, `getLabel`, and `getDescription`. A
custom `renderItem` completely replaces it and runs once per mounted key. It
receives read-only `itemSignal` plus read-only `ctx.index`, `ctx.selected`,
`ctx.focused`, and `ctx.view` signals. It returns one `HTMLElement` and records
cleanup on that element with `ui.collect`. The browser calls `ui.dispose`
exactly once when the virtual item is evicted or the browser is disposed.
There is no value/index renderer compatibility mode.

Visible and overscan items reconcile by key. Retained items keep their shell,
renderer, focus state, and content signals across item replacement and
reordering. Items outside the virtual window are disposed. Selection, range
anchor, logical focus, and ARIA position remain key-based.

Both layouts use fixed item extents from `--aiditor-collection-*` CSS tokens.
Scroll and resize work is proportional to the visible window. Grid column
count responds to viewport width while keeping the first visible item as the
resize anchor. Marquee hit testing uses virtual geometry and continues during
proportional edge auto-scroll.

Keyboard interaction includes two-dimensional arrows, Home/End, Shift range
extension, Ctrl/Meta focus movement, Ctrl/Meta+Space toggle, Ctrl/Meta+A,
Enter activation, and Escape cancellation/clear. Mounted options synchronize
`aria-posinset` and `aria-setsize`; their DOM order follows the logical
projection in addition to visual transforms.

Collection DnD adapts the existing `ui.dragsource` and one viewport-level
`ui.dropzone`; it does not own another transport. Contexts use
`selectedItems`, never an ambiguous `items` field. `canDrop(ctx)` is a
synchronous lightweight decision and is rerun against the latest projection
at drop time. `onDrop(ctx)` may return a Promise. Positions are `before`, `on`,
`after`, or `surface`.

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
  path,             // writable Signal<string>
  selected,         // required writable Signal<key[]>
  view,             // optional Signal<'icons' | 'list'>
  sort,             // optional Signal<{ by, direction }>

  getKey(entry),
  getName(entry),
  getPath(entry),
  getKind(entry),
  getSearchText(entry),
  renderItem(entrySignal, ctx),

  onActivate(entry, meta),
  contextActions(ctx),
  dragData(ctx),
  canDrop(ctx),
  onDrop(ctx),
})
```

Directory activation writes `path` and clears `selected`. File activation calls
`onActivate`. The browser never lists a directory itself; the host observes
`path` and updates `entries`. Selection has the same single writable-signal
owner as the underlying collection.

`renderItem(entrySignal, ctx)` uses the collection renderer lifecycle and adds
a read-only `ctx.path` signal. Default content provides file/directory icons
plus type, size, and modified metadata.

`contextActions(ctx)` returns ordinary `UiAction[]`. File contexts contain
`entry`, `selectedEntries`, and `path`. Drop contexts additionally contain the
normalized payload, `targetEntry`, `targetPath`, position, and phase. No
mutation action is built in.

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

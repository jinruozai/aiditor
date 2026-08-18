# Workspace

## Goal

This document defines the AIditor file-system primitive for front-end
editors. It describes the implemented final model. It is a bounded, version-aware, reviewable file operation layer.

It owns:

- bounded file access
- text and blob IO
- file/directory mutations
- stat and version checks
- operation preview/apply
- snapshot storage primitive
- object URL leases
- permission recovery
- verified external-change observation

It does not own:

- project model
- asset database
- scene, prefab, material, animation, or table semantics
- import pipeline
- dependency graph
- editor command history
- file operation journal policy
- reference updates
- conflict UI
- domain validation

Host editors build those systems on top of workspace primitives.

```text
AIditor workspace
  -> describes, validates, and executes file-system operations

Host editor
  -> decides editor commands, undo grouping, file index refresh, references,
     rollback policy, and domain workflows
```

`previewOperation` and `applyOperation` are file-system review primitives. They
are not editor history and not a transaction database. They do not promise
cross-file atomicity. Apply returns per-effect results; hosts that need recovery
use snapshots and their own journal.

## Core Concepts

The workspace has one concept stack:

```text
WorkspaceAdapter
  bounded backend for paths under one root

WorkspaceCapabilities
  which workspace APIs are callable

WorkspaceEntryStat
  normalized metadata and version information for one path

WorkspaceOperation
  file-system-shaped mutation input

WorkspaceOperationPreview
  review record with base versions, effects, warnings, and errors

WorkspaceOperationApplyResult
  per-effect execution result

WorkspaceSnapshotRef
  captured file/directory representation for host recovery

WorkspaceObjectUrlLease
  managed object URL lifecycle for previewing blobs
```

AI, Extension Runtime, UI, and host adapters do not define another file
operation model. Those layers wrap workspace operations when they need file
effects, and file conflict rules always come from the workspace model.

## API Surface

Final workspace adapters expose:

```js
workspace.rootId()
workspace.kind()
workspace.capabilities()

workspace.list(path)
workspace.search(query, options)

workspace.readText(path)
workspace.writeText(path, text, options)
workspace.readBlob(path)
workspace.writeBlob(path, blob, options)

workspace.mkdir(path, options)
workspace.move(from, to, options)
workspace.copy(from, to, options)
workspace.delete(path, options)

workspace.stat(path)
workspace.watch(path, handler)

workspace.previewOperation(input)
workspace.applyOperation(previewOrId, options)

workspace.snapshot(path, options)
workspace.restoreSnapshot(snapshotRef, options)
workspace.compareSnapshot(snapshotRef, path)

workspace.createObjectUrl(path, options)
workspace.createUrlBundle(paths, options)
workspace.revokeObjectUrl(url)
workspace.releaseObjectUrls(owner)

workspace.revealInSystem(path, options)
workspace.pickSaveTarget(options)
workspace.recoverPermission(options)
```

The final design uses `readText` and `writeText` for text IO. Generic
`read/write` names are not part of the workspace concept model.

## Capabilities

`workspace.capabilities()` returns:

```js
{
  list: boolean,
  search: boolean,
  readText: boolean,
  writeText: boolean,
  readBlob: boolean,
  writeBlob: boolean,
  mkdir: boolean,
  move: boolean,
  copy: boolean,
  delete: boolean,
  recursiveDelete: boolean,
  stat: boolean,
  watch: boolean,
  objectUrl: boolean,
  snapshot: boolean,
  previewOperation: boolean,
  applyOperation: boolean,
  revealInSystem: boolean,
  pickSaveTarget: boolean,
  permissionRecovery: boolean,
}
```

Capabilities mean the API is callable. They do not promise complete metadata.
If metadata is unavailable, the returned fields are `null`.

Framework fallback is allowed when it produces a real bounded API. For example,
a text adapter supports `readBlob` by wrapping returned text in a `Blob`.
Fallback still reports unknown `mime`, `mtime`, or backend metadata as `null`;
it must not invent facts.

`search` follows the same rule. An adapter with `list + readText` receives the
framework bounded text-search implementation, so `capabilities().search` reports
the effective enhanced adapter rather than only the raw bridge methods.

## External Change Observation

`workspace.watch(path, handler)` subscribes to verified changes at `path` or
below it and returns an idempotent cancellation function. The handler receives
one merged batch:

```js
{
  changes: [{
    type: 'created' | 'modified' | 'deleted' | 'moved' | 'unavailable',
    path: string,
    fromPath?: string,
    kind: 'file' | 'directory',
    reason?: 'permission_lost',
  }],
  source: 'observer' | 'poll' | 'focus' | 'permission',
  time: number,
}
```

For browser File System Access workspaces, the Workspace is the only owner of
the recursive observer, shared metadata snapshot, fallback timer, listeners,
and publication queue. Native `FileSystemObserver` records are invalidation
hints rather than authoritative changes: affected paths are read again, then a
deduplicated snapshot diff is published. `unknown` invalidates its affected
directory. A move is emitted only when the old and new handles identify the
same entry; otherwise it remains a delete plus create.

When `FileSystemObserver` is absent or stops working, the same snapshot engine
uses visible-page low-frequency polling of watched scopes and a rescan on focus
or foreground return. This fallback is available on both HTTPS and `file://`;
the implementation relies on feature detection, not origin string checks.
Permission loss publishes one `unavailable` change and suspends background
work until a foreground permission check succeeds. The last cancellation and
`workspace.dispose()` release every observer, timer, and page listener.

`capabilities().watch` is true only for a real implementation. In-memory
workspaces therefore report false; bridge adapters report their actual bridge
capability.

## Bounded Text Search

```js
workspace.search(query, {
  path?: string,
  include?: string | string[],
  exclude?: string | string[],
  mode?: 'literal' | 'regex',
  caseSensitive?: boolean,
  before?: number,
  after?: number,
  limit?: number,
  maxPerFile?: number,
  maxFiles?: number,
  maxFileBytes?: number,
})
```

The result is always:

```js
{
  matches: WorkspaceSearchMatch[],
  errors: [{
    path: string,
    op: 'list' | 'readText',
    code: string,
    reason: string,
    message: string,
  }],
  scannedFiles: number,
  skippedFiles: number,
  limitHit: boolean,
}
```

Memory, File System Access, and fallback bridge search use the same walker and
result shape. Results are deterministic by workspace-relative path. The default
bounds are 1,000 scanned files, 1 MiB per file, 50 total matches, 20 matches per
file, and at most 100 retained diagnostics. Callers may lower or explicitly
raise the scan bounds per request.

Invalid regular expressions reject the search before traversal. Individual
directory listing, text read, and file-size failures are converted into bounded
structured diagnostics and scanning continues. `limitHit` is true when a scan,
file-size, result, or diagnostic bound prevents complete traversal. Search does
not infer project ignore files, build an index, or require a server; hosts supply
project-specific include/exclude patterns explicitly.

`revealInSystem` is a platform adapter capability. Pure Web, memory, and File
System Access adapters normally report `false`. Electron, Tauri, native bridge,
or desktop adapters can report `true` when they can ask the host operating
system file manager to reveal a bounded workspace path.

## Entry Stat And Versions

`workspace.stat(path)` returns:

```js
{
  path: string,
  name: string,
  kind: 'file' | 'directory',
  size: number | null,
  mtime: number | null,
  hash: string | null,
  mime: string | null,
  versioned: 'strong' | 'weak' | 'none',
}
```

Version strength:

- `strong`: `hash` is available and is the compare-and-set version.
- `weak`: `hash` is unavailable but `mtime` is available.
- `none`: neither `hash` nor `mtime` is available.

`strong` is the normal safe path. `weak` can detect many external changes but is
not collision-proof, so previews for weak writes include a warning and apply
requires `confirmWarnings:true`. `none` means there is no reliable version
check. Mutations touching an existing `none` path warn and require
`confirmWarnings:true`; they are rejected when the operation cannot be made
understandable to the user.

Directories can have `size`, `mtime`, `hash`, and `mime` as `null`.

## Text And Blob IO

```js
workspace.readText(path)
workspace.writeText(path, text, {
  baseHash?: string | null,
  overwrite?: boolean,
})

workspace.readBlob(path)
workspace.writeBlob(path, blob, {
  baseHash?: string | null,
  overwrite?: boolean,
})
```

Strict write rules:

- Target missing: create is allowed.
- Target exists and `baseHash` matches: update is allowed.
- Target exists without a base version and without overwrite intent: reject.
- Target exists with `overwrite:true`: allow only through reviewed overwrite
  confirmation.
- `baseHash` mismatch: reject.

If the target has `versioned:'weak'`, the weak mtime check must still match at
apply time and the preview requires warning confirmation. If the target has
`versioned:'none'`, preview must disclose that no reliable CAS is possible.

This is not "never write existing files". It is "never replace existing content
without a known base version or explicit reviewed overwrite intent".

## File Mutations

```js
workspace.mkdir(path, {
  recursive?: boolean,
})

workspace.move(from, to, {
  overwrite?: boolean,
  baseHash?: string | null,
  targetBaseHash?: string | null,
})

workspace.copy(from, to, {
  overwrite?: boolean,
  baseHash?: string | null,
  targetBaseHash?: string | null,
})

workspace.delete(path, {
  recursive?: boolean,
  baseHash?: string | null,
})
```

Rules:

- `move` covers rename.
- Target overwrite is never implicit.
- Target exists and `overwrite` is false: reject.
- Target exists and `overwrite:true` with `targetBaseHash`: target version must
  match.
- Target exists and `overwrite:true` without a target version: preview must warn
  and apply requires both `confirmOverwrite:true` and `confirmWarnings:true`.
- Target changes between preview and apply: reject even when overwrite was
  confirmed.
- Directory delete is not recursive unless `recursive:true`.
- Recursive directory operations require adapter support and must be reflected in
  capabilities.
- Unsupported directory copy/delete fails clearly and reports `false` in
  capabilities.

## Operation Review

Core exposes one review primitive for UI, commands, extensions, and AI:

```js
workspace.previewOperation(input)
workspace.applyOperation(previewOrId, {
  confirmWarnings?: boolean,
  confirmOverwrite?: boolean,
})
```

Supported operation inputs:

```js
{ op: 'mkdir', path, recursive? }
{ op: 'delete', path, recursive?, baseHash? }
{ op: 'move', from, to, overwrite?, baseHash?, targetBaseHash? }
{ op: 'copy', from, to, overwrite?, baseHash?, targetBaseHash? }
{ op: 'writeText', path, text, baseHash?, overwrite? }
{ op: 'writeBlob', path, blob, baseHash?, overwrite? }
```

Operation inputs are file-system-shaped. They must not contain editor command
names, asset ids, scene ids, import modes, validation schemas, or domain flags.
Hosts wrap workspace operations in domain commands when needed.

Preview shape:

```js
{
  id: string,
  op: string,
  input: unknown,
  base: [{
    path: string,
    exists: boolean,
    kind: 'file' | 'directory' | null,
    hash: string | null,
    mtime: number | null,
    versioned: 'strong' | 'weak' | 'none',
    children?: [{
      path: string,
      kind: 'file' | 'directory',
      hash: string | null,
      mtime: number | null,
      versioned: 'strong' | 'weak' | 'none',
    }],
  }],
  effects: [{
    path: string,
    action: 'create' | 'update' | 'delete' | 'move' | 'copy',
    from?: string,
    to?: string,
  }],
  summary: string,
  warnings?: [{ message: string, path?: string }],
  errors?: [{ message: string, path?: string }],
}
```

Errors make apply unavailable. Warnings require explicit confirmation. A touched
existing path with `versioned:'none'` produces a warning unless the adapter can
otherwise prove safety.

Recursive directory operations record directory contents in `base.children`
unless the adapter provides a strong directory hash. The child list is a compact
version fingerprint: path, kind, hash, mtime, and version strength. Apply
re-lists and compares it before deleting or replacing the directory. If the
adapter cannot produce a directory hash or child fingerprint, recursive
mutation preview must fail.

Apply revalidates the preview base before executing:

- Source hash/mtime changed: reject.
- Preview target was missing and target now exists: reject.
- Preview target existed and target hash/mtime changed: reject.
- Recursive delete directory contents changed: reject or require a new preview.
- Permission, path boundary, and adapter capability checks always run.

`confirmWarnings` and `confirmOverwrite` confirm reviewed risks. They do not
bypass path boundaries, permissions, adapter capabilities, or version checks.
The workspace does not use a generic `force` option because it is too easy to
misread as "bypass safety".

Apply result:

```js
{
  id: string,
  op: string,
  ok: boolean,
  effects: [{
    path: string,
    action: 'create' | 'update' | 'delete' | 'move' | 'copy',
    ok: boolean,
    stat?: WorkspaceEntryStat,
    error?: string,
  }],
  errors?: [{ message: string, path?: string }],
}
```

If one effect fails after earlier effects completed, the completed effects stay
completed and the result must expose the partial state. The framework does not
pretend rollback happened.

## Text Editing Primitives

Workspace operation review handles file-system mutations. It does not replace
text-editing helpers.

The workspace module keeps generic text primitives:

```js
workspace.search(query, options)
workspace.applyTextEdits(text, baseHash, edits)
workspace.applyLinePatches(text, baseHash, patches)
workspace.diffSummary(before, after)
workspace.validateText(path, text, options)
```

AI and host code can use these helpers to build precise edit operations before
calling `previewOperation({ op:'writeText', ... })` or an equivalent text-edit
tool. The helpers are generic; validation remains syntax/data-shape validation,
not domain validation.

## Snapshots

```js
workspace.snapshot(path, {
  recursive?: boolean,
  maxMemoryBytes?: number,
})

workspace.restoreSnapshot(snapshotRef, {
  targetPath?: string,
  overwrite?: boolean,
  baseHash?: string | null,
})

workspace.compareSnapshot(snapshotRef, path?)
```

Snapshot refs:

```js
{
  id: string,
  path: string,
  kind: 'file' | 'directory',
  size: number | null,
  hash: string | null,
  mtime: number | null,
  storage: 'memory' | 'indexeddb' | 'adapter',
}
```

Snapshots are capture representation for host recovery and undo/redo journals.
They are not editor history entries and not mutation commands.

`restoreSnapshot` is a convenience API. Its safety semantics are equivalent to a
reviewed workspace operation that writes the captured representation back to a
target path. It must not bypass the same overwrite, base version, capability, or
path-boundary rules used by `previewOperation` / `applyOperation`.

Memory-backed snapshots have a default limit of 16 MiB per snapshot operation.
Hosts pass `maxMemoryBytes` to lower or raise that limit. Recursive snapshots
count the sum of captured file bytes. If an adapter cannot know size before
reading, capture stops and fails as soon as the accumulated size crosses the
limit.

IndexedDB and adapter-backed snapshot storage use the same contract. Storage
backend choice never changes snapshot safety rules.

## Workspace State

`aiditor.workspaceState` is a separate project-scoped persistence surface for
small JSON-safe UI/runtime state. It does not read or write workspace files and
does not add project semantics to the bounded filesystem adapter.

```js
aiditor.workspaceState.configure({ adapter })
await aiditor.workspaceState.load(workspaceId, key)
await aiditor.workspaceState.save(workspaceId, key, value)
await aiditor.workspaceState.remove(workspaceId, key)
```

The browser default uses `localStorage`; native hosts may configure an adapter
whose `load`, `save`, and `remove` methods are synchronous or asynchronous.
The public API always returns a Promise. Operations for one
`workspaceId + key` are serialized, and pending writes are coalesced so the
newest queued snapshot is the final value written. Different workspace ids are
fully isolated.

Inspector folding state uses this surface. Other project UI owners must use
their own stable state key rather than sharing or editing Inspector's envelope.

`restoreDirectory(key, options)` restores a remembered File System Access
directory handle. It never calls `showDirectoryPicker` and never exposes the raw
`FileSystemDirectoryHandle`.

```js
const ws = await aiditor.workspace.restoreDirectory('recent-project', {
  mode: 'readwrite',
  requestPermission: true,
})
```

Restore behavior:

- missing remembered handle returns `null`;
- `queryPermission({ mode }) === "granted"` returns a workspace adapter;
- `queryPermission({ mode }) === "prompt"` returns `null` by default;
- `prompt` plus `requestPermission:true` calls
  `handle.requestPermission({ mode })` and returns an adapter only when the
  browser grants access;
- `denied` returns `null`.

`requestPermission` defaults to `false` so existing callers can probe recent
entries without opening a browser permission prompt. Hosts should pass
`requestPermission:true` only from an explicit user action such as Open Recent.

Utility helpers in the workspace module may normalize relative paths, hash text
or bytes, derive parent paths, and build safe previews. Those helpers support
file tools and adapters; they do not create a project concept.

Implemented helpers include `normalizePath`, `parentPath`, `hashText`,
`hashBytes`, `hashBlob`, `diffSummary`, `validateText`, `applyLinePatches`, and
`applyTextEdits`.

Each workspace adapter should expose:

```js
workspace.rootId()
workspace.kind()
workspace.capabilities()
workspace.list(path)
workspace.search(query, options)
workspace.readText(path)
workspace.writeText(path, text, options)
workspace.readBlob(path)
workspace.writeBlob(path, blob, options)
workspace.previewOperation(input)
workspace.applyOperation(previewOrId, options)
workspace.snapshot(path, options)
workspace.restoreSnapshot(snapshotRef, options)
workspace.compareSnapshot(snapshotRef, path)
workspace.createObjectUrl(path, options)
workspace.createUrlBundle(paths, options)
workspace.revokeObjectUrl(url)
workspace.releaseObjectUrls(owner)
workspace.revealInSystem(path, options)
workspace.pickSaveTarget(options)
workspace.mkdir(path)
workspace.copy(from, to, options)
workspace.move(from, to, options)
workspace.delete(path, options)
workspace.stat(path)
workspace.recoverPermission(options)
```

`watch(path, handler)` exists only when `capabilities().watch` is true. Browser
File System Access workspaces verify native observer hints against a shared
snapshot and fall back to foreground polling/focus scans when the native
observer is unavailable. It returns an idempotent cancellation function; the
Workspace owns and disposes the observer, snapshot, timers, and listeners. See
[External Change Observation](#external-change-observation) for the batch
contract. The rest of the system must still tolerate adapters without watch.

`capabilities()` is the adapter truth table. Hosts and panels can inspect it
before enabling commands such as duplicate, import, recursive delete, or binary
preview. A missing capability is a normal adapter limitation, not a project
state.

Text IO uses `readText` and `writeText`; see [API Surface](#api-surface)
for the full API.

`search(query, options)` is a bounded text scan and returns a structured
completion result:

```js
{
  matches: WorkspaceSearchMatch[],
  errors: WorkspaceSearchError[],
  scannedFiles: number,
  skippedFiles: number,
  limitHit: boolean,
}
```

When an adapter does not provide `search` but does provide `list` and
`readText`, the framework installs the same bounded implementation used by the
memory and File System Access adapters. It applies include/exclude filters and
limits before reading files, continues after individual list/read failures, and
reports those failures in `errors` instead of failing the entire search.

`stat(path)` returns a stable file identity shape:

```js
{ path, name, kind, size, hash, mtime }
```

For files, `hash` is the content version used by compare-and-set writes. For
directories, `hash` may be omitted because directory versioning depends on the
backend.

Workspace IO errors use a stable structure at adapter boundaries:

```js
{
  message: string,
  code: string,
  op: 'stat' | 'readBlob' | 'snapshot' | 'restoreSnapshot' | 'applyOperation' | string,
  path: string,
  reason: 'not_found' | 'permission_denied' | 'not_readable' | 'quota_exceeded' | 'stale' | 'size_limit' | 'recursive_required' | 'platform_error',
  permissionRecovery: boolean
}
```

`path` is workspace-relative. Recursive snapshot and restore failures point to
the specific file that failed, with `rootPath` or `snapshotId` when useful for
logging. UI should not infer permission recovery from browser exception names;
it should read `reason` and `permissionRecovery`.


## Object URL Leases

```js
workspace.createObjectUrl(path, { owner?: unknown })
workspace.createUrlBundle(paths, { owner?: unknown })
workspace.revokeObjectUrl(url)
workspace.releaseObjectUrls(owner)
```

Object URL lease:

```js
{
  url: string,
  path: string,
  hash: string | null,
  mime: string | null,
  release(): void,
}
```

Bundle lease:

```js
{
  urls: Record<string, string>,
  resolve(path): string | null,
  release(): void,
}
```

Panels do not call `URL.createObjectURL` directly for workspace files. Workspace
owns the lease lifecycle.

Supported owner cleanup shapes:

- component or panel context with `onCleanup(fn)`
- DOM element with `__aiditorCleanups`
- arbitrary token released through `releaseObjectUrls(owner)`

Without `watch`, leases do not auto-update when files change.

## System File Manager Reveal

```js
workspace.revealInSystem(path, {
  select?: boolean,
})
```

`revealInSystem` asks the host platform to show a workspace-relative file or
directory in the operating system file manager.

Return shape:

```js
{
  ok: boolean,
  reason?: 'unsupported' | 'not_found' | 'permission_denied' | 'platform_error',
}
```

Rules:

- `path` is always workspace-relative.
- The adapter validates that `path` stays inside the bounded workspace root.
- The adapter must not expose absolute paths, File System Access handles, or
  shell APIs to project code.
- Files are revealed by opening the parent directory and selecting the file
  when the platform supports selection.
- Directories may be opened directly, or their parent may be opened with the
  directory selected. The adapter chooses the best platform behavior.
- `{ select:true }` requests selection when platform support exists; it is not a
  guarantee.
- Unsupported adapters return `{ ok:false, reason:'unsupported' }`.
- Missing paths return `{ ok:false, reason:'not_found' }`.
- Permission loss returns `{ ok:false, reason:'permission_denied' }`.
- Host platform failures return `{ ok:false, reason:'platform_error' }`.
- The API never opens framework UI and never logs on its own.

This is not a file mutation. It does not use `previewOperation` /
`applyOperation`, does not enter undo/redo, and does not create a history item.

`revealInSystem` is also separate from editor-internal reveal APIs. For example,
an `OpenService.reveal` style call moves focus to an editor tree, panel, or
resource inside the application. `workspace.revealInSystem` delegates to the
host operating system file manager.

## Save Target Picker

```js
workspace.pickSaveTarget({
  suggestedName?: string,
  extensions?: string[],
  description?: string,
  mimeType?: string,
})
```

The File System Access adapter opens the system save picker from the current
workspace directory. It resolves the selected file back through the workspace
root, rejects targets outside that root or outside the allowed extensions, and
returns only a normalized workspace-relative path. User cancellation returns
`null`; the raw file handle is never exposed.

This API selects a target only. Saving still uses `previewOperation` and
`applyOperation`, including the existing version and overwrite checks.

## Permission Recovery

```js
workspace.recoverPermission({ mode?: 'read' | 'readwrite' })
```

File System Access adapters can request lost permissions again. Adapters that
cannot recover permissions report `permissionRecovery:false`. Failures surface
clear errors.

## Adapter Enhancement

The workspace API is a final shape, not a requirement that every backend hand
implement every method.

Adapters implement a trusted bounded surface. The framework can enhance that
surface with generic derived methods when the derived method is real and
bounded:

```text
readText -> readBlob fallback
readBlob + writeBlob + list + mkdir -> copy fallback
copy + delete -> move fallback
readBlob -> object URL leases
readText/readBlob -> snapshots
```

Enhancement must not hide missing backend facts. Unknown metadata remains
`null`, and capabilities reflect the final callable API after enhancement.

## AI Tools

AI workspace tools consume Core operation review. They do not define a separate
workspace mutation protocol.

```text
tool.preview -> workspace.previewOperation(...)
tool.apply   -> workspace.applyOperation(...)
```

Canonical AI workspace tools:

```text
workspace.writeText
workspace.editText
workspace.patchText
workspace.mkdir
workspace.move
workspace.copy
workspace.delete
```

Text-edit-specific tools exist for precise source changes, but their file
conflict and apply semantics reduce to Core workspace review.

Binary content is not model-facing by default. AI receives path, mime, size,
hash, and optional preview URL metadata, not raw blob bytes.

`aiditor.ai.operations` remains the AI Host review registry for model-facing
domain operations. Workspace operation review is lower-level Core file review.
AI operations wrap workspace previews when they need file effects, but they do
not redefine file conflict rules.

## Non-Goals

The workspace must not include:

- Project model
- Asset database
- Scene, prefab, material, animation, or table semantics
- Import pipeline
- Dependency graph
- Game Aiditor `FileOperationJournal`
- Project-level undo policy
- Domain validation rules
- glTF-specific loader
- Image, model, or audio business categorization

Hosts build those systems on top of workspace primitives.

## Tool Contributions

`workspace` is a Core module, not an AI concept. Like any other module, it may
contribute tools to the AI tool registry. The standard workspace tool prefix is
`workspace.*`:

```text
workspace.listFiles
workspace.fileSummary
workspace.capabilities
workspace.searchFiles
workspace.readText
workspace.readTextRange
workspace.editText
workspace.writeText
workspace.patchText
workspace.mkdir
workspace.copy
workspace.move
workspace.delete
workspace.stat
```

These are ordinary AI tools backed by the current workspace adapter. They are
generic and do not know product descriptors, table schemas, panel registrations,
or build scripts.

Mutating tools (`workspace.editText`, `workspace.writeText`,
`workspace.patchText`, `workspace.mkdir`, `workspace.copy`, `workspace.move`,
and `workspace.delete`) consume the Core `workspace.previewOperation` /
`workspace.applyOperation` primitive so review, permission, overwrite intent,
and CAS validation all share one implementation.

`workspace.editText`, `workspace.writeText`, and `workspace.patchText` validate
JS and JSON before commit. JSON must parse. JS must not contain known truncation
markers, unterminated strings/comments, or unbalanced braces; classic non-module
scripts also receive a syntax parse check. A failed validation leaves the
previous file unchanged. This keeps interrupted provider output from corrupting
workspace files.

Preview reads the current file and returns the same diff summary shape that
apply returns:

```text
before/after hash
before/after size and line count
changed start line
added/removed line count
```

That makes approval UI and autonomous full-access runs inspect the proposed file
change before it is applied.

## AI Runtime Binding

The AI runtime may bind one active workspace so `workspace.*` tool calls know
which adapter to use:

```js
aiditor.ai.setWorkspace(workspace, meta)
aiditor.ai.clearWorkspace()
aiditor.ai.selectWorkspaceDirectory(options)
aiditor.ai.currentWorkspace()
aiditor.ai.workspaceMeta()
aiditor.ai.workspaceLabel()
aiditor.ai.workspaceVersion()
```

This binding is not a second workspace API and not a project model. It is only
the runtime's current file boundary for `workspace.*` tools. If no file access
is needed, leave it empty.

## Domain Tools

Domain-level file handling should be exposed as domain tools outside Core:

```text
gde.table.readSchema
gde.table.patchRows
gde.asset.rename
ani.timeline.readClip
ani.timeline.patchKeys
```

Those tools can use the active workspace internally, but their names and schemas
belong outside Core. There is still only one AI tool registry.

Verification is also adapter-backed, not a workspace responsibility. Hosts that
can run checks may register `verify.*` tools with
`aiditor.ai.configureVerify(adapter)`. The workspace module still only provides
bounded file access.

The bundled local bridge can provide this adapter over `/verify/*`, but it is
still a host concern: bridge commands run in an explicitly allowed local working
directory, never from framework code.

Local bridges, git, verify, and command runners are host adapters. They must
declare allowed roots, timeouts, output limits, command policy, and audit fields.
The framework consumes their contract; it does not treat them as ordinary
browser workspace APIs.

The AIditor demo uses this pattern for workspace-backed UI generation. See
[agent-workspace-editing.md](./agent-workspace-editing.md): agents write
workspace files, reload the demo workspace app, and add panels by registered
component name.

## Safety Rules

1. All workspace paths are relative to the workspace root.
2. Writes require permission.
3. Patches require `baseHash` for existing content.
4. Deletes are separate from writes.
5. Large reads should use search or range reads first.
6. Workspace adapters enforce the boundary. Tools should not accept absolute
   paths.
7. Existing source files should usually be changed with `workspace.editText`:
   search, read the exact range, then replace a unique `oldText` with
   `baseHash`. See [workspace-precise-editing.md](./workspace-precise-editing.md).
8. Full-file writes are for complete new files or deliberate replacement.
9. Line patches are an escape hatch for mechanical edits and must still use
   `baseHash`.


## Test Matrix

The workspace implementation must cover:

- Final `readText` / `writeText` behavior.
- `writeText` / `writeBlob` target exists without base version rejects.
- Matching `baseHash` updates an existing file.
- Mismatched `baseHash` rejects.
- `move` / `copy` target exists rejects by default.
- `overwrite:true` still checks `targetBaseHash` when provided.
- Preview source changes before apply rejects.
- Preview target missing, target appears before apply rejects.
- Preview target exists, target version changes before apply rejects.
- Recursive delete directory contents change before apply rejects.
- `confirmWarnings` / `confirmOverwrite` do not bypass CAS, permission,
  capability, or path boundary.
- Versionless adapters surface `versioned:'none'`.
- Snapshot over `maxMemoryBytes` fails clearly.
- FSA `stat` / `readBlob` / `snapshot` / `restoreSnapshot` errors include
  `path`, `op`, `reason`, `code`, and permission recovery guidance.
- Recursive snapshot and restore failures identify the specific child file that
  failed.
- `applyOperation` wraps execution failures with enough structured data for host
  logs without hiding the original cause.
- Object URL `release`, `revokeObjectUrl`, and owner cleanup revoke URLs.
- Adapter enhancement produces callable APIs without inventing metadata.
- AI mutating tools use Core preview/apply.

An implementation is not workspace-complete until this matrix passes. Partial
coverage is an implementation gap, not a reduced version of the design.

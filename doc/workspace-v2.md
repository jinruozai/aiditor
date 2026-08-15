# Workspace V2 Design

## Goal

Workspace V2 defines the final AIditor file-system primitive for front-end
editors. It is a bounded, version-aware, reviewable file operation layer.

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

Workspace V2 has one concept stack:

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
effects, and file conflict rules always come from Workspace V2.

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
`read/write` names are not part of the Workspace V2 concept model.

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
Workspace V2 does not use a generic `force` option because it is too easy to
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

Workspace V2 operation review handles file-system mutations. It does not replace
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

Workspace V2 is a final API shape, not a requirement that every backend hand
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

Workspace V2 must not include:

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

## Test Matrix

Workspace V2 implementation must cover:

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

An implementation is not Workspace V2-complete until this matrix passes. Partial
coverage is an implementation gap, not a reduced version of the design.

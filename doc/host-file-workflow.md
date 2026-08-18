# Host File Workflow

This document describes the recommended host-editor pattern on top of
[workspace.md](./workspace.md). It is not part of Core workspace.

Workspace V2 provides file-system primitives. A host editor owns project policy:
commands, history grouping, file index refresh, reference updates, conflict UI,
and recovery.

## Responsibilities

```text
Workspace V2
  bounded paths
  stat/version
  preview/apply file operations
  snapshot capture/restore
  object URL leases

Host editor
  EditorCommand
  HistoryService
  FileOperationJournal
  FileIndex
  reference repair
  conflict UI
  domain validation
```

The host calls workspace APIs without forking workspace conflict rules. It wraps
workspace operations in domain commands.

## Recommended Flow

For a domain file command such as rename, duplicate, import, or delete:

```text
1. Build EditorCommand input from user intent.
2. Ask FileIndex for affected files and known references.
3. Capture snapshots for paths that need recovery coverage.
4. Build one or more WorkspaceOperation inputs.
5. Call workspace.previewOperation for file-system effects.
6. Add host-level reference repair and validation previews.
7. Show conflict UI when warnings/errors exist.
8. Apply workspace operations.
9. Apply reference repairs.
10. Refresh FileIndex from actual apply results.
11. Commit one HistoryService entry that points to snapshots and journal data.
```

If a workspace apply partially succeeds, the host does not assume rollback. It
uses `WorkspaceOperationApplyResult.effects` plus snapshots to offer recovery,
retry, or manual repair.

## FileOperationJournal

A host `FileOperationJournal` stores host policy and recovery data. It does not
replace Workspace V2.

Recommended journal item shape:

```js
{
  id: string,
  commandId: string,
  workspacePreviewId: string,
  snapshots: WorkspaceSnapshotRef[],
  plannedEffects: WorkspaceOperationPreview.effects,
  actualEffects: WorkspaceOperationApplyResult.effects,
  referenceRepairs: unknown[],
  fileIndexBefore: unknown,
  fileIndexAfter: unknown,
}
```

The journal groups several workspace operations into one editor command when the
host command requires that, but each file-system mutation still uses workspace
preview/apply semantics.

## FileIndex

`FileIndex` is a host cache. It is rebuilt or patched from actual workspace
results:

- `create` adds a path.
- `delete` removes a path.
- `move` updates path identity and schedules reference checks.
- `copy` adds the target and applies host metadata rules if the domain permits.
- `update` refreshes stat, hash, type inference, and derived previews.

Workspace does not maintain this index because project indexing rules are
domain-specific.

## Reference Repair

Reference repair belongs to the host because only the host knows whether a path
appears in JSON, scene files, material graphs, scripts, generated metadata, or
external manifests.

Recommended rule:

```text
workspace operation -> host reference preview -> host reference apply
```

Reference repair is previewed and committed in the same editor command as the
underlying file operation, but it is not moved into Core workspace.

## Conflict UI

Workspace previews expose generic file risks:

- target exists
- source changed
- target changed
- weak version
- no reliable version
- recursive directory fingerprint changed
- adapter capability missing

The host turns those warnings/errors into user-facing choices. The host does not
downgrade Core errors into warnings.

## Domain Validation

Domain validation runs above workspace:

```text
workspace validates file-system safety
host validates project/domain correctness
```

For example, Workspace can validate JSON syntax for a text edit helper, but it
does not know whether that JSON is a valid material, prefab, animation, or table.

## System File Manager Reveal

Hosts can expose "Reveal in System File Manager" on file or directory context
menus when the active workspace reports:

```js
workspace.capabilities().revealInSystem === true
```

This is a capability-gated platform action, not a project command. The menu item
should be absent when the capability is false. A disabled always-visible action
is misleading for pure Web, memory, and File System Access adapters that cannot
reach the operating system file manager.

Recommended host flow:

```text
1. User opens a file or directory context menu.
2. Host checks workspace.capabilities().revealInSystem.
3. Host converts any project URI to a workspace-relative path.
4. Host calls workspace.revealInSystem(path, { select:true }).
5. Host writes failures to Log or host UI using the stable reason.
```

`ProjectWorkspace` may forward this call, but it must preserve the boundary:
project URIs are resolved to workspace-relative paths before reaching the
adapter, and the adapter remains responsible for workspace root validation.
Project code never receives an absolute system path, File System Access handle,
or shell API.

Failure reasons are stable:

```text
unsupported
not_found
permission_denied
platform_error
```

The action is separate from editor-internal reveal behavior. An OpenService-like
`reveal` call locates an item inside the editor UI. `workspace.revealInSystem`
delegates to the system file manager.

This action does not enter history, does not use `previewOperation` /
`applyOperation`, does not refresh FileIndex by itself, and does not affect
reference repair.

# workspace API

Generated from structured API comments in `src/`.

## `aiditor.workspace.bind`

Bind a runtime workspace adapter to a JSON-safe id so PanelData stores identity rather than live adapter objects.

```js
aiditor.workspace.bind(id, adapter)
```

| Param | Type | Description |
|---|---|---|
| `id` | `string` | Stable host-owned workspace id. |
| `adapter` | `object` | Workspace adapter created by memory, fromHandle, fromBridge, or another contract-compatible host. |

Returns: `Function` Idempotent owner-safe unbind callback.

Related: `aiditor.workspace.binding`, `aiditor.ui.createTextDocument`

Source: `src/core/workspace.js`

## `aiditor.workspaceState.configure`

Configure the project-scoped JSON state adapter used for small UI/runtime state; this storage is separate from workspace files.

```js
aiditor.workspaceState.configure(options)
```

| Param | Type | Description |
|---|---|---|
| `options` | `object` | Adapter options. |
| `options.adapter` | `object` | Optional adapter with load(workspaceId,key), save(workspaceId,key,value), and remove(workspaceId,key). |

Returns: `object` Active adapter.

Related: `aiditor.workspaceState.load`, `aiditor.workspaceState.save`

Source: `src/core/workspace-state.js`

## `aiditor.workspaceState.load`

Load one JSON-safe state value from an opaque project/workspace namespace.

```js
aiditor.workspaceState.load(workspaceId, key)
```

| Param | Type | Description |
|---|---|---|
| `workspaceId` | `string` | Stable host-owned project/workspace identity. |
| `key` | `string` | State owner key. |

Returns: `Promise<*>` Stored value or null.

Related: `aiditor.workspaceState.save`, `aiditor.workspaceState.remove`

Source: `src/core/workspace-state.js`

## `aiditor.workspaceState.remove`

Enqueue removal of one project-scoped state value through the same serialized write queue as save.

```js
aiditor.workspaceState.remove(workspaceId, key)
```

| Param | Type | Description |
|---|---|---|
| `workspaceId` | `string` | Stable host-owned project/workspace identity. |
| `key` | `string` | State owner key. |

Returns: `Promise<*>` Completion of this removal or a newer coalesced operation.

Related: `aiditor.workspaceState.load`, `aiditor.workspaceState.save`

Source: `src/core/workspace-state.js`

## `aiditor.workspaceState.save`

Enqueue a JSON-safe state write; writes for the same workspaceId and key are serialized and pending snapshots are coalesced to the newest value.

```js
aiditor.workspaceState.save(workspaceId, key, value)
```

| Param | Type | Description |
|---|---|---|
| `workspaceId` | `string` | Stable host-owned project/workspace identity. |
| `key` | `string` | State owner key. |
| `value` | `*` | JSON-safe state value. |

Returns: `Promise<*>` Completion of this write or a newer coalesced write.

Related: `aiditor.workspaceState.load`, `aiditor.workspaceState.remove`

Source: `src/core/workspace-state.js`

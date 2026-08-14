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

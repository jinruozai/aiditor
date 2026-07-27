# Shortcut System

`aiditor.shortcuts` is the framework-level keyboard shortcut primitive. It
normalizes browser or host key input, resolves a generic editor context, matches
registered key bindings, diagnoses conflicts, and routes the chosen binding to
`aiditor.commands.run`.

It is not an application keymap. AIditor must not ship domain shortcuts such as
save, open, close document, edit image, run game, or undo scene operation. Host
apps register their own commands, scopes, bindings, and panel metadata.

## Boundary

A shortcut binding never mutates editor data directly. It names a command:

```js
aiditor.commands.run(binding.command, binding.args || {}, shortcutContext)
```

The command implementation belongs to the host or contributing module. Any data
mutation, history grouping, file journal, save policy, resource reload, or
domain validation stays above `aiditor.shortcuts`.

Framework-owned responsibilities:

- key normalization and platform display formatting
- DOM and native-host key routing through one indexed dispatcher
- binding registry, owner cleanup, source precedence, and priority
- generic shortcut context resolution
- panel shortcut surface metadata
- editable policy and editor-local handled markers
- conflict and risk diagnostics
- user override storage as local user preference
- command-to-shortcut lookup for menus, toolbars, and palettes

Host-owned responsibilities:

- command ids and command behavior
- default app/module/user bindings
- scope ids and labels
- panel surface metadata values
- selection context adapters
- project, file, document, scene, image, engine, and asset semantics
- CommandBus/history integration

## Data Model

Bindings are data records. `id`, `command`, and `keys` are required.

```ts
type ShortcutBinding = {
  id: string;
  command: string;
  keys: string[];
  args?: unknown;
  layer?: ShortcutLayer;
  scope?: string;
  when?: ShortcutWhen | ((ctx: ShortcutContext) => boolean);
  source?: "builtin" | "module" | "app" | "user";
  owner?: unknown;
  priority?: number;
  editablePolicy?: "block" | "allow" | "local";
  preventDefault?: boolean;
};

type ShortcutLayer =
  | "modal"
  | "menu"
  | "editable"
  | "panel"
  | "selection"
  | "global";
```

There is no `target: "active"` field in the binding contract. The target is
resolved by the runtime from the key event and current editor state. Avoiding a
second target field keeps binding records declarative and prevents ambiguous
"active versus hover versus event target" interpretations.

`source` resolves layered keymaps. The framework stores all sources in one
registry, then computes effective bindings by source precedence and priority.
The order is:

```text
user > app > module > builtin
```

`priority` orders bindings inside the same effective source and comparable
context. Larger numbers win.

## Context And Surface

The shortcut context is generic. It describes where the key was pressed and
which generic surface is currently relevant.

```ts
type ShortcutContext = {
  event: KeyboardEvent | null;
  input: ShortcutKeyInput;
  key: string;
  layer: ShortcutLayer;
  target: ShortcutTarget | null;
  editable: boolean;
  handled: boolean;
  scope?: string;
  command?: string;
  binding?: ShortcutBinding;
};

type ShortcutKeyInput = {
  key: string;
  code?: string;
  phase?: "down" | "up";
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  location?: number;
  handled?: boolean;
};

type ShortcutTarget = {
  layer: ShortcutLayer;
  panelId?: string;
  component?: string;
  scope?: string;
  meta?: Record<string, unknown>;
};

type PanelShortcutSurface = {
  panelId: string;
  component: string;
  scope?: string;
  meta?: Record<string, unknown>;
};
```

Business identifiers such as `documentKey`, `resourceUri`, `assetId`, or
`sceneId` belong in `meta`. The framework treats `meta` as opaque data and only
passes it through to commands and `when` predicates.

Required APIs:

```js
const dispose = aiditor.shortcuts.attachPanelSurface(el, surface)
aiditor.shortcuts.setHoverSurface(surface)
aiditor.shortcuts.setActiveSurface(surface)
aiditor.shortcuts.setSelectionProvider(provider)
aiditor.shortcuts.clearTransientTargets(options)
aiditor.shortcuts.context(event)
aiditor.shortcuts.dispatchKey(input, surface)
```

`attachPanelSurface` returns a disposer and also participates in normal owner or
element cleanup when the caller provides one. Disposing a panel surface removes
surface metadata, clears matching hover/active transient targets, and prevents
stale panel metadata from being used after panel teardown.

Target resolution order:

1. overlay-local modal/menu target
2. focused editable target
3. nearest panel surface from `event.target`
4. hover panel surface
5. active panel surface
6. host-provided selection context
7. global

`layer: "selection"` is a generic routing layer only. AIditor does not provide a
selection service and does not know what the selection means. Hosts may provide
a selection context adapter with `setSelectionProvider(provider)`. The provider
receives the keyboard event for DOM dispatch or the normalized
`ShortcutKeyInput` for host dispatch, then returns an opaque `ShortcutTarget` or
`null`.

Hover surfaces must be transient. The runtime clears stale hover state when the
element is disconnected, when the pointer leaves the registered surface, and
when the owning panel is disposed.

A focused editable target still inherits the nearest panel surface metadata.
For example, a focused textarea inside a panel resolves as `layer:"editable"`,
but its `target.panelId`, `target.component`, `target.scope`, and `target.meta`
come from the nearest registered panel surface. This lets generic shortcuts such
as save route through commands with enough host metadata while keeping the
framework unaware of document or resource semantics.

## Host Key Dispatch

Desktop and native hosts dispatch structured input directly instead of creating
synthetic `KeyboardEvent` objects:

```js
const handled = aiditor.shortcuts.dispatchKey({
  key: 's',
  code: 'KeyS',
  phase: 'down',
  ctrlKey: true,
  repeat: false,
}, {
  layer: 'panel',
  panelId: 'editor-main',
  component: 'code-editor',
  scope: 'editor.code',
  meta: { resourceUri: 'workspace://src/main.js' },
})
```

`key` is required and carries the logical, layout-aware key used for shortcut
matching. `code` is optional physical-key metadata and is exposed through
`ShortcutContext.input`; it is not used as a fallback shortcut identity. Each
call is a complete input snapshot, so the runtime never maintains modifier
state that can become stale across a host bridge.

Only `phase:"down"` participates in command matching. `phase:"up"` returns
`false`. The dispatcher returns `true` only after a live command binding is
selected and invoked. A host can use that result to suppress its own default
handling. Native dispatch cannot call DOM `preventDefault`; DOM `keydown`
continues to honor each binding's `preventDefault` flag before entering the same
dispatcher.

The optional `surface` is generic shortcut metadata, not a DOM element. When it
is omitted, the normal hover, active, selection, and global resolution chain is
used. Electron-style `type/control/meta/alt/shift/isAutoRepeat` fields are
accepted at this adapter boundary and normalized to the canonical fields above.

## Key Normalization

The runtime canonicalizes keys before indexing and matching.

Canonical form examples:

```text
Mod+S
Mod+Shift+S
Ctrl+Alt+P
F2
Escape
```

Rules:

- Modifier order is stable.
- `Mod` maps to `Meta` on macOS and `Ctrl` on Windows/Linux for matching.
- `Cmd`, `Command`, `Meta`, and platform `Mod` are equivalent on macOS.
- `Ctrl`, `Control`, and platform `Mod` are equivalent on Windows/Linux.
- `Ctrl+Shift+S` and `Shift+Ctrl+S` normalize to the same key.
- Printable keys use a stable case-independent canonical key.
- Display formatting is separate from storage.

Required APIs:

```js
aiditor.shortcuts.normalizeKey(input, options)
aiditor.shortcuts.eventKey(event)
aiditor.shortcuts.formatShortcut(keyOrKeys, options)
aiditor.shortcuts.record(event, options)
aiditor.shortcuts.risks(keyOrKeys)
```

`formatShortcut` uses platform display conventions. For example `Mod+S`
displays as `⌘S` on macOS and `Ctrl+S` elsewhere.

`risks` reports browser-reserved or high-risk keys as structured warnings. It
does not prevent registration by itself; hosts decide how strict their settings
UI should be.

## Matching And Execution

The runtime keeps an index from normalized key to candidate binding ids. A
keydown never scans the entire registry.

Execution steps:

1. Convert the event to a normalized key.
2. Read candidates from the key index.
3. Build `ShortcutContext`.
4. Filter candidates by layer, scope, editable policy, command availability, and
   `when`.
5. Sort matching candidates by context specificity, then source, priority, and
   registration order.
6. Choose the winning binding.
7. Mark/prevent the browser event according to binding policy.
8. Call `aiditor.commands.run`.

If the command is unknown, registration diagnostics report it. At keydown time
the runtime skips that candidate and keeps looking for another match. If no
available command remains, the event is not prevented, not marked handled, and no
exception is thrown from the keyboard event handler.

Context specificity protects local editor surfaces from broad fallbacks:

```text
modal/menu exact
> editable exact
> panel exact or focused editable inherited panel
> selection exact
> global fallback
```

Inside the same context specificity, scoped bindings beat unscoped bindings,
more specific `when` predicates beat broad predicates, then source/priority/order
settle the remaining tie. `global` bindings are still useful fallback bindings,
but they must not override the hovered/focused panel's own shortcut by merely
having a higher source or later registration time.

`preventDefault` defaults to true for matched bindings. Bindings may explicitly
set `preventDefault:false` for browser-compatible actions.

## Editable Policy

Editable targets need explicit policy because text inputs, code editors, rich
prompt editors, and canvas editors often have their own local keymaps.

```text
block  -> do not trigger from editable targets
allow  -> trigger even from editable targets
local  -> let the focused editor handle first; run outer shortcut only if local
          handling did not consume the event
```

Required helpers:

```js
aiditor.shortcuts.markHandled(event)
aiditor.shortcuts.isHandled(event)
```

Editor components call `markHandled(event)` when an internal keymap consumes a
key. The runtime also respects `event.defaultPrevented`. For `local`, either
condition means the outer shortcut should not run.

This helper prevents components from depending on a private event property name.

## Scope Registry

Scopes are lightweight labels for grouping and diagnostics. They are not a
semantic model.

```js
aiditor.shortcuts.registerScope({
  id: "editor.panel",
  label: "Editor Panel",
  owner: "sample",
  description: "Panel-local editing shortcuts"
})

aiditor.shortcuts.unregisterScope(id, meta)
aiditor.shortcuts.listScopes()
aiditor.shortcuts.scopeMeta(id)
```

Unknown scopes are diagnostics. A scope id does not imply project membership,
file type, document model, asset type, or permission policy.

## User Overrides

User overrides are local user preference. They are not project truth and are not
written to workspace files unless a host explicitly exports them.

Required APIs:

```js
aiditor.shortcuts.getBindings(filter)
aiditor.shortcuts.getEffectiveBindings(filter)
aiditor.shortcuts.updateUserOverride(bindingId, patch)
aiditor.shortcuts.resetOverride(bindingId)
aiditor.shortcuts.resetAllOverrides()
aiditor.shortcuts.configureStorage(options)
aiditor.shortcuts.save()
aiditor.shortcuts.load()
```

Storage adapter contract:

```ts
type ShortcutStorageOptions = {
  namespace?: string;
  schemaVersion?: number;
  adapter?: ShortcutStorageAdapter;
};

type ShortcutStorageAdapter = {
  read(): Promise<Record<string, ShortcutOverride> | null> | Record<string, ShortcutOverride> | null;
  write(overrides: Record<string, ShortcutOverride>): Promise<void> | void;
  clear(): Promise<void> | void;
};
```

The default adapter is browser-local storage owned by the current origin.
`namespace` and `schemaVersion` are part of the storage key so multiple AIditor
apps on the same origin do not collide. Hosts may replace the adapter with
IndexedDB or another local preference store. The shortcut runtime must not write
overrides into the workspace or project files by default.

An override may replace keys, disable a binding, or adjust editable policy and
priority where allowed by the binding. The effective binding table is recomputed
after overrides and diagnostics run against the effective table.

Overrides patch registered bindings only. They must not create arbitrary new
command bindings, because command exposure and default binding policy belong to
the host or contributing module. If a user override references a missing
binding id, diagnostics should report it and the runtime should ignore it.

Settings UI is a separate consumer of these APIs. The runtime contract must not
depend on a settings panel.

## Diagnostics

Diagnostics are computed during registration, unregistration, storage load, and
override updates. They are not computed on every keydown.

Shape:

```ts
type ShortcutDiagnostic = {
  level: "error" | "warn";
  code: string;
  bindingIds?: string[];
  key?: string;
  scope?: string;
  message: string;
};
```

Required diagnostic codes:

```text
duplicate_binding
unknown_command
unknown_binding
unknown_scope
equivalent_key
key_conflict
global_key_overlap
ambiguous_panel_scope
editable_local_conflict
browser_reserved
browser_risky
storage_error
```

Diagnostics return structured data only. The framework does not show dialogs or
toast messages for shortcut conflicts.

`when` predicates can be arbitrary functions, so overlap analysis is
conservative. If two bindings have the same normalized key, comparable layer,
same scope, and unknown or overlapping `when`, report a warning instead of
pretending the conflict is proven safe.

`global_key_overlap` is a warning, not an error. It means a global binding and a
scoped binding share a key and may both be relevant. Context-specific matching
will prefer the local binding when a matching surface is active, and use the
global binding only as fallback.

## Command And Menu Integration

Commands remain the action boundary. Shortcuts are presentation and routing.

Required APIs:

```js
aiditor.shortcuts.getShortcutForCommand(commandId, context)
aiditor.shortcuts.getShortcutsForCommand(commandId, context)
aiditor.shortcuts.onChanged(handler)
```

`aiditor.commands.menuUiItems(target, ctx)` should use shortcut lookup when a
menu item has a command and no explicit `kbd`. Toolbars and command palettes
can use the same lookup.

This keeps menus, palettes, and shortcut settings synchronized without each
host maintaining a second command-to-key display table.

## Public API Summary

```js
aiditor.shortcuts.register(binding, meta)
aiditor.shortcuts.unregister(id, meta)
aiditor.shortcuts.unregisterOwner(owner)
aiditor.shortcuts.unregisterPrefix(prefix)

aiditor.shortcuts.registerScope(scope)
aiditor.shortcuts.unregisterScope(id, meta)
aiditor.shortcuts.listScopes()
aiditor.shortcuts.scopeMeta(id)

aiditor.shortcuts.attachPanelSurface(el, surface)
aiditor.shortcuts.setHoverSurface(surface)
aiditor.shortcuts.setActiveSurface(surface)
aiditor.shortcuts.setSelectionProvider(provider)
aiditor.shortcuts.dispatchKey(input, surface)
aiditor.shortcuts.clearTransientTargets(options)
aiditor.shortcuts.context(event)

aiditor.shortcuts.normalizeKey(input, options)
aiditor.shortcuts.eventKey(event)
aiditor.shortcuts.formatShortcut(keyOrKeys, options)
aiditor.shortcuts.record(event, options)
aiditor.shortcuts.risks(keyOrKeys)

aiditor.shortcuts.getBindings(filter)
aiditor.shortcuts.getEffectiveBindings(filter)
aiditor.shortcuts.getShortcutForCommand(commandId, context)
aiditor.shortcuts.getShortcutsForCommand(commandId, context)

aiditor.shortcuts.updateUserOverride(bindingId, patch)
aiditor.shortcuts.resetOverride(bindingId)
aiditor.shortcuts.resetAllOverrides()
aiditor.shortcuts.configureStorage(options)
aiditor.shortcuts.load()
aiditor.shortcuts.save()

aiditor.shortcuts.diagnostics(filter)
aiditor.shortcuts.onChanged(handler)

aiditor.shortcuts.markHandled(event)
aiditor.shortcuts.isHandled(event)
```

## Non-Goals

AIditor shortcuts must not:

- define host app or demo app default shortcuts
- include project, file, document, scene, image, engine, asset, or import
  pipeline semantics
- mutate data directly
- replace `aiditor.commands`
- replace host CommandBus or history
- create a framework selection service
- create a SemanticGraphService
- become a VS Code-scale keybinding language
- require a local server or native bridge

## Host Migration Shape

A host app's shortcut layer should reduce to:

1. register host commands with `aiditor.commands`
2. register host scopes with `aiditor.shortcuts`
3. register default host/module bindings
4. attach panel surfaces when panels mount
5. optionally provide selection context
6. keep data mutation in host commands, CommandBus, and history

This preserves the framework boundary: AIditor owns the keyboard infrastructure;
the host owns editor meaning.

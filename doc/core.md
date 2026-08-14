# Core

Core is the generic infrastructure layer. It must stay independent of domain
models and AI provider details.

## Public Areas

```text
aiditor.signal
aiditor.effect
aiditor.derived
aiditor.batch
aiditor.untracked
aiditor.onCleanup

aiditor.log
aiditor.reportError
aiditor.safeCall

aiditor.names
aiditor.bus
aiditor.history
aiditor.theme
aiditor.i18n
aiditor.settings
aiditor.commands
aiditor.shortcuts
aiditor.runtime
aiditor.workspace
```

## Signals

Signals are the base reactivity primitive.

Implemented abilities:

- `signal(initial)`
- `effect(fn)`
- `derived(fn)`
- `batch(fn)`
- `untracked(fn)`
- `onCleanup(fn)`

Design rule: signals are framework infrastructure, not domain state policy.

## Log And Safe Calls

`aiditor.log` is the shared log stream. `reportError` and `safeCall` isolate
component and plugin errors so one failing panel does not take down the shell.

Design rule: only user-code boundaries need safe wrapping. Internal framework
contracts should stay simple and fail clearly.

## Names

`aiditor.names.matchesPrefix(name, prefix)` is the shared dotted-prefix matcher
used by registries for list and cleanup behavior.

## Bus

`aiditor.bus` is the decoupled communication path between panels and domain
code.

It provides:

```js
aiditor.bus.on(topic, handler)
aiditor.bus.off(topic, handler)
aiditor.bus.emit(topic, payload)
```

Component contexts should use bus subscriptions that are cleaned up with the
component lifecycle.

## History

`aiditor.history.create(options)` creates a generic undo/redo timeline.

Implemented abilities:

- capture and apply snapshots
- push and replace entries
- async-safe jump, undo, redo
- pause recording
- begin, commit, cancel transactions
- record a function as one transaction

`jump(index)`, `undo()`, and `redo()` return `Promise<Entry | null>`.
Synchronous `apply(snapshot, ctx)` functions are still valid; the returned
Promise resolves immediately after the synchronous apply succeeds. If `apply`
returns a thenable, `history.applying()` stays true until that thenable settles.

The timeline index moves only after `apply` succeeds. If synchronous or async
apply fails, the Promise rejects and the previous index remains current. Callers
can catch the error and decide how to surface it.

`aiditor.history.bind(id, history, options)` exposes a named history instance to
generic UI such as the built-in `history` panel. Binding options may include
host-owned state such as `savedIndex` or an `onError(err, ctx)` display hook.
The binding is only a reference surface; project saved policy and file journal
policy remain host-owned.

The built-in `history` component is a generic History panel primitive. It shows
entries, current and saved markers, and calls `undo`, `redo`, or `jump`. It does
not create history entries, infer project dirty state, inspect files, or repair
references.

History panel props stay JSON-serializable. Use `{ historyId:'main' }` in
`panel.props`; register the actual history object and hooks with
`aiditor.history.bind('main', history, options)`. Do not put functions or
history instances into panel props.

History is generic infrastructure. Domain history such as table edits, timeline
keys, scene objects, or generated code must adapt their snapshots into this
generic history surface.

## Settings

`aiditor.settings` stores setting sections, schemas, custom pages, values, and
persistence.

Implemented abilities:

```js
aiditor.settings.registerSection(id, spec, meta)
aiditor.settings.registerSchema(sectionId, schemaOrArray, meta)
aiditor.settings.registerPage(id, spec, meta)
aiditor.settings.unregisterPrefix(prefix)
aiditor.settings.unregisterOwner(owner)
aiditor.settings.sectionMeta(id)
aiditor.settings.schemaMeta(key)
aiditor.settings.pageMeta(id)
aiditor.settings.get(key)
aiditor.settings.set(key, value)
aiditor.settings.reset(key)
aiditor.settings.resetSection(sectionId)
aiditor.settings.exportValues()
aiditor.settings.importValues(values)
aiditor.settings.configurePersistence(options)
aiditor.settings.save()
aiditor.settings.clearStoredValues()
aiditor.settings.resolveOptions(definition, context)
```

Settings are framework-level configuration infrastructure. Domain-specific
settings belong under domain prefixes.

The settings UI is only a generic shell. Each module registers its own setting
sections and schemas next to the module code that owns them; the settings panel
must not import AI, theme, workspace, or domain-specific configuration logic.

## Commands And Menus

`aiditor.commands` is a generic command registry and menu contribution surface.

Implemented abilities:

```js
aiditor.commands.register(id, spec, meta)
aiditor.commands.unregister(id, meta)
aiditor.commands.unregisterPrefix(prefix)
aiditor.commands.unregisterOwner(owner)
aiditor.commands.get(id)
aiditor.commands.list(filter)
aiditor.commands.run(id, input, context)
aiditor.commands.registerMenu(id, spec, meta)
aiditor.commands.unregisterMenu(id, meta)
aiditor.commands.listMenus(filter)
aiditor.commands.menuItems(target, filter, context)
aiditor.commands.menuUiItems(target, context)
aiditor.commands.meta(id)
aiditor.commands.menuMeta(id)
```

Commands are named with dotted paths. Domain-specific commands should use domain
prefixes.

Menu contributions are data records. `name`, `label`, `description`, `detail`,
`argumentHint`, `icon`, `kbd`, `danger`, `disabled`, `when`, and `input` may be
literal values or functions of the menu context. `childrenTarget` creates a
nested menu by pointing at another target. `name` is the compact invocation
name used by surfaces such as the AI composer slash picker; `label` remains the
human display title.

Commands are for humans and UI. Tools are for AI/model calls. If one action must
serve both callers, expose it through both registries and keep the caller-facing
policy separate.

## Shortcuts

`aiditor.shortcuts` is documented in [shortcuts.md](./shortcuts.md). It is a
Core primitive because it only owns generic keyboard infrastructure: key
normalization, context resolution, binding registration, diagnostics, user
overrides, and command routing.

Shortcut bindings point to command ids and execute through
`aiditor.commands.run`. They must not mutate data directly and must not encode
project, file, document, scene, image, engine, or asset semantics.

Framework code may provide shortcut infrastructure and component-internal
semantic keys, but it must not hard code application-level shortcut policy.
Host apps register their own commands, scopes, bindings, and panel metadata.

## Theme And I18n

`aiditor.theme` owns theme mode and token application. UI components should read
semantic CSS tokens instead of domain colors.

`aiditor.theme` also owns built-in theme metadata. Theme ids, labels, and color
schemes are declared once in Core and exposed through `modes()`, `modeIds()`,
`modeOptions()`, and `hasMode(id)`. Settings UI, demo tooling, AI tool schemas,
and tests consume those helpers instead of duplicating their own theme arrays.
`src/style/theme.css` owns the shared theme contract, while
`src/style/themes/<id>.css` files own each built-in mode's visual token
implementation.

Theme tokens cover color and appearance. Shape, stroke width, elevation, root
texture, and small accent geometry are role tokens consumed by UI components;
Core does not provide a theme-specific component override system.

`aiditor.i18n` owns language selection and string lookup. It is framework
infrastructure; dictionaries are provided outside Core.

## Workspace

`aiditor.workspace` is documented in [workspace.md](./workspace.md). It is part
of Core because it only defines bounded file access, not a project model.

## Runtime Contributions

`aiditor.runtime.loadScript(options)` executes host-provided JavaScript source
with a default registration owner:

```js
aiditor.runtime.loadScript({
  id: 'sample.panel',
  source: sourceText,
  owner: 'workspace:sample',
  layer: 'workspace',
})
```

The framework does not read arbitrary files here. Hosts or AI workspace tools
resolve paths into source text, then call this loader. During the load,
owner-aware registries such as components, commands, settings, AI tools,
references, operations, and Inspector providers inherit the default owner unless
the registration call provides its own metadata.

`aiditor.runtime.unloadOwner(owner)` removes owner-scoped registrations from the
known registries. It is the cleanup boundary for runtime-loaded contributions.

## Metadata Note

Some registries accept metadata such as `owner` and `layer` for diagnostics,
palette filtering, permission review, and extension safety policy. Prefix
cleanup is the lifecycle path.

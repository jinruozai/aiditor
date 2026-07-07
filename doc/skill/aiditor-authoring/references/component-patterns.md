# Component Patterns

Load this reference when you are writing or reviewing AIditor component code.

## Component Contract

```js
aiditor.registerComponent('domain.name', {
  category: 'panel',
  label: 'Readable Name',
  defaults: function () {
    return { title: 'Readable Name', icon: 'square', props: {} }
  },
  factory: function (propsSig, ctx) {
    const root = document.createElement('div')
    return root
  },
})
```

`defaults()` returns panel defaults. `factory()` returns one HTMLElement. The
framework owns panel lifecycle; the component owns only its returned subtree and
any resources it creates.

## Signals

Use AIditor signals for component state:

```js
const value = aiditor.signal('hello')

ctx.onCleanup(aiditor.effect(function () {
  const props = propsSig() || {}
  value(props.text || '')
}))
```

Use `propsSig.peek()` for one-time reads. Use `propsSig()` only inside an
effect or derived signal. Do not call `propsSig.get()` or `propsSig.on()`.

## Layout

Panel roots should be stable inside split docks:

```js
root.style.height = '100%'
root.style.minHeight = '0'
root.style.boxSizing = 'border-box'
root.style.display = 'grid'
root.style.gridTemplateRows = 'auto minmax(0, 1fr)'
```

Use `minmax(0, 1fr)` or flex children with `minHeight: 0` for scrollable middle
areas. Avoid fixed viewport sizes inside panels.

## UI Library

Prefer AIditor UI primitives when the UI layer is loaded:

```js
const name = aiditor.signal('Untitled')

root.appendChild(aiditor.ui.view({
  scroll: 'y',
  padding: true,
  children: [
    aiditor.ui.input({ value: name, placeholder: 'Name' }),
    aiditor.ui.button({
      text: 'Save',
      icon: 'save',
      kind: 'primary',
      onClick: function () { ctx.panel.setDirty(false) },
    }),
  ],
}))
```

Use the matching component for buttons, icon buttons, form fields, lists, trees,
tables, menus, popovers, modals, drawers, toasts, and scroll surfaces.

If the host loaded only `aiditor-kernel`, write plain DOM inside component
roots or ask the host to load `aiditor-ui` before using `aiditor.ui.*`.

## Property Forms And Inspector

Use `aiditor.ui.propertyForm` when the current component owns the objects being
edited:

```js
const targets = aiditor.signal([{ name: 'Node', visible: true }])
root.appendChild(aiditor.ui.propertyForm({
  targets: targets,
  schema: {
    name: { type: 'string' },
    visible: { type: 'bool' },
  },
  onChange: function (field, value) {
    targets.set(targets.peek().map(function (item) {
      const next = Object.assign({}, item)
      next[field] = value
      return next
    }))
  },
}))
```

Use `aiditor.inspector` when selection comes from different panels or canvases
and a shared dock panel should inspect it. Register one provider per domain
target type, call `aiditor.inspector.select(targets)` from selection surfaces,
and mount the built-in `inspector` component.

```js
const cubeState = {
  position: [0, 0, 0],
  size: [1, 1, 1],
  color: '#ff6a00',
}

aiditor.inspector.registerProvider('three.cube', {
  inspect: function (targets, ctx) {
    return {
      title: 'Cube',
      schema: {
        position: { type: 'struct', struct_def: { x: 'float', y: 'float', z: 'float' } },
        size: { type: 'struct', struct_def: { x: 'float', y: 'float', z: 'float' } },
        color: { type: 'string', type_render: 'color', type_agv: { valueKind: 'hex' } },
      },
      values: [cubeState],
      write: function (field, change, writeCtx) {
        Object.assign(cubeState, writeCtx.applyChange(cubeState, change, writeCtx.schema))
        applyCubeState(cubeState)
        aiditor.inspector.refresh()
      },
    }
  },
})

aiditor.inspector.select({ type: 'three.cube', id: 'cube', title: 'Cube' })
```

`struct` values are tuple arrays ordered by `struct_def`; do not author them as
dictionary objects.

Inspector multi-selection is ordered. The first target is primary and supplies
displayed values. A field is editable only when every selected target has that
field and the provider allows writing it. Do not invent a mixed-value state.

## Cleanup

Register external resources with `ctx.onCleanup`:

```js
const off = ctx.bus.on('selection.changed', function (payload) {
  // update local state
})

const timer = setInterval(tick, 1000)
ctx.onCleanup(function () { clearInterval(timer) })
ctx.onCleanup(function () { aiditor.ui.dispose(root) })
```

`ctx.bus.on` already auto-cleans when the panel is disposed. Call the returned
disposer only if you need to unsubscribe early.

## Toolbar Items

Toolbar components use the same component contract. Static toolbar items have
`ctx.dock` and no `ctx.panel`, because they belong to the dock rather than one
panel.

Built-in dock tabs are still ordinary toolbar items. `tab-standard` does not
show an add button by default; configure `props.addPanel` when a host wants a
domain-specific add action:

```js
aiditor.dock({
  toolbar: {
    direction: 'top',
    items: [{
      component: 'tab-standard',
      props: { addPanel: { component: 'app.emptyScene', title: 'Scene' } },
    }],
  },
})
```

The configured record is merged over the target component defaults before
calling `ctx.dock.addPanel`. If a dock should remain as an empty placeholder
after its last panel is closed or moved away, create it with
`removeWhenEmpty:false`.

```js
aiditor.registerComponent('demo.toolbar.tabs', {
  category: 'toolbar',
  defaults: function () { return { props: {} } },
  factory: function (_, ctx) {
    const root = aiditor.ui.h('div', 'demo-toolbar-tabs')
    ctx.onCleanup(aiditor.effect(function () {
      const panels = ctx.dock.panels()
      const activeId = ctx.dock.activeId()
      root.textContent = panels.map(function (panel) {
        return panel.id === activeId ? '[' + panel.title + ']' : panel.title
      }).join(' ')
    }))
    return root
  },
})
```

## Anti-Patterns

- Registering the same component twice.
- Passing source code as a panel prop.
- Writing large app state into `ctx.panel.updateProps` on every animation frame.
- Using hidden DOM panels instead of AIditor's detached inactive panel model.
- Adding application shortcuts to framework source.

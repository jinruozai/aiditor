# Timeline

`aiditor.ui.timeline` is a controlled UI primitive for dense row-based views on
one horizontal numeric axis. It is useful for animation timelines, sequencers,
event tracks, schedulers, profilers, and other editors without defining any of
those domain models.

The primitive has two parts:

```text
createLayout()   pure geometry, ranges, coordinate conversion, hit testing
createSurface()  stable DOM/Canvas/scroll structure and input lifecycle
```

It does not own durable state. The host owns its model, renderer, selection,
commands, history, snapping, playback, validation, and persistence.

## Layout

```js
const layout = aiditor.ui.timeline.createLayout({
  rulerSize: 26,
  labelSize: 176,
  minLabelSize: 120,
  maxLabelSize: 420,
  minContentSize: 480,
  contentEndPadding: 80,
  defaultScale: 160,
  minScale: 24,
  maxScale: 800,
})
```

`layout.frame(input)` returns the current viewport geometry. The primary model
vocabulary is deliberately small:

```js
const model = {
  rangeEnd: 8,
  authoredEnd: 10,
  boundary: 8,
  rowHeight: 26,
  markers: [{ id: 'marker-1', value: 2 }],
  rows: [{
    id: 'row-1',
    kind: 'row',
    items: [{ id: 'item-1', value: 1.5 }],
  }],
}

const frame = layout.frame({
  model,
  width: 900,
  height: 320,
  scale: 120,
  scrollLeft: 0,
  scrollTop: 0,
})
```

Callers with another data shape provide accessors rather than adapting their
domain model into framework-owned objects:

```js
const accessors = {
  rows: model => model.lanes,
  rowHeight: model => model.laneHeight,
  rowKind: row => row.type,
  items: row => row.events,
  itemId: item => item.key,
  itemValue: item => item.position,
  markers: model => model.guides,
  markerValue: marker => marker.position,
  rangeEnd: model => model.visibleEnd,
  authoredEnd: model => model.contentEnd,
  boundary: model => model.limit,
}
```

The layout exposes coordinate conversion, visible row/value ranges, fit scale,
box-selection geometry, stable ordered item ranges, marker/item/boundary hit
testing, and tick-step calculation. Hit results use neutral zones such as
`ruler`, `label`, `timeline`, `item`, `marker`, `boundary`, and
`group-toggle`.

`aiditor.ui.timeline.defaults` is the frozen default configuration used by new
layout instances.

## Surface

```js
const surface = aiditor.ui.timeline.createSurface(root, { layout })

surface.bindInput({
  enabled: () => true,
  hasTransientInput: () => drag != null,
  onPointerDown(event) {},
  onPointerMove(event) {},
  onPointerUp(event) {},
  onDoubleClick(event) {},
  onZoom(input) {},
  onScroll(input) {},
  onCancel(input) {},
  onInterrupt(input) {},
})

surface.observeResize(() => resizeAndPaint())

function resizeAndPaint() {
  surface.resize({ model, accessors, scale })
  surface.requestPaint(frame => paint(surface.elements.canvas, frame, model))
}
```

The surface owns only:

- stable toolbar/body/header/footer/scroll/Canvas slots
- device-pixel Canvas sizing
- coalesced `requestAnimationFrame` paint scheduling
- pointer, wheel, scroll, blur, visibility, and Escape cancellation lifecycle
- pointer-capture helpers
- selection-box and boundary-handle presentation
- listener, observer, and pending-frame cleanup

`bindInput()` binds one controlled input adapter for the surface. It does not
register application shortcuts. Escape only cancels an interaction that the
host reports through `hasTransientInput()`.

`surface.elements` exposes stable slots so the host may compose controls and
paint its own Canvas. `classes` can replace the default slot classes without
changing the structure. The framework stylesheet supplies only neutral
structural styling; domain appearance remains host-owned.

Call `surface.dispose()` when the owning view is destroyed. The surface also
registers that cleanup on its root, so `aiditor.ui.dispose(root)` is sufficient.
Both paths are idempotent.

## Distribution

Timeline is editor UI. It is included in `aiditor-editor`, `aiditor-ui`,
`aiditor-core`, and `aiditor-full`. It is intentionally excluded from
`aiditor-mini`, `aiditor-theme`, `aiditor-kernel`, and the standalone AI add-on.

## Non-goals

The framework Timeline does not provide:

- animation, track, keyframe, clip, or curve semantics
- a painter or domain visual language
- selection or command registries
- application shortcuts
- snapping or transform policy
- playback, preview, undo, or persistence

Those remain responsibilities of the consuming editor.

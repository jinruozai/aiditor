// Dock-tabs — the framework-side thin shell around aiditor.ui.tab.
//
// Zero visual code. Zero DOM construction. Its entire job is:
//   1. Pick an aiditor.ui.tab variant from preset defaults
//   2. Wire ctx.dock.panels → items, ctx.dock.activeId → active
//   3. Forward click / close / add / drag callbacks to ctx.dock.*
//   4. Tag the root with `.aiditor-dock-tabs` so interactions.js can hit-test it
//
// Registered presets (§ 4.6 — one implementation, four configurations):
//   tab-standard    closeable; add button only with props.addPanel
//   tab-compact     no close, hides when < 2 panels        (properties)
//   tab-collapsible closeable + click-active collapses     (utility)
//   tab-sidebar     icon-only + collapsible                (rail style)
//
// All dock tab presets must be visible when panels.length > 1. Otherwise a
// dock can contain multiple panels with no built-in way to switch between them.
//
// A preset's `props` can override any of the hard-coded defaults on a
// per-toolbar-item basis — that's how a caller could, e.g., use the
// sidebar preset but force text mode with `props: { iconOnly: false }`,
// or force a direction with `props: { direction: 'vertical' }`.
;(function (aiditor) {
  'use strict'

  function buildDockTabs(p, ctx) {
    const dockDir = ctx.dock.toolbarDirection ? ctx.dock.toolbarDirection.peek() : null
    const autoDir = (dockDir === 'left' || dockDir === 'right') ? 'vertical' : 'horizontal'
    const addPanel = p.addPanel || null
    const el = aiditor.ui.tab({
      items:        ctx.dock.panels,     // derived signal<PanelData[]>
      active:       ctx.dock.activeId,   // derived signal<string|null>
      variant:      p.variant  || 'bar',
      direction:    p.direction || autoDir,
      iconOnly:     p.iconOnly,
      closable:     p.closable != null ? p.closable : true,
      addable:      !!(addPanel && addPanel.component),
      // Dock tabs are the only built-in way to switch active panels inside a
      // dock, so every dock tab preset must show when there is more than one
      // panel. Presets may still hide the single-panel case with minShowCount:2.
      minShowCount: Math.min(p.minShowCount || 0, 2),

      onActivate: function (id) {
        ctx.dock.activatePanel(id)
        if (p.collapsible && ctx.dock.canCollapse()) ctx.dock.setCollapsed(false)
      },
      onReactivate: function () {
        if (p.collapsible && ctx.dock.canCollapse()) {
          ctx.dock.setCollapsed(!ctx.dock.collapsed())
        }
      },
      onClose: function (id) {
        return ctx.dock.requestClosePanel(id, 'close')
      },
      onAdd: function () {
        if (!addPanel || !addPanel.component) return
        const defaults = aiditor.componentDefaults(addPanel.component)
        ctx.dock.addPanel(Object.assign({}, defaults, addPanel, { component: addPanel.component }))
      },
      onDragStart: function (ev, panelId) {
        const fn = aiditor._dock && aiditor._dock.beginPanelDrag
        if (fn) fn(ev, panelId, ctx.dock.id(), ctx._layout)
      },
    })
    el.classList.add('aiditor-dock-tabs')
    return el
  }

  // Preset-bound factory — props are static for the lifetime of the toolbar
  // item, so .peek() once at construction is sufficient.
  function preset(defaults) {
    return function (propsSig, ctx) {
      return buildDockTabs(Object.assign({}, defaults, propsSig.peek() || {}), ctx)
    }
  }

  aiditor.registerComponent('tab-standard', {
    palette: false,
    defaults: function () { return { title: 'Tabs' } },
    factory:  preset({ variant: 'bar', closable: true }),
  })

  aiditor.registerComponent('tab-compact', {
    palette: false,
    defaults: function () { return { title: 'Tabs' } },
    factory:  preset({ variant: 'compact', closable: false, minShowCount: 2 }),
  })

  aiditor.registerComponent('tab-collapsible', {
    palette: false,
    defaults: function () { return { title: 'Tabs' } },
    factory:  preset({ variant: 'bar', closable: true, collapsible: true }),
  })

  aiditor.registerComponent('tab-sidebar', {
    palette: false,
    defaults: function () { return { title: 'Tabs' } },
    factory:  preset({
      variant:     'sidebar',
      iconOnly:    true,
      closable:    false,
      collapsible: true,
    }),
  })
})(window.aiditor = window.aiditor || {})

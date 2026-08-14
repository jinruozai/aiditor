// aiditor.ui.popover — floating anchored panel.
//
// Thin shell over ui._overlay. Owns: portal mounting, anchor placement,
// inline content host. Delegates: dismissal, focus, ARIA, z-index.
//
// opts: { anchor, content, side?, align?, role?, onDismiss? }
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.popover = function (opts) {
    const o = opts || {}
    const el = ui.h('div', 'aiditor-ui-popover')
    if (o.content) {
      el.appendChild(o.content)
      ui.collect(el, function () { ui.dispose(o.content) })
    }

    const placeOpts = { side: o.side || 'bottom', align: o.align || 'start' }
    const ownerScope = ui.scopeOf(o.anchor)
    if (ownerScope) el.__aiditorUiScope = ownerScope
    const unmount = ui.portal(el)
    ui.place(o.anchor, el, placeOpts)

    let overlay = null
    let unregister = null
    function cleanup(cause) {
      if (unregister) { unregister(); unregister = null }
      if (cause !== 'dispose') ui.dispose(el)
      unmount()
      o.onDismiss && o.onDismiss(cause)
    }

    overlay = ui._overlay.open(el, {
      anchor:   o.anchor,
      role:     o.role || 'dialog',
      onDismiss: cleanup,
    })
    unregister = ui.registerScopedOverlay(o.anchor, function () { overlay.close() }, { scope: ownerScope })

    return { el: el, close: overlay.close }
  }
})(window.aiditor = window.aiditor || {})

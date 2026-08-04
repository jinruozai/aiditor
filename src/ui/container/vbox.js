// aiditor.ui.vbox / hbox - flex containers. Children stack vertically (vbox)
// or horizontally (hbox). Visual chrome (background / border / radius /
// padding) flows from the shared BOX_STYLE fragment so the same vocabulary
// applies to every component. Layout-y props (gap / align / justify /
// width / height) are flex-specific and stay local.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  function build(opts, direction) {
    const o = opts || {}
    const propsSig = ui.isSignal(o.value) ? o.value : aiditor.signal(o)
    const el = ui.h('div', 'aiditor-ui-' + direction)
    el.style.display = 'flex'
    el.style.flexDirection = direction === 'vbox' ? 'column' : 'row'
    aiditor.effect(function () {
      const p = propsSig() || {}
      el.style.gap            = p.gap != null ? p.gap + 'px' : ''
      el.style.alignItems     = p.align   || ''
      el.style.justifyContent = p.justify || ''
      el.style.width  = p.width  != null ? (typeof p.width  === 'number' ? p.width  + 'px' : p.width)  : ''
      el.style.height = p.height != null ? (typeof p.height === 'number' ? p.height + 'px' : p.height) : ''
    })
    ui.applyBoxStyle(el, propsSig)
    return el
  }

  ui.vbox = function (opts) { return build(opts, 'vbox') }
  ui.hbox = function (opts) { return build(opts, 'hbox') }
})(window.aiditor = window.aiditor || {})

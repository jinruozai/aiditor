// aiditor.ui.icon — icon primitive with optional SVG icon set.
//
// opts:
//   name  : string | signal<string>   lookup in the registered icon set
//   glyph : string | signal<string>   raw text glyph / emoji
//   size  : 'sm' | 'md' | 'lg' | signal
//
// Resolution order per render: if `name` resolves to a registered icon,
// render the SVG; otherwise if `glyph` is non-empty, render as text; else
// fall back to using `name` as text (useful for ad-hoc single chars).
//
// The framework ships a curated Lucide-subset icon set (see icon-set.js).
// Extend or override via `aiditor.ui.registerIcon(name, innerSvgMarkup)`. The
// SVG is constructed as:
//   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
//        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">…</svg>
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  const SVG_NS = 'http://www.w3.org/2000/svg'

  function buildSvg(inner) {
    // Parse the fragment via an off-DOM container so child tags resolve
    // in the SVG namespace. Cloning into a namespaced <svg> is simpler than
    // manual createElementNS for every supported tag (path/line/polyline/…).
    const tmp = document.createElementNS(SVG_NS, 'svg')
    tmp.setAttribute('viewBox', '0 0 24 24')
    tmp.setAttribute('fill', 'none')
    tmp.setAttribute('stroke', 'currentColor')
    tmp.setAttribute('stroke-width', '2')
    tmp.setAttribute('stroke-linecap', 'round')
    tmp.setAttribute('stroke-linejoin', 'round')
    tmp.setAttribute('aria-hidden', 'true')
    tmp.innerHTML = inner
    return tmp
  }

  ui.icon = function (opts) {
    const o = opts || {}
    const name  = ui.asSig(o.name  != null ? o.name  : '')
    const glyph = ui.asSig(o.glyph != null ? o.glyph : '')
    const size  = ui.asSig(o.size  != null ? o.size  : 'md')

    const el = ui.h('span', 'aiditor-ui-icon')
    ui.bindClass(el, size, 'aiditor-ui-icon-')

    let lastSig = null
    ui.bind(el, name, function () { paint() })
    ui.bind(el, glyph, function () { paint() })

    function paint() {
      const n = name()
      const g = glyph()
      const sig = n + '\x00' + g
      if (sig === lastSig) return
      lastSig = sig
      if (n && ui._hasIcon && ui._hasIcon(n)) {
        // SVG path
        while (el.firstChild) el.removeChild(el.firstChild)
        el.appendChild(buildSvg(ui._getIcon(n)))
        el.classList.add('aiditor-ui-icon-svg')
      } else if (g) {
        // Text glyph
        el.classList.remove('aiditor-ui-icon-svg')
        el.textContent = g
      } else if (n) {
        // Name provided but not registered: show it as text.
        el.classList.remove('aiditor-ui-icon-svg')
        el.textContent = n
      } else {
        el.classList.remove('aiditor-ui-icon-svg')
        el.textContent = ''
      }
    }
    return el
  }
})(window.aiditor = window.aiditor || {})

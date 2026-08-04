// Shared runtime helper for applying optional box chrome to UI primitives.
// Palette schema/default metadata lives in _register-builtins.js so direct
// aiditor.ui.* consumers do not carry editor-only registration data.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.applyBoxStyle = function (el, propsSig) {
    ui.collect(el, aiditor.effect(function () {
      const p = propsSig() || {}
      setStr(el, 'background',   p.background)
      const bw = Number(p.borderWidth)
      if (p.borderWidth === 0 || p.borderWidth === '0') {
        el.style.border = '0'
      } else if (p.borderWidth == null || p.borderWidth === '' || !isFinite(bw) || bw <= 0) {
        el.style.border = ''
        el.style.borderWidth = ''
        el.style.borderColor = ''
        el.style.borderStyle = ''
      } else {
        el.style.border = ''
        setPx (el, 'borderWidth',  bw)
        setStr(el, 'borderColor',  p.borderColor)
        // Fall back to 'solid' whenever a width is set but the user hasn't
        // picked a style — CSS treats border-style:none as "no border" so an
        // unset style would silently swallow width+color even if both were
        // provided.
        setStr(el, 'borderStyle',  p.borderStyle || 'solid')
      }
      setPx (el, 'borderRadius', p.borderRadius)
      setPx (el, 'padding',      p.padding)
      setNum(el, 'opacity',      p.opacity)
      // Compose box-shadow only when at least a color is supplied.
      // Empty color → no shadow regardless of x/y/blur (CSS would fall
      // back to currentColor, which is a confusing default for users).
      if (p.shadowColor) {
        el.style.boxShadow = (p.shadowX || 0) + 'px ' +
                             (p.shadowY || 0) + 'px ' +
                             (p.shadowBlur || 0) + 'px ' +
                             p.shadowColor
      } else {
        el.style.boxShadow = ''
      }
    }))
  }

  function setStr(el, prop, v) { el.style[prop] = (v == null || v === '') ? '' : v }
  function setPx (el, prop, v) {
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) el.style[prop] = ''
    else el.style[prop] = v + 'px'
  }
  function setNum(el, prop, v) { el.style[prop] = (v == null || v === '') ? '' : String(v) }

  // Shared with _text-style.js so the small primitives stay one definition.
  ui._styleSetters = { setStr: setStr, setPx: setPx, setNum: setNum }
})(window.aiditor = window.aiditor || {})

// UI library — CSS token reader.
//
// § "单一配置源" — all tunable numeric constants live as CSS custom properties
// in theme.css. This module is the one and only JS-side bridge to read them,
// used wherever JS must compare/compute on a raw number (drag threshold, z
// stack offset, setTimeout duration, ...). CSS-only consumption stays in CSS
// via `var()` / `calc(var())`; this helper is for the unavoidable JS paths.
//
// Why a single helper: before this existed, those numbers lived in parallel
// JS constants (DRAG_THRESHOLD, zIndex magic numbers, duration literals) that
// could drift from the CSS tokens a theme override would actually change. One
// reader = one judge of "what's the current value" for both layers.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // readNum(name, fallback, root?) — read a numeric CSS custom property from
  // the effective theme scope, defaulting to :root.
  // parseFloat handles the 'px' / 'ms' suffix transparently; unset variables
  // return an empty string, in which case we fall back. Intentionally always
  // reads at call time (no cache) so live theme edits take effect next time
  // the consumer samples — a one-time cost, called only at low-frequency
  // event boundaries, never in inner loops.
  ui.readNum = function (name, fallback, root) {
    const v = getComputedStyle(root || document.documentElement)
      .getPropertyValue(name).trim()
    return v ? parseFloat(v) : fallback
  }
})(window.aiditor = window.aiditor || {})

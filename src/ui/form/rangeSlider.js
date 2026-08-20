// aiditor.ui.rangeSlider — two-thumb slider for [min, max] ranges.
//
// opts: {
//   value: [number, number] | signal, onChange?,
//   min?: number|signal, max?: number|signal, step?: number|signal,
// }
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.rangeSlider = function (opts) {
    const o = opts || {}
    const sig   = ui.asSig(o.value != null ? o.value : [0, 1])
    const minS  = ui.asSig(o.min   != null ? o.min   : 0)
    const maxS  = ui.asSig(o.max   != null ? o.max   : 1)
    const stepS = ui.asSig(o.step  != null ? o.step  : 0)
    const doWrite = ui.writer(sig, o.onChange, 'ui.rangeSlider')

    const el = ui.h('div', 'aiditor-ui-slider aiditor-ui-slider-range')
    const track = ui.h('div', 'aiditor-ui-slider-track')
    const fill  = ui.h('div', 'aiditor-ui-slider-fill')
    const t1 = ui.h('div', 'aiditor-ui-slider-thumb')
    const t2 = ui.h('div', 'aiditor-ui-slider-thumb')
    track.appendChild(fill); track.appendChild(t1); track.appendChild(t2)
    el.appendChild(track)

    function step() { return stepS.peek() || ((maxS.peek() - minS.peek()) / 100) }
    function quantize(v) {
      const mn = minS.peek(), mx = maxS.peek(), s = step()
      v = Math.max(mn, Math.min(mx, v))
      if (s) v = Math.round((v - mn) / s) * s + mn
      return v
    }
    function pct(v) {
      const mn = minS.peek(), mx = maxS.peek()
      if (mx === mn) return 0
      return ((v - mn) / (mx - mn)) * 100
    }

    function repaint() {
      const v = sig.peek()
      const p1 = pct(v[0]), p2 = pct(v[1])
      fill.style.left  = p1 + '%'
      fill.style.right = (100 - p2) + '%'
      t1.style.left = p1 + '%'
      t2.style.left = p2 + '%'
    }
    ui.bind(el, sig,   repaint)
    ui.bind(el, minS,  repaint)
    ui.bind(el, maxS,  repaint)
    ui.bind(el, stepS, repaint)

    function fromEvent(e) {
      const r = track.getBoundingClientRect()
      return quantize(minS.peek() + ((e.clientX - r.left) / r.width) * (maxS.peek() - minS.peek()))
    }
    function attach(thumb, idx) {
      const gesture = ui.editGesture({ get: function () { return sig.peek() }, write: doWrite })
      let draft = null
      ui.attachDrag(thumb, {
        onStart: function (e) { e.stopPropagation(); draft = sig.peek().slice(); gesture.begin('range-slider'); update(e) },
        onMove:  update,
        onEnd: function () { gesture.commit(); draft = null },
        onCancel: function () { gesture.cancel(); draft = null },
      })
      function update(e) {
        const v = (draft || sig.peek()).slice()
        v[idx] = fromEvent(e)
        if (v[0] > v[1]) { const t = v[0]; v[0] = v[1]; v[1] = t }
        draft = v
        gesture.update(v)
      }
    }
    attach(t1, 0); attach(t2, 1)

    return el
  }
})(window.aiditor = window.aiditor || {})

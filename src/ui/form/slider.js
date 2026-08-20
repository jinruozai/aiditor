// aiditor.ui.slider — horizontal numeric slider with optional value bubble.
//
// opts: {
//   value: number|signal, onChange?,
//   min?: number|signal, max?: number|signal, step?: number|signal,
//   showValue?: boolean|signal, suffix?: string|signal,
// }
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.slider = function (opts) {
    const o = opts || {}
    const sig       = ui.asSig(o.value     != null ? o.value     : 0)
    const minS      = ui.asSig(o.min       != null ? o.min       : 0)
    const maxS      = ui.asSig(o.max       != null ? o.max       : 1)
    const stepS     = ui.asSig(o.step      != null ? o.step      : 0)
    const showValue = ui.asSig(o.showValue != null ? o.showValue : false)
    const suffix    = ui.asSig(o.suffix    != null ? o.suffix    : '')
    const doWrite = ui.writer(sig, o.onChange, 'ui.slider')
    const gesture = ui.editGesture({ get: function () { return sig.peek() }, write: doWrite })

    const el = ui.h('div', 'aiditor-ui-slider')
    const track = ui.h('div', 'aiditor-ui-slider-track')
    const fill  = ui.h('div', 'aiditor-ui-slider-fill')
    const thumb = ui.h('div', 'aiditor-ui-slider-thumb')
    const valueEl = ui.h('span', 'aiditor-ui-slider-value')
    track.appendChild(fill)
    track.appendChild(thumb)
    el.appendChild(track)
    el.appendChild(valueEl)

    function step()       { return stepS.peek() || ((maxS.peek() - minS.peek()) / 100) }
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

    // One effect collecting value + min/max/step + showValue/suffix so every
    // change repaints the geometry and label together.
    function repaint() {
      const v = sig.peek()
      const p = pct(v)
      fill.style.width = p + '%'
      thumb.style.left = p + '%'
      const show = !!showValue.peek()
      valueEl.style.display = show ? '' : 'none'
      if (show) {
        const s = step()
        valueEl.textContent = Number(v).toFixed(s && s < 1 ? 2 : 0) + (suffix.peek() || '')
      }
    }
    ui.bind(el, sig,       repaint)
    ui.bind(el, minS,      repaint)
    ui.bind(el, maxS,      repaint)
    ui.bind(el, stepS,     repaint)
    ui.bind(el, showValue, repaint)
    ui.bind(el, suffix,    repaint)

    function fromEvent(e) {
      const r = track.getBoundingClientRect()
      const t = (e.clientX - r.left) / r.width
      return quantize(minS.peek() + t * (maxS.peek() - minS.peek()))
    }
    ui.attachDrag(track, {
      onStart: function (e) { gesture.begin('slider'); gesture.update(fromEvent(e)) },
      onMove:  function (e) { gesture.update(fromEvent(e)) },
      onEnd: gesture.commit,
      onCancel: gesture.cancel,
    })

    return el
  }
})(window.aiditor = window.aiditor || {})

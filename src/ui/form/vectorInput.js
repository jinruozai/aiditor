// aiditor.ui.vectorInput — XYZ / XY / XYZW number input (Blender vector).
//
// Each axis is a numberInput. Channels share one signal holding a
// number[]. Optional `linked` toggle keeps all axes proportional.
//
// opts:
//   value    : signal<number[]>     required
//   onChange?: (v) => void
//   labels   : string[]             default ['X','Y','Z','W'].slice(0, length)
//   layout   : 'row'|'column'       default 'column'
//   step?, precision?
//   linked   : signal<boolean>      optional toggle for proportional editing
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.vectorInput = function (opts) {
    const o = opts || {}
    const sig = ui.asSig(o.value != null ? o.value : [0, 0, 0])
    const doWrite = ui.writer(sig, o.onChange, 'ui.vectorInput')
    const init = sig.peek()
    const n = init.length
    const labels = o.labels || ['X', 'Y', 'Z', 'W'].slice(0, n)
    const layout = ui.asSig(o.layout || 'column')
    const linked = o.linked

    const wrap = ui.h('div', 'aiditor-ui-vec aiditor-ui-vec-' + n)
    ui.bindClass(wrap, layout, 'aiditor-ui-vec-')

    // Per-channel signals. Two effects per channel form a sync bridge with
    // a `writing` flag to break feedback loops.
    for (let i = 0; i < n; i++) {
      const idx = i
      const cs = aiditor.signal(init[idx])
      let writing = false

      // parent → channel
      const stop1 = aiditor.effect(function () {
        const arr = sig()
        if (cs.peek() !== arr[idx]) { writing = true; cs.set(arr[idx]); writing = false }
      })
      // channel → parent
      const stop2 = aiditor.effect(function () {
        const v = cs()
        if (writing) return
        const cur = sig.peek()
        if (cur[idx] === v && (!linked || !linked.peek())) return
        const next = cur.slice()
        if (linked && linked.peek()) {
          const old = cur[idx] || 1
          const ratio = old !== 0 ? v / old : 1
          for (let j = 0; j < next.length; j++) next[j] = j === idx ? v : next[j] * ratio
        } else {
          next[idx] = v
        }
        doWrite(next)
      })
      ui.collect(wrap, stop1)
      ui.collect(wrap, stop2)

      const axis = ui.numberInput({
        value: cs, label: labels[idx], step: o.step, precision: o.precision,
      })
      axis.classList.add('aiditor-ui-vec-axis-field')
      wrap.appendChild(axis)
    }
    return wrap
  }
})(window.aiditor = window.aiditor || {})

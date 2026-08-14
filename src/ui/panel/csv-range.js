// CSV range adapter: clamp only the slider geometry, never the stored raw value.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv

  function render(options) {
    const field = options.field
    const agv = field.type_agv || {}
    const min = agv.min != null ? Number(agv.min) : 0
    const max = agv.max != null ? Number(agv.max) : 100
    const step = agv.step != null ? Number(agv.step) : field.base_type === 'int' ? 1 : 0.01
    const view = aiditor.derived(function () {
      const value = Number(options.value())
      if (!Number.isFinite(value)) return min
      return Math.max(min, Math.min(max, value))
    })
    const root = ui.h('span', 'aiditor-csv-range')
    const slider = ui.slider({
      value: view,
      min: min,
      max: max,
      step: step,
      showValue: false,
      onChange: function (value) { options.write(field.base_type === 'int' ? Math.trunc(value) : value) },
    })
    const label = ui.h('span', 'aiditor-csv-range-value')
    root.appendChild(slider)
    root.appendChild(label)
    ui.collect(root, function () { ui.dispose(slider) })
    if (options.raw) ui.bind(root, options.raw, function (value) { label.textContent = value == null ? '' : String(value) })
    else ui.bind(root, options.value, function (value) { label.textContent = value == null ? '' : String(value) })
    ui.collect(root, view.dispose)
    return root
  }

  csv.range = { render: render }
})(window.aiditor = window.aiditor || {})

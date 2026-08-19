// CSV numeric adapter preserving invalid numeric lexemes while keeping scrub controls.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv

  function decimalPlaces(raw) {
    const match = String(raw == null ? '' : raw).match(/\.(\d+)(?:e[+-]?\d+)?$/i)
    return match ? Math.min(9, match[1].length) : 0
  }

  function render(options) {
    const root = ui.h('span', 'aiditor-csv-number')

    function rebuild() {
      const numeric = Number(options.value.peek())
      if (!Number.isFinite(numeric)) {
        const input = ui.input({ value: options.value, onChange: options.write, type: 'text' })
        root.appendChild(input)
        ui.collect(root, function () { ui.dispose(input) })
        return
      }
      const value = aiditor.derived(function () {
        const next = Number(options.value())
        return Number.isFinite(next) ? next : 0
      })
      const agv = options.field.type_agv || {}
      const integer = options.field.type_render === 'input_int'
      const precision = integer && options.raw
        ? aiditor.derived(function () { return decimalPlaces(options.raw()) })
        : agv.decimal_places
      const input = ui.numberInput({
        value: value,
        onChange: options.write,
        step: agv.step != null ? agv.step : integer ? 1 : 0.01,
        precision: precision,
        radix: integer ? agv.radix || 'dec' : 'dec',
        percent: !integer && !!agv.percent,
      })
      root.appendChild(input)
      ui.collect(root, function () { ui.dispose(input) })
      ui.collect(input, value.dispose)
      if (precision && precision.dispose) ui.collect(input, precision.dispose)
    }

    rebuild()
    return root
  }

  csv.number = { render: render }
})(window.aiditor = window.aiditor || {})

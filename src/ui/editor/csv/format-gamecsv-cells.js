// GameCSV rich-cell renderer adapter. Extends the gamecsv format with
// renderCellEditor after registration, keeping format-gamecsv.js a pure
// text-conversion module (no UI / drag dependencies).
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv

  function renderCellEditor(resolved, adapter, ctx) {
    if (resolved.type_render === 'id' || resolved.type_render === 'ref_id') {
      return csv.references.render(Object.assign({}, adapter, {
        document: function () { return ctx.document.peek() },
        format: format,
        workspace: ctx.workspace,
        descriptor: ctx.descriptor,
        writeDropped: ctx.writeDropped,
      }))
    }
    if (resolved.type_render === 'img' || resolved.type_render === 'snd') {
      const kind = resolved.type_render
      return csv.media.render(kind, Object.assign({}, adapter, {
        workspace: ctx.workspace,
        descriptor: ctx.descriptor,
        attachSource: function (el) {
          const stop = function (event) { event.stopPropagation() }
          el.addEventListener('pointerdown', stop)
          ui.collect(el, function () { el.removeEventListener('pointerdown', stop) })
          csv.drag.source(el, ctx.descriptor)
        },
        attachTarget: function (el) {
          csv.drag.target(el, kind, ctx.writeDropped)
        },
      }))
    }
    if (resolved.type_render === 'enum') return csv.enum.render(adapter)
    if (resolved.type_render === 'range') return csv.range.render(adapter)
    if (resolved.type_render === 'input_int' || resolved.type_render === 'input_float') return csv.number.render(adapter)
    return undefined
  }

  csv.formats.extend('gamecsv', { renderCellEditor: renderCellEditor })
  const format = csv.formats.resolve('gamecsv')
})(window.aiditor = window.aiditor || {})

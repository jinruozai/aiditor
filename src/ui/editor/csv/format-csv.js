// Standard CSV: literal header names and literal string cell values.
;(function (aiditor) {
  'use strict'
  const csv = aiditor.ui.csv

  csv.formats.register({
    id: 'csv',
    label: 'CSV',
    supportsColumnSchema: false,
    parseColumn: function (text) {
      return { name: String(text == null ? '' : text), fieldDef: { type: 'var' } }
    },
    stringifyColumn: function (column) { return String(column.name || '') },
    decodeCell: function (raw) {
      raw = String(raw == null ? '' : raw)
      return { value: raw === '' ? null : raw, error: null }
    },
    encodeCell: function (value) { return value == null ? '' : String(value) },
  })
})(window.aiditor = window.aiditor || {})

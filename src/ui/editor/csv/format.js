// CSV file-format registry. A format owns only column and cell text conversion.
;(function (aiditor) {
  'use strict'
  const csv = aiditor.ui.csv
  const formats = new Map()

  function register(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id) throw new Error('csv format: id is required')
    if (formats.has(spec.id)) throw new Error('csv format already registered: ' + spec.id)
    formats.set(spec.id, Object.freeze(spec))
  }

  function resolve(id) {
    const format = formats.get(String(id || 'csv'))
    if (!format) throw new Error('csv format not found: ' + id)
    return format
  }

  function extend(id, patch) {
    const format = resolve(id)
    formats.set(id, Object.freeze(Object.assign({}, format, patch)))
  }

  csv.formats = {
    register: register,
    resolve: resolve,
    extend: extend,
    ids: function () { return Array.from(formats.keys()) },
  }
})(window.aiditor = window.aiditor || {})

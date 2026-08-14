// GameCSV-local id/ref_id index and cell projection.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv
  const indexes = new WeakMap()

  function buildIndex(doc, format) {
    let idColumn = -1
    let displayColumn = -1
    for (let i = 0; i < doc.columns.length; i++) {
      const field = format.resolveField(doc.columns[i].fieldDef)
      if (field.type_render !== 'id') continue
      idColumn = i
      const displayName = field.type_agv && field.type_agv.ref_column
      if (displayName) displayColumn = doc.columns.findIndex(function (column) { return column.name === displayName })
      break
    }
    const values = new Map()
    if (idColumn >= 0) doc.rows.forEach(function (row, rowIndex) {
      const raw = row.rawValues[idColumn]
      if (raw === '') return
      if (!values.has(String(raw))) values.set(String(raw), {
        rowId: row.id,
        rowIndex: rowIndex,
        displayRaw: displayColumn >= 0 ? row.rawValues[displayColumn] : raw,
        displayValue: displayColumn >= 0 ? row.values[displayColumn] : row.values[idColumn],
        displayFieldDef: displayColumn >= 0 ? doc.columns[displayColumn].fieldDef : doc.columns[idColumn].fieldDef,
      })
    })
    return { idColumn: idColumn, displayColumn: displayColumn, values: values }
  }

  function indexFor(doc, format) {
    let index = indexes.get(doc)
    if (!index) { index = buildIndex(doc, format); indexes.set(doc, index) }
    return index
  }

  function resolve(doc, format, value) {
    if (!doc) return null
    return indexFor(doc, format).values.get(String(value == null ? '' : value)) || null
  }

  function render(options) {
    const kind = options.field.type_render
    const root = ui.h('span', 'aiditor-csv-reference')
    root.dataset.kind = kind
    const icon = ui.icon({ name: kind === 'id' ? 'hash' : 'link', size: 'sm' })
    const imageSig = aiditor.signal('')
    const preview = csv.media.imagePreview(imageSig, options.workspace)
    const label = ui.h('span', 'aiditor-csv-reference-label')
    root.appendChild(icon)
    root.appendChild(preview)
    root.appendChild(label)
    ui.collect(root, function () { ui.dispose(icon); ui.dispose(preview) })

    function raw() { return String(options.getRaw()) }
    function descriptor() {
      return Object.assign(options.descriptor(), { raw: raw(), render: kind })
    }
    csv.drag.source(root, descriptor)
    root.addEventListener('pointerdown', function (event) { event.stopPropagation() })

    if (kind === 'ref_id') csv.drag.target(root, kind, function (dropped) { options.writeDropped(dropped) })

    ui.collect(root, aiditor.effect(function () {
      const value = options.value()
      const rawValue = raw()
      if (kind === 'id') {
        root.classList.remove('aiditor-csv-reference-missing')
        preview.style.display = 'none'
        label.textContent = rawValue
        root.title = rawValue
        return
      }
      const target = resolve(options.document(), options.format, value == null ? rawValue : value)
      root.classList.toggle('aiditor-csv-reference-missing', !target && !!rawValue)
      if (!target) {
        preview.style.display = 'none'
        imageSig.set('')
        label.textContent = rawValue
        root.title = rawValue ? 'Reference not found: ' + rawValue : ''
        return
      }
      const displayField = options.format.resolveField(target.displayFieldDef)
      const image = displayField.type_render === 'img'
      preview.style.display = image ? '' : 'none'
      imageSig.set(image ? target.displayValue : '')
      label.textContent = target.displayRaw || rawValue
      root.title = rawValue + (target.displayRaw && target.displayRaw !== rawValue ? ' · ' + target.displayRaw : '')
    }))
    return root
  }

  csv.references = { resolve: resolve, render: render }
})(window.aiditor = window.aiditor || {})

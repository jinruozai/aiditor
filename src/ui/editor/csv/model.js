// Immutable, typed, single-table CSV document shared by every csv-editor view.
;(function (aiditor) {
  'use strict'
  const csv = aiditor.ui.csv
  const codec = csv.codec
  const diagnosticIndexes = new WeakMap()

  function formatFor(doc) { return csv.formats.resolve(doc.formatId) }

  function valueEqual(a, b) {
    if (Object.is(a, b)) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    return JSON.stringify(a) === JSON.stringify(b)
  }

  function createColumn(index, data) {
    const source = data || {}
    return Object.assign({}, source, {
      id: source.id || 'c' + (index + 1),
      name: source.name != null ? String(source.name) : 'Column ' + (index + 1),
      fieldDef: Object.assign({ type: 'var' }, source.fieldDef || {}),
    })
  }

  function diagnosticsFor(doc) {
    let index = diagnosticIndexes.get(doc)
    if (index) return index
    index = new Map()
    doc.diagnostics.forEach(function (diagnostic) {
      index.set(diagnostic.rowId + '\u0000' + diagnostic.columnId, diagnostic)
    })
    diagnosticIndexes.set(doc, index)
    return index
  }

  function diagnosticMap(doc) {
    const out = new Map()
    diagnosticsFor(doc).forEach(function (diagnostic, key) { out.set(key, diagnostic) })
    return out
  }

  function updateDiagnostic(map, rowId, columnId, error) {
    const key = rowId + '\u0000' + columnId
    if (error) map.set(key, { rowId: rowId, columnId: columnId, message: error })
    else map.delete(key)
  }

  function decodeRow(format, rowId, rawValues, columns, diagnostics) {
    const values = []
    for (let column = 0; column < columns.length; column++) {
      const raw = rawValues[column] == null ? '' : String(rawValues[column])
      rawValues[column] = raw
      const decoded = format.decodeCell(raw, columns[column].fieldDef)
      values.push(decoded.value)
      updateDiagnostic(diagnostics, rowId, columns[column].id, decoded.error)
    }
    return { id: rowId, values: values, rawValues: rawValues }
  }

  function create(options) {
    const source = options || {}
    const formatId = String(source.formatId || 'csv')
    const format = csv.formats.resolve(formatId)
    const columns = (source.columns && source.columns.length ? source.columns : [{}]).map(createColumn)
    const diagnostics = new Map()
    const rows = (source.rows || []).map(function (row, index) {
      const rowId = row && row.id || 'r' + (index + 1)
      const values = row && row.values || (Array.isArray(row) ? row : [])
      const rawValues = row && row.rawValues
        ? row.rawValues.slice(0, columns.length)
        : columns.map(function (column, columnIndex) { return format.encodeCell(values[columnIndex], column.fieldDef) })
      while (rawValues.length < columns.length) rawValues.push('')
      return decodeRow(format, rowId, rawValues, columns, diagnostics)
    })
    return {
      formatId: formatId,
      columns: columns,
      rows: rows,
      textFormat: Object.assign({ bom: false, newline: '\n', finalNewline: false }, source.textFormat || {}),
      diagnostics: Array.from(diagnostics.values()),
      nextColumnId: columns.length + 1,
      nextRowId: rows.length + 1,
      version: 0,
    }
  }

  function parse(text, formatId, hostColumns) {
    const format = csv.formats.resolve(formatId || 'csv')
    const parsed = codec.parseRows(text)
    const sourceRows = parsed.rows
    const header = sourceRows.length ? sourceRows[0] : []
    let width = header.length
    for (let row = 1; row < sourceRows.length; row++) width = Math.max(width, sourceRows[row].length)
    width = Math.max(1, width)

    const hostByName = new Map((hostColumns || []).map(function (column) { return [String(column.name), column] }))
    const columns = []
    for (let column = 0; column < width; column++) {
      const parsedColumn = column < header.length
        ? format.parseColumn(header[column], column)
        : { name: 'Column ' + (column + 1), fieldDef: { type: 'var' } }
      const hostColumn = hostByName.get(String(parsedColumn.name))
      columns.push(createColumn(column, hostColumn
        ? Object.assign({}, parsedColumn, hostColumn, { name: parsedColumn.name, fieldDef: hostColumn.fieldDef })
        : parsedColumn))
    }

    const diagnostics = new Map()
    const rows = []
    for (let row = 1; row < sourceRows.length; row++) {
      const rawValues = sourceRows[row].slice(0, width)
      while (rawValues.length < width) rawValues.push('')
      rows.push(decodeRow(format, 'r' + row, rawValues, columns, diagnostics))
    }
    return {
      formatId: format.id,
      columns: columns,
      rows: rows,
      textFormat: parsed.textFormat,
      diagnostics: Array.from(diagnostics.values()),
      nextColumnId: columns.length + 1,
      nextRowId: rows.length + 1,
      version: 0,
    }
  }

  function stringify(doc) {
    const format = formatFor(doc)
    const rows = [doc.columns.map(format.stringifyColumn)]
    doc.rows.forEach(function (row) { rows.push(row.rawValues.slice()) })
    return codec.stringifyRows(rows, doc.textFormat)
  }

  function next(doc, fields) {
    return Object.assign({}, doc, fields, { version: doc.version + 1 })
  }

  function getCell(doc, row, column) {
    const item = doc.rows[row]
    return item ? item.values[column] : null
  }

  function displayCell(doc, row, column) {
    const item = doc.rows[row]
    return item ? item.rawValues[column] || '' : ''
  }

  function displayValue(_doc, row, _column, columnIndex) {
    return row && row.rawValues[columnIndex] || ''
  }

  function diagnosticAt(doc, row, column) {
    const rowValue = doc.rows[row]
    const columnValue = doc.columns[column]
    return rowValue && columnValue ? diagnosticFor(doc, rowValue, columnValue) : null
  }

  function diagnosticFor(doc, row, column) {
    return diagnosticsFor(doc).get(row.id + '\u0000' + column.id) || null
  }

  function replaceCell(doc, rowIndex, columnIndex, raw) {
    if (rowIndex < 0 || rowIndex >= doc.rows.length || columnIndex < 0 || columnIndex >= doc.columns.length) return doc
    raw = String(raw == null ? '' : raw)
    const format = formatFor(doc)
    const row = doc.rows[rowIndex]
    const column = doc.columns[columnIndex]
    const decoded = format.decodeCell(raw, column.fieldDef)
    const before = diagnosticAt(doc, rowIndex, columnIndex)
    if (row.rawValues[columnIndex] === raw && valueEqual(row.values[columnIndex], decoded.value) &&
        (!before && !decoded.error || before && before.message === decoded.error)) return doc
    const values = row.values.slice()
    const rawValues = row.rawValues.slice()
    values[columnIndex] = decoded.value
    rawValues[columnIndex] = raw
    const rows = doc.rows.slice()
    rows[rowIndex] = { id: row.id, values: values, rawValues: rawValues }
    const diagnostics = diagnosticMap(doc)
    updateDiagnostic(diagnostics, row.id, column.id, decoded.error)
    return next(doc, { rows: rows, diagnostics: Array.from(diagnostics.values()) })
  }

  function setValue(doc, row, column, value) {
    if (column < 0 || column >= doc.columns.length) return doc
    return replaceCell(doc, row, column, formatFor(doc).encodeCell(value, doc.columns[column].fieldDef))
  }

  function setCell(doc, row, column, raw) { return replaceCell(doc, row, column, raw) }

  function setMatrix(doc, row, column, matrix) {
    let result = doc
    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset++) {
      for (let columnOffset = 0; columnOffset < matrix[rowOffset].length; columnOffset++) {
        result = replaceCell(result, row + rowOffset, column + columnOffset, matrix[rowOffset][columnOffset])
      }
    }
    return result
  }

  function insertRows(doc, index, count) {
    index = Math.max(0, Math.min(doc.rows.length, Math.floor(Number(index))))
    count = Math.max(1, Math.floor(Number(count) || 1))
    const rows = doc.rows.slice()
    let nextRowId = doc.nextRowId
    const added = []
    for (let offset = 0; offset < count; offset++) {
      added.push({
        id: 'r' + nextRowId++,
        values: doc.columns.map(function () { return null }),
        rawValues: doc.columns.map(function () { return '' }),
      })
    }
    rows.splice.apply(rows, [index, 0].concat(added))
    return next(doc, { rows: rows, nextRowId: nextRowId })
  }

  function deleteRows(doc, start, count) {
    start = Math.max(0, Math.floor(Number(start) || 0))
    count = Math.max(1, Math.floor(Number(count) || 1))
    if (start >= doc.rows.length) return doc
    const rows = doc.rows.slice()
    const removed = new Set(rows.splice(start, count).map(function (row) { return row.id }))
    return next(doc, {
      rows: rows,
      diagnostics: doc.diagnostics.filter(function (diagnostic) { return !removed.has(diagnostic.rowId) }),
    })
  }

  function moveRow(doc, from, to) {
    if (from === to || from < 0 || from >= doc.rows.length || to < 0 || to >= doc.rows.length) return doc
    const rows = doc.rows.slice()
    rows.splice(to, 0, rows.splice(from, 1)[0])
    return next(doc, { rows: rows })
  }

  function insertColumns(doc, index, count, source) {
    index = Math.max(0, Math.min(doc.columns.length, Math.floor(Number(index))))
    count = Math.max(1, Math.floor(Number(count) || 1))
    const columns = doc.columns.slice()
    let nextColumnId = doc.nextColumnId
    const added = []
    for (let offset = 0; offset < count; offset++) {
      const id = nextColumnId++
      added.push(createColumn(index + offset, Object.assign({}, source || {}, {
        id: 'c' + id,
        name: source && source.name || 'Column ' + id,
      })))
    }
    columns.splice.apply(columns, [index, 0].concat(added))
    const rows = doc.rows.map(function (row) {
      const values = row.values.slice()
      const rawValues = row.rawValues.slice()
      values.splice.apply(values, [index, 0].concat(new Array(count).fill(null)))
      rawValues.splice.apply(rawValues, [index, 0].concat(new Array(count).fill('')))
      return { id: row.id, values: values, rawValues: rawValues }
    })
    return next(doc, { columns: columns, rows: rows, nextColumnId: nextColumnId })
  }

  function insertColumn(doc, index, source) { return insertColumns(doc, index, 1, source) }

  function deleteColumns(doc, start, count) {
    start = Math.max(0, Math.floor(Number(start) || 0))
    count = Math.max(1, Math.floor(Number(count) || 1))
    if (start >= doc.columns.length || doc.columns.length === 1) return doc
    count = Math.min(count, doc.columns.length - 1)
    const columns = doc.columns.slice()
    const removed = new Set(columns.splice(start, count).map(function (column) { return column.id }))
    const rows = doc.rows.map(function (row) {
      const values = row.values.slice()
      const rawValues = row.rawValues.slice()
      values.splice(start, count)
      rawValues.splice(start, count)
      return { id: row.id, values: values, rawValues: rawValues }
    })
    return next(doc, {
      columns: columns,
      rows: rows,
      diagnostics: doc.diagnostics.filter(function (diagnostic) { return !removed.has(diagnostic.columnId) }),
    })
  }

  function moveColumn(doc, from, to) {
    if (from === to || from < 0 || from >= doc.columns.length || to < 0 || to >= doc.columns.length) return doc
    const columns = doc.columns.slice()
    columns.splice(to, 0, columns.splice(from, 1)[0])
    const rows = doc.rows.map(function (row) {
      const values = row.values.slice()
      const rawValues = row.rawValues.slice()
      values.splice(to, 0, values.splice(from, 1)[0])
      rawValues.splice(to, 0, rawValues.splice(from, 1)[0])
      return { id: row.id, values: values, rawValues: rawValues }
    })
    return next(doc, { columns: columns, rows: rows })
  }

  function updateColumn(doc, index, patch) {
    if (index < 0 || index >= doc.columns.length) return doc
    const before = doc.columns[index]
    const after = Object.assign({}, before, patch || {})
    if (patch && patch.fieldDef) after.fieldDef = Object.assign({}, patch.fieldDef)
    const columns = doc.columns.slice()
    columns[index] = after
    let rows = doc.rows
    let diagnostics = doc.diagnostics
    if (after.fieldDef !== before.fieldDef) {
      const format = formatFor(doc)
      const nextDiagnostics = diagnosticMap(doc)
      rows = doc.rows.map(function (row) {
        const values = row.values.slice()
        const decoded = format.decodeCell(row.rawValues[index], after.fieldDef)
        values[index] = decoded.value
        updateDiagnostic(nextDiagnostics, row.id, before.id, decoded.error)
        return { id: row.id, values: values, rawValues: row.rawValues }
      })
      diagnostics = Array.from(nextDiagnostics.values())
    }
    return next(doc, { columns: columns, rows: rows, diagnostics: diagnostics })
  }

  function resizeColumn(doc, index, width) {
    return updateColumn(doc, index, { width: Math.round(Number(width)) })
  }

  function fill(doc, source, target) {
    const sourceTop = Math.min(source.anchor.row, source.focus.row)
    const sourceBottom = Math.max(source.anchor.row, source.focus.row)
    const sourceLeft = Math.min(source.anchor.column, source.focus.column)
    const sourceRight = Math.max(source.anchor.column, source.focus.column)
    const targetTop = Math.min(target.anchor.row, target.focus.row)
    const targetBottom = Math.max(target.anchor.row, target.focus.row)
    const targetLeft = Math.min(target.anchor.column, target.focus.column)
    const targetRight = Math.max(target.anchor.column, target.focus.column)
    let result = doc

    function sequence(values, raws, offset, backward) {
      const numbers = values.map(Number)
      const numeric = values.length && values.every(function (value, index) {
        return value !== '' && value != null && Number.isFinite(numbers[index])
      })
      if (numeric) {
        const step = values.length === 1 ? 1 : numbers[1] - numbers[0]
        const arithmetic = values.length < 3 || numbers.every(function (value, index) {
          return index === 0 || Math.abs((value - numbers[index - 1]) - step) < 0.0001
        })
        if (arithmetic) {
          const value = backward
            ? numbers[0] - step * (offset + 1)
            : numbers[numbers.length - 1] + step * (offset + 1)
          return { value: value, raw: null }
        }
      }
      const index = backward ? values.length - 1 - offset % values.length : offset % values.length
      return { value: values[index], raw: raws[index] }
    }

    const vertical = targetBottom - targetTop > sourceBottom - sourceTop
    for (let row = targetTop; row <= targetBottom; row++) {
      for (let column = targetLeft; column <= targetRight; column++) {
        if (row >= sourceTop && row <= sourceBottom && column >= sourceLeft && column <= sourceRight) continue
        let value
        if (vertical) {
          const sourceColumn = sourceLeft + (column - targetLeft) % (sourceRight - sourceLeft + 1)
          const values = []
          const raws = []
          for (let sourceRow = sourceTop; sourceRow <= sourceBottom; sourceRow++) {
            values.push(getCell(doc, sourceRow, sourceColumn)); raws.push(displayCell(doc, sourceRow, sourceColumn))
          }
          value = sequence(values, raws, row < sourceTop ? sourceTop - row - 1 : row - sourceBottom - 1, row < sourceTop)
        } else {
          const sourceRow = sourceTop + (row - targetTop) % (sourceBottom - sourceTop + 1)
          const values = []
          const raws = []
          for (let sourceColumn = sourceLeft; sourceColumn <= sourceRight; sourceColumn++) {
            values.push(getCell(doc, sourceRow, sourceColumn)); raws.push(displayCell(doc, sourceRow, sourceColumn))
          }
          value = sequence(values, raws, column < sourceLeft ? sourceLeft - column - 1 : column - sourceRight - 1, column < sourceLeft)
        }
        result = value.raw == null ? setValue(result, row, column, value.value) : setCell(result, row, column, value.raw)
      }
    }
    return result
  }

  csv.model = {
    create: create,
    parse: parse,
    stringify: stringify,
    getCell: getCell,
    displayCell: displayCell,
    displayValue: displayValue,
    diagnosticAt: diagnosticAt,
    diagnosticFor: diagnosticFor,
    setValue: setValue,
    setCell: setCell,
    setMatrix: setMatrix,
    insertRows: insertRows,
    deleteRows: deleteRows,
    moveRow: moveRow,
    insertColumn: insertColumn,
    insertColumns: insertColumns,
    deleteColumns: deleteColumns,
    moveColumn: moveColumn,
    updateColumn: updateColumn,
    resizeColumn: resizeColumn,
    fill: fill,
  }
})(window.aiditor = window.aiditor || {})

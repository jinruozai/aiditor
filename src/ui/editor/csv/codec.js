// RFC-style CSV row grammar. File-format semantics live in csv/format-*.js.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}
  const csv = ui.csv = ui.csv || {}

  function parseRows(source) {
    let text = String(source == null ? '' : source)
    const bom = text.charCodeAt(0) === 0xfeff
    if (bom) text = text.slice(1)

    const rows = []
    let row = []
    let field = ''
    let quoted = false
    let afterQuote = false
    let newline = null
    let endedWithNewline = false

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (quoted) {
        if (ch !== '"') { field += ch; continue }
        if (text[i + 1] === '"') { field += '"'; i++; continue }
        quoted = false
        afterQuote = true
        continue
      }
      if (afterQuote) {
        if (ch === ',') {
          row.push(field); field = ''; afterQuote = false; endedWithNewline = false
          continue
        }
        if (ch === '\n' || ch === '\r') {
          const separator = ch === '\r' && text[i + 1] === '\n' ? '\r\n' : ch
          if (separator === '\r\n') i++
          if (!newline) newline = separator
          row.push(field); rows.push(row)
          row = []; field = ''; afterQuote = false; endedWithNewline = true
          continue
        }
        throw new Error('csv.parse: unexpected character after closing quote at offset ' + i)
      }
      if (ch === '"' && field.length === 0) {
        quoted = true
        endedWithNewline = false
      } else if (ch === ',') {
        row.push(field); field = ''; endedWithNewline = false
      } else if (ch === '\n' || ch === '\r') {
        const separator = ch === '\r' && text[i + 1] === '\n' ? '\r\n' : ch
        if (separator === '\r\n') i++
        if (!newline) newline = separator
        row.push(field); rows.push(row)
        row = []; field = ''; endedWithNewline = true
      } else {
        field += ch
        endedWithNewline = false
      }
    }
    if (quoted) throw new Error('csv.parse: unclosed quoted field')
    if (!endedWithNewline && (field.length || row.length || text.length)) {
      row.push(field)
      rows.push(row)
    }
    return {
      rows: rows,
      textFormat: { bom: bom, newline: newline || '\n', finalNewline: endedWithNewline },
    }
  }

  function quoteCell(value) {
    const text = String(value == null ? '' : value)
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
  }

  function stringifyRows(rows, textFormat) {
    const format = textFormat || {}
    const newline = format.newline === '\r\n' || format.newline === '\r' ? format.newline : '\n'
    let text = (rows || []).map(function (row) {
      return (row || []).map(quoteCell).join(',')
    }).join(newline)
    if (format.finalNewline && rows && rows.length) text += newline
    if (format.bom) text = '\ufeff' + text
    return text
  }

  csv.codec = {
    parseRows: parseRows,
    stringifyRows: stringifyRows,
  }
})(window.aiditor = window.aiditor || {})

// aiditor.ui.dataGrid - controlled spreadsheet interaction surface.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  function point(row, column) { return { row: row, column: column } }

  function bounds(selection) {
    if (!selection) return null
    return {
      top: Math.min(selection.anchor.row, selection.focus.row),
      bottom: Math.max(selection.anchor.row, selection.focus.row),
      left: Math.min(selection.anchor.column, selection.focus.column),
      right: Math.max(selection.anchor.column, selection.focus.column),
    }
  }

  function selection(kind, anchor, focus) {
    return { kind: kind, anchor: anchor, focus: focus }
  }

  function sameSelection(a, b) {
    return a === b || !!a && !!b && a.kind === b.kind &&
      a.anchor.row === b.anchor.row && a.anchor.column === b.anchor.column &&
      a.focus.row === b.focus.row && a.focus.column === b.focus.column
  }

  function clipboardRows(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    return lines.map(function (line) { return line.split('\t') })
  }

  /**
   * @aiditorApi aiditor.ui.dataGrid
   * @group ui
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.ui.dataGrid(opts)
   * @summary Render a controlled spreadsheet-style grid with virtualized rows, range selection, cell editing, TSV clipboard, fill, column resize, and row/column reorder. The grid owns no domain model or persistence.
   * @param {object} opts - Grid options.
   * @param {Signal<Array>} opts.rows - Controlled row collection.
   * @param {Signal<Array>} opts.columns - Controlled column definitions with optional id, name, width, align, and color.
   * @param {Signal<object>} opts.selection - Controlled selection with kind, anchor, and focus.
   * @param {Function} opts.getText - Return display/edit text for a row and column.
   * @param {Function} opts.onEdit - Commit one cell edit.
   * @param {Function} opts.onPaste - Commit a rectangular string matrix.
   * @param {Function} opts.onFill - Fill a target range from the source range.
   * @returns {HTMLElement} Grid root.
   * @related aiditor.ui.list
   */
  ui.dataGrid = function (opts) {
    const o = opts || {}
    const rowsSig = ui.asSig(o.rows || [])
    const columnsSig = ui.asSig(o.columns || [])
    const selectionSig = ui.asSig(o.selection || null)
    const writeSelection = ui.writer(selectionSig, o.onSelectionChange, 'ui.dataGrid')
    const readOnlySig = ui.asSig(o.readOnly != null ? o.readOnly : false)
    const rowHeight = ui.readNum('--aiditor-data-grid-row-h', 26)
    const rowNumberWidth = ui.readNum('--aiditor-data-grid-row-number-w', 42)
    const defaultWidth = ui.readNum('--aiditor-data-grid-column-w', 140)
    const minWidth = ui.readNum('--aiditor-data-grid-column-min-w', 56)
    const getText = o.getText || function (row, column) { return row && column ? row[column.id] : '' }
    const transientWidths = new Map()
    let activeInteraction = null
    let fillPreview = null
    let paintFrame = 0

    const root = ui.h('div', 'aiditor-ui-data-grid', { role: 'grid', tabindex: '0' })
    const headerViewport = ui.h('div', 'aiditor-ui-data-grid-header-viewport')
    const corner = ui.h('div', 'aiditor-ui-data-grid-corner', { text: '#', role: 'button', title: 'Select all' })
    const headerTrack = ui.h('div', 'aiditor-ui-data-grid-header-track')
    headerViewport.appendChild(corner)
    headerViewport.appendChild(headerTrack)
    root.appendChild(headerViewport)

    const listRowsSig = aiditor.derived(function () {
      columnsSig()
      return (rowsSig() || []).slice()
    })
    ui.collect(root, listRowsSig.dispose)

    function widthOf(column, index) {
      return transientWidths.has(index)
        ? transientWidths.get(index)
        : Math.max(minWidth, Number(column.width) || defaultWidth)
    }

    function selected(row, column) {
      const area = bounds(selectionSig.peek())
      return area && row >= area.top && row <= area.bottom && column >= area.left && column <= area.right
    }

    function setSelection(next) {
      if (!sameSelection(selectionSig.peek(), next)) writeSelection(next)
    }

    function renderRow(row, rowIndex) {
      const rowEl = ui.h('div', 'aiditor-ui-data-grid-row', { role: 'row' })
      rowEl.dataset.row = rowIndex
      const numberEl = ui.h('div', 'aiditor-ui-data-grid-row-number', { text: String(rowIndex + 1), role: 'rowheader' })
      numberEl.draggable = !readOnlySig.peek()
      numberEl.addEventListener('mousedown', function () {
        const last = Math.max(0, columnsSig.peek().length - 1)
        setSelection(selection('row', point(rowIndex, 0), point(rowIndex, last)))
      })
      numberEl.addEventListener('dragstart', function (ev) {
        if (readOnlySig.peek()) { ev.preventDefault(); return }
        ev.dataTransfer.setData('application/x-aiditor-grid-row', String(rowIndex))
        ev.dataTransfer.effectAllowed = 'move'
        root.dataset.dragging = 'row'
      })
      numberEl.addEventListener('dragover', function (ev) {
        if (readOnlySig.peek()) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'move'
        paintDropTarget(rowEl, ev.clientY >= rowEl.getBoundingClientRect().top + rowEl.clientHeight / 2)
      })
      numberEl.addEventListener('dragleave', function () { clearDropTarget(rowEl) })
      numberEl.addEventListener('drop', function (ev) {
        if (readOnlySig.peek()) return
        ev.preventDefault()
        const from = Number(ev.dataTransfer.getData('application/x-aiditor-grid-row'))
        const after = ev.clientY >= rowEl.getBoundingClientRect().top + rowEl.clientHeight / 2
        const insertion = rowIndex + (after ? 1 : 0)
        const to = from < insertion ? insertion - 1 : insertion
        clearDropTargets()
        if (o.onRowMove && Number.isInteger(from) && from !== to) o.onRowMove(from, to)
        if (Number.isInteger(from)) {
          const last = Math.max(0, columnsSig.peek().length - 1)
          setSelection(selection('row', point(to, 0), point(to, last)))
        }
      })
      numberEl.addEventListener('dragend', clearDropTargets)
      rowEl.appendChild(numberEl)

      const columns = columnsSig.peek()
      for (let c = 0; c < columns.length; c++) {
        const column = columns[c]
        const cell = ui.h('div', 'aiditor-ui-data-grid-cell', { role: 'gridcell' })
        cell.dataset.row = rowIndex
        cell.dataset.column = c
        cell.style.width = widthOf(column, c) + 'px'
        cell.style.flexBasis = widthOf(column, c) + 'px'
        if (column.align) cell.dataset.align = column.align
        if (column.color) cell.style.setProperty('--aiditor-data-grid-cell-accent', column.color)
        const content = o.renderCell ? o.renderCell(row, column, rowIndex, c) : getText(row, column, rowIndex, c)
        if (content && content.nodeType) cell.appendChild(content)
        else cell.textContent = content == null ? '' : String(content)
        if (selected(rowIndex, c)) cell.classList.add('aiditor-ui-data-grid-cell-selected')
        cell.addEventListener('pointerdown', function (ev) { beginCellSelection(ev, rowIndex, c) })
        cell.addEventListener('dblclick', function () { beginEdit(rowIndex, c) })
        ui.collect(cell, function () {
          if (cell.__aiditorGridComplete) cell.__aiditorGridComplete(true, false)
          ui.disposeChildren(cell)
        })
        rowEl.appendChild(cell)
      }
      ui.collect(rowEl, function () { ui.disposeChildren(rowEl) })
      return rowEl
    }

    const list = ui.list({ items: listRowsSig, rowHeight: rowHeight, render: renderRow })
    list.classList.add('aiditor-ui-data-grid-body')
    root.appendChild(list)
    const spacer = list.querySelector('.aiditor-ui-list-spacer')
    const selectionBox = ui.h('div', 'aiditor-ui-data-grid-selection-box')
    const fillHandle = ui.h('span', 'aiditor-ui-data-grid-fill-handle', { title: 'Drag to fill' })
    const previewBox = ui.h('div', 'aiditor-ui-data-grid-fill-preview')
    selectionBox.appendChild(fillHandle)
    spacer.appendChild(selectionBox)
    spacer.appendChild(previewBox)
    fillHandle.addEventListener('pointerdown', beginFill)

    function renderHeader(columns) {
      ui.disposeChildren(headerTrack)
      for (let c = 0; c < columns.length; c++) {
        const column = columns[c]
        const header = ui.h('div', 'aiditor-ui-data-grid-column', { role: 'columnheader' })
        header.draggable = !readOnlySig.peek()
        header.dataset.column = c
        header.style.width = widthOf(column, c) + 'px'
        header.style.flexBasis = widthOf(column, c) + 'px'
        if (column.color) header.style.setProperty('--aiditor-data-grid-cell-accent', column.color)
        header.appendChild(ui.h('span', 'aiditor-ui-data-grid-column-label', { text: column.name || column.id || String(c + 1) }))
        header.addEventListener('mousedown', function (ev) {
          if (ev.target.classList.contains('aiditor-ui-data-grid-column-resizer')) return
          const last = Math.max(0, rowsSig.peek().length - 1)
          setSelection(selection('column', point(0, c), point(last, c)))
        })
        header.addEventListener('dragstart', function (ev) {
          if (readOnlySig.peek()) { ev.preventDefault(); return }
          ev.dataTransfer.setData('application/x-aiditor-grid-column', String(c))
          ev.dataTransfer.effectAllowed = 'move'
          root.dataset.dragging = 'column'
        })
        header.addEventListener('dragover', function (ev) {
          if (readOnlySig.peek()) return
          ev.preventDefault()
          ev.dataTransfer.dropEffect = 'move'
          paintDropTarget(header, ev.clientX >= header.getBoundingClientRect().left + header.clientWidth / 2)
        })
        header.addEventListener('dragleave', function () { clearDropTarget(header) })
        header.addEventListener('drop', function (ev) {
          if (readOnlySig.peek()) return
          ev.preventDefault()
          const from = Number(ev.dataTransfer.getData('application/x-aiditor-grid-column'))
          const after = ev.clientX >= header.getBoundingClientRect().left + header.clientWidth / 2
          const insertion = c + (after ? 1 : 0)
          const to = from < insertion ? insertion - 1 : insertion
          clearDropTargets()
          if (o.onColumnMove && Number.isInteger(from) && from !== to) o.onColumnMove(from, to)
          if (Number.isInteger(from)) {
            const last = Math.max(0, rowsSig.peek().length - 1)
            setSelection(selection('column', point(0, to), point(last, to)))
          }
        })
        header.addEventListener('dragend', clearDropTargets)
        const resizer = ui.h('span', 'aiditor-ui-data-grid-column-resizer')
        resizer.addEventListener('pointerdown', function (ev) { beginResize(ev, c, widthOf(column, c)) })
        header.appendChild(resizer)
        headerTrack.appendChild(header)
      }
      syncHeader()
      queuePaint()
    }

    function paintDropTarget(el, after) {
      clearDropTargets()
      el.classList.add(after ? 'aiditor-ui-data-grid-drop-after' : 'aiditor-ui-data-grid-drop-before')
    }

    function clearDropTarget(el) {
      el.classList.remove('aiditor-ui-data-grid-drop-before', 'aiditor-ui-data-grid-drop-after')
    }

    function clearDropTargets() {
      delete root.dataset.dragging
      const targets = root.querySelectorAll('.aiditor-ui-data-grid-drop-before,.aiditor-ui-data-grid-drop-after')
      for (let i = 0; i < targets.length; i++) clearDropTarget(targets[i])
    }

    function syncHeader() {
      headerTrack.style.transform = 'translateX(' + (-list.scrollLeft) + 'px)'
    }

    function columnLeft(index) {
      const columns = columnsSig.peek()
      let left = rowNumberWidth
      for (let i = 0; i < index; i++) left += widthOf(columns[i], i)
      return left
    }

    function paintBox(el, selectedRange) {
      const area = bounds(selectedRange)
      const rows = rowsSig.peek()
      const columns = columnsSig.peek()
      if (!area || !rows.length || !columns.length) { el.hidden = true; return }
      const top = Math.max(0, Math.min(rows.length - 1, area.top))
      const bottom = Math.max(top, Math.min(rows.length - 1, area.bottom))
      const left = Math.max(0, Math.min(columns.length - 1, area.left))
      const right = Math.max(left, Math.min(columns.length - 1, area.right))
      let width = 0
      for (let c = left; c <= right; c++) width += widthOf(columns[c], c)
      el.hidden = false
      el.style.transform = 'translate(' + columnLeft(left) + 'px,' + (top * rowHeight) + 'px)'
      el.style.width = width + 'px'
      el.style.height = ((bottom - top + 1) * rowHeight) + 'px'
    }

    function paintSelection() {
      paintFrame = 0
      const current = selectionSig.peek()
      const area = bounds(current)
      const focus = current && current.focus
      const cells = root.querySelectorAll('.aiditor-ui-data-grid-cell')
      for (let i = 0; i < cells.length; i++) {
        const row = Number(cells[i].dataset.row)
        const column = Number(cells[i].dataset.column)
        cells[i].classList.toggle('aiditor-ui-data-grid-cell-selected', !!area && row >= area.top && row <= area.bottom && column >= area.left && column <= area.right)
        cells[i].classList.toggle('aiditor-ui-data-grid-cell-focus', !!focus && focus.row === row && focus.column === column)
      }
      const rowHeaders = root.querySelectorAll('.aiditor-ui-data-grid-row-number')
      for (let i = 0; i < rowHeaders.length; i++) {
        const row = Number(rowHeaders[i].parentNode.dataset.row)
        rowHeaders[i].classList.toggle('aiditor-ui-data-grid-header-selected', !!area && (current.kind === 'row' || current.kind === 'all') && row >= area.top && row <= area.bottom)
      }
      const columnHeaders = headerTrack.querySelectorAll('.aiditor-ui-data-grid-column')
      for (let i = 0; i < columnHeaders.length; i++) {
        const column = Number(columnHeaders[i].dataset.column)
        columnHeaders[i].classList.toggle('aiditor-ui-data-grid-header-selected', !!area && (current.kind === 'column' || current.kind === 'all') && column >= area.left && column <= area.right)
      }
      corner.classList.toggle('aiditor-ui-data-grid-header-selected', !!current && current.kind === 'all')
      paintBox(selectionBox, current)
      paintBox(previewBox, fillPreview)
      fillHandle.hidden = !current || current.kind !== 'cell' || readOnlySig.peek() || !o.onFill
    }

    function queuePaint() {
      if (!paintFrame) paintFrame = requestAnimationFrame(paintSelection)
    }

    list.addEventListener('scroll', function () { syncHeader(); queuePaint() }, { passive: true })
    ui.bind(root, columnsSig, renderHeader)
    ui.bind(root, rowsSig, queuePaint)
    ui.bind(root, selectionSig, queuePaint)
    ui.bind(root, readOnlySig, function (value) {
      root.dataset.readonly = value ? 'true' : 'false'
      const draggables = root.querySelectorAll('.aiditor-ui-data-grid-row-number,.aiditor-ui-data-grid-column')
      for (let i = 0; i < draggables.length; i++) draggables[i].draggable = !value
      queuePaint()
    })

    corner.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || !rowsSig.peek().length || !columnsSig.peek().length) return
      setSelection(selection('all', point(0, 0), point(rowsSig.peek().length - 1, columnsSig.peek().length - 1)))
      root.focus()
      ev.preventDefault()
    })

    function cellElement(row, column) {
      return root.querySelector('.aiditor-ui-data-grid-cell[data-row="' + row + '"][data-column="' + column + '"]')
    }

    function canEdit(row, column) {
      if (readOnlySig.peek()) return false
      if (!o.canEdit) return true
      const rows = rowsSig.peek()
      const columns = columnsSig.peek()
      return o.canEdit({ row: row, column: column, rowValue: rows[row], columnValue: columns[column] }) !== false
    }

    function beginEdit(row, column, initial) {
      if (!canEdit(row, column)) return
      const cell = cellElement(row, column)
      if (!cell || cell.querySelector('.aiditor-ui-data-grid-editor')) return
      const rows = rowsSig.peek()
      const columns = columnsSig.peek()
      if (o.editorFor && initial == null) {
        const local = aiditor.signal(o.getValue ? o.getValue(rows[row], columns[column], row, column) : getText(rows[row], columns[column], row, column))
        const editor = o.editorFor({ row: row, column: column, rowValue: rows[row], columnValue: columns[column], value: local, onChange: local.set })
        editor.classList.add('aiditor-ui-data-grid-editor', 'aiditor-ui-data-grid-custom-editor')
        cell.appendChild(editor)
        let done = false
        function complete(commit, restoreFocus) {
          if (done) return
          done = true
          cell.__aiditorGridComplete = null
          if (commit && o.onEdit) o.onEdit({ row: row, column: column, value: local.peek(), typed: true })
          ui.dispose(editor)
          if (restoreFocus !== false) root.focus()
        }
        cell.__aiditorGridComplete = complete
        editor.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); complete(false); return }
          if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') {
            ev.preventDefault(); ev.stopPropagation(); complete(true); moveFocus(1)
          }
        })
        editor.addEventListener('focusout', function () {
          requestAnimationFrame(function () { if (!editor.contains(document.activeElement)) complete(true) })
        })
        requestAnimationFrame(function () {
          const focusable = editor.matches('input,select,textarea,button,[tabindex]') ? editor : editor.querySelector('input,select,textarea,button,[tabindex]')
          if (focusable) focusable.focus()
        })
        return
      }

      const input = ui.h('input', 'aiditor-ui-data-grid-editor', { type: 'text', spellcheck: 'false' })
      input.value = initial == null ? String(getText(rows[row], columns[column], row, column) || '') : initial
      cell.appendChild(input)
      input.focus()
      if (initial == null) input.select()
      let finished = false
      function finish(commit, restoreFocus) {
        if (finished) return
        finished = true
        cell.__aiditorGridComplete = null
        if (commit && o.onEdit) o.onEdit({ row: row, column: column, value: input.value, typed: false })
        ui.dispose(input)
        if (restoreFocus !== false) root.focus()
      }
      cell.__aiditorGridComplete = finish
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === 'Tab') {
          ev.preventDefault()
          finish(true)
          if (ev.key === 'Tab') moveTab(!!ev.shiftKey)
          else moveFocus(1)
        } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false) }
      })
      input.addEventListener('blur', function () { finish(true) })
    }

    function ensureVisible(row, column) {
      const columns = columnsSig.peek()
      const top = row * rowHeight
      const bottom = top + rowHeight
      const left = columnLeft(column)
      const right = left + widthOf(columns[column], column)
      if (top < list.scrollTop) list.scrollTop = top
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
      if (left < list.scrollLeft + rowNumberWidth) list.scrollLeft = Math.max(0, left - rowNumberWidth)
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth
      queuePaint()
    }

    function moveFocus(direction, extend) {
      const current = selectionSig.peek()
      if (!current) return
      const rowCount = rowsSig.peek().length
      const columnCount = columnsSig.peek().length
      let row = current.focus.row
      let column = current.focus.column
      if (direction === 0) row--
      if (direction === 1) row++
      if (direction === 2) column--
      if (direction === 3) column++
      row = Math.max(0, Math.min(rowCount - 1, row))
      column = Math.max(0, Math.min(columnCount - 1, column))
      setSelection(selection('cell', extend ? current.anchor : point(row, column), point(row, column)))
      ensureVisible(row, column)
    }

    function moveTab(backward) {
      const current = selectionSig.peek()
      if (!current) return
      const rowCount = rowsSig.peek().length
      const columnCount = columnsSig.peek().length
      let row = current.focus.row
      let column = current.focus.column + (backward ? -1 : 1)
      if (column >= columnCount) { column = 0; row++ }
      if (column < 0) { column = columnCount - 1; row-- }
      row = Math.max(0, Math.min(rowCount - 1, row))
      column = Math.max(0, Math.min(columnCount - 1, column))
      setSelection(selection('cell', point(row, column), point(row, column)))
      ensureVisible(row, column)
    }

    root.addEventListener('keydown', function (ev) {
      const current = selectionSig.peek()
      if (!current) return
      if (ev.key === 'Tab') { ev.preventDefault(); moveTab(!!ev.shiftKey); return }
      if (ev.key === 'Enter') { ev.preventDefault(); moveFocus(ev.shiftKey ? 0 : 1); return }
      let direction = -1
      if (ev.key === 'ArrowUp') direction = 0
      else if (ev.key === 'ArrowDown') direction = 1
      else if (ev.key === 'ArrowLeft') direction = 2
      else if (ev.key === 'ArrowRight') direction = 3
      if (direction >= 0) { ev.preventDefault(); moveFocus(direction, ev.shiftKey); return }
      const focus = current.focus
      if (ev.key === 'F2') { ev.preventDefault(); beginEdit(focus.row, focus.column); return }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && !readOnlySig.peek()) {
        ev.preventDefault()
        const area = bounds(current)
        const matrix = []
        for (let r = area.top; r <= area.bottom; r++) matrix.push(new Array(area.right - area.left + 1).fill(''))
        if (o.onPaste) o.onPaste({ row: area.top, column: area.left, matrix: matrix })
        return
      }
      if (!readOnlySig.peek() && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault()
        beginEdit(focus.row, focus.column, ev.key)
      }
    })

    root.addEventListener('copy', function (ev) {
      const area = bounds(selectionSig.peek())
      if (!area || !ev.clipboardData) return
      const rows = rowsSig.peek()
      const columns = columnsSig.peek()
      const matrix = []
      for (let r = area.top; r <= area.bottom; r++) {
        const line = []
        for (let c = area.left; c <= area.right; c++) line.push(getText(rows[r], columns[c], r, c))
        matrix.push(line.join('\t'))
      }
      ev.clipboardData.setData('text/plain', matrix.join('\n'))
      ev.preventDefault()
    })

    root.addEventListener('paste', function (ev) {
      const current = selectionSig.peek()
      if (!current || readOnlySig.peek() || !ev.clipboardData || !o.onPaste) return
      o.onPaste({ row: current.focus.row, column: current.focus.column, matrix: clipboardRows(ev.clipboardData.getData('text/plain')) })
      ev.preventDefault()
    })

    root.addEventListener('contextmenu', function (ev) {
      const cell = ev.target.closest('.aiditor-ui-data-grid-cell')
      const rowHeader = ev.target.closest('.aiditor-ui-data-grid-row-number')
      const columnHeader = ev.target.closest('.aiditor-ui-data-grid-column')
      const current = selectionSig.peek()
      const area = bounds(current)
      if (cell) {
        const row = Number(cell.dataset.row)
        const column = Number(cell.dataset.column)
        if (!area || row < area.top || row > area.bottom || column < area.left || column > area.right) {
          setSelection(selection('cell', point(row, column), point(row, column)))
        }
      } else if (rowHeader) {
        const row = Number(rowHeader.parentNode.dataset.row)
        if (!area || current.kind !== 'row' || row < area.top || row > area.bottom) {
          setSelection(selection('row', point(row, 0), point(row, Math.max(0, columnsSig.peek().length - 1))))
        }
      } else if (columnHeader) {
        const column = Number(columnHeader.dataset.column)
        if (!area || current.kind !== 'column' || column < area.left || column > area.right) {
          setSelection(selection('column', point(0, column), point(Math.max(0, rowsSig.peek().length - 1), column)))
        }
      }
    })

    function pointAt(clientX, clientY) {
      const rect = list.getBoundingClientRect()
      const row = Math.max(0, Math.min(rowsSig.peek().length - 1, Math.floor((list.scrollTop + clientY - rect.top) / rowHeight)))
      const contentX = list.scrollLeft + clientX - rect.left
      const columns = columnsSig.peek()
      let column = 0
      let edge = rowNumberWidth
      for (let c = 0; c < columns.length; c++) {
        edge += widthOf(columns[c], c)
        column = c
        if (contentX < edge) break
      }
      return point(row, column)
    }

    function autoScroll(clientX, clientY) {
      const rect = list.getBoundingClientRect()
      const beforeTop = list.scrollTop
      const beforeLeft = list.scrollLeft
      if (clientY < rect.top + rowHeight) list.scrollTop -= rowHeight
      else if (clientY > rect.bottom - rowHeight) list.scrollTop += rowHeight
      if (clientX < rect.left + rowNumberWidth + rowHeight) list.scrollLeft -= rowHeight
      else if (clientX > rect.right - rowHeight) list.scrollLeft += rowHeight
      return beforeTop !== list.scrollTop || beforeLeft !== list.scrollLeft
    }

    function startPointerInteraction(ev, update, commit, cancel, scroll) {
      if (activeInteraction) activeInteraction(false)
      const pointerId = ev.pointerId
      let latest = { x: ev.clientX, y: ev.clientY }
      let frame = 0
      let ended = false

      function tick() {
        frame = 0
        const moved = scroll && autoScroll(latest.x, latest.y)
        update(latest.x, latest.y)
        if (moved) frame = requestAnimationFrame(tick)
      }
      function move(moveEv) {
        if (moveEv.pointerId !== pointerId) return
        latest = { x: moveEv.clientX, y: moveEv.clientY }
        if (frame) cancelAnimationFrame(frame)
        tick()
      }
      function finish(accept, endEv) {
        if (ended || endEv && endEv.pointerId !== pointerId) return
        ended = true
        if (frame) cancelAnimationFrame(frame)
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', pointerCancel)
        document.removeEventListener('keydown', key, true)
        activeInteraction = null
        if (accept) commit(latest.x, latest.y)
        else cancel()
      }
      function up(upEv) { finish(true, upEv) }
      function pointerCancel(cancelEv) { finish(false, cancelEv) }
      function key(keyEv) {
        if (keyEv.key !== 'Escape') return
        keyEv.preventDefault()
        keyEv.stopPropagation()
        finish(false)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', pointerCancel)
      document.addEventListener('keydown', key, true)
      activeInteraction = finish
    }

    function beginCellSelection(ev, row, column) {
      if (ev.button !== 0 || ev.target.closest('.aiditor-ui-data-grid-editor')) return
      const before = selectionSig.peek()
      const anchor = ev.shiftKey && before ? before.anchor : point(row, column)
      setSelection(selection('cell', anchor, point(row, column)))
      root.focus()
      ev.preventDefault()
      startPointerInteraction(ev, function (x, y) {
        setSelection(selection('cell', anchor, pointAt(x, y)))
      }, function () {}, function () { setSelection(before) }, true)
    }

    function beginResize(ev, column, startWidth) {
      if (readOnlySig.peek()) return
      ev.preventDefault()
      ev.stopPropagation()
      const startX = ev.clientX
      let width = startWidth
      function paintWidth(value) {
        transientWidths.set(column, value)
        const cells = root.querySelectorAll('[data-column="' + column + '"]')
        for (let i = 0; i < cells.length; i++) {
          cells[i].style.width = value + 'px'
          cells[i].style.flexBasis = value + 'px'
        }
        queuePaint()
      }
      startPointerInteraction(ev, function (x) {
        width = Math.max(minWidth, startWidth + x - startX)
        paintWidth(width)
      }, function () {
        transientWidths.delete(column)
        if (o.onColumnResize && width !== startWidth) o.onColumnResize(column, width)
        queuePaint()
      }, function () {
        transientWidths.delete(column)
        paintWidth(startWidth)
        transientWidths.delete(column)
      }, false)
    }

    function fillTarget(source, hit) {
      const area = bounds(source)
      const rowDistance = hit.row < area.top ? area.top - hit.row : hit.row > area.bottom ? hit.row - area.bottom : 0
      const columnDistance = hit.column < area.left ? area.left - hit.column : hit.column > area.right ? hit.column - area.right : 0
      if (!rowDistance && !columnDistance) return source
      if (rowDistance >= columnDistance) {
        return selection('cell', point(Math.min(hit.row, area.top), area.left), point(Math.max(hit.row, area.bottom), area.right))
      }
      return selection('cell', point(area.top, Math.min(hit.column, area.left)), point(area.bottom, Math.max(hit.column, area.right)))
    }

    function beginFill(ev) {
      ev.preventDefault()
      ev.stopPropagation()
      const area = bounds(selectionSig.peek())
      const source = selection('cell', point(area.top, area.left), point(area.bottom, area.right))
      fillPreview = source
      queuePaint()
      startPointerInteraction(ev, function (x, y) {
        fillPreview = fillTarget(source, pointAt(x, y))
        queuePaint()
      }, function () {
        const target = fillPreview
        fillPreview = null
        if (!sameSelection(source, target)) {
          o.onFill(source, target)
          setSelection(target)
        }
        queuePaint()
      }, function () {
        fillPreview = null
        queuePaint()
      }, true)
    }

    root.editCell = beginEdit
    root.focusCell = function (row, column) {
      setSelection(selection('cell', point(row, column), point(row, column)))
      ensureVisible(row, column)
      root.focus()
    }
    ui.collect(root, function () {
      if (activeInteraction) activeInteraction(false)
      if (paintFrame) cancelAnimationFrame(paintFrame)
      ui.disposeChildren(root)
    })
    return root
  }
})(window.aiditor = window.aiditor || {})

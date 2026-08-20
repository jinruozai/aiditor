// Built-in csv-editor panel. One panel is one file/view; the `format` prop selects a registered CSV format.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv

  function factory(propsSig, ctx) {
    const initial = propsSig.peek()
    const workspaceId = String(initial.workspaceId || 'default')
    const path = aiditor.workspace.normalizePath(initial.path)
    const format = csv.formats.resolve(initial.format || 'csv')
    if (!path) throw new Error('csv-editor: props.path is required')

    const session = csv.sessions.acquire(workspaceId, path, format.id, { columns: initial.columns || null })
    const workspace = aiditor.workspace.binding(workspaceId)
    const document = session.document
    const selectionSig = aiditor.signal(null)
    const readOnlySig = aiditor.derived(function () { return !!propsSig().readOnly })
    const rowsSig = aiditor.signal([])
    const columnsSig = aiditor.signal([])
    const rowViews = new Map()
    const viewWidths = new Map()
    let lastRows = ''
    let lastColumns = null
    let lastReadOnly = readOnlySig.peek()

    const root = ui.h('div', 'aiditor-csv-editor')
    root.dataset.format = format.id
    root.__csvSession = session
    root.__csvSelection = selectionSig

    ctx.onCleanup(readOnlySig.dispose)
    ctx.onCleanup(function () {
      const selected = aiditor.inspector.selection.peek()
      if (selected.some(function (target) { return target.sessionKey === session.key })) aiditor.inspector.select([])
      session.release()
    })

    function projectedColumns(doc) {
      if (format.supportsColumnSchema || !viewWidths.size) return doc.columns
      return doc.columns.map(function (column) {
        return viewWidths.has(column.id) ? Object.assign({}, column, { width: viewWidths.get(column.id) }) : column
      })
    }

    function richCell(column) {
      if (format.id === 'csv' || readOnlySig.peek()) return false
      const resolved = format.resolveField ? format.resolveField(column.fieldDef) : ui.resolveFieldDef(column.fieldDef)
      return !resolved._unknown
    }

    function syncProjection(doc) {
      if (!doc) return
      const diagnostics = new Map()
      doc.diagnostics.forEach(function (diagnostic) { diagnostics.set(diagnostic.rowId + '\u0000' + diagnostic.columnId, diagnostic) })
      const activeRows = new Set()
      const activeColumns = new Set(doc.columns.map(function (column) { return column.id }))
      let rerenderRows = false

      aiditor.batch(function () {
        doc.rows.forEach(function (row) {
          activeRows.add(row.id)
          let view = rowViews.get(row.id)
          if (!view) {
            view = { id: row.id, source: aiditor.signal(row), cells: new Map() }
            rowViews.set(row.id, view)
          } else {
            view.source.set(row)
          }
          doc.columns.forEach(function (column, columnIndex) {
            let cell = view.cells.get(column.id)
            const diagnostic = diagnostics.get(row.id + '\u0000' + column.id) || null
            if (!cell) {
              cell = {
                value: aiditor.signal(row.values[columnIndex]),
                raw: aiditor.signal(row.rawValues[columnIndex]),
                diagnostic: aiditor.signal(diagnostic),
                rich: richCell(column),
              }
              view.cells.set(column.id, cell)
            } else {
              const nextRich = richCell(column)
              if (cell.rich !== nextRich) { cell.rich = nextRich; rerenderRows = true }
            }
            cell.value.set(row.values[columnIndex])
            cell.raw.set(row.rawValues[columnIndex])
            cell.diagnostic.set(diagnostic)
          })
          view.cells.forEach(function (_cell, columnId) { if (!activeColumns.has(columnId)) view.cells.delete(columnId) })
        })

        rowViews.forEach(function (_view, rowId) { if (!activeRows.has(rowId)) rowViews.delete(rowId) })
        if (lastColumns !== doc.columns) {
          lastColumns = doc.columns
          columnsSig.set(projectedColumns(doc))
        }
        const order = doc.rows.map(function (row) { return row.id }).join('\u0000')
        const readOnly = readOnlySig.peek()
        if (order !== lastRows || readOnly !== lastReadOnly || rerenderRows) {
          lastRows = order
          lastReadOnly = readOnly
          rowsSig.set(doc.rows.map(function (row) { return rowViews.get(row.id) }))
        }
      })
    }

    ctx.onCleanup(aiditor.effect(function () {
      const doc = document.value()
      readOnlySig()
      syncProjection(doc)
    }))

    function command(id, input) {
      const args = Object.assign({ sessionKey: session.key, selection: selectionSig.peek(), readOnly: readOnlySig.peek() }, input || {})
      const result = aiditor.commands.run(id, args, { panel: ctx.panel })
      if (result && typeof result.then === 'function') {
        result.catch(function (error) { aiditor.reportError({ scope: 'csv-editor', action: id, path: path }, error) })
      }
      return result
    }

    function promptCount(id, subject) {
      return ui.prompt({
        title: 'Insert ' + subject,
        message: 'How many ' + subject + ' should be inserted?',
        default: '1',
        okLabel: 'Insert',
      }).then(function (value) {
        if (value == null) return
        const count = Number(value)
        if (!Number.isInteger(count) || count < 1) return ui.alert({ title: 'Invalid count', message: 'Enter a positive whole number.' })
        return command(id, { count: count })
      })
    }

    function copyColumnDefinition() {
      const selection = selectionSig.peek()
      const doc = document.value.peek()
      return ui.copyText(format.stringifyDefinition(doc.columns[selection.focus.column]))
    }

    function pasteColumnDefinition(keepName) {
      const manual = function () {
        return ui.prompt({ title: 'Paste column definition', message: 'Paste a column definition.', placeholder: "{'name':'Column','type':'var'}", okLabel: 'Apply' })
      }
      const read = navigator.clipboard && navigator.clipboard.readText
        ? navigator.clipboard.readText().catch(manual)
        : manual()
      return read.then(function (text) {
        if (text == null) return
        let definition = null
        try { definition = format.parseDefinition(text) } catch (_) {}
        if (!definition) return ui.alert({ title: 'Invalid column', message: 'The clipboard does not contain a column definition.' })
        return command('csv.column.applyDefinition', { definition: definition, keepName: keepName })
      })
    }

    const toolbar = ui.h('div', 'aiditor-csv-toolbar')
    const saveDisabled = aiditor.derived(function () { return readOnlySig() || !document.dirty() || document.status() === 'saving' })
    const reloadDisabled = aiditor.derived(function () { return document.dirty() || document.status() === 'loading' })
    const undoDisabled = aiditor.derived(function () { session.history.entries(); session.history.index(); return readOnlySig() || !session.editing() && !session.history.canUndo() })
    const redoDisabled = aiditor.derived(function () { session.history.entries(); session.history.index(); return readOnlySig() || !session.history.canRedo() })
    ctx.onCleanup(saveDisabled.dispose)
    ctx.onCleanup(reloadDisabled.dispose)
    ctx.onCleanup(undoDisabled.dispose)
    ctx.onCleanup(redoDisabled.dispose)

    toolbar.appendChild(ui.iconButton({ icon: 'save', title: 'Save', size: 'sm', disabled: saveDisabled, onClick: function () { command('csv.save') } }))
    toolbar.appendChild(ui.iconButton({ icon: 'refresh', title: 'Reload from workspace', size: 'sm', disabled: reloadDisabled, onClick: function () { command('csv.reload') } }))
    toolbar.appendChild(ui.divider({ vertical: true }))
    toolbar.appendChild(ui.iconButton({ icon: 'undo', title: 'Undo', size: 'sm', disabled: undoDisabled, onClick: function () { command('csv.undo') } }))
    toolbar.appendChild(ui.iconButton({ icon: 'redo', title: 'Redo', size: 'sm', disabled: redoDisabled, onClick: function () { command('csv.redo') } }))
    toolbar.appendChild(ui.divider({ vertical: true }))
    toolbar.appendChild(ui.iconButton({ icon: 'plus', title: 'Insert row below', size: 'sm', disabled: readOnlySig, onClick: function () { command('csv.row.insertBelow') } }))
    toolbar.appendChild(ui.iconButton({ icon: 'columns', title: 'Insert column right', size: 'sm', disabled: readOnlySig, onClick: function () { command('csv.column.insertRight') } }))
    toolbar.appendChild(ui.iconButton({ icon: 'edit', title: 'Inspect selected column', size: 'sm', onClick: function () {
      const selection = selectionSig.peek()
      const doc = document.value.peek()
      if (!selection || !doc) return
      const column = doc.columns[selection.focus.column]
      aiditor.inspector.select([{ type: 'csv.column', sessionKey: session.key, columnId: column.id, title: column.name, readOnly: readOnlySig.peek() }], { workspaceId: workspaceId })
    } }))
    toolbar.appendChild(ui.h('span', 'aiditor-csv-toolbar-spacer'))
    const status = ui.h('span', 'aiditor-csv-status')
    toolbar.appendChild(status)
    root.appendChild(toolbar)

    const formula = ui.h('div', 'aiditor-csv-formula')
    const address = ui.h('span', 'aiditor-csv-address', { text: '-' })
    const formulaInput = ui.h('input', 'aiditor-csv-formula-input', { type: 'text', spellcheck: 'false', 'aria-label': 'Cell value' })
    formula.appendChild(address)
    formula.appendChild(formulaInput)
    root.appendChild(formula)

    function publishSelection(selection) {
      const doc = document.value.peek()
      if (!selection || !doc || !doc.columns.length) return
      const column = doc.columns[selection.focus.column]
      if (!column) return
      if (selection.kind === 'column') {
        aiditor.inspector.select([{ type: 'csv.column', sessionKey: session.key, columnId: column.id, title: column.name, readOnly: readOnlySig.peek() }], { workspaceId: workspaceId })
        return
      }
      const row = doc.rows[selection.focus.row]
      if (!row) return
      aiditor.inspector.select([{
        type: 'csv.cell',
        sessionKey: session.key,
        rowId: row.id,
        columnId: column.id,
        title: column.name + ' / ' + (selection.focus.row + 1),
        readOnly: readOnlySig.peek(),
      }], { workspaceId: workspaceId })
    }

    function setSelection(selection) { selectionSig.set(selection) }
    ctx.onCleanup(aiditor.effect(function () { const selection = selectionSig(); document.value(); readOnlySig(); publishSelection(selection) }))

    function indices(rowId, columnId) {
      const doc = document.value.peek()
      return {
        doc: doc,
        row: doc.rows.findIndex(function (item) { return item.id === rowId }),
        column: doc.columns.findIndex(function (item) { return item.id === columnId }),
      }
    }

    const grid = ui.dataGrid({
      rows: rowsSig,
      columns: columnsSig,
      selection: selectionSig,
      onSelectionChange: setSelection,
      readOnly: readOnlySig,
      getText: function (row, column) { return row.cells.get(column.id).raw.peek() },
      getValue: function (row, column) { return row.cells.get(column.id).value.peek() },
      renderCell: function (row, column) {
        const cell = row.cells.get(column.id)
        const editKey = row.id + '\u0000' + column.id
        return csv.renderCell({
          cell: cell,
          row: row.source.peek(),
          rowId: row.id,
          column: column,
          format: format,
          document: document.value,
          workspace: workspace,
          workspaceId: workspaceId,
          path: path,
          panel: ctx.panel,
          readOnly: readOnlySig.peek(),
          onSelect: function () {
            const at = indices(row.id, column.id)
            if (at.row >= 0 && at.column >= 0) setSelection({ kind: 'cell', anchor: { row: at.row, column: at.column }, focus: { row: at.row, column: at.column } })
          },
          onBegin: function () { session.beginEdit(editKey, 'Edit ' + column.name) },
          onFinish: function () { session.finishEdit() },
          onCancel: function () { session.cancelEdit(editKey) },
          onChange: function (value, meta, active) {
            const at = indices(row.id, column.id)
            if (at.row < 0 || at.column < 0) return
            const next = csv.model.setValue(at.doc, at.row, at.column, value)
            if (meta && meta.edit) session.edit(editKey, 'Edit ' + column.name, next, meta)
            else if (active) session.updateEdit(editKey, 'Edit ' + column.name, next)
            else session.commit('Edit ' + column.name, next)
          },
        })
      },
      onEdit: function (edit) {
        const doc = document.value.peek()
        session.commit('Edit ' + doc.columns[edit.column].name, csv.model.setCell(doc, edit.row, edit.column, edit.value))
      },
      onPaste: function (paste) {
        let doc = document.value.peek()
        const requiredRows = paste.row + paste.matrix.length
        let requiredColumns = paste.column
        paste.matrix.forEach(function (row) { requiredColumns = Math.max(requiredColumns, paste.column + row.length) })
        if (requiredRows > doc.rows.length) doc = csv.model.insertRows(doc, doc.rows.length, requiredRows - doc.rows.length)
        if (requiredColumns > doc.columns.length) doc = csv.model.insertColumns(doc, doc.columns.length, requiredColumns - doc.columns.length)
        session.commit('Paste cells', csv.model.setMatrix(doc, paste.row, paste.column, paste.matrix))
      },
      onFill: function (source, target) {
        session.commit('Fill cells', csv.model.fill(document.value.peek(), source, target))
      },
      onColumnResize: function (columnIndex, width) {
        const doc = document.value.peek()
        if (format.supportsColumnSchema) {
          session.commit('Resize column', csv.model.resizeColumn(doc, columnIndex, width))
          return
        }
        viewWidths.set(doc.columns[columnIndex].id, width)
        columnsSig.set(projectedColumns(doc))
      },
      onColumnMove: function (from, to) {
        session.commit('Move column', csv.model.moveColumn(document.value.peek(), from, to))
      },
      onRowMove: function (from, to) {
        session.commit('Move row', csv.model.moveRow(document.value.peek(), from, to))
      },
    })
    ctx.onCleanup(csv.pan.attach(grid))
    root.appendChild(grid)

    grid.addEventListener('contextmenu', function (event) {
      event.preventDefault()
      const args = function () { return { sessionKey: session.key, selection: selectionSig.peek(), readOnly: readOnlySig.peek() } }
      const kind = selectionSig.peek() && selectionSig.peek().kind
      const actions = []
      if (kind !== 'column') {
        actions.push(
          { label: 'Insert row above', icon: 'plus', command: 'csv.row.insertAbove', args: args, disabled: function () { return readOnlySig.peek() } },
          { label: 'Insert row below', icon: 'plus', command: 'csv.row.insertBelow', args: args, disabled: function () { return readOnlySig.peek() } },
          { label: 'Insert N rows above...', icon: 'plus', onSelect: function () { return promptCount('csv.row.insertAboveCount', 'rows') }, disabled: function () { return readOnlySig.peek() } },
          { label: 'Insert N rows below...', icon: 'plus', onSelect: function () { return promptCount('csv.row.insertBelowCount', 'rows') }, disabled: function () { return readOnlySig.peek() } },
          { label: 'Delete rows', icon: 'trash', danger: true, command: 'csv.row.delete', args: args, disabled: function () { return readOnlySig.peek() } }
        )
      }
      if (kind !== 'row') {
        if (actions.length) actions.push({ type: 'divider' })
        if (kind === 'column' && format.supportsColumnSchema) {
          actions.push(
            { label: 'Copy column definition', icon: 'copy', onSelect: copyColumnDefinition },
            { label: 'Paste column definition', icon: 'paste', onSelect: function () { return pasteColumnDefinition(true) }, disabled: function () { return readOnlySig.peek() } },
            { label: 'Paste column definition with name', icon: 'paste', onSelect: function () { return pasteColumnDefinition(false) }, disabled: function () { return readOnlySig.peek() } },
            { type: 'divider' }
          )
        }
        actions.push(
          { label: 'Insert column left', icon: 'columns', command: 'csv.column.insertLeft', args: args, disabled: function () { return readOnlySig.peek() } },
          { label: 'Insert column right', icon: 'columns', command: 'csv.column.insertRight', args: args, disabled: function () { return readOnlySig.peek() } },
          { label: 'Insert N columns left...', icon: 'columns', onSelect: function () { return promptCount('csv.column.insertLeftCount', 'columns') }, disabled: function () { return readOnlySig.peek() } },
          { label: 'Insert N columns right...', icon: 'columns', onSelect: function () { return promptCount('csv.column.insertRightCount', 'columns') }, disabled: function () { return readOnlySig.peek() } },
          { label: 'Delete columns', icon: 'trash', danger: true, command: 'csv.column.delete', args: args, disabled: function () { return readOnlySig.peek() } }
        )
      }
      ui.actionMenu({
        anchor: grid,
        point: { x: event.clientX, y: event.clientY },
        behavior: 'context',
        sourceScope: 'csv-editor',
        actions: actions,
        ctx: { panel: ctx.panel },
      })
    })

    function refreshFormula() {
      const selection = selectionSig.peek()
      const doc = document.value.peek()
      if (!selection || !doc || !doc.rows[selection.focus.row] || !doc.columns[selection.focus.column]) {
        address.textContent = '-'
        if (window.document.activeElement !== formulaInput) formulaInput.value = ''
        formulaInput.disabled = true
        return
      }
      address.textContent = doc.columns[selection.focus.column].name + ' / ' + (selection.focus.row + 1)
      if (window.document.activeElement !== formulaInput) formulaInput.value = csv.model.displayCell(doc, selection.focus.row, selection.focus.column)
      formulaInput.disabled = readOnlySig.peek()
    }

    function commitFormula() {
      const selection = selectionSig.peek()
      if (!selection || readOnlySig.peek()) return
      const doc = document.value.peek()
      session.commit('Edit ' + doc.columns[selection.focus.column].name,
        csv.model.setCell(doc, selection.focus.row, selection.focus.column, formulaInput.value))
    }
    formulaInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); commitFormula(); grid.focus() }
      if (event.key === 'Escape') { event.preventDefault(); refreshFormula(); grid.focus() }
    })
    formulaInput.addEventListener('change', commitFormula)
    ctx.onCleanup(aiditor.effect(function () { selectionSig(); document.value(); readOnlySig(); refreshFormula() }))

    ctx.onCleanup(aiditor.effect(function () {
      const state = document.status()
      const error = document.error()
      const stale = document.stale()
      const doc = document.value()
      const invalid = doc ? doc.diagnostics.length : 0
      const base = error ? error.message || String(error)
        : stale ? 'Changed on disk'
          : state === 'saving' ? 'Saving...'
            : document.dirty() ? 'Modified'
              : state === 'ready' ? 'Saved' : 'Loading...'
      status.textContent = format.label + ' / ' + base + (invalid ? ' / ' + invalid + ' invalid cell' + (invalid === 1 ? '' : 's') : '')
      status.dataset.state = error ? 'error' : stale || invalid ? 'warning' : state
    }))

    ctx.onCleanup(aiditor.effect(function () {
      const dirty = document.dirty()
      if (ctx.panel.dirty.peek() !== dirty) ctx.panel.setDirty(dirty)
    }))

    ctx.onCleanup(aiditor.effect(function () {
      const doc = document.value()
      const selection = selectionSig.peek()
      if (!doc || !doc.columns.length) return
      if (!doc.rows.length) {
        if (selection && selection.kind !== 'column') selectionSig.set(null)
        return
      }
      if (!selection) {
        setSelection({ kind: 'cell', anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } })
        return
      }
      const anchor = {
        row: Math.max(0, Math.min(doc.rows.length - 1, selection.anchor.row)),
        column: Math.max(0, Math.min(doc.columns.length - 1, selection.anchor.column)),
      }
      const focus = {
        row: Math.max(0, Math.min(doc.rows.length - 1, selection.focus.row)),
        column: Math.max(0, Math.min(doc.columns.length - 1, selection.focus.column)),
      }
      if (selection.kind === 'row') { anchor.column = 0; focus.column = doc.columns.length - 1 }
      if (selection.kind === 'column') { anchor.row = 0; focus.row = doc.rows.length - 1 }
      if (selection.kind === 'all') { anchor.row = 0; anchor.column = 0; focus.row = doc.rows.length - 1; focus.column = doc.columns.length - 1 }
      if (anchor.row !== selection.anchor.row || anchor.column !== selection.anchor.column || focus.row !== selection.focus.row || focus.column !== selection.focus.column) {
        setSelection({ kind: selection.kind, anchor: anchor, focus: focus })
      }
    }))

    ctx.onCleanup(function () { ui.disposeChildren(root) })
    session.load().catch(function (error) { aiditor.reportError({ scope: 'csv-editor', action: 'load', path: path }, error) })

    root.__csvRestore = function (state) {
      if (state && state.document) session.restore(state)
      if (state && state.selection) setSelection(state.selection)
    }
    return root
  }

  aiditor.registerComponent('csv-editor', {
    label: 'CSV Editor',
    icon: 'table',
    category: 'panel',
    palette: false,
    defaults: function () {
      return { title: 'CSV', icon: 'table', props: { workspaceId: 'default', path: '', format: 'csv' } }
    },
    factory: factory,
    serialize: function (el) {
      return { document: el.__csvSession.document.snapshot(), selection: el.__csvSelection.peek() }
    },
    deserialize: function (el, state) { el.__csvRestore(state) },
  })
})(window.aiditor = window.aiditor || {})

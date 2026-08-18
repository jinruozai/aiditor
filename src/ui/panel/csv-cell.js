// Compact typed-cell projection over the shared FieldDef/editor system.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv
  const schema = ui.schema

  function staticValue(cell, renderKind) {
    const el = ui.h('span', 'aiditor-csv-cell-value')
    if (renderKind) el.dataset.render = renderKind
    ui.bind(el, cell.raw, function (value) { el.textContent = value == null ? '' : String(value) })
    ui.bind(el, cell.diagnostic, function (diagnostic) {
      el.classList.toggle('aiditor-csv-cell-invalid', !!diagnostic)
      el.title = diagnostic ? diagnostic.message : ''
    })
    return el
  }

  function resolvedField(format, fieldDef) {
    return format.resolveField ? format.resolveField(fieldDef) : ui.resolveFieldDef(fieldDef)
  }

  function rawValue(fieldDef, valueSig, context) {
    if (context.raw) return context.raw.peek()
    return context.format.encodeCell(valueSig.peek(), fieldDef)
  }

  function dragDescriptor(fieldDef, valueSig, context) {
    const field = resolvedField(context.format, fieldDef)
    return {
      raw: rawValue(fieldDef, valueSig, context),
      type: field.type || fieldDef.type || 'var',
      render: field.type_render || 'input_string',
      workspaceId: context.workspaceId,
      path: context.path,
      rowId: context.rowId,
      columnId: context.columnId,
    }
  }

  function droppedValue(raw, fieldDef, write, context) {
    write(context.format.decodeCell(raw, fieldDef).value, { source: 'drop' })
  }

  function compactValue(fieldDef, valueSig, write, context, depth) {
    const format = context.format
    const resolved = resolvedField(format, fieldDef)
    if (depth < 4 && (schema.isArrayField(resolved) || schema.isStructField(resolved))) {
      const root = ui.h('span', 'aiditor-csv-composite')
      if (csv.drag.shouldHandle(resolved)) {
        const handle = csv.drag.grip(function () { return dragDescriptor(fieldDef, valueSig, context) })
        root.appendChild(handle)
        ui.collect(root, function () { ui.dispose(handle) })
      }
      const definition = schema.isStructField(resolved) ? schema.normalizeStructDef(resolved.struct_def) || {} : null
      const fields = definition ? Object.keys(definition) : null
      const elemField = fields ? null : schema.resolveArrayElemFieldDef(resolved, resolved.type_agv)
      const maxItems = context.maxItems
      let currentLength = -1
      let currentTotal = -1

      function rebuild(value) {
        value = Array.isArray(value) ? value : []
        const visible = Math.min(value.length, maxItems)
        if (currentLength === visible && currentTotal === value.length) return
        currentLength = visible
        currentTotal = value.length
        const handle = root.firstChild && root.firstChild.classList.contains('aiditor-csv-value-handle') ? root.firstChild : null
        while (root.lastChild && root.lastChild !== handle) ui.dispose(root.lastChild)
        for (let index = 0; index < visible; index++) {
          const item = ui.h('span', 'aiditor-csv-composite-item')
          const itemSig = aiditor.derived(function () {
            const current = valueSig()
            return Array.isArray(current) ? current[index] : null
          })
          const childField = fields ? definition[fields[index]] || { type: 'var' } : elemField
          const childContext = Object.assign({}, context, { raw: null })
          const child = compactValue(childField, itemSig, function (next, meta) {
            const current = Array.isArray(valueSig.peek()) ? valueSig.peek().slice() : []
            current[index] = next
            write(current, meta)
          }, childContext, depth + 1)
          item.appendChild(child)
          ui.collect(item, itemSig.dispose)
          ui.collect(item, function () { ui.dispose(child) })
          root.appendChild(item)
        }
        if (value.length > visible) root.appendChild(ui.h('span', 'aiditor-csv-composite-more', { text: '+' + (value.length - visible) }))
      }

      ui.bind(root, valueSig, rebuild)
      return root
    }

    const adapter = {
      field: resolved,
      value: valueSig,
      raw: context.raw,
      getRaw: function () { return rawValue(fieldDef, valueSig, context) },
      write: write,
    }

    if (format.renderCellEditor) {
      const custom = format.renderCellEditor(resolved, adapter, {
        document: context.document,
        workspace: context.workspace,
        workspaceId: context.workspaceId,
        path: context.path,
        rowId: context.rowId,
        columnId: context.columnId,
        descriptor: function () { return dragDescriptor(fieldDef, valueSig, context) },
        writeDropped: function (raw) { droppedValue(raw, fieldDef, write, context) },
      })
      if (custom) return custom
    }

    const editor = ui.editorFor(resolved, valueSig, write, context.editorContext)
    editor.classList.add('aiditor-csv-inline-control')
    return editor
  }

  csv.renderCell = function (options) {
    const o = options || {}
    const cell = o.cell
    const format = o.format
    if (!format.richCells || o.readOnly) return staticValue(cell)

    const resolved = resolvedField(format, o.column.fieldDef)
    if (resolved._unknown) return staticValue(cell, resolved.type_render)

    const root = ui.h('span', 'aiditor-csv-rich-cell aiditor-ui-data-grid-editor')
    root.dataset.render = resolved.type_render || ''
    let active = false
    let pointerActive = false

    function begin() {
      if (active) return
      active = true
      o.onBegin()
    }
    function finish() {
      if (!active) return
      active = false
      o.onFinish()
    }
    function write(value, meta) {
      cell.value.set(value)
      o.onChange(value, meta, active)
    }

    const content = compactValue(o.column.fieldDef, cell.value, write, {
      format: format,
      document: o.document,
      workspace: o.workspace,
      workspaceId: o.workspaceId,
      path: o.path,
      rowId: o.rowId,
      columnId: o.column.id,
      raw: cell.raw,
      maxItems: Math.max(1, Math.ceil((Number(o.column.width) || ui.readNum('--aiditor-data-grid-column-w', 140)) / ui.readNum('--aiditor-size-h-sm', 24))),
      editorContext: {
        workspaceId: o.workspaceId,
        path: o.path,
        panel: o.panel,
        rowId: o.rowId,
        columnId: o.column.id,
        row: o.row,
        column: o.column,
        format: format.id,
        resolveFileSrc: function (value) { return o.workspace.resolveUrl(value) },
      },
    }, 0)
    root.appendChild(content)
    ui.collect(root, function () { ui.dispose(content) })
    ui.bind(root, cell.diagnostic, function (diagnostic) {
      root.classList.toggle('aiditor-csv-cell-invalid', !!diagnostic)
      root.title = diagnostic ? diagnostic.message : ''
    })

    root.addEventListener('pointerdown', function (event) {
      event.stopPropagation()
      o.onSelect()
      begin()
      pointerActive = true
      const pointerId = event.pointerId
      function end(endEvent) {
        if (endEvent.pointerId !== pointerId) return
        document.removeEventListener('pointerup', end)
        document.removeEventListener('pointercancel', cancel)
        pointerActive = false
        if (!root.contains(document.activeElement)) finish()
      }
      function cancel(cancelEvent) {
        if (cancelEvent.pointerId !== pointerId) return
        document.removeEventListener('pointerup', end)
        document.removeEventListener('pointercancel', cancel)
        pointerActive = false
        o.onCancel()
        active = false
      }
      document.addEventListener('pointerup', end)
      document.addEventListener('pointercancel', cancel)
    })
    root.addEventListener('focusin', function () { begin() })
    root.addEventListener('focusout', function () {
      requestAnimationFrame(function () {
        if (!pointerActive && !root.contains(document.activeElement)) finish()
      })
    })
    root.addEventListener('keydown', function (event) { event.stopPropagation() })
    root.addEventListener('copy', function (event) { event.stopPropagation() })
    root.addEventListener('cut', function (event) { event.stopPropagation() })
    root.addEventListener('paste', function (event) { event.stopPropagation() })
    root.addEventListener('dblclick', function (event) { event.stopPropagation() })
    return root
  }
})(window.aiditor = window.aiditor || {})

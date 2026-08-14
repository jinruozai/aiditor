// CSV commands expose application-bindable actions; the framework binds no shortcuts.
;(function (aiditor) {
  'use strict'
  const csv = aiditor.ui.csv
  const owner = { owner: 'aiditor.csv', layer: 'core-ui' }

  function session(input) {
    const value = csv.sessions.get(input.sessionKey)
    if (!value) throw new Error('csv command: session not found: ' + input.sessionKey)
    return value
  }

  function range(input) {
    const selection = input.selection
    if (!selection) return { top: 0, bottom: 0, left: 0, right: 0 }
    return {
      top: Math.min(selection.anchor.row, selection.focus.row),
      bottom: Math.max(selection.anchor.row, selection.focus.row),
      left: Math.min(selection.anchor.column, selection.focus.column),
      right: Math.max(selection.anchor.column, selection.focus.column),
    }
  }

  function writable(input) {
    if (input.readOnly) throw new Error('csv command: panel is read-only')
  }

  function mutation(id, label, change) {
    aiditor.commands.register(id, {
      label: label,
      run: function (input) {
        writable(input)
        const active = session(input)
        return active.commit(label, change(active.document.value.peek(), range(input), input))
      },
    }, owner)
  }

  aiditor.commands.register('csv.save', {
    label: 'Save CSV',
    run: function (input) { writable(input); return session(input).save() },
  }, owner)
  aiditor.commands.register('csv.reload', {
    label: 'Reload CSV',
    run: function (input) { return session(input).reload() },
  }, owner)
  aiditor.commands.register('csv.undo', {
    label: 'Undo CSV edit',
    run: function (input) { writable(input); return session(input).undo() },
  }, owner)
  aiditor.commands.register('csv.redo', {
    label: 'Redo CSV edit',
    run: function (input) { writable(input); return session(input).redo() },
  }, owner)

  mutation('csv.row.insertAbove', 'Insert row above', function (doc, selected) {
    return csv.model.insertRows(doc, selected.top, 1)
  })
  mutation('csv.row.insertBelow', 'Insert row below', function (doc, selected) {
    return csv.model.insertRows(doc, selected.bottom + 1, 1)
  })
  mutation('csv.row.insertAboveCount', 'Insert rows above', function (doc, selected, input) {
    return csv.model.insertRows(doc, selected.top, input.count)
  })
  mutation('csv.row.insertBelowCount', 'Insert rows below', function (doc, selected, input) {
    return csv.model.insertRows(doc, selected.bottom + 1, input.count)
  })
  mutation('csv.row.delete', 'Delete rows', function (doc, selected) {
    return csv.model.deleteRows(doc, selected.top, selected.bottom - selected.top + 1)
  })
  mutation('csv.column.insertLeft', 'Insert column left', function (doc, selected) {
    return csv.model.insertColumn(doc, selected.left)
  })
  mutation('csv.column.insertRight', 'Insert column right', function (doc, selected) {
    return csv.model.insertColumn(doc, selected.right + 1)
  })
  mutation('csv.column.insertLeftCount', 'Insert columns left', function (doc, selected, input) {
    return csv.model.insertColumns(doc, selected.left, input.count)
  })
  mutation('csv.column.insertRightCount', 'Insert columns right', function (doc, selected, input) {
    return csv.model.insertColumns(doc, selected.right + 1, input.count)
  })
  mutation('csv.column.delete', 'Delete columns', function (doc, selected) {
    return csv.model.deleteColumns(doc, selected.left, selected.right - selected.left + 1)
  })

  aiditor.commands.register('csv.column.applyDefinition', {
    label: 'Apply CSV column definition',
    run: function (input) {
      writable(input)
      const active = session(input)
      if (!csv.formats.resolve(active.formatId).supportsColumnSchema) {
        throw new Error('csv column definitions require the gamecsv format')
      }
      const selected = range(input)
      const doc = active.document.value.peek()
      const current = doc.columns[selected.left]
      const definition = input.definition
      const patch = {
        name: input.keepName ? current.name : definition.name,
        fieldDef: definition.fieldDef,
        width: definition.width,
        align: definition.align,
        color: definition.color,
      }
      return active.commit('Paste column definition', csv.model.updateColumn(doc, selected.left, patch))
    },
  }, owner)
})(window.aiditor = window.aiditor || {})

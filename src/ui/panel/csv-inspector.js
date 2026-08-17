// CSV Inspector providers adapt cell/column selections to the shared Inspector.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv
  const owner = { owner: 'aiditor.csv', layer: 'core-ui' }

  function locate(target) {
    const session = csv.sessions.get(target.sessionKey)
    if (!session) return null
    const doc = session.document.value.peek()
    const row = target.rowId == null ? -1 : doc.rows.findIndex(function (item) { return item.id === target.rowId })
    const column = doc.columns.findIndex(function (item) { return item.id === target.columnId })
    return { session: session, doc: doc, row: row, column: column }
  }

  function subscribe(targets, refresh) {
    const active = locate(targets[0])
    if (!active) return function () {}
    let initial = true
    return aiditor.effect(function () {
      active.session.document.value()
      if (initial) { initial = false; return }
      refresh()
    })
  }

  aiditor.inspector.registerProvider('csv.cell', {
    targetId: function (target) {
      return target.sessionKey + ':row:' + target.rowId + ':column:' + target.columnId
    },
    inspect: function (targets) {
      const active = locate(targets[0])
      if (!active || active.row < 0 || active.column < 0) return null
      const column = active.doc.columns[active.column]
      return {
        key: targets[0].sessionKey + ':' + targets[0].columnId,
        schema: { value: Object.assign({ label: column.name }, column.fieldDef) },
        values: targets.map(function (target) {
          const at = locate(target)
          return { value: at.doc.rows[at.row].values[at.column] }
        }),
        readonly: targets.some(function (target) { return !!target.readOnly }),
        subscribe: function (refresh) { return subscribe(targets, refresh) },
        write: function (_field, change, ctx) {
          targets.forEach(function (target, index) {
            const at = locate(target)
            const current = { value: at.doc.rows[at.row].values[at.column] }
            const value = ctx.applyChange(current, change, ctx.schema).value
            at.session.commit('Edit ' + at.doc.columns[at.column].name, csv.model.setValue(at.doc, at.row, at.column, value))
          })
        },
      }
    },
  }, owner)

  function options(values) {
    const out = {}
    values.forEach(function (value) { out[value] = value || 'Type default' })
    return out
  }

  function columnValue(column) {
    const fieldDef = column.fieldDef || { type: 'var' }
    return {
      name: column.name,
      type: fieldDef.type || 'var',
      render: fieldDef.type_render || '',
      description: fieldDef.mem || '',
      tag: fieldDef.tag || '',
      defaultValue: fieldDef.default == null ? '' : fieldDef.default,
      typeArgs: Object.assign({}, fieldDef.type_agv || {}),
      structDef: Object.assign({}, fieldDef.struct_def || {}),
      width: column.width || 140,
      align: column.align || 'left',
      color: column.color || '',
    }
  }

  aiditor.inspector.registerProvider('csv.column', {
    targetId: function (target) {
      return target.sessionKey + ':column:' + target.columnId
    },
    inspect: function (targets) {
      const first = locate(targets[0])
      if (!first || first.column < 0) return null
      const format = csv.formats.resolve(first.doc.formatId)
      if (!format.supportsColumnSchema) {
        return {
          key: targets[0].sessionKey + ':columns',
          schema: { name: { type: 'string', label: 'Name' } },
          values: targets.map(function (target) {
            const at = locate(target)
            return { name: at.doc.columns[at.column].name }
          }),
          readonly: targets.some(function (target) { return !!target.readOnly }),
          subscribe: function (refresh) { return subscribe(targets, refresh) },
          write: function (_field, change, ctx) {
            targets.forEach(function (target, index) {
              const at = locate(target)
              const column = at.doc.columns[at.column]
              const name = ctx.valueForChange(change, target, index, ctx)
              at.session.commit('Rename column ' + column.name, csv.model.updateColumn(at.doc, at.column, { name: name }))
            })
          },
        }
      }
      const typeNames = Object.keys(ui.getTypeConfig())
      const renderNames = [''].concat(ui.listRenderKinds())
      return {
        key: targets[0].sessionKey + ':columns',
        schema: {
          name: { type: 'string', label: 'Name' },
          type: { type: 'enum_string', label: 'Type', type_agv: { options: options(typeNames) } },
          render: { type: 'enum_string', label: 'Renderer', type_agv: { options: options(renderNames) } },
          description: { type: 'string', label: 'Description' },
          tag: { type: 'string', label: 'Tag' },
          defaultValue: { type: 'var', label: 'Default value' },
          typeArgs: { type: 'dict', label: 'Type arguments', type_agv: { value_type: 'var' }, fieldLayout: 'block' },
          structDef: { type: 'dict', label: 'Struct fields', type_agv: { value_type: 'string' }, fieldLayout: 'block' },
          width: { type: 'int', label: 'Width' },
          align: { type: 'enum_string', label: 'Alignment', type_agv: { options: options(['left', 'center', 'right']) } },
          color: { type: 'string', label: 'Accent color' },
        },
        values: targets.map(function (target) { return columnValue(locate(target).doc.columns[locate(target).column]) }),
        readonly: targets.some(function (target) { return !!target.readOnly }),
        subscribe: function (refresh) { return subscribe(targets, refresh) },
        write: function (field, change, ctx) {
          targets.forEach(function (target, index) {
            const at = locate(target)
            const column = at.doc.columns[at.column]
            const value = ctx.valueForChange(change, target, index, ctx)
            let patch
            if (field === 'name' || field === 'width' || field === 'align' || field === 'color') {
              patch = {}; patch[field] = value
            } else {
              const fieldDef = Object.assign({}, column.fieldDef)
              if (field === 'type') fieldDef.type = value
              if (field === 'render') {
                if (value) fieldDef.type_render = value
                else delete fieldDef.type_render
              }
              if (field === 'description') {
                if (value) fieldDef.mem = value
                else delete fieldDef.mem
              }
              if (field === 'tag') {
                if (value) fieldDef.tag = value
                else delete fieldDef.tag
              }
              if (field === 'defaultValue') fieldDef.default = value
              if (field === 'typeArgs' || field.indexOf('typeArgs.') === 0 || field.indexOf('typeArgs[') === 0) {
                fieldDef.type_agv = ctx.applyChange(columnValue(column), change, ctx.schema).typeArgs
              }
              if (field === 'structDef' || field.indexOf('structDef.') === 0 || field.indexOf('structDef[') === 0) {
                fieldDef.struct_def = ctx.applyChange(columnValue(column), change, ctx.schema).structDef
              }
              patch = { fieldDef: fieldDef }
            }
            at.session.commit('Edit column ' + column.name, csv.model.updateColumn(at.doc, at.column, patch))
          })
        },
      }
    },
  }, owner)
})(window.aiditor = window.aiditor || {})

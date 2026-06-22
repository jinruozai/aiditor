// aiditor.ui.propertyList — keyed list of expandable property-backed objects.
//
// This is a composition primitive over ui.section + ui.propertyForm. It owns
// keyed item chrome and stable reconcile; hosts own object semantics, commands,
// validation, history, and persistence.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  /**
   * @aiditorApi aiditor.ui.propertyList
   * @group ui
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.ui.propertyList(opts)
   * @summary Render a stable keyed list of expandable schema-driven property blocks.
   * @param {object} opts - Property list options.
   * @param {Array|Signal<Array>} opts.items - Item array or signal. Refreshes reconcile by stable key.
   * @param {Function} opts.getKey - Stable item id resolver: (item, index) => id.
   * @param {Function} opts.schema - Schema resolver, object, or signal for each item body.
   * @param {Function} opts.onFieldChange - Optional field persistence hook: (itemId, field, value, meta) => void.
   * @returns {HTMLElement} Property list root element.
   * @related aiditor.ui.propertyForm,aiditor.ui.section,aiditor.ui.actionBar
   */
  ui.propertyList = function (opts) {
    const o = opts || {}
    const items = ui.asSig(o.items != null ? o.items : [])
    const getKey = typeof o.getKey === 'function'
      ? o.getKey
      : function (item, index) {
        return item && item.id != null ? item.id : index
      }
    const collapsedMap = o.collapsed != null ? ui.asSig(o.collapsed) : null
    const writeItems = typeof items.set === 'function' ? items.set : null
    const hasValueResolver = o.value != null
    const rows = new Map()

    const root = ui.h('div', 'aiditor-ui-property-list aiditor-ui-property-list-' + (o.density || 'compact'))
    root.setAttribute('role', 'list')
    root.setAttribute('aria-label', o.ariaLabel || 'Property list')
    const list = ui.h('div', 'aiditor-ui-property-list-items')
    const empty = ui.h('div', 'aiditor-ui-property-list-empty', { text: o.emptyText || 'No items' })
    root.appendChild(list)
    root.appendChild(empty)

    ui.bind(root, items, syncRows)
    if (collapsedMap) ui.bind(root, collapsedMap, refreshCollapsed)
    ui.collect(root, function () {
      rows.forEach(disposeRow)
      rows.clear()
    })
    return root

    function syncRows(nextItems) {
      const arr = Array.isArray(nextItems) ? nextItems : []
      const live = new Set()
      for (let i = 0; i < arr.length; i++) {
        const id = String(getKey(arr[i], i))
        live.add(id)
        let row = rows.get(id)
        if (!row) {
          row = buildRow(id)
          rows.set(id, row)
        }
        updateRow(row, arr[i], i, arr)
        list.appendChild(row.section)
      }
      rows.forEach(function (row, id) {
        if (!live.has(id)) {
          disposeRow(row)
          rows.delete(id)
        }
      })
      empty.hidden = arr.length > 0
    }

    function buildRow(id) {
      const valueSig = aiditor.signal({})
      const schemaSig = aiditor.signal({})
      const groupsSig = aiditor.signal({})
      const titleSig = aiditor.signal(id)
      const metaSig = aiditor.signal('')
      const actionsSig = aiditor.signal([])
      const actionCtxSig = aiditor.signal({})
      const itemCtxSig = aiditor.signal({})
      const collapsedSig = aiditor.signal(initialCollapsed(id))
      const row = {
        id: id,
        index: -1,
        item: null,
        valueSig: valueSig,
        schemaSig: schemaSig,
        groupsSig: groupsSig,
        titleSig: titleSig,
        metaSig: metaSig,
        actionsSig: actionsSig,
        actionCtxSig: actionCtxSig,
        itemCtxSig: itemCtxSig,
        collapsedSig: collapsedSig,
        form: null,
        section: null,
      }
      const targetsSig = aiditor.derived(function () { return [valueSig()] })
      const form = ui.propertyForm({
        targets: targetsSig,
        schema: schemaSig,
        groups: groupsSig,
        fieldActions: function (fieldCtx) { return fieldActions(row, fieldCtx) },
        fieldContextActions: function (fieldCtx) { return fieldContextActions(row, fieldCtx) },
        ctx: function (field) {
          return Object.assign({}, itemCtxSig.peek(), { field: field })
        },
        onChange: function (field, nv, _targets, meta) { writeField(row, field, nv, meta) },
      })
      ui.collect(form, function () {
        targetsSig.dispose()
        valueSig.dispose && valueSig.dispose()
        schemaSig.dispose && schemaSig.dispose()
        groupsSig.dispose && groupsSig.dispose()
        titleSig.dispose && titleSig.dispose()
        metaSig.dispose && metaSig.dispose()
        actionsSig.dispose && actionsSig.dispose()
        actionCtxSig.dispose && actionCtxSig.dispose()
        itemCtxSig.dispose && itemCtxSig.dispose()
        collapsedSig.dispose && collapsedSig.dispose()
      })
      form.classList.add('aiditor-ui-property-list-form')
      row.form = form
      const section = ui.section({
        title: titleSig,
        meta: metaSig,
        actions: actionsSig,
        actionCtx: actionCtxSig,
        collapsed: collapsedSig,
        onToggle: function (next) { setCollapsed(row, next) },
        children: [form],
      })
      section.classList.add('aiditor-ui-property-list-item')
      section.dataset.aiditorPropertyListId = id
      row.section = section
      return row
    }

    function updateRow(row, item, index, arr) {
      row.item = item
      row.index = index
      const itemCtx = makeItemCtx(row, item, index, arr)
      row.itemCtxSig.set(itemCtx)
      row.valueSig.set(itemCtx.value)
      row.schemaSig.set(resolveValue(o.schema, itemCtx, defaultSchemaFor(item)))
      row.groupsSig.set(resolveValue(o.groups, itemCtx, defaultGroupsFor(item)))
      row.titleSig.set(textValue(resolveValue(o.title, itemCtx, defaultTitleFor(row.id, item))))
      row.metaSig.set(textValue(resolveValue(o.meta, itemCtx, defaultMetaFor(item))))
      row.actionsSig.set(resolveActions(row, itemCtx))
      row.actionCtxSig.set(itemCtx)
      if (collapsedMap) row.collapsedSig.set(initialCollapsed(row.id))
    }

    function makeItemCtx(row, item, index, arr) {
      const value = resolveValue(o.value, {
        id: row.id,
        index: index,
        item: item,
        items: arr,
        ctx: o.ctx,
      }, defaultValueFor(item))
      return {
        id: row.id,
        index: index,
        item: item,
        value: value,
        items: arr,
        ctx: o.ctx,
      }
    }

    function writeField(row, field, value, meta) {
      const itemCtx = row.itemCtxSig.peek()
      const nextValue = Object.assign({}, row.valueSig.peek() || {}, { [field]: value })
      const outMeta = Object.assign({}, meta || {}, {
        itemId: row.id,
        item: row.item,
        index: row.index,
        itemCtx: itemCtx,
      })
      if (typeof o.onFieldChange === 'function') {
        aiditor.safeCall({ scope: 'propertyList', action: 'onFieldChange', id: row.id, field: field }, function () {
          o.onFieldChange(row.id, field, value, outMeta)
        })
        return
      }
      if (typeof o.onItemChange === 'function') {
        aiditor.safeCall({ scope: 'propertyList', action: 'onItemChange', id: row.id }, function () {
          o.onItemChange(row.id, nextValue, outMeta)
        })
        return
      }
      defaultWrite(row, nextValue)
    }

    function defaultWrite(row, nextValue) {
      if (!writeItems || hasValueResolver) return
      const arr = currentItems().slice()
      for (let i = 0; i < arr.length; i++) {
        if (String(getKey(arr[i], i)) !== row.id) continue
        arr[i] = itemWithValue(arr[i], nextValue)
        writeItems(arr)
        return
      }
    }

    function setCollapsed(row, next) {
      row.collapsedSig.set(!!next)
      if (collapsedMap && typeof collapsedMap.set === 'function') {
        const map = Object.assign({}, collapsedMap.peek() || {})
        map[row.id] = !!next
        collapsedMap.set(map)
      }
      if (typeof o.onToggle === 'function') {
        const ctx = row.itemCtxSig.peek()
        aiditor.safeCall({ scope: 'propertyList', action: 'onToggle', id: row.id }, function () {
          o.onToggle(row.id, !!next, { item: row.item, index: row.index, itemCtx: ctx })
        })
      }
    }

    function refreshCollapsed() {
      rows.forEach(function (row) { row.collapsedSig.set(initialCollapsed(row.id)) })
    }

    function initialCollapsed(id) {
      const map = collapsedMap ? (collapsedMap.peek() || {}) : null
      if (map && Object.prototype.hasOwnProperty.call(map, id)) return !!map[id]
      return !!o.defaultCollapsed
    }

    function resolveActions(row, itemCtx) {
      const fromOption = resolveValue(o.actions, itemCtx, null)
      if (fromOption != null) return Array.isArray(fromOption) ? fromOption : []
      const fromItem = row.item && row.item.actions
      const resolved = resolveValue(fromItem, itemCtx, [])
      return Array.isArray(resolved) ? resolved : []
    }

    function fieldActions(row, fieldCtx) {
      const itemCtx = row.itemCtxSig.peek()
      const ctx = Object.assign({}, fieldCtx || {}, {
        itemId: row.id,
        item: row.item,
        itemIndex: row.index,
        itemCtx: itemCtx,
      })
      const fromOption = resolveValue(o.fieldActions, ctx, null)
      if (fromOption != null) return fromOption
      const fromItem = row.item && row.item.fieldActions
      return resolveValue(fromItem, ctx, null)
    }

    function fieldContextActions(row, fieldCtx) {
      const itemCtx = row.itemCtxSig.peek()
      const ctx = Object.assign({}, fieldCtx || {}, {
        itemId: row.id,
        item: row.item,
        itemIndex: row.index,
        itemCtx: itemCtx,
      })
      const fromOption = resolveValue(o.fieldContextActions, ctx, null)
      if (fromOption != null) return fromOption
      const fromItem = row.item && row.item.fieldContextActions
      return resolveValue(fromItem, ctx, null)
    }

    function disposeRow(row) {
      ui.dispose(row.form)
      ui.dispose(row.section)
    }

    function currentItems() {
      const arr = items.peek()
      return Array.isArray(arr) ? arr : []
    }
  }

  function resolveValue(source, ctx, fallback) {
    if (source == null) return fallback
    if (ui.isSignal(source)) return source()
    if (typeof source === 'function') {
      const v = aiditor.safeCall({ scope: 'propertyList', action: 'resolve' }, function () { return source(ctx) })
      return v == null ? fallback : v
    }
    return source
  }

  function defaultValueFor(item) {
    return item && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item
  }

  function defaultSchemaFor(item) {
    return item && item.schema || {}
  }

  function defaultGroupsFor(item) {
    return item && item.groups || {}
  }

  function defaultTitleFor(id, item) {
    return item && item.title != null ? item.title : id
  }

  function defaultMetaFor(item) {
    return item && item.meta != null ? item.meta : ''
  }

  function itemWithValue(item, value) {
    if (item && Object.prototype.hasOwnProperty.call(item, 'value')) {
      return Object.assign({}, item, { value: value })
    }
    return value
  }

  function textValue(value) {
    return value == null ? '' : String(value)
  }
})(window.aiditor = window.aiditor || {})

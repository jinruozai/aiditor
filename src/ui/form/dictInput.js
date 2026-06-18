// aiditor.ui.dictInput — generic dynamic key/value dictionary editor.
//
// Dict keys are data. This component owns row chrome, key add/delete/rename,
// stable keyed reconcile, and value editor mounting. It does not own history,
// persistence, domain validation, or project semantics.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.dictInput = function (opts) {
    const o = opts || {}
    const value = ui.asSig(o.value != null ? o.value : {})
    const valueFieldDef = o.valueType
      ? ui.resolveFieldDef(typeof o.valueType === 'string' ? { type: o.valueType } : o.valueType)
      : ui.resolveFieldDef({ type: 'string' })
    const renderValue = typeof o.renderValue === 'function'
      ? o.renderValue
      : function (sig, write, ctx) { return ui.editorFor(valueFieldDef, sig, write, ctx) }
    const density = normalizeEnum(o.density, ['compact', 'comfortable'], 'compact')
    const ctx = o.ctx
    const writeDict = typeof o.onChange === 'function'
      ? function (next, meta) { o.onChange(next, meta) }
      : (typeof value.set === 'function' ? function (next) { value.set(next) } : null)

    const root = ui.h('div', 'aiditor-ui-dict-input aiditor-ui-dict-input-' + density)
    const rowsEl = ui.h('div', 'aiditor-ui-dict-input-rows')
    const emptyEl = ui.h('div', 'aiditor-ui-dict-input-empty', { text: o.emptyText || 'No entries' })
    const addBtn = ui.button({
      text: 'Add',
      icon: 'plus',
      kind: 'default',
      size: 'sm',
      onClick: function (event) { requestAdd(event) },
    })
    addBtn.classList.add('aiditor-ui-dict-input-add')
    root.appendChild(rowsEl)
    root.appendChild(emptyEl)
    root.appendChild(addBtn)

    const rows = new Map()
    let renameFrom = null
    let renameTo = null

    ui.collect(root, function () {
      rows.forEach(disposeRow)
      rows.clear()
      ui.dispose(addBtn)
    })
    ui.bind(root, value, syncRows)

    return root

    function currentDict() {
      const dict = value.peek()
      return dict && typeof dict === 'object' && !Array.isArray(dict) ? dict : {}
    }

    function canMutate(name, entryCtx) {
      if (name === 'add' && typeof o.canAdd === 'function') return !!o.canAdd(collectionCtx(null))
      if (name === 'delete' && typeof o.canDelete === 'function') return !!o.canDelete(entryCtx)
      if (name === 'rename' && typeof o.canRename === 'function') return !!o.canRename(entryCtx)
      if (name === 'editValue' && typeof o.canEditValue === 'function') return !!o.canEditValue(entryCtx)
      if (name === 'editValue' && typeof o.onValueChange === 'function') return true
      return !!writeDict || typeof o['on' + capitalize(name)] === 'function'
    }

    function syncRows(dict) {
      dict = dict && typeof dict === 'object' && !Array.isArray(dict) ? dict : {}
      const keys = Object.keys(dict)
      const live = new Set()
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        live.add(key)
        let row = rows.get(key)
        if (!row && renameTo === key && rows.has(renameFrom)) {
          row = rows.get(renameFrom)
          rows.delete(renameFrom)
          rows.set(key, row)
          renameFrom = null
          renameTo = null
        }
        if (!row) {
          row = buildRow(key, dict[key], i)
          rows.set(key, row)
        }
        updateRow(row, key, dict[key], i, dict)
        rowsEl.appendChild(row.el)
      }
      rows.forEach(function (row, key) {
        if (!live.has(key)) {
          disposeRow(row)
          rows.delete(key)
        }
      })
      emptyEl.hidden = keys.length > 0
      addBtn.hidden = !canMutate('add', null)
    }

    function buildRow(key, itemValue, index) {
      const row = ui.h('div', 'aiditor-ui-dict-input-row')
      row.dataset.aiditorDictKey = key
      const keyCell = ui.h('div', 'aiditor-ui-dict-input-key')
      const keyInput = ui.h('input', 'aiditor-ui-dict-input-key-input', { type: 'text' })
      const error = ui.h('div', 'aiditor-ui-dict-input-error')
      const valueCell = ui.h('div', 'aiditor-ui-dict-input-cell')
      const actions = ui.h('div', 'aiditor-ui-dict-input-actions')
      const valueSig = aiditor.signal(itemValue)
      const actionSig = aiditor.signal([])
      const actionCtxSig = aiditor.signal({})
      keyCell.appendChild(keyInput)
      keyCell.appendChild(error)
      row.appendChild(keyCell)
      row.appendChild(valueCell)
      row.appendChild(actions)

      const state = {
        el: row,
        keyCell: keyCell,
        keyInput: keyInput,
        error: error,
        valueCell: valueCell,
        actions: actions,
        valueSig: valueSig,
        actionSig: actionSig,
        actionCtxSig: actionCtxSig,
        key: key,
        index: index,
        value: itemValue,
        content: null,
        actionBar: null,
      }
      state.content = renderValue(readOnly(valueSig), function (next) {
        writeValue(state.key, next, null)
      }, entryCtx(key, itemValue, index, currentDict(), null))
      valueCell.appendChild(state.content)
      state.actionBar = ui.actionBar({ actions: actionSig, ctx: actionCtxSig, density: 'compact' })
      actions.appendChild(state.actionBar)

      keyInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); keyInput.blur() }
        else if (event.key === 'Escape') { event.preventDefault(); cancelRename(state) }
      })
      keyInput.addEventListener('blur', function () { commitRename(state, keyInput.value, null) })

      return state
    }

    function updateRow(row, key, itemValue, index, dict) {
      row.key = key
      row.index = index
      row.value = itemValue
      row.el.dataset.aiditorDictKey = key
      if (document.activeElement !== row.keyInput) row.keyInput.value = key
      row.valueSig.set(itemValue)
      const ectx = entryCtx(key, itemValue, index, dict, null)
      const canRename = canMutate('rename', ectx)
      const canEdit = canMutate('editValue', ectx)
      row.keyInput.readOnly = !canRename
      row.valueCell.toggleAttribute('inert', !canEdit)
      row.el.classList.toggle('is-disabled', !canEdit && !canRename)
      row.actionSig.set(rowActions(ectx))
      row.actionCtxSig.set(ectx)
      row.el.classList.toggle('aiditor-ui-dict-input-row-actions-empty', row.actionSig.peek().length === 0)
    }

    function rowActions(ectx) {
      const base = []
      if (typeof o.actions === 'function') {
        const extra = aiditor.safeCall({ scope: 'ui.dictInput', action: 'actions', key: ectx.key }, function () {
          return o.actions(ectx)
        })
        if (Array.isArray(extra)) for (let i = 0; i < extra.length; i++) base.push(extra[i])
      } else if (Array.isArray(o.actions)) {
        for (let i = 0; i < o.actions.length; i++) base.push(o.actions[i])
      }
      if (canMutate('delete', ectx)) {
        base.push({
          id: 'delete',
          icon: 'trash',
          title: 'Delete',
          variant: 'danger',
          onSelect: function () { requestDelete(ectx.key, null) },
        })
      }
      return base
    }

    function requestAdd(event) {
      const dict = currentDict()
      const key = nextKey(dict, event)
      const normalized = normalizeKey(key, event)
      const error = keyError(normalized, null, dict, event)
      if (error) return
      const itemValue = createValue(normalized, event)
      if (typeof o.onAdd === 'function') { o.onAdd(normalized, itemValue, collectionMeta(event)); return }
      writeWhole(Object.assign({}, dict, { [normalized]: itemValue }), { op: 'add', key: normalized, event: event || null })
    }

    function requestDelete(key, event) {
      const dict = currentDict()
      if (!Object.prototype.hasOwnProperty.call(dict, key)) return
      const ectx = entryCtx(key, dict[key], Object.keys(dict).indexOf(key), dict, event)
      if (!canMutate('delete', ectx)) return
      if (typeof o.onDelete === 'function') { o.onDelete(key, entryMeta(key, event)); return }
      const next = Object.assign({}, dict)
      delete next[key]
      writeWhole(next, { op: 'delete', key: key, event: event || null })
    }

    function commitRename(row, rawKey, event) {
      const fromKey = row.key
      const dict = currentDict()
      const toKey = normalizeKey(rawKey, event)
      if (toKey === fromKey) { clearError(row); row.keyInput.value = fromKey; return }
      const error = keyError(toKey, fromKey, dict, event)
      if (error) { showError(row, error); return }
      const ectx = entryCtx(fromKey, dict[fromKey], row.index, dict, event)
      if (!canMutate('rename', ectx)) { row.keyInput.value = fromKey; return }
      renameFrom = fromKey
      renameTo = toKey
      if (typeof o.onRename === 'function') { o.onRename(fromKey, toKey, entryMeta(fromKey, event)); return }
      const next = {}
      const keys = Object.keys(dict)
      for (let i = 0; i < keys.length; i++) next[keys[i] === fromKey ? toKey : keys[i]] = dict[keys[i]]
      writeWhole(next, { op: 'rename', fromKey: fromKey, key: toKey, event: event || null })
    }

    function cancelRename(row) {
      clearError(row)
      row.keyInput.value = row.key
      row.keyInput.blur()
    }

    function writeValue(key, nextValue, event) {
      const dict = currentDict()
      if (!Object.prototype.hasOwnProperty.call(dict, key)) return
      if (Object.is(dict[key], nextValue)) return
      const ectx = entryCtx(key, dict[key], Object.keys(dict).indexOf(key), dict, event)
      if (!canMutate('editValue', ectx)) return
      if (typeof o.onValueChange === 'function') { o.onValueChange(key, nextValue, entryMeta(key, event)); return }
      const next = Object.assign({}, dict, { [key]: nextValue })
      writeWhole(next, { op: 'value', key: key, event: event || null })
    }

    function writeWhole(next, meta) {
      if (writeDict) writeDict(next, meta)
    }

    function normalizeKey(key, event) {
      const raw = String(key == null ? '' : key)
      return typeof o.normalizeKey === 'function'
        ? String(o.normalizeKey(raw, collectionCtx(event)))
        : raw.trim()
    }

    function keyError(key, previousKey, dict, event) {
      if (!key) return 'Key required'
      if (Object.prototype.hasOwnProperty.call(dict, key) && key !== previousKey) return 'Key already exists'
      if (typeof o.validateKey === 'function') {
        const result = o.validateKey(key, collectionCtx(event))
        if (result !== true) return result || 'Invalid key'
      }
      return ''
    }

    function nextKey(dict, event) {
      if (typeof o.createKey === 'function') return o.createKey(collectionCtx(event))
      let index = 1
      let key = 'key'
      while (Object.prototype.hasOwnProperty.call(dict, key)) key = 'key' + (++index)
      return key
    }

    function createValue(key, event) {
      if (typeof o.createValue === 'function') return o.createValue(entryCtx(key, undefined, -1, currentDict(), event))
      if (Object.prototype.hasOwnProperty.call(o, 'defaultValue')) return cloneItem(o.defaultValue)
      return valueFieldDef && valueFieldDef.default !== undefined ? cloneItem(valueFieldDef.default) : undefined
    }

    function showError(row, message) {
      row.error.textContent = String(message || '')
      row.el.classList.add('has-error')
    }

    function clearError(row) {
      row.error.textContent = ''
      row.el.classList.remove('has-error')
    }

    function entryCtx(key, itemValue, index, dict, event) {
      return { key: key, value: itemValue, index: index, dict: dict, ctx: ctx, event: event || null }
    }

    function collectionCtx(event) {
      return { dict: currentDict(), ctx: ctx, event: event || null }
    }

    function collectionMeta(event) {
      return { dict: currentDict(), ctx: ctx, event: event || null }
    }

    function entryMeta(key, event) {
      return { key: key, dict: currentDict(), ctx: ctx, event: event || null }
    }

    function disposeRow(row) {
      if (row.content) ui.dispose(row.content)
      if (row.actionBar) ui.dispose(row.actionBar)
      ui.dispose(row.el)
    }
  }

  function normalizeEnum(value, options, fallback) {
    return options.indexOf(value) >= 0 ? value : fallback
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
  }

  function readOnly(sig) {
    const read = function () { return sig() }
    read.peek = function () { return sig.peek() }
    return read
  }

  function cloneItem(item) {
    if (item == null || typeof item !== 'object') return item
    return JSON.parse(JSON.stringify(item))
  }
})(window.aiditor = window.aiditor || {})

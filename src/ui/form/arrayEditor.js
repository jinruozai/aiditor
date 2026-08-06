// aiditor.ui.arrayEditor — generic array row editor.
//
// Framework boundary: this component owns array-row interaction only. Items are
// opaque values; project semantics, history grouping, reference repair, and
// domain validation belong to the host.
// `createItem(ctx)` may return an item or Promise<Item|undefined>; the array is
// changed only after one complete item resolves, and undefined means cancel.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}
  let itemBodyId = 0

  const EDITABLE_SELECTOR = 'input,textarea,select,[contenteditable],[role="textbox"],[role="searchbox"]'
  const DEFAULT_CAPS = { add: true, delete: true, duplicate: false, reorder: true, keyboard: true }

  ui.arrayEditor = function (opts) {
    const o = opts || {}
    const items = ui.asSig(o.items != null ? o.items : [])
    const selected = ui.asSig(o.selected != null ? o.selected : [])
    const active = ui.asSig(o.active != null ? o.active : null)
    const hasStableKey = typeof o.getKey === 'function'
    const getKey = hasStableKey ? o.getKey : function (_, index) { return index }
    const renderItem = typeof o.renderItem === 'function' ? o.renderItem : defaultRenderItem
    const selectionMode = normalizeEnum(o.selectionMode, ['none', 'single', 'multi'], hasStableKey ? 'single' : 'none')
    const indexMode = normalizeEnum(o.indexMode, ['none', 'number', 'handle', 'number-handle'], 'number')
    const density = normalizeEnum(o.density, ['compact', 'comfortable'], 'compact')
    const actions = normalizeEnum(o.actions, ['auto', 'none', 'end'], 'auto')
    const itemLayout = normalizeEnum(o.itemLayout, ['inline', 'section'], 'inline')
    const caps = Object.assign({}, DEFAULT_CAPS, o.capabilities || {})
    if (!hasStableKey && (!o.capabilities || o.capabilities.keyboard == null)) caps.keyboard = false
    const writeItems = typeof o.onChange === 'function'
      ? function (next, meta) { o.onChange(next, meta) }
      : (typeof items.set === 'function' ? function (next) { items.set(next) } : null)

    let anchorKey = null
    let drag = null
    let order = []
    let suppressChromeClickKey = null
    let addPending = false
    let disposed = false
    const rows = new Map()

    const root = ui.h('div', 'aiditor-ui-array-editor aiditor-ui-array-editor-' + density + ' aiditor-ui-array-editor-index-' + indexMode + ' aiditor-ui-array-editor-layout-' + itemLayout)
    root.setAttribute('role', 'listbox')
    root.setAttribute('tabindex', '0')
    root.setAttribute('aria-label', o.ariaLabel || 'Array editor')
    const list = ui.h('div', 'aiditor-ui-array-editor-rows')
    const empty = ui.h('div', 'aiditor-ui-array-editor-empty', { text: o.emptyText || 'No items' })
    const dropLine = ui.h('div', 'aiditor-ui-array-editor-drop-line')
    root.appendChild(list)
    root.appendChild(empty)

    const addBtn = ui.button({
      text: 'Add',
      kind: 'default',
      size: 'sm',
      onClick: function (event) { requestAdd(event) },
    })
    addBtn.classList.add('aiditor-ui-array-editor-add')
    root.appendChild(addBtn)

    root.addEventListener('keydown', onKeydown)
    ui.collect(root, function () {
      disposed = true
      cancelDrag(null)
      rows.forEach(disposeRow)
      rows.clear()
      disposeOwned(addBtn)
    })

    ui.bind(root, items, syncRows)
    ui.bind(root, selected, updateRowStates)
    ui.bind(root, active, updateRowStates)

    return root

    function currentItems() {
      const arr = items.peek()
      return Array.isArray(arr) ? arr : []
    }

    function operationAvailable(name) {
      if (caps[name] === false) return false
      if (name === 'add' && typeof o.onAdd === 'function') return true
      if (name === 'delete' && typeof o.onDelete === 'function') return true
      if (name === 'duplicate' && typeof o.onDuplicate === 'function') return true
      if (name === 'reorder' && typeof o.onReorder === 'function') return true
      return !!writeItems
    }

    function collectionCtx(event) {
      return {
        items: currentItems(),
        selected: selectedKeys(),
        active: active.peek(),
        event: event || null,
        anchor: (event && event.currentTarget) || addBtn,
        ctx: o.ctx || null,
      }
    }

    function syncRows(arr) {
      arr = Array.isArray(arr) ? arr : []
      const live = new Set()
      order = []
      for (let i = 0; i < arr.length; i++) {
        const key = getKey(arr[i], i)
        order.push(key)
        live.add(key)
        let row = rows.get(key)
        if (!row) {
          row = buildRow(key, arr[i], i)
          rows.set(key, row)
        }
        updateRow(row, arr[i], i)
        list.appendChild(row.el)
      }
      rows.forEach(function (row, key) {
        if (!live.has(key)) {
          disposeRow(row)
          rows.delete(key)
        }
      })
      empty.hidden = arr.length > 0
      updateAddState()
      if (dropLine.parentNode) list.appendChild(dropLine)
      updateRowStates()
    }

    function buildRow(key, item, index) {
      const row = ui.h('div', 'aiditor-ui-array-editor-row')
      row.setAttribute('role', 'option')
      const chrome = ui.h('button', 'aiditor-ui-array-editor-index', { type: 'button' })
      const cell = ui.h('div', 'aiditor-ui-array-editor-cell')
      const actionBox = ui.h('div', 'aiditor-ui-array-editor-actions')
      const head = itemLayout === 'section' ? ui.h('div', 'aiditor-ui-array-editor-row-head') : null
      const body = itemLayout === 'section' ? ui.h('div', 'aiditor-ui-array-editor-row-body') : null
      const valueSig = aiditor.signal(item)
      const selectedSig = aiditor.signal(false)
      const activeSig = aiditor.signal(false)
      const disabledSig = aiditor.signal(false)
      const draggingSig = aiditor.signal(false)
      const value = readOnly(valueSig)
      const state = {
        el: row,
        chrome: chrome,
        cell: cell,
        actionBox: actionBox,
        head: head,
        body: body,
        toggle: null,
        collapsed: !!o.defaultCollapsed,
        valueSig: valueSig,
        selectedSig: selectedSig,
        activeSig: activeSig,
        disabledSig: disabledSig,
        draggingSig: draggingSig,
        value: value,
        key: key,
        item: item,
        index: index,
        ctx: null,
        content: null,
        deleteBtn: null,
        duplicateBtn: null,
      }
      const ctx = {
        key: key,
        index: index,
        item: item,
        value: value,
        selected: false,
        active: false,
        disabled: false,
        dragging: false,
        state: {
          selected: readOnly(selectedSig),
          active: readOnly(activeSig),
          disabled: readOnly(disabledSig),
          dragging: readOnly(draggingSig),
        },
        writeItem: function (next, meta) { writeItem(state.key, next, meta) },
        setActive: function () { setActiveKey(state.key, { source: 'item' }) },
        select: function (event) { selectKey(state.key, event || {}, state.index) },
        requestDelete: function (event) { requestDelete(keysForRow(state.key), event || null) },
        requestDuplicate: function (event) { requestDuplicate(keysForRow(state.key), event || null) },
      }
      state.ctx = ctx

      if (itemLayout === 'section') {
        state.toggle = ui.iconButton({
          icon: 'chevron-down',
          title: 'Collapse item',
          size: 'sm',
          kind: 'ghost',
          onClick: function () { setRowCollapsed(state, !state.collapsed) },
        })
      }

      chrome.addEventListener('click', function (event) {
        event.preventDefault()
        root.focus()
        if (suppressChromeClickKey === state.key) {
          suppressChromeClickKey = null
          return
        }
        selectKey(state.key, event, state.index)
      })
      chrome.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return
        if (!operationAvailable('reorder')) return
        const keys = keysForRow(state.key)
        const indices = indicesForKeys(keys)
        const insertIndex = normalizeInsertIndex(state.index, indices, order.length)
        if (!canReorderIndices(indices, insertIndex, event)) return
        startDrag(state, event)
      })

      if (itemLayout === 'section') {
        const toggle = state.toggle
        toggle.classList.add('aiditor-ui-array-editor-row-toggle')
        body.id = 'aiditor-array-item-' + (++itemBodyId)
        head.appendChild(toggle)
        head.appendChild(chrome)
        if (actions !== 'none') head.appendChild(actionBox)
        body.appendChild(cell)
        row.appendChild(head)
        row.appendChild(body)
        toggle.setAttribute('aria-controls', body.id)
        setRowCollapsed(state, state.collapsed)
      } else {
        row.appendChild(chrome)
        row.appendChild(cell)
        if (actions !== 'none') row.appendChild(actionBox)
      }
      state.content = renderItem(item, index, ctx) || ui.h('span', null, { text: '' })
      cell.appendChild(state.content)
      rebuildActions(state)
      return state
    }

    function updateRow(row, item, index) {
      row.item = item
      row.index = index
      row.key = getKey(item, index)
      row.valueSig.set(item)
      row.ctx.key = row.key
      row.ctx.index = index
      row.ctx.item = item
      row.chrome.textContent = indexLabel(index)
      row.chrome.hidden = indexMode === 'none'
      row.chrome.classList.toggle('aiditor-ui-array-editor-handle', indexMode === 'handle' || indexMode === 'number-handle')
      row.chrome.disabled = !canSelect(item, index, null) && !operationAvailable('reorder')
      updateActionState(row)
    }

    function indexLabel(index) {
      if (indexMode === 'handle') return '::'
      if (indexMode === 'number-handle') return '[' + index + '] ::'
      return '[' + index + ']'
    }

    function rebuildActions(row) {
      row.actionBox.replaceChildren()
      if (actions === 'none') return
      if (caps.duplicate !== false) {
        row.duplicateBtn = ui.iconButton({
          icon: 'copy',
          title: 'Duplicate',
          size: 'sm',
          kind: 'ghost',
          onClick: function (event) { requestDuplicate(keysForRow(row.key), event) },
        })
        row.actionBox.appendChild(row.duplicateBtn)
      }
      if (caps.delete !== false) {
        row.deleteBtn = ui.iconButton({
          icon: 'trash',
          title: 'Delete',
          size: 'sm',
          kind: 'ghost',
          onClick: function (event) { requestDelete(keysForRow(row.key), event) },
        })
        row.actionBox.appendChild(row.deleteBtn)
      }
      updateActionState(row)
    }

    function updateActionState(row) {
      if (row.deleteBtn) {
        row.deleteBtn.hidden = !operationAvailable('delete')
        row.deleteBtn.disabled = !canDeleteKeys([row.key], null)
      }
      if (row.duplicateBtn) {
        row.duplicateBtn.hidden = !operationAvailable('duplicate')
        row.duplicateBtn.disabled = !canDuplicateKeys([row.key], null)
      }
    }

    function disposeRow(row) {
      disposeOwned(row.toggle)
      disposeOwned(row.duplicateBtn)
      disposeOwned(row.deleteBtn)
      ui.dispose(row.content)
      if (row.value && row.value.dispose) row.value.dispose()
      if (row.el.parentNode) row.el.parentNode.removeChild(row.el)
    }

    function setRowCollapsed(row, collapsed) {
      row.collapsed = !!collapsed
      row.el.classList.toggle('is-collapsed', row.collapsed)
      row.body.hidden = row.collapsed
      row.toggle.setAttribute('aria-expanded', row.collapsed ? 'false' : 'true')
      row.toggle.setAttribute('aria-label', row.collapsed ? 'Expand item' : 'Collapse item')
      row.toggle.setAttribute('title', row.collapsed ? 'Expand item' : 'Collapse item')
    }

    function disposeOwned(el) {
      if (!el) return
      ui.disposeChildren(el)
      ui.dispose(el)
    }

    function defaultRenderItem(_, __, ctx) {
      return ui.input({ value: ctx.value, onChange: ctx.writeItem, readOnly: !writeItems })
    }

    function readOnly(sig) {
      const out = function () { return sig() }
      out.peek = function () { return sig.peek() }
      return out
    }

    function writeItem(key, next, meta) {
      if (!writeItems) return
      const arr = currentItems()
      const index = indexOfKey(key)
      if (index < 0 || arr[index] === next) return
      const nextItems = arr.slice()
      nextItems[index] = next
      writeItems(nextItems, Object.assign({ kind: 'item', key: key, index: index, item: arr[index], nextItem: next, items: arr, nextItems: nextItems }, meta || {}))
    }

    function selectedKeys() {
      const arr = selected.peek()
      return Array.isArray(arr) ? arr.slice() : []
    }

    function selectedSet() {
      return new Set(selectedKeys())
    }

    function setSelectedKeys(keys, meta) {
      let next = keys.slice()
      if (selectionMode === 'none') next = []
      if (selectionMode === 'single' && next.length > 1) next = next.slice(0, 1)
      if (o.selected != null && typeof o.onSelect === 'function') o.onSelect(next, meta || {})
      else if (typeof selected.set === 'function') selected.set(next)
      if (o.selected == null && typeof o.onSelect === 'function') o.onSelect(next, meta || {})
    }

    function setActiveKey(key, meta) {
      if (o.active != null && typeof o.onActiveChange === 'function') o.onActiveChange(key, meta || {})
      else if (typeof active.set === 'function') active.set(key)
      if (o.active == null && typeof o.onActiveChange === 'function') o.onActiveChange(key, meta || {})
    }

    function selectKey(key, event, index) {
      const arr = currentItems()
      const row = rows.get(key)
      if (!row || !canSelect(row.item, row.index, event)) return
      setActiveKey(key, { source: 'select', key: key, index: index, event: event || null })
      if (selectionMode === 'none') return
      const cur = selectedKeys()
      let next = [key]
      if (selectionMode === 'multi' && event && event.shiftKey && anchorKey != null) {
        const a = indexOfKey(anchorKey)
        if (a >= 0) {
          const lo = Math.min(a, index)
          const hi = Math.max(a, index)
          next = arr.slice(lo, hi + 1).map(function (item, offset) { return getKey(item, lo + offset) })
        }
      } else if (selectionMode === 'multi' && event && (event.ctrlKey || event.metaKey)) {
        const at = cur.indexOf(key)
        next = at >= 0 ? cur.slice(0, at).concat(cur.slice(at + 1)) : cur.concat([key])
        anchorKey = key
      } else {
        anchorKey = key
      }
      setSelectedKeys(next, { source: 'select', key: key, index: index, event: event || null })
    }

    function updateRowStates() {
      const sel = selectedSet()
      const activeKey = active.peek()
      rows.forEach(function (row) {
        const isSelected = sel.has(row.key)
        const isActive = row.key === activeKey
        const isDisabled = !canSelect(row.item, row.index, null)
        row.ctx.selected = isSelected
        row.ctx.active = isActive
        row.ctx.disabled = isDisabled
        row.ctx.dragging = drag && drag.started ? drag.keySet.has(row.key) : false
        row.selectedSig.set(isSelected)
        row.activeSig.set(isActive)
        row.disabledSig.set(isDisabled)
        row.draggingSig.set(row.ctx.dragging)
        row.el.classList.toggle('is-selected', isSelected)
        row.el.classList.toggle('is-active', isActive)
        row.el.classList.toggle('is-disabled', isDisabled)
        row.el.classList.toggle('is-dragging', !!(drag && drag.started && drag.keySet.has(row.key)))
        row.el.setAttribute('aria-selected', isSelected ? 'true' : 'false')
        updateActionState(row)
      })
    }

    function canSelect(item, index, event) {
      return !o.canSelect || o.canSelect(item, index, Object.assign(collectionCtx(event), { index: index, item: item })) !== false
    }

    function canAdd(event) {
      if (addPending || !operationAvailable('add') || o.canAdd === false) return false
      return typeof o.canAdd !== 'function' || o.canAdd(collectionCtx(event)) !== false
    }

    function requestAdd(event) {
      if (!canAdd(event)) return
      const ctx = collectionCtx(event)
      const item = typeof o.createItem === 'function'
        ? aiditor.safeCall({ scope: 'ui.arrayEditor', action: 'createItem' }, function () { return o.createItem(ctx) })
        : ''
      if (item && typeof item.then === 'function') {
        setAddPending(true)
        Promise.resolve(item).then(function (resolved) {
          if (!disposed && resolved !== undefined) appendItem(resolved, ctx)
        }).catch(function (error) {
          aiditor.reportError(error, { scope: 'ui.arrayEditor', action: 'createItem' })
        }).finally(function () {
          if (!disposed) setAddPending(false)
        })
        return
      }
      if (item !== undefined) appendItem(item, ctx)
    }

    function appendItem(item, ctx) {
      const arr = currentItems()
      const nextItems = arr.concat([item])
      const key = getKey(item, arr.length)
      const meta = Object.assign({}, ctx, { kind: 'add', index: arr.length, key: key, item: item, items: arr, nextItems: nextItems })
      if (typeof o.onAdd === 'function') o.onAdd(meta)
      else writeItems(nextItems, meta)
      commit(meta)
    }

    function setAddPending(next) {
      addPending = next
      updateAddState()
    }

    function updateAddState() {
      addBtn.hidden = !operationAvailable('add')
      addBtn.disabled = !canAdd(null)
      if (addPending) addBtn.setAttribute('aria-busy', 'true')
      else addBtn.removeAttribute('aria-busy')
      root.classList.toggle('is-add-pending', addPending)
    }

    function keysForRow(key) {
      const sel = selectedKeys()
      return selectionMode === 'multi' && sel.indexOf(key) >= 0 ? sel : [key]
    }

    function indicesForKeys(keys) {
      const out = []
      for (let i = 0; i < keys.length; i++) {
        const index = indexOfKey(keys[i])
        if (index >= 0 && out.indexOf(index) < 0) out.push(index)
      }
      out.sort(function (a, b) { return a - b })
      return out
    }

    function canDeleteKeys(keys, event) {
      if (!operationAvailable('delete')) return false
      const arr = currentItems()
      const indices = indicesForKeys(keys)
      if (!indices.length) return false
      for (let i = 0; i < indices.length; i++) {
        const index = indices[i]
        if (o.canDelete && o.canDelete(arr[index], index, collectionCtx(event)) === false) return false
      }
      return !o.canDeleteSelection || o.canDeleteSelection(indices.map(function (i) { return arr[i] }), indices, collectionCtx(event)) !== false
    }

    function requestDelete(keys, event) {
      if (!canDeleteKeys(keys, event)) return
      const arr = currentItems()
      const indices = indicesForKeys(keys)
      const keyList = indices.map(function (index) { return getKey(arr[index], index) })
      const remove = new Set(indices)
      const nextItems = arr.filter(function (_, index) { return !remove.has(index) })
      const meta = Object.assign(collectionCtx(event), { kind: 'delete', keys: keyList, indices: indices, items: arr, nextItems: nextItems })
      if (typeof o.onDelete === 'function') o.onDelete(meta)
      else {
        writeItems(nextItems, meta)
        setSelectedKeys(selectedKeys().filter(function (key) { return keyList.indexOf(key) < 0 }), meta)
        if (keyList.indexOf(active.peek()) >= 0) setActiveKey(nextItems.length ? getKey(nextItems[Math.min(indices[0], nextItems.length - 1)], Math.min(indices[0], nextItems.length - 1)) : null, meta)
      }
      commit(meta)
    }

    function canDuplicateKeys(keys, event) {
      if (!operationAvailable('duplicate')) return false
      const arr = currentItems()
      const indices = indicesForKeys(keys)
      if (!indices.length) return false
      for (let i = 0; i < indices.length; i++) {
        const index = indices[i]
        if (o.canDuplicate && o.canDuplicate(arr[index], index, collectionCtx(event)) === false) return false
      }
      return !o.canDuplicateSelection || o.canDuplicateSelection(indices.map(function (i) { return arr[i] }), indices, collectionCtx(event)) !== false
    }

    function requestDuplicate(keys, event) {
      if (!canDuplicateKeys(keys, event)) return
      const arr = currentItems()
      const indices = indicesForKeys(keys)
      const copies = indices.map(function (index) {
        return typeof o.duplicateItem === 'function'
          ? o.duplicateItem(arr[index], index, collectionCtx(event))
          : cloneItem(arr[index])
      })
      const insertAt = indices[indices.length - 1] + 1
      const nextItems = arr.slice(0, insertAt).concat(copies, arr.slice(insertAt))
      const copyKeys = copies.map(function (item, i) { return getKey(item, insertAt + i) })
      const meta = Object.assign(collectionCtx(event), { kind: 'duplicate', keys: indices.map(function (index) { return getKey(arr[index], index) }), indices: indices, insertIndex: insertAt, copies: copies, nextItems: nextItems })
      if (typeof o.onDuplicate === 'function') o.onDuplicate(meta)
      else {
        writeItems(nextItems, meta)
        setSelectedKeys(copyKeys, meta)
        if (copyKeys.length) setActiveKey(copyKeys[0], meta)
      }
      commit(meta)
    }

    function cloneItem(item) {
      if (item == null || typeof item !== 'object') return item
      return JSON.parse(JSON.stringify(item))
    }

    function canReorderIndices(indices, insertIndex, event) {
      if (!operationAvailable('reorder')) return false
      if (!indices.length) return false
      const ctx = collectionCtx(event)
      return !o.canReorder || o.canReorder(indices.slice(), insertIndex, ctx) !== false
    }

    function commitReorder(indices, insertIndex, event) {
      if (!canReorderIndices(indices, insertIndex, event)) return
      const arr = currentItems()
      const nextItems = reorderItems(arr, indices, insertIndex)
      const keyList = indices.map(function (index) { return getKey(arr[index], index) })
      if (sameItemOrder(arr, nextItems)) return
      const insertBeforeKey = insertBeforeKeyFrom(arr, indices, insertIndex)
      const meta = Object.assign(collectionCtx(event), {
        kind: 'reorder',
        keys: keyList,
        indices: indices.slice(),
        insertIndex: insertIndex,
        insertBeforeKey: insertBeforeKey,
        items: arr,
        nextItems: nextItems,
      })
      if (typeof o.onReorder === 'function') o.onReorder(meta)
      else writeItems(nextItems, meta)
      commit(meta)
    }

    function reorderItems(arr, indices, insertIndex) {
      const moving = indices.map(function (index) { return arr[index] })
      const indexSet = new Set(indices)
      const remaining = arr.filter(function (_, index) { return !indexSet.has(index) })
      return remaining.slice(0, insertIndex).concat(moving, remaining.slice(insertIndex))
    }

    function normalizeInsertIndex(rawIndex, indices, length) {
      let insertIndex = Math.max(0, Math.min(length, rawIndex))
      for (let i = 0; i < indices.length; i++) if (indices[i] < rawIndex) insertIndex--
      return Math.max(0, Math.min(length - indices.length, insertIndex))
    }

    function sameItemOrder(a, b) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
      return true
    }

    function startDrag(row, event) {
      root.focus()
      const keys = keysForRow(row.key)
      const indices = indicesForKeys(keys)
      const keySet = new Set(keys)
      const startY = Number.isFinite(event.clientY) ? event.clientY : 0
      const threshold = ui.readNum ? ui.readNum('--aiditor-drag-threshold', 6) : 6
      drag = {
        row: row,
        keys: keys,
        keySet: keySet,
        indices: indices,
        insertIndex: normalizeInsertIndex(row.index, indices, order.length),
        accepted: true,
        started: false,
        startY: startY,
        threshold: threshold,
      }
      document.addEventListener('pointermove', onDragMove)
      document.addEventListener('pointerup', onDragEnd)
      document.addEventListener('pointercancel', onDragCancel)
    }

    function onDragMove(event) {
      if (!drag) return
      const y = Number.isFinite(event.clientY) ? event.clientY : drag.startY
      if (!drag.started) {
        if (Math.abs(y - drag.startY) < drag.threshold) return
        drag.started = true
        suppressChromeClickKey = drag.row.key
        updateRowStates()
      }
      event.preventDefault()
      const raw = rawInsertIndex(y)
      const insertIndex = normalizeInsertIndex(raw, drag.indices, order.length)
      const meta = reorderMeta(drag.indices, insertIndex, event)
      const preview = typeof o.onPreviewReorder === 'function' ? o.onPreviewReorder(drag.indices.slice(), insertIndex, meta) : true
      drag.insertIndex = insertIndex
      drag.accepted = preview !== false && canReorderIndices(drag.indices, insertIndex, event)
      root.classList.toggle('is-drop-reject', !drag.accepted)
      placeDropLine(insertIndex)
    }

    function onDragEnd(event) {
      if (!drag) return
      if (!drag.started) {
        clearDrag()
        return
      }
      const indices = drag.indices.slice()
      const insertIndex = drag.insertIndex
      const accepted = drag.accepted
      const meta = reorderMeta(indices, insertIndex, event)
      clearDrag()
      if (accepted) commitReorder(indices, insertIndex, event)
      else if (typeof o.onCancel === 'function') o.onCancel(meta)
    }

    function onDragCancel(event) {
      cancelDrag(event)
    }

    function cancelDrag(event) {
      if (!drag) return
      const started = drag.started
      const meta = started ? reorderMeta(drag.indices, drag.insertIndex, event) : null
      clearDrag()
      if (started && typeof o.onCancel === 'function') o.onCancel(meta)
    }

    function clearDrag() {
      document.removeEventListener('pointermove', onDragMove)
      document.removeEventListener('pointerup', onDragEnd)
      document.removeEventListener('pointercancel', onDragCancel)
      if (dropLine.parentNode) dropLine.parentNode.removeChild(dropLine)
      root.classList.remove('is-drop-reject')
      drag = null
      updateRowStates()
    }

    function rawInsertIndex(y) {
      const arr = currentItems()
      for (let i = 0; i < arr.length; i++) {
        const key = getKey(arr[i], i)
        const row = rows.get(key)
        if (!row || !row.el.getBoundingClientRect) continue
        const rect = row.el.getBoundingClientRect()
        if (y < rect.top + rect.height / 2) return i
      }
      return arr.length
    }

    function placeDropLine(insertIndex) {
      const beforeKey = insertBeforeKeyFrom(currentItems(), drag.indices, insertIndex)
      const beforeRow = beforeKey != null ? rows.get(beforeKey) : null
      list.insertBefore(dropLine, beforeRow ? beforeRow.el : null)
    }

    function reorderMeta(indices, insertIndex, event) {
      const arr = currentItems()
      const nextItems = reorderItems(arr, indices, insertIndex)
      return Object.assign(collectionCtx(event), {
        kind: 'reorder',
        keys: indices.map(function (index) { return getKey(arr[index], index) }),
        indices: indices.slice(),
        insertIndex: insertIndex,
        insertBeforeKey: insertBeforeKeyFrom(arr, indices, insertIndex),
        items: arr,
        nextItems: nextItems,
      })
    }

    function onKeydown(event) {
      if (caps.keyboard === false || isEditableTarget(event.target)) return
      const key = event.key
      const mod = event.ctrlKey || event.metaKey
      if ((key === 'Delete' || key === 'Backspace') && operationAvailable('delete')) {
        handled(event)
        requestDelete(activeSelectionKeys(), event)
      } else if ((key === 'd' || key === 'D') && mod && operationAvailable('duplicate')) {
        handled(event)
        requestDuplicate(activeSelectionKeys(), event)
      } else if ((key === 'ArrowUp' || key === 'ArrowDown') && event.altKey && operationAvailable('reorder')) {
        handled(event)
        moveSelection(key === 'ArrowUp' ? -1 : 1, event)
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        handled(event)
        moveActive(key === 'ArrowUp' ? -1 : 1, event)
      }
    }

    function activeSelectionKeys() {
      const sel = selectedKeys().filter(function (key) { return indexOfKey(key) >= 0 })
      if (sel.length) return sel
      const key = active.peek()
      return indexOfKey(key) >= 0 ? [key] : []
    }

    function moveActive(delta, event) {
      const arr = currentItems()
      if (!arr.length) return
      const cur = indexOfKey(active.peek())
      const nextIndex = Math.max(0, Math.min(arr.length - 1, cur < 0 ? (delta > 0 ? 0 : arr.length - 1) : cur + delta))
      const key = getKey(arr[nextIndex], nextIndex)
      setActiveKey(key, { source: 'keyboard', index: nextIndex, event: event })
      if (selectionMode !== 'none') setSelectedKeys([key], { source: 'keyboard', index: nextIndex, event: event })
    }

    function moveSelection(delta, event) {
      const indices = indicesForKeys(activeSelectionKeys())
      if (!indices.length) return
      const min = indices[0]
      const max = indices[indices.length - 1]
      if (delta < 0 && min === 0) return
      if (delta > 0 && max >= currentItems().length - 1) return
      const rawIndex = delta < 0 ? min - 1 : max + 2
      commitReorder(indices, normalizeInsertIndex(rawIndex, indices, currentItems().length), event)
    }

    function handled(event) {
      event.preventDefault()
      if (aiditor.shortcuts) aiditor.shortcuts.markHandled(event)
    }

    function isEditableTarget(el) {
      return !!(el && el.closest && el.closest(EDITABLE_SELECTOR))
    }

    function indexOfKey(key) {
      for (let i = 0; i < order.length; i++) if (order[i] === key) return i
      return -1
    }

    function commit(meta) {
      if (typeof o.onCommit === 'function') o.onCommit(meta)
    }

    function insertBeforeKeyFrom(arr, indices, insertIndex) {
      const moving = new Set(indices)
      let at = 0
      for (let i = 0; i < arr.length; i++) {
        if (moving.has(i)) continue
        if (at === insertIndex) return getKey(arr[i], i)
        at++
      }
      return null
    }
  }

  function normalizeEnum(value, allowed, fallback) {
    value = value == null ? fallback : String(value)
    return allowed.indexOf(value) >= 0 ? value : fallback
  }
})(window.aiditor = window.aiditor || {})

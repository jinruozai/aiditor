// aiditor.ui.structInput — generic fixed-shape record editor.
//
// Renders one row per field; each row = [label chrome · editor · actions]. The editor
// for each slot is produced by a caller-provided factory — this component does
// not know about type_config, FieldDef, or canonical value encoding. Use it
// anywhere you need a schema-less keyed editing projection.
//
// opts:
//   value:    signal<object>                               required; keyed UI projection
//   fields:   [{ key, label?, labelMode?, labelActions?, labelActionCtx?,
//                group?, visibleWhen?, searchText?, searchDescendants?,
//                fieldLayout?, defaultCollapsed?,
//                collapsed?, onToggle?, tooltip?, editor,
//                actions?, actionCtx?, contextActions?, contextCtx? }] required
//               label:false or labelMode:'hidden' hides label text, not label actions
//               labelMode:'sr-only' keeps an accessible label without a column
//               fieldLayout:'row'|'block'|'section' controls label/editor layout
//               editor(slotSig, write, ctx) → HTMLElement
//               tooltip — optional one-liner shown on label hover
//               contextActions(ctx) — optional UiAction[] | Promise<UiAction[]>
//                 opened from label / row chrome contextmenu, never editor controls
//   onChange?: (nextObj, changedKey, newValue, meta?) => void
//               if absent, writes go straight into `value`
//   groups?:  object|signal<object>                       group section metadata
//   groupActions? / groupActionCtx?                       group action adapters
//   searchQuery?: string|signal<string>                   display-only filter
//   searchAncestorMatch?: boolean|signal<boolean>         inherited recursive match
//   ctx?:     any                                           forwarded to editor()
//
// Per-slot reactivity: each slot gets `fieldSig = derived(() => value()[key])`.
// When `value` changes, only the fields whose value actually changed notify
// their editor (derived's Object.is dirty-check filters the rest). The row
// DOM is created once and never rebuilt for value changes — in-flight edits,
// focus, pointer capture all survive external writes.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}
  let messageId = 0
  const EDITOR_CONTEXT_SELECTOR = [
    'input',
    'textarea',
    'select',
    'button',
    '[contenteditable]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="spinbutton"]',
    '[role="button"]',
    '.aiditor-ui-num',
    '.aiditor-ui-slider',
    '.aiditor-ui-range-slider',
    '.aiditor-ui-combobox',
    '.aiditor-ui-action-bar',
    '.aiditor-ui-popover',
  ]

  ui.structInput = function (opts) {
    const o = opts || {}
    if (!ui.isSignal(o.value)) throw new Error('ui.structInput: `value` must be a signal')
    const value    = o.value
    const fields   = o.fields || []
    const ctx      = o.ctx
    const onChange = typeof o.onChange === 'function' ? o.onChange : null
    const groups = ui.isSignal(o.groups) ? o.groups : aiditor.signal(o.groups || {})
    const groupActions = typeof o.groupActions === 'function' ? o.groupActions : null
    const groupActionCtx = typeof o.groupActionCtx === 'function' ? o.groupActionCtx : null
    const searchQuery = ui.asSig(o.searchQuery != null ? o.searchQuery : '')
    const searchAncestorMatch = ui.asSig(o.searchAncestorMatch != null ? o.searchAncestorMatch : false)

    const root = ui.h('div', 'aiditor-ui-struct-input')
    let fieldMenu = null
    ui.collect(root, closeFieldMenu)
    const records = []

    fields.forEach(function (f) {
      const labelMode = fieldLabelMode(f)
      const layout = fieldLayout(f, labelMode)
      const row   = ui.h('div', 'aiditor-ui-struct-input-row')
      row.dataset.efFieldKey = String(f.key)
      row.classList.add('aiditor-ui-struct-input-row-label-' + labelMode)
      row.classList.add('aiditor-ui-struct-input-row-layout-' + layout)
      const forceExpanded = aiditor.derived(function () {
        return !!normalizedSearch(searchQuery())
      })
      ui.collect(root, forceExpanded.dispose)
      const label = layout === 'section'
        ? sectionLabel(root, row, f, forceExpanded)
        : fieldLabelEl(f)
      label.classList.add('aiditor-ui-struct-input-label-' + labelMode)
      // Tooltip surfaces the field's purpose on hover. The `data-has-tip`
      // marker is a CSS hook for the help cursor; we don't paint that
      // cursor on every label because most labels have no extra info.
      if (f.tooltip) {
        label.setAttribute('data-has-tip', '')
        ui.tooltip(label, { text: f.tooltip })
      }
      const cell  = ui.h('div', 'aiditor-ui-struct-input-cell')
      if (labelMode === 'hidden' && f.tooltip) cell.setAttribute('title', f.tooltip)

      const fieldSig = aiditor.derived(function () {
        const cur = value()
        return cur == null ? undefined : cur[f.key]
      })
      ui.collect(root, fieldSig.dispose)

      const writeSlot = function (nv, meta) {
        const cur = value.peek() || {}
        if (cur[f.key] === nv) return
        const next = Object.assign({}, cur, { [f.key]: nv })
        if (onChange) onChange(next, f.key, nv, meta)
        else value.set(next)
      }

      const directMatch = aiditor.derived(function () {
        const query = normalizedSearch(searchQuery())
        if (!query) return false
        if (searchAncestorMatch()) return true
        if (searchIncludes(fieldSearchText(f), query)) return true
        return f.group ? searchIncludes(groupSearchText(f.group, groups()), query) : false
      })
      const searchMatch = aiditor.derived(function () {
        const query = normalizedSearch(searchQuery())
        return !query || directMatch() || searchIncludes(f.searchDescendants, query)
      })
      const conditionVisible = aiditor.derived(function () {
        return visibleWhenMatches(value(), f.visibleWhen)
      })
      const visible = aiditor.derived(function () {
        return conditionVisible() && searchMatch()
      })
      ui.collect(root, directMatch.dispose)
      ui.collect(root, searchMatch.dispose)
      ui.collect(root, conditionVisible.dispose)
      ui.collect(root, visible.dispose)

      const editorCtx = searchContext(ctx, searchQuery, directMatch)
      const editor = f.editor(fieldSig, writeSlot, editorCtx)
      cell.appendChild(editor)
      ui.collect(root, function () { ui.dispose(editor) })
      if (f.messages) bindFieldMessages(root, row, cell, editor, f.messages)

      if (f.labelActions) {
        const labelActions = ui.h('div', 'aiditor-ui-struct-input-label-actions')
        labelActions.appendChild(ui.actionBar({ actions: f.labelActions, ctx: f.labelActionCtx || ctx || {}, density: 'compact' }))
        label.appendChild(labelActions)
        row.classList.add('aiditor-ui-struct-input-row-has-label-actions')
        if (f.labelActions.dispose) ui.collect(root, f.labelActions.dispose)
        if (f.labelActionCtx && f.labelActionCtx.dispose) ui.collect(root, f.labelActionCtx.dispose)
        if (ui.isSignal(f.labelActions)) {
          ui.bind(row, f.labelActions, function (list) {
            row.classList.toggle('aiditor-ui-struct-input-row-label-actions-empty', !(Array.isArray(list) && list.length))
          })
        } else {
          row.classList.toggle('aiditor-ui-struct-input-row-label-actions-empty', !(Array.isArray(f.labelActions) && f.labelActions.length))
        }
      }

      row.appendChild(label); row.appendChild(cell)
      if (f.actions) {
        const actions = ui.h('div', 'aiditor-ui-struct-input-actions')
        actions.appendChild(ui.actionBar({ actions: f.actions, ctx: f.actionCtx || ctx || {}, density: 'compact' }))
        row.appendChild(actions)
        row.classList.add('aiditor-ui-struct-input-row-has-actions')
        if (f.actions.dispose) ui.collect(root, f.actions.dispose)
        if (f.actionCtx && f.actionCtx.dispose) ui.collect(root, f.actionCtx.dispose)
        if (ui.isSignal(f.actions)) {
          ui.bind(row, f.actions, function (list) {
            row.classList.toggle('aiditor-ui-struct-input-row-actions-empty', !(Array.isArray(list) && list.length))
          })
        }
      }
      if (f.contextActions) {
        row.addEventListener('contextmenu', function (ev) {
          openFieldContextMenu(ev, row, label, f, closeFieldMenu, setFieldMenu, clearFieldMenu)
        })
      }
      const stopVisible = aiditor.effect(function () { row.hidden = !visible() })
      ui.collect(root, stopVisible)
      records.push({
        field: f,
        row: row,
        cell: cell,
        visible: visible,
        conditionVisible: conditionVisible,
        searchMatch: searchMatch,
        forceExpanded: forceExpanded,
      })
    })

    mountGroups(root, records, value, groups, groupActions, groupActionCtx, searchQuery, ctx)

    return root

    function closeFieldMenu() {
      const menu = fieldMenu
      fieldMenu = null
      if (menu && menu.close) menu.close()
    }

    function setFieldMenu(menu) {
      fieldMenu = menu
    }

    function clearFieldMenu(menu) {
      if (fieldMenu === menu) fieldMenu = null
    }
  }

  function mountGroups(root, records, value, groups, groupActions, groupActionCtx, searchQuery, ctx) {
    const initialGroups = groups.peek ? groups.peek() : groups()
    const enabledRecords = Object.create(null)
    Object.keys(initialGroups || {}).forEach(function (groupId) {
      const enabledBy = initialGroups[groupId] && initialGroups[groupId].enabledBy
      if (!enabledBy) return
      const record = recordByKey(records, enabledBy)
      if (record) enabledRecords[groupId] = record
    })

    const reserved = Object.keys(enabledRecords).map(function (groupId) { return enabledRecords[groupId] })
    const buckets = groupRecords(records, reserved)
    Object.keys(enabledRecords).forEach(function (groupId) {
      if (!bucketById(buckets, groupId)) buckets.push({ id: groupId, records: [] })
    })
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]
      if (!bucket.id) {
        for (let j = 0; j < bucket.records.length; j++) root.appendChild(bucket.records[j].row)
        continue
      }
      mountGroup(root, bucket, enabledRecords[bucket.id], value, groups, groupActions, groupActionCtx, searchQuery, ctx)
    }
  }

  function mountGroup(root, bucket, enabledRecord, value, groups, groupActions, groupActionCtx, searchQuery, ctx) {
    const groupId = bucket.id
    const initial = groupConfig(groups, groupId, false)
    const collapsed = aiditor.signal(!!initial.defaultCollapsed)
    const title = aiditor.derived(function () {
      const config = groupConfig(groups, groupId, true)
      return config.label || (ui.PROP_GROUP_LABELS && ui.PROP_GROUP_LABELS[groupId]) || groupId
    })
    const actionCtx = aiditor.derived(function () {
      const base = {
        groupId: groupId,
        label: title(),
        fields: bucket.records.map(function (record) { return record.field.key }),
        value: value(),
        ctx: ctx,
      }
      return groupActionCtx
        ? aiditor.safeCall({ scope: 'ui.structInput', action: 'groupActionCtx', group: groupId }, function () { return groupActionCtx(base) }) || base
        : base
    })
    const actions = aiditor.derived(function () {
      const config = groupConfig(groups, groupId, true)
      const currentCtx = actionCtx()
      const fromFn = groupActions
        ? aiditor.safeCall({ scope: 'ui.structInput', action: 'groupActions', group: groupId }, function () { return groupActions(currentCtx) })
        : null
      return fromFn != null ? fromFn : (config.actions || [])
    })
    const visible = aiditor.derived(function () {
      const query = normalizedSearch(searchQuery())
      if (query && searchIncludes(groupSearchText(groupId, groups()), query)) {
        if (enabledRecord && enabledRecord.conditionVisible()) return true
        for (let i = 0; i < bucket.records.length; i++) if (bucket.records[i].conditionVisible()) return true
        return false
      }
      if (enabledRecord && enabledRecord.visible()) return true
      for (let i = 0; i < bucket.records.length; i++) if (bucket.records[i].visible()) return true
      return false
    })
    const effectiveCollapsed = aiditor.derived(function () {
      return normalizedSearch(searchQuery()) && visible() ? false : collapsed()
    })
    const children = bucket.records.map(function (record) { return record.row })
    const trailing = enabledRecord ? enabledRecord.cell : null
    if (trailing) trailing.classList.add('aiditor-ui-struct-group-enabled')
    const section = ui.section({
      title: title,
      collapsed: effectiveCollapsed,
      onToggle: function (next) { collapsed.set(next) },
      trailing: trailing,
      actions: actions,
      actionCtx: actionCtx,
      children: children,
    })
    section.classList.add('aiditor-ui-struct-group')
    section.dataset.efGroup = groupId
    section.body.classList.add('aiditor-ui-struct-group-body')
    ui.bind(section, visible, function (shown) { section.hidden = !shown })
    if (trailing) {
      const stopTrailing = aiditor.effect(function () { trailing.hidden = !enabledRecord.conditionVisible() })
      ui.collect(root, stopTrailing)
    }
    root.appendChild(section)
    ui.collect(root, title.dispose)
    ui.collect(root, actionCtx.dispose)
    ui.collect(root, actions.dispose)
    ui.collect(root, visible.dispose)
    ui.collect(root, effectiveCollapsed.dispose)
    ui.collect(root, function () { ui.dispose(section) })
  }

  function groupRecords(records, reserved) {
    const buckets = Object.create(null)
    const seen = []
    for (let i = 0; i < records.length; i++) {
      if (reserved.indexOf(records[i]) >= 0) continue
      const id = records[i].field.group || ''
      if (!buckets[id]) { buckets[id] = []; seen.push(id) }
      buckets[id].push(records[i])
    }
    const order = []
    if (buckets['']) order.push('')
    ;(ui.PROP_GROUPS || []).forEach(function (id) { if (buckets[id]) order.push(id) })
    seen.forEach(function (id) { if (id && order.indexOf(id) < 0) order.push(id) })
    return order.map(function (id) { return { id: id, records: buckets[id] } })
  }

  function recordByKey(records, key) {
    for (let i = 0; i < records.length; i++) if (records[i].field.key === key) return records[i]
    return null
  }

  function bucketById(buckets, id) {
    for (let i = 0; i < buckets.length; i++) if (buckets[i].id === id) return buckets[i]
    return null
  }

  function groupConfig(groups, groupId, reactive) {
    const all = reactive ? groups() : (groups.peek ? groups.peek() : groups())
    return all && all[groupId] || {}
  }

  function groupSearchText(groupId, groups) {
    const config = groups && groups[groupId] || {}
    return groupId + ' ' + (config.label || (ui.PROP_GROUP_LABELS && ui.PROP_GROUP_LABELS[groupId]) || '')
  }

  function fieldSearchText(field) {
    if (field.searchText != null) return field.searchText
    return [field.key, fieldLabel(field), field.tooltip || '', field.group || ''].join(' ')
  }

  function normalizedSearch(value) {
    return String(value == null ? '' : value).trim().toLowerCase()
  }

  function searchIncludes(value, query) {
    if (!query || value == null) return false
    const list = Array.isArray(value) ? value : [value]
    for (let i = 0; i < list.length; i++) {
      if (String(list[i] == null ? '' : list[i]).toLowerCase().indexOf(query) >= 0) return true
    }
    return false
  }

  function visibleWhenMatches(record, rule) {
    if (!rule) return true
    const current = record == null ? undefined : record[rule.field]
    if (Object.prototype.hasOwnProperty.call(rule, 'equals')) return Object.is(current, rule.equals)
    return !Object.is(current, rule.notEquals)
  }

  function searchContext(ctx, searchQuery, searchAncestorMatch) {
    if (typeof ctx === 'function') {
      return function (field) {
        return Object.assign({}, ctx(field) || {}, {
          searchQuery: searchQuery,
          searchAncestorMatch: searchAncestorMatch,
        })
      }
    }
    return Object.assign({}, ctx || {}, {
      searchQuery: searchQuery,
      searchAncestorMatch: searchAncestorMatch,
    })
  }

  function fieldLabelMode(f) {
    if (f.label === false || f.labelMode === 'hidden') return 'hidden'
    if (f.labelMode === 'sr-only') return 'sr-only'
    return 'visible'
  }

  function bindFieldMessages(root, row, cell, editor, source) {
    const sig = ui.isSignal(source) ? source : aiditor.signal(source || [])
    const box = ui.h('div', 'aiditor-ui-field-messages')
    const id = 'aiditor-field-messages-' + (++messageId)
    box.id = id
    box.setAttribute('role', 'status')
    box.setAttribute('aria-live', 'polite')
    box.hidden = true
    cell.appendChild(box)
    const control = messageControl(editor)
    const previousDescribedBy = control && control.getAttribute ? control.getAttribute('aria-describedby') : null
    const previousInvalid = control && control.getAttribute ? control.getAttribute('aria-invalid') : null
    ui.bind(box, sig, function (value) {
      const messages = normalizeMessages(value)
      ui.disposeChildren(box)
      let hasError = false
      for (let i = 0; i < messages.length; i++) {
        const item = messages[i]
        if (item.kind === 'error') hasError = true
        const line = ui.h('div', 'aiditor-ui-field-message aiditor-ui-field-message-' + item.kind, { text: item.message })
        if (item.code) line.dataset.code = item.code
        box.appendChild(line)
      }
      box.hidden = messages.length === 0
      row.classList.toggle('aiditor-ui-struct-input-row-has-message', messages.length > 0)
      row.classList.toggle('aiditor-ui-struct-input-row-has-error', hasError)
      if (control && control.setAttribute) {
        const describedBy = describedByValue(previousDescribedBy, id, messages.length > 0)
        if (describedBy) control.setAttribute('aria-describedby', describedBy)
        else control.removeAttribute('aria-describedby')
        if (hasError) control.setAttribute('aria-invalid', 'true')
        else if (previousInvalid != null) control.setAttribute('aria-invalid', previousInvalid)
        else control.removeAttribute('aria-invalid')
      }
    })
    if (sig !== source && sig.dispose) ui.collect(root, sig.dispose)
    if (source && source.dispose) ui.collect(root, source.dispose)
  }

  function normalizeMessages(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : [])
    const out = []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (!item || item.message == null) continue
      const kind = item.kind === 'error' || item.kind === 'warning' ? item.kind : 'info'
      out.push({ kind: kind, message: String(item.message), code: item.code == null ? '' : String(item.code) })
    }
    return out
  }

  function messageControl(editor) {
    if (!editor) return null
    const composite = [
      'aiditor-ui-struct-input',
      'aiditor-ui-array-editor',
      'aiditor-ui-dict-input',
      'aiditor-ui-vec',
      'aiditor-ui-color',
      'aiditor-ui-gradient',
      'aiditor-ui-curve',
    ]
    for (let i = 0; i < composite.length; i++) {
      if (editor.classList && editor.classList.contains(composite[i])) return editor
    }
    const tags = ['input', 'textarea', 'select', '[role="textbox"]', '[role="spinbutton"]', '[role="combobox"]']
    for (let i = 0; i < tags.length; i++) {
      if (editor.matches && editor.matches(tags[i])) return editor
      if (editor.querySelector) {
        const found = editor.querySelector(tags[i])
        if (found) return found
      }
    }
    return editor
  }

  function describedByValue(previous, id, active) {
    const parts = String(previous || '').split(/\s+/).filter(function (part) { return part && part !== id })
    if (active) parts.push(id)
    return parts.join(' ')
  }

  function fieldLabel(f) {
    if (f.label === false) return String(f.key)
    return f.label || f.key
  }

  function fieldLabelEl(f) {
    const label = ui.h('div', 'aiditor-ui-struct-input-label')
    label.appendChild(ui.h('span', 'aiditor-ui-struct-input-label-text', { text: fieldLabel(f) }))
    return label
  }

  function fieldLayout(f, labelMode) {
    const layout = f && f.fieldLayout
    if (labelMode !== 'visible' && layout === 'section') return 'block'
    return layout === 'block' || layout === 'section' ? layout : 'row'
  }

  function sectionLabel(root, row, f, forceExpanded) {
    const collapsed = ui.asSig(f.collapsed != null ? f.collapsed : !!f.defaultCollapsed)
    const writeCollapsed = function (next) {
      if (typeof f.onToggle === 'function') {
        aiditor.safeCall({ scope: 'ui.structInput', action: 'toggleFieldSection', field: f.key }, function () { f.onToggle(next) })
      }
      else if (typeof collapsed.set === 'function') collapsed.set(next)
    }
    const wrap = ui.h('div', 'aiditor-ui-struct-input-label aiditor-ui-struct-input-section-label')
    const btn = ui.h('button', 'aiditor-ui-struct-input-section-toggle', { type: 'button' })
    const arrow = ui.icon({ name: 'chevron-down', size: 'sm' })
    arrow.classList.add('aiditor-ui-struct-input-section-arrow')
    btn.appendChild(arrow)
    btn.appendChild(ui.h('span', 'aiditor-ui-struct-input-section-title', { text: fieldLabel(f) }))
    wrap.appendChild(btn)
    btn.addEventListener('click', function () { writeCollapsed(!collapsed.peek()) })
    const stop = aiditor.effect(function () {
      const v = forceExpanded() ? false : collapsed()
      row.classList.toggle('aiditor-ui-struct-input-row-collapsed', !!v)
      btn.setAttribute('aria-expanded', v ? 'false' : 'true')
      arrow.style.transform = v ? 'rotate(-90deg)' : ''
    })
    ui.collect(root, stop)
    return wrap
  }

  function openFieldContextMenu(ev, row, label, field, closeFieldMenu, setFieldMenu, clearFieldMenu) {
    if (!shouldOpenFieldContextMenu(ev, row, label)) return
    const ctx = contextValue(field.contextCtx)
    const source = { scope: 'ui.structInput', action: 'fieldContextActions', field: field.key }
    closeFieldMenu()
    const actions = aiditor.safeCall(source, function () { return field.contextActions(ctx) })
    if (actions && typeof actions.then === 'function') {
      ev.preventDefault()
      ev.stopPropagation && ev.stopPropagation()
      let menu = null
      const pendingActions = Promise.resolve(actions).then(function (list) {
        if (!ui._actionSurface.hasMenuItems(list, ctx)) clearFieldMenu(menu)
        return list
      }).catch(function (err) {
        clearFieldMenu(menu)
        throw err
      })
      menu = ui.actionMenu({
        anchor: row,
        point: { x: ev.clientX, y: ev.clientY },
        actions: pendingActions,
        ctx: ctx,
        behavior: 'context',
        onDismiss: function () { clearFieldMenu(menu) },
      })
      setFieldMenu(menu)
      return
    }
    if (!ui._actionSurface.hasMenuItems(actions, ctx)) return
    ev.preventDefault()
    ev.stopPropagation && ev.stopPropagation()
    let menu = null
    menu = ui.actionMenu({
      anchor: row,
      point: { x: ev.clientX, y: ev.clientY },
      actions: actions,
      ctx: ctx,
      behavior: 'context',
      onDismiss: function () { clearFieldMenu(menu) },
    })
    setFieldMenu(menu)
  }

  function shouldOpenFieldContextMenu(ev, row, label) {
    const target = ev.target || row
    if (target === row) return true
    if (contains(label, target)) return true
    if (insideClass(target, row, 'aiditor-ui-struct-input-actions')) return false
    if (isEditorContextTarget(target, row)) return false
    return !insideClass(target, row, 'aiditor-ui-struct-input-cell')
  }

  function isEditorContextTarget(target, row) {
    for (let i = 0; i < EDITOR_CONTEXT_SELECTOR.length; i++) {
      if (matchesOrInside(target, row, EDITOR_CONTEXT_SELECTOR[i])) return true
    }
    return false
  }

  function matchesOrInside(target, row, selector) {
    let n = target
    while (n && n !== row) {
      if (matches(n, selector)) return true
      n = n.parentNode
    }
    return false
  }

  function matches(node, selector) {
    if (!node || node.nodeType === 3) return false
    if (node.matches) return node.matches(selector)
    if (selector[0] === '.') return classList(node).indexOf(selector.slice(1)) >= 0
    if (selector[0] === '[') {
      const m = /^\[([^=]+)(?:="([^"]+)")?\]$/.exec(selector)
      if (!m) return false
      const actual = node.getAttribute ? node.getAttribute(m[1]) : node.attributes && node.attributes[m[1]]
      return m[2] == null ? actual != null : actual === m[2]
    }
    return String(node.localName || node.nodeName || '').toLowerCase() === selector
  }

  function insideClass(target, row, cls) {
    let n = target
    while (n && n !== row) {
      if (classList(n).indexOf(cls) >= 0) return true
      n = n.parentNode
    }
    return false
  }

  function contains(parent, child) {
    let n = child
    while (n) {
      if (n === parent) return true
      n = n.parentNode
    }
    return false
  }

  function classList(node) {
    return String(node && node.className || '').split(/\s+/).filter(Boolean)
  }

  function contextValue(ctx) {
    return ui.isSignal(ctx) ? ctx.peek() : (ctx || {})
  }

})(window.aiditor = window.aiditor || {})

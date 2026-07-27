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

    const root = ui.h('div', 'aiditor-ui-struct-input')
    let fieldMenu = null
    ui.collect(root, closeFieldMenu)

    fields.forEach(function (f) {
      const labelMode = fieldLabelMode(f)
      const layout = fieldLayout(f, labelMode)
      const row   = ui.h('div', 'aiditor-ui-struct-input-row')
      row.dataset.efFieldKey = String(f.key)
      row.classList.add('aiditor-ui-struct-input-row-label-' + labelMode)
      row.classList.add('aiditor-ui-struct-input-row-layout-' + layout)
      const label = layout === 'section'
        ? sectionLabel(root, row, f)
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

      const editor = f.editor(fieldSig, writeSlot, ctx)
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
      root.appendChild(row)
    })

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

  function sectionLabel(root, row, f) {
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
      const v = collapsed()
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

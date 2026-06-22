// aiditor.ui.structInput — generic fixed-shape record editor.
//
// Renders one row per field; each row = [label · editor · actions]. The editor
// for each slot is produced by a caller-provided factory — this component does
// not know about type_config, FieldDef, or canonical value encoding. Use it
// anywhere you need a schema-less keyed editing projection.
//
// opts:
//   value:    signal<object>                               required; keyed UI projection
//   fields:   [{ key, label?, labelMode?, tooltip?, editor,
//                actions?, actionCtx?, contextActions?, contextCtx? }] required
//               label:false or labelMode:'hidden' hides the visual row label
//               labelMode:'sr-only' keeps an accessible label without a column
//               editor(slotSig, write, ctx) → HTMLElement
//               tooltip — optional one-liner shown on label hover
//               contextActions(ctx) — optional UiAction[] | Promise<UiAction[]>
//                 opened from label / row chrome contextmenu, never editor controls
//   onChange?: (nextObj, changedKey, newValue) => void
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
      const row   = ui.h('div', 'aiditor-ui-struct-input-row')
      row.dataset.efFieldKey = String(f.key)
      row.classList.add('aiditor-ui-struct-input-row-label-' + labelMode)
      const label = ui.h('div', 'aiditor-ui-struct-input-label', { text: fieldLabel(f) })
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

      const writeSlot = function (nv) {
        const cur = value.peek() || {}
        if (cur[f.key] === nv) return
        const next = Object.assign({}, cur, { [f.key]: nv })
        if (onChange) onChange(next, f.key, nv)
        else value.set(next)
      }

      const editor = f.editor(fieldSig, writeSlot, ctx)
      cell.appendChild(editor)
      ui.collect(root, function () { ui.dispose(editor) })

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

  function fieldLabel(f) {
    if (f.label === false) return String(f.key)
    return f.label || f.key
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

// aiditor.ui.structInput — generic fixed-shape object editor.
//
// Renders one row per field; each row = [label · editor · actions]. The editor for each
// slot is produced by a caller-provided factory — this component does not
// know about type_config or FieldDef. Use it anywhere you need a schema-less
// "edit a record" UI.
//
// opts:
//   value:    signal<object>                               required
//   fields:   [{ key, label?, labelMode?, tooltip?, editor, actions?, actionCtx? }] required
//               label:false or labelMode:'hidden' hides the visual row label
//               labelMode:'sr-only' keeps an accessible label without a column
//               editor(slotSig, write, ctx) → HTMLElement
//               tooltip — optional one-liner shown on label hover
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

  ui.structInput = function (opts) {
    const o = opts || {}
    if (!ui.isSignal(o.value)) throw new Error('ui.structInput: `value` must be a signal')
    const value    = o.value
    const fields   = o.fields || []
    const ctx      = o.ctx
    const onChange = typeof o.onChange === 'function' ? o.onChange : null

    const root = ui.h('div', 'aiditor-ui-struct-input')

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
      root.appendChild(row)
    })

    return root
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
})(window.aiditor = window.aiditor || {})

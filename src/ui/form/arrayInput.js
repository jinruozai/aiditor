// aiditor.ui.arrayInput — compatibility facade over arrayEditor.
//
// The original arrayInput contract is intentionally small: a writable array
// signal plus an optional element editor. Rich row interactions live in
// arrayEditor; this facade keeps existing propertyForm usage stable and forwards
// the same createItem/canAdd construction protocol.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.arrayInput = function (opts) {
    const o = opts || {}
    if (!ui.isSignal(o.value)) throw new Error('ui.arrayInput: `value` must be a signal')
    if (typeof o.onChange !== 'function' && typeof o.value.set !== 'function') {
      throw new Error('ui.arrayInput: `value` must be writable or `onChange` is required')
    }
    const editor = typeof o.editor === 'function'
      ? o.editor
      : function (sig, write) { return ui.input({ value: sig, onChange: write }) }
    const defaultValue = typeof o.defaultValue === 'function'
      ? o.defaultValue
      : function () { return '' }
    const createItem = typeof o.createItem === 'function' ? o.createItem : defaultValue

    const el = ui.arrayEditor({
      items: o.value,
      getKey: function (_, index) { return index },
      selectionMode: 'none',
      indexMode: 'number',
      density: 'compact',
      actions: 'end',
      capabilities: {
        add: true,
        delete: true,
        duplicate: false,
        reorder: false,
        keyboard: false,
      },
      createItem: createItem,
      canAdd: o.canAdd,
      renderItem: function (_, index, ctx) {
        return editor(ctx.value, ctx.writeItem, o.ctx, index, ctx)
      },
      onChange: o.onChange,
      ctx: o.ctx,
      emptyText: o.emptyText || 'No items',
      ariaLabel: o.ariaLabel || 'Array input',
    })
    el.classList.add('aiditor-ui-array-input')
    return el
  }
})(window.aiditor = window.aiditor || {})

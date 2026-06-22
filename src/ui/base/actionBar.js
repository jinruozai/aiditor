// aiditor.ui.actionBar — compact local UiAction surface.
//
// UiAction is a view-level description, not a business action registry:
// {
//   id, label, icon, title, variant, disabled, hidden,
//   command, args, onSelect, menu
// }
// Data mutations should normally route through `command`; `onSelect` exists for
// local UI-only behavior.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  /**
   * @aiditorApi aiditor.ui.actionBar
   * @group ui
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.ui.actionBar(opts)
   * @summary Render a compact local action surface. Actions can run commands, call local UI handlers, or open framework menus.
   * @param {object} opts - Action bar options.
   * @param {Array|Signal<Array>|Function} opts.actions - UiAction records, a signal of records, or a function of ctx.
   * @param {object|Signal<object>} opts.ctx - Context passed to action predicates, args, menus, and commands.
   * @param {string} opts.density - Optional density, "compact" by default.
   * @returns {HTMLElement} Action bar root element.
   * @related aiditor.commands.run
   */
  ui.actionBar = function (opts) {
    const o = opts || {}
    const actionsSig = ui.isSignal(o.actions) ? o.actions : aiditor.signal(o.actions || [])
    const ctxSig = ui.isSignal(o.ctx) ? o.ctx : aiditor.signal(o.ctx || {})
    const density = o.density || 'compact'
    const root = ui.h('div', 'aiditor-ui-action-bar aiditor-ui-action-bar-' + density)
    const openMenus = []

    function closeMenus() {
      while (openMenus.length) {
        const pop = openMenus.pop()
        if (pop && pop.close) pop.close()
      }
    }

    function render(actions, ctx) {
      closeMenus()
      ui.disposeChildren(root)
      const list = ui._actionSurface.resolveActions(actions, ctx)
      let count = 0
      for (let i = 0; i < list.length; i++) {
        const btn = renderAction(list[i], ctx, closeMenus, openMenus)
        if (btn) { root.appendChild(btn); count++ }
      }
      root.classList.toggle('aiditor-ui-action-bar-empty', count === 0)
    }

    ui.collect(root, closeMenus)
    ui.collect(root, aiditor.effect(function () {
      render(actionsSig(), ctxSig())
    }))
    return root
  }

  function renderAction(action, ctx, closeMenus, openMenus) {
    if (!action || action.type) return null
    if (ui._actionSurface.truthy(ui._actionSurface.valueOf(action.hidden, ctx, action))) return null
    const hasMenu = action.menu != null
    const disabled = ui._actionSurface.truthy(ui._actionSurface.valueOf(action.disabled, ctx, action))
    const label = ui._actionSurface.stringValue(ui._actionSurface.valueOf(action.label, ctx, action) || ui._actionSurface.valueOf(action.title, ctx, action) || action.id || '')
    const title = ui._actionSurface.stringValue(ui._actionSurface.valueOf(action.title, ctx, action) || label)
    const icon = ui._actionSurface.stringValue(ui._actionSurface.valueOf(action.icon, ctx, action) || (hasMenu ? 'more-vertical' : ''))
    const variant = ui._actionSurface.stringValue(ui._actionSurface.valueOf(action.variant, ctx, action) || (action.danger ? 'danger' : 'default'))
    const kind = variant === 'danger' ? 'danger' : 'ghost'
    let btn = null
    const onClick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault()
      if (ev && ev.stopPropagation) ev.stopPropagation()
      if (hasMenu) openActionMenu(action, btn, ctx, closeMenus, openMenus)
      else ui._actionSurface.runAction(action, ctx, 'ui.actionBar')
    }
    btn = icon
      ? ui.iconButton({ icon: icon, title: title || label || 'Action', ariaLabel: label || title || 'Action', kind: kind, size: 'sm', disabled: disabled, onClick: onClick })
      : ui.button({ text: label, title: title, kind: kind, size: 'sm', disabled: disabled, onClick: onClick })
    btn.classList.add('aiditor-ui-action-btn')
    if (hasMenu) btn.classList.add('aiditor-ui-action-menu-btn')
    return btn
  }

  function openActionMenu(action, anchor, ctx, closeMenus, openMenus) {
    closeMenus()
    const pop = ui.actionMenu({
      anchor: anchor,
      actions: action.menu,
      ctx: ctx,
      sourceScope: 'ui.actionBar',
      side: 'bottom',
      align: 'end',
      onDismiss: function () {
        const index = openMenus.indexOf(pop)
        if (index >= 0) openMenus.splice(index, 1)
      },
    })
    openMenus.push(pop)
  }
})(window.aiditor = window.aiditor || {})

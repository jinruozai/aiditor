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
      const list = resolveActions(actions, ctx)
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

  function resolveActions(actions, ctx) {
    const list = valueOf(actions, ctx, { id: 'actions' })
    return Array.isArray(list) ? list : []
  }

  function renderAction(action, ctx, closeMenus, openMenus) {
    if (!action || action.type) return null
    if (truthy(valueOf(action.hidden, ctx, action))) return null
    const hasMenu = action.menu != null
    const disabled = truthy(valueOf(action.disabled, ctx, action))
    const label = stringValue(valueOf(action.label, ctx, action) || valueOf(action.title, ctx, action) || action.id || '')
    const title = stringValue(valueOf(action.title, ctx, action) || label)
    const icon = stringValue(valueOf(action.icon, ctx, action) || (hasMenu ? 'more-vertical' : ''))
    const variant = stringValue(valueOf(action.variant, ctx, action) || (action.danger ? 'danger' : 'default'))
    const kind = variant === 'danger' ? 'danger' : 'ghost'
    let btn = null
    const onClick = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault()
      if (ev && ev.stopPropagation) ev.stopPropagation()
      if (hasMenu) openActionMenu(action, btn, ctx, closeMenus, openMenus)
      else runAction(action, ctx)
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
    const raw = valueOf(action.menu, ctx, action) || []
    const items = normalizeMenuItems(raw, ctx)
    const pop = ui.menu({
      anchor: anchor,
      items: items,
      side: 'bottom',
      align: 'end',
      onDismiss: function () {
        const index = openMenus.indexOf(pop)
        if (index >= 0) openMenus.splice(index, 1)
      },
    })
    openMenus.push(pop)
  }

  function normalizeMenuItems(items, ctx) {
    const list = Array.isArray(items) ? items : []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (!item) continue
      if (truthy(valueOf(item.hidden, ctx, item))) continue
      if (item.type === 'divider' || item.type === 'header') {
        out.push(Object.assign({}, item, { label: valueOf(item.label, ctx, item) || '' }))
        continue
      }
      const children = item.items || valueOf(item.menu, ctx, item)
      const disabled = truthy(valueOf(item.disabled, ctx, item))
      const normalized = {
        label: valueOf(item.label, ctx, item) || valueOf(item.title, ctx, item) || item.id || '',
        icon: valueOf(item.icon, ctx, item) || '',
        kbd: valueOf(item.kbd, ctx, item) || '',
        disabled: disabled,
        danger: truthy(item.danger) || valueOf(item.variant, ctx, item) === 'danger',
      }
      if (children && children.length) normalized.items = normalizeMenuItems(children, ctx)
      else normalized.onSelect = disabled ? null : function (it) {
        return function () { runAction(it, ctx) }
      }(item)
      out.push(normalized)
    }
    return out
  }

  function runAction(action, ctx) {
    const args = valueOf(action.args != null ? action.args : action.input, ctx, action) || {}
    const actionCtx = Object.assign({ action: action.id || '' }, ctx || {})
    const source = { scope: 'ui.actionBar', action: 'command', id: action.id || action.command || action.label || '' }
    if (action.command) {
      const result = aiditor.safeCall(source, function () {
        return aiditor.commands.run(action.command, args, actionCtx)
      })
      watchAsync(result, source)
    }
    if (action.onSelect) {
      const selectSource = { scope: 'ui.actionBar', action: 'select', id: action.id || action.label || '' }
      const result = aiditor.safeCall(selectSource, function () {
        return action.onSelect(actionCtx, action)
      })
      watchAsync(result, selectSource)
    }
  }

  function watchAsync(result, source) {
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(function (err) { aiditor.reportError(source, err) })
    }
  }

  function valueOf(value, ctx, action) {
    if (typeof value !== 'function') return value
    return aiditor.safeCall({ scope: 'ui.actionBar', action: 'value', id: action && action.id || '' }, function () {
      return value(ctx || {}, action)
    })
  }

  function stringValue(value) {
    return value == null ? '' : String(value)
  }

  function truthy(value) {
    return !!value
  }
})(window.aiditor = window.aiditor || {})

// aiditor.ui.actionMenu — open a menu from UiAction records.
//
// This is the shared adapter between local UiAction descriptions and ui.menu.
// It is not a registry and it does not create a second command path; actions
// still run through aiditor.commands.run or local UI-only onSelect handlers.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}
  const surface = ui._actionSurface = ui._actionSurface || {}

  surface.resolveActions = function (actions, ctx) {
    const list = surface.valueOf(actions, ctx, { id: 'actions' })
    return Array.isArray(list) ? list : []
  }

  surface.normalizeMenuItems = function (items, ctx, sourceScope) {
    const list = Array.isArray(items) ? items : []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (!item) continue
      if (surface.truthy(surface.valueOf(item.hidden, ctx, item))) continue
      if (item.type === 'divider' || item.type === 'header') {
        out.push(Object.assign({}, item, { label: surface.valueOf(item.label, ctx, item) || '' }))
        continue
      }
      const children = item.items || surface.valueOf(item.menu, ctx, item)
      const disabled = surface.truthy(surface.valueOf(item.disabled, ctx, item))
      const normalized = {
        label: surface.valueOf(item.label, ctx, item) || surface.valueOf(item.title, ctx, item) || item.id || '',
        icon: surface.valueOf(item.icon, ctx, item) || '',
        kbd: surface.valueOf(item.kbd, ctx, item) || '',
        disabled: disabled,
        danger: surface.truthy(item.danger) || surface.valueOf(item.variant, ctx, item) === 'danger',
      }
      if (children && children.length) normalized.items = surface.normalizeMenuItems(children, ctx, sourceScope)
      else normalized.onSelect = disabled ? null : function (it) {
        return function () { surface.runAction(it, ctx, sourceScope) }
      }(item)
      out.push(normalized)
    }
    return out
  }

  surface.hasMenuItems = function (actions, ctx) {
    return surface.normalizeMenuItems(surface.resolveActions(actions, ctx), ctx).length > 0
  }

  surface.runAction = function (action, ctx, sourceScope) {
    const args = surface.valueOf(action.args != null ? action.args : action.input, ctx, action) || {}
    const actionCtx = Object.assign({ action: action.id || '' }, ctx || {})
    const scope = sourceScope || 'ui.actionMenu'
    const source = { scope: scope, action: 'command', id: action.id || action.command || action.label || '' }
    if (action.command) {
      const result = aiditor.safeCall(source, function () {
        return aiditor.commands.run(action.command, args, actionCtx)
      })
      surface.watchAsync(result, source)
    }
    if (action.onSelect) {
      const selectSource = { scope: scope, action: 'select', id: action.id || action.label || '' }
      const result = aiditor.safeCall(selectSource, function () {
        return action.onSelect(actionCtx, action)
      })
      surface.watchAsync(result, selectSource)
    }
  }

  surface.watchAsync = function (result, source) {
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(function (err) { aiditor.reportError(source, err) })
    }
  }

  surface.valueOf = function (value, ctx, action) {
    if (typeof value !== 'function') return value
    return aiditor.safeCall({ scope: 'ui.actionSurface', action: 'value', id: action && action.id || '' }, function () {
      return value(ctx || {}, action)
    })
  }

  surface.stringValue = function (value) {
    return value == null ? '' : String(value)
  }

  surface.truthy = function (value) {
    return !!value
  }

  /**
   * @aiditorApi aiditor.ui.actionMenu
   * @group ui
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.ui.actionMenu(opts)
   * @summary Open a ui.menu from UiAction records at an anchor or pointer position.
   * @param {object} opts - Menu options.
   * @param {HTMLElement} opts.anchor - Owner/anchor element for lifecycle and fallback placement.
   * @param {object} opts.point - Optional pointer position: { x, y }.
   * @param {Array|Function|Promise} opts.actions - UiAction records, a function of ctx, or Promise<UiAction[]>.
   * @param {object|Signal<object>} opts.ctx - Context passed to action predicates, args, menus, and commands.
   * @param {string} opts.behavior - Optional menu behavior: "dropdown" (default) or "context".
   * @param {string} opts.sourceScope - Optional error/log source scope for actions opened from another surface.
   * @returns {object} Handle with close().
   * @related aiditor.ui.actionBar,aiditor.ui.menu
   */
  ui.actionMenu = function (opts) {
    const o = opts || {}
    const ctx = ui.isSignal(o.ctx) ? o.ctx.peek() : (o.ctx || {})
    let closed = false
    let pop = null
    let replacing = false

    function close() {
      closed = true
      closePop()
    }

    function closePop() {
      if (!pop) return
      replacing = true
      pop.close()
      replacing = false
      pop = null
    }

    function open(items) {
      if (closed) return
      const normalized = surface.normalizeMenuItems(surface.resolveActions(items, ctx), ctx, o.sourceScope)
      if (!normalized.length) { close(); return }
      closePop()
      pop = ui.menu({
        anchor: o.anchor,
        point: o.point,
        items: normalized,
        behavior: o.behavior || 'dropdown',
        side: o.side || 'bottom',
        align: o.align || 'start',
        onDismiss: function () {
          pop = null
          if (!replacing) {
            closed = true
            if (o.onDismiss) o.onDismiss()
          }
        },
      })
    }

    const actions = surface.valueOf(o.actions, ctx, { id: 'actions' })
    if (actions && typeof actions.then === 'function') {
      open([{ type: 'header', label: o.loadingText || 'Loading...' }])
      Promise.resolve(actions).then(open).catch(function (err) {
        close()
        aiditor.reportError({ scope: 'ui.actionMenu', action: 'resolve' }, err)
      })
    } else {
      open(actions)
    }

    return { close: close }
  }
})(window.aiditor = window.aiditor || {})

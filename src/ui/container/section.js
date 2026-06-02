// aiditor.ui.section — collapsible labeled section header + body.
//
// opts: {
//   title?: string|signal,
//   meta?: string|signal,
//   collapsed?: bool|signal, onToggle?,
//   leading?: HTMLElement|string,
//   trailing?: HTMLElement|string,
//   actions?: UiAction[]|signal<UiAction[]>,
//   actionCtx?: object|signal<object>,
//   className?: string,
//   bodyClassName?: string,
//   children?: HTMLElement[] | HTMLElement,
// }
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.section = function (opts) {
    const o = opts || {}
    const sig   = ui.asSig(o.collapsed != null ? o.collapsed : false)
    const title = ui.asSig(o.title     != null ? o.title     : '')
    const meta  = ui.asSig(o.meta      != null ? o.meta      : '')
    const doWrite = ui.writer(sig, o.onToggle, 'ui.section')
    const el = ui.h('section', 'aiditor-ui-section')
    if (o.className) el.classList.add.apply(el.classList, String(o.className).split(/\s+/).filter(Boolean))
    const head = ui.h('div', 'aiditor-ui-section-head')
    const toggle = ui.h('button', 'aiditor-ui-section-toggle', { type: 'button' })
    const arrow = ui.icon({ name: 'chevron-down', size: 'sm' })
    arrow.classList.add('aiditor-ui-section-arrow')
    const titleEl = ui.h('span', 'aiditor-ui-section-title')
    const metaEl = ui.h('span', 'aiditor-ui-section-meta')
    ui.bindText(titleEl, title)
    ui.bindText(metaEl, meta)
    if (o.leading != null) toggle.appendChild(slot(o.leading, 'leading'))
    toggle.appendChild(arrow); toggle.appendChild(titleEl); toggle.appendChild(metaEl)
    head.appendChild(toggle)
    const hasActions = o.actions && (!Array.isArray(o.actions) || o.actions.length)
    if (o.trailing != null || hasActions) {
      const rail = ui.h('span', 'aiditor-ui-section-actions')
      if (o.trailing != null) rail.appendChild(slot(o.trailing, 'trailing'))
      if (hasActions) rail.appendChild(ui.actionBar({ actions: o.actions, ctx: o.actionCtx || {}, density: 'compact' }))
      if (ui.isSignal(o.actions) && o.trailing == null) {
        ui.bind(rail, o.actions, function (v) { rail.hidden = !(Array.isArray(v) && v.length) })
      }
      head.appendChild(rail)
    }
    const body = ui.h('div', 'aiditor-ui-section-body')
    if (o.bodyClassName) body.classList.add.apply(body.classList, String(o.bodyClassName).split(/\s+/).filter(Boolean))
    el.appendChild(head); el.appendChild(body)
    toggle.addEventListener('click', function () { doWrite(!sig.peek()) })
    ui.bind(el, sig, function (v) {
      el.classList.toggle('aiditor-ui-section-collapsed', !!v)
      arrow.style.transform = v ? 'rotate(-90deg)' : ''
    })
    if (o.children) {
      const list = Array.isArray(o.children) ? o.children : [o.children]
      for (let i = 0; i < list.length; i++) body.appendChild(list[i])
    }
    el.body = body
    return el
  }

  function slot(content, name) {
    const el = ui.h('span', 'aiditor-ui-section-' + name)
    if (content instanceof HTMLElement) el.appendChild(content)
    else el.textContent = String(content)
    return el
  }
})(window.aiditor = window.aiditor || {})

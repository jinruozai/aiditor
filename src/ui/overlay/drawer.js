// aiditor.ui.drawer — slide-in side panel.
//
// opts: { side?: 'right'|'left'|'top'|'bottom', title?, content, onClose? }
//
// Like modal, drawer is modal-class (focus trap + ARIA dialog). The open/
// close animation is driven by a CSS class, and unmount is deferred by
// --aiditor-dur-slow (read via ui.readNum) so the slide-out tween plays before
// the DOM detaches.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  let _idSeq = 0

  ui.drawer = function (opts) {
    const o = opts || {}
    const side = o.side || 'right'
    const back = ui.h('div', 'aiditor-ui-drawer-backdrop')
    const panel = ui.h('div', 'aiditor-ui-drawer aiditor-ui-drawer-' + side)

    let titleId = null
    if (o.title) {
      titleId = 'aiditor-drawer-title-' + (++_idSeq)
      const head = ui.h('div', 'aiditor-ui-drawer-head')
      const titleEl = ui.h('span', 'aiditor-ui-drawer-title', { text: o.title })
      titleEl.id = titleId
      head.appendChild(titleEl)
      const x = ui.h('button', 'aiditor-ui-modal-close',
        { type: 'button', text: '×', 'aria-label': 'Close drawer' })
      x.addEventListener('click', function () { overlay.close() })
      head.appendChild(x)
      panel.appendChild(head)
    }

    const body = ui.h('div', 'aiditor-ui-drawer-body')
    if (o.content) {
      body.appendChild(o.content)
      ui.collect(panel, function () { ui.dispose(o.content) })
    }
    panel.appendChild(body)
    back.appendChild(panel)

    const unmount = ui.portal(back)
    requestAnimationFrame(function () { panel.classList.add('aiditor-ui-drawer-open') })

    const overlay = ui._overlay.open(panel, {
      modal:          true,
      outsideTarget:  back,
      dismissOnOutside: true,
      role:           'dialog',
      ariaLabelledBy: titleId || undefined,
      ariaLabel:      titleId ? undefined : (o.ariaLabel || 'Drawer'),
      onDismiss: function (cause) {
        panel.classList.remove('aiditor-ui-drawer-open')
        if (cause === 'dispose') {
          unmount()
          o.onClose && o.onClose()
          return
        }
        // Slide-out transition uses --aiditor-dur-slow; unmount after it finishes.
        setTimeout(function () { ui.dispose(panel); unmount(); o.onClose && o.onClose() },
          ui.readNum('--aiditor-dur-slow', 240))
      },
    })

    return { el: panel, close: overlay.close }
  }
})(window.aiditor = window.aiditor || {})

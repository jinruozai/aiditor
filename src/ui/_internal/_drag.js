// UI library — pointer drag helper.
//
// Used by sliders, vector inputs (drag-to-scrub on labels), color picker
// canvases, range sliders, etc. Captures the pointer on the target element
// so events keep flowing even if the cursor leaves the element.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // attachDrag(el, handlers)
  //   handlers.onStart(e, ctx)
  //   handlers.onMove (e, ctx)
  //   handlers.onEnd  (e, ctx)
  //   handlers.onCancel(e, ctx)
  //   ctx = { startX, startY, dx, dy, target }
  ui.attachDrag = function (el, handlers) {
    let active = null

    function clearActive() {
      if (!active) return null
      const current = active
      active = null
      el.removeEventListener('pointermove', current.onMove)
      el.removeEventListener('pointerup', current.onUp)
      el.removeEventListener('pointercancel', current.onCancel)
      try { el.releasePointerCapture(current.pointerId) } catch (_) {}
      return current
    }

    function onDown(e) {
      if (active) return
      if (e.button !== 0) return
      e.preventDefault()
      const ctx = { startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, target: el }
      try { el.setPointerCapture(e.pointerId) } catch (_) {}
      handlers.onStart && handlers.onStart(e, ctx)
      function onMove(ev) {
        ctx.dx = ev.clientX - ctx.startX
        ctx.dy = ev.clientY - ctx.startY
        handlers.onMove && handlers.onMove(ev, ctx)
      }
      function onUp(ev) {
        if (!active) return
        clearActive()
        handlers.onEnd && handlers.onEnd(ev, ctx)
      }
      function onCancel(ev) {
        if (!active) return
        clearActive()
        if (handlers.onCancel) handlers.onCancel(ev, ctx)
        else if (handlers.onEnd) handlers.onEnd(ev, ctx)
      }
      active = { onMove: onMove, onUp: onUp, onCancel: onCancel, pointerId: e.pointerId, ctx: ctx }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onCancel)
    }
    el.addEventListener('pointerdown', onDown)
    return function () {
      const current = clearActive()
      if (current && handlers.onCancel) handlers.onCancel(null, current.ctx)
      el.removeEventListener('pointerdown', onDown)
    }
  }
})(window.aiditor = window.aiditor || {})

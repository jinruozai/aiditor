// UI library - overlay controller.
//
// Single authority for all aiditor.ui overlay widgets (popover, menu, modal,
// drawer). Owns the things that caused cross-component bugs when they were
// rolled by hand:
//
//   1. Overlay stack         Nested overlays dismiss in LIFO order. ESC only
//                            closes the topmost overlay, not every listener.
//   2. Outside-click         The down-handler passes the real pointer event
//                            through to the per-overlay dismissal check, so
//                            anchored overlays (popover/menu) can ignore
//                            clicks that land back on their own anchor
    //                            without relying on global `window.event`.
//   3. Focus trap + restore  Modal-class overlays capture Tab/Shift-Tab into
//                            themselves and restore the caller's focused
//                            element when they close. This is the a11y
//                            minimum for dialogs.
//   4. ARIA plumbing         role / aria-modal / aria-labelledby / aria-label
//                            are set once at open() and never duplicated by
//                            individual widgets.
//   5. z-index dispatch      Each overlay gets its own z stripe above the
//                            portal root so later-opened overlays layer
//                            correctly on top of earlier ones.
//
// Non-goals: toast stacking (those are non-modal, non-focus-stealing, auto-
// dismiss - handled inside toast.js). Inline alert/status (handled inline).
//
// API
//
//   const handle = ui._overlay.open(el, {
//     anchor?,             // HTMLElement - if set, treated as an anchored
//                          // overlay (popover/menu). Outside-click is still
//                          // active, but clicks on the anchor itself are
//                          // NOT treated as "outside".
//     modal?: boolean,     // true = modal-class overlay. Enables focus trap
//                          // + focus restore. backdrop is NOT created here;
//                          // the component owns its own visual backdrop.
//     dismissOnOutside?,   // default: true for anchored, false for modal.
//                          // Modal overlays still listen, but "outside"
//                          // means "on the backdrop element" - opt in via
//                          // { target: backdropEl } instead.
//     dismissOnEscape?,    // default: true.
//     outsideTarget?,      // HTMLElement. When set, a mousedown on this
//                          // specific element counts as "outside" (used by
//                          // modal/drawer backdrops).
//     focusTrap?,          // default: true if modal, false otherwise.
//     role?, ariaLabel?, ariaLabelledBy?, ariaModal?,
//     onDismiss,           // fired when the overlay is closed by this
//                          // controller (outside click, ESC, or
//                          // handle.close()). Components use it to run
//                          // their own cleanup + animations.
//   })
//
//   handle.close()         Close and pop off the stack. Idempotent.
//
// Notes on ordering
//
//   - The component is responsible for mounting its own DOM (usually via
//     ui.portal). This controller does NOT mount or unmount DOM - it just
//     wires dismissal, focus, and ARIA onto an already-mounted element.
//   - Components call open() right after mounting and should forward
//     { onDismiss } through to their own `close()` function so external
//     and internal dismissal go through the same code path.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // the stack
  // Each frame: { el, opts, prevFocus, onAnyDown, onKey, zBase }
  const stack = []
  let globalBound = false
  let lastPointerDownAt = 0

  function topFrame() { return stack.length ? stack[stack.length - 1] : null }
  function hasModalFrame() { return stack.some(function (f) { return f.opts.modal }) }

  function onGlobalKey(e) {
    if (e.key !== 'Escape') return
    const top = topFrame()
    if (!top) return
    if (top.opts.dismissOnEscape === false) return
    e.stopPropagation()
    dismiss(top, 'escape')
  }

  function onGlobalDown(e) {
    if (e.type === 'pointerdown') lastPointerDownAt = Date.now()
    else if (e.type === 'mousedown' && Date.now() - lastPointerDownAt < 80) return
    // Walk the stack from topmost down. Each frame decides whether this
    // event dismisses it. We stop as soon as one frame dismisses (so
    // clicking inside a lower overlay with a higher one open closes only
    // the higher one, preserving LIFO semantics).
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i]
      if (!f.armed) return            // opened by the very event we're handling - skip this tick
      if (f.el.contains(e.target)) return // click inside this overlay - keep it open
      if (f.opts.anchor && f.opts.anchor.contains(e.target)) return // on its anchor - component handles toggle
      if (f.opts.outsideTarget && !f.opts.outsideTarget.contains(e.target)) {
        // Modal path: only the explicitly-declared backdrop element counts.
        return
      }
      if (f.opts.dismissOnOutside === false) return
      dismiss(f, 'outside')
      return
    }
  }

  function bindGlobals() {
    if (globalBound) return
    globalBound = true
    // Capture phase so we see events before normal handlers run, which
    // lets us stop the ESC event from propagating into component keydown
    // listeners that might also close something.
    document.addEventListener('keydown', onGlobalKey, true)
    // mousedown (not click) so the dismissal happens before any click
    // handler the user installed - important for "click outside to close,
    // but also reopen if you click a different anchor" flows.
    document.addEventListener('pointerdown', onGlobalDown, true)
    document.addEventListener('mousedown', onGlobalDown, true)
  }

  function unbindGlobals() {
    if (!globalBound || stack.length > 0) return
    globalBound = false
    document.removeEventListener('keydown', onGlobalKey, true)
    document.removeEventListener('pointerdown', onGlobalDown, true)
    document.removeEventListener('mousedown', onGlobalDown, true)
  }

  // focus trap
  // Returns first + last tabbable descendant of root. Excludes disabled /
  // hidden / negative-tabindex items. Cheap because overlays are small.
  const FOCUSABLE_SEL =
    'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
    'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

  function tabbables(root) {
    return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE_SEL))
      .filter(function (n) { return n.offsetParent !== null || n === document.activeElement })
  }

  function installFocusTrap(frame) {
    function onTrapKey(e) {
      if (e.key !== 'Tab') return
      if (topFrame() !== frame) return
      const list = tabbables(frame.el)
      if (!list.length) { e.preventDefault(); frame.el.focus(); return }
      const first = list[0]
      const last  = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !frame.el.contains(active)) { e.preventDefault(); last.focus() }
      } else {
        if (active === last || !frame.el.contains(active)) { e.preventDefault(); first.focus() }
      }
    }
    frame.el.addEventListener('keydown', onTrapKey)
    frame.uninstallTrap = function () { frame.el.removeEventListener('keydown', onTrapKey) }

    // Seed focus: first tabbable, else the overlay root itself.
    const list = tabbables(frame.el)
    if (list.length) list[0].focus()
    else { frame.el.tabIndex = -1; frame.el.focus() }
  }

  // dismiss + close
  function dismiss(frame, cause) {
    if (frame.closed) return
    frame.closed = true
    // Pop it (and any above it, though overlays dismissed via ESC/outside
    // should always be topmost by construction).
    const idx = stack.indexOf(frame)
    if (idx >= 0) stack.splice(idx, 1)
    if (frame.uninstallTrap) frame.uninstallTrap()
    // Restore focus for modal-class overlays.
    if (frame.opts.focusTrap && frame.prevFocus && typeof frame.prevFocus.focus === 'function') {
      try { frame.prevFocus.focus() } catch (e) {}
    }
    unbindGlobals()
    if (frame.opts.onDismiss) frame.opts.onDismiss(cause)
  }

  // public API
  ui._overlay = {
    open: function (el, opts) {
      const o = opts || {}
      const isModal = !!o.modal
      const frame = {
        el:          el,
        opts: {
          anchor:           o.anchor || null,
          outsideTarget:    o.outsideTarget || null,
          modal:            isModal,
          dismissOnOutside: o.dismissOnOutside != null ? o.dismissOnOutside : !isModal,
          dismissOnEscape:  o.dismissOnEscape  != null ? o.dismissOnEscape  : true,
          focusTrap:        o.focusTrap        != null ? o.focusTrap        : isModal,
          onDismiss:        o.onDismiss || null,
        },
        prevFocus:   document.activeElement,
        closed:      false,
        uninstallTrap: null,
      }

      // ARIA plumbing.
      if (o.role) el.setAttribute('role', o.role)
      if (isModal && o.ariaModal !== false) el.setAttribute('aria-modal', 'true')
      if (o.ariaLabel) el.setAttribute('aria-label', o.ariaLabel)
      if (o.ariaLabelledBy) el.setAttribute('aria-labelledby', o.ariaLabelledBy)

      // z-index: each overlay gets +1 above the previous top of stack.
      // Anchored overlays opened from a modal must use the modal stripe too;
      // otherwise combobox/menu popovers render behind the modal backdrop.
      // calc() defers resolution to the browser so live theme overrides of
      // the z-index tokens take effect with no JS-side mirror.
      const zBase = (isModal || hasModalFrame()) ? '--aiditor-z-modal' : '--aiditor-z-popover'
      el.style.zIndex = 'calc(var(' + zBase + ') + ' + (stack.length + 1) + ')'

      // Start unarmed, so the very same mousedown/click that opened this
      // overlay won't immediately dismiss it. Arm on the next tick.
      frame.armed = false
      setTimeout(function () { frame.armed = true }, 0)

      stack.push(frame)
      bindGlobals()

      if (frame.opts.focusTrap) installFocusTrap(frame)

      return {
        close: function () { dismiss(frame, 'api') },
      }
    },

    // Test / advanced helper - snapshot of current stack depth.
    depth: function () { return stack.length },
  }
})(window.aiditor = window.aiditor || {})

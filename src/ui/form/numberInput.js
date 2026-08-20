// aiditor.ui.numberInput — Blender-style numeric input with drag-to-scrub.
//
// Interaction model (unified pointer session):
//   • Hover shows an ew-resize cursor on the entire control body.
//   • Press-and-drag (pointer move ≥ 3px) → scrub, step scaled by shift/ctrl.
//   • Press-and-release without movement on the text field → enter edit mode
//     (the field becomes editable, value is selected).
//   • Double-click anywhere on the body → enter edit mode.
//   • Enter / blur commit the edit. Escape cancels.
//   • ↑ / ↓ keys adjust by `step` while editing (and without scrubbing).
//   • ‹ / › buttons nudge by `step`.
//
// opts: {
//   value: number|signal, onChange?,
//   min?: number|signal, max?: number|signal, step?: number|signal,
//   precision?: number|signal,
//   suffix?: string|signal, label?: string|signal,
//   radix?: 'dec' | 'hex' | 'bin'       // integer display base (default 'dec')
//   percent?: boolean                   // display float × 100 + "%" (float only)
// }
//
// `radix` and `percent` only affect what the user SEES / TYPES in the text
// field. The committed signal value is always a plain number (integer for
// hex/bin, fractional [0..1] for percent). Scrub / nudge use the raw value
// directly, unaware of the display format.
//
// Note: min/max/step are live signals — changing them at runtime re-clamps
// the displayed value and re-quantizes future scrub/nudge sessions.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.numberInput = function (opts) {
    const o = opts || {}
    const sig    = ui.asSig(o.value     != null ? o.value     : 0)
    const minS   = ui.asSig(o.min       != null ? o.min       : -Infinity)
    const maxS   = ui.asSig(o.max       != null ? o.max       :  Infinity)
    const stepS  = ui.asSig(o.step      != null ? o.step      : 1)
    const precS  = ui.asSig(o.precision != null ? o.precision : null)  // null = derive
    const label  = ui.asSig(o.label     != null ? o.label     : '')
    const suffix = ui.asSig(o.suffix    != null ? o.suffix    : '')
    const disabled = ui.asSig(o.disabled != null ? o.disabled : false)
    const radix   = o.radix   || 'dec'              // construction-time, not reactive
    const percent = !!o.percent
    const doWrite = ui.writer(sig, o.onChange, 'ui.numberInput')
    const scrubGesture = ui.editGesture({ get: function () { return sig.peek() }, write: doWrite })

    const el  = ui.h('div', 'aiditor-ui-num')
    const lab = ui.h('span', 'aiditor-ui-num-label')
    const body = ui.h('span', 'aiditor-ui-num-body')
    const dec = ui.h('button', 'aiditor-ui-num-step aiditor-ui-num-step-l', { type: 'button', text: '‹' })
    const txt = ui.h('input', 'aiditor-ui-num-text', { type: 'text' })
    const inc = ui.h('button', 'aiditor-ui-num-step aiditor-ui-num-step-r', { type: 'button', text: '›' })
    const sfx = ui.h('span', 'aiditor-ui-num-suffix')
    txt.readOnly = true
    body.appendChild(dec); body.appendChild(txt); body.appendChild(inc); body.appendChild(sfx)
    el.appendChild(lab); el.appendChild(body)

    ui.bindText(lab, label)
    ui.bind(el, label,  function (v) { lab.style.display = (v == null || v === '') ? 'none' : '' })
    ui.bindText(sfx, suffix)
    ui.bind(el, suffix, function (v) { sfx.style.display = (v == null || v === '') ? 'none' : '' })
    ui.bindAttr(dec, disabled, 'disabled')
    ui.bindAttr(inc, disabled, 'disabled')
    ui.bindAttr(txt, disabled, 'disabled')
    ui.bind(el, disabled, function (v) { el.classList.toggle('aiditor-ui-num-disabled', !!v) })

    function prec() {
      const p = precS.peek()
      if (p != null) return p
      return stepS.peek() >= 1 ? 0 : 3
    }
    function clamp(v) { return Math.max(minS.peek(), Math.min(maxS.peek(), v)) }
    function fmt(v) {
      const n = Number(v) || 0
      if (radix === 'hex') {
        const i = Math.trunc(n)
        return (i < 0 ? '-' : '') + '0x' + Math.abs(i).toString(16)
      }
      if (radix === 'bin') {
        const i = Math.trunc(n)
        return (i < 0 ? '-' : '') + '0b' + Math.abs(i).toString(2)
      }
      if (percent) return (n * 100).toFixed(prec()) + '%'
      return n.toFixed(prec())
    }
    function parseInput(s) {
      s = String(s).trim()
      if (!s) return 0
      if (radix === 'hex' || radix === 'bin') {
        let sign = 1; if (s[0] === '-') { sign = -1; s = s.slice(1) }
        const base = radix === 'hex' ? 16 : 2
        const body = /^0[xb]/i.test(s) ? s.slice(2) : s
        const n = parseInt(body, base)
        return Number.isFinite(n) ? sign * n : 0
      }
      if (percent) {
        const stripped = s.replace(/%$/, '')
        const n = Number(stripped)
        if (!Number.isFinite(n)) return 0
        return /%$/.test(s) ? n / 100 : n
      }
      const n = Number(s)
      return Number.isFinite(n) ? n : 0
    }
    function normalized(v) {
      const raw = typeof v === 'string' ? parseInput(v) : Number(v)
      const n = clamp(raw)
      if (!Number.isFinite(n)) return null
      // For hex/bin we keep integer precision; for percent the signal holds the
      // raw fraction, not the displayed "N%". Round-trip through fmt only for
      // the default decimal path (preserves precision-field contract).
      if (radix === 'hex' || radix === 'bin') return Math.trunc(n)
      if (percent) return Number(n.toFixed(prec() + 2))
      return Number(n.toFixed(prec()))
    }
    function commit(v, meta) {
      const next = normalized(v)
      if (next != null) doWrite(next, meta)
    }

    let editing = false
    // Re-render when value OR min/max/step/precision changes. When min/max
    // changes we also re-clamp — but only if the current value is finite.
    // Otherwise clamp(undefined)=NaN would write NaN back, which cascades
    // through any caller-supplied onChange and, if that onChange re-derives
    // our sig via a signal graph, produces an infinite re-entrant write. The
    // caller owns what "undefined" means — don't auto-coerce it.
    function reclamp() {
      if (editing) return
      const cur = sig.peek()
      if (!Number.isFinite(cur)) { txt.value = fmt(cur); return }
      const c = clamp(cur)
      if (c !== cur) doWrite(c)
      else txt.value = fmt(cur)
    }
    ui.bind(el, sig,   function ()  { if (!editing) txt.value = fmt(sig.peek()) })
    ui.bind(el, minS,  reclamp)
    ui.bind(el, maxS,  reclamp)
    ui.bind(el, stepS, function ()  { if (!editing) txt.value = fmt(sig.peek()) })
    ui.bind(el, precS, function ()  { if (!editing) txt.value = fmt(sig.peek()) })

    function enterEdit() {
      if (disabled.peek()) return
      if (editing) return
      editing = true
      txt.readOnly = false
      el.classList.add('aiditor-ui-num-editing')
      requestAnimationFrame(function () { txt.focus(); txt.select() })
    }
    function exitEdit(commitFlag) {
      if (!editing) return
      editing = false
      el.classList.remove('aiditor-ui-num-editing')
      if (commitFlag) commit(txt.value)
      txt.readOnly = true
      txt.value = fmt(sig.peek())
    }
    ui.bind(el, disabled, function (v) { if (v) exitEdit(false) })

    function handled(e) {
      e.preventDefault()
      if (aiditor.shortcuts) aiditor.shortcuts.markHandled(e)
    }

    const SCRUB_THRESHOLD = 3
    el.addEventListener('pointerdown', function (e) {
      if (disabled.peek()) return
      if (e.button !== 0) return
      if (editing) return
      if (e.target === dec || e.target === inc) return
      e.preventDefault()
      const startX = e.clientX
      const startVal = sig.peek()
      const targetWasText = (e.target === txt)
      let scrubbing = false
      try { el.setPointerCapture(e.pointerId) } catch (_) {}

      function onMove(ev) {
        const dx = ev.clientX - startX
        if (!scrubbing) {
          if (Math.abs(dx) < SCRUB_THRESHOLD) return
          scrubbing = true
          scrubGesture.begin('number.scrub')
          el.classList.add('aiditor-ui-num-scrubbing')
        }
        let mul = stepS.peek()
        if (ev.shiftKey) mul *= 10
        if (ev.ctrlKey || ev.metaKey) mul /= 10
        const next = normalized(startVal + dx * mul)
        if (next != null) scrubGesture.update(next)
      }
      function finish(ev, cancelled) {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onCancel)
        try { el.releasePointerCapture(ev.pointerId) } catch (_) {}
        if (scrubbing) {
          el.classList.remove('aiditor-ui-num-scrubbing')
          if (cancelled) scrubGesture.cancel()
          else scrubGesture.commit()
        }
        else if (targetWasText) enterEdit()
      }
      function onUp(ev) { finish(ev, false) }
      function onCancel(ev) { finish(ev, true) }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onCancel)
    })

    el.addEventListener('dblclick', function (e) {
      if (disabled.peek()) return
      if (e.target === dec || e.target === inc) return
      enterEdit()
    })

    // Blur always commits. Escape does an explicit revert via exitEdit(false)
    // BEFORE blurring; exitEdit's `if (!editing) return` guard then makes the
    // subsequent blur-driven exitEdit(true) a no-op, so Escape never writes.
    txt.addEventListener('blur', function () { exitEdit(true) })
    txt.addEventListener('keydown', function (e) {
      if (disabled.peek()) return
      if (e.key === 'Enter')           { handled(e); txt.blur() }
      else if (e.key === 'Escape')     { handled(e); exitEdit(false); txt.blur() }
      else if (e.key === 'ArrowUp')    { handled(e); commit(sig.peek() + stepS.peek()) }
      else if (e.key === 'ArrowDown')  { handled(e); commit(sig.peek() - stepS.peek()) }
    })
    dec.addEventListener('click', function () { if (!disabled.peek()) commit(sig.peek() - stepS.peek()) })
    inc.addEventListener('click', function () { if (!disabled.peek()) commit(sig.peek() + stepS.peek()) })

    return el
  }
})(window.aiditor = window.aiditor || {})

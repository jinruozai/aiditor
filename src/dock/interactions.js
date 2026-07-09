// Dock interactions — splitter drag + corner drag (split / merge).
//
//   1. Splitter drag      → resizeAt
//   2. Corner drag inward → splitDock (new dock seeded from active panel)
//   3. Corner drag outward to a sibling → mergeDocks
//
// Drag gestures mutate `flex` styles directly during the gesture and only
// commit to the signal on pointerup, so resizing never triggers reconcile.
//
// Panel drag (tab tear-out, cross-dock move, pop-out) lives in its own file
// dock/panel-drag.js — that's an independent subsystem, no shared state.
// Both read the drag threshold from --aiditor-drag-threshold via ui.readNum().
;(function (aiditor) {
  'use strict'

  const findDock = aiditor.findDock
  const resizeAt = aiditor.resizeAt

  // Drag threshold comes from --aiditor-drag-threshold (theme.css). Read per drag
  // session so live theme edits take effect on the next drag.

  // attachSplitterDrag / attachCornerDrag both receive the layout runtime
  // (not just the treeSig) so they can route split commits through
  // computeSplitSeed (§ 4.1) and merge commits through the dirty-aware
  // mergeDocks hook (§ 4.2).

  function attachSplitterDrag(splitter, splitEl, splitNode, splitPath, idx, layout) {
    const treeSig = layout.treeSig
    splitter.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return
      e.preventDefault()
      splitter.setPointerCapture(e.pointerId)
      splitter.classList.add('aiditor-splitter-active')
      document.body.classList.add('aiditor-dragging', 'aiditor-dragging-' + splitNode.direction)

      const isH = splitNode.direction === 'horizontal'
      const rect = splitEl.getBoundingClientRect()
      const total = isH ? rect.width : rect.height
      const start = isH ? e.clientX : e.clientY

      const wraps = splitEl.querySelectorAll(':scope > .aiditor-split-child')
      const a = wraps[idx], b = wraps[idx + 1]
      const sizes = splitNode.sizes.slice()
      const origA = sizes[idx], origB = sizes[idx + 1]
      const combined = origA + origB
      const min = combined * 0.04
      let committed = sizes
      let done = false

      function onMove(ev) {
        const delta = ((isH ? ev.clientX : ev.clientY) - start) / total
        let na = origA + delta, nb = origB - delta
        if (na < min) { na = min; nb = combined - na }
        if (nb < min) { nb = min; na = combined - nb }
        // ×100 — keep grow factors comfortably above the CSS Flex § 9.7.12.3
        // "sum of grows < 1 wastes free space" threshold. Must match render.js
        // createSplit so live drag and committed render use the same scale.
        a.style.flex = (na * 100) + ' 0 0'
        b.style.flex = (nb * 100) + ' 0 0'
        committed = sizes.slice()
        committed[idx] = na
        committed[idx + 1] = nb
      }

      function cleanup() {
        if (done) return false
        done = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('blur', onCancel)
        splitter.removeEventListener('lostpointercapture', onCancel)
        splitter.classList.remove('aiditor-splitter-active')
        document.body.classList.remove('aiditor-dragging', 'aiditor-dragging-horizontal', 'aiditor-dragging-vertical')
        return true
      }

      function onUp() {
        if (cleanup()) treeSig.set(resizeAt(treeSig.peek(), splitPath, committed))
      }

      function onCancel() { cleanup() }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('blur', onCancel)
      splitter.addEventListener('lostpointercapture', onCancel)
    })
  }

  function attachCornerDrag(handle, dockId, corner, layout) {
    const treeSig = layout.treeSig
    handle.addEventListener('contextmenu', function (e) {
      if (!layout.dockMenu || !aiditor._dock.openDockMenu) return
      e.preventDefault()
      e.stopPropagation()
      aiditor._dock.openDockMenu({ x: e.clientX, y: e.clientY }, dockId, layout)
    })

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)

      const dockEl = handle.closest('.aiditor-dock')
      const dockRect = dockEl.getBoundingClientRect()

      const overlay = document.createElement('div')
      overlay.className = 'aiditor-overlay'
      document.body.appendChild(overlay)

      document.body.classList.add('aiditor-dragging')
      dockEl.classList.add('aiditor-dock-dragging')

      const startX = e.clientX, startY = e.clientY
      const threshold = aiditor.ui.readNum('--aiditor-drag-threshold', 6)
      let mode = null
      let mergeTargetId = null
      let ratio = 0.5
      let done = false

      function onMove(ev) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
          overlay.style.display = 'none'
          mode = null
          return
        }

        const inside = ev.clientX >= dockRect.left && ev.clientX <= dockRect.right &&
                       ev.clientY >= dockRect.top  && ev.clientY <= dockRect.bottom

        if (inside) {
          const horizDominant = Math.abs(dx) > Math.abs(dy)
          overlay.style.display = 'block'
          overlay.className = 'aiditor-overlay aiditor-overlay-split'
          overlay.style.left   = dockRect.left   + 'px'
          overlay.style.top    = dockRect.top    + 'px'
          overlay.style.width  = dockRect.width  + 'px'
          overlay.style.height = dockRect.height + 'px'
          overlay.replaceChildren()

          if (horizDominant) {
            mode = 'split-h'
            const x = clamp(ev.clientX - dockRect.left, 0, dockRect.width)
            ratio = corner.charAt(1) === 'l'
              ? x / dockRect.width
              : (dockRect.width - x) / dockRect.width
            const line = document.createElement('div')
            line.className = 'aiditor-preview-line-v'
            line.style.left = x + 'px'
            overlay.appendChild(line)
          } else {
            mode = 'split-v'
            const y = clamp(ev.clientY - dockRect.top, 0, dockRect.height)
            ratio = corner.charAt(0) === 't'
              ? y / dockRect.height
              : (dockRect.height - y) / dockRect.height
            const line = document.createElement('div')
            line.className = 'aiditor-preview-line-h'
            line.style.top = y + 'px'
            overlay.appendChild(line)
          }
        } else {
          const el = document.elementFromPoint(ev.clientX, ev.clientY)
          const targetDock = el && el.closest && el.closest('.aiditor-dock')
          if (targetDock && targetDock.dataset.dockId !== dockId &&
              canMergeInto(treeSig.peek(), dockId, targetDock.dataset.dockId)) {
            mode = 'merge'
            mergeTargetId = targetDock.dataset.dockId
            const r = targetDock.getBoundingClientRect()
            overlay.style.display = 'block'
            overlay.className = 'aiditor-overlay aiditor-overlay-merge'
            overlay.style.left   = r.left   + 'px'
            overlay.style.top    = r.top    + 'px'
            overlay.style.width  = r.width  + 'px'
            overlay.style.height = r.height + 'px'
            overlay.replaceChildren(makeMergeLabel())
          } else {
            mode = null
            overlay.style.display = 'none'
          }
        }
      }

      function cleanup() {
        if (done) return false
        done = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey)
        window.removeEventListener('blur', onCancel)
        handle.removeEventListener('lostpointercapture', onCancel)
        document.body.classList.remove('aiditor-dragging')
        dockEl.classList.remove('aiditor-dock-dragging')
        overlay.remove()
        return true
      }

      function onUp() {
        if (!cleanup()) return
        if (!mode) return
        const t = treeSig.peek()
        if (mode === 'split-h') {
          const side = corner.charAt(1) === 'l' ? 'before' : 'after'
          const seed = aiditor._dock.computeSplitSeed(t, dockId)
          const shell = aiditor._dock.computeSplitDockShell(t, dockId)
          treeSig.set(aiditor.splitDock(t, dockId, 'horizontal', side, ratio, { dock: shell, seedPanels: seed }).tree)
        } else if (mode === 'split-v') {
          const side = corner.charAt(0) === 't' ? 'before' : 'after'
          const seed = aiditor._dock.computeSplitSeed(t, dockId)
          const shell = aiditor._dock.computeSplitDockShell(t, dockId)
          treeSig.set(aiditor.splitDock(t, dockId, 'vertical', side, ratio, { dock: shell, seedPanels: seed }).tree)
        } else if (mode === 'merge') {
          // § 4.2 dirty check via layout hook
          const r = aiditor.mergeDocks(t, dockId, mergeTargetId)
          let proceed = true
          if (r.discardedPanels.some(function (p) { return p.dirty })) {
            const hook = layout.hooks && layout.hooks.onDirtyDiscard
            const choice = hook ? hook(r.discardedPanels) : 'cancel'
            proceed = (choice === 'discard')
          }
          if (proceed) treeSig.set(r.tree)
        }
      }

      function onKey(ev) {
        if (ev.key === 'Escape') { mode = null; cleanup() }
      }

      function onCancel() { mode = null; cleanup() }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey)
      window.addEventListener('blur', onCancel)
      handle.addEventListener('lostpointercapture', onCancel)
    })
  }

  function canMergeInto(tree, sourceId, neighborId) {
    if (sourceId === neighborId) return false
    const a = findDock(tree, sourceId)
    const b = findDock(tree, neighborId)
    if (!a || !b) return false
    if (a.path.length !== b.path.length) return false
    for (let i = 0; i < a.path.length - 1; i++)
      if (a.path[i] !== b.path[i]) return false
    return true
  }

  function makeMergeLabel() {
    const el = document.createElement('div')
    el.className = 'aiditor-merge-label'
    el.textContent = 'Merge →'
    return el
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  aiditor._dock = aiditor._dock || {}
  aiditor._dock.attachSplitterDrag = attachSplitterDrag
  aiditor._dock.attachCornerDrag   = attachCornerDrag
})(window.aiditor = window.aiditor || {})

// aiditor.ui._treeDnd — drag & drop layer for ui.tree.
//
// Lives in its own file so the core tree stays readable when DnD is not
// in use (the attach call is a no-op when opts.dnd is omitted). The layer
// owns:
//   · drag session state (source nodes, drag data payload, live target)
//   · ghost preview element (follows cursor)
//   · drop indicator (line between rows for before/after, outline for inside)
//   · auto-expand timer when hovering over a collapsed target
//   · auto-scroll when cursor nears viewport top/bottom edges
//   · cycle prevention (dragging parent into its own descendant)
//   · platform modifier for toggling inside vs before/after if ambiguous
//
// Contract with tree.js:
//   ui._treeDnd.attach(rootEl, itemsSig, expandedSig, flatSig, dndOpts, treeCtx)
// where treeCtx exposes the live available-projection index + selection
// bridge. Pointer sessions retain ids and resolve current nodes at use time.
// Tree.js imports no DnD code directly — this file self-registers on load.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // Drag starts after pointer moves past this distance; avoids flipping every
  // click into a drag. Read from the CSS token (same knob as dock drag in
  // dock/interactions.js) so a single theme-wide adjustment retunes both.
  function dragThreshold() {
    return (ui.readNum && ui.readNum('--aiditor-drag-threshold', 6)) || 6
  }

  function nearestRow(rootEl, clientX, clientY) {
    // document.elementFromPoint + walk up to the row element. Works under
    // virtualization — only rows actually in the DOM participate, which is
    // what we want (can't drop onto a row that isn't rendered).
    let el = document.elementFromPoint(clientX, clientY)
    while (el && el !== rootEl) {
      if (el.classList && el.classList.contains('aiditor-ui-tree-row')) return el
      el = el.parentNode
    }
    return null
  }

  // Classify the drop position from cursor offset within a row.
  //
  // Containers should feel easy to drop into, not like a pixel-hunt: when
  // `inside` is allowed the middle band owns most of the row. Before/after
  // stay available at the top/bottom edges for deliberate sibling inserts.
  // Moving right within the label area reinforces "make child" intent,
  // matching common outliner/file-tree behavior while keeping the API small.
  function classifyPosition(rowEl, clientX, clientY, zones) {
    const rect = rowEl.getBoundingClientRect()
    const rel = (clientY - rect.top) / rect.height
    const allowBefore = zones.indexOf('before') >= 0
    const allowInside = zones.indexOf('inside') >= 0
    const allowAfter  = zones.indexOf('after')  >= 0
    if (allowInside) {
      if (rel < 0.16 && allowBefore) return 'before'
      if (rel > 0.84 && allowAfter)  return 'after'
      if (clientX > rect.left + 24) return 'inside'
      return 'inside'
    }
    if (allowBefore && allowAfter) return rel < 0.5 ? 'before' : 'after'
    if (allowBefore) return 'before'
    if (allowAfter)  return 'after'
    return null
  }

  function defaultGhost(nodes) {
    const el = ui.h('div', 'aiditor-ui-tree-ghost')
    const first = nodes[0]
    const lab = first.label != null ? String(first.label) : String(first.id)
    el.textContent = nodes.length > 1 ? (lab + '  + ' + (nodes.length - 1)) : lab
    return el
  }

  ui._treeDnd = {
    attach: function (rootEl, itemsSig, expandedSig, flatSig, dnd, treeCtx) {
      if (typeof dnd.onDrop !== 'function') {
        console.warn('[ui.tree] dnd enabled but onDrop missing — DnD disabled')
        return
      }
      const canDrag       = typeof dnd.canDrag === 'function' ? dnd.canDrag : function () { return true }
      const canDrop       = typeof dnd.canDrop === 'function' ? dnd.canDrop : function () { return true }
      const getDragData   = typeof dnd.getDragData === 'function' ? dnd.getDragData : null
      const renderPreview = typeof dnd.renderDragPreview === 'function' ? dnd.renderDragPreview : defaultGhost
      const dropZonesFn   = typeof dnd.dropZones === 'function' ? dnd.dropZones : null
      const autoExpandDelay = dnd.autoExpandDelay != null ? dnd.autoExpandDelay : 500

      function rowFromElement(rowEl) {
        const entry = rowEl && rowEl.__aiditorTreeEntry
        return entry ? entry.row : null
      }

      function currentProjectionEntry(id) {
        return treeCtx.projection.peek().index.get(id) || null
      }

      function isDescendant(sourceId, targetId) {
        let current = currentProjectionEntry(targetId)
        while (current && current.parentId != null) {
          if (current.parentId === sourceId) return true
          current = currentProjectionEntry(current.parentId)
        }
        return false
      }

      // Delegated pointerdown on the whole tree. Per-row listeners exist too
      // (for click/dblclick), but the drag session captures globally at
      // pointerdown to stay active even when the cursor leaves the tree bounds.
      rootEl.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return
        const rowEl = nearestRow(rootEl, ev.clientX, ev.clientY)
        if (!rowEl) return
        const row = rowFromElement(rowEl)
        if (!row) return
        const flat = flatSig.peek()
        if (!canDrag(row.node, row)) return

        // Determine source set — multi-select aware. If the dragged row is
        // part of the current selection (Finder semantics), drag the whole
        // selection; otherwise just the clicked row. Reading selection via
        // the tree's bridge avoids duplicating the single/multi shape logic.
        const selSet = treeCtx.readSelSet()
        const dragNodes = selSet.has(row.node.id)
          ? flat.filter(function (r) { return selSet.has(r.node.id) && canDrag(r.node, r) }).map(function (r) { return r.node })
          : [row.node]

        // Wait for threshold before committing to a drag. Clicks below the
        // threshold are handed back to the row's click handler untouched.
        const startX = ev.clientX, startY = ev.clientY
        const th = dragThreshold()
        let armed = false
        let session = null

        function onMove(e) {
          if (!armed) {
            if (Math.abs(e.clientX - startX) < th && Math.abs(e.clientY - startY) < th) return
            armed = true
            session = startSession(e, dragNodes)
          }
          if (session) updateSession(session, e)
        }
        function onUp(e) {
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', onUp, true)
          window.removeEventListener('keydown', onKey, true)
          if (session) finishSession(session, e, false)
        }
        function onKey(e) {
          if (e.key === 'Escape' && session) {
            finishSession(session, null, true)
            window.removeEventListener('pointermove', onMove, true)
            window.removeEventListener('pointerup', onUp, true)
            window.removeEventListener('keydown', onKey, true)
          }
        }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', onUp, true)
        window.addEventListener('keydown', onKey, true)
      })

      // Portal — ghost and indicator live at the document level so they're
      // not clipped by the tree's overflow:auto. We bail on the full
      // portal infrastructure: a single positioned div is enough.
      function makePortal() {
        const p = ui.h('div', 'aiditor-ui-tree-dnd-portal')
        p.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999'
        document.body.appendChild(p)
        return p
      }

      function startSession(ev, dragNodes) {
        const portal = makePortal()
        const ghost = renderPreview(dragNodes)
        ghost.classList.add('aiditor-ui-tree-ghost-wrap')
        portal.appendChild(ghost)
        // Indicator has two visual modes (line vs outline) — we toggle a
        // class on the same element instead of maintaining two nodes.
        const indicator = ui.h('div', 'aiditor-ui-tree-drop-indicator')
        portal.appendChild(indicator)

        const dragData = getDragData
          ? getDragData(dragNodes)
          : { types: ['aiditor.tree/node'], payload: dragNodes.map(function (n) { return n.id }) }

        // Dim the source rows so the user can tell what's being moved.
        const sourceIds = new Set(dragNodes.map(function (n) { return n.id }))
        treeCtx._flat = flatSig  // (retained reference for virtualizer hooks)
        applySourceDim(sourceIds, true)

        const session = {
          portal: portal, ghost: ghost, indicator: indicator,
          dragData: dragData,
          sourceIds: sourceIds,
          hover: null,             // { row, rowEl, position, allowed }
          autoExpandId: null, autoExpandTimer: 0,
          autoScrollRaf: 0, scrollVelocity: 0,
        }
        positionGhost(session, ev)
        return session
      }

      function applySourceDim(ids, on) {
        // Decorate row elements currently in the virtualizer cache so the
        // user gets immediate feedback. Scrolled-out rows are recreated by
        // the virtualizer without the class — sourceIds is checked again
        // via a global CSS [data-dragging-id] match on re-render. Simpler:
        // brute-force toggle classes on cached rows only, and accept that
        // a row scrolling back in mid-drag won't be dimmed (edge case).
        const cache = rootEl.__aiditorTree && rootEl.__aiditorTree._rowCache
        if (!cache) return
        cache.forEach(function (entry) {
          if (ids.has(entry.row.node.id)) entry.el.classList.toggle('aiditor-ui-tree-row-dragging', on)
        })
      }

      function positionGhost(session, ev) {
        // Offset slightly from the cursor — matches native drag-image feel
        // and keeps the ghost from swallowing cursor targeting.
        session.ghost.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 8) + 'px)'
      }

      function zonesFor(node, row) {
        if (dropZonesFn) return dropZonesFn(node, row) || []
        const hasKids = !!(node.children && node.children.length)
        // Leaf nodes still get "inside" by default (turning them into a
        // container is the caller's call via canDrop); drop this in dropZones
        // if you want strict leaf-no-inside semantics.
        return hasKids ? ['before', 'inside', 'after'] : ['before', 'inside', 'after']
      }

      function decideDrop(session, ev) {
        if (!ev) return null
        const rowEl = nearestRow(rootEl, ev.clientX, ev.clientY)
        if (!rowEl) return null
        const row = rowFromElement(rowEl)
        if (!row) return null
        const target = currentProjectionEntry(row.node.id)
        if (!target) return null

        let blocked = false
        session.sourceIds.forEach(function (sourceId) {
          if (!currentProjectionEntry(sourceId) || target.node.id === sourceId || isDescendant(sourceId, target.node.id)) blocked = true
        })
        const zones = blocked ? [] : zonesFor(target.node, row)
        const position = zones.length ? classifyPosition(rowEl, ev.clientX, ev.clientY, zones) : null
        let allowed = !blocked && !!position
        if (allowed) allowed = !!canDrop(target.node, position, session.dragData)
        return {
          targetId: target.node.id,
          target: target.node,
          row: row,
          rowEl: rowEl,
          position: position,
          allowed: allowed,
        }
      }

      function updateSession(session, ev) {
        positionGhost(session, ev)
        session.hover = decideDrop(session, ev)
        if (!session.hover) {
          hideIndicator(session)
          scheduleAutoExpand(session, null, null)
          scheduleAutoScroll(session, ev)
          return
        }
        paintIndicator(session)
        scheduleAutoExpand(session, session.hover.row, session.hover.position)
        scheduleAutoScroll(session, ev)
      }

      function hideIndicator(session) {
        session.indicator.style.display = 'none'
        session.indicator.classList.remove('aiditor-ui-tree-drop-inside')
        session.indicator.classList.remove('aiditor-ui-tree-drop-reject')
      }

      function paintIndicator(session) {
        const h = session.hover
        if (!h || !h.position) { hideIndicator(session); return }
        const rect = h.rowEl.getBoundingClientRect()
        const ind = session.indicator
        ind.style.display = 'block'
        ind.classList.toggle('aiditor-ui-tree-drop-reject', !h.allowed)
        if (h.position === 'inside') {
          ind.classList.add('aiditor-ui-tree-drop-inside')
          ind.style.left = rect.left + 'px'
          ind.style.top = rect.top + 'px'
          ind.style.width = rect.width + 'px'
          ind.style.height = rect.height + 'px'
        } else {
          ind.classList.remove('aiditor-ui-tree-drop-inside')
          const y = h.position === 'before' ? rect.top : rect.bottom
          ind.style.left = rect.left + 'px'
          ind.style.top = (y - 1) + 'px'
          ind.style.width = rect.width + 'px'
          ind.style.height = '2px'
        }
      }

      function scheduleAutoExpand(session, row, position) {
        if (!autoExpandDelay) return
        // Only auto-expand when hovering 'inside' a collapsed container —
        // the user's intent ("I want to dive deeper") is clear only then.
        const wantId = (row && position === 'inside' && !row.expanded) ? row.node.id : null
        if (wantId === session.autoExpandId) return
        if (session.autoExpandTimer) { clearTimeout(session.autoExpandTimer); session.autoExpandTimer = 0 }
        session.autoExpandId = wantId
        if (!wantId) return
        session.autoExpandTimer = setTimeout(function () {
          const cur = expandedSig.peek()
          const next = new Set(cur)
          next.add(wantId)
          expandedSig.set(next)
          session.autoExpandTimer = 0
        }, autoExpandDelay)
      }

      function scheduleAutoScroll(session, ev) {
        const rect = rootEl.getBoundingClientRect()
        const margin = 24
        let v = 0
        if (ev.clientY < rect.top + margin)    v = -((rect.top + margin) - ev.clientY) / 2
        else if (ev.clientY > rect.bottom - margin) v = (ev.clientY - (rect.bottom - margin)) / 2
        session.scrollVelocity = v
        if (v && !session.autoScrollRaf) {
          const step = function () {
            if (!session.scrollVelocity) { session.autoScrollRaf = 0; return }
            rootEl.scrollTop += session.scrollVelocity
            session.autoScrollRaf = requestAnimationFrame(step)
          }
          session.autoScrollRaf = requestAnimationFrame(step)
        }
      }

      function finishSession(session, ev, cancelled) {
        // Commit (or not), then unconditionally clean up to avoid leaks.
        const decision = cancelled ? null : decideDrop(session, ev)
        if (decision && decision.allowed) {
          if (decision.position === 'inside') {
            const cur = expandedSig.peek()
            const next = new Set(cur)
            next.add(decision.targetId)
            expandedSig.set(next)
          }
          try {
            dnd.onDrop(decision.target, decision.position, session.dragData)
          } catch (e) {
            console.error('[ui.tree] onDrop threw', e)
          }
        }
        if (session.autoExpandTimer) clearTimeout(session.autoExpandTimer)
        if (session.autoScrollRaf) cancelAnimationFrame(session.autoScrollRaf)
        session.scrollVelocity = 0
        applySourceDim(session.sourceIds, false)
        if (session.portal && session.portal.parentNode) session.portal.parentNode.removeChild(session.portal)
      }
    },
  }
})(window.aiditor = window.aiditor || {})

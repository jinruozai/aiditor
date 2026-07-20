// aiditor.ui.tree — virtualized tree with slots, search, multi-select, DnD.
//
// The component is architected in three rendering tiers — callers pick the
// one that matches their complexity budget, without changing the rest of
// the opts surface:
//
//   Tier 1 — slots:           leadingSlot / trailingSlot / actions
//                              Fastest to write. One function per slot, tree
//                              composes the row DOM around the node.
//   Tier 2 — renderRow:        user returns the entire row element.
//                              Tree still handles indent padding, events,
//                              ARIA, focus ring.
//   Tier 3 — renderTemplate:   user returns { root, update }. Tree keeps a
//                              pool of template instances and calls update()
//                              with the current node/row context as rows
//                              scroll in/out of view — no per-scroll DOM
//                              construction.
//
// Only one tier can be in effect per instance (renderTemplate > renderRow
// > slots). All tiers receive the same `ctx` so slot logic and full renders
// can share helpers.
//
// ── data contract ─────────────────────────────────────────────────────
//   TreeNode = { id, label?, icon?, children?, …caller-defined fields }
//   Caller owns `items: signal<TreeNode[]>`. Any data change is reflected
//   via items.set(...). Within a tree flatten, a node's identity is its `id`;
//   across flattens, new node objects at the same id are treated as "same
//   node with updated fields" for the purposes of expansion / selection.
//
//   `selected: signal<id[]>` is always an array (length ≤ 1 in single
//   select). `multi` defaults to true; `multi: false` collapses ctrl/shift
//   click to plain replace. `onSelect: (ids[]) => void` receives the new
//   selection array.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // ── constants & tiny utils ─────────────────────────────────────────
  const DEFAULT_ROW_H  = 24
  const DEFAULT_INDENT = 14

  const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '')
  function isModKey(ev) { return IS_MAC ? ev.metaKey : ev.ctrlKey }

  function defaultMatch(node, q) {
    const lab = String(node.label != null ? node.label : node.id)
    return lab.toLowerCase().indexOf(String(q).toLowerCase()) >= 0
  }

  function asSet(x) { return x instanceof Set ? x : new Set(x || []) }

  // ── flatten (search-aware) ─────────────────────────────────────────
  // Returns Array<Row> where Row = { node, depth, hasKids, expanded, matched }.
  // When a query is active (filter mode): two-pass — first collect the set
  // of visible ids (match OR has matching descendant) plus the set of ids
  // to auto-expand (has matching descendant). Second pass walks the tree
  // keeping only visible ids, honoring the auto-expand union. O(n) total.
  function flatten(items, expanded, query, match, behavior) {
    const out = []
    if (!query) {
      function walk(nodes, depth) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]
          const hasKids = !!(n.children && n.children.length)
          const isExp = expanded.has(n.id)
          out.push({ node: n, depth: depth, hasKids: hasKids, expanded: isExp, matched: false })
          if (hasKids && isExp) walk(n.children, depth + 1)
        }
      }
      walk(items, 0)
      return out
    }

    const matched = new Set()
    const visible = new Set()
    const autoExp = new Set()
    function scan(nodes) {
      let anyMatch = false
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const self = !!match(n, query)
        if (self) matched.add(n.id)
        const kidMatch = (n.children && n.children.length) ? scan(n.children) : false
        if (self || kidMatch) {
          visible.add(n.id)
          if (kidMatch) autoExp.add(n.id)
          anyMatch = true
        }
      }
      return anyMatch
    }
    scan(items)

    const highlightMode = behavior === 'highlight'
    function walk(nodes, depth) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        if (!highlightMode && !visible.has(n.id)) continue
        const hasKids = !!(n.children && n.children.length)
        const isExp = expanded.has(n.id) || autoExp.has(n.id)
        out.push({
          node: n, depth: depth, hasKids: hasKids, expanded: isExp,
          matched: matched.has(n.id),
        })
        if (hasKids && isExp) walk(n.children, depth + 1)
      }
    }
    walk(items, 0)
    return out
  }

  // All visible ids (expand-all / collapse-all helpers).
  function allIds(items) {
    const s = new Set()
    function walk(nodes) {
      for (let i = 0; i < nodes.length; i++) {
        s.add(nodes[i].id)
        if (nodes[i].children && nodes[i].children.length) walk(nodes[i].children)
      }
    }
    walk(items)
    return s
  }

  // ── highlight helper (exposed on ctx) ──────────────────────────────
  // Wraps query substring matches inside a text with <mark>. Single-pass,
  // case-insensitive. Returns a DocumentFragment so callers can append
  // directly without a wrapper element.
  function makeHighlight(query) {
    return function highlight(text) {
      const frag = document.createDocumentFragment()
      const s = String(text == null ? '' : text)
      if (!query) { frag.appendChild(document.createTextNode(s)); return frag }
      const low = s.toLowerCase()
      const q = String(query).toLowerCase()
      let i = 0
      while (i < s.length) {
        const hit = low.indexOf(q, i)
        if (hit < 0) { frag.appendChild(document.createTextNode(s.slice(i))); break }
        if (hit > i) frag.appendChild(document.createTextNode(s.slice(i, hit)))
        const mark = document.createElement('mark')
        mark.className = 'aiditor-ui-tree-match'
        mark.textContent = s.slice(hit, hit + q.length)
        frag.appendChild(mark)
        i = hit + q.length
      }
      return frag
    }
  }

  // ── default row renderer (Tier 1 — slots) ──────────────────────────
  // Builds:
  //   <div class="aiditor-ui-tree-row" role="treeitem" data-depth="N">
  //     <span class="aiditor-ui-tree-arrow">▸</span>   (or nothing if no arrow)
  //     <span class="aiditor-ui-tree-leading">…</span> (leadingSlot result)
  //     <span class="aiditor-ui-tree-icon">…</span>    (default icon if no slot)
  //     <span class="aiditor-ui-tree-label">…</span>
  //     <span class="aiditor-ui-tree-trailing">…</span>(trailingSlot result)
  //     <span class="aiditor-ui-tree-actions">…</span> (actions result)
  //   </div>
  function buildDefaultRow(opts, row, ctx) {
    const el = ui.h('div', 'aiditor-ui-tree-row')
    el.setAttribute('role', 'treeitem')
    el.setAttribute('data-depth', String(row.depth))
    el.style.paddingLeft = (4 + row.depth * opts._indent) + 'px'

    // Arrow (always takes space when reserved; clickable iff hasKids)
    const arrowMode = opts._showArrow
    const arrowShown = arrowMode === 'always'
      ? true
      : arrowMode === 'never'
        ? false
        : typeof arrowMode === 'function'
          ? !!arrowMode(row.node, row)
          : row.hasKids
    const arrow = ui.h('span', 'aiditor-ui-tree-arrow')
    if (arrowShown && row.hasKids) {
      arrow.textContent = row.expanded ? '▾' : '▸'
      arrow.addEventListener('click', function (e) {
        e.stopPropagation()
        ctx.toggle()
      })
    } else {
      arrow.textContent = ''
    }
    el.appendChild(arrow)

    // Leading slot (falls back to default icon if no slot but node.icon exists)
    if (opts.leadingSlot) {
      const node = opts.leadingSlot(row.node, ctx)
      if (node) {
        const w = ui.h('span', 'aiditor-ui-tree-leading')
        w.appendChild(node)
        stopInteractionPropagation(w)
        el.appendChild(w)
      }
    } else if (row.node.icon) {
      const ic = ui.h('span', 'aiditor-ui-tree-icon')
      ic.appendChild(ui.icon({ name: row.node.icon, size: 'sm' }))
      el.appendChild(ic)
    }

    // Label (with search highlight if query active)
    const lab = ui.h('span', 'aiditor-ui-tree-label')
    const labelText = row.node.label != null ? String(row.node.label) : String(row.node.id)
    if (opts.labelSlot && !ctx.query) {
      const node = opts.labelSlot(row.node, ctx)
      if (node) lab.appendChild(node)
      else lab.textContent = labelText
    } else if (ctx.query) {
      lab.appendChild(ctx.highlight(labelText))
    } else {
      lab.textContent = labelText
    }
    lab.title = labelText
    el.appendChild(lab)

    // Trailing slot
    if (opts.trailingSlot) {
      const node = opts.trailingSlot(row.node, ctx)
      if (node) {
        const w = ui.h('span', 'aiditor-ui-tree-trailing')
        w.appendChild(node)
        stopInteractionPropagation(w)
        el.appendChild(w)
      }
    }

    // Actions (right-side)
    if (opts.actions) {
      const list = opts.actions(row.node, ctx) || []
      if (list.length) {
        const ac = ui.h('span', 'aiditor-ui-tree-actions')
        ac.setAttribute('data-visibility', opts.actionsVisibility || 'hover')
        for (let i = 0; i < list.length; i++) {
          const a = list[i]
          if (!a) continue
          // Accept either an Action spec { icon, title, onClick, disabled? }
          // or a raw HTMLElement (escape hatch for bespoke controls).
          if (a.nodeType === 1) { ac.appendChild(a); continue }
          const btn = ui.iconButton({
            icon: a.icon, title: a.title || a.icon || 'action',
            size: 'sm', kind: 'ghost', disabled: a.disabled,
            onClick: function (ev) {
              ev.stopPropagation()
              if (typeof a.onClick === 'function') a.onClick(row.node, ev)
            },
          })
          ac.appendChild(btn)
        }
        stopInteractionPropagation(ac)
        el.appendChild(ac)
      }
    }
    return el
  }

  // Clicks on interactive slot children must not bubble up and trigger
  // the row's click (which would select or toggle). Catch at capture phase
  // so slot internals don't need to know about it.
  function stopInteractionPropagation(container) {
    container.addEventListener('click',    function (e) { e.stopPropagation() })
    container.addEventListener('dblclick', function (e) { e.stopPropagation() })
    container.addEventListener('pointerdown', function (e) { e.stopPropagation() })
  }

  // ── main ───────────────────────────────────────────────────────────
  ui.tree = function (opts) {
    const o = opts || {}
    const items = ui.asSig(o.items != null ? o.items : [])
    const rowH = o.rowHeight || DEFAULT_ROW_H
    const indent = o.indentSize || DEFAULT_INDENT

    // Interaction policy (resolved once, cached on opts)
    const showArrow = o.showArrow || 'has-children'
    const onRowClick    = o.onRowClick    || 'select'
    const onRowDblClick = o.onRowDblClick || 'auto'
    const selectable = typeof o.selectable === 'function' ? o.selectable : function () { return true }
    const keyboardOn = o.keyboard !== false
    const searchBehavior = o.searchBehavior || 'filter'

    // Selection — `selected: signal<id[]>` is always an array (length ≤ 1 in
    // single-select). multi defaults to true; `multi: false` collapses
    // ctrl/shift to plain click without changing the signal contract.
    const selSig = o.selected || null
    const multiMode = o.multi !== false
    const writeSel = selSig ? ui.writer(selSig, o.onSelect, 'ui.tree') : null
    function readSelSet() { return new Set(selSig ? (selSig.peek() || []) : []) }
    function writeSelSet(set) { if (writeSel) writeSel(Array.from(set)) }

    // Expansion signal — internal by default, caller may own it externally.
    const expanded = o.expanded || aiditor.signal(new Set())
    const writeExpanded = o.expanded ? ui.writer(o.expanded, null, 'ui.tree') : function (s) { expanded.set(s) }
    if (!o.expanded && o.defaultExpanded != null) {
      const init = o.defaultExpanded
      if (init === 'all') expanded.set(allIds(items.peek()))
      else if (Array.isArray(init)) expanded.set(new Set(init))
      else if (init === 'none') { /* empty by default */ }
    }

    // Search signal — may be absent, plain string, or signal.
    const searchSig = o.search != null ? ui.asSig(o.search) : aiditor.signal('')
    const matchFn = typeof o.matchNode === 'function' ? o.matchNode : defaultMatch

    // Focus/anchor tracked internally (non-reactive — only kbd cares).
    let focusedId = null
    let anchorId = null

    // Root element. Role + aria-multiselectable announce the tree to AT.
    const el = ui.h('div', 'aiditor-ui-tree aiditor-ui-scrollarea')
    el.setAttribute('role', 'tree')
    if (multiMode) el.setAttribute('aria-multiselectable', 'true')
    if (keyboardOn) el.tabIndex = 0
    const spacer = ui.h('div', 'aiditor-ui-tree-spacer')
    const win = ui.h('div', 'aiditor-ui-tree-window')
    el.appendChild(spacer); spacer.appendChild(win)
    if (writeSel) {
      el.addEventListener('pointerdown', function (ev) {
        if (ev.target.closest && ev.target.closest('.aiditor-ui-tree-row')) return
        focusedId = null
        anchorId = null
        writeSelSet(new Set())
      })
    }

    // Derived flat list; recomputed whenever items / expanded / search change.
    const flatSig = aiditor.derived(function () {
      return flatten(items(), expanded(), searchSig(), matchFn, searchBehavior)
    })
    ui.collect(el, flatSig.dispose)

    // Virtualizer state.
    const rowCache = new Map()   // index → { el, row }
    const tpool = []             // template instances when Tier 3 is active

    // Pick renderer tier.
    const tier3 = typeof o.renderTemplate === 'function' ? o.renderTemplate : null
    const tier2 = typeof o.renderRow === 'function' ? o.renderRow : null
    const _opts = {
      _indent: indent, _showArrow: showArrow,
      leadingSlot:  o.leadingSlot  || null,
      trailingSlot: o.trailingSlot || null,
      actions:      o.actions      || null,
      actionsVisibility: o.actionsVisibility || 'hover',
    }

    // Per-row ctx factory. Built fresh for each render call so captured
    // closures reference the current row. Imperative ops (toggle/select/
    // activate) re-read live signals — safe even after recycle.
    function makeCtx(row) {
      return {
        row: {
          depth: row.depth,
          hasKids: row.hasKids,
          expanded: row.expanded,
          focused: row.node.id === focusedId,
          selected: readSelSet().has(row.node.id),
          matched: row.matched,
        },
        query: searchSig.peek(),
        highlight: makeHighlight(searchSig.peek()),
        toggle:   function () { toggleNode(row.node.id) },
        select:   function (mode) { applyClickSelect(row, mode || 'replace') },
        activate: function () { if (typeof o.onActivate === 'function') o.onActivate(row.node) },
      }
    }

    function renderRow(row) {
      const ctx = makeCtx(row)
      if (tier3) {
        const tpl = tpool.pop() || tier3()
        tpl.update(row.node, row, ctx)
        tpl.root.classList.add('aiditor-ui-tree-row')
        tpl.root.setAttribute('role', 'treeitem')
        tpl.root.setAttribute('data-depth', String(row.depth))
        tpl.root.style.paddingLeft = (4 + row.depth * indent) + 'px'
        return { el: tpl.root, tpl: tpl }
      }
      if (tier2) {
        const rel = tier2(row.node, row, ctx)
        rel.classList.add('aiditor-ui-tree-row')
        if (!rel.getAttribute('role')) rel.setAttribute('role', 'treeitem')
        rel.setAttribute('data-depth', String(row.depth))
        rel.style.paddingLeft = (4 + row.depth * indent) + 'px'
        return { el: rel, tpl: null }
      }
      return { el: buildDefaultRow(_opts, row, ctx), tpl: null }
    }

    function applyRowState(rowEl, row) {
      const id = row.node.id
      const sel = readSelSet().has(id)
      const can = !!selectable(row.node, row)
      rowEl.classList.toggle('aiditor-ui-tree-row-active', sel)
      rowEl.classList.toggle('aiditor-ui-tree-row-focused', id === focusedId)
      rowEl.classList.toggle('aiditor-ui-tree-row-matched', !!row.matched)
      rowEl.classList.toggle('aiditor-ui-tree-row-disabled', !can)
      rowEl.setAttribute('aria-selected', sel ? 'true' : 'false')
      rowEl.setAttribute('aria-level', String(row.depth + 1))
      if (row.hasKids) rowEl.setAttribute('aria-expanded', row.expanded ? 'true' : 'false')
      else rowEl.removeAttribute('aria-expanded')
      rowEl.dataset.treeNodeId = String(id)
    }

    function attachRowEvents(rowEl, entry) {
      rowEl.addEventListener('click', function (ev) {
        handleRowClick(entry.row, ev)
      })
      rowEl.addEventListener('dblclick', function (ev) {
        handleRowDblClick(entry.row, ev)
      })
      // Opt-in HTML5 drag source. Coexists with tree.dnd (pointer-based
      // row reordering): the two listen to disjoint event families and
      // the browser routes them independently. Use case: cross-component
      // transfers (entity drag-out → file path input / ref_id / external).
      if (typeof o.rowDragSource === 'function') {
        const payload = o.rowDragSource(entry.row.node, entry.row)
        if (payload) ui.dragsource(rowEl, {
          getData: function () { return o.rowDragSource(entry.row.node, entry.row) },
        })
      }
      if (typeof o.contextMenu === 'function') {
        rowEl.addEventListener('contextmenu', function (ev) {
          const items = o.contextMenu(entry.row.node)
          if (!items || !items.length) return
          ev.preventDefault()
          ui.contextMenu({ x: ev.clientX, y: ev.clientY }, items)
        })
      }
    }

    // ── interaction policy dispatch ────────────────────────────────
    // Function form of the policy props (onRowClick / onRowDblClick) can
    // either handle everything imperatively (return non-string) or decide
    // per-node which named action the tree should run (return one of the
    // string actions: 'select' / 'toggle' / 'select-and-toggle' / 'activate').
    // This lets callers vary behavior per node kind without reimplementing
    // select / toggle / onSelect wiring.
    function resolvePolicy(p, ev, row, fallback) {
      if (typeof p === 'function') {
        const r = p(row.node, ev)
        return (typeof r === 'string') ? r : null
      }
      if (p === 'auto') return fallback
      return p
    }

    function handleRowClick(row, ev) {
      if (ev.defaultPrevented) return
      const action = resolvePolicy(onRowClick, ev, row, 'select')
      runAction(action, row, ev)
    }
    function handleRowDblClick(row, ev) {
      const fallback = row.hasKids ? 'toggle' : 'activate'
      const action = resolvePolicy(onRowDblClick, ev, row, fallback)
      runAction(action, row, ev)
    }
    function runAction(action, row, ev) {
      if (!action) return
      // Toggle on a leaf is a no-op by design — both cleaner visually
      // (no spurious click effect) and correct wrt the expanded set
      // (which is only meaningful for rows with children).
      if (action === 'toggle') { if (row.hasKids) toggleNode(row.node.id); return }
      if (action === 'activate') { if (typeof o.onActivate === 'function') o.onActivate(row.node); return }
      if (action === 'select') { applyClickSelect(row, clickMode(ev)); return }
      if (action === 'select-and-toggle') {
        applyClickSelect(row, clickMode(ev))
        if (row.hasKids) toggleNode(row.node.id)
        return
      }
    }
    function clickMode(ev) {
      if (!multiMode) return 'replace'
      if (ev && ev.shiftKey) return isModKey(ev) ? 'add-range' : 'range'
      if (ev && isModKey(ev)) return 'toggle'
      return 'replace'
    }

    // ── selection logic ────────────────────────────────────────────
    function applyClickSelect(row, mode) {
      if (!writeSel) return
      const node = row.node
      if (!selectable(node, row)) return
      const cur = readSelSet()
      focusedId = node.id

      if (mode === 'replace' || !multiMode) {
        const next = new Set(); next.add(node.id)
        anchorId = node.id
        writeSelSet(next); return
      }
      if (mode === 'toggle') {
        const next = new Set(cur)
        if (next.has(node.id)) next.delete(node.id); else next.add(node.id)
        anchorId = node.id
        writeSelSet(next); return
      }
      if (mode === 'range' || mode === 'add-range') {
        const flat = flatSig.peek()
        const a = anchorId != null ? anchorId : (cur.size ? cur.values().next().value : node.id)
        const ai = flat.findIndex(function (r) { return r.node.id === a })
        const bi = flat.findIndex(function (r) { return r.node.id === node.id })
        if (ai < 0 || bi < 0) { applyClickSelect(row, 'replace'); return }
        const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai]
        const next = mode === 'add-range' ? new Set(cur) : new Set()
        for (let i = lo; i <= hi; i++) {
          const r = flat[i]
          if (selectable(r.node, r)) next.add(r.node.id)
        }
        writeSelSet(next); return
      }
    }

    function toggleNode(id) {
      const cur = asSet(expanded.peek())
      const next = new Set(cur)
      if (next.has(id)) next.delete(id); else next.add(id)
      writeExpanded(next)
      if (typeof o.onExpand === 'function') o.onExpand(id, next.has(id))
    }

    // ── virtualizer ────────────────────────────────────────────────
    // Slots and renderRow use the simple per-index cache. renderTemplate is
    // the stable high-frequency path: visible instances reconcile by node id
    // and update in place, so data refreshes cannot interrupt pointer/focus
    // sessions inside an unchanged row.
    function discardRow(entry) {
      if (entry.tpl && tier3) {
        if (typeof entry.tpl.reset === 'function') entry.tpl.reset()
        if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el)
        tpool.push(entry.tpl)
      } else {
        ui.dispose(entry.el)
      }
    }

    function makeEntry(row) {
      const built = renderRow(row)
      let entry = built.tpl && built.el.__aiditorTreeEntry
      if (entry) {
        entry.tpl = built.tpl
        entry.row = row
      } else {
        entry = { el: built.el, tpl: built.tpl, row: row }
        if (built.tpl) built.el.__aiditorTreeEntry = entry
        attachRowEvents(built.el, entry)
      }
      built.el.style.height = rowH + 'px'
      applyRowState(built.el, row)
      return entry
    }

    function updateTemplateEntry(entry, row) {
      entry.row = row
      entry.tpl.update(row.node, row, makeCtx(row))
      entry.el.setAttribute('data-depth', String(row.depth))
      entry.el.style.paddingLeft = (4 + row.depth * indent) + 'px'
      applyRowState(entry.el, row)
    }

    function paintSimple(flat, start, end) {
      const want = new Set()
      for (let i = start; i < end; i++) want.add(i)
      rowCache.forEach(function (entry, idx) {
        if (!want.has(idx)) { discardRow(entry); rowCache.delete(idx) }
      })
      for (let i = start; i < end; i++) {
        if (!rowCache.has(i)) {
          const entry = makeEntry(flat[i])
          rowCache.set(i, entry)
          win.appendChild(entry.el)
        }
      }
    }

    function paintTemplates(flat, start, end) {
      const byId = new Map()
      rowCache.forEach(function (entry) { byId.set(entry.row.node.id, entry) })

      const next = new Map()
      const retained = new Set()
      for (let i = start; i < end; i++) {
        const row = flat[i]
        let entry = byId.get(row.node.id)
        if (entry && !retained.has(entry)) {
          retained.add(entry)
          if (entry.row !== row) updateTemplateEntry(entry, row)
        } else {
          entry = makeEntry(row)
        }
        next.set(i, entry)
      }

      rowCache.forEach(function (entry) {
        if (!retained.has(entry)) discardRow(entry)
      })
      rowCache.clear()
      next.forEach(function (entry, index) { rowCache.set(index, entry) })

      let cursor = win.firstChild
      next.forEach(function (entry) {
        if (entry.el === cursor) cursor = cursor.nextSibling
        else {
          win.insertBefore(entry.el, cursor)
          cursor = entry.el.nextSibling
        }
      })
    }

    function paint() {
      const flat = flatSig.peek()
      spacer.style.height = (flat.length * rowH) + 'px'
      const top = el.scrollTop
      const h = el.clientHeight || 240
      const start = Math.max(0, Math.floor(top / rowH) - 4)
      const end   = Math.min(flat.length, Math.ceil((top + h) / rowH) + 4)
      win.style.transform = 'translateY(' + (start * rowH) + 'px)'
      if (tier3) paintTemplates(flat, start, end)
      else paintSimple(flat, start, end)
    }

    function rebuild() {
      if (tier3) { paint(); return }
      rowCache.forEach(discardRow)
      rowCache.clear()
      paint()
    }
    function refreshStates() {
      rowCache.forEach(function (entry) { applyRowState(entry.el, entry.row) })
    }

    el.addEventListener('scroll', paint, { passive: true })
    ui.collect(el, function () {
      rowCache.forEach(function (entry) {
        if (entry.tpl && typeof entry.tpl.dispose === 'function') entry.tpl.dispose()
        else ui.dispose(entry.el)
      })
      rowCache.clear()
      for (let i = 0; i < tpool.length; i++) {
        if (tpool[i].dispose) tpool[i].dispose()
        else ui.dispose(tpool[i].root)
      }
      tpool.length = 0
    })
    ui.bind(el, flatSig, rebuild)
    if (selSig) ui.bind(el, selSig, refreshStates)

    // ── keyboard navigation ────────────────────────────────────────
    if (keyboardOn) {
      el.addEventListener('keydown', function (ev) {
        const flat = flatSig.peek()
        if (!flat.length) return
        let idx = focusedId == null ? -1 : flat.findIndex(function (r) { return r.node.id === focusedId })

        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault()
          const dir = ev.key === 'ArrowDown' ? 1 : -1
          let next = idx < 0 ? (dir > 0 ? 0 : flat.length - 1) : idx + dir
          // Skip across unselectable when shift-extending to make range sane.
          next = Math.max(0, Math.min(flat.length - 1, next))
          const row = flat[next]
          focusedId = row.node.id
          if (ev.shiftKey && multiMode && writeSel) {
            applyClickSelect(row, 'range')
          } else if (!ev.shiftKey && writeSel && selectable(row.node, row)) {
            applyClickSelect(row, 'replace')
          } else {
            refreshStates()
          }
          scrollIntoView(next)
          return
        }
        if (ev.key === 'ArrowRight') {
          ev.preventDefault()
          if (idx < 0) return
          const row = flat[idx]
          if (row.hasKids && !row.expanded) toggleNode(row.node.id)
          return
        }
        if (ev.key === 'ArrowLeft') {
          ev.preventDefault()
          if (idx < 0) return
          const row = flat[idx]
          if (row.hasKids && row.expanded) { toggleNode(row.node.id); return }
          // Find parent row — previous row with depth < current.
          for (let i = idx - 1; i >= 0; i--) {
            if (flat[i].depth < row.depth) {
              focusedId = flat[i].node.id
              if (!ev.shiftKey && writeSel && selectable(flat[i].node, flat[i])) applyClickSelect(flat[i], 'replace')
              else refreshStates()
              scrollIntoView(i)
              return
            }
          }
          return
        }
        if (ev.key === 'Enter') {
          ev.preventDefault()
          if (idx < 0) return
          const row = flat[idx]
          if (typeof o.onActivate === 'function') o.onActivate(row.node)
          return
        }
        if (ev.key === ' ') {
          ev.preventDefault()
          if (idx < 0) return
          const row = flat[idx]
          if (multiMode) applyClickSelect(row, 'toggle')
          else if (typeof o.onActivate === 'function') o.onActivate(row.node)
          return
        }
        if (ev.key === 'Home') {
          ev.preventDefault()
          const row = flat[0]; focusedId = row.node.id
          if (writeSel && selectable(row.node, row)) applyClickSelect(row, 'replace'); else refreshStates()
          scrollIntoView(0); return
        }
        if (ev.key === 'End') {
          ev.preventDefault()
          const row = flat[flat.length - 1]; focusedId = row.node.id
          if (writeSel && selectable(row.node, row)) applyClickSelect(row, 'replace'); else refreshStates()
          scrollIntoView(flat.length - 1); return
        }
        if ((ev.key === 'a' || ev.key === 'A') && isModKey(ev) && multiMode && writeSel) {
          ev.preventDefault()
          const next = new Set()
          for (let i = 0; i < flat.length; i++) {
            if (selectable(flat[i].node, flat[i])) next.add(flat[i].node.id)
          }
          writeSelSet(next); return
        }
        if (ev.key === 'Escape' && writeSel) {
          ev.preventDefault()
          writeSelSet(new Set()); return
        }
      })
    }

    function scrollIntoView(idx) {
      const topY = idx * rowH
      const botY = topY + rowH
      if (topY < el.scrollTop) el.scrollTop = topY
      else if (botY > el.scrollTop + el.clientHeight) el.scrollTop = botY - el.clientHeight
    }

    // Public imperative handle for one-shot ops signals don't suit.
    el.__aiditorTree = {
      scrollToId: function (id) {
        const flat = flatSig.peek()
        const i = flat.findIndex(function (r) { return r.node.id === id })
        if (i >= 0) scrollIntoView(i)
      },
      expandAll:   function () { writeExpanded(allIds(items.peek())) },
      collapseAll: function () { writeExpanded(new Set()) },
      getFlat:     function () { return flatSig.peek() },
      getRowEl:    function (id) {
        let out = null
        rowCache.forEach(function (e) { if (e.row.node.id === id) out = e.el })
        return out
      },
      rowHeight: rowH,
      focus:     function () { el.focus() },
      toggle:    toggleNode,                 // expand/collapse a single node
      isExpanded: function (id) { return asSet(expanded.peek()).has(id) },
      // Exposed so tree-dnd can reach virtualizer internals without
      // re-implementing hit-test or scrolling. Keep underscore-prefixed —
      // not part of the public contract.
      _rowCache: rowCache,
      _flat:     flatSig,
    }

    // DnD is an optional layer — attach only when the caller opted in.
    if (o.dnd && ui._treeDnd && typeof ui._treeDnd.attach === 'function') {
      ui._treeDnd.attach(el, items, expanded, flatSig, o.dnd, {
        rowHeight: rowH, writeSelSet: writeSelSet, readSelSet: readSelSet,
      })
    }

    // First paint after mount (needs clientHeight from layout).
    requestAnimationFrame(paint)
    return el
  }
})(window.aiditor = window.aiditor || {})

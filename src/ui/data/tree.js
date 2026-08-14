// aiditor.ui.tree — virtualized tree with slots, search, multi-select, DnD.
//
// The component is architected in three rendering tiers — callers pick the
// one that matches their complexity budget, without changing the rest of
// the opts surface:
//
//   Tier 1 — managed row:     label / icon / leadingSlot / trailingSlot /
//                              actions. Tree owns one stable keyed shell and
//                              patches framework parts in place.
//   Tier 2 — renderRow:        user returns the entire row element.
//                              Tree still handles indent padding, events,
//                              ARIA, focus ring.
//   Tier 3 — renderTemplate:   user returns { root, update }. Tree keeps a
//                              pool of template instances and calls update()
//                              for complex stateful custom row structures.
//
// Only one tier can be in effect per instance (renderTemplate > renderRow
// > slots). All tiers receive the same `ctx` so slot logic and full renders
// can share helpers.
//
// ── data contract ─────────────────────────────────────────────────────
//   TreeNode = { id, label?, icon?, children?, …caller-defined fields }
//   Caller owns `items: signal<TreeNode[]>`. Any data change is reflected
//   via items.set(...). `id` is globally unique within the entire available
//   projection (including collapsed and loaded lazy descendants). Across
//   flattens, new node objects at the same id are the same logical node for
//   DOM reconciliation, expansion, selection, focus, and DnD.
//   The presence of a `children` array is caller-authoritative, including [];
//   lazy cache is eligible only when no array is supplied and hasChildren is
//   true.
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

  function duplicateIdError(id, firstParentId, secondParentId) {
    const err = new Error('ui.tree: duplicate node.id "' + String(id) + '" in the available projection')
    err.name = 'AiditorTreeDuplicateIdError'
    err.nodeId = id
    err.parentIds = [firstParentId, secondParentId]
    return err
  }

  function buildProjection(items, inspectNode) {
    const index = new Map()
    function walk(nodes, parentId, depth) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const previous = index.get(node.id)
        if (previous) throw duplicateIdError(node.id, previous.parentId, parentId)
        index.set(node.id, {
          node: node,
          parentId: parentId,
          depth: depth,
          indexInParent: i,
        })
        const children = inspectNode(node).children
        if (children.length) walk(children, node.id, depth + 1)
      }
    }
    walk(items, null, 0)
    return { items: items, index: index }
  }

  // Indices of one longest increasing subsequence, ignoring -1 entries.
  // The virtualizer uses this to retain the largest already-ordered DOM
  // subsequence and move only the rows outside it.
  function lisIndices(values) {
    const tails = []
    const tailsAt = []
    const previous = new Array(values.length)
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (value < 0) { previous[i] = -1; continue }
      let lo = 0, hi = tails.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (tails[mid] < value) lo = mid + 1
        else hi = mid
      }
      tails[lo] = value
      previous[i] = lo ? tailsAt[lo - 1] : -1
      tailsAt[lo] = i
    }
    const out = new Set()
    let cursor = tailsAt[tails.length - 1]
    while (cursor != null && cursor >= 0) {
      out.add(cursor)
      cursor = previous[cursor]
    }
    return out
  }

  function reorderRows(parent, previousRows, nextRows) {
    const oldIndex = new Map()
    for (let i = 0; i < previousRows.length; i++) oldIndex.set(previousRows[i].id, i)
    const positions = nextRows.map(function (entry) {
      return !entry._needsInsert && oldIndex.has(entry.id) ? oldIndex.get(entry.id) : -1
    })
    const stable = lisIndices(positions)
    for (let i = nextRows.length - 1; i >= 0; i--) {
      const anchor = i + 1 < nextRows.length ? nextRows[i + 1].el : null
      if (positions[i] < 0 || !stable.has(i)) parent.insertBefore(nextRows[i].el, anchor)
    }
    for (let i = 0; i < nextRows.length; i++) nextRows[i]._needsInsert = false
  }

  function containsNode(root, node) {
    let current = node
    while (current) {
      if (current === root) return true
      current = current.parentNode
    }
    return false
  }

  function sameRowProjection(a, b) {
    return a.node === b.node &&
      a.depth === b.depth &&
      a.hasKids === b.hasKids &&
      a.expanded === b.expanded &&
      a.matched === b.matched &&
      a.loadState === b.loadState &&
      a.loading === b.loading &&
      a.error === b.error &&
      a.posInSet === b.posInSet &&
      a.setSize === b.setSize
  }

  // ── flatten (search-aware) ─────────────────────────────────────────
  // Returns Array<Row> where Row = { node, depth, hasKids, expanded, matched }.
  // When a query is active (filter mode): two-pass — first collect the set
  // of visible ids (match OR has matching descendant) plus the set of ids
  // to auto-expand (has matching descendant). Second pass walks the tree
  // keeping only visible ids, honoring the auto-expand union. O(n) total.
  function flatten(items, expanded, query, match, behavior, inspectNode) {
    const out = []
    if (!query) {
      function walk(nodes, depth) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]
          const info = inspectNode(n)
          const hasKids = info.hasKids
          const isExp = expanded.has(n.id)
          out.push({
            node: n, depth: depth, hasKids: hasKids, expanded: isExp, matched: false,
            loadState: info.loadState, loading: info.loading, error: info.error,
            posInSet: i + 1, setSize: nodes.length,
          })
          if (info.children.length && isExp) walk(info.children, depth + 1)
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
        const info = inspectNode(n)
        const self = !!match(n, query)
        if (self) matched.add(n.id)
        const kidMatch = info.children.length ? scan(info.children) : false
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
        const info = inspectNode(n)
        const hasKids = info.hasKids
        const isExp = expanded.has(n.id) || autoExp.has(n.id)
        out.push({
          node: n, depth: depth, hasKids: hasKids, expanded: isExp,
          matched: matched.has(n.id),
          loadState: info.loadState, loading: info.loading, error: info.error,
          posInSet: i + 1, setSize: nodes.length,
        })
        if (info.children.length && isExp) walk(info.children, depth + 1)
      }
    }
    walk(items, 0)
    return out
  }

  // All visible ids (expand-all / collapse-all helpers).
  function allIds(items, inspectNode) {
    const s = new Set()
    function walk(nodes) {
      for (let i = 0; i < nodes.length; i++) {
        s.add(nodes[i].id)
        const children = inspectNode(nodes[i]).children
        if (children.length) walk(children)
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

  // ── managed default row ────────────────────────────────────────────
  // The framework-owned shell is created once per retained node id. Updates
  // patch its parts in place; callers only need renderTemplate when they own
  // a genuinely stateful custom row structure.
  function createDefaultRow(opts) {
    const el = ui.h('div', 'aiditor-ui-tree-row')
    el.setAttribute('role', 'treeitem')
    const arrow = ui.h('span', 'aiditor-ui-tree-arrow')
    el.appendChild(arrow)
    const leading = ui.h('span', 'aiditor-ui-tree-leading')
    const iconName = aiditor.signal('')
    const icon = ui.icon({ name: iconName, size: 'sm' })
    leading.appendChild(icon)
    ui.collect(leading, function () { ui.disposeChildren(leading) })
    leading.hidden = true
    stopInteractionPropagation(leading)
    el.appendChild(leading)
    const label = ui.h('span', 'aiditor-ui-tree-label')
    ui.collect(label, function () { ui.disposeChildren(label) })
    el.appendChild(label)
    const trailing = ui.h('span', 'aiditor-ui-tree-trailing')
    ui.collect(trailing, function () { ui.disposeChildren(trailing) })
    trailing.hidden = true
    stopInteractionPropagation(trailing)
    el.appendChild(trailing)
    const actions = ui.h('span', 'aiditor-ui-tree-actions')
    ui.collect(actions, function () { ui.disposeChildren(actions) })
    actions.hidden = true
    actions.setAttribute('data-visibility', opts.actionsVisibility || 'hover')
    stopInteractionPropagation(actions)
    el.appendChild(actions)

    const runtime = {
      el: el,
      arrow: arrow,
      leading: leading,
      icon: icon,
      iconName: iconName,
      leadingChild: icon,
      label: label,
      labelChild: null,
      labelSignature: null,
      trailing: trailing,
      trailingChild: null,
      actions: actions,
      actionMap: new Map(),
      actionOrder: [],
      row: null,
      ctx: null,
    }
    arrow.addEventListener('click', function (ev) {
      ev.stopPropagation()
      if (!runtime.row || !runtime.row.hasKids) return
      if (runtime.row.error) runtime.ctx.retry()
      else runtime.ctx.toggle()
    })
    ui.collect(el, function () { ui.disposeChildren(el) })
    return runtime
  }

  function callRowFactory(scope, fn, node, ctx) {
    if (!fn) return null
    return aiditor.safeCall({ scope: 'ui.tree', action: scope, nodeId: node.id }, function () {
      return fn(node, ctx)
    })
  }

  function replaceSlot(container, current, next) {
    if (current === next) return current
    ui.disposeChildren(container)
    if (next) container.appendChild(next)
    return next || null
  }

  function actionValue(value, ctx, action) {
    if (ui._actionSurface) return ui._actionSurface.valueOf(value, ctx, action)
    return typeof value === 'function' ? value(ctx, action) : value
  }

  function actionKey(action, index) {
    if (action.nodeType === 1) return action
    return action.id != null ? 'id:' + String(action.id) : 'index:' + index
  }

  function createActionState(key, action, runtime) {
    if (action.nodeType === 1) return { id: key, el: action, raw: true, action: action }
    const icon = aiditor.signal('')
    const title = aiditor.signal('Action')
    const ariaLabel = aiditor.signal('Action')
    const disabled = aiditor.signal(false)
    const kind = aiditor.signal('ghost')
    const state = {
      id: key, action: action, raw: false,
      icon: icon, title: title, ariaLabel: ariaLabel,
      disabled: disabled, kind: kind, el: null,
    }
    state.el = ui.iconButton({
      icon: icon,
      title: title,
      ariaLabel: ariaLabel,
      size: 'sm',
      kind: kind,
      disabled: disabled,
      onClick: function (ev) {
        ev.stopPropagation()
        const current = state.action
        if (typeof current.onClick === 'function') {
          aiditor.safeCall({ scope: 'ui.tree', action: 'rowAction', nodeId: runtime.row.node.id }, function () {
            current.onClick(runtime.row.node, ev)
          })
          return
        }
        if (ui._actionSurface) {
          ui._actionSurface.runAction(current, {
            node: runtime.row.node,
            row: runtime.ctx.row,
            tree: runtime.ctx,
          }, 'ui.tree')
        }
      },
    })
    return state
  }

  function updateActions(runtime, opts) {
    if (!opts.actions) {
      runtime.actionMap.forEach(function (state) { ui.dispose(state.el) })
      runtime.actionMap.clear()
      runtime.actionOrder = []
      runtime.actions.hidden = true
      return
    }
    const resolved = callRowFactory('actions', opts.actions, runtime.row.node, runtime.ctx)
    const list = Array.isArray(resolved) ? resolved : []
    const nextMap = new Map()
    const nextOrder = []
    for (let i = 0; i < list.length; i++) {
      const action = list[i]
      if (!action) continue
      const actionCtx = { node: runtime.row.node, row: runtime.ctx.row, tree: runtime.ctx }
      if (action.nodeType !== 1 && actionValue(action.hidden, actionCtx, action)) continue
      const key = actionKey(action, i)
      let state = runtime.actionMap.get(key)
      if (!state || state.raw !== (action.nodeType === 1)) state = createActionState(key, action, runtime)
      state.action = action
      if (!state.raw) {
        const label = actionValue(action.label, actionCtx, action)
        const title = actionValue(action.title, actionCtx, action) || label || action.id || action.icon || 'Action'
        state.icon.set(actionValue(action.icon, actionCtx, action) || (action.menu ? 'more-vertical' : ''))
        state.title.set(String(title))
        state.ariaLabel.set(String(label || title))
        state.disabled.set(!!actionValue(action.disabled, actionCtx, action))
        state.kind.set(actionValue(action.variant, actionCtx, action) === 'danger' || action.danger ? 'danger' : 'ghost')
      }
      nextMap.set(key, state)
      nextOrder.push(state)
    }
    runtime.actionMap.forEach(function (state, key) {
      if (!nextMap.has(key)) ui.dispose(state.el)
    })
    reorderRows(runtime.actions, runtime.actionOrder, nextOrder)
    runtime.actionMap = nextMap
    runtime.actionOrder = nextOrder
    runtime.actions.hidden = nextOrder.length === 0
  }

  function updateDefaultRow(runtime, opts, row, ctx) {
    runtime.row = row
    runtime.ctx = ctx
    const arrowMode = opts._showArrow
    const arrowShown = arrowMode === 'always'
      ? true
      : arrowMode === 'never'
        ? false
        : typeof arrowMode === 'function'
          ? !!arrowMode(row.node, row)
          : row.hasKids
    runtime.arrow.textContent = arrowShown && row.hasKids && !row.loading
      ? (row.error ? '!' : (row.expanded ? '▾' : '▸'))
      : ''
    runtime.arrow.classList.toggle('aiditor-ui-tree-arrow-loading', !!(arrowShown && row.hasKids && row.loading))
    runtime.arrow.classList.toggle('aiditor-ui-tree-arrow-error', !!(arrowShown && row.hasKids && row.error))
    runtime.arrow.title = row.error ? (row.error.message || 'Failed to load children. Click to retry.') : ''

    if (opts.leadingSlot) {
      const next = callRowFactory('leadingSlot', opts.leadingSlot, row.node, ctx)
      runtime.leadingChild = replaceSlot(runtime.leading, runtime.leadingChild, next)
      runtime.leading.hidden = !next
    } else {
      if (runtime.leadingChild !== runtime.icon) runtime.leadingChild = replaceSlot(runtime.leading, runtime.leadingChild, runtime.icon)
      runtime.iconName.set(row.node.icon || '')
      runtime.leading.hidden = !row.node.icon
    }

    const labelText = row.node.label != null ? String(row.node.label) : String(row.node.id)
    const labelSignature = labelText + '\x00' + ctx.query
    if (opts.labelSlot && !ctx.query) {
      const next = callRowFactory('labelSlot', opts.labelSlot, row.node, ctx)
      runtime.labelChild = replaceSlot(runtime.label, runtime.labelChild, next)
      if (!next) runtime.label.textContent = labelText
      runtime.labelSignature = null
    } else if (runtime.labelSignature !== labelSignature || runtime.labelChild) {
      ui.disposeChildren(runtime.label)
      runtime.labelChild = null
      if (ctx.query) runtime.label.appendChild(ctx.highlight(labelText))
      else runtime.label.textContent = labelText
      runtime.labelSignature = labelSignature
    }
    runtime.label.title = labelText

    if (opts.trailingSlot) {
      const next = callRowFactory('trailingSlot', opts.trailingSlot, row.node, ctx)
      runtime.trailingChild = replaceSlot(runtime.trailing, runtime.trailingChild, next)
      runtime.trailing.hidden = !next
    } else {
      runtime.trailingChild = replaceSlot(runtime.trailing, runtime.trailingChild, null)
      runtime.trailing.hidden = true
    }
    updateActions(runtime, opts)
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
    const loadChildren = typeof o.loadChildren === 'function' ? o.loadChildren : null
    const loadVersion = aiditor.signal(0)
    const loadCache = new Map()
    const activeBatches = new Set()
    let projectionSig = null
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
      if (init === 'all') expanded.set(allIds(items.peek(), inspectNode))
      else if (Array.isArray(init)) expanded.set(new Set(init))
      else if (init === 'none') { /* empty by default */ }
    }

    // Search signal — may be absent, plain string, or signal.
    const searchSig = o.search != null ? ui.asSig(o.search) : aiditor.signal('')
    const matchFn = typeof o.matchNode === 'function' ? o.matchNode : defaultMatch

    // Focus/anchor tracked internally (non-reactive — only kbd cares).
    let focusedId = null
    let anchorId = null

    function ownsChildren(node) { return Array.isArray(node.children) }
    function acceptsLazyCache(node) { return !ownsChildren(node) && node.hasChildren === true }

    function inspectNode(node) {
      const cached = loadCache.get(node.id)
      const staticChildren = ownsChildren(node) ? node.children : null
      const activeCache = acceptsLazyCache(node) ? cached : null
      const hasCachedValue = !!(activeCache && activeCache.hasValue)
      const children = staticChildren || (hasCachedValue ? activeCache.children : [])
      const lazy = !!(loadChildren && acceptsLazyCache(node) && !hasCachedValue)
      return {
        children: children,
        hasKids: !!(children.length || lazy || (activeCache && (activeCache.status === 'loading' || activeCache.status === 'error'))),
        loadState: activeCache ? activeCache.status : 'idle',
        loading: !!(activeCache && activeCache.status === 'loading'),
        error: activeCache && activeCache.status === 'error' ? activeCache.error : null,
      }
    }

    function bumpLoadVersion() { loadVersion.set(loadVersion.peek() + 1) }

    function findNode(id) {
      if (projectionSig) {
        const entry = projectionSig.peek().index.get(id)
        return entry ? entry.node : null
      }
      let found = null
      function walk(nodes) {
        for (let i = 0; i < nodes.length && !found; i++) {
          const node = nodes[i]
          if (node.id === id) { found = node; return }
          const children = inspectNode(node).children
          if (children.length) walk(children)
        }
      }
      walk(items.peek() || [])
      return found
    }

    function newLoadState() {
      return {
        status: 'idle', children: [], hasValue: false, stale: false,
        error: null, promise: null, batch: null,
        retryIds: null,
      }
    }

    function normalizeIds(input) {
      const values = input == null
        ? Array.from(loadCache.keys())
        : (Array.isArray(input) || input instanceof Set)
          ? Array.from(input)
          : [input]
      const seen = new Set()
      const out = []
      for (let i = 0; i < values.length; i++) {
        if (seen.has(values[i])) continue
        seen.add(values[i])
        out.push(values[i])
      }
      return out
    }

    function batchRollbackError(failedId, cause) {
      const err = new Error('ui.tree: atomic children refresh kept the previous snapshot because node "' + String(failedId) + '" failed')
      err.name = 'AiditorTreeRefreshBatchError'
      err.failedNodeId = failedId
      err.refreshCause = cause
      return err
    }

    function cancelBatch(batch, publish) {
      if (!batch || batch.finished) return
      batch.finished = true
      batch.controllers.forEach(function (controller) { controller.abort() })
      for (let i = 0; i < batch.ids.length; i++) {
        const id = batch.ids[i]
        const state = loadCache.get(id)
        if (!state || state.batch !== batch) continue
        state.batch = null
        state.promise = null
        state.error = null
        state.retryIds = null
        if (state.hasValue) {
          state.status = 'loaded'
          state.stale = false
        } else {
          loadCache.delete(id)
        }
      }
      activeBatches.delete(batch)
      batch.resolve([])
      if (publish) bumpLoadVersion()
    }

    function candidateInfo(node, staged) {
      const base = inspectNode(node)
      if (!acceptsLazyCache(node) || !staged.has(node.id)) return base
      const children = staged.get(node.id)
      return {
        children: children,
        hasKids: children.length > 0,
        loadState: 'loaded',
        loading: false,
        error: null,
      }
    }

    function finishBatch(batch, outcomes) {
      if (batch.finished) return
      batch.finished = true
      activeBatches.delete(batch)
      let failed = null
      for (let i = 0; i < outcomes.length; i++) {
        if (!outcomes[i].ok) { failed = outcomes[i]; break }
      }
      const staged = new Map()
      if (!failed) {
        for (let i = 0; i < outcomes.length; i++) staged.set(outcomes[i].id, outcomes[i].children)
        try {
          buildProjection(items.peek() || [], function (node) { return candidateInfo(node, staged) })
        } catch (err) {
          failed = { id: err.nodeId, error: err }
        }
      }

      if (failed) {
        for (let i = 0; i < batch.ids.length; i++) {
          const id = batch.ids[i]
          const state = loadCache.get(id)
          if (!state || state.batch !== batch) continue
          const own = outcomes.find(function (outcome) { return outcome.id === id && !outcome.ok })
          state.status = 'error'
          state.error = own ? own.error : batchRollbackError(failed.id, failed.error)
          state.stale = state.hasValue
          state.batch = null
          state.promise = null
          state.retryIds = batch.ids.slice()
        }
        bumpLoadVersion()
        batch.resolve(outcomes)
        return
      }

      for (let i = 0; i < outcomes.length; i++) {
        const outcome = outcomes[i]
        const state = loadCache.get(outcome.id)
        if (!state || state.batch !== batch) continue
        state.status = 'loaded'
        state.children = outcome.children
        state.hasValue = true
        state.stale = false
        state.error = null
        state.batch = null
        state.promise = null
        state.retryIds = null
      }
      bumpLoadVersion()
      batch.resolve(outcomes)
    }

    function loadOutcome(node, controller) {
      const source = { scope: 'ui.tree', action: 'loadChildren', nodeId: node.id }
      let thrown = null
      const result = aiditor.safeCall(source, function () {
        try { return loadChildren(node, controller.signal) }
        catch (err) { thrown = err; throw err }
      })
      const pending = thrown ? Promise.reject(thrown) : Promise.resolve(result)
      return pending.then(function (children) {
        if (!Array.isArray(children)) throw new Error('ui.tree: loadChildren must resolve to an array')
        return { id: node.id, ok: true, children: children }
      }).catch(function (err) {
        return { id: node.id, ok: false, error: err }
      })
    }

    function refreshChildren(input, reason) {
      if (!loadChildren) return Promise.resolve([])
      const requested = normalizeIds(input)
      const nodes = []
      for (let i = 0; i < requested.length; i++) {
        const node = findNode(requested[i])
        if (!node || !acceptsLazyCache(node)) continue
        nodes.push(node)
      }
      if (!nodes.length) return Promise.resolve([])

      const overlapping = new Set()
      for (let i = 0; i < nodes.length; i++) {
        const state = loadCache.get(nodes[i].id)
        if (state && state.batch) overlapping.add(state.batch)
      }
      overlapping.forEach(function (batch) { cancelBatch(batch, false) })

      const batch = {
        ids: nodes.map(function (node) { return node.id }),
        cancelOnCollapse: reason === 'expand',
        controllers: new Map(),
        finished: false,
        promise: null,
        resolve: null,
      }
      batch.promise = new Promise(function (resolve) { batch.resolve = resolve })
      activeBatches.add(batch)
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const controller = new AbortController()
        let state = loadCache.get(node.id)
        if (!state) { state = newLoadState(); loadCache.set(node.id, state) }
        state.status = 'loading'
        state.stale = state.hasValue
        state.error = null
        state.promise = batch.promise
        state.batch = batch
        state.retryIds = batch.ids.slice()
        batch.controllers.set(node.id, controller)
      }
      bumpLoadVersion()
      Promise.all(nodes.map(function (node) {
        return loadOutcome(node, batch.controllers.get(node.id))
      })).then(function (outcomes) { finishBatch(batch, outcomes) })
      return batch.promise
    }

    function ensureChildren(node) {
      if (!loadChildren || !node) return Promise.resolve([])
      if (ownsChildren(node)) return Promise.resolve(node.children)
      if (!acceptsLazyCache(node)) return Promise.resolve([])
      const current = loadCache.get(node.id)
      if (current && current.status === 'loading') return current.promise
      if (current && current.hasValue && !current.stale) return Promise.resolve(current.children)
      if (current && current.status === 'error') return Promise.resolve(current.children)
      return refreshChildren([node.id], 'expand').then(function () {
        const state = loadCache.get(node.id)
        return state && state.hasValue ? state.children : []
      })
    }

    function abortLoad(id) {
      const state = loadCache.get(id)
      if (!state || !state.batch || !state.batch.cancelOnCollapse) return
      cancelBatch(state.batch, true)
    }

    function invalidateChildren(ids) {
      return refreshChildren(ids, 'invalidate')
    }

    function retryChildren(id) {
      const state = loadCache.get(id)
      return refreshChildren(state && state.retryIds ? state.retryIds : [id], 'retry')
    }

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

    // The available projection includes collapsed and asynchronously cached
    // descendants. It is the single identity authority for reconciliation,
    // lookup, DnD parent-chain checks, and duplicate-id validation.
    projectionSig = aiditor.derived(function () {
      loadVersion()
      return buildProjection(items() || [], inspectNode)
    })
    ui.collect(el, projectionSig.dispose)

    // Derived flat list; recomputed whenever projection / expansion / search changes.
    const flatSig = aiditor.derived(function () {
      const projection = projectionSig()
      return flatten(projection.items, expanded(), searchSig(), matchFn, searchBehavior, inspectNode)
    })
    ui.collect(el, flatSig.dispose)

    // Virtualizer state. Only visible/overscan rows own DOM, but every
    // retained row is keyed by node id rather than by its current index.
    const rowCache = new Map()   // node id → RowRuntime
    let visibleOrder = []
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
          loading: row.loading,
          error: row.error,
          loadState: row.loadState,
        },
        query: searchSig.peek(),
        highlight: makeHighlight(searchSig.peek()),
        toggle:   function () { toggleNode(row.node.id) },
        retry:    function () { return retryChildren(row.node.id) },
        invalidate: function () { return invalidateChildren(row.node.id) },
        select:   function (mode) { applyClickSelect(row, mode || 'replace') },
        activate: function () { if (typeof o.onActivate === 'function') o.onActivate(row.node) },
      }
    }

    function createRenderedRow(row) {
      const ctx = makeCtx(row)
      if (tier3) {
        const tpl = tpool.pop() || tier3()
        tpl.update(row.node, row, ctx)
        tpl.root.classList.add('aiditor-ui-tree-row')
        tpl.root.setAttribute('role', 'treeitem')
        tpl.root.setAttribute('data-depth', String(row.depth))
        tpl.root.style.paddingLeft = (4 + row.depth * indent) + 'px'
        return { el: tpl.root, tpl: tpl, managed: null, kind: 'template' }
      }
      if (tier2) {
        const rel = tier2(row.node, row, ctx)
        rel.classList.add('aiditor-ui-tree-row')
        if (!rel.getAttribute('role')) rel.setAttribute('role', 'treeitem')
        rel.setAttribute('data-depth', String(row.depth))
        rel.style.paddingLeft = (4 + row.depth * indent) + 'px'
        return { el: rel, tpl: null, managed: null, kind: 'renderRow' }
      }
      const managed = createDefaultRow(_opts)
      updateDefaultRow(managed, _opts, row, ctx)
      return { el: managed.el, tpl: null, managed: managed, kind: 'default' }
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
      rowEl.setAttribute('aria-posinset', String(row.posInSet))
      rowEl.setAttribute('aria-setsize', String(row.setSize))
      rowEl.classList.toggle('aiditor-ui-tree-row-loading', !!row.loading)
      rowEl.classList.toggle('aiditor-ui-tree-row-error', !!row.error)
      if (row.loading) rowEl.setAttribute('aria-busy', 'true')
      else rowEl.removeAttribute('aria-busy')
      const label = String(row.node.label != null ? row.node.label : row.node.id)
      if (row.loading) rowEl.setAttribute('aria-label', label + ', loading')
      else if (row.error) rowEl.setAttribute('aria-label', label + ', loading failed')
      else rowEl.removeAttribute('aria-label')
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

    let previousExpanded = new Set()
    const stopAsyncExpansion = aiditor.effect(function () {
      const current = asSet(expanded())
      const projection = projectionSig()
      previousExpanded.forEach(function (id) { if (!current.has(id)) abortLoad(id) })
      current.forEach(function (id) {
        const entry = projection.index.get(id)
        if (entry) ensureChildren(entry.node)
      })
      previousExpanded = new Set(current)
    })
    ui.collect(el, stopAsyncExpansion)

    const stopPruneLoads = aiditor.effect(function () {
      const known = projectionSig().index
      const cancelled = new Set()
      loadCache.forEach(function (state, id) {
        const entry = known.get(id)
        if (entry && acceptsLazyCache(entry.node)) return
        if (state.batch) cancelled.add(state.batch)
      })
      cancelled.forEach(function (batch) { cancelBatch(batch, false) })
      let changed = cancelled.size > 0
      loadCache.forEach(function (state, id) {
        const entry = known.get(id)
        if (entry && acceptsLazyCache(entry.node)) return
        loadCache.delete(id)
        changed = true
      })
      if (changed) bumpLoadVersion()
    })
    ui.collect(el, stopPruneLoads)

    // ── virtualizer ────────────────────────────────────────────────
    // Every rendering tier now participates in one id-keyed visible-window
    // reconciliation. The managed default row and renderTemplate update in
    // place. Legacy renderRow has no update protocol, so only that row is
    // replaced when its projection changes.
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
      const built = createRenderedRow(row)
      let entry = built.tpl && built.el.__aiditorTreeEntry
      if (entry) {
        entry.id = row.node.id
        entry.el = built.el
        entry.tpl = built.tpl
        entry.managed = built.managed
        entry.kind = built.kind
        entry.row = row
        entry.query = searchSig.peek()
        entry._needsInsert = true
      } else {
        entry = {
          id: row.node.id,
          el: built.el,
          tpl: built.tpl,
          managed: built.managed,
          kind: built.kind,
          row: row,
          query: searchSig.peek(),
          _needsInsert: true,
        }
        attachRowEvents(built.el, entry)
      }
      built.el.__aiditorTreeEntry = entry
      built.el.style.height = rowH + 'px'
      built.el.setAttribute('data-depth', String(row.depth))
      built.el.style.paddingLeft = (4 + row.depth * indent) + 'px'
      applyRowState(built.el, row)
      return entry
    }

    function updateEntry(entry, row) {
      const query = searchSig.peek()
      if (sameRowProjection(entry.row, row) && entry.query === query) {
        entry.row = row
        if (entry.managed) entry.managed.row = row
        return
      }
      if (entry.kind === 'renderRow') {
        const previousEl = entry.el
        const built = createRenderedRow(row)
        entry.el = built.el
        entry.tpl = null
        entry.managed = null
        entry.kind = built.kind
        entry._needsInsert = true
        attachRowEvents(entry.el, entry)
        ui.dispose(previousEl)
      } else if (entry.kind === 'template') {
        entry.tpl.update(row.node, row, makeCtx(row))
      } else {
        updateDefaultRow(entry.managed, _opts, row, makeCtx(row))
      }
      entry.id = row.node.id
      entry.row = row
      entry.query = query
      entry.el.setAttribute('data-depth', String(row.depth))
      entry.el.style.paddingLeft = (4 + row.depth * indent) + 'px'
      entry.el.style.height = rowH + 'px'
      entry.el.__aiditorTreeEntry = entry
      applyRowState(entry.el, row)
    }

    function reconcileRows(flat, start, end, retainedScrollTop) {
      const nextCache = new Map()
      const nextOrder = []
      for (let i = start; i < end; i++) {
        const row = flat[i]
        let entry = rowCache.get(row.node.id)
        if (entry) updateEntry(entry, row)
        else entry = makeEntry(row)
        nextCache.set(row.node.id, entry)
        nextOrder.push(entry)
      }
      rowCache.forEach(function (entry, id) {
        if (!nextCache.has(id)) discardRow(entry)
      })
      const active = document.activeElement
      const restoreFocus = !!(active && containsNode(win, active))
      reorderRows(win, visibleOrder, nextOrder)
      rowCache.clear()
      nextCache.forEach(function (entry, id) { rowCache.set(id, entry) })
      visibleOrder = nextOrder
      el.scrollTop = retainedScrollTop
      if (restoreFocus && containsNode(win, active) && document.activeElement !== active) {
        active.focus({ preventScroll: true })
        el.scrollTop = retainedScrollTop
      }
    }

    function paint() {
      const retainedScrollTop = el.scrollTop
      const flat = flatSig.peek()
      spacer.style.height = (flat.length * rowH) + 'px'
      const h = el.clientHeight || 240
      const start = Math.max(0, Math.floor(retainedScrollTop / rowH) - 4)
      const end   = Math.min(flat.length, Math.ceil((retainedScrollTop + h) / rowH) + 4)
      win.style.transform = 'translateY(' + (start * rowH) + 'px)'
      reconcileRows(flat, start, end, retainedScrollTop)
    }

    function rebuild() { paint() }
    function refreshStates() {
      rowCache.forEach(function (entry) {
        applyRowState(entry.el, entry.row)
      })
    }

    el.addEventListener('scroll', paint, { passive: true })
    ui.collect(el, function () {
      Array.from(activeBatches).forEach(function (batch) { cancelBatch(batch, false) })
      loadCache.clear()
      rowCache.forEach(function (entry) {
        if (entry.tpl && typeof entry.tpl.dispose === 'function') entry.tpl.dispose()
        else ui.dispose(entry.el)
      })
      rowCache.clear()
      visibleOrder = []
      for (let i = 0; i < tpool.length; i++) {
        if (tpool[i].dispose) tpool[i].dispose()
        else ui.dispose(tpool[i].root)
      }
      tpool.length = 0
    })
    // The bindings own the explicit Tree dependencies. DOM construction may
    // create reactive child components, whose private signals must not leak
    // into either outer Tree effect and synchronously re-enter reconciliation.
    ui.bind(el, flatSig, function () { aiditor.untracked(rebuild) })
    if (selSig) ui.bind(el, selSig, function () { aiditor.untracked(refreshStates) })

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
      expandAll:   function () { writeExpanded(allIds(items.peek(), inspectNode)) },
      collapseAll: function () { writeExpanded(new Set()) },
      getFlat:     function () { return flatSig.peek() },
      getRowEl:    function (id) {
        const entry = rowCache.get(id)
        return entry ? entry.el : null
      },
      rowHeight: rowH,
      focus:     function () { el.focus() },
      toggle:    toggleNode,                 // expand/collapse a single node
      isExpanded: function (id) { return asSet(expanded.peek()).has(id) },
      invalidateChildren: invalidateChildren,
      retry: retryChildren,
      loadState: function (id) { return inspectNode(findNode(id) || { id: id }).loadState },
      // Exposed so tree-dnd can reach virtualizer internals without
      // re-implementing hit-test or scrolling. Keep underscore-prefixed —
      // not part of the public contract.
      _rowCache: rowCache,
      _flat:     flatSig,
      _projection: projectionSig,
    }

    // DnD is an optional layer — attach only when the caller opted in.
    if (o.dnd && ui._treeDnd && typeof ui._treeDnd.attach === 'function') {
      ui._treeDnd.attach(el, items, expanded, flatSig, o.dnd, {
        rowHeight: rowH,
        writeSelSet: writeSelSet,
        readSelSet: readSelSet,
        projection: projectionSig,
      })
    }

    // First paint after mount (needs clientHeight from layout).
    requestAnimationFrame(paint)
    return el
  }
})(window.aiditor = window.aiditor || {})

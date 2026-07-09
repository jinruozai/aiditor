// Immutable N-ary split tree + all pure write functions.
//
// This is the data layer (§ 4.9 Layer 2 + Layer 6). Zero DOM, zero side
// effects. Every write returns a new tree that structurally shares unchanged
// subtrees with the old one, so reconcile's `===` keyed reuse just works.
//
// Node shapes:
//   { type: 'split', direction, sizes[], children[] }
//   { type: 'dock',  id, panels[], activeId, toolbar?, accept?, collapsed?, focused?, name? }
//
// PanelData: { id, component, title?, icon?, dirty?, badge?, props?, transient?, toolbarItems?, name? }
// ToolbarConfig: { direction, items[] }
// ToolbarItemSpec: { id, component, props, align }
//
// All ids are framework-generated (§ 4.13). Users may attach an optional
// `name` for stable lookup via findByName.
;(function (aiditor) {
  'use strict'

  // ─── id generators (process-global, monotonic) ─────────────
  let _nextDockN    = 1
  let _nextPanelN   = 1
  let _nextToolbarN = 1
  function nextDockId()        { return 'dock-'  + (_nextDockN++) }
  function nextPanelId()       { return 'panel-' + (_nextPanelN++) }
  function nextToolbarItemId() { return 'ti-'    + (_nextToolbarN++) }

  aiditor._nextDockId        = nextDockId
  aiditor._nextPanelId       = nextPanelId
  aiditor._nextToolbarItemId = nextToolbarItemId

  // ─── factories ─────────────────────────────────────────────
  // dock(partial) — never takes an id; it's framework-generated.
  function dock(partial) {
    partial = partial || {}
    const d = {
      id:       nextDockId(),
      type:     'dock',
      panels:   [],
      activeId: null,
    }
    if (partial.name != null)      d.name      = partial.name
    if (partial.toolbar)           d.toolbar   = normalizeToolbar(partial.toolbar)
    if (partial.accept != null)    d.accept    = partial.accept
    if (partial.removeWhenEmpty === false) d.removeWhenEmpty = false
    if (partial.collapsed)         d.collapsed = true
    if (partial.focused)           d.focused   = true
    if (partial.panels && partial.panels.length > 0) {
      d.panels = partial.panels.map(normalizePanelInput)
      // activeId resolution order: explicit → first
      if (partial.activeId) {
        const m = d.panels.find(function (p) { return p.id === partial.activeId })
        d.activeId = m ? m.id : d.panels[0].id
      } else {
        d.activeId = d.panels[0].id
      }
    }
    return d
  }

  function panel(partial) {
    if (!partial || typeof partial.component !== 'string')
      throw new Error('panel: component (string) is required')
    const p = {
      id:     nextPanelId(),
      component: partial.component,
    }
    if (partial.name != null)         p.name         = partial.name
    // § 4.9 Layer 2: title defaults to component name when not provided.
    p.title = partial.title != null ? partial.title : partial.component
    if (partial.icon != null)         p.icon         = partial.icon
    if (partial.dirty)                p.dirty        = true
    if (partial.badge != null)        p.badge        = partial.badge
    if (partial.props)                p.props        = partial.props
    if (partial.transient)            p.transient    = true
    if (partial.owner != null)        p.owner        = partial.owner
    if (partial.extensionId != null)  p.extensionId  = partial.extensionId
    if (partial.sourcePath != null)   p.sourcePath   = partial.sourcePath
    if (partial.toolbarItems)         p.toolbarItems = partial.toolbarItems.map(normalizeToolbarItem)
    return p
  }

  // Pass-through if already a built PanelData (has id), else build via panel().
  function normalizePanelInput(input) {
    if (!input) throw new Error('dock.panels: empty entry')
    if (input.id) return input
    return panel(input)
  }

  function normalizeToolbar(t) {
    const allowed = { top: 1, bottom: 1, left: 1, right: 1 }
    if (!allowed[t.direction || 'top'])
      throw new Error('toolbar: bad direction "' + t.direction + '"')
    return {
      direction: t.direction || 'top',
      items:     (t.items || []).map(normalizeToolbarItem),
    }
  }

  function normalizeToolbarItem(item) {
    if (!item || typeof item.component !== 'string')
      throw new Error('toolbar item: component (string) is required')
    return {
      id:     nextToolbarItemId(),
      component: item.component,
      props:  item.props || {},
      align:  item.align || 'start',
    }
  }

  function split(direction, children, sizes) {
    if (direction !== 'horizontal' && direction !== 'vertical')
      throw new Error('split: bad direction "' + direction + '"')
    if (!children || children.length < 1)
      throw new Error('split: needs ≥ 1 children')
    const n = children.length
    return {
      type:      'split',
      direction: direction,
      sizes:     normalize(sizes || new Array(n).fill(1 / n)),
      children:  children,
    }
  }

  function normalize(sizes) {
    let sum = 0
    for (let i = 0; i < sizes.length; i++) sum += sizes[i]
    if (sum === 0) sum = 1
    return sizes.map(function (s) { return s / sum })
  }

  // ─── navigation ────────────────────────────────────────────
  function findDock(tree, dockId, path) {
    path = path || []
    if (tree.type === 'dock') return tree.id === dockId ? { node: tree, path: path } : null
    for (let i = 0; i < tree.children.length; i++) {
      const r = findDock(tree.children[i], dockId, path.concat(i))
      if (r) return r
    }
    return null
  }

  function findPanel(tree, panelId, path) {
    path = path || []
    if (tree.type === 'dock') {
      for (let i = 0; i < tree.panels.length; i++) {
        if (tree.panels[i].id === panelId) {
          return { panel: tree.panels[i], dockId: tree.id, path: path }
        }
      }
      return null
    }
    for (let i = 0; i < tree.children.length; i++) {
      const r = findPanel(tree.children[i], panelId, path.concat(i))
      if (r) return r
    }
    return null
  }

  // findByName — user-provided stable anchor lookup. Returns either a dock
  // hit or a panel hit; null if not found.
  function findByName(tree, name) {
    if (tree.type === 'dock') {
      if (tree.name === name) return { kind: 'dock', node: tree }
      for (let i = 0; i < tree.panels.length; i++) {
        if (tree.panels[i].name === name) {
          return { kind: 'panel', panel: tree.panels[i], dockId: tree.id }
        }
      }
      return null
    }
    for (let i = 0; i < tree.children.length; i++) {
      const r = findByName(tree.children[i], name)
      if (r) return r
    }
    return null
  }

  function getAt(tree, path) {
    let node = tree
    for (let i = 0; i < path.length; i++) {
      if (node.type !== 'split') return null
      node = node.children[path[i]]
    }
    return node
  }

  // ─── structural ops ───────────────────────────────────────
  function replaceAt(tree, path, newNode) {
    if (path.length === 0) return newNode
    if (tree.type !== 'split') throw new Error('replaceAt: bad path')
    const i = path[0]
    const rest = path.slice(1)
    const children = tree.children.slice()
    children[i] = replaceAt(tree.children[i], rest, newNode)
    return Object.assign({}, tree, { children: children })
  }

  function removeAt(tree, path) {
    if (path.length === 0) return null
    if (path.length === 1) {
      if (tree.type !== 'split') throw new Error('removeAt: bad path')
      const idx = path[0]
      const children = tree.children.filter(function (_, i) { return i !== idx })
      const sizes = normalize(tree.sizes.filter(function (_, i) { return i !== idx }))
      if (children.length === 0) return null
      if (children.length === 1) return children[0]
      return Object.assign({}, tree, { children: children, sizes: sizes })
    }
    const i = path[0]
    const rest = path.slice(1)
    const newChild = removeAt(tree.children[i], rest)
    if (newChild === null) return removeAt(tree, [i])
    const children = tree.children.slice()
    children[i] = newChild
    return Object.assign({}, tree, { children: children })
  }

  function resizeAt(tree, path, newSizes) {
    const node = getAt(tree, path)
    if (!node || node.type !== 'split') return tree
    return replaceAt(tree, path, Object.assign({}, node, { sizes: normalize(newSizes) }))
  }

  // ─── dock-level updates ───────────────────────────────────
  // updateDock — shallow merge into a DockData, but rejects fields the user
  // shouldn't change directly (panels / activeId / id / type). Use addPanel /
  // activatePanel / etc. for those.
  function updateDock(tree, dockId, patch) {
    const found = findDock(tree, dockId)
    if (!found) return tree
    const allowed = {}
    for (const k in patch) {
      if (k === 'panels' || k === 'activeId' || k === 'id' || k === 'type') continue
      allowed[k] = patch[k]
    }
    return replaceAt(tree, found.path, Object.assign({}, found.node, allowed))
  }

  function shouldRemoveDockWhenEmpty(dockNode) {
    return dockNode.removeWhenEmpty !== false
  }

  function setCollapsed(tree, dockId, bool) {
    return updateDock(tree, dockId, { collapsed: !!bool })
  }

  // setFocused — single-focus invariant: setting one to true clears all
  // others; setting to false just clears the target.
  function setFocused(tree, dockId, bool) {
    if (!bool) return updateDock(tree, dockId, { focused: false })
    return mapAllDocks(tree, function (d) {
      const want = d.id === dockId
      if (!!d.focused === want) return d
      return Object.assign({}, d, { focused: want })
    })
  }

  function mapAllDocks(tree, fn) {
    if (tree.type === 'dock') return fn(tree)
    let changed = false
    const newChildren = tree.children.map(function (c) {
      const nc = mapAllDocks(c, fn)
      if (nc !== c) changed = true
      return nc
    })
    return changed ? Object.assign({}, tree, { children: newChildren }) : tree
  }

  // ─── accept whitelist (§ 4.14) ────────────────────────────
  function checkAccept(dockNode, componentName) {
    if (!dockNode.accept || dockNode.accept === '*') return true
    if (Array.isArray(dockNode.accept)) {
      for (let i = 0; i < dockNode.accept.length; i++)
        if (dockNode.accept[i] === componentName) return true
    }
    return false
  }

  // ─── panel-level updates ──────────────────────────────────
  //
  // § 4.4 — transient panel as "preview slot".
  // A dock holds AT MOST one transient panel. Adding a new transient evicts
  // any existing transient(s) in the same dock before insertion. This is
  // the preview-slot semantic every IDE with transient tabs implements
  // (VSCode / JetBrains / Xcode): single-clicking files in a tree replaces
  // the preview tab, double-click (or explicit promote) sticks it.
  // Framework bakes this into addPanel so callers just pass { transient: true }
  // without reimplementing the eviction dance on top.
  function addPanel(tree, dockId, partial, opts) {
    const found = findDock(tree, dockId)
    if (!found) throw new Error('addPanel: dock not found: ' + dockId)
    if (!partial || typeof partial.component !== 'string')
      throw new Error('addPanel: component (string) required')
    if (!checkAccept(found.node, partial.component))
      throw new Error('addPanel: dock "' + dockId + '" does not accept component "' + partial.component + '"')
    const p = panel(partial)
    if (opts && opts.transient) p.transient = true
    let existing = found.node.panels
    if (p.transient) {
      existing = existing.filter(function (ep) { return !ep.transient })
    }
    const newPanels = existing.concat([p])
    const newDock = Object.assign({}, found.node, {
      panels:   newPanels,
      activeId: p.id, // newly added becomes active by default
    })
    return { tree: replaceAt(tree, found.path, newDock), panelId: p.id }
  }

  // removePanel — close semantics. Removing the last panel from a non-root
  // dock removes that dock from the split tree by default. Docks can opt out
  // with removeWhenEmpty:false and stay as empty dock placeholders.
  // The root dock cannot disappear; it becomes an empty dock.
  function removePanel(tree, panelId) {
    const found = findPanel(tree, panelId)
    if (!found) return tree
    const dockNode = getAt(tree, found.path)
    const newPanels = dockNode.panels.filter(function (p) { return p.id !== panelId })
    if (!newPanels.length && found.path.length > 0 && shouldRemoveDockWhenEmpty(dockNode)) return removeAt(tree, found.path)
    let newActive = dockNode.activeId
    if (newActive === panelId) {
      newActive = newPanels.length > 0 ? newPanels[newPanels.length - 1].id : null
    }
    const newDock = Object.assign({}, dockNode, {
      panels:   newPanels,
      activeId: newActive,
    })
    return replaceAt(tree, found.path, newDock)
  }

  function removePanelForMove(tree, panelId) {
    const found = findPanel(tree, panelId)
    if (!found) return null
    const dockNode = getAt(tree, found.path)
    const panelData = dockNode.panels.find(function (p) { return p.id === panelId })
    const newPanels = dockNode.panels.filter(function (p) { return p.id !== panelId })
    if (newPanels.length > 0 || found.path.length === 0 || !shouldRemoveDockWhenEmpty(dockNode)) {
      let newActive = dockNode.activeId
      if (newActive === panelId) newActive = newPanels.length ? newPanels[newPanels.length - 1].id : null
      return {
        tree: replaceAt(tree, found.path, Object.assign({}, dockNode, {
          panels: newPanels,
          activeId: newActive,
        })),
        panel: panelData,
        srcDockId: found.dockId,
      }
    }
    return {
      tree: removeAt(tree, found.path),
      panel: panelData,
      srcDockId: found.dockId,
    }
  }

  function updatePanel(tree, panelId, patch) {
    const found = findPanel(tree, panelId)
    if (!found) return tree
    const dockNode = getAt(tree, found.path)
    const idx = dockNode.panels.findIndex(function (p) { return p.id === panelId })
    if (idx < 0) return tree
    // Forbid id/component overrides through patch.
    const safe = Object.assign({}, patch)
    delete safe.id
    delete safe.component
    const newPanel = Object.assign({}, dockNode.panels[idx], safe)
    const newPanels = dockNode.panels.slice()
    newPanels[idx] = newPanel
    const newDock = Object.assign({}, dockNode, { panels: newPanels })
    return replaceAt(tree, found.path, newDock)
  }

  function replacePanel(tree, panelId, partial, opts) {
    const found = findPanel(tree, panelId)
    if (!found) throw new Error('replacePanel: panel not found: ' + panelId)
    if (!partial || typeof partial.component !== 'string')
      throw new Error('replacePanel: component (string) required')
    const dockNode = getAt(tree, found.path)
    if (!checkAccept(dockNode, partial.component))
      throw new Error('replacePanel: dock "' + found.dockId + '" does not accept component "' + partial.component + '"')
    const idx = dockNode.panels.findIndex(function (p) { return p.id === panelId })
    const p = panel(partial)
    if (opts && opts.transient) p.transient = true
    const newPanels = dockNode.panels.slice()
    newPanels[idx] = p
    const newDock = Object.assign({}, dockNode, {
      panels: newPanels,
      activeId: dockNode.activeId === panelId ? p.id : dockNode.activeId,
    })
    return { tree: replaceAt(tree, found.path, newDock), panelId: p.id, oldPanel: dockNode.panels[idx] }
  }

  function activatePanel(tree, panelId) {
    const found = findPanel(tree, panelId)
    if (!found) return tree
    const dockNode = getAt(tree, found.path)
    if (dockNode.activeId === panelId) return tree
    const newDock = Object.assign({}, dockNode, { activeId: panelId })
    return replaceAt(tree, found.path, newDock)
  }

  function promotePanel(tree, panelId) {
    return updatePanel(tree, panelId, { transient: false })
  }

  // movePanel — cross-dock move, or in-dock reorder if src === dst.
  // Throws if dst dock rejects the component via accept whitelist.
  // Omitting dstIndex appends.
  function movePanel(tree, panelId, dstDockId, dstIndex) {
    const found = findPanel(tree, panelId)
    if (!found) return tree
    const dstFound = findDock(tree, dstDockId)
    if (!dstFound) throw new Error('movePanel: dst dock not found: ' + dstDockId)

    const srcDock = getAt(tree, found.path)
    const panelData = srcDock.panels.find(function (p) { return p.id === panelId })
    if (!checkAccept(dstFound.node, panelData.component))
      throw new Error('movePanel: dst dock does not accept component "' + panelData.component + '"')

    // Same-dock reorder
    if (found.dockId === dstDockId) {
      const oldIdx = srcDock.panels.findIndex(function (p) { return p.id === panelId })
      const newPanels = srcDock.panels.slice()
      newPanels.splice(oldIdx, 1)
      const insertAt = dstIndex == null ? newPanels.length : dstIndex
      newPanels.splice(insertAt, 0, panelData)
      const newDock = Object.assign({}, srcDock, { panels: newPanels })
      return replaceAt(tree, found.path, newDock)
    }

    // Cross-dock move: when the source dock becomes empty, remove that dock
    // from the split tree. Re-find destination afterwards because paths may
    // have shifted or a sibling split may have collapsed.
    const removed = removePanelForMove(tree, panelId)
    const t1 = removed.tree
    const nextDst = findDock(t1, dstDockId)
    if (!nextDst) return tree
    const dstDock = nextDst.node
    const newPanels = dstDock.panels.slice()
    const insertAt = dstIndex == null ? newPanels.length : dstIndex
    newPanels.splice(insertAt, 0, panelData)
    const newDock = Object.assign({}, dstDock, {
      panels:   newPanels,
      activeId: panelId, // moved panel becomes active in destination
    })
    return replaceAt(t1, nextDst.path, newDock)
  }

  // movePanelToSplit — remove an existing panel, split a target dock, and
  // place that same PanelData into the newly-created dock. Used by tab drag
  // five-zone docking. This preserves the moved panel id/data so runtime can
  // re-home its DOM; dock split cloning creates a fresh panel id instead.
  function movePanelToSplit(tree, panelId, dstDockId, direction, side, ratio) {
    const found = findPanel(tree, panelId)
    if (!found) return { tree: tree, newDockId: null }
    const dstFound = findDock(tree, dstDockId)
    if (!dstFound) throw new Error('movePanelToSplit: dst dock not found: ' + dstDockId)

    const srcDock = getAt(tree, found.path)
    const panelData = srcDock.panels.find(function (p) { return p.id === panelId })
    if (!checkAccept(dstFound.node, panelData.component))
      throw new Error('movePanelToSplit: dst dock does not accept component "' + panelData.component + '"')

    const removed = removePanelForMove(tree, panelId)
    const t1 = removed.tree
    const nextDst = findDock(t1, dstDockId)
    if (!nextDst) return { tree: tree, newDockId: null }
    const dstDock = nextDst.node
    const shell = {}
    if (dstDock.toolbar) shell.toolbar = dstDock.toolbar
    if (dstDock.accept != null) shell.accept = dstDock.accept
    return splitDock(t1, dstDockId, direction, side, ratio, {
      dock: shell,
      seedPanels: [panelData],
    })
  }

  function reorderPanel(tree, panelId, newIndex) {
    const found = findPanel(tree, panelId)
    if (!found) return tree
    return movePanel(tree, panelId, found.dockId, newIndex)
  }

  // ─── split / merge ────────────────────────────────────────
  // splitDock — insert a NEW dock alongside the target along `direction`.
  // The pure tree layer stays data-only: callers decide the dock shell and
  // optional seedPanels. The dock runtime's default seed clones the source
  // dock's active PanelData with fresh ids, so split views open the same
  // resource without sharing DOM/runtime.
  //
  // Returns { tree, newDockId, newPanelId? }. newPanelId is set only when
  // seedPanels was provided.
  function splitDock(tree, dockId, direction, side, ratio, opts) {
    const found = findDock(tree, dockId)
    if (!found) return { tree: tree, newDockId: null }
    if (direction !== 'horizontal' && direction !== 'vertical')
      throw new Error('splitDock: bad direction')
    if (side !== 'before' && side !== 'after')
      throw new Error('splitDock: side must be before|after')
    ratio = ratio == null ? 0.5 : ratio
    ratio = Math.max(0.05, Math.min(0.95, ratio))

    const newDock = dock((opts && opts.dock) || {})
    if (opts && opts.seedPanels && opts.seedPanels.length > 0) {
      newDock.panels   = opts.seedPanels.map(normalizePanelInput)
      newDock.activeId = newDock.panels[0].id
    }

    const parentPath = found.path.slice(0, -1)
    const parent = parentPath.length === 0 && tree.type === 'split' ? tree
                 : parentPath.length === 0 ? null
                 : getAt(tree, parentPath)
    const childIdx = found.path[found.path.length - 1]

    let newTree
    // Flat insert into existing same-direction parent split
    if (parent && parent.type === 'split' && parent.direction === direction) {
      const children = parent.children.slice()
      const sizes = parent.sizes.slice()
      const origSize = sizes[childIdx]
      const newSize = origSize * ratio
      sizes[childIdx] = origSize - newSize
      const insertAt = side === 'before' ? childIdx : childIdx + 1
      children.splice(insertAt, 0, newDock)
      sizes.splice(insertAt, 0, newSize)
      newTree = replaceAt(tree, parentPath,
        Object.assign({}, parent, { children: children, sizes: normalize(sizes) }))
    } else {
      // Wrap the target in a new split
      const children = side === 'before' ? [newDock, found.node] : [found.node, newDock]
      const sizes    = side === 'before' ? [ratio, 1 - ratio]    : [1 - ratio, ratio]
      newTree = replaceAt(tree, found.path,
        { type: 'split', direction: direction, children: children, sizes: sizes })
    }

    return {
      tree:       newTree,
      newDockId:  newDock.id,
      newPanelId: newDock.panels.length > 0 ? newDock.panels[0].id : undefined,
    }
  }

  // mergeDocks — winner absorbs loser's geometry. Returns { tree, discardedPanels }
  // so the caller (interactions.js) can do dirty-check + onDirtyDiscard hook.
  // Only valid when winner and loser are direct siblings in the same split.
  // If invalid (different parent / missing / same id), returns the original
  // tree with empty discardedPanels — the caller can treat that as a no-op.
  function mergeDocks(tree, winnerId, loserId) {
    if (winnerId === loserId) return { tree: tree, discardedPanels: [] }
    const w = findDock(tree, winnerId)
    const l = findDock(tree, loserId)
    if (!w || !l) return { tree: tree, discardedPanels: [] }

    const wParent = w.path.slice(0, -1)
    const lParent = l.path.slice(0, -1)
    if (wParent.length !== lParent.length) return { tree: tree, discardedPanels: [] }
    for (let i = 0; i < wParent.length; i++)
      if (wParent[i] !== lParent[i]) return { tree: tree, discardedPanels: [] }

    const parent = wParent.length === 0 ? tree : getAt(tree, wParent)
    if (!parent || parent.type !== 'split') return { tree: tree, discardedPanels: [] }

    const wIdx = w.path[w.path.length - 1]
    const lIdx = l.path[l.path.length - 1]
    const children = parent.children.slice()
    const sizes = parent.sizes.slice()
    sizes[wIdx] += sizes[lIdx]
    children.splice(lIdx, 1)
    sizes.splice(lIdx, 1)

    const discardedPanels = (l.node.panels || []).slice()

    let newTree
    if (children.length === 1) {
      // Parent split collapses to its lone surviving child
      newTree = replaceAt(tree, wParent, children[0])
    } else {
      newTree = replaceAt(tree, wParent,
        Object.assign({}, parent, { children: children, sizes: normalize(sizes) }))
    }
    return { tree: newTree, discardedPanels: discardedPanels }
  }

  function swapDocks(tree, idA, idB) {
    if (idA === idB) return tree
    const a = findDock(tree, idA)
    const b = findDock(tree, idB)
    if (!a || !b) return tree
    const t1 = replaceAt(tree, a.path, b.node)
    return replaceAt(t1, b.path, a.node)
  }

  // Can this dock be collapsed at its current tree position? A dock can fold
  // toward its toolbar edge only when the parent split's direction matches
  // the collapse axis implied by the toolbar side. See design doc discussion
  // on collapse semantics ("pulling the opposite splitter back").
  //
  //   toolbar top/bottom  → collapse axis vertical   → parent must be vertical
  //   toolbar left/right  → collapse axis horizontal → parent must be horizontal
  //
  // Degenerate cases are all falsy: no toolbar (nothing to fold toward),
  // root dock (no parent split to absorb the freed space), unknown id.
  //
  // This is a pure function of topology + toolbar direction, so render.js and
  // any derived signal can call it freely — it's the single source of truth
  // for "is this collapse request meaningful right now?".
  function canCollapseDock(tree, dockId) {
    const found = findDock(tree, dockId)
    if (!found || !found.node.toolbar || found.path.length === 0) return false
    const parent = getAt(tree, found.path.slice(0, -1))
    if (!parent || parent.type !== 'split') return false
    const dir = found.node.toolbar.direction
    const needed = (dir === 'left' || dir === 'right') ? 'horizontal' : 'vertical'
    return parent.direction === needed
  }

  // ─── exports ──────────────────────────────────────────────
  aiditor.dock          = dock
  aiditor.panel         = panel
  aiditor.split         = split
  aiditor.findDock      = findDock
  aiditor.findPanel     = findPanel
  aiditor.findByName    = findByName
  aiditor.getAt         = getAt
  aiditor.replaceAt     = replaceAt
  aiditor.removeAt      = removeAt
  aiditor.resizeAt      = resizeAt
  aiditor.updateDock    = updateDock
  aiditor.setCollapsed  = setCollapsed
  aiditor.setFocused    = setFocused
  aiditor.addPanel      = addPanel
  aiditor.removePanel   = removePanel
  aiditor.updatePanel   = updatePanel
  aiditor.replacePanel  = replacePanel
  aiditor.activatePanel = activatePanel
  aiditor.promotePanel  = promotePanel
  aiditor.movePanel     = movePanel
  aiditor.movePanelToSplit = movePanelToSplit
  aiditor.reorderPanel  = reorderPanel
  aiditor.splitDock     = splitDock
  aiditor.mergeDocks    = mergeDocks
  aiditor.swapDocks     = swapDocks
  aiditor.canCollapseDock = canCollapseDock
})(window.aiditor = window.aiditor || {})

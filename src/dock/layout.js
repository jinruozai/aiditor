// createDockLayout — public entry. Builds a LayoutRuntime, drives one
// reconcile effect, and exposes the LayoutHandle described in § 4.9 Layer 1.
//
// This is the only file in dock/ that touches the public aiditor surface.
;(function (aiditor) {
  'use strict'

  const signal = aiditor.signal
  const effect = aiditor.effect
  const RT     = aiditor._dock

  let _globalListenersInstalled = false

  function installGlobalErrorListeners() {
    if (_globalListenersInstalled) return
    _globalListenersInstalled = true
    window.addEventListener('error', function (e) {
      const err = e.error || new Error(e.message || 'Script error')
      if (!e.error && err && !err.stack) {
        err.stack = [
          e.filename || 'unknown source',
          e.lineno != null ? String(e.lineno) : '',
          e.colno != null ? String(e.colno) : '',
        ].filter(Boolean).join(':')
      }
      aiditor.reportError({ scope: 'global', filename: e.filename || '', lineno: e.lineno || 0, colno: e.colno || 0 }, err)
    })
    window.addEventListener('unhandledrejection', function (e) {
      aiditor.reportError({ scope: 'global' }, e.reason || new Error('unhandledrejection'))
    })
  }

  function createDockLayout(container, config) {
    config = config || {}
    if (!config.tree) throw new Error('createDockLayout: config.tree is required')

    installGlobalErrorListeners()
    container.classList.add('aiditor-root')

    const tree   = signal(config.tree)
    const layout = RT.createLayoutRuntime(container, tree, {
      lru:   config.lru,
      dockMenu: config.dockMenu === true,
      hooks: config.hooks,
    })
    if (layout.dockMenu && RT.installDefaultDockMenu) RT.installDefaultDockMenu()

    const stopReconcile = effect(function () {
      const t = tree()
      if (!layout.disposed) RT.reconcile(layout, t)
    })
    layout.cleanups.push(stopReconcile)

    // Popup-window handshake. No-op in regular windows.
    if (RT.bindMigrationReceiver) RT.bindMigrationReceiver(layout)

    // ── LayoutHandle ───────────────────────────────────
    const handle = {
      tree:      function ()  { return tree.peek() },
      setTree:   function (t) { layout.setTree(t) },
      subscribe: function (fn) { return effect(function () { fn(tree()) }) },

      addPanel: function (dockId, partial, opts) {
        const id = resolveDockId(tree.peek(), dockId)
        return { panelId: id ? layout.addPanel(id, partial, opts) : null }
      },
      addPanelToSplit: function (dockId, dir, side, ratio, partial) {
        const id = resolveDockId(tree.peek(), dockId)
        return id ? layout.addPanelToSplit(id, dir, side, ratio, partial) : { newDockId: null, newPanelId: null }
      },
      replacePanel:  function (panelId, partial, opts)       { return { panelId: layout.replacePanel(panelId, partial, opts) } },
      reloadPanel:   function (panelId)                      { return { panelId: layout.reloadPanel(panelId) } },
      removePanel:   function (panelId)                      { layout.removePanel(panelId) },
      requestClosePanel: function (panelId, reason)          { return layout.requestClosePanels([panelId], reason) },
      requestClosePanels: function (panelIds, reason)        { return layout.requestClosePanels(panelIds, reason) },
      activatePanel: function (panelId)                      { layout.activatePanel(panelId) },
      promotePanel:  function (panelId)                      { layout.promotePanel(panelId) },
      movePanel:     function (panelId, dstDockId, dstIndex) { layout.movePanel(panelId, dstDockId, dstIndex) },
      inspectDocks:  function ()                             { return RT.inspectDocks(layout) },
      inspectPanel:  function (panelId)                      { return RT.inspectPanel(layout, panelId) },
      inspectPanels: function ()                             { return RT.inspectPanels(layout) },

      splitDock: function (dockId, dir, side, ratio, opts) {
        if (layout.disposed) return { newDockId: null, newPanelId: null }
        const current = tree.peek()
        const seed = opts && opts.seedPanels ? opts.seedPanels : computeSplitSeed(current, dockId)
        const shell = opts && opts.dock ? opts.dock : computeSplitDockShell(current, dockId)
        const r = aiditor.splitDock(current, dockId, dir, side, ratio, { dock: shell, seedPanels: seed })
        layout.setTree(r.tree)
        return { newDockId: r.newDockId, newPanelId: r.newPanelId }
      },

      mergeDocks: function (winnerId, loserId) {
        if (layout.disposed) return false
        const r = aiditor.mergeDocks(tree.peek(), winnerId, loserId)
        if (r.discardedPanels.some(function (p) { return p.dirty })) {
          const hook = layout.hooks.onDirtyDiscard
          const choice = hook ? hook(r.discardedPanels) : 'cancel'
          if (choice !== 'discard') return false
        }
        layout.setTree(r.tree)
        return true
      },

      // Toggle a dock's collapsed state by id OR name. Accepts the config
      // `name` (assigned via aiditor.dock({ name: 'log' })) as a sugar — the
      // names are more stable across layouts than framework-generated ids.
      setDockCollapsed: function (idOrName, bool) {
        if (layout.disposed) return false
        const id = resolveDockId(tree.peek(), idOrName)
        if (!id) return false
        layout.setTree(aiditor.setCollapsed(tree.peek(), id, !!bool))
        return true
      },

      destroy: function () {
        RT.disposeLayoutRuntime(layout)
      },
    }

    // Expose the runtime on the handle for interactions.js (private use).
    handle._runtime = layout
    if (aiditor.extensions && aiditor.extensions.registerLayout) {
      layout.cleanups.push(aiditor.extensions.registerLayout(config.name || 'default', handle))
    }
    return handle
  }

  // Walk the tree for a dock whose id OR config-time name matches.
  // The framework assigns opaque ids (dock-1, dock-2…); callers that
  // need stable external references pass `name` at dock creation and
  // pass the same string here. Returns the resolved id or null.
  function resolveDockId(tree, idOrName) {
    if (!idOrName) return null
    let hit = null
    function walk(n) {
      if (!n || hit) return
      if (n.type === 'dock') {
        if (n.id === idOrName || n.name === idOrName) { hit = n.id; return }
      } else if (n.children) {
        for (let i = 0; i < n.children.length; i++) walk(n.children[i])
      }
    }
    walk(tree)
    return hit
  }

  // Compute seedPanels for a split — § 4.1: clone the source dock's active
  // PanelData as serializable state, with fresh ids assigned by tree.panel().
  // Empty source dock → empty new dock.
  function computeSplitSeed(tree, srcDockId) {
    const f = aiditor.findDock(tree, srcDockId)
    if (!f || !f.node.activeId) return null
    const active = f.node.panels.find(function (p) { return p.id === f.node.activeId })
    if (!active) return null
    return [clonePanelInput(active)]
  }

  function clonePanelInput(panel) {
    const out = Object.assign({}, panel)
    delete out.id
    if (panel.props) out.props = structuredClone(panel.props)
    if (panel.toolbarItems) out.toolbarItems = structuredClone(panel.toolbarItems)
    return out
  }

  function computeSplitDockShell(tree, srcDockId) {
    const f = aiditor.findDock(tree, srcDockId)
    if (!f) return {}
    const dock = f.node
    const shell = {}
    if (dock.toolbar) shell.toolbar = structuredClone(dock.toolbar)
    if (dock.accept != null) shell.accept = structuredClone(dock.accept)
    if (dock.removeWhenEmpty === false) shell.removeWhenEmpty = false
    return shell
  }

  aiditor.createDockLayout = createDockLayout
  aiditor._dock = aiditor._dock || {}
  aiditor._dock.computeSplitSeed = computeSplitSeed
  aiditor._dock.computeSplitDockShell = computeSplitDockShell
})(window.aiditor = window.aiditor || {})

// Dock Menu - optional command/menu contribution rendered from a dock corner.
;(function (aiditor) {
  'use strict'

  const findDock = aiditor.findDock
  const OWNER = 'aiditor:dock-menu'
  let installed = false

  function installDefaultDockMenu() {
    const commands = aiditor.commands
    if (defaultDockMenuInstalled(commands)) {
      installed = true
      return
    }
    commands.unregisterOwner(OWNER)

    commands.register('aiditor.dock.addPanel', {
      title: 'Add Panel',
      icon: 'plus',
      run: function (_, ctx) { openAddPanelMenu(ctx.pos, ctx.dockId, ctx.layout) },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.toggleFocus', {
      title: 'Focus Panel',
      icon: 'maximize',
      run: function (_, ctx) {
        ctx.layout.setTree(aiditor.setFocused(ctx.layout.treeSig.peek(), ctx.dockId, !ctx.dock.focused))
      },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.closeActivePanel', {
      title: 'Close Active',
      icon: 'x',
      run: function (_, ctx) { if (ctx.activeId) ctx.layout.removePanel(ctx.activeId) },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.closeOtherPanels', {
      title: 'Close Others',
      icon: 'x',
      run: function (_, ctx) { closeOtherPanels(ctx.dockId, ctx.activeId, ctx.layout) },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.closeAllPanels', {
      title: 'Close All',
      icon: 'x',
      run: function (_, ctx) { closeAllPanels(ctx.dockId, ctx.layout) },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.promoteActivePanel', {
      title: 'Pin Active',
      icon: 'pin',
      run: function (_, ctx) { if (ctx.activeId) ctx.layout.promotePanel(ctx.activeId) },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.toggleRemoveWhenEmpty', {
      title: 'Remove Dock When Empty',
      icon: 'trash',
      run: function (_, ctx) {
        ctx.layout.setTree(aiditor.updateDock(ctx.layout.treeSig.peek(), ctx.dockId, {
          removeWhenEmpty: ctx.dock.removeWhenEmpty === false,
        }))
      },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.toolbar.setPosition', {
      title: 'Toolbar Position',
      run: function (input, ctx) {
        const dock = findDock(ctx.layout.treeSig.peek(), ctx.dockId).node
        const direction = input.direction
        if (!direction) setDockToolbar(ctx.dockId, ctx.layout, null)
        else setDockToolbar(ctx.dockId, ctx.layout, Object.assign({}, dock.toolbar || defaultToolbar(direction), { direction: direction }))
      },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.toolbar.setTabs', {
      title: 'Tab Style',
      run: function (input, ctx) {
        const dock = findDock(ctx.layout.treeSig.peek(), ctx.dockId).node
        setDockToolbar(ctx.dockId, ctx.layout, withTabComponent(dock.toolbar || defaultToolbar('top'), input.component))
      },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.toolbar.show', {
      title: 'Show Toolbar',
      run: function (_, ctx) { ensureToolbar(ctx.dockId, ctx.layout) },
    }, { owner: OWNER, layer: 'core' })
    commands.register('aiditor.dock.toolbar.hide', {
      title: 'Hide Toolbar',
      run: function (_, ctx) { setDockToolbar(ctx.dockId, ctx.layout, null) },
    }, { owner: OWNER, layer: 'core' })

    registerDefaultMenus(commands)
    installed = true
  }

  function defaultDockMenuInstalled(commands) {
    return installed &&
      commands.get('aiditor.dock.addPanel') &&
      commands.menuMeta('aiditor.dock.context.addPanel').owner === OWNER
  }

  function openDockMenu(pos, dockId, layout) {
    if (!layout.dockMenu) return
    const dock = findDock(layout.treeSig.peek(), dockId)
    if (!dock) return
    const ctx = dockContext(pos, dockId, layout, dock.node)
    const items = aiditor.commands.menuUiItems('dock.context', ctx)
    aiditor.ui.contextMenu(pos, items)
  }

  function dockContext(pos, dockId, layout, dock) {
    return {
      pos: pos,
      dockId: dockId,
      layout: layout,
      dock: dock,
      activeId: dock.activeId,
      active: activePanel(dock),
    }
  }

  function registerDefaultMenus(commands) {
    menu(commands, 'aiditor.dock.context.addPanel', { target: 'dock.context', command: 'aiditor.dock.addPanel', label: 'Add Panel', icon: 'plus', order: 10 })
    menu(commands, 'aiditor.dock.context.focus', {
      target: 'dock.context',
      command: 'aiditor.dock.toggleFocus',
      label: function (ctx) { return ctx.dock.focused ? 'Restore Panel' : 'Focus Panel' },
      icon: function (ctx) { return ctx.dock.focused ? 'minimize' : 'maximize' },
      order: 20,
    })
    menu(commands, 'aiditor.dock.context.divider', { target: 'dock.context', type: 'divider', order: 30 })
    menu(commands, 'aiditor.dock.context.panel', { target: 'dock.context', label: 'Panel', childrenTarget: 'dock.context.panel', order: 40 })
    menu(commands, 'aiditor.dock.context.toolbar', { target: 'dock.context', label: 'Toolbar', childrenTarget: 'dock.context.toolbar', order: 50 })

    menu(commands, 'aiditor.dock.panel.closeActive', { target: 'dock.context.panel', command: 'aiditor.dock.closeActivePanel', label: 'Close Active', icon: 'x', disabled: function (ctx) { return !ctx.activeId }, order: 10 })
    menu(commands, 'aiditor.dock.panel.closeOthers', { target: 'dock.context.panel', command: 'aiditor.dock.closeOtherPanels', label: 'Close Others', icon: 'x', disabled: function (ctx) { return !ctx.activeId || ctx.dock.panels.length < 2 }, order: 20 })
    menu(commands, 'aiditor.dock.panel.closeAll', { target: 'dock.context.panel', command: 'aiditor.dock.closeAllPanels', label: 'Close All', icon: 'x', disabled: function (ctx) { return ctx.dock.panels.length === 0 }, order: 30 })
    menu(commands, 'aiditor.dock.panel.divider', { target: 'dock.context.panel', type: 'divider', order: 40 })
    menu(commands, 'aiditor.dock.panel.pinActive', {
      target: 'dock.context.panel',
      command: 'aiditor.dock.promoteActivePanel',
      label: 'Pin Active',
      icon: function (ctx) { return ctx.active && ctx.active.transient ? 'pin' : 'check' },
      disabled: function (ctx) { return !ctx.active || !ctx.active.transient },
      order: 50,
    })
    menu(commands, 'aiditor.dock.panel.removeWhenEmpty', {
      target: 'dock.context.panel',
      command: 'aiditor.dock.toggleRemoveWhenEmpty',
      label: 'Remove Dock When Empty',
      icon: function (ctx) { return ctx.dock.removeWhenEmpty === false ? '' : 'check' },
      order: 60,
    })

    menu(commands, 'aiditor.dock.toolbar.position', { target: 'dock.context.toolbar', label: 'Position', childrenTarget: 'dock.context.toolbar.position', order: 10 })
    menu(commands, 'aiditor.dock.toolbar.tabs', { target: 'dock.context.toolbar', label: 'Tabs', childrenTarget: 'dock.context.toolbar.tabs', order: 20 })
    menu(commands, 'aiditor.dock.toolbar.divider', { target: 'dock.context.toolbar', type: 'divider', order: 30 })
    menu(commands, 'aiditor.dock.toolbar.show', { target: 'dock.context.toolbar', command: 'aiditor.dock.toolbar.show', label: 'Show Toolbar', icon: function (ctx) { return ctx.dock.toolbar ? 'check' : '' }, order: 40 })
    menu(commands, 'aiditor.dock.toolbar.hide', { target: 'dock.context.toolbar', command: 'aiditor.dock.toolbar.hide', label: 'Hide Toolbar', icon: function (ctx) { return ctx.dock.toolbar ? '' : 'check' }, order: 50 })

    toolbarPositionMenu(commands, 'Top', 'top', 10)
    toolbarPositionMenu(commands, 'Bottom', 'bottom', 20)
    toolbarPositionMenu(commands, 'Left', 'left', 30)
    toolbarPositionMenu(commands, 'Right', 'right', 40)
    menu(commands, 'aiditor.dock.toolbar.position.hidden', {
      target: 'dock.context.toolbar.position',
      command: 'aiditor.dock.toolbar.setPosition',
      label: 'Hidden',
      input: { direction: null },
      icon: function (ctx) { return ctx.dock.toolbar ? '' : 'check' },
      order: 50,
    })

    tabStyleMenu(commands, 'Standard', 'tab-standard', 10)
    tabStyleMenu(commands, 'Compact', 'tab-compact', 20)
    tabStyleMenu(commands, 'Collapsible', 'tab-collapsible', 30)
    tabStyleMenu(commands, 'Sidebar', 'tab-sidebar', 40)
  }

  function menu(commands, id, spec) {
    commands.registerMenu(id, spec, { owner: OWNER, layer: 'core' })
  }

  function toolbarPositionMenu(commands, label, direction, order) {
    menu(commands, 'aiditor.dock.toolbar.position.' + direction, {
      target: 'dock.context.toolbar.position',
      command: 'aiditor.dock.toolbar.setPosition',
      label: label,
      input: { direction: direction },
      icon: function (ctx) { return ctx.dock.toolbar && (ctx.dock.toolbar.direction || 'top') === direction ? 'check' : '' },
      order: order,
    })
  }

  function tabStyleMenu(commands, label, component, order) {
    menu(commands, 'aiditor.dock.toolbar.tabs.' + component, {
      target: 'dock.context.toolbar.tabs',
      command: 'aiditor.dock.toolbar.setTabs',
      label: label,
      input: { component: component },
      icon: function (ctx) { return currentTabComponent(ctx.dock.toolbar) === component ? 'check' : '' },
      order: order,
    })
  }

  function activePanel(dock) {
    if (!dock.activeId) return null
    for (let i = 0; i < dock.panels.length; i++) {
      if (dock.panels[i].id === dock.activeId) return dock.panels[i]
    }
    return null
  }

  function closeOtherPanels(dockId, activeId, layout) {
    if (!activeId) return
    const dock = findDock(layout.treeSig.peek(), dockId)
    if (!dock) return
    const ids = dock.node.panels
      .filter(function (p) { return p.id !== activeId })
      .map(function (p) { return p.id })
    for (let i = 0; i < ids.length; i++) layout.removePanel(ids[i])
  }

  function closeAllPanels(dockId, layout) {
    const dock = findDock(layout.treeSig.peek(), dockId)
    if (!dock) return
    const ids = dock.node.panels.map(function (p) { return p.id })
    for (let i = 0; i < ids.length; i++) layout.removePanel(ids[i])
  }

  function openAddPanelMenu(pos, dockId, layout) {
    const dock = findDock(layout.treeSig.peek(), dockId)
    if (!dock) return
    const items = aiditor.listComponents()
      .filter(function (spec) {
        return spec.category === 'panel' && accepts(dock.node, spec.name)
      })
      .sort(function (a, b) { return panelLabel(a).localeCompare(panelLabel(b)) })
      .map(function (spec) {
        return {
          label: panelLabel(spec),
          value: spec.name,
          icon: spec.icon || (spec.defaults && spec.defaults().icon) || 'square',
          group: spec.category || 'panel',
          onSelect: function () {
            const defaults = aiditor.componentDefaults(spec.name)
            layout.addPanel(dockId, Object.assign({}, defaults, { component: spec.name }))
          },
        }
      })
    aiditor.ui.quickPick({
      pos: pos,
      items: items,
      getKey: function (item) { return item.value },
      getLabel: function (item) { return item.label },
      getIcon: function (item) { return item.icon },
      getGroup: function (item) { return item.group },
      onSelect: function (item) {
        if (item.onSelect) item.onSelect()
      },
      placeholder: 'Add panel...',
      width: 320,
      maxHeight: 420,
    })
  }

  function panelLabel(spec) {
    const d = spec.defaults ? spec.defaults() : {}
    return spec.label || d.title || spec.name
  }

  function accepts(dock, component) {
    const a = dock.accept
    return !a || a === '*' || (Array.isArray(a) && a.indexOf(component) >= 0)
  }

  function ensureToolbar(dockId, layout) {
    const dock = findDock(layout.treeSig.peek(), dockId)
    if (!dock || dock.node.toolbar) return
    setDockToolbar(dockId, layout, defaultToolbar('top'))
  }

  function setDockToolbar(dockId, layout, toolbar) {
    layout.setTree(aiditor.updateDock(layout.treeSig.peek(), dockId, { toolbar: toolbar }))
  }

  function defaultToolbar(direction) {
    return {
      direction: direction || 'top',
      items: [{ component: 'tab-standard', props: {}, align: 'start' }],
    }
  }

  function currentTabComponent(toolbar) {
    const item = firstTabItem(toolbar)
    return item && item.component
  }

  function withTabComponent(toolbar, component) {
    const tb = Object.assign({}, toolbar, { items: (toolbar.items || []).slice() })
    const idx = tb.items.findIndex(function (item) { return isTabComponent(item.component) })
    const next = { component: component, props: {}, align: 'start' }
    if (idx >= 0) tb.items[idx] = Object.assign({}, tb.items[idx], { component: component })
    else tb.items.unshift(next)
    return tb
  }

  function firstTabItem(toolbar) {
    if (!toolbar || !toolbar.items) return null
    for (let i = 0; i < toolbar.items.length; i++) {
      if (isTabComponent(toolbar.items[i].component)) return toolbar.items[i]
    }
    return null
  }

  function isTabComponent(component) {
    return component === 'tab-standard' || component === 'tab-compact' ||
      component === 'tab-collapsible' || component === 'tab-sidebar'
  }

  aiditor._dock = aiditor._dock || {}
  aiditor._dock.installDefaultDockMenu = installDefaultDockMenu
  aiditor._dock.openDockMenu = openDockMenu
})(window.aiditor = window.aiditor || {})

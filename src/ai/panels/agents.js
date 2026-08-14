;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui

  function read(v) { return ui.isSignal(v) ? v() : v }
  function readList(v) { return read(v) || [] }

  function disposeTree(el) {
    if (!el) return
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function labelOf(item, fallback) {
    return item.name || item.label || fallback || item.id
  }

  function statusOf(agent) {
    return agent.status || 'idle'
  }

  function statusLabel(status) {
    return String(status || 'idle').replace(/[_-]+/g, ' ').toUpperCase()
  }

  function statusClass(status) {
    return String(status || 'idle').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'idle'
  }

  function orderOf(item, index) {
    return item.order != null ? item.order : index
  }

  function agentNodeId(id) {
    return 'agent:' + id
  }

  function compareNode(a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return String(a.label).localeCompare(String(b.label))
  }

  function sortTree(nodes) {
    nodes.sort(compareNode)
    for (let i = 0; i < nodes.length; i++) sortTree(nodes[i].children || [])
  }

  function sameTree(a, b) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      const left = a[i]
      const right = b[i]
      if (
        left.id !== right.id ||
        left.label !== right.label ||
        left.parentAgentId !== right.parentAgentId ||
        left.status !== right.status ||
        left.queuedCount !== right.queuedCount ||
        left.unreadInboxCount !== right.unreadInboxCount ||
        left.sortOrder !== right.sortOrder ||
        !sameTree(left.children || [], right.children || [])
      ) return false
    }
    return true
  }

  function sameSet(a, b) {
    if (a.size !== b.size) return false
    for (const value of a) if (!b.has(value)) return false
    return true
  }

  function toTreeItems(agents) {
    const roots = []
    const byId = {}
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      const status = statusOf(agent)
      byId[agent.id] = {
        id: agentNodeId(agent.id),
        label: labelOf(agent, 'Agent'),
        kind: 'agent',
        agentId: agent.id,
        parentAgentId: agent.parentAgentId || null,
        status: status,
        statusClass: statusClass(status),
        queuedCount: (agent.queue || []).length,
        unreadInboxCount: (agent.inbox || []).filter(function (event) { return !event.consumed }).length,
        sortOrder: orderOf(agent, i),
        children: [],
      }
    }
    Object.keys(byId).forEach(function (id) {
      const node = byId[id]
      const parent = node.parentAgentId ? byId[node.parentAgentId] : null
      if (parent && parent !== node) parent.children.push(node)
      else roots.push(node)
    })
    sortTree(roots)
    return roots
  }

  function findNode(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i]
      const found = findNode(nodes[i].children || [], id)
      if (found) return found
    }
    return null
  }

  function findPath(nodes, id, path) {
    path = path || []
    for (let i = 0; i < nodes.length; i++) {
      const nextPath = path.concat([nodes[i].id])
      if (nodes[i].id === id) return nextPath
      const found = findPath(nodes[i].children || [], id, nextPath)
      if (found) return found
    }
    return null
  }

  function expandableIds(nodes, out) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].children && nodes[i].children.length) {
        out.add(nodes[i].id)
        expandableIds(nodes[i].children, out)
      }
    }
    return out
  }

  function activeNodeId() {
    const id = read(aiditor.ai.activeAgentId)
    return id ? agentNodeId(id) : null
  }

  function firstAgentNodeId(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].kind === 'agent') return nodes[i].id
      const found = firstAgentNodeId(nodes[i].children || [])
      if (found) return found
    }
    return null
  }

  function createAgent(parentAgentId) {
      aiditor.ai.createAgent({ parentAgentId: parentAgentId || null, skillRefs: ['aiditor.agent-orchestration'] })
  }

  function renameNode(node) {
    ui.prompt({ title: 'Rename Agent', message: 'Name', default: node.label }).then(function (name) {
      if (!name || name === node.label) return
      aiditor.ai.renameAgent(node.agentId, name)
    })
  }

  function deleteNode(node) {
    aiditor.ai.deleteAgent(node.agentId)
  }

  function commitDrop(target, position, data) {
    const source = data.nodes[0]
    if (!source || source.id === target.id) return
    if (position === 'inside') {
      aiditor.ai.reparentAgent(source.agentId, target.agentId)
      return
    }
    aiditor.ai.reparentAgent(source.agentId, target.parentAgentId || null, target.sortOrder + (position === 'after' ? 1 : -1))
  }

  function rootMenu() {
    return [{ label: 'New Agent', icon: 'user', onSelect: function () { createAgent(null) } }]
  }

  function openRootMenu(ev) {
    if (ev.target.closest && ev.target.closest('.aiditor-ui-tree-row')) return
    ev.preventDefault()
    ui.contextMenu({ x: ev.clientX, y: ev.clientY }, rootMenu())
  }

  function agentRowTemplate() {
    const root = ui.h('div', 'aiditor-ai-agent-row')
    const arrow = ui.h('span', 'aiditor-ui-tree-arrow')
    const label = ui.h('span', 'aiditor-ui-tree-label aiditor-ai-agent-label')
    const statusTip = aiditor.signal('')
    const dot = ui.h('span', 'aiditor-ai-agent-dot')
    const name = ui.h('span', 'aiditor-ai-agent-name')
    const tail = ui.h('span', 'aiditor-ai-agent-tail')
    const count = ui.h('span', 'aiditor-ai-group-count')
    const actions = ui.h('span', 'aiditor-ui-tree-actions aiditor-ai-agent-actions')
    let currentNode = null
    let currentCtx = null
    let dotClass = ''

    actions.setAttribute('data-visibility', 'selected')
    ui.tooltip(dot, { text: statusTip, side: 'right', delay: 250 })
    const remove = ui.iconButton({
      icon: 'trash',
      title: 'Delete',
      size: 'sm',
      kind: 'ghost',
      onClick: function () { deleteNode(currentNode) },
    })
    actions.appendChild(remove)
    label.appendChild(dot)
    label.appendChild(name)
    tail.appendChild(count)
    tail.appendChild(actions)
    root.appendChild(arrow)
    root.appendChild(label)
    root.appendChild(tail)

    arrow.addEventListener('click', function (ev) {
      if (!currentCtx || !currentCtx.row.hasKids) return
      ev.stopPropagation()
      currentCtx.toggle()
    })
    arrow.addEventListener('dblclick', function (ev) {
      if (currentCtx && currentCtx.row.hasKids) ev.stopPropagation()
    })
    actions.addEventListener('pointerdown', function (ev) { ev.stopPropagation() })
    actions.addEventListener('dblclick', function (ev) { ev.stopPropagation() })
    actions.addEventListener('click', function (ev) { ev.stopPropagation() })

    return {
      root: root,
      update: function (node, row, ctx) {
        currentNode = node
        currentCtx = ctx
        arrow.textContent = row.hasKids ? (row.expanded ? '▾' : '▸') : ''
        const tip = 'Status: ' + statusLabel(node.status)
        statusTip.set(tip)
        dot.setAttribute('aria-label', tip)
        if (dotClass) dot.classList.remove(dotClass)
        dotClass = 'aiditor-ai-agent-dot-' + node.statusClass
        dot.classList.add(dotClass)
        name.textContent = node.label
        name.title = node.label
        const total = Number(node.queuedCount || 0) + Number(node.unreadInboxCount || 0)
        count.textContent = total ? String(total) : ''
        count.hidden = !total
      },
      dispose: function () { disposeTree(root) },
    }
  }

  function factory() {
    const root = ui.h('div', 'aiditor-ai-panel aiditor-ai-agents')
    const itemsSig = aiditor.signal([])
    const selectedSig = aiditor.signal([])
    const expandedSig = aiditor.signal(new Set())
    let expansionSeeded = false
    let knownAgentIds = new Set()

    const toolbar = ui.h('div', 'aiditor-ai-toolbar')
    toolbar.appendChild(ui.button({
      text: 'New Agent',
      kind: 'default',
      size: 'sm',
      onClick: function () {
        createAgent(null)
      },
    }))
    root.appendChild(toolbar)

    const tree = ui.tree({
      items: itemsSig,
      selected: selectedSig,
      expanded: expandedSig,
      multi: false,
      rowHeight: 24,
      onRowClick: function () { return 'select' },
      onSelect: function (ids) {
        if (!ids.length) return
        const node = findNode(itemsSig.peek(), ids[0])
        if (node) aiditor.ai.selectAgent(node.agentId)
      },
      renderTemplate: agentRowTemplate,
      contextMenu: function (node) {
        return [
          { label: 'New Child Agent', icon: 'user-plus', onSelect: function () { createAgent(node.agentId) } },
          { type: 'divider' },
          { label: 'Rename', icon: 'edit', onSelect: function () { renameNode(node) } },
          { label: 'Delete', icon: 'trash', danger: true, onSelect: function () { deleteNode(node) } },
        ]
      },
      dnd: {
        canDrag: function () { return true },
        getDragData: function (nodes) { return { types: ['aiditor.ai/agent'], nodes: nodes } },
        dropZones: function () { return ['before', 'inside', 'after'] },
        canDrop: function (node, position, data) {
          const source = data.nodes[0]
          if (!source || source.id === node.id) return false
          if (position === 'inside') return !aiditor.ai.isDescendant(source.agentId, node.agentId)
          return true
        },
        onDrop: commitDrop,
      },
    })
    tree.classList.add('aiditor-ai-agent-tree')
    tree.addEventListener('contextmenu', openRootMenu)
    root.appendChild(tree)

    function syncTree() {
      const agents = readList(aiditor.ai.agents)
      let items = toTreeItems(agents)
      const currentItems = itemsSig.peek()
      if (!sameTree(currentItems, items)) itemsSig.set(items)
      else items = currentItems
      if (!expansionSeeded) {
        expandedSig.set(expandableIds(items, new Set()))
        expansionSeeded = true
      }
      const nextKnown = new Set()
      const nextExpanded = new Set(expandedSig.peek())
      for (let i = 0; i < agents.length; i++) {
        nextKnown.add(agents[i].id)
        if (knownAgentIds.has(agents[i].id)) continue
        const path = findPath(items, agentNodeId(agents[i].id)) || []
        for (let j = 0; j < path.length - 1; j++) nextExpanded.add(path[j])
      }
      knownAgentIds = nextKnown
      if (!sameSet(expandedSig.peek(), nextExpanded)) expandedSig.set(nextExpanded)
      const selected = selectedSig.peek()[0]
      const active = activeNodeId() || firstAgentNodeId(items)
      if (selected !== active) selectedSig.set(active ? [active] : [])
    }

    ui.collect(root, aiditor.effect(syncTree))
    return root
  }

  aiditor.registerComponent('ai-agents-list', {
    category: 'panel',
    label: 'AI Agents',
    icon: 'user',
    defaults: function () { return { title: 'AI Agents', icon: 'user', props: {} } },
    factory: factory,
    dispose: disposeTree,
  })
})(window.aiditor = window.aiditor || {})

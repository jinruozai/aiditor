// demo component: ui-gallery
;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui

  const SOURCE_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'builtin', label: 'Built-in' },
    { value: 'project', label: 'Project' },
  ]

  const CATEGORY_ORDER = ['layout', 'base', 'form', 'editor', 'container', 'data', 'display', 'overlay', 'custom', 'panel']

  function disposeTree(el) {
    if (!el) return
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function titleCase(text) {
    return String(text || 'custom').replace(/^./, function (c) { return c.toUpperCase() })
  }

  function sourceOfRegistration(reg) {
    if (reg.layer && reg.layer !== 'builtin') return 'project'
    if (reg.owner && String(reg.owner).indexOf('project:') === 0) return 'project'
    return 'builtin'
  }

  function catalogItems() {
    const out = []
    for (let i = 0; i < Demo.catalog.length; i++) {
      const entry = Demo.catalog[i]
      out.push({
        id: 'catalog:' + entry.id,
        component: entry.id,
        label: entry.name,
        category: entry.category || 'custom',
        source: 'builtin',
        entry: entry,
      })
    }
    return out
  }

  function registryItems(seen) {
    const out = []
    const regs = aiditor.listComponents()
    for (let i = 0; i < regs.length; i++) {
      const reg = regs[i]
      if (seen[reg.name]) continue
      if (reg.palette === false) continue
      if (!reg.label && !reg.category && !reg.schema && !reg.bindable && !reg.appendChild) continue
      const source = sourceOfRegistration(reg)
      const category = String(reg.category || 'custom').toLowerCase()
      out.push({
        id: 'component:' + reg.name,
        component: reg.name,
        label: reg.label || reg.name,
        category: category,
        source: source,
        reg: reg,
      })
    }
    return out
  }

  function allItems() {
    const seen = {}
    const out = catalogItems()
    for (let i = 0; i < out.length; i++) seen[out[i].component] = true
    return out.concat(registryItems(seen)).sort(function (a, b) {
      const ca = CATEGORY_ORDER.indexOf(a.category)
      const cb = CATEGORY_ORDER.indexOf(b.category)
      const oa = ca < 0 ? 999 : ca
      const ob = cb < 0 ? 999 : cb
      if (oa !== ob) return oa - ob
      return String(a.label).localeCompare(String(b.label))
    })
  }

  function categoriesFrom(items) {
    const seen = {}
    const out = []
    for (let i = 0; i < items.length; i++) {
      const cat = items[i].category || 'custom'
      if (!seen[cat]) {
        seen[cat] = true
        out.push(cat)
      }
    }
    return out.sort(function (a, b) {
      const ia = CATEGORY_ORDER.indexOf(a)
      const ib = CATEGORY_ORDER.indexOf(b)
      const oa = ia < 0 ? 999 : ia
      const ob = ib < 0 ? 999 : ib
      if (oa !== ob) return oa - ob
      return a.localeCompare(b)
    })
  }

  function itemTarget(item) {
    if (item.entry && Demo.aiTargets) return Demo.aiTargets.component(item.entry)
    return {
      resolver: 'editor',
      uri: 'editor://component/' + encodeURIComponent(item.component),
      kind: 'editor.component',
      title: item.label,
      summary: 'Registered AIditor component ' + item.component + '.',
      meta: {
        component: item.component,
        label: item.label,
        category: item.category,
        source: item.source,
      },
    }
  }

  function mountPreview(item) {
    if (item.category === 'panel') {
      const el = ui.h('div', 'demo-ui-gallery-panel-preview')
      el.appendChild(ui.icon({ name: item.reg && item.reg.icon || 'columns', size: 'lg' }))
      el.appendChild(ui.h('span', null, { text: 'Panel' }))
      return el
    }
    if (item.entry) return Demo.mount(item.entry.id)
    try {
      const defaults = item.reg && (item.reg.defaultProps || (item.reg.defaults && item.reg.defaults().props) || {})
      return ui.renderUITree({ component: item.component, props: defaults || {} }, {})
    } catch (err) {
      const el = ui.h('div', 'demo-ui-gallery-error')
      el.textContent = 'Preview unavailable'
      el.title = err && err.message || String(err)
      return el
    }
  }

  function renderCard(item, width, height) {
    const card = ui.card({ padded: false })
    card.classList.add('demo-ui-card')
    card.style.width = width + 'px'
    card.style.height = height + 'px'
    card.setAttribute('data-demo-category', item.category || '')
    card.setAttribute('data-demo-component', item.component || '')
    card.setAttribute('data-demo-id', item.entry ? item.entry.id : item.component)
    card.title = item.label + ' / ' + item.component

    const stage = ui.view({ scroll: 'hidden', className: 'demo-ui-card-stage' })
    const previewFrame = ui.h('div', 'demo-ui-card-preview')
    previewFrame.setAttribute('data-demo-category', item.category || '')
    previewFrame.setAttribute('data-demo-component', item.component || '')
    const preview = mountPreview(item)
    if (preview) previewFrame.appendChild(preview)
    const footer = ui.h('div', 'demo-ui-card-footer')
    const name = ui.h('div', 'demo-ui-card-name', { text: item.label })
    const meta = ui.h('div', 'demo-ui-card-meta', { text: item.component })
    footer.appendChild(name)
    footer.appendChild(meta)
    if (aiditor.ai && aiditor.ai.attach) {
      aiditor.ai.attach(card, function () { return itemTarget(item) }, { contextMenu: true, dragHandle: footer })
    }
    stage.appendChild(previewFrame)
    card.body.appendChild(stage)
    card.body.appendChild(footer)
    card.addEventListener('click', function () {
      if (item.entry) Demo.select(item.entry.id)
    })
    return card
  }

  function factory(propsSig, ctx) {
    const root = ui.h('div', 'demo-ui-gallery')
    const items = allItems()
    const categories = categoriesFrom(items)
    const categorySigs = {}
    const collapsedSigs = {}
    const sourceSig = aiditor.signal('all')
    const widthSig = aiditor.signal(128)
    const heightSig = aiditor.signal(150)
    const allCollapsedSig = aiditor.signal(false)

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i]
      categorySigs[cat] = aiditor.signal(cat !== 'panel')
      collapsedSigs[cat] = aiditor.signal(false)
    }

    const toolbar = ui.h('div', 'demo-ui-gallery-toolbar')
    toolbar.appendChild(ui.h('span', 'demo-ui-gallery-tool-label', { text: 'W' }))
    toolbar.appendChild(ui.numberInput({ value: widthSig, min: 88, max: 320, step: 4, precision: 0 }))
    toolbar.appendChild(ui.h('span', 'demo-ui-gallery-tool-label', { text: 'H' }))
    toolbar.appendChild(ui.numberInput({ value: heightSig, min: 96, max: 360, step: 4, precision: 0 }))
    toolbar.appendChild(ui.select({ value: sourceSig, options: SOURCE_OPTIONS, variant: 'minimal' }))
    toolbar.appendChild(ui.stateButton({
      value: allCollapsedSig,
      off: { icon: 'chevron-up', title: 'Collapse all', pressed: false },
      on: { icon: 'chevron-down', title: 'Expand all', pressed: false },
      size: 'sm',
      kind: 'ghost',
      onChange: function (next) {
        const cats = visibleCategories()
        for (let j = 0; j < cats.length; j++) collapsedSigs[cats[j]].set(next)
      },
    }))

    const categoryBar = ui.h('div', 'demo-ui-gallery-cats')
    for (let c = 0; c < categories.length; c++) {
      const cat = categories[c]
      categoryBar.appendChild(ui.checkbox({ value: categorySigs[cat], label: titleCase(cat) }))
    }
    toolbar.appendChild(categoryBar)
    root.appendChild(toolbar)

    const body = ui.view({ className: 'demo-ui-gallery-body' })
    root.appendChild(body)

    function filteredItems() {
      const source = sourceSig()
      const out = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (source !== 'all' && item.source !== source) continue
        if (!categorySigs[item.category] || !categorySigs[item.category]()) continue
        out.push(item)
      }
      return out
    }

    function visibleCategories() {
      const list = filteredItems()
      const seen = {}
      const out = []
      for (let i = 0; i < list.length; i++) {
        const cat = list[i].category
        if (!seen[cat]) {
          seen[cat] = true
          out.push(cat)
        }
      }
      return out
    }

    function render() {
      while (body.firstChild) disposeTree(body.firstChild)
      const width = Math.max(88, Number(widthSig()) || 128)
      const height = Math.max(96, Number(heightSig()) || 150)
      const list = filteredItems()
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i]
        const groupItems = list.filter(function (item) { return item.category === cat })
        if (!groupItems.length) continue
        const grid = ui.h('div', 'demo-ui-card-grid')
        for (let j = 0; j < groupItems.length; j++) grid.appendChild(renderCard(groupItems[j], width, height))
        const section = ui.section({
          title: titleCase(cat),
          meta: String(groupItems.length),
          collapsed: collapsedSigs[cat],
          className: 'demo-ui-module',
          bodyClassName: 'demo-ui-module-body',
          children: grid,
        })
        body.appendChild(section)
      }
    }

    ctx.onCleanup(aiditor.effect(render))
    ctx.onCleanup(aiditor.effect(function () {
      const cats = visibleCategories()
      let allCollapsed = cats.length > 0
      for (let i = 0; i < cats.length; i++) {
        if (!collapsedSigs[cats[i]]()) allCollapsed = false
      }
      allCollapsedSig.set(allCollapsed)
    }))
    return root
  }

  aiditor.registerComponent('ui-gallery', {
    category: 'panel',
    label: 'UI Gallery',
    icon: 'grid',
    defaults: function () { return { title: 'UI Gallery', icon: 'grid', props: {} } },
    factory: factory,
    dispose: disposeTree,
  })
})(window.aiditor = window.aiditor || {})

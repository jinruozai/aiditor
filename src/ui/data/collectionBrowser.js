// aiditor.ui.collectionBrowser — virtualized keyed icon/list collection browser.
//
// The browser owns collection presentation and interaction. Callers own the
// item model, the writable selection signal, persistence, and domain actions.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  const DEFAULT_VIEWS = [
    { id: 'icons', layout: 'grid', label: 'Icons', icon: 'grid' },
    { id: 'list', layout: 'list', label: 'List', icon: 'list' },
  ]
  let nextBrowserId = 1

  ui.collectionBrowser = function (opts) {
    const o = opts || {}
    if (typeof o.getKey !== 'function') throw new Error('ui.collectionBrowser: getKey is required')
    if (!ui.isSignal(o.selected) || typeof o.selected.set !== 'function') throw new Error('ui.collectionBrowser: selected must be a writable signal')

    const itemsSig = ui.asSig(o.items != null ? o.items : [])
    const selectedSig = o.selected
    const views = normalizeViews(o.views)
    const viewSig = o.view != null ? ui.asSig(o.view) : aiditor.signal(views[0].id)
    if (views.length > 1 && typeof viewSig.set !== 'function') throw new Error('ui.collectionBrowser: view must be writable when multiple views are enabled')
    const querySig = o.query != null ? ui.asSig(o.query) : aiditor.signal('')
    if (o.searchable !== false && typeof querySig.set !== 'function') throw new Error('ui.collectionBrowser: query must be writable when search is enabled')
    const sortOptions = normalizeSortOptions(o.sortOptions)
    const sortSig = o.sort != null ? ui.asSig(o.sort) : aiditor.signal(sortOptions.length ? { by: sortOptions[0].value, direction: 'asc' } : null)
    if (sortOptions.length && typeof sortSig.set !== 'function') throw new Error('ui.collectionBrowser: sort must be writable when sort options are enabled')
    if (sortOptions.length && typeof o.compare !== 'function') throw new Error('ui.collectionBrowser: compare is required when sortOptions are enabled')

    const getKey = o.getKey
    const getLabel = typeof o.getLabel === 'function' ? o.getLabel : defaultLabel
    const getIcon = typeof o.getIcon === 'function' ? o.getIcon : function (item) { return item && item.icon || '' }
    const getDescription = typeof o.getDescription === 'function' ? o.getDescription : function (item) { return item && item.description || '' }
    const getSearchText = typeof o.getSearchText === 'function' ? o.getSearchText : getLabel
    const browserId = 'aiditor-collection-' + nextBrowserId++

    const root = ui.h('div', 'aiditor-ui-collection-browser')
    const toolbar = ui.h('div', 'aiditor-ui-collectionbar')
    const viewport = ui.h('div', 'aiditor-ui-collection-viewport')
    const spacer = ui.h('div', 'aiditor-ui-collection-spacer')
    const windowEl = ui.h('div', 'aiditor-ui-collection-window')
    const emptyEl = ui.h('div', 'aiditor-ui-collection-empty')
    viewport.setAttribute('role', 'listbox')
    viewport.tabIndex = 0
    if (o.multi !== false) viewport.setAttribute('aria-multiselectable', 'true')
    spacer.appendChild(windowEl)
    viewport.appendChild(spacer)
    viewport.appendChild(emptyEl)
    root.appendChild(toolbar)
    root.appendChild(viewport)
    ui.collect(root, function () { ui.disposeChildren(root) })
    ui.collect(toolbar, function () { ui.disposeChildren(toolbar) })
    ui.collect(viewport, function () { ui.disposeChildren(viewport) })
    ui.collect(spacer, function () { ui.disposeChildren(spacer) })
    ui.collect(windowEl, function () { ui.disposeChildren(windowEl) })

    let leading = null
    if (typeof o.renderToolbarLeading === 'function') {
      leading = aiditor.untracked(function () {
        return aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'renderToolbarLeading' }, function () {
          return o.renderToolbarLeading({ query: readonlySignal(querySig), view: readonlySignal(viewSig), sort: readonlySignal(sortSig) })
        })
      })
      if (leading) {
        requireElement(leading, 'renderToolbarLeading')
        toolbar.appendChild(leading)
      }
    }

    let search = null
    if (o.searchable !== false) {
      search = ui.searchInput({ value: querySig, placeholder: o.placeholder || 'Search...' })
      toolbar.appendChild(search)
    }
    let viewButton = null
    if (views.length > 1) {
      viewButton = ui.iconButton({ icon: viewIcon(viewSpec(viewSig.peek(), views)), title: 'View', size: 'sm', onClick: openViewMenu })
      toolbar.appendChild(viewButton)
    }
    let sortButton = null
    if (sortOptions.length) {
      sortButton = ui.iconButton({ icon: 'arrow-up-down', title: 'Sort', size: 'sm', onClick: openSortMenu })
      toolbar.appendChild(sortButton)
    }
    toolbar.hidden = !leading && !search && !viewButton && !sortButton

    const mounted = new Map()
    let source = []
    let sourceByKey = new Map()
    let projection = []
    let projectionKeys = []
    let projectionIndex = new Map()
    let selectedSet = new Set(selectedSig.peek() || [])
    let layout = null
    let focusedKey = null
    let anchorKey = null
    let menu = null
    let paintFrame = 0
    let resizeObserver = null
    let marquee = null
    let marqueeStart = null
    let marqueePoint = null
    let marqueeBase = null
    let marqueeSnapshot = null
    let marqueeMoved = false
    let marqueePointerId = null
    let marqueeFrame = 0
    let suppressSurfaceClick = false
    let nextOptionId = 1

    const projectionSig = aiditor.derived(function () {
      const rawItems = itemsSig()
      const query = querySig()
      const sort = sortSig()
      return aiditor.untracked(function () { return projectItems(rawItems, query, sort, o, getKey, getLabel, getSearchText) })
    })
    ui.collect(root, projectionSig.dispose)
    ui.bind(root, projectionSig, function (next) {
      aiditor.untracked(function () { publishProjection(next) })
    })
    ui.bind(root, selectedSig, function (keys) {
      aiditor.untracked(function () {
        selectedSet = new Set(keys || [])
        refreshMountedState()
      })
    })
    ui.bind(root, viewSig, function (viewId) {
      aiditor.untracked(function () {
        const spec = viewSpec(viewId, views)
        if (!spec) throw new Error('ui.collectionBrowser: unknown view "' + viewId + '"')
        viewport.dataset.view = spec.id
        viewport.dataset.layout = spec.layout
        if (viewButton) replaceButtonIcon(viewButton, viewIcon(spec))
        mounted.forEach(function (state) { state.viewRaw.set(viewId) })
        measureAndPaint(true)
      })
    })

    viewport.addEventListener('scroll', schedulePaint)
    viewport.addEventListener('click', onSurfaceClick)
    viewport.addEventListener('contextmenu', onSurfaceContext)
    viewport.addEventListener('keydown', onKeyDown)
    viewport.addEventListener('pointerdown', beginMarquee)
    viewport.addEventListener('pointermove', moveMarquee)
    viewport.addEventListener('pointerup', finishMarquee)
    viewport.addEventListener('pointercancel', onPointerCancel)

    if (typeof o.onDrop === 'function') {
      ui.dropzone(viewport, {
        accept: o.dropTypes || null,
        signal: o.signal,
        maxEntries: o.maxDropEntries,
        maxDepth: o.maxDropDepth,
        canDrop: function (data, ev) { return decideDrop(data, ev, ev && ev.type === 'drop' ? 'drop' : 'hover') },
        onDrop: function (data, ev) {
          const ctx = makeDropContext(data, ev, 'drop')
          const result = aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'drop' }, function () { return o.onDrop(ctx) })
          if (result && typeof result.then === 'function') {
            result.catch(function (err) { aiditor.reportError({ scope: 'ui.collectionBrowser', action: 'drop' }, err) })
          }
        },
      })
    }

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(function () { measureAndPaint(true) })
      resizeObserver.observe(viewport)
    } else {
      window.addEventListener('resize', onWindowResize)
    }

    ui.collect(root, function () {
      closeMenu()
      cancelMarquee(null, false)
      if (paintFrame) cancelAnimationFrame(paintFrame)
      if (resizeObserver) resizeObserver.disconnect()
      else window.removeEventListener('resize', onWindowResize)
      viewport.removeEventListener('scroll', schedulePaint)
      viewport.removeEventListener('click', onSurfaceClick)
      viewport.removeEventListener('contextmenu', onSurfaceContext)
      viewport.removeEventListener('keydown', onKeyDown)
      viewport.removeEventListener('pointerdown', beginMarquee)
      viewport.removeEventListener('pointermove', moveMarquee)
      viewport.removeEventListener('pointerup', finishMarquee)
      viewport.removeEventListener('pointercancel', onPointerCancel)
      mounted.forEach(disposeMounted)
      mounted.clear()
    })

    root.__aiditorCollectionBrowser = {
      focus: function () { viewport.focus() },
      getVisibleItems: function () { return projection.slice() },
      getSelectedItems: selectedItems,
      getRenderedKeys: function () { return Array.from(mounted.keys()) },
      scrollToKey: function (key) {
        const index = projectionIndex.get(key)
        if (index == null) return false
        ensureIndexVisible(index)
        return true
      },
    }
    measureAndPaint(false)
    return root

    function publishProjection(next) {
      source = next.source
      sourceByKey = next.sourceByKey
      projection = next.items
      projectionKeys = next.keys
      projectionIndex = next.indexByKey
      if (focusedKey != null && !sourceByKey.has(focusedKey)) focusedKey = null
      if (anchorKey != null && !sourceByKey.has(anchorKey)) anchorKey = null
      commitSelection(selectedSig.peek() || [])
      emptyEl.textContent = querySig.peek() ? (o.emptySearchText || 'No matching items.') : (o.emptyText || 'No items.')
      emptyEl.hidden = projection.length > 0
      measureAndPaint(false)
    }

    function measureAndPaint(preserveAnchor) {
      if (!projection) return
      const old = layout
      const anchor = preserveAnchor && old && projection.length ? firstVisibleIndex(viewport, old) : -1
      const offset = anchor >= 0 ? viewport.scrollTop - itemPosition(anchor, old).top : 0
      layout = readLayout(viewport, viewSpec(viewSig.peek(), views), projection.length)
      if (anchor >= 0) viewport.scrollTop = Math.max(0, itemPosition(anchor, layout).top + offset)
      spacer.style.height = layout.totalHeight + 'px'
      viewport.scrollTop = Math.max(0, Math.min(layout.totalHeight - viewport.clientHeight, viewport.scrollTop))
      paint()
    }

    function schedulePaint() {
      if (paintFrame) return
      paintFrame = requestAnimationFrame(function () { paintFrame = 0; paint() })
    }

    function paint() {
      if (!layout) return
      const range = visibleRange(viewport, layout, projection.length)
      const retained = new Set()
      for (let i = range.start; i < range.end; i++) {
        const item = projection[i]
        const key = projectionKeys[i]
        let state = mounted.get(key)
        if (!state) {
          state = aiditor.untracked(function () { return createMounted(item, i, key) })
          mounted.set(key, state)
        } else {
          state.itemRaw.set(item)
          state.indexRaw.set(i)
        }
        updateMounted(state, item, i)
        retained.add(key)
      }
      mounted.forEach(function (state, key) {
        if (retained.has(key)) return
        disposeMounted(state)
        mounted.delete(key)
      })
      let cursor = windowEl.firstChild
      for (let i = range.start; i < range.end; i++) {
        const state = mounted.get(projectionKeys[i])
        if (state.el === cursor) cursor = cursor.nextSibling
        else {
          windowEl.insertBefore(state.el, cursor)
          cursor = state.el.nextSibling
        }
      }
      syncActiveDescendant()
    }

    function createMounted(item, index, key) {
      const itemRaw = aiditor.signal(item)
      const indexRaw = aiditor.signal(index)
      const selectedRaw = aiditor.signal(selectedSet.has(key))
      const focusedRaw = aiditor.signal(key === focusedKey)
      const viewRaw = aiditor.signal(viewSig.peek())
      const el = ui.h('div', 'aiditor-ui-collection-item')
      el.dataset.key = key
      el.id = browserId + '-option-' + nextOptionId++
      el.setAttribute('role', 'option')
      const ctx = Object.freeze({
        key: key,
        index: readonlySignal(indexRaw),
        selected: readonlySignal(selectedRaw),
        focused: readonlySignal(focusedRaw),
        view: readonlySignal(viewRaw),
        select: function (options) { selectIndex(indexRaw.peek(), options && options.event || options || {}) },
        activate: function (event) { activateIndex(indexRaw.peek(), event || null) },
        focus: function () { focusIndex(indexRaw.peek(), false, true) },
      })
      let content
      if (typeof o.renderItem === 'function') {
        content = aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'renderItem', key: key }, function () {
          return aiditor.untracked(function () {
            const rendered = o.renderItem(readonlySignal(itemRaw), ctx)
            requireElement(rendered, 'renderItem')
            return rendered
          })
        })
        if (!content) content = errorContent()
      } else {
        content = defaultItemContent(readonlySignal(itemRaw), readonlySignal(viewRaw), views, getLabel, getIcon, getDescription)
      }
      el.appendChild(content)
      ui.collect(el, function () { ui.dispose(content) })
      el.addEventListener('click', function (ev) { selectIndex(indexRaw.peek(), ev) })
      el.addEventListener('dblclick', function (ev) { activateIndex(indexRaw.peek(), ev) })
      el.addEventListener('contextmenu', function (ev) { openContextMenu(ev, key) })
      if (typeof o.dragData === 'function') {
        el.addEventListener('pointerdown', function (ev) {
          if (ev.button === 0 && !selectedSet.has(key) && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) selectIndex(indexRaw.peek(), ev)
        })
        ui.dragsource(el, {
          effect: o.dragEffect || 'copyMove',
          getData: function () {
            return aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'dragData', key: key }, function () {
              return o.dragData(makeItemContext(itemRaw.peek(), key, null)) || {}
            }) || {}
          },
        })
      }
      return { el: el, content: content, itemRaw: itemRaw, indexRaw: indexRaw, selectedRaw: selectedRaw, focusedRaw: focusedRaw, viewRaw: viewRaw }
    }

    function updateMounted(state, item, index) {
      const position = itemPosition(index, layout)
      state.el.style.transform = 'translate(' + position.left + 'px,' + position.top + 'px)'
      state.el.style.width = position.width + 'px'
      state.el.style.height = position.height + 'px'
      state.el.setAttribute('aria-posinset', String(index + 1))
      state.el.setAttribute('aria-setsize', String(projection.length))
      state.el.setAttribute('aria-label', String(getLabel(item, index)))
      state.selectedRaw.set(selectedSet.has(projectionKeys[index]))
      state.focusedRaw.set(projectionKeys[index] === focusedKey)
      state.el.classList.toggle('is-selected', state.selectedRaw.peek())
      state.el.classList.toggle('is-focused', state.focusedRaw.peek())
      state.el.setAttribute('aria-selected', state.selectedRaw.peek() ? 'true' : 'false')
    }

    function disposeMounted(state) { ui.dispose(state.el) }

    function refreshMountedState() {
      mounted.forEach(function (state, key) {
        const isSelected = selectedSet.has(key)
        const isFocused = key === focusedKey
        state.selectedRaw.set(isSelected)
        state.focusedRaw.set(isFocused)
        state.el.classList.toggle('is-selected', isSelected)
        state.el.classList.toggle('is-focused', isFocused)
        state.el.setAttribute('aria-selected', isSelected ? 'true' : 'false')
      })
      syncActiveDescendant()
    }

    function syncActiveDescendant() {
      const state = focusedKey == null ? null : mounted.get(focusedKey)
      if (state) viewport.setAttribute('aria-activedescendant', state.el.id)
      else viewport.removeAttribute('aria-activedescendant')
    }

    function commitSelection(keys) {
      const next = []
      const seen = new Set()
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (typeof key !== 'string' || seen.has(key) || !sourceByKey.has(key)) continue
        seen.add(key)
        next.push(key)
        if (o.multi === false) break
      }
      const current = selectedSig.peek() || []
      if (!sameArray(current, next)) selectedSig.set(next)
    }

    function selectIndex(index, ev) {
      if (index < 0 || index >= projection.length) return
      const key = projectionKeys[index]
      const current = selectedSig.peek() || []
      let next
      if (o.multi !== false && ev.shiftKey) {
        next = ev.ctrlKey || ev.metaKey ? current.slice() : []
        appendRange(next, anchorIndex(index), index)
      } else if (o.multi !== false && (ev.ctrlKey || ev.metaKey)) {
        next = current.slice()
        const at = next.indexOf(key)
        if (at >= 0) next.splice(at, 1)
        else next.push(key)
        anchorKey = key
      } else {
        next = [key]
        anchorKey = key
      }
      focusedKey = key
      commitSelection(next)
      refreshMountedState()
    }

    function focusIndex(index, extend, preserveSelection) {
      if (index < 0 || index >= projection.length) return
      const key = projectionKeys[index]
      if (extend && o.multi !== false) {
        const next = []
        appendRange(next, anchorIndex(index), index)
        commitSelection(next)
      } else if (!preserveSelection) {
        anchorKey = key
        commitSelection([key])
      }
      focusedKey = key
      ensureIndexVisible(index)
      refreshMountedState()
    }

    function anchorIndex(fallback) {
      const index = anchorKey == null ? -1 : projectionIndex.get(anchorKey)
      if (index == null || index < 0) {
        anchorKey = projectionKeys[fallback]
        return fallback
      }
      return index
    }

    function appendRange(keys, from, to) {
      const seen = new Set(keys)
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      for (let i = lo; i <= hi; i++) if (!seen.has(projectionKeys[i])) {
        seen.add(projectionKeys[i])
        keys.push(projectionKeys[i])
      }
    }

    function selectedItems() {
      const keys = selectedSig.peek() || []
      const out = []
      for (let i = 0; i < keys.length; i++) if (sourceByKey.has(keys[i])) out.push(sourceByKey.get(keys[i]))
      return out
    }

    function activateIndex(index, ev) {
      if (index < 0 || index >= projection.length || typeof o.onActivate !== 'function') return
      const item = projection[index]
      const key = projectionKeys[index]
      aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'activate', key: key }, function () {
        return o.onActivate(item, makeItemContext(item, key, ev))
      })
    }

    function makeItemContext(item, key, ev) {
      return {
        item: item || null,
        key: key || null,
        selectedKeys: (selectedSig.peek() || []).slice(),
        selectedItems: selectedItems(),
        view: viewSig.peek(),
        event: ev || null,
      }
    }

    function onSurfaceClick(ev) {
      if (suppressSurfaceClick) { suppressSurfaceClick = false; return }
      if (closestItem(ev.target, windowEl)) return
      closeMenu()
      anchorKey = null
      commitSelection([])
    }

    function onSurfaceContext(ev) {
      if (closestItem(ev.target, windowEl)) return
      openContextMenu(ev, null)
    }

    function openContextMenu(ev, key) {
      if (typeof o.contextActions !== 'function') return
      const index = key == null ? -1 : projectionIndex.get(key)
      if (index != null && index >= 0 && !selectedSet.has(key)) selectIndex(index, {})
      const item = key == null ? null : sourceByKey.get(key)
      const ctx = makeItemContext(item, key, ev)
      const actions = aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'contextActions', key: key }, function () { return o.contextActions(ctx) })
      if (!actions || (Array.isArray(actions) && !ui._actionSurface.hasMenuItems(actions, ctx))) return
      ev.preventDefault()
      closeMenu()
      menu = ui.actionMenu({
        anchor: key != null && mounted.has(key) ? mounted.get(key).el : viewport,
        point: { x: ev.clientX, y: ev.clientY },
        actions: actions,
        ctx: ctx,
        behavior: 'context',
        sourceScope: 'ui.collectionBrowser',
        onDismiss: function () { menu = null },
      })
    }

    function closeMenu() {
      const current = menu
      menu = null
      if (current && current.close) current.close()
    }

    function onKeyDown(ev) {
      if (!projection.length) return
      const ctrl = ev.ctrlKey || ev.metaKey
      if (ctrl && String(ev.key).toLowerCase() === 'a' && o.multi !== false) {
        ev.preventDefault()
        commitSelection(projectionKeys)
        return
      }
      if (ev.key === 'Escape') {
        ev.preventDefault()
        if (marqueeStart) cancelMarquee(ev, true)
        else { anchorKey = null; commitSelection([]) }
        return
      }
      let current = focusedKey == null ? -1 : projectionIndex.get(focusedKey)
      if (current == null) current = -1
      if (ev.key === 'Enter' && current >= 0) { ev.preventDefault(); activateIndex(current, ev); return }
      if (ev.key === ' ' && current >= 0) {
        ev.preventDefault()
        if (ctrl && o.multi !== false) selectIndex(current, { ctrlKey: true })
        else if (ev.shiftKey && o.multi !== false) selectIndex(current, { shiftKey: true })
        else selectIndex(current, {})
        return
      }
      const next = navigationIndex(ev.key, current, layout, projection.length)
      if (next < 0) return
      ev.preventDefault()
      focusIndex(next, !!ev.shiftKey, ctrl && !ev.shiftKey)
    }

    function ensureIndexVisible(index) {
      if (!layout) return
      const pos = itemPosition(index, layout)
      const top = viewport.scrollTop
      const bottom = top + viewport.clientHeight
      if (pos.top < top) viewport.scrollTop = pos.top
      else if (pos.top + pos.height > bottom) viewport.scrollTop = pos.top + pos.height - viewport.clientHeight
      paint()
    }

    function beginMarquee(ev) {
      if (closestItem(ev.target, windowEl) || ev.button !== 0) return
      closeMenu()
      marqueeStart = contentPoint(ev, viewport)
      marqueePoint = { x: ev.clientX, y: ev.clientY }
      marqueeBase = new Set(ev.ctrlKey || ev.metaKey ? selectedSig.peek() || [] : [])
      marqueeSnapshot = (selectedSig.peek() || []).slice()
      marqueeMoved = false
      marqueePointerId = ev.pointerId
      viewport.setPointerCapture(ev.pointerId)
      ev.preventDefault()
    }

    function moveMarquee(ev) {
      if (!marqueeStart || ev.pointerId !== marqueePointerId) return
      marqueePoint = { x: ev.clientX, y: ev.clientY }
      updateMarquee(ev)
      updateMarqueeScroll()
    }

    function updateMarquee(ev) {
      const rect = rectFromPoints(marqueeStart, contentPoint(marqueePoint, viewport))
      const threshold = readToken('--aiditor-collection-marquee-threshold', 3, viewport)
      marqueeMoved = marqueeMoved || rect.width > threshold || rect.height > threshold
      if (!marqueeMoved) return
      if (!marquee) {
        marquee = ui.h('div', 'aiditor-ui-collection-marquee')
        spacer.appendChild(marquee)
      }
      setRect(marquee, rect)
      const next = new Set(marqueeBase)
      const candidates = intersectingIndices(rect, layout, projection.length)
      for (let i = 0; i < candidates.length; i++) next.add(projectionKeys[candidates[i]])
      commitSelection(Array.from(next))
    }

    function updateMarqueeScroll() {
      if (!marqueeStart) return
      const rect = viewport.getBoundingClientRect()
      const edge = readToken('--aiditor-collection-autoscroll-edge', 32, viewport)
      const y = marqueePoint.y
      const velocity = y < rect.top + edge
        ? -Math.min(1, (rect.top + edge - y) / edge)
        : (y > rect.bottom - edge ? Math.min(1, (y - (rect.bottom - edge)) / edge) : 0)
      if (!velocity) {
        if (marqueeFrame) cancelAnimationFrame(marqueeFrame)
        marqueeFrame = 0
        return
      }
      if (marqueeFrame) return
      marqueeFrame = requestAnimationFrame(function tick() {
        marqueeFrame = 0
        if (!marqueeStart) return
        const max = Math.max(0, layout.totalHeight - viewport.clientHeight)
        const speed = readToken('--aiditor-collection-autoscroll-max', 18, viewport)
        const before = viewport.scrollTop
        viewport.scrollTop = Math.max(0, Math.min(max, before + velocity * speed))
        if (viewport.scrollTop === before) return
        paint()
        updateMarquee(null)
        updateMarqueeScroll()
      })
    }

    function finishMarquee(ev) {
      if (!marqueeStart || ev.pointerId !== marqueePointerId) return
      endMarqueeGesture(ev)
    }

    function onPointerCancel(ev) { cancelMarquee(ev, true) }

    function cancelMarquee(ev, restore) {
      if (!marqueeStart) return
      if (restore && marqueeSnapshot) commitSelection(marqueeSnapshot)
      endMarqueeGesture(ev)
    }

    function endMarqueeGesture(ev) {
      if (marqueeFrame) cancelAnimationFrame(marqueeFrame)
      marqueeFrame = 0
      if (marqueePointerId != null) viewport.releasePointerCapture(marqueePointerId)
      suppressSurfaceClick = marqueeMoved
      marqueeStart = null
      marqueePoint = null
      marqueeBase = null
      marqueeSnapshot = null
      marqueePointerId = null
      marqueeMoved = false
      if (marquee) { marquee.remove(); marquee = null }
    }

    function decideDrop(data, ev, phase) { return decideDropContext(makeDropContext(data, ev, phase)) }

    function decideDropContext(ctx) {
      if (typeof o.canDrop !== 'function') return true
      const decision = aiditor.safeCall({ scope: 'ui.collectionBrowser', action: 'canDrop' }, function () { return o.canDrop(ctx) })
      if (decision && typeof decision.then === 'function') {
        aiditor.reportError({ scope: 'ui.collectionBrowser', action: 'canDrop' }, new Error('canDrop must return a synchronous boolean'))
        return false
      }
      return decision === true
    }

    function makeDropContext(data, ev, phase) {
      const row = ev && closestItem(ev.target, windowEl)
      const key = row ? row.dataset.key : null
      const targetItem = key != null ? sourceByKey.get(key) || null : null
      return {
        data: data,
        item: targetItem,
        key: key,
        selectedKeys: (selectedSig.peek() || []).slice(),
        selectedItems: selectedItems(),
        targetItem: targetItem,
        targetKey: key,
        position: dropPosition(row, ev, layout),
        view: viewSig.peek(),
        phase: phase,
        event: ev || null,
      }
    }

    function openViewMenu() {
      ui.menu({ anchor: viewButton, side: 'bottom', align: 'end', items: views.map(function (spec) {
        return { label: (viewSig.peek() === spec.id ? '* ' : '') + spec.label, icon: spec.icon, onSelect: function () { viewSig.set(spec.id) } }
      }) })
    }

    function openSortMenu() {
      const current = sortSig.peek() || {}
      const items = sortOptions.map(function (option) {
        return { label: (current.by === option.value ? '* ' : '') + option.label, icon: option.icon, onSelect: function () { sortSig.set({ by: option.value, direction: current.direction || 'asc' }) } }
      })
      items.push({ type: 'divider' })
      items.push({ label: (current.direction !== 'desc' ? '* ' : '') + 'Ascending', onSelect: function () { sortSig.set({ by: current.by || sortOptions[0].value, direction: 'asc' }) } })
      items.push({ label: (current.direction === 'desc' ? '* ' : '') + 'Descending', onSelect: function () { sortSig.set({ by: current.by || sortOptions[0].value, direction: 'desc' }) } })
      ui.menu({ anchor: sortButton, side: 'bottom', align: 'end', items: items })
    }

    function onWindowResize() { measureAndPaint(true) }
  }

  function projectItems(rawItems, query, sort, opts, getKey, getLabel, getSearchText) {
    const source = rawItems || []
    const sourceByKey = new Map()
    const keyed = new Array(source.length)
    for (let i = 0; i < source.length; i++) {
      const key = getKey(source[i], i)
      if (typeof key !== 'string' || !key) throw new Error('ui.collectionBrowser: getKey must return a non-empty string')
      if (sourceByKey.has(key)) throw new Error('ui.collectionBrowser: duplicate key "' + key + '"')
      sourceByKey.set(key, source[i])
      keyed[i] = { item: source[i], key: key, sourceIndex: i }
    }
    const q = String(query || '').trim().toLowerCase()
    let projected = keyed
    if (q) projected = keyed.filter(function (entry) {
      if (typeof opts.filter === 'function') return !!opts.filter(entry.item, q, entry.sourceIndex)
      const raw = getSearchText(entry.item, entry.sourceIndex)
      const parts = Array.isArray(raw) ? raw : [raw]
      return parts.join(' ').toLowerCase().indexOf(q) >= 0
    })
    if (typeof opts.compare === 'function' && sort) {
      projected = projected.slice().sort(function (a, b) {
        const value = opts.compare(a.item, b.item, sort)
        if (value) return value
        return a.sourceIndex - b.sourceIndex
      })
    } else if (projected === keyed) projected = keyed.slice()
    const items = new Array(projected.length)
    const keys = new Array(projected.length)
    const indexByKey = new Map()
    for (let i = 0; i < projected.length; i++) {
      items[i] = projected[i].item
      keys[i] = projected[i].key
      indexByKey.set(projected[i].key, i)
    }
    return { source: source.slice(), sourceByKey: sourceByKey, items: items, keys: keys, indexByKey: indexByKey }
  }

  function normalizeViews(value) {
    const input = value == null ? DEFAULT_VIEWS : value
    if (!Array.isArray(input) || !input.length) throw new Error('ui.collectionBrowser: views must contain at least one view')
    const seen = new Set()
    return input.map(function (raw) {
      const spec = typeof raw === 'string'
        ? DEFAULT_VIEWS.find(function (item) { return item.id === raw })
        : raw
      if (!spec || typeof spec.id !== 'string' || !spec.id) throw new Error('ui.collectionBrowser: every view requires an id')
      if (spec.layout !== 'grid' && spec.layout !== 'list') throw new Error('ui.collectionBrowser: view layout must be "grid" or "list"')
      if (seen.has(spec.id)) throw new Error('ui.collectionBrowser: duplicate view "' + spec.id + '"')
      seen.add(spec.id)
      return { id: spec.id, layout: spec.layout, label: String(spec.label || spec.id), icon: spec.icon || (spec.layout === 'grid' ? 'grid' : 'list') }
    })
  }

  function normalizeSortOptions(value) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new Error('ui.collectionBrowser: sortOptions must be an array')
    return value.map(function (item) {
      if (!item || item.value == null) throw new Error('ui.collectionBrowser: every sort option requires a value')
      return { value: item.value, label: String(item.label || item.value), icon: item.icon || '' }
    })
  }

  function readonlySignal(source) {
    const read = function () { return source() }
    read.peek = function () { return source.peek() }
    return read
  }

  function readLayout(viewport, spec, count) {
    const width = viewport.clientWidth || viewport.getBoundingClientRect().width || 1
    const height = viewport.clientHeight || viewport.getBoundingClientRect().height || 1
    const padding = readToken('--aiditor-collection-padding', 8, viewport)
    const overscan = Math.max(0, Math.round(readToken('--aiditor-collection-overscan', 2, viewport)))
    if (spec.layout === 'list') {
      const itemHeight = readToken('--aiditor-collection-list-item-h', 28, viewport)
      const gap = readToken('--aiditor-collection-list-gap', 1, viewport)
      const totalHeight = padding * 2 + Math.max(0, count * itemHeight + Math.max(0, count - 1) * gap)
      return { kind: 'list', width: width, height: height, padding: padding, gap: gap, itemWidth: Math.max(0, width - padding * 2), itemHeight: itemHeight, columns: 1, rows: count, overscan: overscan, totalHeight: Math.max(height, totalHeight) }
    }
    const itemWidth = readToken('--aiditor-collection-grid-item-w', 96, viewport)
    const itemHeight = readToken('--aiditor-collection-grid-item-h', 92, viewport)
    const gap = readToken('--aiditor-collection-grid-gap', 8, viewport)
    const columns = Math.max(1, Math.floor((Math.max(0, width - padding * 2) + gap) / (itemWidth + gap)))
    const rows = Math.ceil(count / columns)
    const totalHeight = padding * 2 + Math.max(0, rows * itemHeight + Math.max(0, rows - 1) * gap)
    return { kind: 'grid', width: width, height: height, padding: padding, gap: gap, itemWidth: itemWidth, itemHeight: itemHeight, columns: columns, rows: rows, overscan: overscan, totalHeight: Math.max(height, totalHeight) }
  }

  function visibleRange(viewport, layout, count) {
    if (!count) return { start: 0, end: 0 }
    const step = layout.itemHeight + layout.gap
    const firstRow = Math.max(0, Math.floor((viewport.scrollTop - layout.padding) / step) - layout.overscan)
    const lastRow = Math.min(layout.rows - 1, Math.floor((viewport.scrollTop + viewport.clientHeight - layout.padding) / step) + layout.overscan)
    return { start: firstRow * layout.columns, end: Math.min(count, (lastRow + 1) * layout.columns) }
  }

  function firstVisibleIndex(viewport, layout) {
    const top = Math.max(0, viewport.scrollTop || 0)
    return Math.max(0, Math.floor((top - layout.padding) / (layout.itemHeight + layout.gap)) * layout.columns)
  }

  function itemPosition(index, layout) {
    const row = Math.floor(index / layout.columns)
    const column = index % layout.columns
    return {
      left: layout.padding + column * (layout.itemWidth + layout.gap),
      top: layout.padding + row * (layout.itemHeight + layout.gap),
      width: layout.itemWidth,
      height: layout.itemHeight,
    }
  }

  function intersectingIndices(rect, layout, count) {
    const stepX = layout.itemWidth + layout.gap
    const stepY = layout.itemHeight + layout.gap
    const firstRow = clamp(Math.floor((rect.top - layout.padding) / stepY), 0, Math.max(0, layout.rows - 1))
    const lastRow = clamp(Math.floor((rect.top + rect.height - layout.padding) / stepY), 0, Math.max(0, layout.rows - 1))
    const firstColumn = layout.kind === 'list' ? 0 : clamp(Math.floor((rect.left - layout.padding) / stepX), 0, layout.columns - 1)
    const lastColumn = layout.kind === 'list' ? 0 : clamp(Math.floor((rect.left + rect.width - layout.padding) / stepX), 0, layout.columns - 1)
    const out = []
    for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) {
      const index = row * layout.columns + column
      if (index >= count) continue
      if (intersects(rect, itemPosition(index, layout))) out.push(index)
    }
    return out
  }

  function navigationIndex(key, current, layout, count) {
    let next = -1
    if (key === 'Home') next = 0
    else if (key === 'End') next = count - 1
    else if (key === 'ArrowLeft' && layout.kind === 'grid') next = current < 0 ? 0 : current - 1
    else if (key === 'ArrowRight' && layout.kind === 'grid') next = current < 0 ? 0 : current + 1
    else if (key === 'ArrowUp') next = current < 0 ? count - 1 : current - layout.columns
    else if (key === 'ArrowDown') next = current < 0 ? 0 : current + layout.columns
    return next < 0 ? (next === -1 ? -1 : 0) : Math.min(count - 1, next)
  }

  function dropPosition(row, ev, layout) {
    if (!row) return 'surface'
    if (!layout || layout.kind === 'grid' || !ev) return 'on'
    const rect = row.getBoundingClientRect()
    const ratio = rect.height ? (ev.clientY - rect.top) / rect.height : 0.5
    return ratio < 0.25 ? 'before' : (ratio > 0.75 ? 'after' : 'on')
  }

  function defaultItemContent(itemSig, viewSig, views, getLabel, getIcon, getDescription) {
    const root = ui.h('div', 'aiditor-ui-collection-default')
    const iconSlot = ui.h('div', 'aiditor-ui-collection-default-icon')
    const text = ui.h('div', 'aiditor-ui-collection-default-text')
    const label = ui.h('div', 'aiditor-ui-collection-default-label')
    const description = ui.h('div', 'aiditor-ui-collection-default-description')
    text.appendChild(label)
    text.appendChild(description)
    root.appendChild(iconSlot)
    root.appendChild(text)
    ui.collect(root, function () { ui.disposeChildren(root) })
    ui.collect(iconSlot, function () { ui.disposeChildren(iconSlot) })
    const display = aiditor.derived(function () { return { item: itemSig(), view: viewSig() } })
    ui.collect(root, display.dispose)
    ui.bind(root, display, function (state) {
      ui.disposeChildren(iconSlot)
      const icon = getIcon(state.item)
      if (icon) iconSlot.appendChild(ui.icon({ name: icon, size: viewSpec(state.view, views).layout === 'list' ? 'sm' : 'lg' }))
      label.textContent = getLabel(state.item)
      const detail = getDescription(state.item)
      description.textContent = detail == null ? '' : String(detail)
      description.hidden = !detail
    })
    return root
  }

  function errorContent() { return ui.h('div', 'aiditor-ui-collection-render-error', { text: 'Unable to render item.' }) }
  function defaultLabel(item) { return item && item.label != null ? String(item.label) : '' }
  function requireElement(value, owner) { if (!value || value.nodeType !== 1) throw new Error('ui.collectionBrowser: ' + owner + ' must return an HTMLElement') }
  function viewSpec(id, views) { return views.find(function (item) { return item.id === id }) || null }
  function viewIcon(spec) { return spec && spec.icon || (spec && spec.layout === 'list' ? 'list' : 'grid') }
  function replaceButtonIcon(button, name) { ui.disposeChildren(button); button.appendChild(ui.icon({ name: name, size: 'sm' })) }
  function closestItem(target, owner) { const row = target && target.closest ? target.closest('.aiditor-ui-collection-item') : null; return row && row.parentNode === owner ? row : null }
  function readToken(name, fallback, root) { return ui.readNum(name, fallback, root) }
  function contentPoint(point, viewport) {
    const rect = viewport.getBoundingClientRect()
    const x = point.clientX != null ? point.clientX : point.x
    const y = point.clientY != null ? point.clientY : point.y
    return { x: x - rect.left + viewport.scrollLeft, y: y - rect.top + viewport.scrollTop }
  }
  function rectFromPoints(a, b) { return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } }
  function setRect(el, rect) { el.style.left = rect.left + 'px'; el.style.top = rect.top + 'px'; el.style.width = rect.width + 'px'; el.style.height = rect.height + 'px' }
  function intersects(a, b) { return a.left <= b.left + b.width && a.left + a.width >= b.left && a.top <= b.top + b.height && a.top + a.height >= b.top }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
  function sameArray(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true }
})(window.aiditor = window.aiditor || {})

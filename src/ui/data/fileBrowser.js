// aiditor.ui.fileBrowser — neutral current-directory file browser.
//
// The browser owns presentation and interaction only. Callers own directory
// loading, file mutations, persistence, and all project/asset semantics.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  const VIEWS = [
    { value: 'icons', label: 'Icons', icon: 'grid' },
    { value: 'list', label: 'List', icon: 'list' },
  ]
  const SORTS = [
    { value: 'name', label: 'Name' },
    { value: 'kind', label: 'Type' },
    { value: 'size', label: 'Size' },
    { value: 'mtime', label: 'Modified' },
  ]

  ui.fileBrowser = function (opts) {
    const o = opts || {}
    const entries = ui.asSig(o.entries != null ? o.entries : [])
    const path = ui.asSig(o.path != null ? o.path : '')
    const selected = ui.asSig(o.selected != null ? o.selected : [])
    const view = ui.asSig(o.view != null ? o.view : 'icons')
    const sort = ui.asSig(o.sort != null ? o.sort : { by: 'name', direction: 'asc' })
    const query = aiditor.signal('')

    requireWritePath(path, o.onPathChange, 'path/onPathChange')
    requireWritePath(selected, o.onSelect, 'selected/onSelect')
    requireWritePath(view, o.onViewChange, 'view/onViewChange')
    requireWritePath(sort, o.onSortChange, 'sort/onSortChange')

    const getKey = typeof o.getKey === 'function' ? o.getKey : defaultKey
    const getName = typeof o.getName === 'function' ? o.getName : defaultName
    const getPath = typeof o.getPath === 'function' ? o.getPath : defaultPath
    const getKind = typeof o.getKind === 'function' ? o.getKind : defaultKind
    const getSearchText = typeof o.getSearchText === 'function' ? o.getSearchText : function (entry) { return [getName(entry), getPath(entry), getKind(entry)] }

    const root = ui.h('div', 'aiditor-ui-file-browser')
    const bar = ui.h('div', 'aiditor-ui-filebar')
    const crumbs = ui.h('div', 'aiditor-ui-filecrumb')
    const search = ui.searchInput({ value: query, placeholder: o.placeholder || 'Search files...' })
    const viewBtn = ui.iconButton({ icon: 'grid', title: 'View', size: 'sm', onClick: openViewMenu })
    const sortBtn = ui.iconButton({ icon: 'arrow-up-down', title: 'Sort', size: 'sm', onClick: openSortMenu })
    const grid = ui.h('div', 'aiditor-ui-filegrid')
    grid.setAttribute('role', 'listbox')
    grid.tabIndex = 0
    if (o.multi !== false) grid.setAttribute('aria-multiselectable', 'true')
    bar.appendChild(crumbs)
    bar.appendChild(search)
    bar.appendChild(viewBtn)
    bar.appendChild(sortBtn)
    root.appendChild(bar)
    root.appendChild(grid)

    const itemMap = new Map()
    let visible = []
    let anchorKey = null
    let focusedKey = null
    let menu = null
    let marquee = null
    let marqueeStart = null
    let marqueeBase = null
    let marqueeMoved = false
    let suppressGridClick = false

    const visibleSig = aiditor.derived(function () {
      return sortEntries(filterEntries(entries(), query(), getName, getPath, getKind, getSearchText), sort(), getName, getPath, getKind, getSearchText, o)
    })
    ui.collect(root, visibleSig.dispose)
    ui.bind(root, visibleSig, reconcile)
    ui.bind(root, selected, refreshSelection)
    ui.bind(root, path, renderCrumbs)
    ui.bind(root, view, function (value) {
      const mode = value === 'list' ? 'list' : 'icons'
      grid.className = 'aiditor-ui-filegrid aiditor-ui-filegrid-' + mode
      grid.dataset.view = mode
      viewBtn.replaceChildren(ui.icon({ name: mode === 'list' ? 'list' : 'grid', size: 'sm' }))
    })

    grid.addEventListener('click', function (ev) {
      if (suppressGridClick) { suppressGridClick = false; return }
      if (closestItem(ev.target)) return
      closeMenu()
      writeSelected([], { reason: 'clear', event: ev })
      anchorKey = null
      focusedKey = null
    })
    grid.addEventListener('contextmenu', function (ev) {
      if (closestItem(ev.target)) return
      openContextMenu(ev, null)
    })
    grid.addEventListener('keydown', onKeyDown)
    grid.addEventListener('pointerdown', beginMarquee)
    grid.addEventListener('pointermove', moveMarquee)
    grid.addEventListener('pointerup', endMarquee)
    grid.addEventListener('pointercancel', endMarquee)

    if (typeof o.onDrop === 'function') {
      ui.dropzone(grid, {
        accept: o.dropTypes || null,
        signal: o.signal,
        maxEntries: o.maxDropEntries,
        maxDepth: o.maxDropDepth,
        canDrop: function (data, ev) {
          if (typeof o.canDrop !== 'function') return true
          const row = ev && closestItem(ev.target)
          const state = row && itemMap.get(row.dataset.key)
          return !!o.canDrop(dropContext(data, state ? state.entry.peek() : null))
        },
        onDrop: function (data, ev) {
          const row = closestItem(ev.target)
          const entry = row && itemMap.get(row.dataset.key)
          aiditor.safeCall({ scope: 'ui.fileBrowser', action: 'drop' }, function () {
            o.onDrop(dropContext(data, entry ? entry.entry.peek() : null), ev)
          })
        },
      })
    }

    ui.collect(root, function () {
      closeMenu()
      itemMap.forEach(disposeItem)
      itemMap.clear()
    })

    root.__aiditorFileBrowser = {
      focus: function () { grid.focus() },
      getVisibleEntries: function () { return visible.slice() },
      getSelectedEntries: selectedEntries,
    }
    return root

    function reconcile(rows) {
      visible = rows || []
      const retained = new Set()
      for (let i = 0; i < visible.length; i++) {
        const entry = visible[i]
        const key = String(getKey(entry, i))
        let state = itemMap.get(key)
        if (!state) {
          state = createItem(entry, i, key)
          itemMap.set(key, state)
        } else {
          state.entry.set(entry)
          state.index.set(i)
        }
        retained.add(key)
      }
      itemMap.forEach(function (state, key) {
        if (retained.has(key)) return
        disposeItem(state)
        itemMap.delete(key)
      })

      let cursor = grid.firstChild
      for (let i = 0; i < visible.length; i++) {
        const key = String(getKey(visible[i], i))
        const el = itemMap.get(key).el
        if (el === cursor) cursor = cursor.nextSibling
        else {
          grid.insertBefore(el, cursor)
          cursor = el.nextSibling
        }
      }
      const empty = grid.querySelector('.aiditor-ui-file-empty')
      if (!visible.length) {
        if (!empty) grid.appendChild(ui.h('div', 'aiditor-ui-file-empty', { text: query.peek() ? (o.emptySearchText || 'No matching files.') : (o.emptyText || 'No files.') }))
      } else if (empty) {
        empty.remove()
      }
      pruneSelection()
      refreshSelection()
    }

    function createItem(entry, index, key) {
      const entrySig = aiditor.signal(entry)
      const indexSig = aiditor.signal(index)
      const el = ui.h('div', 'aiditor-ui-fileitem')
      el.dataset.key = key
      el.setAttribute('role', 'option')
      const ctx = {
        entry: entrySig,
        index: indexSig,
        selected: aiditor.derived(function () { return (selected() || []).map(String).indexOf(key) >= 0 }),
        view: view,
        select: function (event) { selectEntry(entrySig.peek(), indexSig.peek(), event || {}) },
        activate: function (event) { activateEntry(entrySig.peek(), event) },
      }
      ui.collect(el, ctx.selected.dispose)
      let content = null
      if (typeof o.renderItem === 'function') {
        content = aiditor.safeCall({ scope: 'ui.fileBrowser', action: 'renderItem', key: key }, function () { return o.renderItem(entry, index, ctx) })
      }
      if (!content) content = defaultItemContent(entrySig, view, getName, getKind, o)
      el.appendChild(content)
      ui.collect(el, function () { ui.dispose(content) })
      ui.bind(el, entrySig, function (current) {
        el.dataset.kind = getKind(current) === 'directory' ? 'directory' : 'file'
        el.title = getPath(current) || getName(current)
      })
      ui.bind(el, ctx.selected, function (isSelected) {
        el.classList.toggle('is-selected', isSelected)
        el.setAttribute('aria-selected', isSelected ? 'true' : 'false')
      })
      el.addEventListener('click', function (ev) { selectEntry(entrySig.peek(), indexSig.peek(), ev) })
      el.addEventListener('dblclick', function (ev) { activateEntry(entrySig.peek(), ev) })
      el.addEventListener('contextmenu', function (ev) { openContextMenu(ev, entrySig.peek()) })
      if (typeof o.dragData === 'function') {
        ui.dragsource(el, {
          effect: o.dragEffect || 'copyMove',
          getData: function () {
            return o.dragData(itemContext(entrySig.peek(), evSelection(entrySig.peek()), null)) || {}
          },
        })
      }
      return { el: el, entry: entrySig, index: indexSig }
    }

    function disposeItem(state) { ui.dispose(state.el) }

    function selectEntry(entry, index, ev) {
      const key = String(getKey(entry, index))
      const current = (selected.peek() || []).map(String)
      let next
      if (o.multi !== false && ev.shiftKey && anchorKey != null) {
        const from = visible.findIndex(function (item, i) { return String(getKey(item, i)) === anchorKey })
        const lo = Math.min(from < 0 ? index : from, index)
        const hi = Math.max(from < 0 ? index : from, index)
        next = visible.slice(lo, hi + 1).map(function (item, i) { return String(getKey(item, lo + i)) })
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
      writeSelected(next, { reason: 'select', event: ev })
    }

    function activateEntry(entry, ev) {
      if (getKind(entry) === 'directory') {
        writeSelected([], { reason: 'navigate', event: ev })
        writePath(getPath(entry), { entry: entry, event: ev })
        return
      }
      if (typeof o.onActivate === 'function') {
        aiditor.safeCall({ scope: 'ui.fileBrowser', action: 'activate' }, function () { o.onActivate(entry, { path: path.peek(), event: ev }) })
      }
    }

    function writeSelected(keys, meta) {
      if (typeof selected.set === 'function') selected.set(keys)
      if (typeof o.onSelect === 'function') o.onSelect(entriesForKeys(keys), Object.assign({ keys: keys.slice(), path: path.peek() }, meta || {}))
    }

    function writePath(next, meta) {
      if (typeof path.set === 'function') path.set(next)
      if (typeof o.onPathChange === 'function') o.onPathChange(next, meta || {})
    }

    function writeView(next) {
      if (typeof view.set === 'function') view.set(next)
      if (typeof o.onViewChange === 'function') o.onViewChange(next)
    }

    function writeSort(next) {
      if (typeof sort.set === 'function') sort.set(next)
      if (typeof o.onSortChange === 'function') o.onSortChange(next)
    }

    function entriesForKeys(keys) {
      const wanted = new Set((keys || []).map(String))
      const source = entries.peek() || []
      return source.filter(function (entry, index) { return wanted.has(String(getKey(entry, index))) })
    }
    function selectedEntries() { return entriesForKeys(selected.peek() || []) }

    function pruneSelection() {
      const source = entries.peek() || []
      const valid = new Set(source.map(function (entry, index) { return String(getKey(entry, index)) }))
      const current = (selected.peek() || []).map(String)
      const next = current.filter(function (key) { return valid.has(key) })
      if (next.length !== current.length) writeSelected(next, { reason: 'entries-changed' })
    }

    function refreshSelection() {
      itemMap.forEach(function (state, key) {
        const isSelected = (selected.peek() || []).map(String).indexOf(key) >= 0
        state.el.classList.toggle('is-selected', isSelected)
        state.el.setAttribute('aria-selected', isSelected ? 'true' : 'false')
        state.el.classList.toggle('is-focused', key === focusedKey)
      })
    }

    function renderCrumbs(currentPath) {
      ui.disposeChildren(crumbs)
      const parsed = pathParts(currentPath)
      crumbs.appendChild(crumbButton(readValue(o.rootLabel, 'Files'), parsed.root))
      let current = parsed.root
      for (let i = 0; i < parsed.parts.length; i++) {
        current = current ? joinPath(current, parsed.parts[i]) : parsed.parts[i]
        crumbs.appendChild(ui.h('span', 'aiditor-ui-filecrumb-sep', { text: '/' }))
        crumbs.appendChild(crumbButton(parsed.parts[i], current))
      }
    }

    function crumbButton(label, targetPath) {
      const button = ui.h('button', null, { type: 'button', text: label })
      button.addEventListener('click', function () {
        writeSelected([], { reason: 'navigate' })
        writePath(targetPath, { source: 'breadcrumb' })
      })
      return button
    }

    function openViewMenu() {
      ui.menu({ anchor: viewBtn, side: 'bottom', align: 'end', items: VIEWS.map(function (item) {
        return { label: (view.peek() === item.value ? '* ' : '') + item.label, icon: item.icon, onSelect: function () { writeView(item.value) } }
      }) })
    }

    function openSortMenu() {
      const current = sort.peek() || {}
      const items = SORTS.map(function (item) {
        return { label: (current.by === item.value ? '* ' : '') + item.label, onSelect: function () { writeSort({ by: item.value, direction: current.direction || 'asc' }) } }
      })
      items.push({ type: 'divider' })
      items.push({ label: (current.direction !== 'desc' ? '* ' : '') + 'Ascending', onSelect: function () { writeSort({ by: current.by || 'name', direction: 'asc' }) } })
      items.push({ label: (current.direction === 'desc' ? '* ' : '') + 'Descending', onSelect: function () { writeSort({ by: current.by || 'name', direction: 'desc' }) } })
      ui.menu({ anchor: sortBtn, side: 'bottom', align: 'end', items: items })
    }

    function openContextMenu(ev, targetEntry) {
      if (typeof o.contextActions !== 'function') return
      if (targetEntry) {
        const key = String(getKey(targetEntry))
        const current = (selected.peek() || []).map(String)
        if (current.indexOf(key) < 0) writeSelected([key], { reason: 'context', event: ev })
      }
      const selection = evSelection(targetEntry)
      const actionCtx = itemContext(targetEntry, selection, ev)
      const actions = aiditor.safeCall({ scope: 'ui.fileBrowser', action: 'contextActions' }, function () { return o.contextActions(actionCtx) })
      if (!actions || (Array.isArray(actions) && !ui._actionSurface.hasMenuItems(actions, actionCtx))) return
      ev.preventDefault()
      closeMenu()
      menu = ui.actionMenu({
        anchor: targetEntry ? itemMap.get(String(getKey(targetEntry))).el : grid,
        point: { x: ev.clientX, y: ev.clientY },
        actions: actions,
        ctx: actionCtx,
        behavior: 'context',
        onDismiss: function () { menu = null },
      })
    }

    function closeMenu() { const current = menu; menu = null; if (current && current.close) current.close() }

    function evSelection(targetEntry) {
      const picked = selectedEntries()
      if (!targetEntry) return picked
      const key = String(getKey(targetEntry))
      for (let i = 0; i < picked.length; i++) if (String(getKey(picked[i])) === key) return picked
      return [targetEntry]
    }

    function itemContext(targetEntry, selection, ev) {
      return { entry: targetEntry, entries: selection, path: path.peek(), selectedKeys: (selected.peek() || []).slice(), event: ev || null }
    }

    function dropContext(data, targetEntry) {
      const targetPath = targetEntry && getKind(targetEntry) === 'directory' ? getPath(targetEntry) : path.peek()
      return Object.assign({}, itemContext(targetEntry, selectedEntries(), null), { data: data, targetPath: targetPath })
    }

    function onKeyDown(ev) {
      if (!visible.length) return
      const current = focusedKey == null ? -1 : visible.findIndex(function (entry, i) { return String(getKey(entry, i)) === focusedKey })
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') {
        ev.preventDefault()
        const forward = ev.key === 'ArrowDown' || ev.key === 'ArrowRight'
        const next = Math.max(0, Math.min(visible.length - 1, current < 0 ? (forward ? 0 : visible.length - 1) : current + (forward ? 1 : -1)))
        selectEntry(visible[next], next, ev)
        const state = itemMap.get(String(getKey(visible[next], next)))
        if (state && state.el.scrollIntoView) state.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        return
      }
      if (ev.key === 'Enter' && current >= 0) { ev.preventDefault(); activateEntry(visible[current], ev); return }
      if (ev.key === ' ' && current >= 0) { ev.preventDefault(); selectEntry(visible[current], current, ev); return }
      if (ev.key === 'Escape') { ev.preventDefault(); writeSelected([], { reason: 'escape', event: ev }) }
    }

    function beginMarquee(ev) {
      if (closestItem(ev.target) || ev.button !== 0) return
      closeMenu()
      marqueeStart = pointInGrid(ev, grid)
      marqueeBase = (ev.ctrlKey || ev.metaKey) ? new Set((selected.peek() || []).map(String)) : new Set()
      marqueeMoved = false
      grid.setPointerCapture(ev.pointerId)
      ev.preventDefault()
    }

    function moveMarquee(ev) {
      if (!marqueeStart) return
      const rect = rectFromPoints(marqueeStart, pointInGrid(ev, grid))
      marqueeMoved = marqueeMoved || rect.width > 3 || rect.height > 3
      if (!marqueeMoved) return
      if (!marquee) { marquee = ui.h('div', 'aiditor-ui-file-marquee'); grid.appendChild(marquee) }
      setRect(marquee, rect)
      const next = new Set(marqueeBase)
      const gridRect = grid.getBoundingClientRect()
      itemMap.forEach(function (state, key) {
        const r = state.el.getBoundingClientRect()
        if (intersects(rect, { left: r.left - gridRect.left + grid.scrollLeft, top: r.top - gridRect.top + grid.scrollTop, width: r.width, height: r.height })) next.add(key)
      })
      writeSelected(Array.from(next), { reason: 'marquee', event: ev })
    }

    function endMarquee(ev) {
      if (!marqueeStart) return
      grid.releasePointerCapture(ev.pointerId)
      suppressGridClick = marqueeMoved
      marqueeStart = null
      marqueeBase = null
      marqueeMoved = false
      if (marquee) { marquee.remove(); marquee = null }
    }

    function closestItem(target) {
      return target && target.closest ? target.closest('.aiditor-ui-fileitem') : null
    }
  }

  function defaultItemContent(entrySig, viewSig, getName, getKind, opts) {
    const wrap = ui.h('div', 'aiditor-ui-fileitem-content')
    const thumb = ui.h('div', 'aiditor-ui-filethumb')
    const name = ui.h('div', 'aiditor-ui-filename')
    const kind = ui.h('div', 'aiditor-ui-filemeta')
    const size = ui.h('div', 'aiditor-ui-filemeta')
    const date = ui.h('div', 'aiditor-ui-filemeta')
    wrap.appendChild(thumb); wrap.appendChild(name); wrap.appendChild(kind); wrap.appendChild(size); wrap.appendChild(date)
    const displaySig = aiditor.derived(function () {
      return { entry: entrySig(), view: viewSig() === 'list' ? 'list' : 'icons' }
    })
    ui.collect(wrap, displaySig.dispose)
    ui.bind(wrap, displaySig, function (state) {
      const entry = state.entry
      ui.disposeChildren(thumb)
      const thumbnail = typeof opts.getThumbnail === 'function' ? opts.getThumbnail(entry) : entry.thumbnail
      if (thumbnail) {
        const img = document.createElement('img'); img.draggable = false; img.src = thumbnail; thumb.appendChild(img)
      } else {
        const icon = typeof opts.getIcon === 'function' ? opts.getIcon(entry) : entry.icon
        thumb.appendChild(ui.icon({ name: icon || (getKind(entry) === 'directory' ? 'folder' : 'file'), size: state.view === 'list' ? 'sm' : 'lg' }))
      }
      name.textContent = getName(entry)
      kind.textContent = getKind(entry) === 'directory' ? 'Directory' : (entry.mime || 'File')
      size.textContent = getKind(entry) === 'directory' ? '' : sizeLabel(entry.size)
      date.textContent = dateLabel(entry.mtime)
    })
    return wrap
  }

  function requireWritePath(sig, callback, label) {
    if (typeof sig.set !== 'function' && typeof callback !== 'function') throw new Error('ui.fileBrowser: writable ' + label + ' is required')
  }
  function defaultKey(entry) { return entry.id != null ? entry.id : (entry.path != null ? entry.path : entry.name) }
  function defaultName(entry) { return String(entry.name != null ? entry.name : defaultKey(entry)) }
  function defaultPath(entry) { return String(entry.path != null ? entry.path : defaultKey(entry)) }
  function defaultKind(entry) { return entry.kind === 'directory' || entry.kind === 'folder' ? 'directory' : 'file' }
  function readValue(value, fallback) { return ui.isSignal(value) ? value.peek() : (value != null ? value : fallback) }

  function filterEntries(entries, query, getName, getPath, getKind, getSearchText) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return (entries || []).slice()
    return (entries || []).filter(function (entry) {
      const raw = getSearchText(entry)
      const parts = Array.isArray(raw) ? raw : [raw]
      return parts.join(' ').toLowerCase().indexOf(q) >= 0
    })
  }

  function sortEntries(entries, sort, getName, getPath, getKind, getSearchText, opts) {
    const spec = sort || { by: 'name', direction: 'asc' }
    return entries.slice().sort(function (a, b) {
      if (opts.directoriesFirst !== false) {
        const ad = getKind(a) === 'directory', bd = getKind(b) === 'directory'
        if (ad !== bd) return ad ? -1 : 1
      }
      if (typeof opts.compare === 'function') return opts.compare(a, b, spec)
      const av = sortValue(a, spec.by, getName, getPath, getKind)
      const bv = sortValue(b, spec.by, getName, getPath, getKind)
      const cmp = typeof av === 'number' || typeof bv === 'number'
        ? (Number(av) || 0) - (Number(bv) || 0)
        : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true })
      return spec.direction === 'desc' ? -cmp : cmp
    })
  }

  function sortValue(entry, by, getName, getPath, getKind) {
    if (by === 'kind') return getKind(entry)
    if (by === 'size') return entry.size
    if (by === 'mtime') return entry.mtime
    if (by === 'path') return getPath(entry)
    return getName(entry)
  }

  function pathParts(path) {
    const value = String(path || '').replace(/\\/g, '/')
    const match = /^([^/]+:\/\/)(.*)$/.exec(value)
    return { root: match ? match[1] : '', parts: (match ? match[2] : value).split('/').filter(Boolean) }
  }
  function joinPath(base, part) { return base && /:\/\/$/.test(base) ? base + part : (base ? base + '/' + part : part) }
  function sizeLabel(value) { const n = Number(value) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n ? n + ' B' : '') }
  function dateLabel(value) { return value ? new Date(value).toLocaleDateString() : '' }
  function pointInGrid(ev, grid) { const r = grid.getBoundingClientRect(); return { x: ev.clientX - r.left + grid.scrollLeft, y: ev.clientY - r.top + grid.scrollTop } }
  function rectFromPoints(a, b) { return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } }
  function setRect(el, rect) { el.style.left = rect.left + 'px'; el.style.top = rect.top + 'px'; el.style.width = rect.width + 'px'; el.style.height = rect.height + 'px' }
  function intersects(a, b) { return a.left <= b.left + b.width && a.left + a.width >= b.left && a.top <= b.top + b.height && a.top + a.height >= b.top }

  // Historical public spelling; both names intentionally share one neutral
  // contract and implementation.
  ui.assetBrowser = ui.fileBrowser
})(window.aiditor = window.aiditor || {})

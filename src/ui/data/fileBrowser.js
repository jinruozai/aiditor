// aiditor.ui.fileBrowser — file-system preset for ui.collectionBrowser.
//
// File loading, mutations, persistence, and project semantics remain caller-owned.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  const FILE_SORTS = [
    { value: 'name', label: 'Name' },
    { value: 'kind', label: 'Type' },
    { value: 'size', label: 'Size' },
    { value: 'mtime', label: 'Modified' },
  ]

  ui.fileBrowser = function (opts) {
    const o = opts || {}
    const entriesSig = ui.asSig(o.entries != null ? o.entries : [])
    const pathSig = o.path != null ? ui.asSig(o.path) : aiditor.signal('')
    const selectedSig = o.selected
    const viewSig = o.view != null ? ui.asSig(o.view) : aiditor.signal('icons')
    const sortSig = o.sort != null ? ui.asSig(o.sort) : aiditor.signal({ by: 'name', direction: 'asc' })
    if (typeof pathSig.set !== 'function') throw new Error('ui.fileBrowser: path must be a writable signal')

    const getKey = typeof o.getKey === 'function' ? o.getKey : defaultKey
    const getName = typeof o.getName === 'function' ? o.getName : defaultName
    const getPath = typeof o.getPath === 'function' ? o.getPath : defaultPath
    const getKind = typeof o.getKind === 'function' ? o.getKind : defaultKind
    const getSearchText = typeof o.getSearchText === 'function'
      ? o.getSearchText
      : function (entry) { return [getName(entry), getPath(entry), getKind(entry)] }

    const browser = ui.collectionBrowser({
      items: entriesSig,
      selected: selectedSig,
      view: viewSig,
      views: o.views,
      query: o.query,
      searchable: o.searchable,
      placeholder: o.placeholder || 'Search files...',
      sort: sortSig,
      sortOptions: o.sortOptions || FILE_SORTS,
      getKey: getKey,
      getLabel: getName,
      getSearchText: getSearchText,
      compare: compareFiles,
      renderToolbarLeading: renderBreadcrumbs,
      renderItem: typeof o.renderItem === 'function' ? renderCustomItem : renderFileItem,
      onActivate: activateFile,
      contextActions: typeof o.contextActions === 'function' ? fileContextActions : null,
      dragData: typeof o.dragData === 'function' ? fileDragData : null,
      canDrop: typeof o.canDrop === 'function' ? fileCanDrop : null,
      onDrop: typeof o.onDrop === 'function' ? fileDrop : null,
      dropTypes: o.dropTypes,
      dragEffect: o.dragEffect,
      signal: o.signal,
      maxDropEntries: o.maxDropEntries,
      maxDropDepth: o.maxDropDepth,
      multi: o.multi,
      emptyText: o.emptyText || 'No files.',
      emptySearchText: o.emptySearchText || 'No matching files.',
    })
    browser.classList.add('aiditor-ui-file-browser')
    const handle = browser.__aiditorCollectionBrowser
    browser.__aiditorFileBrowser = {
      focus: handle.focus,
      getVisibleEntries: handle.getVisibleItems,
      getSelectedEntries: handle.getSelectedItems,
      getRenderedKeys: handle.getRenderedKeys,
      scrollToPath: function (path) {
        const source = entriesSig.peek() || []
        for (let i = 0; i < source.length; i++) if (getPath(source[i], i) === path) return handle.scrollToKey(getKey(source[i], i))
        return false
      },
    }
    return browser

    function renderBreadcrumbs() {
      const crumbs = ui.h('div', 'aiditor-ui-filecrumb')
      ui.bind(crumbs, pathSig, function (currentPath) {
        ui.disposeChildren(crumbs)
        const parsed = pathParts(currentPath)
        crumbs.appendChild(crumbButton(readValue(o.rootLabel, 'Files'), parsed.root))
        let current = parsed.root
        for (let i = 0; i < parsed.parts.length; i++) {
          current = current ? joinPath(current, parsed.parts[i]) : parsed.parts[i]
          crumbs.appendChild(ui.h('span', 'aiditor-ui-filecrumb-sep', { text: '/' }))
          crumbs.appendChild(crumbButton(parsed.parts[i], current))
        }
      })
      return crumbs
    }

    function crumbButton(label, targetPath) {
      const button = ui.h('button', null, { type: 'button', text: label })
      button.addEventListener('click', function () {
        selectedSig.set([])
        pathSig.set(targetPath)
      })
      return button
    }

    function renderCustomItem(itemSignal, ctx) { return o.renderItem(itemSignal, fileRendererContext(ctx)) }

    function renderFileItem(itemSignal, ctx) {
      const wrap = ui.h('div', 'aiditor-ui-fileitem-content')
      const thumb = ui.h('div', 'aiditor-ui-filethumb')
      const name = ui.h('div', 'aiditor-ui-filename')
      const kind = ui.h('div', 'aiditor-ui-filemeta')
      const size = ui.h('div', 'aiditor-ui-filemeta')
      const date = ui.h('div', 'aiditor-ui-filemeta')
      wrap.appendChild(thumb)
      wrap.appendChild(name)
      wrap.appendChild(kind)
      wrap.appendChild(size)
      wrap.appendChild(date)
      ui.collect(wrap, function () { ui.disposeChildren(wrap) })
      ui.collect(thumb, function () { ui.disposeChildren(thumb) })
      const display = aiditor.derived(function () { return { entry: itemSignal(), view: ctx.view() } })
      ui.collect(wrap, display.dispose)
      ui.bind(wrap, display, function (state) {
        const entry = state.entry
        ui.disposeChildren(thumb)
        const thumbnail = typeof o.getThumbnail === 'function' ? o.getThumbnail(entry) : entry.thumbnail
        if (thumbnail) {
          const img = document.createElement('img')
          img.draggable = false
          img.src = thumbnail
          thumb.appendChild(img)
        } else {
          const icon = typeof o.getIcon === 'function' ? o.getIcon(entry) : entry.icon
          thumb.appendChild(ui.icon({ name: icon || (getKind(entry) === 'directory' ? 'folder' : 'file'), size: isListView(state.view, o.views) ? 'sm' : 'lg' }))
        }
        name.textContent = getName(entry)
        kind.textContent = getKind(entry) === 'directory' ? 'Directory' : (entry.mime || 'File')
        size.textContent = getKind(entry) === 'directory' ? '' : sizeLabel(entry.size)
        date.textContent = dateLabel(entry.mtime)
      })
      return wrap
    }

    function activateFile(entry, ctx) {
      if (getKind(entry) === 'directory') {
        selectedSig.set([])
        pathSig.set(getPath(entry))
        return
      }
      if (typeof o.onActivate === 'function') return o.onActivate(entry, { path: pathSig.peek(), event: ctx.event })
    }

    function fileContextActions(ctx) { return o.contextActions(fileActionContext(ctx)) }
    function fileDragData(ctx) { return o.dragData(fileActionContext(ctx)) }
    function fileCanDrop(ctx) { return o.canDrop(fileDropContext(ctx)) }
    function fileDrop(ctx) { return o.onDrop(fileDropContext(ctx)) }

    function fileRendererContext(ctx) {
      return Object.freeze({
        key: ctx.key,
        index: ctx.index,
        selected: ctx.selected,
        focused: ctx.focused,
        view: ctx.view,
        select: ctx.select,
        activate: ctx.activate,
        focus: ctx.focus,
        path: readonlySignal(pathSig),
      })
    }

    function fileActionContext(ctx) {
      return {
        entry: ctx.item,
        key: ctx.key,
        selectedKeys: ctx.selectedKeys,
        selectedEntries: ctx.selectedItems,
        path: pathSig.peek(),
        view: ctx.view,
        event: ctx.event,
      }
    }

    function fileDropContext(ctx) {
      const base = fileActionContext(ctx)
      base.data = ctx.data
      base.targetEntry = ctx.targetItem
      base.targetKey = ctx.targetKey
      base.targetPath = ctx.targetItem && getKind(ctx.targetItem) === 'directory' ? getPath(ctx.targetItem) : pathSig.peek()
      base.position = ctx.position
      base.phase = ctx.phase
      return base
    }

    function compareFiles(a, b, spec) {
      if (o.directoriesFirst !== false) {
        const ad = getKind(a) === 'directory'
        const bd = getKind(b) === 'directory'
        if (ad !== bd) return ad ? -1 : 1
      }
      if (typeof o.compare === 'function') return o.compare(a, b, spec)
      const av = sortValue(a, spec && spec.by)
      const bv = sortValue(b, spec && spec.by)
      const value = typeof av === 'number' || typeof bv === 'number'
        ? (Number(av) || 0) - (Number(bv) || 0)
        : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true })
      return spec && spec.direction === 'desc' ? -value : value
    }

    function sortValue(entry, by) {
      if (by === 'kind') return getKind(entry)
      if (by === 'size') return entry.size
      if (by === 'mtime') return entry.mtime
      if (by === 'path') return getPath(entry)
      return getName(entry)
    }
  }

  function readonlySignal(source) {
    const read = function () { return source() }
    read.peek = function () { return source.peek() }
    return read
  }
  function isListView(id, views) {
    if (!Array.isArray(views)) return id === 'list'
    const spec = views.find(function (view) { return typeof view === 'string' ? view === id : view && view.id === id })
    return typeof spec === 'string' ? spec === 'list' : !!(spec && spec.layout === 'list')
  }
  function defaultKey(entry) { return String(entry.id != null ? entry.id : (entry.path != null ? entry.path : entry.name)) }
  function defaultName(entry) { return String(entry.name != null ? entry.name : defaultKey(entry)) }
  function defaultPath(entry) { return String(entry.path != null ? entry.path : defaultKey(entry)) }
  function defaultKind(entry) { return entry.kind === 'directory' || entry.kind === 'folder' ? 'directory' : 'file' }
  function readValue(value, fallback) { return ui.isSignal(value) ? value.peek() : (value != null ? value : fallback) }
  function pathParts(path) {
    const value = String(path || '').replace(/\\/g, '/')
    const match = /^([^/]+:\/\/)(.*)$/.exec(value)
    return { root: match ? match[1] : '', parts: (match ? match[2] : value).split('/').filter(Boolean) }
  }
  function joinPath(base, part) { return base && /:\/\/$/.test(base) ? base + part : (base ? base + '/' + part : part) }
  function sizeLabel(value) { const n = Number(value) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : (n ? n + ' B' : '') }
  function dateLabel(value) { return value ? new Date(value).toLocaleDateString() : '' }
})(window.aiditor = window.aiditor || {})

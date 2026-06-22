// aiditor.ui.quickPick — anchored quick filter picker for opaque item lists.
//
// This is the single "search a bounded collection and pick one item" primitive.
// Menus stay action-oriented; select/combobox stay form-oriented.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  let nextId = 1

  ui.quickPick = function (opts) {
    const o = opts || {}
    const id = 'aiditor-quick-pick-' + (nextId++)
    const query = aiditor.signal('')
    const itemsSig = ui.asSig(o.items || [])
    const selectedSig = ui.asSig(o.selectedKey != null ? o.selectedKey : null)
    const root = ui.h('div', 'aiditor-ui-quick-pick')
    const input = ui.searchInput({
      value: query,
      placeholder: o.placeholder || 'Search...',
      onChange: function (v) {
        query.set(v)
        render('query')
      },
    })
    const list = ui.h('div', 'aiditor-ui-quick-pick-list', {
      id: id + '-list',
      role: 'listbox',
    })
    input.classList.add('aiditor-ui-quick-pick-input')
    root.appendChild(input)
    root.appendChild(list)

    const inputEl = input.querySelector('input')
    if (inputEl) {
      inputEl.setAttribute('role', 'combobox')
      inputEl.setAttribute('aria-expanded', 'true')
      inputEl.setAttribute('aria-controls', id + '-list')
      inputEl.setAttribute('aria-autocomplete', 'list')
    }

    const rows = new Map()
    let groupEls = []
    let activeKey = null
    let activeIndex = 0
    let visible = []
    let pop = null
    let closed = false
    let anchor = o.anchor
    let tempAnchor = null

    if (!anchor && o.pos) {
      tempAnchor = ui.h('div', null, {
        style: 'position:fixed;width:0;height:0;left:' + (o.pos.x || 0) + 'px;top:' + (o.pos.y || 0) + 'px;pointer-events:none;',
      })
      document.body.appendChild(tempAnchor)
      anchor = tempAnchor
    }

    function close() {
      if (pop) pop.close()
    }

    function cleanupAnchor() {
      closed = true
      if (tempAnchor && tempAnchor.parentNode) tempAnchor.parentNode.removeChild(tempAnchor)
      tempAnchor = null
      pop = null
    }

    function source(action, key) {
      return { scope: 'ui.quickPick', action: action, key: key || '' }
    }

    function safe(action, key, fn) {
      if (aiditor.safeCall) return aiditor.safeCall(source(action, key), fn)
      return fn()
    }

    function watchAsync(result, key) {
      if (!result || typeof result.then !== 'function') return
      result.catch(function (err) {
        if (aiditor.reportError) aiditor.reportError(source('select', key), err)
      })
    }

    function keyOf(item, index) {
      if (typeof o.getKey === 'function') return String(o.getKey(item, index))
      const v = item && (item.id != null ? item.id : item.key != null ? item.key : item.value)
      return String(v != null ? v : index)
    }

    function labelOf(item, index) {
      const v = typeof o.getLabel === 'function'
        ? o.getLabel(item, index)
        : item && (item.label != null ? item.label : item.title != null ? item.title : item.name != null ? item.name : item.value)
      return v == null ? '' : String(v)
    }

    function maybeString(fn, prop, item, index) {
      const v = typeof fn === 'function' ? fn(item, index) : item && item[prop]
      return v == null ? '' : String(v)
    }

    function groupOf(item, index) {
      const v = typeof o.getGroup === 'function' ? o.getGroup(item, index) : item && item.group
      return v == null ? '' : String(v)
    }

    function iconOf(item, index) {
      const v = typeof o.getIcon === 'function' ? o.getIcon(item, index) : item && item.icon
      return v == null ? '' : String(v)
    }

    function disabledOf(item, index) {
      return !!(typeof o.getDisabled === 'function' ? o.getDisabled(item, index) : item && item.disabled)
    }

    function textParts(v) {
      if (Array.isArray(v)) return v.filter(function (part) { return part != null }).map(String).join(' ')
      return v == null ? '' : String(v)
    }

    function searchText(item, index, label, description, detail, group) {
      if (typeof o.getSearchText === 'function') return textParts(o.getSearchText(item, index))
      return [label, description, detail, group].filter(Boolean).join(' ')
    }

    function records() {
      const arr = itemsSig.peek() || []
      const q = String(query.peek() || '').trim().toLowerCase()
      const out = []
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        const label = labelOf(item, i)
        const description = maybeString(o.getDescription, 'description', item, i) || maybeString(null, 'meta', item, i)
        const detail = maybeString(o.getDetail, 'detail', item, i) || maybeString(null, 'subLabel', item, i)
        const group = groupOf(item, i)
        const search = searchText(item, i, label, description, detail, group).toLowerCase()
        if (q && search.indexOf(q) < 0) continue
        out.push({
          item: item,
          index: i,
          key: keyOf(item, i),
          label: label,
          description: description,
          detail: detail,
          icon: iconOf(item, i),
          group: group,
          disabled: disabledOf(item, i),
        })
      }
      return out
    }

    function readOnly(sig) {
      const fn = function () { return sig.peek() }
      fn.peek = function () { return sig.peek() }
      return fn
    }

    function createRow(key) {
      const state = {
        key: key,
        id: id + '-option-' + (rows.size + 1),
        active: aiditor.signal(false),
        selected: aiditor.signal(false),
        disabled: aiditor.signal(false),
      }
      const el = ui.h('div', 'aiditor-ui-quick-pick-row', {
        id: state.id,
        role: 'option',
      })
      const content = ui.h('div', 'aiditor-ui-quick-pick-row-content')
      el.appendChild(content)
      state.el = el
      state.content = content
      el.addEventListener('mouseenter', function () {
        if (!state.disabled.peek()) setActive(state.key)
      })
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault()
      })
      el.addEventListener('click', function () {
        if (!state.disabled.peek()) choose(state.key)
      })
      ui.collect(el, aiditor.effect(function () {
        const v = state.active()
        el.classList.toggle('aiditor-ui-quick-pick-row-active', v)
        if (v && inputEl) inputEl.setAttribute('aria-activedescendant', state.id)
      }))
      ui.collect(el, aiditor.effect(function () {
        const v = state.selected()
        el.classList.toggle('aiditor-ui-quick-pick-row-selected', v)
        el.setAttribute('aria-selected', v ? 'true' : 'false')
      }))
      ui.collect(el, aiditor.effect(function () {
        const v = state.disabled()
        el.classList.toggle('aiditor-ui-quick-pick-row-disabled', v)
        if (v) el.setAttribute('aria-disabled', 'true')
        else el.removeAttribute('aria-disabled')
      }))
      return state
    }

    function defaultContent(rec) {
      const frag = ui.h('div', 'aiditor-ui-quick-pick-default')
      if (rec.icon) frag.appendChild(ui.icon({ name: rec.icon, size: 'sm' }))
      const text = ui.h('span', 'aiditor-ui-quick-pick-text')
      const main = ui.h('span', 'aiditor-ui-quick-pick-main')
      main.appendChild(ui.h('span', 'aiditor-ui-quick-pick-label', { text: rec.label }))
      if (rec.description) main.appendChild(ui.h('span', 'aiditor-ui-quick-pick-description', { text: rec.description }))
      text.appendChild(main)
      if (rec.detail) text.appendChild(ui.h('span', 'aiditor-ui-quick-pick-detail', { text: rec.detail }))
      frag.appendChild(text)
      return frag
    }

    function paintContent(state, rec) {
      ui.disposeChildren(state.content)
      const ctx = {
        key: rec.key,
        label: rec.label,
        description: rec.description,
        detail: rec.detail,
        icon: rec.icon,
        group: rec.group,
        index: rec.index,
        query: String(query.peek() || ''),
        active: readOnly(state.active),
        selected: readOnly(state.selected),
        disabled: readOnly(state.disabled),
      }
      const content = typeof o.renderItem === 'function'
        ? safe('renderItem', rec.key, function () { return o.renderItem(rec.item, ctx) })
        : defaultContent(rec)
      if (content instanceof HTMLElement) state.content.appendChild(content)
      else if (content != null) state.content.appendChild(ui.h('span', null, { text: String(content) }))
    }

    function updateRow(state, rec) {
      state.item = rec.item
      state.index = rec.index
      state.label = rec.label
      state.disabled.set(!!rec.disabled)
      state.selected.set(String(selectedSig.peek()) === rec.key)
      state.el.setAttribute('aria-label', [rec.label, rec.description, rec.detail].filter(Boolean).join(' '))
      paintContent(state, rec)
    }

    function setActive(key) {
      activeKey = key
      for (let i = 0; i < visible.length; i++) {
        if (visible[i].key === key) {
          activeIndex = i
          break
        }
      }
      paintState()
    }

    function nextEnabled(start, dir) {
      if (!visible.length) return -1
      let i = start
      while (i >= 0 && i < visible.length) {
        if (!visible[i].disabled) return i
        i += dir
      }
      return -1
    }

    function chooseActive(mode) {
      if (!visible.length) return
      const at = activeIndex >= 0 ? activeIndex : 0
      const idx = mode === 'prev'
        ? nextEnabled(at - 1, -1)
        : nextEnabled(at + 1, 1)
      if (idx >= 0) {
        activeKey = visible[idx].key
        activeIndex = idx
        paintState()
      }
    }

    function choose(key) {
      const rec = visible.find(function (item) { return item.key === key })
      if (!rec || rec.disabled) return
      close()
      if (typeof o.onSelect === 'function') {
        const result = safe('select', rec.key, function () {
          return o.onSelect(rec.item, {
            key: rec.key,
            label: rec.label,
            group: rec.group,
            index: rec.index,
            query: String(query.peek() || ''),
          })
        })
        watchAsync(result, rec.key)
      }
    }

    function paintState() {
      let activeId = ''
      rows.forEach(function (state) {
        const isActive = state.key === activeKey && !state.disabled.peek()
        state.active.set(isActive)
        if (isActive) activeId = state.id
        state.selected.set(String(selectedSig.peek()) === state.key)
      })
      if (inputEl) {
        if (activeId) inputEl.setAttribute('aria-activedescendant', activeId)
        else inputEl.removeAttribute('aria-activedescendant')
      }
      const state = rows.get(activeKey)
      if (state && !state.disabled.peek() && state.el.scrollIntoView) state.el.scrollIntoView({ block: 'nearest' })
    }

    function settleActive(mode) {
      if (mode === 'query') {
        activeKey = null
        activeIndex = 0
      }
      let idx = -1
      if (activeKey != null) {
        for (let i = 0; i < visible.length; i++) {
          if (visible[i].key === activeKey && !visible[i].disabled) {
            idx = i
            break
          }
        }
      }
      if (idx < 0) {
        idx = nextEnabled(Math.max(0, Math.min(activeIndex, visible.length - 1)), 1)
        if (idx < 0) idx = nextEnabled(0, 1)
      }
      if (idx >= 0) {
        activeIndex = idx
        activeKey = visible[idx].key
      } else {
        activeIndex = -1
        activeKey = null
      }
    }

    function clearGroups() {
      for (let i = 0; i < groupEls.length; i++) ui.dispose(groupEls[i])
      groupEls = []
    }

    function render(mode) {
      if (closed) return
      clearGroups()
      visible = records()
      const want = new Set(visible.map(function (rec) { return rec.key }))
      rows.forEach(function (state, key) {
        if (!want.has(key)) {
          ui.dispose(state.el)
          rows.delete(key)
        }
      })
      if (!visible.length) {
        const empty = ui.h('div', 'aiditor-ui-menu-empty aiditor-ui-quick-pick-empty', {
          text: o.emptyText || 'No matches',
        })
        list.appendChild(empty)
        groupEls.push(empty)
        activeKey = null
        activeIndex = -1
        paintState()
        return
      }
      let lastGroup = null
      for (let i = 0; i < visible.length; i++) {
        const rec = visible[i]
        if (rec.group && rec.group !== lastGroup) {
          lastGroup = rec.group
          const group = ui.h('div', 'aiditor-ui-menu-header aiditor-ui-quick-pick-group', { text: rec.group })
          list.appendChild(group)
          groupEls.push(group)
        }
        let state = rows.get(rec.key)
        if (!state) {
          state = createRow(rec.key)
          rows.set(rec.key, state)
        }
        updateRow(state, rec)
        list.appendChild(state.el)
      }
      settleActive(mode)
      paintState()
    }

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault()
        chooseActive('next')
        return
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault()
        chooseActive('prev')
        return
      }
      if (ev.key === 'Enter') {
        ev.preventDefault()
        if (activeKey != null) choose(activeKey)
        return
      }
      if (ev.key === 'Escape') {
        ev.preventDefault()
        close()
      }
    })

    ui.collect(root, function () {
      rows.forEach(function (state) { ui.dispose(state.el) })
      rows.clear()
      clearGroups()
    })
    ui.bind(root, itemsSig, function () { render('items') })
    ui.bind(root, selectedSig, paintState)

    const r = anchor.getBoundingClientRect()
    root.style.width = (o.width || Math.max(260, Math.min(460, r.width || 320))) + 'px'
    list.style.maxHeight = (o.maxHeight || 360) + 'px'
    render('open')
    pop = ui.popover({
      anchor: anchor,
      content: root,
      side: o.side || 'bottom',
      align: o.align || 'start',
      role: 'dialog',
      onDismiss: cleanupAnchor,
    })
    setTimeout(function () {
      if (inputEl) {
        inputEl.focus()
        inputEl.select()
      }
    }, 0)
    return {
      el: pop.el,
      close: close,
    }
  }
})(window.aiditor = window.aiditor || {})

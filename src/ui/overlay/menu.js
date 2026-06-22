// aiditor.ui.menu — context / dropdown menu.
//
// This is just a normal UI component; the framework does NOT bind global menu
// hotkeys or right-click handlers. Callers wire it up: pointerdown / Ctrl+K /
// button click → call aiditor.ui.menu({ ... }) to open it.
//
// opts:
//   anchor   : HTMLElement                    required (popover anchor)
//   items    : MenuItem[]
//                MenuItem = { label, icon?, kbd?, onSelect?, disabled?, danger? }
//                         | { type: 'divider' }
//                         | { type: 'header', label }
//                         | { label, items: MenuItem[] }    nested submenu
//   side?, align?
//   behavior?: 'dropdown' | 'context'
//   onDismiss?
//
// Returns a popover handle.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // Build a menu element. Submenus are absolute descendants of the parent
  // menu, not independent popovers. That keeps the whole menu tree in one
  // overlay frame, so outside-click sees parent + children as one menu.
  function placeSubmenu(row, subList) {
    const pad = 8
    const gap = 2
    const r = row.getBoundingClientRect()
    const s = subList.getBoundingClientRect()
    let left = row.offsetLeft + row.offsetWidth + gap
    let top = row.offsetTop
    if (r.right + gap + s.width > window.innerWidth - pad) left = row.offsetLeft - s.width - gap
    if (r.top + s.height > window.innerHeight - pad) top -= r.top + s.height - (window.innerHeight - pad)
    if (r.top + top - row.offsetTop < pad) top += pad - (r.top + top - row.offsetTop)
    subList.style.left = left + 'px'
    subList.style.top = top + 'px'
  }

  function buildMenu(items, onSelect) {
    const list = ui.h('div', 'aiditor-ui-menu')
    const openSubs = []  // { row, list }
    function closeSubs() {
      while (openSubs.length) {
        const sub = openSubs.pop()
        sub.row.removeAttribute('data-open')
        sub.row.setAttribute('aria-expanded', 'false')
        sub.list.closeSubs()
        if (sub.list.parentNode) sub.list.parentNode.removeChild(sub.list)
      }
    }
    list.closeSubs = closeSubs

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type === 'divider') {
        list.appendChild(ui.h('div', 'aiditor-ui-menu-divider'))
        continue
      }
      if (it.type === 'header') {
        list.appendChild(ui.h('div', 'aiditor-ui-menu-header', { text: it.label }))
        continue
      }
      const row = ui.h('button', 'aiditor-ui-menu-item' +
        (it.disabled ? ' aiditor-ui-menu-item-disabled' : '') +
        (it.danger || it.variant === 'danger' ? ' aiditor-ui-menu-item-danger' : ''),
        { type: 'button' })
      // ui.icon resolves `name` against the registered icon set (rendering
      // an SVG); unknown names fall back to text. Passing the consumer's
      // string as `name` keeps "icon: 'copy'" working as a real icon.
      if (it.icon) row.appendChild(ui.icon({ name: it.icon, size: 'sm' }))
      row.appendChild(ui.h('span', 'aiditor-ui-menu-item-label', { text: it.label || '' }))
      if (it.kbd) {
        const k = ui.kbd(it.kbd); k.classList.add('aiditor-ui-menu-item-kbd'); row.appendChild(k)
      }

      if (it.items && it.items.length) {
        row.classList.add('aiditor-ui-menu-item-submenu')
        row.setAttribute('aria-haspopup', 'menu')
        row.setAttribute('aria-expanded', 'false')
        row.appendChild(ui.h('span', 'aiditor-ui-menu-item-sub', { text: '▸' }))
        function openSub() {
          if (it.disabled) return
          if (openSubs.length && openSubs[openSubs.length - 1].row === row) return
          closeSubs()
          const subList = buildMenu(it.items, onSelect)
          subList.classList.add('aiditor-ui-menu-submenu')
          list.appendChild(subList)
          subList.style.display = 'flex'
          placeSubmenu(row, subList)
          row.setAttribute('data-open', 'true')
          row.setAttribute('aria-expanded', 'true')
          openSubs.push({ row: row, list: subList })
        }
        row.addEventListener('pointerenter', openSub)
        row.addEventListener('mouseenter', openSub)
        row.addEventListener('focus', openSub)
        row.addEventListener('click', function (ev) {
          ev.preventDefault()
          ev.stopPropagation()
          openSub()
        })
      } else {
        row.addEventListener('pointerenter', closeSubs)
        row.addEventListener('mouseenter', closeSubs)
        row.addEventListener('click', function () {
          if (it.disabled) return
          onSelect && onSelect()
          if (it.onSelect) it.onSelect()
        })
      }
      list.appendChild(row)
    }
    return list
  }

  ui.menu = function (opts) {
    const o = opts || {}
    let pop = null
    function closeAll() { if (pop) { pop.close(); pop = null } }
    const list = buildMenu(o.items || [], closeAll)
    const anchor = o.point ? pointAnchor(o.anchor, o.point, o.behavior !== 'context') : o.anchor
    pop = ui.popover({
      anchor:  anchor,
      content: list,
      side:    o.side  || 'bottom',
      align:   o.align || 'start',
      role:    'menu',
      // Outside-click / ESC / explicit close all route through here → walk
      // the open-submenu chain and dismiss top-down. Without this, a portal
      // sub-popover survives its parent and becomes an orphan overlay.
      onDismiss: function () {
        list.closeSubs()
        if (o.onDismiss) o.onDismiss()
      },
    })
    return pop
  }

  function pointAnchor(owner, point, keepOwnerAsAnchor) {
    const x = Number(point && point.x || 0)
    const y = Number(point && point.y || 0)
    return {
      parentNode: owner || null,
      getBoundingClientRect: function () {
        return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 }
      },
      contains: function (target) {
        return !!(keepOwnerAsAnchor && owner && owner.contains && owner.contains(target))
      },
    }
  }
})(window.aiditor = window.aiditor || {})

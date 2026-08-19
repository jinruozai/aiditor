// CSV enum projection preserving per-option colors.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv

  function color(value) {
    value = String(value || '')
    if (/^#[0-9a-f]{8}$/i.test(value)) return '#' + value.slice(3) + value.slice(1, 3)
    if (/^#[0-9a-f]{4}$/i.test(value)) return '#' + value.slice(2) + value.slice(1, 2)
    return value
  }

  function optionsFor(field) {
    const source = field.type_agv && field.type_agv.options || []
    if (Array.isArray(source)) return source.map(function (option) {
      if (option && typeof option === 'object') return { value: option.value, label: option.label != null ? String(option.label) : String(option.value), color: color(option.color) }
      return { value: option, label: String(option), color: '' }
    })
    return Object.keys(source).map(function (value) {
      const item = source[value]
      if (item && typeof item === 'object') return { value: value, label: String(item.label != null ? item.label : value), color: color(item.color) }
      const parts = String(item).split(':')
      return { value: value, label: parts[0] || value, color: color(parts[1]) }
    })
  }

  function render(options) {
    const items = optionsFor(options.field)
    const root = ui.h('button', 'aiditor-ui-select aiditor-csv-enum', { type: 'button', 'aria-haspopup': 'listbox' })
    const label = ui.h('span', 'aiditor-ui-select-label')
    const arrow = ui.icon({ name: 'chevron-down', size: 'sm' })
    arrow.classList.add('aiditor-ui-select-arrow')
    root.appendChild(label)
    root.appendChild(arrow)
    ui.collect(root, function () { ui.dispose(arrow) })
    let pop = null

    function selected() {
      const value = options.value.peek()
      for (let i = 0; i < items.length; i++) if (String(items[i].value) === String(value)) return items[i]
      return null
    }
    function repaint() {
      const item = selected()
      label.textContent = item ? item.label : String(options.getRaw() || '')
      label.style.color = item && item.color || ''
      label.style.fontWeight = item && item.color ? '600' : ''
      root.classList.toggle('aiditor-csv-enum-unknown', !item && !!options.getRaw())
    }
    function close() { if (pop) { pop.close(); pop = null } }
    function open() {
      const menu = ui.h('div', 'aiditor-ui-menu aiditor-csv-enum-menu', { role: 'listbox' })
      const current = selected()
      items.forEach(function (item) {
        const active = current && String(current.value) === String(item.value)
        const row = ui.h('button', 'aiditor-ui-menu-item' + (active ? ' aiditor-ui-menu-item-active' : ''), { type: 'button', role: 'option', 'aria-selected': active ? 'true' : 'false' })
        const swatch = ui.h('span', 'aiditor-csv-enum-swatch')
        const text = ui.h('span', 'aiditor-ui-menu-item-label', { text: item.label })
        swatch.style.backgroundColor = item.color || 'currentColor'
        text.style.color = item.color || ''
        text.style.fontWeight = item.color ? '600' : ''
        row.appendChild(swatch)
        row.appendChild(text)
        row.addEventListener('click', function () {
          const value = options.field.base_type === 'int' ? Number(item.value) : item.value
          options.write(value)
          close()
        })
        menu.appendChild(row)
      })
      pop = ui.popover({ anchor: root, content: menu, side: 'bottom', align: 'start', onDismiss: function () { pop = null } })
    }

    ui.bind(root, options.value, repaint)
    if (options.raw) ui.bind(root, options.raw, repaint)
    root.addEventListener('click', function () { if (pop) close(); else open() })
    root.addEventListener('keydown', function (event) {
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !pop) { event.preventDefault(); open() }
    })
    ui.collect(root, close)
    return root
  }

  csv.enum = { render: render }
})(window.aiditor = window.aiditor || {})

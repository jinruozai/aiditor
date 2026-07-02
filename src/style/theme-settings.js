// Theme settings contribution for AIditor.
;(function (aiditor) {
  'use strict'

  if (!aiditor.settings) return

  aiditor.settings.registerSection('theme', {
    title: 'Theme',
    icon: 'palette',
    description: 'AIditor appearance and visual density.',
    order: 10,
  })

  aiditor.settings.registerSchema('theme', [
    {
      key: 'theme.mode',
      label: 'Mode',
      type: 'select',
      default: 'dark',
      options: aiditor.theme.modeOptions,
      description: 'Active AIditor theme.',
      order: 10,
    },
    {
      key: 'theme.density',
      label: 'Density',
      type: 'select',
      default: 'default',
      options: [
        { value: 'compact', label: 'Compact' },
        { value: 'default', label: 'Default' },
        { value: 'comfortable', label: 'Comfortable' },
      ],
      description: 'Typography density and default UI text scale.',
      order: 20,
    },
  ])

  aiditor.settings.registerPage('theme-editor', {
    section: 'theme',
    title: 'Appearance',
    icon: 'sliders',
    order: 0,
    replacesSchema: true,
    factory: renderThemeSettings,
  })

  const THEME_STORAGE_KEY = 'aiditor-theme-overrides-v3'
  const THEME_MODE_KEY = 'aiditor-theme-mode'
  const THEME_DENSITY_KEY = 'aiditor-theme-density'
  const THEME_TABS = [
    { value: 'palette', label: 'Palette' },
    { value: 'spacing', label: 'Spacing' },
    { value: 'sizing', label: 'Sizing' },
    { value: 'radius', label: 'Radius' },
    { value: 'typography', label: 'Typography' },
    { value: 'motion', label: 'Motion' },
  ]
  const PALETTE = [
    ['--aiditor-surface-canvas', 'Surface / Canvas'],
    ['--aiditor-surface-lower', 'Surface / Lower'],
    ['--aiditor-surface-frame', 'Surface / Frame'],
    ['--aiditor-surface-panel', 'Surface / Panel'],
    ['--aiditor-surface-field', 'Surface / Field'],
    ['--aiditor-surface-hover', 'Surface / Hover'],
    ['--aiditor-surface-active', 'Surface / Active'],
    ['--aiditor-surface-raised', 'Surface / Raised'],
    ['--aiditor-text-primary', 'Text / Primary'],
    ['--aiditor-text-body', 'Text / Body'],
    ['--aiditor-text-label', 'Text / Label'],
    ['--aiditor-text-muted', 'Text / Muted'],
    ['--aiditor-text-disabled', 'Text / Disabled'],
    ['--aiditor-stroke-subtle', 'Stroke / Subtle'],
    ['--aiditor-stroke-strong', 'Stroke / Strong'],
    ['--aiditor-stroke-field', 'Stroke / Field'],
    ['--aiditor-stroke-hover', 'Stroke / Hover'],
    ['--aiditor-brand', 'Brand / Accent'],
    ['--aiditor-brand-hover', 'Brand / Hover'],
    ['--aiditor-brand-contrast', 'Brand / Contrast'],
    ['--aiditor-state-success', 'State / Success'],
    ['--aiditor-state-warning', 'State / Warning'],
    ['--aiditor-state-danger', 'State / Danger'],
    ['--aiditor-state-info', 'State / Info'],
  ]
  const SPACING = [
    ['--aiditor-space-1', 'Tight gap', 0, 32],
    ['--aiditor-space-2', 'Control gap', 0, 32],
    ['--aiditor-space-3', 'Row gap', 0, 64],
    ['--aiditor-space-4', 'Panel padding', 0, 64],
    ['--aiditor-space-5', 'Section gap', 0, 96],
    ['--aiditor-space-6', 'Large gap', 0, 128],
  ]
  const SIZING = [
    ['--aiditor-size-h-xs', 'Control height xs', 12, 40],
    ['--aiditor-size-h-sm', 'Control height sm', 14, 44],
    ['--aiditor-size-h-md', 'Control height md', 16, 48],
    ['--aiditor-size-h-lg', 'Control height lg', 18, 56],
    ['--aiditor-toolbar-h', 'Toolbar height', 16, 60],
    ['--aiditor-tab-h', 'Tab height', 16, 60],
  ]
  const RADIUS = [
    ['--aiditor-r-1', 'Tiny radius', 0, 24],
    ['--aiditor-r-2', 'Control radius', 0, 24],
    ['--aiditor-r-3', 'Panel radius', 0, 24],
    ['--aiditor-r-4', 'Floating radius', 0, 24],
  ]
  const TYPO_PX = [
    ['--aiditor-fs-xs', 'Font size xs', 8, 24],
    ['--aiditor-fs-sm', 'Font size sm', 8, 24],
    ['--aiditor-fs-md', 'Font size md', 8, 28],
    ['--aiditor-fs-lg', 'Font size lg', 8, 32],
    ['--aiditor-fs-xl', 'Font size xl', 8, 36],
  ]
  const MOTION_MS = [
    ['--aiditor-dur-fast', 'Fast', 0, 1000],
    ['--aiditor-dur-med', 'Med', 0, 1000],
    ['--aiditor-dur-slow', 'Slow', 0, 1000],
  ]

  migrateStoredThemePreferences()
  applyStoredThemeOverrides()

  aiditor.effect(function () {
    const mode = aiditor.settings.get('theme.mode')
    if (aiditor.theme && aiditor.theme.set) aiditor.theme.set(mode || 'dark')
    const density = aiditor.settings.get('theme.density')
    if (aiditor.theme && aiditor.theme.setDensity) aiditor.theme.setDensity(density || 'default')
  })

  function renderThemeSettings(opts) {
    opts = opts || {}
    const panelMode = opts.panel === true
    const ui = aiditor.ui
    const root = ui.view({
      scroll: 'hidden',
      className: panelMode ? 'aiditor-theme-config' : 'aiditor-settings-page aiditor-settings-theme-page',
    })
    if (!panelMode) root.appendChild(pageHead('Theme', 'AIditor appearance and visual density.'))

    const bar = ui.h('div', panelMode ? 'aiditor-theme-config-head' : 'aiditor-settings-theme-bar')
    const tabSig = aiditor.signal('palette')
    const modeSig = aiditor.signal(aiditor.settings.get('theme.mode') || 'dark')
    const densitySig = aiditor.signal(aiditor.settings.get('theme.density') || 'default')
    const tabs = ui.segmented({ value: tabSig, options: THEME_TABS })
    tabs.classList.add(panelMode ? 'aiditor-theme-config-tabs' : 'aiditor-settings-theme-tabs')
    const mode = ui.select({
      value: modeSig,
      options: aiditor.theme.modeOptions(),
      variant: 'minimal',
      autoWidth: true,
    })
    const density = ui.select({
      value: densitySig,
      options: [
        { value: 'compact', label: 'Compact' },
        { value: 'default', label: 'Default' },
        { value: 'comfortable', label: 'Comfortable' },
      ],
      variant: 'minimal',
      autoWidth: true,
    })
    const reset = ui.button({
      text: 'Reset',
      size: 'sm',
      onClick: function () {
        clearThemeOverrides()
        refreshAll()
        if (ui.toast) ui.toast({ kind: 'success', message: 'Theme reset' })
      },
    })
    const exportBtn = ui.button({
      text: 'Export',
      size: 'sm',
      onClick: function () {
        const text = aiditor.theme && aiditor.theme.exportCss ? aiditor.theme.exportCss() : ''
        ui.copyText(text)
        if (ui.toast) ui.toast({ kind: 'info', title: 'CSS copied', message: text })
      },
    })
    if (!panelMode) bar.appendChild(tabs)
    bar.appendChild(mode)
    bar.appendChild(density)
    bar.appendChild(reset)
    bar.appendChild(exportBtn)
    root.appendChild(bar)

    const allSigs = []
    const host = ui.h('div', panelMode ? 'aiditor-settings-theme-host aiditor-theme-config-host' : 'aiditor-settings-theme-host')
    const scroll = ui.view({
      children: host,
      className: panelMode ? 'aiditor-settings-theme-scroll aiditor-theme-config-scroll' : 'aiditor-settings-theme-scroll',
    })
    root.appendChild(scroll)
    if (panelMode) {
      const foot = ui.h('div', 'aiditor-theme-config-foot')
      foot.appendChild(tabs)
      root.appendChild(foot)
    }

    function track(sig, name, parse, format) {
      allSigs.push({ sig: sig, name: name, parse: parse, format: format })
    }
    function bindWriter(sig, name, format) {
      ui.collect(root, aiditor.effect(function () {
        const literal = format ? format(sig()) : sig()
        const effective = readThemeToken(name)
        if (effective === literal) return
        writeThemeToken(name, literal)
      }))
    }
    function refreshAll() {
      for (let i = 0; i < allSigs.length; i++) document.documentElement.style.removeProperty(allSigs[i].name)
      for (let i = 0; i < allSigs.length; i++) {
        const it = allSigs[i]
        const v = readThemeToken(it.name)
        const next = it.parse ? it.parse(v) : v
        if (it.sig.peek() !== next) it.sig.set(next)
      }
    }

    let didMountMode = false
    ui.collect(root, aiditor.effect(function () {
      const value = modeSig()
      aiditor.settings.set('theme.mode', value)
      localStorage.setItem(THEME_MODE_KEY, value)
      if (aiditor.theme && aiditor.theme.set) aiditor.theme.set(value)
      if (!didMountMode) {
        didMountMode = true
        return
      }
      clearThemeOverrides()
      refreshAll()
    }))

    ui.collect(root, aiditor.effect(function () {
      const value = densitySig()
      aiditor.settings.set('theme.density', value)
      localStorage.setItem(THEME_DENSITY_KEY, value)
      if (aiditor.theme && aiditor.theme.setDensity) aiditor.theme.setDensity(value)
    }))

    const panes = {}
    function pane(key) {
      if (panes[key]) return panes[key]
      if (key === 'palette') panes[key] = buildPalette(track, bindWriter)
      else if (key === 'spacing') panes[key] = buildPxRows(SPACING, track, bindWriter, 'px')
      else if (key === 'sizing') panes[key] = buildPxRows(SIZING, track, bindWriter, 'px')
      else if (key === 'radius') panes[key] = buildPxRows(RADIUS, track, bindWriter, 'px')
      else if (key === 'typography') panes[key] = buildTypography(track, bindWriter)
      else panes[key] = buildPxRows(MOTION_MS, track, bindWriter, 'ms')
      return panes[key]
    }

    ui.collect(root, aiditor.effect(function () {
      while (host.firstChild) host.removeChild(host.firstChild)
      host.appendChild(pane(tabSig()))
    }))
    return root
  }

  aiditor.registerComponent('theme-config', {
    category: 'panel',
    label: 'Theme',
    icon: 'palette',
    defaults: function () { return { title: 'Theme', icon: 'palette', props: {} } },
    factory: function () { return renderThemeSettings({ panel: true }) },
  })

  function readThemeToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  function readThemeOverrides() {
    try { return JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '{}') } catch (_) { return {} }
  }

  function migrateStoredThemePreferences() {
    const values = aiditor.settings.exportValues ? aiditor.settings.exportValues() : {}
    if (!Object.prototype.hasOwnProperty.call(values, 'theme.mode')) {
      const mode = readStorageText(THEME_MODE_KEY)
      if (mode) aiditor.settings.set('theme.mode', mode)
    }
    if (!Object.prototype.hasOwnProperty.call(values, 'theme.density')) {
      const density = readStorageText(THEME_DENSITY_KEY)
      if (density) aiditor.settings.set('theme.density', density)
    }
  }

  function readStorageText(key) {
    try { return localStorage.getItem(key) || '' } catch (_) { return '' }
  }

  function applyStoredThemeOverrides() {
    const overrides = readThemeOverrides()
    for (const key in overrides) document.documentElement.style.setProperty(key, overrides[key])
  }

  function writeThemeToken(name, value) {
    document.documentElement.style.setProperty(name, value)
    const overrides = readThemeOverrides()
    overrides[name] = value
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(overrides))
  }

  function clearThemeOverrides() {
    const overrides = readThemeOverrides()
    for (const key in overrides) document.documentElement.style.removeProperty(key)
    localStorage.removeItem(THEME_STORAGE_KEY)
  }

  function pxNum(s) {
    const m = /^(-?[\d.]+)/.exec(s || '')
    return m ? Number(m[1]) : 0
  }

  function buildPalette(track, bindWriter) {
    const wrap = aiditor.ui.h('div', 'aiditor-settings-theme-pane aiditor-settings-theme-palette')
    for (let i = 0; i < PALETTE.length; i++) {
      const name = PALETTE[i][0]
      const sig = aiditor.signal(readThemeToken(name) || '#000000')
      track(sig, name, null, null)
      bindWriter(sig, name, null)
      wrap.appendChild(aiditor.ui.propRow({ label: PALETTE[i][1], control: aiditor.ui.colorInput({ value: sig }) }))
    }
    return wrap
  }

  function buildPxRows(catalog, track, bindWriter, unit) {
    const wrap = aiditor.ui.h('div', 'aiditor-settings-theme-pane')
    const format = function (v) { return v + unit }
    for (let i = 0; i < catalog.length; i++) {
      const row = catalog[i]
      const sig = aiditor.signal(pxNum(readThemeToken(row[0])))
      track(sig, row[0], pxNum, format)
      bindWriter(sig, row[0], format)
      wrap.appendChild(aiditor.ui.propRow({
        label: row[1],
        control: aiditor.ui.numberInput({ value: sig, min: row[2], max: row[3], step: unit === 'ms' ? 10 : 1, suffix: unit }),
      }))
    }
    return wrap
  }

  function buildTypography(track, bindWriter) {
    const wrap = aiditor.ui.h('div', 'aiditor-settings-theme-pane')
    const uiFont = aiditor.signal(readThemeToken('--aiditor-font-ui'))
    track(uiFont, '--aiditor-font-ui', null, null)
    bindWriter(uiFont, '--aiditor-font-ui', null)
    wrap.appendChild(aiditor.ui.propRow({ label: 'UI font', control: aiditor.ui.input({ value: uiFont }) }))
    const monoFont = aiditor.signal(readThemeToken('--aiditor-font-mono'))
    track(monoFont, '--aiditor-font-mono', null, null)
    bindWriter(monoFont, '--aiditor-font-mono', null)
    wrap.appendChild(aiditor.ui.propRow({ label: 'Mono font', control: aiditor.ui.input({ value: monoFont }) }))
    const sizes = buildPxRows(TYPO_PX, track, bindWriter, 'px')
    while (sizes.firstChild) wrap.appendChild(sizes.firstChild)
    return wrap
  }

  function pageHead(title, desc) {
    const head = aiditor.ui.h('div', 'aiditor-settings-page-head')
    head.appendChild(aiditor.ui.h('div', 'aiditor-settings-page-title', { text: title }))
    head.appendChild(aiditor.ui.h('div', 'aiditor-settings-page-desc', { text: desc }))
    return head
  }

})(window.aiditor = window.aiditor || {})

// Theme runtime helpers.
//
// CSS owns the visual system; this file only provides a tiny public API for
// choosing a theme on :root or one aiditor root and applying token
// overrides without forcing users to manipulate attributes manually.
;(function (aiditor) {
  'use strict'

  const ATTR = 'data-aiditor-theme'
  const DENSITY_ATTR = 'data-aiditor-density'
  const DEFAULT = 'dark'
  const DEFAULT_DENSITY = 'default'
  const builtInModes = [
    { id: 'dark', label: 'Dark', scheme: 'dark' },
    { id: 'dracula', label: 'Violet', scheme: 'dark' },
    { id: 'harbor', label: 'Harbor', scheme: 'dark' },
    { id: 'abyss', label: 'Sea', scheme: 'dark' },
    { id: 'hadal', label: 'Abyss', scheme: 'dark' },
    { id: 'forest', label: 'Forest', scheme: 'dark' },
    { id: 'sakura', label: 'Sakura', scheme: 'light' },
    { id: 'toybox-purple', label: 'Toybox Purple', scheme: 'light' },
    { id: 'neon', label: 'Neon', scheme: 'dark' },
    { id: 'linen', label: 'Linen', scheme: 'light' },
    { id: 'light', label: 'Light', scheme: 'light' },
  ]

  const authoringTokens = [
    '--aiditor-surface-canvas',
    '--aiditor-surface-lower',
    '--aiditor-surface-frame',
    '--aiditor-surface-panel',
    '--aiditor-surface-field',
    '--aiditor-surface-hover',
    '--aiditor-surface-active',
    '--aiditor-surface-raised',
    '--aiditor-text-primary',
    '--aiditor-text-body',
    '--aiditor-text-label',
    '--aiditor-text-muted',
    '--aiditor-text-disabled',
    '--aiditor-stroke-subtle',
    '--aiditor-stroke-strong',
    '--aiditor-stroke-field',
    '--aiditor-stroke-hover',
    '--aiditor-brand',
    '--aiditor-brand-hover',
    '--aiditor-brand-contrast',
    '--aiditor-state-success',
    '--aiditor-state-warning',
    '--aiditor-state-danger',
    '--aiditor-state-info',
  ]

  function docEl() {
    return document.documentElement
  }

  function target(root) {
    return root || docEl()
  }

  function set(mode, root) {
    const el = target(root)
    const next = mode || DEFAULT
    if (next === DEFAULT && el === docEl()) el.removeAttribute(ATTR)
    else el.setAttribute(ATTR, next)
    return next
  }

  function get(root) {
    return target(root).getAttribute(ATTR) || DEFAULT
  }

  function setDensity(density, root) {
    const el = target(root)
    const next = density || DEFAULT_DENSITY
    if (next === DEFAULT_DENSITY) el.removeAttribute(DENSITY_ATTR)
    else el.setAttribute(DENSITY_ATTR, next)
    return next
  }

  function getDensity(root) {
    return target(root).getAttribute(DENSITY_ATTR) || DEFAULT_DENSITY
  }

  function apply(tokens, root) {
    const el = target(root)
    for (const k in tokens) el.style.setProperty(k, tokens[k])
    return el
  }

  function reset(root, names) {
    const el = target(root)
    const list = names || authoringTokens
    for (let i = 0; i < list.length; i++) el.style.removeProperty(list[i])
    return el
  }

  function read(name, root) {
    return getComputedStyle(target(root)).getPropertyValue(name).trim()
  }

  function exportCss(root, names) {
    const list = names || authoringTokens
    const lines = [':root {']
    for (let i = 0; i < list.length; i++) {
      const value = read(list[i], root)
      if (value) lines.push('  ' + list[i] + ': ' + value + ';')
    }
    lines.push('}')
    return lines.join('\n')
  }

  function modes() {
    return builtInModes.map(function (mode) {
      return { id: mode.id, label: mode.label, scheme: mode.scheme }
    })
  }

  function modeIds() {
    return builtInModes.map(function (mode) { return mode.id })
  }

  function modeOptions() {
    return builtInModes.map(function (mode) {
      return { value: mode.id, label: mode.label }
    })
  }

  function hasMode(id) {
    const key = String(id || '')
    for (let i = 0; i < builtInModes.length; i++) {
      if (builtInModes[i].id === key) return true
    }
    return false
  }

  aiditor.theme = {
    attr: ATTR,
    densityAttr: DENSITY_ATTR,
    default: DEFAULT,
    defaultDensity: DEFAULT_DENSITY,
    authoringTokens: authoringTokens.slice(),
    modes: modes,
    modeIds: modeIds,
    modeOptions: modeOptions,
    hasMode: hasMode,
    set: set,
    get: get,
    setDensity: setDensity,
    getDensity: getDensity,
    apply: apply,
    reset: reset,
    read: read,
    exportCss: exportCss,
  }
})(window.aiditor = window.aiditor || {})

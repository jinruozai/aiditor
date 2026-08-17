import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class FakeStyle {
  constructor() { this.map = new Map() }
  setProperty(k, v) { this.map.set(k, String(v)) }
  removeProperty(k) { this.map.delete(k) }
  getPropertyValue(k) { return this.map.get(k) || '' }
}

class FakeEl {
  constructor() {
    this.attrs = new Map()
    this.style = new FakeStyle()
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)) }
  removeAttribute(k) { this.attrs.delete(k) }
  getAttribute(k) { return this.attrs.get(k) || null }
}

const root = new FakeEl()
const scoped = new FakeEl()

global.window = { aiditor: {} }
global.document = { documentElement: root }
global.getComputedStyle = function (el) {
  return {
    getPropertyValue: function (name) {
      return el.style.getPropertyValue(name) || (name === '--aiditor-brand' ? '#569eff' : '')
    },
  }
}

vm.runInThisContext(readFileSync('src/core/theme.js', 'utf8'), { filename: 'theme.js' })

const aiditor = window.aiditor

assert.equal(aiditor.theme.get(), 'dark')
aiditor.theme.set('light')
assert.equal(root.getAttribute('data-aiditor-theme'), 'light')
assert.equal(aiditor.theme.get(), 'light')
aiditor.theme.set('dark')
assert.equal(root.getAttribute('data-aiditor-theme'), null)
assert.equal(aiditor.theme.get(), 'dark')

aiditor.theme.set('dark', scoped)
assert.equal(scoped.getAttribute('data-aiditor-theme'), 'dark')
aiditor.theme.set('light', scoped)
assert.equal(scoped.getAttribute('data-aiditor-theme'), 'light')

aiditor.theme.apply({ '--aiditor-brand': '#123456', '--aiditor-surface-panel': '#222222' })
assert.equal(root.style.getPropertyValue('--aiditor-brand'), '#123456')
assert.equal(aiditor.theme.read('--aiditor-brand'), '#123456')
aiditor.theme.reset(null, ['--aiditor-brand'])
assert.equal(root.style.getPropertyValue('--aiditor-brand'), '')
assert.equal(aiditor.theme.read('--aiditor-brand'), '#569eff')

const css = aiditor.theme.exportCss(null, ['--aiditor-brand'])
assert.equal(css, ':root {\n  --aiditor-brand: #569eff;\n}')

const dockTabsCss = readFileSync('src/style/dock-tabs.css', 'utf8')
const componentCss = readFileSync('src/style/component.css', 'utf8')
const uiBaseCss = readFileSync('src/style/ui-base.css', 'utf8')
const uiContainerCss = readFileSync('src/style/ui-container.css', 'utf8')
const uiPropertyCss = readFileSync('src/style/ui-property.css', 'utf8')
const themeModes = aiditor.theme.modeIds()
const themeSourceFiles = ['src/style/theme.css'].concat(themeModes.map((mode) => 'src/style/themes/' + mode + '.css'))
const themeCss = themeSourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
const toyboxPurpleSource = readFileSync('src/style/themes/toybox-purple.css', 'utf8')
assert.ok(aiditor.theme.hasMode('neon'))
assert.equal(aiditor.theme.hasMode('missing-theme'), false)
assert.deepEqual(aiditor.theme.modeOptions().map((mode) => mode.value), themeModes)
assert.equal(aiditor.theme.modeOptions().find((mode) => mode.value === 'neon').label, 'Neon')
assert.equal(aiditor.theme.modes().find((mode) => mode.id === 'neon').scheme, 'dark')
assert.equal(aiditor.theme.modeOptions().find((mode) => mode.value === 'toybox-purple').label, 'Toybox Purple')
assert.equal(aiditor.theme.modes().find((mode) => mode.id === 'toybox-purple').scheme, 'light')
assert.equal(aiditor.theme.hasMode('clay'), false)
for (const mode of themeModes) {
  assert.ok(themeSourceFiles.includes('src/style/themes/' + mode + '.css'), mode + ' theme file should be listed')
}
for (const token of [
  '--aiditor-radius-control',
  '--aiditor-radius-surface',
  '--aiditor-radius-overlay',
  '--aiditor-radius-tab',
  '--aiditor-radius-chip',
  '--aiditor-border-w',
  '--aiditor-border-w-strong',
  '--aiditor-border-w-focus',
  '--aiditor-control-border-w',
  '--aiditor-surface-border-w',
  '--aiditor-overlay-border-w',
  '--aiditor-dock-border-w',
  '--aiditor-shadow-control',
  '--aiditor-shadow-surface',
  '--aiditor-shadow-overlay',
  '--aiditor-shadow-active',
  '--aiditor-root-bg-image',
  '--aiditor-root-bg-size',
  '--aiditor-root-bg-position',
  '--aiditor-root-bg-blend',
  '--aiditor-corner-accent-size',
  '--aiditor-corner-accent-color',
  '--aiditor-corner-accent-opacity',
  '--aiditor-dock-tab-bg',
  '--aiditor-dock-tab-hover-bg',
  '--aiditor-dock-tab-active-bg',
  '--aiditor-dock-tab-border-w',
  '--aiditor-dock-tab-radius-top',
  '--aiditor-dock-tab-radius-bottom',
  '--aiditor-dock-tab-radius-left',
  '--aiditor-dock-tab-radius-right',
  '--aiditor-dock-tab-indicator-bg',
  '--aiditor-dock-tab-indicator-bg-vertical',
  '--aiditor-dock-tab-indicator-size',
  '--aiditor-dock-tab-active-overlay-top',
  '--aiditor-dock-tab-active-overlay-bottom',
  '--aiditor-dock-tab-active-overlay-left',
  '--aiditor-dock-tab-active-overlay-right',
  '--aiditor-dock-tab-active-shadow-top',
  '--aiditor-dock-tab-active-shadow-bottom',
  '--aiditor-dock-tab-active-shadow-left',
  '--aiditor-dock-tab-active-shadow-right',
]) {
  assert.match(themeCss, new RegExp(token.replace(/-/g, '\\-')))
}
for (const mode of ['linen', 'abyss', 'hadal', 'forest', 'sakura', 'toybox-purple', 'neon']) {
  assert.match(themeCss, new RegExp('data-aiditor-theme="' + mode + '"'))
  for (const token of [
    '--aiditor-surface-canvas',
    '--aiditor-surface-panel',
    '--aiditor-surface-field',
    '--aiditor-text-primary',
    '--aiditor-stroke-subtle',
    '--aiditor-brand',
    '--aiditor-bg-0',
    '--aiditor-bg-1',
    '--aiditor-bg-2',
    '--aiditor-border',
    '--aiditor-selected-hover',
    '--aiditor-shadow-raised',
  ]) {
    assert.match(themeCss, new RegExp('data-aiditor-theme="' + mode + '"[\\s\\S]*' + token.replace(/-/g, '\\-')))
  }
}

const neonBlock = themeCss.slice(themeCss.indexOf('data-aiditor-theme="neon"'))
for (const token of [
  '--aiditor-radius-control',
  '--aiditor-radius-surface',
  '--aiditor-radius-overlay',
  '--aiditor-border-w-strong',
  '--aiditor-surface-border-w',
  '--aiditor-overlay-border-w',
  '--aiditor-dock-border-w',
  '--aiditor-shadow-control',
  '--aiditor-shadow-surface',
  '--aiditor-shadow-overlay',
  '--aiditor-root-bg-image',
  '--aiditor-corner-accent-size',
  '--aiditor-dock-tab-hover-bg',
  '--aiditor-dock-tab-active-bg',
  '--aiditor-dock-tab-indicator-bg',
  '--aiditor-dock-tab-indicator-bg-vertical',
  '--aiditor-dock-tab-indicator-size',
  '--aiditor-dock-tab-active-overlay-top',
  '--aiditor-dock-tab-active-shadow-top',
  '--aiditor-button-fg',
  '--aiditor-button-hover-fg',
  '--aiditor-button-active-fg',
  '--aiditor-button-primary-bg',
  '--aiditor-button-primary-hover-fg',
]) {
  assert.match(neonBlock, new RegExp(token.replace(/-/g, '\\-')))
}

assert.match(dockTabsCss, /--aiditor-dock-tab-active-overlay-top/)
assert.match(dockTabsCss, /--aiditor-dock-tab-active-shadow-right/)
assert.match(dockTabsCss, /--aiditor-dock-tab-indicator-bg-vertical/)
assert.doesNotMatch(dockTabsCss, /radial-gradient\(95px 24px/)
assert.doesNotMatch(dockTabsCss, /mask-image: linear-gradient\(to bottom/)
assert.match(neonBlock, /--aiditor-border-w-strong:\s*2px/)
assert.match(neonBlock, /--aiditor-surface-canvas:\s*#00020a/)
assert.match(neonBlock, /--aiditor-surface-panel:\s*#030916/)
assert.match(neonBlock, /--aiditor-stroke-strong:\s*#00eaff/)
assert.match(neonBlock, /--aiditor-dock-tab-active-bg:\s*#facf01/)
assert.match(neonBlock, /--aiditor-dock-tab-indicator-bg:\s*var\(--aiditor-state-warning\)/)
assert.match(neonBlock, /--aiditor-button-bg:\s*linear-gradient\(180deg, #125bff 0%, #0837a8 100%\)/)
assert.match(neonBlock, /--aiditor-button-active-bg:\s*#facf01/)
assert.match(neonBlock, /--aiditor-button-active-fg:\s*#171000/)

const darkBlock = themeBlock('dark')
assert.match(darkBlock, /--aiditor-property-section-accent:\s*var\(--aiditor-accent\)/)
assert.match(darkBlock, /--aiditor-property-section-border:\s*color-mix\(/)
assert.match(darkBlock, /--aiditor-property-section-bg:\s*color-mix\(/)
assert.match(darkBlock, /--aiditor-property-section-body-bg:\s*var\(--aiditor-property-section-bg\)/)
assert.match(darkBlock, /--aiditor-property-section-head-bg:\s*color-mix\(/)
assert.match(darkBlock, /--aiditor-property-section-spacing:\s*2px/)
assert.match(darkBlock, /--aiditor-property-nested-indent:\s*12px/)

const toyboxPurpleBlock = themeBlock('toybox-purple')
assert.match(toyboxPurpleBlock, /--aiditor-surface-canvas:\s*#f6f4fb/)
assert.match(toyboxPurpleBlock, /--aiditor-brand:\s*#6b4de6/)
assert.match(toyboxPurpleBlock, /--aiditor-app-bar-bg:\s*linear-gradient\(180deg, #ffd43b 0%, #ffaa17 100%\)/)
assert.match(toyboxPurpleBlock, /--aiditor-app-bar-border:\s*#c87506/)
assert.match(toyboxPurpleBlock, /--aiditor-toolbar-bg:\s*linear-gradient\(180deg, #fffdfd 0%, #f1eff7 100%\)/)
assert.match(toyboxPurpleBlock, /--aiditor-focus-ring:\s*#ffaa17/)
assert.match(toyboxPurpleBlock, /--aiditor-font-ui:[\s\S]*"Arial Rounded MT Bold"/)
assert.match(toyboxPurpleBlock, /--aiditor-dock-tab-active-bg:\s*linear-gradient\(180deg, #8e73ff 0%, #6b4de6 100%\)/)
assert.match(toyboxPurpleBlock, /--aiditor-dock-tab-indicator-bg:\s*transparent/)
assert.match(toyboxPurpleBlock, /--aiditor-dock-tab-indicator-opacity:\s*0/)
assert.match(toyboxPurpleBlock, /--aiditor-button-primary-bg:\s*linear-gradient\(180deg, #8e73ff 0%, #6b4de6 100%\)/)
assert.match(toyboxPurpleBlock, /--aiditor-button-primary-shadow:[\s\S]*0 3px 0 #4930b3/)
assert.match(toyboxPurpleBlock, /--aiditor-button-hover-bg:\s*linear-gradient\(180deg, #ffffff 0%, #e9e3f9 100%\)/)
assert.match(toyboxPurpleBlock, /--aiditor-button-active-bg:\s*#ddd4f6/)
assert.match(toyboxPurpleBlock, /--aiditor-stroke-hover:\s*#8e73ff/)
assert.match(toyboxPurpleBlock, /--aiditor-shadow-control:[\s\S]*0 2px 0 #d8d2e1/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-accent:\s*#ffaa17/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-border:\s*color-mix\(in srgb, var\(--aiditor-property-section-accent\) 78%, transparent\)/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-bg:\s*color-mix\(in srgb, var\(--aiditor-property-section-accent\) 18%, var\(--aiditor-bg-1\)\)/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-body-bg:\s*var\(--aiditor-property-section-bg\)/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-head-bg:\s*color-mix\(in srgb, var\(--aiditor-property-section-accent\) 78%, transparent\)/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-head-shadow:\s*none/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-inset-bar:\s*inset 2px 0 0 var\(--aiditor-property-section-accent\)/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-collapsed-border:\s*transparent/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-collapsed-bg:\s*transparent/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-collapsed-head-bg:\s*transparent/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-collapsed-head-hover-bg:\s*color-mix\(/)
assert.match(toyboxPurpleBlock, /--aiditor-property-section-spacing:\s*2px/)
assert.match(toyboxPurpleBlock, /--aiditor-property-nested-indent:\s*12px/)
assert.match(componentCss, /\.aiditor-toolbar\s*\{[\s\S]*color:\s*var\(--aiditor-toolbar-fg\);[\s\S]*box-shadow:\s*var\(--aiditor-toolbar-shadow\);/)
assert.match(uiBaseCss, /\.aiditor-ui-btn-primary\s*\{[\s\S]*box-shadow:\s*var\(--aiditor-button-primary-shadow\);/)
assert.match(uiBaseCss, /\.aiditor-ui-btn:focus-visible\s*\{[\s\S]*var\(--aiditor-focus-ring\)/)
assert.match(uiContainerCss, /\.aiditor-ui-section-head\s*\{[\s\S]*background:\s*var\(--aiditor-section-head-bg\);[\s\S]*box-shadow:\s*var\(--aiditor-section-head-shadow\);/)
assert.match(uiContainerCss, /\.aiditor-ui-section-head:hover\s*\{\s*background:\s*var\(--aiditor-section-head-hover-bg\);/)
assert.doesNotMatch(uiContainerCss, /\.aiditor-ui-section-toggle:hover\s*\{[^}]*background:/)
assert.match(uiPropertyCss, /\.aiditor-ui-property-section\s*>\s*\.aiditor-ui-section-head\s*\{[\s\S]*background:\s*var\(--aiditor-property-section-head-bg\);[\s\S]*box-shadow:\s*var\(--aiditor-property-section-head-shadow\);/)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-section\.aiditor-ui-property-section\s*\{[^}]*border:\s*var\(--aiditor-surface-border-w\) solid var\(--aiditor-property-section-border\);[^}]*background:\s*var\(--aiditor-property-section-bg\);[^}]*box-shadow:\s*var\(--aiditor-property-section-inset-bar\);/s,
  'Property Sections should render as one token-driven card with a themeable inset bar'
)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-section\.aiditor-ui-property-section\.aiditor-ui-section-collapsed\s*\{[^}]*border-color:\s*var\(--aiditor-property-section-collapsed-border\);[^}]*background:\s*var\(--aiditor-property-section-collapsed-bg\);/s,
  'collapsed Property Sections should consume the collapsed skin tokens'
)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-property-form\s*\{[^}]*gap:\s*var\(--aiditor-property-section-spacing\);/s,
  'Property Form should use the shared compact section rhythm'
)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-property-form \.aiditor-ui-property-form-root\s*\{[^}]*gap:\s*var\(--aiditor-property-section-spacing\);/s,
  'Property Form root should preserve the compact section rhythm'
)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-property-section:not\(\.aiditor-ui-section-collapsed\)\s*>\s*\.aiditor-ui-section-head\s*\{[^}]*border-radius:\s*var\(--aiditor-radius-surface\) var\(--aiditor-radius-surface\) 0 0;/s,
  'expanded Property Section headers should connect squarely to their body'
)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-property-section\.aiditor-ui-section-collapsed\s*>\s*\.aiditor-ui-section-head\s*\{[^}]*border-radius:\s*var\(--aiditor-radius-surface\);/s,
  'collapsed Property Section headers should keep all four corners rounded'
)
assert.match(
  uiPropertyCss,
  /\.aiditor-ui-property-section\s*>\s*\.aiditor-ui-section-body\s*\{[^}]*padding:\s*var\(--aiditor-property-section-spacing\);[^}]*background:\s*var\(--aiditor-property-section-body-bg\);/s,
  'Property Section bodies should share the card hue and compact inset'
)
assert.match(uiPropertyCss, /\.aiditor-ui-property-form \.aiditor-ui-property-form-struct \.aiditor-ui-struct-input-cell\s*>\s*\.aiditor-ui-slot\s*>\s*\.aiditor-ui-struct-input\s*\{[^}]*border:\s*0;[^}]*padding:\s*0;[^}]*box-shadow:\s*none;/s)
assert.match(uiPropertyCss, /\.aiditor-ui-property-form\[inert\][^{]*\.aiditor-ui-section-head:hover\s*\{[^}]*background:\s*var\(--aiditor-property-section-head-bg\);/s)
assert.doesNotMatch(toyboxPurpleSource, /\.aiditor-inspector \.aiditor-ui-property-form/, 'theme files should provide tokens, not Property Form structure')
assert.doesNotMatch(uiPropertyCss, /\.aiditor-ui-property-section[^}]*\{[^}]*margin(?:-\w+)?:/s, 'Property Sections should not create spacing with margins')

function themeBlock(mode) {
  const marker = '.aiditor-root[data-aiditor-theme="' + mode + '"] {'
  const start = themeCss.indexOf(marker)
  assert.notEqual(start, -1, 'missing theme selector for ' + mode)
  const open = themeCss.indexOf('{', start)
  let depth = 0
  for (let i = open; i < themeCss.length; i++) {
    if (themeCss[i] === '{') depth += 1
    if (themeCss[i] === '}') {
      depth -= 1
      if (depth === 0) return themeCss.slice(open + 1, i)
    }
  }
  assert.fail('unclosed theme block for ' + mode)
}

function cssHex(block, token) {
  const match = block.match(new RegExp(token.replace(/-/g, '\\-') + ':\\s*(#[0-9a-fA-F]{3,6})'))
  assert.ok(match, 'missing ' + token)
  return match[1]
}

function rgb(hex) {
  const normalized = hex.length === 4
    ? hex.slice(1).split('').map((ch) => ch + ch).join('')
    : hex.slice(1)
  return [0, 2, 4].map((idx) => parseInt(normalized.slice(idx, idx + 2), 16) / 255)
}

function linearChannel(value) {
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(linearChannel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

for (const mode of themeModes) {
  const block = themeBlock(mode)
  const panel = cssHex(block, '--aiditor-surface-panel')
  const field = cssHex(block, '--aiditor-surface-field')
  for (const [token, min] of [
    ['--aiditor-text-primary', 8],
    ['--aiditor-text-body', 7],
    ['--aiditor-text-label', 5],
    ['--aiditor-text-muted', 3.8],
  ]) {
    const color = cssHex(block, token)
    assert.ok(contrast(color, panel) >= min, mode + ' ' + token + ' panel contrast is too low')
    assert.ok(contrast(color, field) >= min, mode + ' ' + token + ' field contrast is too low')
  }
}

const themeSettings = readFileSync('src/style/theme-settings.js', 'utf8')
assert.doesNotMatch(themeSettings, /const THEME_OPTIONS/)
assert.match(themeSettings, /aiditor\.theme\.modeOptions/)

const demoTargets = readFileSync('demo/ai-targets.js', 'utf8')
assert.doesNotMatch(demoTargets, /const THEME_MODES/)
assert.match(demoTargets, /aiditor\.theme\.modeIds/)

for (const file of [
  'src/style/ui-base.css',
  'src/style/ui-container.css',
  'src/style/ui-data.css',
  'src/style/ui-editor.css',
  'src/style/ui-form.css',
  'src/style/ui-property.css',
  'src/style/ui-overlay.css',
  'src/style/dock-tabs.css',
]) {
  const cssText = readFileSync(file, 'utf8')
  assert.doesNotMatch(cssText, /--aiditor-shadow-(md|lg|0)/, file + ' should use appearance shadow roles')
  assert.doesNotMatch(cssText, /--aiditor-dur-1|--aiditor-ease-standard/, file + ' should use current motion tokens')
}

console.log('theme tests ok')

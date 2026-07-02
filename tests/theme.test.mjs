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

const themeCss = readFileSync('src/style/theme.css', 'utf8')
const themeModes = ['dark', 'dracula', 'harbor', 'abyss', 'hadal', 'forest', 'sakura', 'linen', 'light']
for (const mode of ['linen', 'abyss', 'hadal', 'forest', 'sakura']) {
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
assert.match(themeSettings, /value: 'linen', label: 'Linen'/)
assert.match(themeSettings, /value: 'abyss', label: 'Sea'/)
assert.match(themeSettings, /value: 'hadal', label: 'Abyss'/)
assert.match(themeSettings, /value: 'forest', label: 'Forest'/)
assert.match(themeSettings, /value: 'sakura', label: 'Sakura'/)

const demoTargets = readFileSync('demo/ai-targets.js', 'utf8')
assert.match(demoTargets, /THEME_MODES = \['dark', 'dracula', 'harbor', 'abyss', 'hadal', 'forest', 'sakura', 'linen', 'light'\]/)

console.log('theme tests ok')

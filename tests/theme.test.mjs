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
for (const mode of ['linen', 'abyss', 'hadal']) {
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

const themeSettings = readFileSync('src/style/theme-settings.js', 'utf8')
assert.match(themeSettings, /value: 'linen', label: 'Linen'/)
assert.match(themeSettings, /value: 'abyss', label: 'Abyss'/)
assert.match(themeSettings, /value: 'hadal', label: 'Hadal'/)

const demoTargets = readFileSync('demo/ai-targets.js', 'utf8')
assert.match(demoTargets, /THEME_MODES = \['dark', 'dracula', 'harbor', 'abyss', 'hadal', 'linen', 'light'\]/)

console.log('theme tests ok')

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

function boot(seed) {
  const memory = Object.assign({}, seed || {})
  const root = new FakeEl()
  const storage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null },
    setItem(key, value) { memory[key] = String(value) },
    removeItem(key) { delete memory[key] },
  }

  global.localStorage = storage
  global.window = { aiditor: {}, localStorage: storage }
  global.document = { documentElement: root }
  global.getComputedStyle = function (el) {
    return { getPropertyValue: function (name) { return el.style.getPropertyValue(name) || '' } }
  }

  for (const file of [
    'src/core/signal.js',
    'src/core/names.js',
    'src/core/settings.js',
    'src/core/theme.js',
    'src/core/registry.js',
    'src/style/theme-settings.js',
  ]) {
    vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
  }

  return { aiditor: window.aiditor, root, memory }
}

let env = boot({
  'aiditor.settings.v1': JSON.stringify({ 'theme.mode': 'forest', 'theme.density': 'compact' }),
})
assert.equal(env.root.getAttribute('data-aiditor-theme'), 'forest')
assert.equal(env.root.getAttribute('data-aiditor-density'), 'compact')

env = boot({
  'aiditor-theme-mode': 'sakura',
  'aiditor-theme-density': 'comfortable',
})
assert.equal(env.root.getAttribute('data-aiditor-theme'), 'sakura')
assert.equal(env.root.getAttribute('data-aiditor-density'), 'comfortable')
assert.equal(JSON.parse(env.memory['aiditor.settings.v1'])['theme.mode'], 'sakura')
assert.equal(JSON.parse(env.memory['aiditor.settings.v1'])['theme.density'], 'comfortable')

env = boot({
  'aiditor-theme-overrides-v3': JSON.stringify({
    '--aiditor-brand': '#ff77aa',
    '--aiditor-surface-panel': '#fff5f8',
  }),
})
assert.equal(env.root.style.getPropertyValue('--aiditor-brand'), '#ff77aa')
assert.equal(env.root.style.getPropertyValue('--aiditor-surface-panel'), '#fff5f8')

console.log('theme settings persistence tests ok')

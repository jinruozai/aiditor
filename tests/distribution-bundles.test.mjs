import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function runBundle(file) {
  const window = { aiditor: {} }
  const sandbox = {
    window,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
  }
  vm.createContext(sandbox)
  vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: file })
  return window.aiditor
}

const theme = runBundle('dist/aiditor-theme.js')
assert.equal(typeof theme.theme.set, 'function')
assert.equal(theme.theme.hasMode('toybox-purple'), true)
assert.equal(theme.signal, undefined)
assert.equal(theme.ui, undefined)

const widgets = runBundle('dist/aiditor-widgets.js')
assert.equal(typeof widgets.signal, 'function')
assert.equal(typeof widgets.theme.set, 'function')
assert.equal(typeof widgets.registerComponent, 'function')
assert.equal(typeof widgets.ui.button, 'function')
assert.equal(typeof widgets.ui.propertyForm, 'function')
assert.equal(typeof widgets.ui.tree, 'function')
assert.equal(typeof widgets.ui.modal, 'function')
assert.equal(widgets.createDockLayout, undefined)
assert.equal(widgets.workspace, undefined)
assert.equal(widgets.history, undefined)
assert.equal(widgets.shortcuts, undefined)
assert.equal(widgets.settings, undefined)
assert.equal(widgets.ai, undefined)
assert.equal(widgets.listComponents().some(function (entry) { return entry.name === 'input' }), true)
assert.equal(widgets.listComponents().some(function (entry) { return entry.name === 'button' }), true)

const themeCss = readFileSync('dist/aiditor-theme.css', 'utf8')
assert.match(themeCss, /data-aiditor-theme="toybox-purple"/)
assert.doesNotMatch(themeCss, /\.aiditor-ui-btn/)
assert.doesNotMatch(themeCss, /\/\* ---- style\/dock\.css ---- \*\//)

const widgetCss = readFileSync('dist/aiditor-widgets.css', 'utf8')
assert.match(widgetCss, /\.aiditor-ui-btn/)
assert.match(widgetCss, /data-aiditor-theme="toybox-purple"/)
assert.doesNotMatch(widgetCss, /\/\* ---- style\/dock\.css ---- \*\//)
assert.doesNotMatch(widgetCss, /\.aiditor-ai-/)

console.log('distribution bundle tests passed')

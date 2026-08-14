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

const mini = runBundle('dist/aiditor-mini.js')
assert.equal(typeof mini.signal, 'function')
assert.equal(typeof mini.theme.set, 'function')
assert.equal(typeof mini.ui.button, 'function')
assert.equal(typeof mini.ui.input, 'function')
assert.equal(typeof mini.ui.colorInput, 'function')
assert.equal(typeof mini.ui.section, 'function')
assert.equal(typeof mini.ui.vbox, 'function')
assert.equal(typeof mini.ui.hbox, 'function')
assert.equal(typeof mini.ui.absolute, 'function')
assert.equal(typeof mini.ui.quickPick, 'function')
assert.equal(typeof mini.ui.modal, 'function')
assert.equal(typeof mini.ui.modalDepth, 'function')
assert.equal(mini.ui.modalDepth.peek(), 0)
assert.equal(mini.ui.modalDepth.set, undefined)
assert.equal(mini.registerComponent, undefined)
assert.equal(mini.ui.propertyForm, undefined)
assert.equal(mini.ui.arrayEditor, undefined)
assert.equal(mini.ui.tree, undefined)
assert.equal(mini.ui.fileBrowser, undefined)
assert.equal(mini.ui.codeInput, undefined)
assert.equal(mini.ui.timeline, undefined)
assert.equal(mini.inspector, undefined)
assert.equal(mini.createDockLayout, undefined)
assert.equal(mini.workspace, undefined)
assert.equal(mini.history, undefined)
assert.equal(mini.shortcuts, undefined)
assert.equal(mini.settings, undefined)
assert.equal(mini.ai, undefined)

const editor = runBundle('dist/aiditor-editor.js')
assert.equal(typeof editor.signal, 'function')
assert.equal(typeof editor.theme.set, 'function')
assert.equal(typeof editor.registerComponent, 'function')
assert.equal(typeof editor.ui.button, 'function')
assert.equal(typeof editor.ui.propertyForm, 'function')
assert.equal(typeof editor.ui.tree, 'function')
assert.equal(typeof editor.ui.modal, 'function')
assert.equal(typeof editor.ui.modalDepth, 'function')
assert.equal(editor.ui.modalDepth.peek(), 0)
assert.equal(typeof editor.ui.timeline.createLayout, 'function')
assert.equal(typeof editor.ui.timeline.createSurface, 'function')
assert.equal(typeof editor.ui.dataGrid, 'function')
assert.equal(typeof editor.ui.createTextDocument, 'function')
assert.equal(typeof editor.ui.csv.model.parse, 'function')
assert.equal(editor.createDockLayout, undefined)
assert.equal(typeof editor.workspace.memory, 'function')
assert.equal(editor.history, undefined)
assert.equal(editor.shortcuts, undefined)
assert.equal(editor.settings, undefined)
assert.equal(editor.ai, undefined)
assert.equal(editor.listComponents().some(function (entry) { return entry.name === 'input' }), true)
assert.equal(editor.listComponents().some(function (entry) { return entry.name === 'button' }), true)
assert.equal(editor.listComponents().some(function (entry) { return entry.name === 'text' }), true)
assert.equal(editor.listComponents().some(function (entry) { return entry.name === 'vbox' }), true)
assert.equal(editor.listComponents().some(function (entry) { return entry.name === 'absolute' }), true)

const themeCss = readFileSync('dist/aiditor-theme.css', 'utf8')
assert.match(themeCss, /data-aiditor-theme="toybox-purple"/)
assert.doesNotMatch(themeCss, /\.aiditor-ui-btn/)
assert.doesNotMatch(themeCss, /\/\* ---- style\/dock\.css ---- \*\//)

const miniCss = readFileSync('dist/aiditor-mini.css', 'utf8')
assert.match(miniCss, /\.aiditor-ui-btn/)
assert.match(miniCss, /data-aiditor-theme="toybox-purple"/)
assert.doesNotMatch(miniCss, /\/\* ---- style\/dock\.css ---- \*\//)
assert.doesNotMatch(miniCss, /\/\* ---- style\/ui-data\.css ---- \*\//)
assert.doesNotMatch(miniCss, /\/\* ---- style\/ui-editor\.css ---- \*\//)
assert.doesNotMatch(miniCss, /\/\* ---- style\/ui-property\.css ---- \*\//)
assert.doesNotMatch(miniCss, /\/\* ---- style\/dock-tabs\.css ---- \*\//)

const editorCss = readFileSync('dist/aiditor-editor.css', 'utf8')
assert.match(editorCss, /\.aiditor-ui-btn/)
assert.match(editorCss, /data-aiditor-theme="toybox-purple"/)
assert.doesNotMatch(editorCss, /\/\* ---- style\/dock\.css ---- \*\//)
assert.doesNotMatch(editorCss, /\/\* ---- style\/dock-tabs\.css ---- \*\//)
assert.match(editorCss, /\/\* ---- style\/ui-property\.css ---- \*\//)
assert.match(editorCss, /\/\* ---- style\/ui-timeline\.css ---- \*\//)
assert.match(editorCss, /\/\* ---- style\/ui-data-grid\.css ---- \*\//)
assert.doesNotMatch(editorCss, /\.aiditor-csv-editor/)
assert.doesNotMatch(editorCss, /\.aiditor-ai-/)

const aiJs = readFileSync('dist/aiditor-ai.js', 'utf8')
const fullJs = readFileSync('dist/aiditor-full.js', 'utf8')
const coreJs = readFileSync('dist/aiditor-core.js', 'utf8')
assert.match(aiJs, /\/\* ---- ai\/panels\/composer-slash\.js ---- \*\//)
assert.match(fullJs, /\/\* ---- ai\/panels\/composer-slash\.js ---- \*\//)
assert.doesNotMatch(coreJs, /\/\* ---- ai\/panels\/composer-slash\.js ---- \*\//)

console.log('distribution bundle tests passed')

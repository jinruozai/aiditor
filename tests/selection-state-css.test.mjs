import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const theme = readFileSync('src/style/theme.css', 'utf8')
const data = readFileSync('src/style/ui-data.css', 'utf8')
const form = readFileSync('src/style/ui-form.css', 'utf8')
const editor = readFileSync('src/style/ui-editor.css', 'utf8')
const ai = readFileSync('src/style/ui-ai.css', 'utf8')

for (const token of [
  '--aiditor-selected-hover',
  '--aiditor-selected-border',
  '--aiditor-selected-fg',
]) {
  assert.ok(theme.includes(token), token + ' theme token is required')
}

for (const selector of [
  '.aiditor-ui-list-row-active:hover',
  '.aiditor-ui-tree-row-active:hover',
  '.aiditor-ui-errlog-row-selected:hover',
  '.aiditor-history-row-current:hover:not(:disabled)',
  '.aiditor-ui-assetitem.is-selected:hover',
]) {
  assert.ok(data.includes(selector), selector + ' must keep selected state above hover')
}

for (const selector of [
  '.aiditor-ui-menu-item-active:hover',
  '.aiditor-ui-tab-btn-active:hover',
  '.aiditor-dock-tabs .aiditor-ui-tab-btn-active:hover',
  '.aiditor-ui-array-editor-row.is-selected:hover',
  '.aiditor-ui-seg-active:hover',
]) {
  assert.ok(form.includes(selector), selector + ' must keep active state above hover')
}

assert.ok(editor.includes('.aiditor-ui-anchor-cell.is-active:hover'), 'anchor picker active hover must stay active')
assert.ok(ai.includes('.aiditor-ai-agent-tree .aiditor-ui-tree-row-active:hover'), 'AI agent tree active hover must stay active')

console.log('selection state css tests ok')

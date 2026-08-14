import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/workspace.js',
  'src/ui/editor/textDocument.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const aiditor = window.aiditor
const workspace = aiditor.workspace.memory({ 'data.csv': 'a\n1\n' })
const unbind = aiditor.workspace.bind('project', workspace)
assert.equal(aiditor.workspace.binding('project'), workspace)

const document = aiditor.ui.createTextDocument({
  workspaceId: 'project',
  path: 'data.csv',
  decode: function (text) { return { text: text } },
  encode: function (value) { return value.text },
})

await document.load()
assert.equal(document.value.peek().text, 'a\n1\n')
assert.equal(document.dirty.peek(), false)

document.set({ text: 'a\n2\n' })
assert.equal(document.dirty.peek(), true)
await document.save()
assert.equal(document.dirty.peek(), false)
assert.equal((await workspace.readText('data.csv')).text, 'a\n2\n')

let file = await workspace.readText('data.csv')
await workspace.writeText('data.csv', 'a\n3\n', { baseHash: file.hash })
assert.equal(await document.checkExternal(), true)
assert.equal(document.value.peek().text, 'a\n3\n')
assert.equal(document.stale.peek(), false)

document.set({ text: 'local' })
file = await workspace.readText('data.csv')
await workspace.writeText('data.csv', 'external', { baseHash: file.hash })
assert.equal(await document.checkExternal(), true)
assert.equal(document.value.peek().text, 'local')
assert.equal(document.stale.peek(), true)
await assert.rejects(document.save(), /baseHash mismatch|stale/i)

document.dispose()
unbind()
assert.equal(aiditor.workspace.binding('project'), null)

console.log('text document tests ok')


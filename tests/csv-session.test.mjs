import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/core/history.js',
  'src/core/commands.js',
  'src/core/workspace.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/schema.js',
  'src/ui/inspector.js',
  'src/ui/editor/textDocument.js',
  'src/ui/editor/csv/codec.js',
  'src/ui/editor/csv/format.js',
  'src/ui/editor/csv/format-csv.js',
  'src/ui/editor/csv/model.js',
  'src/ui/panel/csv-session.js',
  'src/ui/panel/csv-commands.js',
  'src/ui/panel/csv-inspector.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const aiditor = window.aiditor
const source = 'Name,"{\'name\':\'Count\',\'type\':\'int\'}"\nA,1\n'
const workspace = aiditor.workspace.memory({ 'items.csv': source, 'other.csv': source })
aiditor.workspace.bind('project', workspace)

const first = aiditor.ui.csv.sessions.acquire('project', 'items.csv', 'csv')
const second = aiditor.ui.csv.sessions.acquire('project', 'items.csv', 'csv')
const other = aiditor.ui.csv.sessions.acquire('project', 'other.csv', 'csv')
assert.equal(first, second)
assert.notEqual(first, other)
await first.load()
assert.equal(first.document.value.peek().rows.length, 1)

aiditor.commands.run('csv.row.insertBelow', {
  sessionKey: first.key,
  selection: { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
})
assert.equal(first.document.value.peek().rows.length, 2)
assert.equal(first.document.dirty.peek(), true)
await first.undo()
assert.equal(first.document.value.peek().rows.length, 1)
await first.redo()
assert.equal(first.document.value.peek().rows.length, 2)

let doc = first.document.value.peek()
const cellTarget = { type: 'csv.cell', sessionKey: first.key, rowId: doc.rows[0].id, columnId: doc.columns[0].id }
const cellInspection = aiditor.inspector.inspect([cellTarget])
cellInspection.write('value', aiditor.inspector.literalChange('value', 'Renamed'), {
  targets: cellInspection.targets,
  schema: cellInspection.schema,
  applyChange: aiditor.inspector.applyChange,
  valueForChange: aiditor.inspector.valueForChange,
})
assert.equal(first.document.value.peek().rows[0].values[0], 'Renamed')

await aiditor.commands.run('csv.save', { sessionKey: first.key })
assert.equal(first.document.dirty.peek(), false)

await other.load()
const standardDoc = other.document.value.peek()
const standardColumn = { type: 'csv.column', sessionKey: other.key, columnId: standardDoc.columns[0].id }
assert.deepEqual(Object.keys(aiditor.inspector.inspect([standardColumn]).schema), ['name'])

first.release()
assert.equal(aiditor.ui.csv.sessions.get(first.key), second)
second.release()
assert.equal(aiditor.ui.csv.sessions.get(first.key), null)
other.release()

console.log('csv session tests ok')

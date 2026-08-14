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
  'src/ui/editor/csv/format-gamecsv.js',
  'src/ui/editor/csv/model.js',
  'src/ui/panel/csv-session.js',
  'src/ui/panel/csv-commands.js',
  'src/ui/panel/csv-inspector.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const aiditor = window.aiditor
const source = 'Name,"{\'name\':\'Count\',\'type\':\'int\'}"\nA,1\n'
const workspace = aiditor.workspace.memory({ 'items.csv': source })
aiditor.workspace.bind('project', workspace)

const first = aiditor.ui.csv.sessions.acquire('project', 'items.csv', 'gamecsv')
const second = aiditor.ui.csv.sessions.acquire('project', 'items.csv', 'gamecsv')
const standard = aiditor.ui.csv.sessions.acquire('project', 'items.csv', 'csv')
assert.equal(first, second)
assert.notEqual(first, standard)
await first.load()
assert.equal(first.document.value.peek().rows.length, 1)
assert.equal(first.document.value.peek().columns[1].fieldDef.type, 'int')

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

doc = first.document.value.peek()
const columnTarget = { type: 'csv.column', sessionKey: first.key, columnId: doc.columns[1].id }
const columnInspection = aiditor.inspector.inspect([columnTarget])
columnInspection.write('type', aiditor.inspector.literalChange('type', 'float'), {
  targets: columnInspection.targets,
  schema: columnInspection.schema,
  applyChange: aiditor.inspector.applyChange,
  valueForChange: aiditor.inspector.valueForChange,
})
assert.equal(first.document.value.peek().columns[1].fieldDef.type, 'float')

aiditor.commands.run('csv.column.applyDefinition', {
  sessionKey: first.key,
  selection: { anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 } },
  keepName: true,
  definition: { name: 'Amount', fieldDef: { type: 'int' }, width: 120, align: 'right' },
})
assert.equal(first.document.value.peek().columns[1].name, 'Count')
assert.equal(first.document.value.peek().columns[1].width, 120)
await aiditor.commands.run('csv.save', { sessionKey: first.key })
assert.equal(first.document.dirty.peek(), false)

await standard.load()
const standardDoc = standard.document.value.peek()
const standardColumn = { type: 'csv.column', sessionKey: standard.key, columnId: standardDoc.columns[0].id }
assert.deepEqual(Object.keys(aiditor.inspector.inspect([standardColumn]).schema), ['name'])

first.release()
assert.equal(aiditor.ui.csv.sessions.get(first.key), second)
second.release()
assert.equal(aiditor.ui.csv.sessions.get(first.key), null)
standard.release()

console.log('csv session tests ok')

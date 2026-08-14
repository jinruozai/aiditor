import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/schema.js',
  'src/ui/editor/csv/codec.js',
  'src/ui/editor/csv/format.js',
  'src/ui/editor/csv/format-csv.js',
  'src/ui/editor/csv/format-gamecsv.js',
  'src/ui/editor/csv/model.js',
  'src/ui/panel/csv-reference.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const ui = window.aiditor.ui
const csv = ui.csv

const standardSource = '\ufeffName,Count\r\n"A, one",12\r\n"line\r\ntwo",broken\r\n'
const standard = csv.model.parse(standardSource, 'csv')
assert.equal(standard.formatId, 'csv')
assert.equal(standard.textFormat.bom, true)
assert.equal(standard.textFormat.newline, '\r\n')
assert.equal(standard.textFormat.finalNewline, true)
assert.equal(standard.columns[1].name, 'Count')
assert.equal(standard.columns[1].fieldDef.type, 'var')
assert.equal(standard.rows[0].values[1], '12')
assert.equal(standard.diagnostics.length, 0)
assert.equal(csv.model.stringify(standard), standardSource)

const countHeader = "{'name':'Count','type':'int','width':96,'align':'right'}"
const enabledHeader = "{'name':'Enabled','type':'bool'}"
const gameSource = csv.codec.stringifyRows([
  ['Name', countHeader, enabledHeader],
  ['A, one', '12', 'true'],
  ['line\ntwo', 'broken', 'maybe'],
], { bom: true, newline: '\r\n', finalNewline: true })
const game = csv.model.parse(gameSource, 'gamecsv')
assert.equal(game.formatId, 'gamecsv')
assert.equal(game.columns[0].fieldDef.type, 'var')
assert.equal(game.columns[1].name, 'Count')
assert.equal(game.columns[1].fieldDef.type, 'int')
assert.equal(game.columns[1].width, 96)
assert.equal(game.rows[0].values[1], 12)
assert.equal(game.rows[0].values[2], 1)
assert.equal(game.rows[1].values[1], 'broken')
assert.equal(game.rows[1].values[2], 0)
assert.equal(game.diagnostics.length, 2)
assert.equal(csv.model.diagnosticAt(game, 1, 1).message, 'Expected integer')
assert.equal(csv.model.displayCell(game, 1, 1), 'broken')
assert.equal(csv.model.stringify(game), gameSource)

const sameHeaderAsStandard = csv.model.parse(csv.codec.stringifyRows([[countHeader], ['12']], {}), 'csv')
assert.equal(sameHeaderAsStandard.columns[0].name, countHeader)
assert.equal(sameHeaderAsStandard.columns[0].fieldDef.type, 'var')

ui.setTypeOverrides({
  id_string: { base_type: 'struct', type_render: 'struct', struct_def: { id_string: { id: 'ref_id', text: 'string' } }, default: [0, ''] },
  id_num: { base_type: 'struct', type_render: 'struct', struct_def: { id_num: { id: 'ref_id', num: 'int' } }, default: [0, 0] },
})
const complexSource = csv.codec.stringifyRows([
  ["{'name':'Tags','type':'array[string]'}", "{'name':'Owner','type':'id_string'}", "{'name':'Owners','type':'array[id_string]'}", "{'name':'Cost','type':'id_num'}", "{'name':'Rank','type_agv':{'options':[{'value':'3','label':'Three'}]},'type':'enum_int'}"],
  ["('alpha','beta')", "(1001,'Mage')", "((1001,'Mage'),(1002,'Rogue'))", '-1,005,500', '3'],
], {})
const complex = csv.model.parse(complexSource, 'gamecsv')
assert.deepEqual(complex.rows[0].values[0], ['alpha', 'beta'])
assert.deepEqual(complex.rows[0].values[1], [1001, 'Mage'])
assert.deepEqual(complex.rows[0].values[2], [[1001, 'Mage'], [1002, 'Rogue']])
assert.deepEqual(complex.rows[0].values[3], [-1005, 500])
assert.equal(complex.rows[0].values[4], 3)
assert.equal(complex.columns[4].fieldDef.type_agv.options[0].value, 3)
assert.equal(complex.diagnostics.length, 0)
assert.equal(csv.model.stringify(complex), complexSource)

const references = csv.model.parse(csv.codec.stringifyRows([
  ["{'name':'ID','type':'id','type_agv':{'ref_column':'Name'}}", "{'name':'Ref','type':'ref_id'}", 'Name'],
  ['1001', '1002', 'Alpha'],
  ['1002', '9000', 'Beta'],
], {}), 'gamecsv')
assert.equal(csv.references.resolve(references, csv.formats.resolve('gamecsv'), 1002).displayRaw, 'Beta')
assert.equal(csv.references.resolve(references, csv.formats.resolve('gamecsv'), 9000), null)

const edited = csv.model.setCell(game, 0, 1, '20')
assert.notEqual(edited, game)
assert.equal(edited.rows[0].values[1], 20)
assert.equal(edited.rows[0].rawValues[1], '20')
assert.equal(edited.rows[1], game.rows[1])

const repaired = csv.model.setCell(edited, 1, 1, '21')
assert.equal(repaired.diagnostics.length, 1)
assert.equal(repaired.rows[1].values[1], 21)

const withRows = csv.model.insertRows(repaired, 1, 2)
assert.equal(withRows.rows.length, 4)
assert.equal(withRows.rows[1].rawValues.length, withRows.columns.length)
assert.notEqual(withRows.rows[1].id, withRows.rows[2].id)

const withColumn = csv.model.insertColumn(withRows, 1, { name: 'Sequence', fieldDef: { type: 'int' } })
assert.equal(withColumn.columns.length, 4)
assert.equal(withColumn.rows.every(function (row) { return row.values.length === 4 && row.rawValues.length === 4 }), true)
const filled = csv.model.fill(csv.model.setValue(withColumn, 0, 1, 1), {
  anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 },
}, {
  anchor: { row: 0, column: 1 }, focus: { row: 3, column: 1 },
})
assert.deepEqual(filled.rows.map(function (row) { return row.values[1] }), [1, 2, 3, 4])

const updatedColumn = csv.model.updateColumn(complex, 0, { name: 'Labels' })
assert.equal(csv.codec.parseRows(csv.model.stringify(updatedColumn)).rows[0][0], "{'name':'Labels','type':'array[string]'}")

assert.throws(function () { csv.model.parse('a,b\n"open', 'csv') }, /unclosed quoted field/)
assert.throws(function () { csv.model.parse("{'name':'Broken','type':}\n1", 'gamecsv') }, /gamecsv header/)
assert.throws(function () { csv.model.parse('a\n1', 'unknown') }, /format not found/)

console.log('csv model tests ok')

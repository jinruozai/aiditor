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
  'src/ui/editor/csv/model.js',
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
const sameHeaderAsStandard = csv.model.parse(csv.codec.stringifyRows([[countHeader], ['12']], {}), 'csv')
assert.equal(sameHeaderAsStandard.columns[0].name, countHeader)
assert.equal(sameHeaderAsStandard.columns[0].fieldDef.type, 'var')

const edited = csv.model.setCell(standard, 0, 1, '20')
assert.notEqual(edited, standard)
assert.equal(edited.rows[0].values[1], '20')
assert.equal(edited.rows[0].rawValues[1], '20')
assert.equal(edited.rows[1], standard.rows[1])

const withRows = csv.model.insertRows(edited, 1, 2)
assert.equal(withRows.rows.length, 4)
assert.equal(withRows.rows[1].rawValues.length, withRows.columns.length)
assert.notEqual(withRows.rows[1].id, withRows.rows[2].id)

const withColumn = csv.model.insertColumn(withRows, 1, { name: 'Sequence', fieldDef: { type: 'int' } })
assert.equal(withColumn.columns.length, 3)
assert.equal(withColumn.rows.every(function (row) { return row.values.length === 3 && row.rawValues.length === 3 }), true)
const filled = csv.model.fill(csv.model.setValue(withColumn, 0, 1, 1), {
  anchor: { row: 0, column: 1 }, focus: { row: 0, column: 1 },
}, {
  anchor: { row: 0, column: 1 }, focus: { row: 3, column: 1 },
})
assert.deepEqual(filled.rows.map(function (row) { return row.values[1] }), ['1', '2', '3', '4'])

const updatedColumn = csv.model.updateColumn(standard, 0, { name: 'Label' })
assert.equal(csv.codec.parseRows(csv.model.stringify(updatedColumn)).rows[0][0], 'Label')

assert.throws(function () { csv.model.parse('a,b\n"open', 'csv') }, /unclosed quoted field/)
assert.throws(function () { csv.model.parse('a\n1', 'unknown') }, /format not found/)

console.log('csv model tests ok')

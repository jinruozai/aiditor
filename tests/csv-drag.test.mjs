import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let sourceOptions = null
let targetOptions = null
const ui = {
  csv: {},
  dnd: {
    matchesKind: function (data, kind) { return data.types.includes('application/aiditor.file-path.' + kind + '+json') },
    extractUrl: function (data) { return data.filePath && data.filePath.value || '' },
  },
  dragsource: function (_el, options) { sourceOptions = options },
  dropzone: function (_el, options) { targetOptions = options },
}
global.window = { aiditor: { ui: ui } }
vm.runInThisContext(readFileSync('src/ui/panel/csv-drag.js', 'utf8'), { filename: 'src/ui/panel/csv-drag.js' })

const el = { classList: { add: function () {} } }
ui.csv.drag.source(el, function () {
  return { raw: '1001', type: 'id', render: 'id', workspaceId: 'project', path: 'data/test.csv', rowId: 'r1', columnId: 'c1' }
})
const transfer = sourceOptions.getData()
assert.equal(sourceOptions.effect, 'copy')
assert.equal(transfer['text/plain'], '1001')
assert.equal(JSON.parse(transfer['application/aiditor.csv-cell+json']).render, 'id')
assert.equal(JSON.parse(transfer['application/aiditor.entity+json']).id, '1001')

let dropped = null
ui.csv.drag.target(el, 'ref_id', function (raw) { dropped = raw })
let stopped = 0
const event = {
  stopPropagation: function () { stopped++ },
  dataTransfer: { getData: function (type) { return type === 'application/aiditor.csv-cell+json' ? transfer[type] : '' } },
}
assert.equal(targetOptions.canDrop({ types: ['application/aiditor.csv-cell.id+json'] }, event), true)
targetOptions.onDrop({ types: ['application/aiditor.csv-cell.id+json'] }, event)
assert.equal(dropped, '1001')
assert.equal(stopped, 2)

ui.csv.drag.source(el, function () { return { raw: 'assets/icon.png', type: 'img', render: 'img' } })
const imageTransfer = sourceOptions.getData()
assert.equal(JSON.parse(imageTransfer['application/aiditor.file-path.image+json']).value, 'assets/icon.png')

console.log('csv drag tests ok')

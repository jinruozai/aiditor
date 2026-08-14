import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const gridListeners = new Map()
const documentListeners = new Map()
const classes = new Set()
const viewport = { scrollLeft: 120, scrollTop: 80 }
const grid = {
  querySelector: function () { return viewport },
  addEventListener: function (type, handler) { gridListeners.set(type, handler) },
  removeEventListener: function (type) { gridListeners.delete(type) },
  classList: {
    add: function (name) { classes.add(name) },
    remove: function (name) { classes.delete(name) },
  },
}

global.document = {
  addEventListener: function (type, handler) { documentListeners.set(type, handler) },
  removeEventListener: function (type) { documentListeners.delete(type) },
}
global.window = { aiditor: { ui: { csv: {} } } }
vm.runInThisContext(readFileSync('src/ui/panel/csv-pan.js', 'utf8'), { filename: 'src/ui/panel/csv-pan.js' })

let prevented = 0
let stopped = 0
const dispose = window.aiditor.ui.csv.pan.attach(grid)
gridListeners.get('pointerdown')({
  button: 1,
  pointerId: 7,
  clientX: 200,
  clientY: 100,
  preventDefault: function () { prevented++ },
  stopPropagation: function () { stopped++ },
})

assert.equal(classes.has('aiditor-csv-panning'), true)
documentListeners.get('pointermove')({ pointerId: 7, clientX: 230, clientY: 115 })
assert.equal(viewport.scrollLeft, 90, 'dragging right must move the sheet right')
assert.equal(viewport.scrollTop, 65, 'dragging down must move the sheet down')
documentListeners.get('pointerup')({ pointerId: 7 })
assert.equal(classes.has('aiditor-csv-panning'), false)
assert.equal(prevented, 1)
assert.equal(stopped, 1)

viewport.scrollLeft = 120
viewport.scrollTop = 80
gridListeners.get('pointerdown')({
  button: 1,
  pointerId: 8,
  clientX: 200,
  clientY: 100,
  preventDefault: function () {},
  stopPropagation: function () {},
})
let escapePrevented = 0
documentListeners.get('keydown')({
  key: 'Escape',
  preventDefault: function () { escapePrevented++ },
  stopPropagation: function () {},
})
assert.equal(classes.has('aiditor-csv-panning'), false)
assert.equal(escapePrevented, 1)

let auxPrevented = 0
gridListeners.get('auxclick')({ button: 1, preventDefault: function () { auxPrevented++ } })
assert.equal(auxPrevented, 1)
dispose()

console.log('csv pan tests ok')

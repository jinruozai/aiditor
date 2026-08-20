import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })

const aiditor = window.aiditor

const a = aiditor.signal(1)
let runs = 0
let cleanups = 0
const stop = aiditor.effect(function () {
  runs++
  a()
  aiditor.onCleanup(function () { cleanups++ })
})
assert.equal(runs, 1)
a.set(2)
assert.equal(runs, 2)
assert.equal(cleanups, 1)
stop()
assert.equal(cleanups, 2)
a.set(3)
assert.equal(runs, 2)

const b = aiditor.signal(2)
const c = aiditor.derived(function () { return a() + b() })
assert.equal(c(), 5)
b.set(5)
assert.equal(c(), 8)
c.dispose()

let batched = 0
const x = aiditor.signal(0)
aiditor.effect(function () { x(); batched++ })
aiditor.batch(function () {
  x.set(1)
  x.set(2)
})
assert.equal(batched, 2)

const self = aiditor.signal(0)
assert.throws(function () {
  aiditor.effect(function () { self.set(self() + 1) })
}, /reactive cycle detected/)

const left = aiditor.signal(0)
const right = aiditor.signal(0)
aiditor.effect(function () { right.set(left()) })
assert.throws(function () {
  aiditor.effect(function () { left.set(right() + 1) })
}, /reactive cycle detected/)

console.log('signal tests ok')

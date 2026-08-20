import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/ui/_internal/_signal.js', 'utf8'), { filename: 'ui/_internal/_signal.js' })
vm.runInThisContext(readFileSync('src/ui/_internal/_edit-session.js', 'utf8'), { filename: 'ui/_internal/_edit-session.js' })

const ui = window.aiditor.ui

function field(value) {
  return {
    value: value || '',
    listeners: {},
    __aiditorCleanups: [],
    addEventListener: function (type, fn) { this.listeners[type] = fn },
    removeEventListener: function (type) { delete this.listeners[type] },
    focus: function () { document.activeElement = this; this.listeners.focus && this.listeners.focus({ target: this }) },
    blur: function () { document.activeElement = null; this.listeners.blur && this.listeners.blur({ target: this }) },
  }
}

function key(el, key, extra) {
  const ev = Object.assign({
    key: key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault: function () { this.defaultPrevented = true },
  }, extra || {})
  el.listeners.keydown(ev)
  return ev
}

global.document = { activeElement: null }

{
  const el = field('old')
  let committed = ''
  ui.editSession({ el: el, onCommit: function (v) { committed = v } })
  el.focus()
  el.value = 'new'
  const ev = key(el, 'Enter')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(committed, 'new')
  assert.equal(document.activeElement, null)
}

{
  const el = field('old')
  let written = ''
  ui.editSession({
    el: el,
    set: function (v) { written = v; el.value = v },
  })
  el.focus()
  el.value = 'draft'
  const ev = key(el, 'Escape')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(written, 'old')
  assert.equal(el.value, 'old')
}

{
  const el = field('line one')
  let count = 0
  ui.editSession({ el: el, multiline: true, submitMode: 'modifier', onCommit: function () { count++ } })
  el.focus()
  el.value = 'line one\nline two'
  assert.equal(key(el, 'Enter').defaultPrevented, false)
  assert.equal(count, 0)
  assert.equal(key(el, 'Enter', { ctrlKey: true }).defaultPrevented, true)
  assert.equal(count, 1)
}

{
  const el = field('hello')
  let count = 0
  ui.editSession({ el: el, multiline: true, submitMode: 'enter', onCommit: function () { count++ } })
  el.focus()
  assert.equal(key(el, 'Enter', { shiftKey: true }).defaultPrevented, false)
  assert.equal(count, 0)
  assert.equal(key(el, 'Enter').defaultPrevented, true)
  assert.equal(count, 1)
}

{
  let value = [1, 2]
  const writes = []
  const edit = ui.editGesture({
    get: function () { return value },
    write: function (next, meta) { value = next; writes.push({ value: next, edit: meta.edit }) },
  })
  edit.begin('test.scrub')
  edit.update([3, 2])
  edit.update([4, 2])
  edit.commit()
  assert.deepEqual(writes.map(function (item) { return item.edit.phase }), ['update', 'update', 'commit'])
  assert.equal(new Set(writes.map(function (item) { return item.edit.id })).size, 1)
  assert.deepEqual(writes[0].edit.initialValue, [1, 2])
  assert.deepEqual(writes[2].value, [4, 2])

  edit.begin('test.cancel')
  edit.update([9, 2])
  edit.cancel()
  assert.equal(writes[writes.length - 1].edit.phase, 'cancel')
  assert.deepEqual(value, [4, 2])
}

console.log('ui edit session tests ok')

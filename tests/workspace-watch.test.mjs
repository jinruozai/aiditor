import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const windowEvents = new Map()
const documentEvents = new Map()
const intervals = new Map()
let intervalId = 0

global.document = {
  visibilityState: 'visible',
  addEventListener: function (type, listener) { documentEvents.set(type, listener) },
  removeEventListener: function (type, listener) {
    if (documentEvents.get(type) === listener) documentEvents.delete(type)
  },
}

global.window = {
  aiditor: {},
  addEventListener: function (type, listener) { windowEvents.set(type, listener) },
  removeEventListener: function (type, listener) {
    if (windowEvents.get(type) === listener) windowEvents.delete(type)
  },
}

const realSetInterval = global.setInterval
const realClearInterval = global.clearInterval
global.setInterval = function (listener) {
  const id = ++intervalId
  intervals.set(id, listener)
  return id
}
global.clearInterval = function (id) { intervals.delete(id) }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/workspace.js',
  'src/core/workspace-watch.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

let nextEntryId = 0

class FakeFileHandle {
  constructor(name, text) {
    this.kind = 'file'
    this.name = name
    this.id = ++nextEntryId
    this.setText(text || '')
  }

  setText(text) {
    this.text = String(text)
    this.mtime = (this.mtime || 0) + 1
  }

  async getFile() {
    const text = this.text
    const blob = new Blob([text], { type: 'text/plain' })
    return {
      size: blob.size,
      type: blob.type,
      lastModified: this.mtime,
      text: async function () { return text },
      arrayBuffer: function () { return blob.arrayBuffer() },
    }
  }

  async createWritable() {
    const handle = this
    let value = ''
    return {
      write: async function (next) { value = next instanceof Blob ? await next.text() : String(next) },
      close: async function () { handle.setText(value) },
    }
  }

  async isSameEntry(other) { return !!other && other.id === this.id }
}

class SlowFileHandle extends FakeFileHandle {
  constructor(name, text) {
    super(name, text)
    this.blocked = false
    this.activeReads = 0
    this.maxActiveReads = 0
    this.releases = []
  }

  async getFile() {
    this.activeReads++
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads)
    if (this.blocked) await new Promise((resolve) => this.releases.push(resolve))
    const file = await super.getFile()
    this.activeReads--
    return file
  }

  release() {
    this.blocked = false
    while (this.releases.length) this.releases.shift()()
  }
}

class FakeDirectoryHandle {
  constructor(name) {
    this.kind = 'directory'
    this.name = name
    this.id = ++nextEntryId
    this.entries = new Map()
    this.permission = 'granted'
  }

  add(handle) {
    this.entries.set(handle.name, handle)
    return handle
  }

  remove(name) { return this.entries.delete(name) }

  async *values() {
    for (const handle of this.entries.values()) yield handle
  }

  async getDirectoryHandle(name, opts) {
    const found = this.entries.get(name)
    if (found && found.kind === 'directory') return found
    if (found || !(opts && opts.create)) throw new DOMException('Directory not found', 'NotFoundError')
    return this.add(new FakeDirectoryHandle(name))
  }

  async getFileHandle(name, opts) {
    const found = this.entries.get(name)
    if (found && found.kind === 'file') return found
    if (found || !(opts && opts.create)) throw new DOMException('File not found', 'NotFoundError')
    return this.add(new FakeFileHandle(name, ''))
  }

  async queryPermission() { return this.permission }
  async requestPermission() { return this.permission }
  async isSameEntry(other) { return !!other && other.id === this.id }
}

class FakeObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    FakeObserver.instances.push(this)
  }

  async observe(handle, options) {
    this.handle = handle
    this.options = options
  }

  disconnect() { this.disconnected = true }

  emit(records) {
    if (!this.disconnected) this.callback(records, this)
  }
}

function waitForBatch() {
  return new Promise(function (resolve) { setTimeout(resolve, 100) })
}

function record(type, path, from) {
  const value = { type: type, relativePathComponents: path ? path.split('/') : [] }
  if (from != null) value.relativePathMovedFrom = from ? from.split('/') : []
  return value
}

function flatten(batches) {
  return batches.flatMap(function (batch) { return batch.changes })
}

window.FileSystemObserver = FakeObserver

const root = new FakeDirectoryHandle('project')
const src = root.add(new FakeDirectoryHandle('src'))
const archive = root.add(new FakeDirectoryHandle('archive'))
const original = src.add(new FakeFileHandle('original.txt', 'one'))
const ws = window.aiditor.workspace.fromHandle(root)
assert.equal(ws.capabilities().watch, true)
assert.equal(window.aiditor.workspace.memory().capabilities().watch, false)
assert.equal(window.aiditor.workspace.fromBridge({
  capabilities: function () { return { watch: true } },
}).capabilities().watch, false)

const batches = []
const cancel = ws.watch('', function (batch) { batches.push(batch) })
await waitForBatch()
const observer = FakeObserver.instances.at(-1)
assert.equal(observer.handle, root)
assert.deepEqual(observer.options, { recursive: true })
const observerCount = FakeObserver.instances.length
const cancelSecond = ws.watch('src', function () {})
assert.equal(FakeObserver.instances.length, observerCount)

const created = src.add(new FakeFileHandle('created.txt', 'new'))
observer.emit([record('appeared', 'src/created.txt'), record('appeared', 'src/created.txt')])
await waitForBatch()
assert.deepEqual(flatten(batches), [{ type: 'created', path: 'src/created.txt', kind: 'file' }])

batches.length = 0
created.setText('newer')
observer.emit([record('modified', 'src/created.txt'), record('modified', 'src/created.txt')])
await waitForBatch()
assert.deepEqual(flatten(batches), [{ type: 'modified', path: 'src/created.txt', kind: 'file' }])

batches.length = 0
src.remove('created.txt')
observer.emit([record('disappeared', 'src/created.txt')])
await waitForBatch()
assert.deepEqual(flatten(batches), [{ type: 'deleted', path: 'src/created.txt', kind: 'file' }])

batches.length = 0
src.remove('original.txt')
original.name = 'renamed.txt'
archive.add(original)
observer.emit([record('moved', 'archive/renamed.txt', 'src/original.txt')])
await waitForBatch()
assert.deepEqual(flatten(batches), [{ type: 'moved', path: 'archive/renamed.txt', fromPath: 'src/original.txt', kind: 'file' }])

batches.length = 0
src.add(new FakeFileHandle('unknown.txt', 'found by scan'))
observer.emit([record('unknown', 'src')])
await waitForBatch()
assert.deepEqual(flatten(batches), [{ type: 'created', path: 'src/unknown.txt', kind: 'file' }])

batches.length = 0
await ws.writeText('archive/renamed.txt', 'workspace write', { overwrite: true })
observer.emit([record('modified', 'archive/renamed.txt'), record('modified', 'archive/renamed.txt')])
await waitForBatch()
assert.deepEqual(batches, [])

cancel()
cancel()
assert.equal(observer.disconnected, false)
cancelSecond()
assert.equal(observer.disconnected, true)
src.add(new FakeFileHandle('after-cancel.txt', 'ignored'))
observer.emit([record('appeared', 'src/after-cancel.txt')])
await waitForBatch()
assert.deepEqual(batches, [])

const observerCountBeforeImmediateCancel = FakeObserver.instances.length
const immediateWs = window.aiditor.workspace.fromHandle(new FakeDirectoryHandle('immediate'))
const immediateCancel = immediateWs.watch('', function () {})
immediateCancel()
immediateWs.dispose()
await waitForBatch()
assert.equal(FakeObserver.instances.length, observerCountBeforeImmediateCancel)

const permissionRoot = new FakeDirectoryHandle('permission')
const permissionWs = window.aiditor.workspace.fromHandle(permissionRoot)
const permissionBatches = []
permissionWs.watch('nested/file.txt', function (batch) { permissionBatches.push(batch) })
await waitForBatch()
const permissionObserver = FakeObserver.instances.at(-1)
permissionRoot.permission = 'denied'
permissionObserver.emit([record('errored', '')])
await waitForBatch()
assert.deepEqual(flatten(permissionBatches), [{
  type: 'unavailable', path: '', kind: 'directory', reason: 'permission_lost',
}])
assert.equal(permissionObserver.disconnected, true)
permissionWs.dispose()

delete window.FileSystemObserver
const fallbackRoot = new FakeDirectoryHandle('fallback')
const fallbackWs = window.aiditor.workspace.fromHandle(fallbackRoot)
const fallbackBatches = []
fallbackWs.watch('', function (batch) { fallbackBatches.push(batch) })
await waitForBatch()
assert.equal(intervals.size, 1)
fallbackRoot.add(new FakeFileHandle('polled.txt', 'poll'))
Array.from(intervals.values())[0]()
await waitForBatch()
assert.deepEqual(flatten(fallbackBatches), [{ type: 'created', path: 'polled.txt', kind: 'file' }])
assert.equal(fallbackBatches[0].source, 'poll')

fallbackBatches.length = 0
fallbackRoot.add(new FakeFileHandle('focused.txt', 'focus'))
windowEvents.get('focus')()
await waitForBatch()
assert.deepEqual(flatten(fallbackBatches), [{ type: 'created', path: 'focused.txt', kind: 'file' }])
assert.equal(fallbackBatches[0].source, 'focus')

fallbackBatches.length = 0
const slow = fallbackRoot.add(new SlowFileHandle('slow.txt', 'before'))
Array.from(intervals.values())[0]()
await waitForBatch()
fallbackBatches.length = 0
slow.setText('after')
slow.blocked = true
Array.from(intervals.values())[0]()
await new Promise(function (resolve) { setTimeout(resolve, 80) })
assert.equal(slow.activeReads, 1)
Array.from(intervals.values())[0]()
Array.from(intervals.values())[0]()
await new Promise(function (resolve) { setTimeout(resolve, 20) })
assert.equal(slow.maxActiveReads, 1)
slow.release()
await waitForBatch()
assert.deepEqual(flatten(fallbackBatches), [{ type: 'modified', path: 'slow.txt', kind: 'file' }])

fallbackWs.dispose()
assert.equal(intervals.size, 0)
assert.equal(windowEvents.has('focus'), false)
assert.equal(documentEvents.has('visibilitychange'), false)

global.setInterval = realSetInterval
global.clearInterval = realClearInterval

console.log('workspace watch tests ok')

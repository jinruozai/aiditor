import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/workspace.js',
  'src/core/workspace-watch.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ws = aiditor.workspace.memory({
  'src/panel.js': 'one\ntwo\nthree\n',
  'data/items.json': '{"items":[]}',
})

assert.throws(function () { aiditor.workspace.normalizePath('../secret') }, /escapes root/)
assert.equal(aiditor.workspace.normalizePath('src\\./panel.js'), 'src/panel.js')

const read = await ws.readText('src/panel.js')
assert.equal(read.text, 'one\ntwo\nthree\n')
assert.equal(read.hash, aiditor.workspace.hashText(read.text))

const patched = await ws.patchText('src/panel.js', read.hash, [
  { startLine: 2, endLine: 2, replacement: 'TWO' },
])
assert.equal(patched.text, 'one\nTWO\nthree\n')

const found = await ws.search('TWO', { limit: 5 })
assert.equal(found.matches.length, 1)
assert.equal(found.matches[0].path, 'src/panel.js')
assert.equal(found.matches[0].line, 2)
assert.equal(found.matches[0].column, 1)
assert.equal(found.matches[0].fileHash, patched.hash)
assert.equal(found.matches[0].previewEndLine, 4)
assert.deepEqual(found.errors, [])

const regexFound = await ws.search('t.o', { mode: 'regex', caseSensitive: false, limit: 5 })
assert.equal(regexFound.matches.some(function (item) { return item.path === 'src/panel.js' && item.matchText === 'TWO' }), true)
const included = await ws.search('items', { include: ['data/*.json'], limit: 5 })
assert.equal(included.matches.length, 1)
assert.equal(included.matches[0].path, 'data/items.json')

const editedText = aiditor.workspace.applyTextEdits('alpha\nbeta\n', aiditor.workspace.hashText('alpha\nbeta\n'), [
  { oldText: 'beta', newText: 'BETA' },
])
assert.equal(editedText, 'alpha\nBETA\n')
assert.throws(function () {
  aiditor.workspace.applyTextEdits('same\nsame\n', aiditor.workspace.hashText('same\nsame\n'), [
    { oldText: 'same', newText: 'other' },
  ])
}, /matched more than once/)

await ws.writeText('src/new.js', 'hello')
await assert.rejects(async function () { return ws.writeText('src/new.js', 'replace') }, /existing target/)
const newHash = (await ws.stat('src/new.js')).hash
await ws.writeText('src/new.js', 'replace', { baseHash: newHash })
assert.equal((await ws.readText('src/new.js')).text, 'replace')
assert.equal((await ws.stat('src/new.js')).kind, 'file')
assert.equal((await ws.list('src')).some(function (item) { return item.path === 'src/new.js' }), true)

await ws.delete('src/new.js')
await assert.rejects(async function () { return ws.readText('src/new.js') }, /file not found/)

await ws.mkdir('assets/images')
await ws.writeBlob('assets/images/logo.bin', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }))
const blobRead = await ws.readBlob('assets/images/logo.bin')
assert.equal(blobRead.size, 3)
assert.equal(blobRead.mime, 'application/octet-stream')
assert.equal((await ws.stat('assets/images/logo.bin')).hash, blobRead.hash)
await ws.copy('assets/images/logo.bin', 'assets/images/copy.bin')
await assert.rejects(async function () { return ws.copy('assets/images/logo.bin', 'assets/images/copy.bin') }, /existing target/)
assert.equal((await ws.stat('assets/images/copy.bin')).kind, 'file')
await ws.move('assets/images/copy.bin', 'assets/images/moved.bin')
await assert.rejects(async function () { return ws.stat('assets/images/copy.bin') }, /path not found/)
assert.equal((await ws.stat('assets/images/moved.bin')).kind, 'file')
await assert.rejects(async function () { return ws.delete('assets') }, /directory is not empty/)
await ws.delete('assets', { recursive: true })
await assert.rejects(async function () { return ws.stat('assets/images/moved.bin') }, /path not found/)

await ws.writeText('undo.txt', 'before')
const snapshot = await ws.snapshot('undo.txt')
await ws.writeText('undo.txt', 'after', { baseHash: aiditor.workspace.hashText('before') })
await ws.restoreSnapshot(snapshot, { baseHash: aiditor.workspace.hashText('after') })
assert.equal((await ws.readText('undo.txt')).text, 'before')
assert.equal((await ws.capabilities()).mkdir, true)
assert.equal((await ws.capabilities()).revealInSystem, false)
assert.equal((await ws.capabilities()).pickSaveTarget, false)
assert.deepEqual(await ws.revealInSystem('undo.txt', { select: true }), { ok: false, reason: 'unsupported' })
await assert.rejects(function () { return ws.pickSaveTarget() }, function (err) {
  assert.equal(err.code, 'UNSUPPORTED')
  assert.equal(err.reason, 'unsupported')
  return true
})

const createPreview = await ws.previewOperation({ op: 'writeText', path: 'preview/create.txt', text: 'one' })
await ws.writeText('preview/create.txt', 'raced')
await assert.rejects(async function () { return ws.applyOperation(createPreview) }, /target appeared/)
const updateBase = await ws.readText('preview/create.txt')
const updatePreview = await ws.previewOperation({ op: 'writeText', path: 'preview/create.txt', text: 'two', baseHash: updateBase.hash })
await ws.writeText('preview/create.txt', 'three', { baseHash: updateBase.hash })
await assert.rejects(async function () { return ws.applyOperation(updatePreview) }, /hash changed/)
const overwritePreview = await ws.previewOperation({ op: 'writeText', path: 'preview/create.txt', text: 'forced', overwrite: true })
await assert.rejects(async function () { return ws.applyOperation(overwritePreview, { confirmWarnings: true }) }, /confirmOverwrite/)
await ws.applyOperation(overwritePreview, { confirmWarnings: true, confirmOverwrite: true })
assert.equal((await ws.readText('preview/create.txt')).text, 'forced')
await ws.mkdir('tree')
await ws.writeText('tree/a.txt', 'a')
const deletePreview = await ws.previewOperation({ op: 'delete', path: 'tree', recursive: true })
await ws.writeText('tree/b.txt', 'b')
await assert.rejects(async function () { return ws.applyOperation(deletePreview, { confirmWarnings: true }) }, /directory contents changed/)
await assert.rejects(async function () { return ws.snapshot('tree', { recursive: true, maxMemoryBytes: 1 }) }, /maxMemoryBytes/)

class FakeFileHandle {
  constructor(name, parent, text, opts) {
    this.kind = 'file'
    this.name = name
    this.parent = parent
    this.text = text || ''
    this.opts = opts || {}
  }
  async getFile() {
    if (this.opts.failRead) throw Object.assign(new Error('cannot read file'), { name: 'NotReadableError' })
    const self = this
    const blob = new Blob([self.text], { type: 'text/plain' })
    return {
      size: blob.size,
      type: blob.type,
      lastModified: 1,
      async text() { return self.text },
      arrayBuffer() { return blob.arrayBuffer() },
    }
  }
  async createWritable() {
    if (this.opts.failWrite) throw Object.assign(new Error('permission denied'), { name: 'NotAllowedError' })
    const self = this
    return {
      async write(text) { self.text = String(text) },
      async close() {},
    }
  }
}

class FakeDirHandle {
  constructor(name) {
    this.kind = 'directory'
    this.name = name
    this.entries = {}
  }
  async getDirectoryHandle(name, opts) {
    if (!this.entries[name] && opts && opts.create) this.entries[name] = new FakeDirHandle(name)
    const entry = this.entries[name]
    if (!entry || entry.kind !== 'directory') throw new Error('directory not found: ' + name)
    return entry
  }
  async getFileHandle(name, opts) {
    if (!this.entries[name] && opts && opts.create) this.entries[name] = new FakeFileHandle(name, this, '')
    const entry = this.entries[name]
    if (!entry || entry.kind !== 'file') throw new Error('file not found: ' + name)
    return entry
  }
  async removeEntry(name) {
    delete this.entries[name]
  }
  async *values() {
    for (const name of Object.keys(this.entries)) yield this.entries[name]
  }
  async resolve(handle) {
    async function visit(dir, path) {
      for (const name of Object.keys(dir.entries)) {
        const entry = dir.entries[name]
        const next = path.concat(name)
        if (entry === handle) return next
        if (entry.kind === 'directory') {
          const found = await visit(entry, next)
          if (found) return found
        }
      }
      return null
    }
    return visit(this, [])
  }
}

class FlakyDirHandle extends FakeDirHandle {
  constructor(name) {
    super(name)
    this.listCalls = 0
  }
  async *values() {
    this.listCalls++
    if (this.listCalls === 1) throw new Error('A requested file or directory could not be found at the time an operation was processed.')
    yield * super.values()
  }
}

class MissingDirHandle extends FakeDirHandle {
  constructor(name) {
    super(name)
    this.listCalls = 0
  }
  async *values() {
    this.listCalls++
    throw new Error('A requested file or directory could not be found at the time an operation was processed.')
  }
}

function installFakeIndexedDB() {
  const data = {}
  global.indexedDB = {
    open: function () {
      const req = {}
      setTimeout(function () {
        const db = {
          createObjectStore: function () {},
          transaction: function () {
            const tx = {
              objectStore: function () {
                return {
                  put: function (value, key) {
                    const out = {}
                    setTimeout(function () {
                      data[String(key)] = value
                      if (out.onsuccess) out.onsuccess()
                      if (tx.oncomplete) tx.oncomplete()
                    }, 0)
                    return out
                  },
                  get: function (key) {
                    const out = {}
                    setTimeout(function () {
                      out.result = data[String(key)] || null
                      if (out.onsuccess) out.onsuccess()
                      if (tx.oncomplete) tx.oncomplete()
                    }, 0)
                    return out
                  },
                }
              },
            }
            return tx
          },
          close: function () {},
        }
        req.result = db
        if (req.onupgradeneeded) req.onupgradeneeded()
        if (req.onsuccess) req.onsuccess()
      }, 0)
      return req
    },
  }
}

class PermissionDirHandle extends FakeDirHandle {
  constructor(name, permission, requestResult) {
    super(name)
    this.permission = permission
    this.requestResult = requestResult
    this.queryCalls = []
    this.requestCalls = []
  }
  async queryPermission(opts) {
    this.queryCalls.push(opts)
    return this.permission
  }
  async requestPermission(opts) {
    this.requestCalls.push(opts)
    this.permission = this.requestResult
    return this.requestResult
  }
}

installFakeIndexedDB()
let pickerCalls = 0
window.showDirectoryPicker = async function () {
  pickerCalls++
  throw new Error('restoreDirectory must not call showDirectoryPicker')
}

const rememberedGranted = new PermissionDirHandle('remembered-granted', 'granted')
await aiditor.workspace.saveDirectoryHandle('remembered-granted', rememberedGranted)
const restoredGranted = await aiditor.workspace.restoreDirectory('remembered-granted', { mode: 'read' })
assert.equal(restoredGranted.rootId(), 'remembered-granted')
assert.deepEqual(rememberedGranted.queryCalls, [{ mode: 'read' }])
assert.equal(rememberedGranted.requestCalls.length, 0)

const rememberedPromptNoRequest = new PermissionDirHandle('remembered-prompt-no-request', 'prompt', 'granted')
await aiditor.workspace.saveDirectoryHandle('remembered-prompt-no-request', rememberedPromptNoRequest)
assert.equal(await aiditor.workspace.restoreDirectory('remembered-prompt-no-request', { requestPermission: false }), null)
assert.equal(rememberedPromptNoRequest.requestCalls.length, 0)

const rememberedPromptGranted = new PermissionDirHandle('remembered-prompt-granted', 'prompt', 'granted')
await aiditor.workspace.saveDirectoryHandle('remembered-prompt-granted', rememberedPromptGranted)
const restoredPromptGranted = await aiditor.workspace.restoreDirectory('remembered-prompt-granted', { mode: 'readwrite', requestPermission: true })
assert.equal(restoredPromptGranted.rootId(), 'remembered-prompt-granted')
assert.deepEqual(rememberedPromptGranted.queryCalls, [{ mode: 'readwrite' }])
assert.deepEqual(rememberedPromptGranted.requestCalls, [{ mode: 'readwrite' }])

const rememberedPromptDenied = new PermissionDirHandle('remembered-prompt-denied', 'prompt', 'denied')
await aiditor.workspace.saveDirectoryHandle('remembered-prompt-denied', rememberedPromptDenied)
assert.equal(await aiditor.workspace.restoreDirectory('remembered-prompt-denied', { requestPermission: true }), null)
assert.deepEqual(rememberedPromptDenied.requestCalls, [{ mode: 'readwrite' }])

const rememberedDenied = new PermissionDirHandle('remembered-denied', 'denied', 'granted')
await aiditor.workspace.saveDirectoryHandle('remembered-denied', rememberedDenied)
assert.equal(await aiditor.workspace.restoreDirectory('remembered-denied', { requestPermission: true }), null)
assert.equal(rememberedDenied.requestCalls.length, 0)
assert.equal(await aiditor.workspace.restoreDirectory('missing-remembered-directory', { requestPermission: true }), null)
assert.equal(pickerCalls, 0)

const root = new FakeDirHandle('root')
const src = await root.getDirectoryHandle('src', { create: true })
const nested = await root.getDirectoryHandle('nested', { create: true })
src.entries['panel.js'] = new FakeFileHandle('panel.js', src, 'alpha\nbeta\n')
nested.entries['other.js'] = new FakeFileHandle('other.js', nested, 'beta\n')
src.entries['export.csv'] = new FakeFileHandle('export.csv', src, '')
src.entries['wrong.txt'] = new FakeFileHandle('wrong.txt', src, '')
let saveTargetHandle = src.entries['export.csv']
let savePickerOptions = null
window.showSaveFilePicker = async function (opts) {
  savePickerOptions = opts
  if (saveTargetHandle instanceof Error) throw saveTargetHandle
  return saveTargetHandle
}
const fsa = aiditor.workspace.fromHandle(root)
const fsaRead = await fsa.readText('src/panel.js')
assert.equal(fsaRead.hash, (await fsa.stat('src/panel.js')).hash)
assert.equal((await fsa.capabilities()).pickSaveTarget, true)
assert.equal(await fsa.pickSaveTarget({
  suggestedName: 'export',
  extensions: ['csv'],
  description: 'CSV file',
  mimeType: 'text/csv',
}), 'src/export.csv')
assert.equal(savePickerOptions.startIn, root)
assert.equal(savePickerOptions.suggestedName, 'export.csv')
assert.deepEqual(savePickerOptions.types, [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }])
assert.equal(savePickerOptions.excludeAcceptAllOption, true)

saveTargetHandle = src.entries['wrong.txt']
await assert.rejects(function () {
  return fsa.pickSaveTarget({ extensions: ['.csv'] })
}, function (err) {
  assert.equal(err.code, 'INVALID_EXTENSION')
  return true
})

saveTargetHandle = new FakeFileHandle('outside.csv', null, '')
await assert.rejects(function () {
  return fsa.pickSaveTarget({ extensions: ['.csv'] })
}, function (err) {
  assert.equal(err.code, 'OUTSIDE_WORKSPACE')
  assert.equal(err.reason, 'outside_workspace')
  return true
})

saveTargetHandle = Object.assign(new Error('cancel'), { name: 'AbortError' })
assert.equal(await fsa.pickSaveTarget({ extensions: ['.csv'] }), null)
saveTargetHandle = src.entries['export.csv']
assert.equal((await fsa.search('beta', { path: 'src', limit: 10 })).matches.length, 1)
assert.equal((await fsa.search('beta', { path: 'src/panel.js', limit: 10 })).matches[0].path, 'src/panel.js')
assert.equal((await fsa.capabilities()).search, true)
assert.equal((await fsa.capabilities()).revealInSystem, false)
assert.deepEqual(await fsa.revealInSystem('src/panel.js'), { ok: false, reason: 'unsupported' })
const flakyRoot = new FlakyDirHandle('flaky')
flakyRoot.entries['game.mors'] = new FakeFileHandle('game.mors', flakyRoot, '')
const flakyWorkspace = aiditor.workspace.fromHandle(flakyRoot)
assert.deepEqual(await flakyWorkspace.list(''), [{ path: 'game.mors', name: 'game.mors', kind: 'file' }])
assert.equal(flakyRoot.listCalls, 2)
const missingRoot = new MissingDirHandle('missing')
const missingWorkspace = aiditor.workspace.fromHandle(missingRoot)
await assert.rejects(function () { return missingWorkspace.list('') }, function (err) {
  assert.equal(err.reason, 'not_found')
  assert.equal(err.path, '')
  return true
})
assert.equal(missingRoot.listCalls, 2)
src.entries['bad.bin'] = new FakeFileHandle('bad.bin', src, '', { failRead: true })
await assert.rejects(async function () { return fsa.readBlob('src/bad.bin') }, function (err) {
  assert.equal(err.path, 'src/bad.bin')
  assert.equal(err.op, 'readBlob')
  assert.equal(err.reason, 'not_readable')
  assert.equal(err.code, 'NOT_READABLE')
  return true
})
await assert.rejects(async function () { return fsa.snapshot('src', { recursive: true }) }, function (err) {
  assert.equal(err.path, 'src/bad.bin')
  assert.equal(err.op, 'snapshot')
  assert.equal(err.reason, 'not_readable')
  assert.equal(err.rootPath, 'src')
  return true
})

const bridgeFiles = {
  'src/ok.js': 'alpha\nbeta\n',
  'src/large.js': 'beta'.repeat(20),
}
const searchBridge = aiditor.workspace.fromBridge({
  rootId: function () { return 'bridge-test' },
  kind: function () { return 'bridge' },
  capabilities: function () { return { list: true, readText: true, search: false } },
  list: function (path) {
    if (!path) return Promise.resolve([{ path: 'src', name: 'src', kind: 'directory' }])
    if (path === 'src') return Promise.resolve([
      { path: 'src/bad.js', name: 'bad.js', kind: 'file', size: 4 },
      { path: 'src/large.js', name: 'large.js', kind: 'file', size: bridgeFiles['src/large.js'].length },
      { path: 'src/ok.js', name: 'ok.js', kind: 'file', size: bridgeFiles['src/ok.js'].length },
    ])
    return Promise.reject(new Error('not a directory'))
  },
  readText: function (path) {
    if (path === 'src/bad.js') return Promise.reject(Object.assign(new Error('bridge read failed'), { code: 'NOT_READABLE' }))
    return Promise.resolve({ path: path, text: bridgeFiles[path], size: bridgeFiles[path].length, hash: null, mtime: null })
  },
})
assert.equal(searchBridge.capabilities().search, true)
const bridgeSearch = await searchBridge.search('beta', { maxFileBytes: 40, limit: 10 })
assert.deepEqual(bridgeSearch.matches.map(function (item) { return item.path }), ['src/ok.js'])
assert.equal(bridgeSearch.scannedFiles, 3)
assert.equal(bridgeSearch.skippedFiles, 2)
assert.equal(bridgeSearch.errors.some(function (item) { return item.path === 'src/bad.js' && item.op === 'readText' }), true)
assert.equal(bridgeSearch.errors.some(function (item) { return item.path === 'src/large.js' && item.reason === 'size_limit' }), true)
assert.equal(bridgeSearch.limitHit, true)
await assert.rejects(function () { return searchBridge.search('[', { mode: 'regex' }) }, function (err) {
  assert.equal(err.code, 'INVALID_REGEX')
  assert.equal(err.op, 'search')
  return true
})
await fsa.delete('src/panel.js')
await assert.rejects(async function () { return fsa.readText('src/panel.js') }, /file not found/)

const writableRoot = new FakeDirHandle('writable')
const writableSrc = await writableRoot.getDirectoryHandle('src', { create: true })
writableSrc.entries['ok.txt'] = new FakeFileHandle('ok.txt', writableSrc, 'ok')
const writable = aiditor.workspace.fromHandle(writableRoot)
const writableSnapshot = await writable.snapshot('src/ok.txt')
writableSrc.entries['blocked.txt'] = new FakeFileHandle('blocked.txt', writableSrc, '', { failWrite: true })
await assert.rejects(async function () {
  return writable.restoreSnapshot(writableSnapshot, { targetPath: 'src/blocked.txt', overwrite: true })
}, function (err) {
  assert.equal(err.path, 'src/blocked.txt')
  assert.equal(err.op, 'restoreSnapshot')
  assert.equal(err.reason, 'permission_denied')
  assert.equal(err.permissionRecovery, true)
  return true
})

const revealed = []
const bridge = aiditor.workspace.fromBridge({
  kind: function () { return 'bridge' },
  rootId: function () { return 'bridge' },
  stat: async function (path) {
    if (path === 'missing.txt') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return { path: path, name: path.split('/').pop(), kind: 'file', size: 1, hash: 'h', mtime: 1, mime: 'text/plain' }
  },
  revealInSystem: async function (path, opts) {
    revealed.push({ path: path, select: !!(opts && opts.select) })
    if (path === 'denied.txt') throw Object.assign(new Error('denied'), { code: 'EACCES' })
    if (path === 'bad.txt') return { ok: false, reason: 'custom' }
    return { ok: true, absolutePath: '/must/not/leak' }
  },
})
assert.equal((await bridge.capabilities()).revealInSystem, true)
assert.deepEqual(await bridge.revealInSystem('src//panel.js', { select: true }), { ok: true })
assert.deepEqual(revealed[0], { path: 'src/panel.js', select: true })
assert.deepEqual(await bridge.revealInSystem('missing.txt'), { ok: false, reason: 'not_found' })
assert.deepEqual(await bridge.revealInSystem('denied.txt'), { ok: false, reason: 'permission_denied' })
assert.deepEqual(await bridge.revealInSystem('bad.txt'), { ok: false, reason: 'platform_error' })
await assert.rejects(async function () { return bridge.revealInSystem('../secret.txt') }, /escapes root/)

console.log('workspace tests ok')

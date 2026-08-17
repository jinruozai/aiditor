import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

global.window = { aiditor: {}, localStorage: memoryStorage() }
vm.runInThisContext(readFileSync('src/core/workspace-state.js', 'utf8'), { filename: 'src/core/workspace-state.js' })

const workspaceState = window.aiditor.workspaceState
const storage = memoryStorage()
workspaceState.configure({ storage: storage, prefix: 'case.workspace-state' })
await workspaceState.save('project-a', 'folding', { value: 1 })
await workspaceState.save('project-b', 'folding', { value: 2 })
assert.deepEqual(await workspaceState.load('project-a', 'folding'), { value: 1 })
assert.deepEqual(await workspaceState.load('project-b', 'folding'), { value: 2 })
await workspaceState.remove('project-a', 'folding')
assert.equal(await workspaceState.load('project-a', 'folding'), null)

const calls = []
let releaseFirst
workspaceState.configure({
  adapter: {
    load() { return null },
    save(workspaceId, key, value) {
      calls.push({ kind: 'save', workspaceId: workspaceId, key: key, value: value })
      if (calls.length === 1) return new Promise(function (resolve) { releaseFirst = resolve })
    },
    remove(workspaceId, key) { calls.push({ kind: 'remove', workspaceId: workspaceId, key: key }) },
  },
})

const first = workspaceState.save('project', 'folding', { revision: 1 })
const second = workspaceState.save('project', 'folding', { revision: 2 })
const third = workspaceState.save('project', 'folding', { revision: 3 })
assert.equal(calls.length, 1)
releaseFirst()
await Promise.all([first, second, third])
assert.equal(calls.length, 2)
assert.deepEqual(calls[1].value, { revision: 3 })

let releaseBlocking
workspaceState.configure({
  adapter: {
    load() { return null },
    save(workspaceId, key, value) {
      calls.push({ kind: 'blocking-save', workspaceId: workspaceId, key: key, value: value })
      return new Promise(function (resolve) { releaseBlocking = resolve })
    },
    remove(workspaceId, key) { calls.push({ kind: 'final-remove', workspaceId: workspaceId, key: key }) },
  },
})
const blocking = workspaceState.save('project-2', 'folding', { revision: 1 })
const removed = workspaceState.remove('project-2', 'folding')
releaseBlocking()
await Promise.all([blocking, removed])
assert.equal(calls.at(-1).kind, 'final-remove')

console.log('workspace state tests ok')

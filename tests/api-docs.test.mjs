import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/names.js',
  'src/core/runtime.js',
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/reference.js',
  'src/ai/api-docs.generated.js',
  'src/ai/api-reference.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const payload = JSON.parse(readFileSync('dist/aiditor-api.json', 'utf8'))
assert.equal(payload.version, 1)
assert.ok(payload.entries.some((entry) => entry.id === 'aiditor.inspector.registerProvider'))
assert.ok(payload.entries.some((entry) => entry.id === 'aiditor.addPanelToDock'))
assert.ok(payload.entries.some((entry) => entry.id === 'aiditor.reloadPanel'))

const refs = aiditor.ai.references.search({ query: 'inspector registerProvider', limit: 5 })
assert.ok(refs.some((ref) => ref.uri === 'aiditor://api/aiditor.inspector.registerProvider'))

const allRefs = aiditor.ai.references.search({ query: '', limit: 50 })
assert.equal(allRefs[0].uri, 'aiditor://api')
assert.ok(allRefs.some((ref) => ref.uri === 'aiditor://api/aiditor.addPanelToDock'))
assert.ok(allRefs.some((ref) => ref.uri === 'aiditor://api/aiditor.reloadPanel'))

const indexDoc = aiditor.ai.references.read({ uri: 'aiditor://api' })
assert.ok(indexDoc.entries.some((entry) => entry.id === 'aiditor.inspector.registerProvider'))

const doc = aiditor.ai.references.read({ uri: 'aiditor://api/aiditor.inspector.registerProvider' })
assert.equal(doc.id, 'aiditor.inspector.registerProvider')
assert.match(doc.signature, /registerProvider/)

const caps = aiditor.ai.references.capabilities({ uri: 'aiditor://api/aiditor.inspector.registerProvider' })
assert.deepEqual(caps, ['read'])

console.log('api docs tests ok')

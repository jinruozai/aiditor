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
  'src/ai/skill/builtins.js',
  'src/ai/reference.js',
  'src/ai/skill/reference.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const refs = aiditor.ai.references.search({ query: 'skills', limit: 20 })
assert.equal(refs[0].uri, 'aiditor://skills')
assert.ok(refs.some(function (ref) { return ref.uri === 'aiditor://skills/aiditor.runtime-authoring' }))
assert.ok(refs.some(function (ref) { return ref.uri === 'aiditor://skills/aiditor.framework-authoring' }))

const index = aiditor.ai.references.read({ uri: 'aiditor://skills' })
assert.ok(index.entries.some(function (entry) { return entry.id === 'aiditor.runtime-authoring' }))
assert.ok(index.entries.some(function (entry) { return /current AIditor dock/.test(entry.whenToUse) }))

const runtime = aiditor.ai.references.read({ uri: 'aiditor://skills/aiditor.runtime-authoring' })
assert.equal(runtime.id, 'aiditor.runtime-authoring')
assert.ok(runtime.relatedApis.includes('aiditor.addPanelToDock'))
assert.ok(runtime.tools.includes('aiditor.addPanelToDock'))
assert.ok(runtime.tools.includes('aiditor.readReference'))
assert.equal(Object.hasOwn(runtime, 'relatedTools'), false)
assert.ok(runtime.rules.some(function (rule) { return /Inspect real dock/.test(rule) }))

const frameworkRefs = aiditor.ai.references.search({ query: 'framework Core UI', limit: 20 })
assert.ok(frameworkRefs.some(function (ref) { return ref.uri === 'aiditor://skills/aiditor.framework-authoring' }))

const caps = aiditor.ai.references.capabilities({ uri: 'aiditor://skills/aiditor.runtime-authoring' })
assert.deepEqual(caps, ['read'])

console.log('skill reference tests ok')

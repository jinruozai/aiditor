import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/names.js',
  'src/core/runtime.js',
  'src/ai/registries.js',
  'src/ai/skills.js',
  'src/ai/reference.js',
  'src/ai/skill-reference.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const refs = aiditor.ai.references.search({ query: 'skills', limit: 20 })
assert.equal(refs[0].uri, 'aiditor://skills')
assert.ok(refs.some(function (ref) { return ref.uri === 'aiditor://skills/aiditor.runtime-authoring' }))
assert.ok(refs.some(function (ref) { return ref.uri === 'aiditor://skills/aiditor.library-authoring' }))

const index = aiditor.ai.references.read({ uri: 'aiditor://skills' })
assert.ok(index.entries.some(function (entry) { return entry.id === 'aiditor.runtime-authoring' }))
assert.ok(index.entries.some(function (entry) { return /live editor/.test(entry.whenToUse) }))

const runtime = aiditor.ai.references.read({ uri: 'aiditor://skills/aiditor.runtime-authoring' })
assert.equal(runtime.id, 'aiditor.runtime-authoring')
assert.ok(runtime.relatedApis.includes('aiditor.addPanelToDock'))
assert.ok(runtime.tools.includes('aiditor.addPanelToDock'))
assert.equal(Object.hasOwn(runtime, 'relatedTools'), false)
assert.ok(runtime.rules.some(function (rule) { return /inspect docks/.test(rule) }))

const libraryRefs = aiditor.ai.references.search({ query: 'library authoring repository', limit: 20 })
assert.ok(libraryRefs.some(function (ref) { return ref.uri === 'aiditor://skills/aiditor.library-authoring' }))

const caps = aiditor.ai.references.capabilities({ uri: 'aiditor://skills/aiditor.runtime-authoring' })
assert.deepEqual(caps, ['read'])

console.log('skill reference tests ok')

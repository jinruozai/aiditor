import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/core/runtime.js',
  'src/core/workspace.js',
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/skill/packages.js',
  'src/ai/reference.js',
  'src/ai/skill/reference.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ai = aiditor.ai

const sourceRules = ['Review correctness']
const registered = ai.skills.register('test.review', {
  title: 'Review',
  description: 'Review a change.',
  argumentHint: '[target]',
  rules: sourceRules,
  tools: ['workspace.readTextRange'],
}, { owner: 'test:review', layer: 'app', source: 'inline:test' })

sourceRules.push('Late mutation')
assert.equal(registered.id, 'test.review')
assert.equal(registered.userInvocable, true)
assert.equal(registered.argumentHint, '[target]')
assert.deepEqual(registered.rules, ['Review correctness'])
assert.deepEqual(ai.skills.list({ owner: 'test:review' }), ['test.review'])
assert.deepEqual(ai.skills.list({ layer: 'app' }), ['test.review'])
assert.deepEqual(ai.skills.list({ source: 'inline:test' }), ['test.review'])
assert.equal(ai.skills.meta('test.review').owner, 'test:review')
assert.match(ai.skills.meta('test.review').hash, /^aiditor-fnv1a-/)
assert.throws(function () { ai.skills.unregister('test.review', { owner: 'other' }) }, /owner mismatch/)
assert.deepEqual(aiditor.runtime.unloadOwner('test:review').skills, ['test.review'])
assert.equal(ai.skills.get('test.review'), undefined)

ai.skills.register('test.user-only', { title: 'User Only', modelInvocable: false }, { owner: 'test:catalog' })
ai.skills.register('test.model-only', { title: 'Model Only', userInvocable: false }, { owner: 'test:catalog' })
const userCatalog = ai.skills.catalog({}, { audience: 'user', limit: 100 })
const modelCatalog = ai.skills.catalog({}, { audience: 'model', limit: 100 })
assert.equal(userCatalog.some(function (item) { return item.id === 'test.user-only' }), true)
assert.equal(userCatalog.some(function (item) { return item.id === 'test.model-only' }), false)
assert.equal(modelCatalog.some(function (item) { return item.id === 'test.user-only' }), false)
assert.equal(modelCatalog.some(function (item) { return item.id === 'test.model-only' }), true)
assert.equal(Array.isArray(userCatalog[0].tools), true)
aiditor.runtime.unloadOwner('test:catalog')

ai.skills.register('inline.resource', {
  resources: [{ path: 'references/info.md', kind: 'reference' }],
}, { owner: 'test:inline' })
const inlineResource = ai.references.read({ uri: 'aiditor://skills/inline.resource' }).resources[0]
assert.equal(inlineResource.readable, false)
assert.equal(inlineResource.uri, null)
assert.deepEqual(ai.references.capabilities({ uri: 'aiditor://skills/inline.resource/resources/references%2Finfo.md' }), [])
ai.skills.unregister('inline.resource', { owner: 'test:inline' })

const files = {
  'skills/review/SKILL.md': {
    text: [
      '---',
      'name: code-review',
      'description: >-',
      '  Review bounded code changes for correctness and regressions.',
      'argument-hint: "[path]"',
      'user-invocable: false',
      'allowed-tools: ignored.tool',
      '---',
      '# Code Review',
      '',
      'Inspect behavior before style.',
    ].join('\n'),
    hash: 'skill-file-hash',
  },
  'skills/review/references/checklist.md': { text: '# Checklist\nCheck tests.', hash: 'ref-hash' },
  'skills/invalid/SKILL.md': { text: '---\nname: Invalid Name\ndescription: x\n---\nBody' },
}

const directoryEntries = {
  'skills/review': [
    { path: 'skills/review/SKILL.md', name: 'SKILL.md', kind: 'file' },
    { path: 'skills/review/references', name: 'references', kind: 'directory' },
    { path: 'skills/review/assets', name: 'assets', kind: 'directory' },
    { path: 'skills/review/scripts', name: 'scripts', kind: 'directory' },
    { path: 'skills/review/agents', name: 'agents', kind: 'directory' },
    { path: 'skills/review/notes', name: 'notes', kind: 'directory' },
  ],
  'skills/review/references': [
    { path: 'skills/review/references/checklist.md', name: 'checklist.md', kind: 'file', size: 25, hash: 'ref-hash', mime: 'text/markdown' },
  ],
  'skills/review/assets': [
    { path: 'skills/review/assets/icon.png', name: 'icon.png', kind: 'file', size: 12, mime: 'image/png' },
  ],
  'skills/review/scripts': [
    { path: 'skills/review/scripts/check.js', name: 'check.js', kind: 'file', size: 18, mime: 'text/javascript' },
  ],
}

const listCalls = []
const workspace = {
  readText: async function (path) {
    if (!files[path]) throw Object.assign(new Error('missing'), { code: 'not_found' })
    return Object.assign({ path: path }, files[path])
  },
  list: async function (path) {
    listCalls.push(path)
    if (!directoryEntries[path]) throw Object.assign(new Error('missing'), { code: 'not_found' })
    return directoryEntries[path]
  },
}

const loaded = await ai.skills.loadPackage({
  workspace: workspace,
  root: 'skills/review',
  id: 'workspace.review',
  tools: ['workspace.readTextRange'],
}, { owner: 'workspace:case', layer: 'workspace' })

assert.equal(loaded.id, 'workspace.review')
assert.equal(loaded.description, 'Review bounded code changes for correctness and regressions.')
assert.equal(loaded.argumentHint, '[path]')
assert.equal(loaded.userInvocable, false)
assert.match(loaded.systemPrompt, /Inspect behavior before style/)
assert.deepEqual(loaded.tools, ['workspace.readTextRange'])
assert.equal(loaded.tools.includes('ignored.tool'), false)
assert.deepEqual(loaded.resources.map(function (item) { return [item.path, item.kind] }), [
  ['assets/icon.png', 'asset'],
  ['references/checklist.md', 'reference'],
  ['scripts/check.js', 'script'],
])
assert.deepEqual(listCalls, [
  'skills/review',
  'skills/review/references',
  'skills/review/assets',
  'skills/review/scripts',
])
assert.equal(ai.skills.meta('workspace.review').owner, 'workspace:case')
assert.equal(ai.skills.meta('workspace.review').source, 'skills/review')
assert.equal(ai.skills.meta('workspace.review').hash, 'skill-file-hash')

const full = ai.references.read({ uri: 'aiditor://skills/workspace.review' })
assert.equal(full.id, 'workspace.review')
assert.equal(full.resources.find(function (item) { return item.kind === 'reference' }).readable, true)
assert.equal(full.resources.find(function (item) { return item.kind === 'asset' }).readable, false)
const compactIndexSkill = ai.references.read({ uri: 'aiditor://skills' }).entries.find(function (item) { return item.id === 'workspace.review' })
assert.equal(compactIndexSkill.resourceCount, 3)
assert.equal(Object.hasOwn(compactIndexSkill, 'resources'), false)

const resource = await ai.references.read({ uri: 'aiditor://skills/workspace.review/resources/references%2Fchecklist.md' })
assert.equal(resource.skillId, 'workspace.review')
assert.equal(resource.text, '# Checklist\nCheck tests.')
assert.equal(resource.hash, 'ref-hash')
assert.deepEqual(ai.references.capabilities({ uri: 'aiditor://skills/workspace.review/resources/references%2Fchecklist.md' }), ['read'])
assert.deepEqual(ai.references.capabilities({ uri: 'aiditor://skills/workspace.review/resources/assets%2Ficon.png' }), [])
await assert.rejects(ai.skills.readResource('workspace.review', 'assets/icon.png'), /not found/)
await assert.rejects(ai.skills.readResource('workspace.review', '../outside.md'), /cannot traverse/)

assert.deepEqual(aiditor.runtime.unloadOwner('workspace:case').skills, ['workspace.review'])
assert.equal(ai.skills.get('workspace.review'), undefined)
await assert.rejects(ai.skills.loadPackage({ workspace: workspace, root: 'skills/invalid' }), /name must be lowercase/)

const manifestOnlyWorkspace = aiditor.workspace.memory({
  'skills/manifest-only/SKILL.md': [
    '---',
    'name: manifest-only',
    'description: A valid Skill package without resource directories.',
    '---',
    '# Manifest Only',
  ].join('\n'),
})
const manifestOnly = await ai.skills.loadPackage({
  workspace: manifestOnlyWorkspace,
  root: 'skills/manifest-only',
  id: 'workspace.manifest-only',
}, { owner: 'workspace:manifest-only' })
assert.deepEqual(manifestOnly.resources, [])
assert.equal(manifestOnly.systemPrompt, '# Manifest Only')
assert.deepEqual(aiditor.runtime.unloadOwner('workspace:manifest-only').skills, ['workspace.manifest-only'])

console.log('ai skills tests ok')

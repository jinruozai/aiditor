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
  'src/ai/skill/registry.js',
  'src/ai/skill/runtime.js',
  'src/ai/skill/packages.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ai = aiditor.ai

const tools = ['workspace.readTextRange']
const registered = ai.skills.register('test.review', {
  title: 'Review',
  description: 'Review a change.',
  argumentHint: '[target]',
  instructions: 'Review correctness before style.',
  toolDisclosure: 'onRead',
  tools: tools,
}, { owner: 'test:review', layer: 'app', source: 'inline:test' })

tools.push('late.mutation')
assert.equal(registered.id, 'test.review')
assert.equal(registered.argumentHint, '[target]')
assert.equal(registered.instructions, 'Review correctness before style.')
assert.equal(registered.toolDisclosure, 'onRead')
assert.deepEqual(registered.tools, ['workspace.readTextRange'])
assert.deepEqual(ai.skills.list({ owner: 'test:review' }), ['test.review'])
assert.equal(ai.skills.meta('test.review').owner, 'test:review')
assert.match(ai.skills.meta('test.review').hash, /^aiditor-fnv1a-/)
assert.deepEqual(ai.skills.catalog().map(function (skill) { return skill.id }), ['test.review'])
assert.equal(ai.skills.catalog()[0].toolDisclosure, 'onRead')
assert.equal(ai.skills.page(null, 10).items[0].id, 'test.review')
assert.equal(ai.skills.read('test.review').instructions, 'Review correctness before style.')
assert.throws(function () { ai.skills.unregister('test.review', { owner: 'other' }) }, /owner mismatch/)
assert.deepEqual(aiditor.runtime.unloadOwner('test:review').skills, ['test.review'])
assert.equal(ai.skills.get('test.review'), undefined)

const files = {
  'skills/review/SKILL.md': {
    text: [
      '---',
      'name: code-review',
      'description: Review bounded code changes for correctness and regressions.',
      'argument-hint: "[path]"',
      'tool-disclosure: onRead',
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

const workspace = {
  readText: async function (path) {
    if (!files[path]) throw new Error('missing')
    return Object.assign({ path: path }, files[path])
  },
  list: async function (path) {
    if (!directoryEntries[path]) throw new Error('missing')
    return directoryEntries[path]
  },
}

const loaded = await ai.skills.loadPackage({
  workspace: workspace,
  root: 'skills/review',
  id: 'workspace.review',
  tools: ['workspace.readTextRange'],
}, { owner: 'workspace:case', layer: 'workspace' })

assert.equal(loaded.description, 'Review bounded code changes for correctness and regressions.')
assert.equal(loaded.argumentHint, '[path]')
assert.equal(loaded.toolDisclosure, 'onRead')
assert.match(loaded.instructions, /Inspect behavior before style/)
assert.deepEqual(loaded.resources.map(function (item) { return [item.path, item.kind] }), [
  ['assets/icon.png', 'asset'],
  ['references/checklist.md', 'reference'],
  ['scripts/check.js', 'script'],
])
assert.equal(ai.skills.meta('workspace.review').hash, 'skill-file-hash')

const resource = await ai.skills.read('workspace.review', 'references/checklist.md')
assert.equal(resource.text, '# Checklist\nCheck tests.')
assert.equal(resource.hash, 'ref-hash')
await assert.rejects(ai.skills.read('workspace.review', 'assets/icon.png'), /not found/)
await assert.rejects(ai.skills.read('workspace.review', '../outside.md'), /cannot traverse/)
assert.deepEqual(aiditor.runtime.unloadOwner('workspace:case').skills, ['workspace.review'])
await assert.rejects(ai.skills.loadPackage({ workspace: workspace, root: 'skills/invalid' }), /name must be lowercase/)
assert.throws(function () {
  ai.skills.register('test.invalid-disclosure', { toolDisclosure: 'sometimes' }, { owner: 'test:invalid-disclosure' })
}, /Invalid skill toolDisclosure/)

ai.skills.register('test.list-one', { description: 'First listed Skill.' }, { owner: 'test:list' })
ai.skills.register('test.list-two', { description: 'Second listed Skill.' }, { owner: 'test:list' })
const firstPage = ai.tools.get('skill.list').run({ limit: 1 }, {})
assert.equal(firstPage.total, 2)
assert.equal(firstPage.skills.length, 1)
assert.equal(firstPage.nextCursor, 'skill:1')
const secondPage = ai.tools.get('skill.list').run({ cursor: firstPage.nextCursor, limit: 1 }, {})
assert.equal(secondPage.skills[0].id, 'test.list-two')
assert.equal(secondPage.nextCursor, null)
assert.deepEqual(aiditor.runtime.unloadOwner('test:list').skills, ['test.list-one', 'test.list-two'])
assert.throws(function () { ai.tools.get('skill.read').run({ id: 'missing' }) }, /Skill not found/)

console.log('ai skills tests ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = {
  aiditor: {},
  localStorage: {
    getItem: function () { return null },
    setItem: function () {},
  },
}

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/core/runtime.js',
  'src/core/settings.js',
  'src/core/commands.js',
  'src/core/registry.js',
  'src/ai/registries.js',
  'src/ai/reference.js',
  'src/ui/form/typeconfig.js',
  'src/ui/form/schema.js',
  'src/ui/inspector.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor

await aiditor.runtime.loadScript({
  id: 'runtime-loader-case',
  source: [
    "aiditor.registerComponent('case.loadedPanel', { factory: function () { return { tagName: 'DIV' } } })",
    "aiditor.commands.register('case.refresh', { title: 'Refresh' })",
    "aiditor.commands.registerMenu('case.menu.refresh', { target: 'case.menu', command: 'case.refresh' })",
    "aiditor.settings.registerSection('case.settings', { title: 'Case' })",
    "aiditor.settings.registerSchema('case.settings', { key: 'case.enabled', type: 'boolean' })",
    "aiditor.ai.tools.register('case.tool', { run: function () { return 'ok' } })",
    "aiditor.ai.context.register('case.context', { capture: function () { return 'ctx' } })",
    "aiditor.ai.references.register('case.ref', { read: function () { return { ok: true } } })",
    "aiditor.ai.operations.register('case.op', { preview: function () { return { ok: true } }, apply: function () { return { applied: true } } })",
    "aiditor.inspector.registerProvider('case.target', { inspect: function () { return { values: [{ id: 1 }], schema: { id: { type: 'int' } } } } })",
  ].join('\n'),
  owner: 'project:runtime-loader',
  layer: 'project',
})

assert.equal(aiditor.componentRegistration('case.loadedPanel').owner, 'project:runtime-loader')
assert.equal(aiditor.commands.meta('case.refresh').owner, 'project:runtime-loader')
assert.equal(aiditor.commands.menuMeta('case.menu.refresh').owner, 'project:runtime-loader')
assert.equal(aiditor.settings.sectionMeta('case.settings').owner, 'project:runtime-loader')
assert.equal(aiditor.settings.schemaMeta('case.enabled').owner, 'project:runtime-loader')
assert.equal(aiditor.ai.toolMeta('case.tool').owner, 'project:runtime-loader')
assert.equal(aiditor.ai.context.meta('case.context').owner, 'project:runtime-loader')
assert.equal(aiditor.ai.references.meta('case.ref').owner, 'project:runtime-loader')
assert.equal(aiditor.ai.operations.meta('case.op').owner, 'project:runtime-loader')
assert.equal(aiditor.inspector.providerMeta('case.target').owner, 'project:runtime-loader')

await aiditor.runtime.loadScript({
  id: 'runtime-loader-case',
  source: "aiditor.registerComponent('case.loadedPanel', { defaults: function () { return { title: 'Reloaded' } }, factory: function () { return { tagName: 'DIV' } } })",
  owner: 'project:runtime-loader',
  layer: 'project',
  replace: true,
})
assert.equal(aiditor.componentDefaults('case.loadedPanel').title, 'Reloaded')

const removed = aiditor.runtime.unloadOwner('project:runtime-loader')
assert.deepEqual(removed.components, ['case.loadedPanel'])
assert.equal(aiditor.componentRegistration('case.loadedPanel'), null)
assert.equal(aiditor.commands.get('case.refresh'), null)
assert.equal(aiditor.settings.sectionMeta('case.settings').owner, undefined)
assert.equal(aiditor.ai.tools.get('case.tool'), undefined)
assert.equal(aiditor.ai.references.get('case.ref'), null)
assert.equal(aiditor.ai.operations.get('case.op'), null)
assert.equal(aiditor.inspector.providerFor([{ type: 'case.target' }]), null)

console.log('runtime loader tests ok')

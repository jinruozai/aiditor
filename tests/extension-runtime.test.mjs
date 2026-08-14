import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function storage() {
  const data = {}
  return {
    data: data,
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null },
    setItem: function (key, value) { data[key] = String(value) },
    removeItem: function (key) { delete data[key] },
  }
}

const memory = storage()
global.window = { aiditor: {}, localStorage: memory }
global.document = {
  createElement: function (tag) {
    return {
      tagName: String(tag || '').toUpperCase(),
      children: [],
      className: '',
      textContent: '',
      style: {},
      dataset: {},
      appendChild: function (child) { this.children.push(child); return child },
      setAttribute: function (name, value) { this[name] = String(value) },
    }
  },
}

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/names.js',
  'src/core/runtime.js',
  'src/core/settings.js',
  'src/core/commands.js',
  'src/core/workspace.js',
  'src/tree/tree.js',
  'src/core/registry.js',
  'src/ai/name-generator.js',
  'src/ai/permission.js',
  'src/ai/store.js',
  'src/ai/connection.js',
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/tool/scheduler.js',
  'src/ai/tool/runtime.js',
  'src/ai/workdir.js',
  'src/ai/reference.js',
  'src/extensions/manifest.js',
  'src/extensions/install.js',
  'src/extensions/runtime.js',
  'src/extensions/ai.js',
  'src/ai/request.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ai = aiditor.ai
ai.registerTransport('extension-test', { toolProtocol: 'native' })
ai.registerConnection('mock', { auth: { type: 'none' }, transport: { type: 'extension-test' }, configDefaults: {} })
assert.equal(ai.tools.get('aiditor.createPanel'), undefined)
assert.equal(ai.operations.get('aiditor.createPanel'), null)
assert.equal(typeof ai.tools.get('aiditor.inspectDocks').run, 'function')
assert.equal(typeof ai.tools.get('aiditor.installExtension').preview, 'function')
assert.equal(typeof ai.tools.get('aiditor.addPanelToDock').preview, 'function')
assert.equal(typeof ai.tools.get('aiditor.reloadPanel').preview, 'function')
ai.skills.register('test.extension-runtime', {
  title: 'Extension Runtime Test',
  tools: ['aiditor.inspectDocks', 'aiditor.addPanelToDock'],
}, { owner: 'test:extension-runtime' })
const extensionAgent = ai.createAgent({
  name: 'Extension Agent',
  skillRefs: ['test.extension-runtime'],
})
const extensionRequest = ai.planRequest(extensionAgent, null, 'run_extension_tools', 'user', 0)
assert.equal(extensionRequest.tools.includes('aiditor.installExtension'), false)
assert.equal(extensionRequest.tools.includes('aiditor.inspectDocks'), true)
assert.equal(extensionRequest.tools.includes('aiditor.addPanelToDock'), true)
assert.equal(extensionRequest.tools.includes('aiditor.previewOperation'), false)
assert.equal(extensionRequest.tools.includes('aiditor.applyOperation'), false)
const hiddenOperation = ai.tools.get('aiditor.previewOperation').run(
  { op: 'aiditor.installExtension', input: { manifest: {} } },
  { actor: 'user', agent: extensionAgent }
)
assert.equal(hiddenOperation.code, 'OPERATION_NOT_AVAILABLE')
let tree = aiditor.dock({ name: 'main' })
let panelTextSamples = {}
let reloadedPanelId = null
const layout = {
  tree: function () { return tree },
  addPanel: function (dockName, partial, opts) {
    const found = aiditor.findByName(tree, dockName)
    const dockId = found ? found.node.id : dockName
    const r = aiditor.addPanel(tree, dockId, partial, opts || {})
    tree = r.tree
    return { panelId: r.panelId }
  },
  removePanel: function (panelId) {
    tree = aiditor.removePanel(tree, panelId)
  },
  replacePanel: function (panelId, partial, opts) {
    const r = aiditor.replacePanel(tree, panelId, partial, opts || {})
    tree = r.tree
    return { panelId: r.panelId }
  },
  reloadPanel: function (panelId) {
    reloadedPanelId = panelId
    return { panelId: panelId }
  },
  setTree: function (next) {
    tree = next
  },
  inspectPanel: function (panelId) {
    return { panelId: panelId, status: 'ready', textSample: panelTextSamples[panelId] || '' }
  },
}

aiditor.extensions.registerLayout('default', layout)
aiditor.ai.setWorkspace(aiditor.workspace.memory({
  'runtime-panel.js': [
    ';(function (aiditor) {',
    "  'use strict'",
    "  aiditor.registerComponent('runtime.panel', {",
    "    defaults: function () { return { title: 'Runtime Panel', icon: 'box', props: {} } },",
    '    factory: function () { return { tagName: "DIV" } }',
    '  })',
    '})(window.aiditor = window.aiditor || {})',
    '',
  ].join('\n'),
  'replacement-panel.js': [
    ';(function (aiditor) {',
    "  'use strict'",
    "  aiditor.registerComponent('replacement.panel', {",
    "    defaults: function () { return { title: 'Replacement Panel', icon: 'box', props: {} } },",
    '    factory: function () { return { tagName: "DIV" } }',
    '  })',
    '})(window.aiditor = window.aiditor || {})',
    '',
  ].join('\n'),
}), { id: 'memory:runtime-panel', label: 'Runtime Panel', kind: 'memory' })
assert.deepEqual(ai.tools.get('aiditor.inspectDocks').run({}), [{
  layout: 'default',
  dockId: tree.id,
  name: 'main',
  rect: null,
  visible: null,
  activeId: null,
  panels: [],
  panelCount: 0,
  accept: null,
  collapsed: false,
  focused: false,
}])
const runtimePanelPreview = await ai.tools.get('aiditor.addPanelToDock').preview({
  dock: 'main',
  component: 'runtime.panel',
})
assert.equal(runtimePanelPreview.ok, true)
assert.equal(runtimePanelPreview.input.path, 'runtime-panel.js')
const runtimePanelAdded = await ai.tools.get('aiditor.addPanelToDock').apply(runtimePanelPreview)
assert.equal(runtimePanelAdded.applied, true)
assert.equal(aiditor.componentRegistration('runtime.panel').owner, 'workspace:memory:runtime-panel')
assert.equal(aiditor.findPanel(tree, runtimePanelAdded.panelId).panel.component, 'runtime.panel')
layout.removePanel(runtimePanelAdded.panelId)
aiditor.runtime.unloadOwner('workspace:memory:runtime-panel')
const explicitRuntimePanelPreview = await ai.tools.get('aiditor.addPanelToDock').preview({
  dock: 'main',
  component: 'runtime.panel',
  path: 'runtime-panel.js',
})
assert.equal(explicitRuntimePanelPreview.ok, true)
const explicitRuntimePanelAdded = await ai.tools.get('aiditor.addPanelToDock').apply(explicitRuntimePanelPreview)
assert.equal(explicitRuntimePanelAdded.applied, true)
assert.equal(aiditor.componentRegistration('runtime.panel').owner, 'workspace:memory:runtime-panel')
assert.equal(aiditor.findPanel(tree, explicitRuntimePanelAdded.panelId).panel.component, 'runtime.panel')
assert.equal(aiditor.findPanel(tree, explicitRuntimePanelAdded.panelId).panel.sourcePath, 'runtime-panel.js')
const runtimePanelFile = await ai.currentWorkspace().readText('runtime-panel.js')
await ai.currentWorkspace().writeText('runtime-panel.js', [
  ';(function (aiditor) {',
  "  'use strict'",
  "  aiditor.registerComponent('runtime.panel', {",
  "    defaults: function () { return { title: 'Runtime Panel Reloaded', icon: 'box', props: {} } },",
  '    factory: function () { return { tagName: "DIV" } }',
  '  })',
  '})(window.aiditor = window.aiditor || {})',
  '',
].join('\n'), { baseHash: runtimePanelFile.hash })
const reloadPreview = await ai.tools.get('aiditor.reloadPanel').preview({
  panelId: explicitRuntimePanelAdded.panelId,
  path: 'runtime-panel.js',
})
assert.equal(reloadPreview.ok, true)
const reloaded = await ai.tools.get('aiditor.reloadPanel').apply(reloadPreview)
assert.equal(reloaded.applied, true)
assert.equal(reloaded.panelId, explicitRuntimePanelAdded.panelId)
assert.equal(reloadedPanelId, explicitRuntimePanelAdded.panelId)
assert.equal(aiditor.componentDefaults('runtime.panel').title, 'Runtime Panel Reloaded')
const replacementPreview = await ai.tools.get('aiditor.replacePanel').preview({
  panelId: explicitRuntimePanelAdded.panelId,
  component: 'replacement.panel',
})
assert.equal(replacementPreview.ok, true)
assert.equal(replacementPreview.input.path, 'replacement-panel.js')
const replacement = await ai.tools.get('aiditor.replacePanel').apply(replacementPreview)
assert.equal(replacement.applied, true)
assert.equal(aiditor.findPanel(tree, explicitRuntimePanelAdded.panelId), null)
assert.equal(aiditor.findPanel(tree, replacement.panelId).panel.component, 'replacement.panel')
layout.removePanel(replacement.panelId)
aiditor.runtime.unloadOwner('workspace:memory:runtime-panel')
aiditor.extensions.configureStorage({ key: 'test.extensions', load: false })
const installTool = ai.tools.get('aiditor.installExtension')
const directInstallPreview = installTool.preview({
  manifest: {
    id: 'direct.tool',
    contributes: {
      components: [{ id: 'panel', title: 'Direct Tool Panel', ui: null }],
      dockPanels: [{ dock: 'main', component: 'panel', title: 'Direct Tool Panel' }],
    },
  },
}, { actor: 'user', agent: { id: 'agent' } })
assert.equal(directInstallPreview.canApply, true)
const directInstalled = installTool.apply(directInstallPreview, { actor: 'user', agent: { id: 'agent' } })
assert.equal(directInstalled.applied, true)
assert.equal(aiditor.componentRegistration('direct.tool.panel').owner, 'extension:direct.tool')
assert.equal(ai.permissionAuditRecords().some(function (item) {
  return item.scope === 'extension.install' && item.target === 'direct.tool' && item.decision === 'allow'
}), true)
aiditor.extensions.uninstall('direct.tool', { save: false })

aiditor.extensions.install({
  id: 'nested',
  contributes: {
    components: [{ id: 'panel', title: 'Nested Panel', ui: null }],
    references: [{ id: 'data', provider: {} }],
    operations: [{ id: 'patch', risk: 'edit' }],
    tools: [{ id: 'read', title: 'Nested Read', run: function () { return 'parent' } }],
    skills: [{ id: 'review', title: 'Nested Review', tools: ['read'], rules: ['Review nested data'] }],
    context: [{ id: 'ctx', provider: { capture: function () { return 'parent' } } }],
    commands: [{ id: 'refresh', title: 'Nested Refresh' }],
    menus: [{ target: 'dock.panel.context', command: 'refresh', label: 'Nested Refresh' }],
    settings: [{ section: { id: 'nested', title: 'Nested' }, schema: { key: 'nested.enabled', type: 'boolean' } }],
  },
}, { save: false })
aiditor.extensions.install({
  id: 'nested.child',
  contributes: {
    components: [{ id: 'panel', title: 'Nested Child Panel', ui: null }],
    references: [{ id: 'data', provider: {} }],
    operations: [{ id: 'patch', risk: 'edit' }],
    tools: [{ id: 'read', title: 'Nested Child Read', run: function () { return 'child' } }],
    skills: [{ id: 'review', title: 'Nested Child Review', tools: ['read'], rules: ['Review child data'] }],
    context: [{ id: 'ctx', provider: { capture: function () { return 'child' } } }],
    commands: [{ id: 'refresh', title: 'Nested Child Refresh' }],
    menus: [{ target: 'dock.panel.context', command: 'refresh', label: 'Nested Child Refresh' }],
    settings: [{ section: { id: 'nested.child', title: 'Nested Child' }, schema: { key: 'nested.child.enabled', type: 'boolean' } }],
  },
}, { save: false })
aiditor.extensions.uninstall('nested', { save: false })
assert.equal(aiditor.componentRegistration('nested.panel'), null)
assert.equal(ai.references.get('nested.data'), null)
assert.equal(ai.operations.get('nested.patch'), null)
assert.equal(ai.tools.get('nested.read'), undefined)
assert.equal(ai.skills.get('nested.review'), undefined)
assert.equal(ai.context.get('nested.ctx'), undefined)
assert.equal(aiditor.commands.get('nested.refresh'), null)
assert.equal(aiditor.commands.menuMeta('nested.dock.panel.context:refresh').owner, undefined)
assert.equal(aiditor.settings.schemaMeta('nested.enabled').owner, undefined)
assert.notEqual(aiditor.componentRegistration('nested.child.panel'), null)
assert.notEqual(ai.references.get('nested.child.data'), null)
assert.notEqual(ai.operations.get('nested.child.patch'), null)
assert.notEqual(ai.tools.get('nested.child.read'), undefined)
assert.notEqual(ai.skills.get('nested.child.review'), undefined)
assert.deepEqual(ai.skills.get('nested.child.review').tools, ['nested.child.read'])
assert.equal(ai.skills.meta('nested.child.review').owner, 'extension:nested.child')
assert.notEqual(ai.context.get('nested.child.ctx'), null)
assert.notEqual(aiditor.commands.get('nested.child.refresh'), null)
assert.equal(aiditor.commands.menuMeta('nested.child.dock.panel.context:refresh').owner, 'extension:nested.child')
assert.equal(aiditor.settings.schemaMeta('nested.child.enabled').owner, 'extension:nested.child')
assert.equal(ai.context.meta('nested.child.ctx').owner, 'extension:nested.child')
aiditor.extensions.uninstall('nested.child', { save: false })

let applied = null
aiditor.extensions.registerAdapter('case.adapter', {
  preview: function (input) { return { ok: true, next: input.next } },
  apply: function (preview) { applied = preview.next; return { applied: true, value: applied } },
  run: function () { applied = 'command'; return { ok: true } },
  read: function (ref) { return { uri: ref.uri, value: 1 } },
})

const manifest = {
  id: 'case',
  title: 'Case Tools',
  layer: 'user',
  contributes: {
    components: [{
      id: 'roleBag',
      title: 'Role Bag',
      icon: 'briefcase',
      props: { rows: 4 },
      ui: { component: 'roleBagInner', props: { label: 'Bag' } },
    }, {
      id: 'roleBagInner',
      title: 'Role Bag Inner',
      ui: null,
    }],
    dockPanels: [{
      dock: 'main',
      component: 'roleBag',
      title: 'Role Bag',
    }],
    references: [{
      id: 'data',
      adapter: 'case.adapter',
      schema: { type: 'object' },
      capabilities: [{ op: 'case.setValue' }],
    }],
    tools: [{
      id: 'read',
      title: 'Read Case',
      adapter: 'case.adapter',
    }],
    context: [{
      id: 'context',
      adapter: 'case.adapter',
    }],
    operations: [{
      id: 'setValue',
      adapter: 'case.adapter',
      risk: 'edit',
      exposeToModel: true,
      inputSchema: {
        type: 'object',
        required: ['next'],
        properties: { next: { type: 'number' } },
      },
    }],
    commands: [{
      id: 'refresh',
      title: 'Refresh Case',
      adapter: 'case.adapter',
    }],
    menus: [{
      target: 'dock.panel.context',
      command: 'refresh',
      label: 'Refresh Case',
    }],
    settings: [{
      section: { id: 'case', title: 'Case' },
      schema: { key: 'case.enabled', type: 'boolean', default: true },
    }],
  },
}

const preview = aiditor.extensions.preview(manifest)
assert.equal(preview.ok, true)
assert.equal(preview.changes.some(function (item) { return item.id === 'case.roleBag' }), true)
assert.equal(aiditor.extensions.preview({
  id: 'bad.adapter',
  contributes: { operations: [{ id: 'op', adapter: 'missing.adapter' }] },
}).ok, false)
assert.match(aiditor.extensions.preview({
  id: 'bad.ui',
  contributes: {
    components: [{ id: 'panel', ui: { component: 'missingWidget' } }],
  },
}).errors[0].message, /UI component not registered/)
const badUiPreview = ai.operations.preview('aiditor.installExtension', {
  id: 'bad.ui.operation',
  contributes: { components: [{ id: 'panel', ui: { component: 'missingWidget' } }] },
})
assert.equal(badUiPreview.ok, false)
assert.equal(ai.operations.apply(badUiPreview).applied, false)
assert.match(aiditor.extensions.preview({
  id: 'bad.dock',
  contributes: {
    components: [{ id: 'panel', ui: null }],
    dockPanels: [{ dock: 'missing', component: 'panel' }],
  },
}).errors[0].message, /Dock not found/)

aiditor.registerComponent('conflict.panel', { factory: function () { return document.createElement('div') } }, { owner: 'host' })
ai.tools.register('conflict.read', {}, { owner: 'host' })
ai.skills.register('conflict.review', {}, { owner: 'host' })
ai.context.register('conflict.context', {}, { owner: 'host' })
ai.references.register('conflict.data', {}, { owner: 'host' })
ai.operations.register('conflict.setValue', {}, { owner: 'host' })
aiditor.commands.register('conflict.refresh', {}, { owner: 'host' })
aiditor.commands.registerMenu('conflict.menu', { target: 'global' }, { owner: 'host' })
const conflictPreview = aiditor.extensions.preview({
  id: 'conflict',
  contributes: {
    components: [{ id: 'panel', ui: null }],
    tools: [{ id: 'read' }],
    skills: [{ id: 'review' }],
    context: [{ id: 'context' }],
    references: [{ id: 'data' }],
    operations: [{ id: 'setValue' }],
    commands: [{ id: 'refresh' }],
    menus: [{ id: 'menu', target: 'global' }],
  },
})
assert.equal(conflictPreview.ok, false)
assert.equal(conflictPreview.errors.some(function (item) { return /Component already registered: conflict\.panel/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Tool already registered: conflict\.read/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Skill already registered: conflict\.review/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Context provider already registered: conflict\.context/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Reference provider already registered: conflict\.data/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Operation already registered: conflict\.setValue/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Command already registered: conflict\.refresh/.test(item.message) }), true)
assert.equal(conflictPreview.errors.some(function (item) { return /Menu already registered: conflict\.menu/.test(item.message) }), true)
aiditor.unregisterComponent('conflict.panel', { owner: 'host' })
ai.tools.unregister('conflict.read', { owner: 'host' })
ai.skills.unregister('conflict.review', { owner: 'host' })
ai.context.unregister('conflict.context', { owner: 'host' })
ai.references.unregister('conflict.data', { owner: 'host' })
ai.operations.unregister('conflict.setValue', { owner: 'host' })
aiditor.commands.unregister('conflict.refresh', { owner: 'host' })
aiditor.commands.unregisterMenu('conflict.menu', { owner: 'host' })

const installed = aiditor.extensions.install(manifest)
assert.equal(installed.ok, true)
assert.equal(aiditor.componentRegistration('case.roleBag').owner, 'extension:case')
assert.equal(aiditor.componentRegistration('case.roleBag').layer, 'user')
assert.equal(aiditor.componentDefaults('case.roleBag').extensionId, 'case')
assert.deepEqual(aiditor.listComponents({ owner: 'extension:case' }).map(function (item) { return item.name }).sort(), ['case.roleBag', 'case.roleBagInner'])
assert.equal(aiditor.findDock(tree, tree.id).node.panels[0].owner, 'extension:case')
assert.equal(aiditor.findDock(tree, tree.id).node.panels[0].component, 'case.roleBag')
assert.equal(ai.tools.get('case.read').title, 'Read Case')
assert.equal(ai.context.get('case.context') != null, true)
assert.equal(ai.references.list({ owner: 'extension:case' })[0], 'case.data')
assert.equal(ai.operations.list({ owner: 'extension:case' })[0], 'case.setValue')
assert.equal(ai.operations.get('case.setValue').exposeToModel, true)
assert.equal(ai.operations.get('case.setValue').inputSchema.properties.next.type, 'number')
assert.equal(aiditor.commands.list({ owner: 'extension:case' })[0], 'case.refresh')
assert.equal(aiditor.commands.menuItems('dock.panel.context')[0].command, 'case.refresh')
assert.equal(aiditor.settings.schemaMeta('case.enabled').owner, 'extension:case')
assert.deepEqual(ai.references.read({ resolver: 'case.data', uri: 'case.data://row/1' }), { uri: 'case.data://row/1', value: 1 })
assert.equal(JSON.parse(memory.data['test.extensions']).entries[0].enabled, true)

const opPreview = ai.operations.preview('case.setValue', { next: 9 })
const opApplied = ai.operations.apply(opPreview)
assert.equal(opApplied.value, 9)
assert.equal(applied, 9)
aiditor.commands.run('case.refresh')
assert.equal(applied, 'command')

const external = layout.addPanel('main', { component: 'case.roleBag', title: 'External Bag' }).panelId

const disabled = aiditor.extensions.disable('case')
assert.equal(disabled.disabled, true)
assert.equal(aiditor.componentRegistration('case.roleBag'), null)
assert.equal(aiditor.findPanel(tree, external).panel.component, 'extension-disabled')
assert.equal(aiditor.findDock(tree, tree.id).node.panels.length, 1)
assert.deepEqual(aiditor.commands.list({ owner: 'extension:case' }), [])
assert.equal(ai.tools.get('case.read'), undefined)
assert.equal(ai.context.get('case.context'), undefined)
assert.equal(aiditor.settings.schemaMeta('case.enabled').owner, undefined)
assert.equal(JSON.parse(memory.data['test.extensions']).entries[0].enabled, false)

const enabled = aiditor.extensions.enable('case')
assert.equal(enabled.enabled, true)
assert.equal(enabled.active, true)
assert.equal(aiditor.componentRegistration('case.roleBag').owner, 'extension:case')
assert.equal(aiditor.findDock(tree, tree.id).node.panels.length, 2)
assert.equal(aiditor.findPanel(tree, external).panel.component, 'case.roleBag')
assert.equal(JSON.parse(memory.data['test.extensions']).entries[0].enabled, true)

aiditor.extensions.safeMode(true)
assert.equal(aiditor.componentRegistration('case.roleBag'), null)
assert.equal(aiditor.extensions.get('case').enabled, true)
assert.equal(aiditor.extensions.get('case').active, false)
aiditor.extensions.safeMode(false)
assert.equal(aiditor.componentRegistration('case.roleBag').owner, 'extension:case')

const appManifest = {
  id: 'app.case',
  layer: 'app',
  contributes: { components: [{ id: 'panel', ui: null }] },
}
aiditor.extensions.install(appManifest, { save: false })
aiditor.extensions.safeMode(true, { allowApp: true })
assert.equal(aiditor.componentRegistration('app.case.panel').owner, 'extension:app.case')
aiditor.extensions.safeMode(false)
aiditor.extensions.uninstall('app.case', { save: false })

const maxApp = aiditor.extensions.setMaxLayer('app')
assert.equal(maxApp.maxLayer, 'app')
assert.equal(aiditor.componentRegistration('case.roleBag'), null)
assert.equal(aiditor.extensions.get('case').filtered, true)
const maxSession = aiditor.extensions.setMaxLayer('session')
assert.equal(maxSession.maxLayer, 'session')
assert.equal(aiditor.componentRegistration('case.roleBag').owner, 'extension:case')

aiditor.extensions.disableLayer('user')
assert.equal(aiditor.componentRegistration('case.roleBag'), null)
assert.equal(aiditor.extensions.get('case').filtered, true)
aiditor.extensions.enableLayer('user')
assert.equal(aiditor.componentRegistration('case.roleBag').owner, 'extension:case')

const promotedPreview = ai.operations.preview('aiditor.promoteExtensionLayer', { id: 'case', layer: 'session' })
const promoted = ai.operations.apply(promotedPreview)
assert.equal(promoted.installed, true)
assert.equal(aiditor.extensions.get('case').manifest.layer, 'session')

const panelToRemove = aiditor.findDock(tree, tree.id).node.panels.find(function (p) { return p.owner === 'extension:case' }).id
const removePanelPreview = ai.operations.preview('aiditor.removePanelFromDock', { panelId: panelToRemove })
const panelRemoved = ai.operations.apply(removePanelPreview)
assert.deepEqual(panelRemoved.removed, [panelToRemove])
assert.equal(aiditor.findPanel(tree, panelToRemove), null)

assert.throws(function () {
  aiditor.extensions.install({
    id: 'code.bad',
    trust: { code: 'trusted' },
    contributes: { components: [{ id: 'panel', kind: 'factory', source: 'function(){ return document.createElement("div") }' }] },
  })
}, /allowCode/)

const codeReview = aiditor.extensions.review({
  id: 'code.review',
  layer: 'user',
  trust: { code: 'trusted' },
  permissions: ['app.read'],
  contributes: { components: [{ id: 'panel', kind: 'factory', source: 'function(){ return document.createElement("div") }' }] },
})
assert.equal(codeReview.canApply, false)
assert.equal(codeReview.requiredConsent, 'allowCode')
assert.equal(codeReview.permissions.includes('extensions.code.install'), true)
assert.equal(codeReview.permissions.includes('extensions.layer.user.write'), true)
const reviewOnly = await aiditor.extensions.installWithReview({
  id: 'code.review.only',
  trust: { code: 'trusted' },
  contributes: { components: [{ id: 'panel', kind: 'factory', source: 'function(){ return document.createElement("div") }' }] },
})
assert.equal(reviewOnly.canApply, false)
assert.equal(aiditor.componentRegistration('code.review.only.panel'), null)

aiditor.extensions.configurePermissions({
  install: function (details) { return details.manifest.id !== 'blocked.extension' },
})
assert.equal(aiditor.extensions.review({ id: 'blocked.extension' }).canInstall, false)
assert.throws(function () {
  aiditor.extensions.install({ id: 'blocked.extension' })
}, /permission denied/)
aiditor.extensions.configurePermissions(null)

const codeInstalled = aiditor.extensions.install({
  id: 'code.ok',
  trust: { code: 'trusted' },
  contributes: { components: [{ id: 'panel', kind: 'factory', source: 'function(){ return document.createElement("div") }' }] },
}, { allowCode: true, save: false })
assert.equal(codeInstalled.installed, true)
assert.equal(aiditor.componentRegistration('code.ok.panel').owner, 'extension:code.ok')
aiditor.extensions.uninstall('code.ok', { save: false })

assert.throws(function () {
  aiditor.extensions.install({
    id: 'code.hash.bad',
    trust: { code: 'sandbox' },
    contributes: { components: [{ id: 'panel', kind: 'iframe', srcdoc: '<p>x</p>', hash: 'bad' }] },
  }, { allowCode: true, save: false })
}, /hash mismatch/)
const srcdoc = '<p>isolated</p>'
const iframeInstalled = aiditor.extensions.install({
  id: 'code.iframe',
  trust: { code: 'sandbox' },
  contributes: { components: [{ id: 'panel', kind: 'iframe', srcdoc: srcdoc, hash: aiditor.extensions.hashSource(srcdoc) }] },
}, { allowCode: true, save: false })
assert.equal(iframeInstalled.installed, true)
assert.equal(aiditor.componentRegistration('code.iframe.panel').owner, 'extension:code.iframe')
aiditor.extensions.uninstall('code.iframe', { save: false })

aiditor.extensions.uninstall('case', { save: false })
assert.equal(aiditor.componentRegistration('case.roleBag'), null)
const booted = aiditor.extensions.boot()
assert.equal(booted.count, 1)
assert.equal(aiditor.componentRegistration('case.roleBag').owner, 'extension:case')

const removePreview = ai.operations.preview('aiditor.removeExtension', { id: 'case' })
const removed = ai.operations.apply(removePreview)
assert.equal(removed.removed, true)
assert.equal(aiditor.componentRegistration('case.roleBag'), null)
assert.deepEqual(ai.references.list({ owner: 'extension:case' }), [])
assert.deepEqual(ai.operations.list({ owner: 'extension:case' }), [])
assert.equal(ai.tools.get('case.read'), undefined)
assert.equal(ai.context.get('case.context'), undefined)
assert.equal(aiditor.findDock(tree, tree.id).node.panels.length, 0)

const delayedMemory = storage()
global.window.localStorage = delayedMemory
aiditor.extensions.configureStorage({ key: 'delayed.extensions', storage: delayedMemory, load: false })
let delayedTree = aiditor.dock({ name: 'main' })
aiditor.extensions.install({
  id: 'delayed',
  contributes: {
    components: [{ id: 'panel', ui: null }],
    dockPanels: [{ layout: 'delayed', dock: 'main', component: 'panel' }],
  },
}, { deferLayout: true })
assert.equal(aiditor.extensions.get('delayed').active, true)
assert.equal(aiditor.extensions.get('delayed').panels.length, 0)
aiditor.extensions.registerLayout('delayed', {
  tree: function () { return delayedTree },
  addPanel: function (dockName, partial, opts) {
    const found = aiditor.findByName(delayedTree, dockName)
    const r = aiditor.addPanel(delayedTree, found ? found.node.id : dockName, partial, opts || {})
    delayedTree = r.tree
    return { panelId: r.panelId }
  },
  removePanel: function (panelId) { delayedTree = aiditor.removePanel(delayedTree, panelId) },
  setTree: function (next) { delayedTree = next },
})
assert.equal(aiditor.findDock(delayedTree, delayedTree.id).node.panels[0].component, 'delayed.panel')

console.log('extension runtime tests ok')

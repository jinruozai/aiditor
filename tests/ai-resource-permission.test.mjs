import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/log.js', 'utf8'), { filename: 'log.js' })
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/ai/name-generator.js', 'utf8'), { filename: 'ai/name-generator.js' })
vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
vm.runInThisContext(readFileSync('src/ai/store.js', 'utf8'), { filename: 'ai/store.js' })
vm.runInThisContext(readFileSync('src/ai/connection.js', 'utf8'), { filename: 'ai/connection.js' })
vm.runInThisContext(readFileSync('src/ai/adapter.js', 'utf8'), { filename: 'ai/adapter.js' })
vm.runInThisContext(readFileSync('src/ai/provider.js', 'utf8'), { filename: 'ai/provider.js' })
vm.runInThisContext(readFileSync('src/ai/provider-auth.js', 'utf8'), { filename: 'ai/provider-auth.js' })
vm.runInThisContext(readFileSync('src/ai/provider-transports.js', 'utf8'), { filename: 'ai/provider-transports.js' })
vm.runInThisContext(readFileSync('src/ai/provider-connections.js', 'utf8'), { filename: 'ai/provider-connections.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
for (const file of ['src/ai/contribution-registry.js', 'src/ai/tool/registry.js', 'src/ai/context/registry.js', 'src/ai/skill/registry.js']) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
vm.runInThisContext(readFileSync('src/ai/tool/runtime.js', 'utf8'), { filename: 'ai/tool/runtime.js' })
vm.runInThisContext(readFileSync('src/ai/reference.js', 'utf8'), { filename: 'ai/reference.js' })
vm.runInThisContext(readFileSync('src/ai/request.js', 'utf8'), { filename: 'ai/request.js' })
vm.runInThisContext(readFileSync('src/ai/runtime.js', 'utf8'), { filename: 'ai/runtime.js' })

const ai = window.aiditor.ai
let requestSeen = null

ai.registerTransport('capture', {
  toolProtocol: 'native',
  send: function (connection, request) {
    requestSeen = request
    return { role: 'assistant', content: 'ok' }
  },
})
ai.registerConnection('capture', { auth: { type: 'none' }, transport: { type: 'capture' }, configDefaults: {} })

let deniedReferenceCalls = 0
ai.references.register('secret', {
  read: function () { deniedReferenceCalls += 1; return { hidden: true } },
  schema: function () { deniedReferenceCalls += 1; return { type: 'object' } },
  capabilities: function () { deniedReferenceCalls += 1; return [{ op: 'secret.write' }] },
}, { owner: 'test:resource-permission' })

const target = ai.createAgent({
  name: 'Target',
  connection: 'capture',
  messages: [{ role: 'user', content: 'read context' }],
})
const actor = ai.createAgent({ name: 'Actor' })
const res = ai.addAttachment({
  resolver: 'secret',
  uri: 'secret://one',
  kind: 'secret.item',
  title: 'Secret One',
  meta: { id: 'one' },
})
ai.updateAgent(target.id, { contextRefs: [res.id] })
ai.setPermissionResolver(function (ctx, next) {
  if (ctx.scope === 'attachments.read') return false
  return next(ctx)
})

const run = ai.runAgent(target.id, { actor: actor.id })
await run.promise

assert.deepEqual(requestSeen.attachmentRefs, [])
assert.deepEqual(requestSeen.attachments, [])
assert.equal(requestSeen.messages.some(function (m) {
  return String(m.content || '').indexOf('Secret One') >= 0 || String(m.content || '').indexOf('secret://one') >= 0
}), false)
assert.equal(deniedReferenceCalls, 0)

ai.setPermissionResolver(null)
let readCtx = null
let schemaCtx = null
let capabilitiesCtx = null
ai.references.register('inspect', {
  read: function (ref, options, ctx) {
    readCtx = ctx
    return { uri: ref.uri, text: 'visible' }
  },
  schema: function (ref, ctx) {
    schemaCtx = ctx
    return { type: 'object', properties: { text: { type: 'string' } } }
  },
  capabilities: function (ref, ctx) {
    capabilitiesCtx = ctx
    return [{ op: 'inspect.update', risk: 'edit' }]
  },
}, { owner: 'test:resource-permission' })
const supervisor = ai.createAgent({ name: 'Supervisor' })
const visibleAgent = ai.createAgent({
  name: 'Visible Target',
  parentAgentId: supervisor.id,
  connection: 'capture',
  messages: [{ role: 'user', content: 'read visible context' }],
})
const visible = ai.addAttachment({
  resolver: 'inspect',
  uri: 'inspect://one',
  kind: 'inspect.item',
  title: 'Visible One',
  meta: { id: 'one' },
})
ai.updateAgent(visibleAgent.id, { contextRefs: [visible.id] })
await ai.runAgent(visibleAgent.id, { actor: supervisor.id }).promise
assert.equal(readCtx.actor, supervisor.id)
assert.equal(schemaCtx.actor, supervisor.id)
assert.equal(capabilitiesCtx.actor, supervisor.id)
assert.equal(typeof readCtx.canRead, 'function')
assert.equal(readCtx.canRead(visibleAgent.id, 'attachments.read'), true)
assert.equal(requestSeen.attachmentRefs[0].schema.properties.text.type, 'string')
assert.equal(requestSeen.attachmentRefs[0].capabilities[0].op, 'inspect.update')

const imageAgent = ai.createAgent({
  name: 'Image Target',
  connection: 'capture',
  messages: [{ role: 'user', content: 'read image' }],
})
const image = ai.addAttachment({
  resolver: 'file',
  uri: 'file://upload/icon.png',
  kind: 'file.image',
  title: 'icon.png',
  meta: { dataUrl: 'data:image/png;base64,aGVsbG8=', type: 'image/png' },
})
ai.updateAgent(imageAgent.id, { contextRefs: [image.id] })
await ai.runAgent(imageAgent.id).promise
assert.equal(requestSeen.messages[0].role, 'system')
const resourceMessage = requestSeen.messages.find(function (message) {
  return String(message.content || '').indexOf('Attached editor context') >= 0
})
assert.equal(!!resourceMessage, true)
assert.equal(String(resourceMessage.content).includes('data:image/png;base64'), false)
assert.equal(String(resourceMessage.content).includes('hasImageData'), true)
assert.equal(requestSeen.attachments[0].meta.dataUrl, 'data:image/png;base64,aGVsbG8=')

console.log('ai resource permission tests ok')

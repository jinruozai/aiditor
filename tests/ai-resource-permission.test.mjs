import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/log.js', 'utf8'), { filename: 'log.js' })
vm.runInThisContext(readFileSync('src/core/names.js', 'utf8'), { filename: 'names.js' })
vm.runInThisContext(readFileSync('src/ai/agent/name-generator.js', 'utf8'), { filename: 'ai/agent/name-generator.js' })
vm.runInThisContext(readFileSync('src/ai/permission.js', 'utf8'), { filename: 'ai/permission.js' })
vm.runInThisContext(readFileSync('src/ai/agent/store.js', 'utf8'), { filename: 'ai/agent/store.js' })
vm.runInThisContext(readFileSync('src/ai/connection.js', 'utf8'), { filename: 'ai/connection.js' })
vm.runInThisContext(readFileSync('src/ai/adapter.js', 'utf8'), { filename: 'ai/adapter.js' })
vm.runInThisContext(readFileSync('src/ai/provider.js', 'utf8'), { filename: 'ai/provider.js' })
vm.runInThisContext(readFileSync('src/ai/provider-auth.js', 'utf8'), { filename: 'ai/provider-auth.js' })
vm.runInThisContext(readFileSync('src/ai/provider-transports.js', 'utf8'), { filename: 'ai/provider-transports.js' })
vm.runInThisContext(readFileSync('src/ai/provider-connections.js', 'utf8'), { filename: 'ai/provider-connections.js' })
vm.runInThisContext(readFileSync('src/ai/schema.js', 'utf8'), { filename: 'ai/schema.js' })
for (const file of ['src/ai/contribution-registry.js', 'src/ai/tool/registry.js', 'src/ai/context/registry.js', 'src/ai/skill/registry.js']) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
vm.runInThisContext(readFileSync('src/ai/tool/scheduler.js', 'utf8'), { filename: 'ai/tool/scheduler.js' })
vm.runInThisContext(readFileSync('src/ai/tool/runtime.js', 'utf8'), { filename: 'ai/tool/runtime.js' })
vm.runInThisContext(readFileSync('src/ai/reference.js', 'utf8'), { filename: 'ai/reference.js' })
vm.runInThisContext(readFileSync('src/ai/agent/request.js', 'utf8'), { filename: 'ai/agent/request.js' })
vm.runInThisContext(readFileSync('src/ai/agent/runtime.js', 'utf8'), { filename: 'ai/agent/runtime.js' })

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
ai.permissions.setResolver(function (ctx, next) {
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

ai.permissions.setResolver(null)
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

let asyncReads = 0
let releaseAsyncRead
ai.references.register('async-inspect', {
  read: function (ref, options, ctx) {
    asyncReads++
    return new Promise(function (resolve) {
      releaseAsyncRead = function () { resolve({ uri: ref.uri, text: 'hydrated', aborted: ctx.signal && ctx.signal.aborted }) }
    })
  },
}, { owner: 'test:resource-permission' })
const asyncAgent = ai.createAgent({ name: 'Async Reference' })
const asyncRef = ai.addAttachment({ resolver: 'async-inspect', uri: 'async-inspect://one', kind: 'inspect.item' })
ai.updateAgent(asyncAgent.id, { contextRefs: [asyncRef.id] })
const asyncPlan = ai.planRequest(ai.findAgent(asyncAgent.id), null, 'async-reference-plan', 'user', 0)
assert.deepEqual(asyncPlan.attachments, [])
assert.equal(asyncReads, 0)
const asyncResolvedPromise = ai.resolveRequest(asyncPlan)
await Promise.resolve()
assert.equal(asyncReads, 1)
releaseAsyncRead()
const asyncResolved = await asyncResolvedPromise
assert.equal(asyncResolved.hydrated, true)
assert.equal(asyncResolved.attachments[0].text, 'hydrated')
assert.equal(asyncResolved.messages.some(function (message) { return String(message.content || '').indexOf('hydrated') >= 0 }), true)

let releaseCancelledRead
const cancelledPlan = ai.planRequest(ai.findAgent(asyncAgent.id), null, 'cancelled-reference-plan', 'user', 0)
const hydrationController = new AbortController()
const cancelledHydration = ai.resolveRequest(cancelledPlan, hydrationController.signal)
await Promise.resolve()
releaseCancelledRead = releaseAsyncRead
hydrationController.abort()
await assert.rejects(cancelledHydration, function (error) { return error.code === 'REFERENCE_HYDRATION_CANCELLED' })
releaseCancelledRead()

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

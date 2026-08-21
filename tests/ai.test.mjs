import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/i18n.js', 'utf8'), { filename: 'i18n.js' })
vm.runInThisContext(readFileSync('src/ai/i18n.js', 'utf8'), { filename: 'ai/i18n.js' })
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
vm.runInThisContext(readFileSync('src/ai/operation/change-set.js', 'utf8'), { filename: 'ai/operation/change-set.js' })
vm.runInThisContext(readFileSync('src/ai/agent/request.js', 'utf8'), { filename: 'ai/agent/request.js' })
vm.runInThisContext(readFileSync('src/ai/agent/runtime.js', 'utf8'), { filename: 'ai/agent/runtime.js' })

const aiditor = window.aiditor
const ai = aiditor.ai

function ids(items) {
  return items.map(function (item) { return item.id })
}

function byId(items, id) {
  return items.find(function (item) { return item.id === id })
}

function assertNoSessionSurface() {
  assert.equal('sessions' in ai, false)
  assert.equal('activeSessionId' in ai, false)
  assert.equal('createSession' in ai, false)
  assert.equal('deleteSession' in ai, false)
  assert.equal('selectSession' in ai, false)
  assert.equal('findSession' in ai, false)

  assert.equal('groups' in ai, false)
  assert.equal('createGroup' in ai, false)
  assert.equal('deleteGroup' in ai, false)
  assert.equal('moveGroup' in ai, false)
  assert.equal('findAgentByPath' in ai, false)
  assert.equal('setAgentPath' in ai, false)
  assert.deepEqual(ai.agents(), [])
  assert.deepEqual(ai.attachments(), [])
  assert.equal(ai.activeAgentId(), null)
}

function assertAgentNameGenerator() {
  const existing = []
  for (let i = 0; i < 3600; i++) {
    const name = ai.generateAgentName(existing, function () { return 0 })
    assert.equal(existing.includes(name), false)
    existing.push(name)
  }
  assert.equal(existing.length, 3600)
  assert.equal(ai.generateAgentName(existing, function () { return 0 }), existing[0] + ' 2')

  const generated = ai.createAgent({ select: false })
  assert.match(generated.name, /^[A-Z][a-z]+ [A-Z][A-Za-z]+$/)
  ai.deleteAgent(generated.id)
}

function assertAgentModelDefaults() {
  ai.setLastSelectedModel({ connection: null, model: '' })
  ai.setActiveConnection('openai-codex')
  const defaulted = ai.createAgent({ name: 'Default Model Agent', select: false })
  assert.equal(defaulted.connection, 'openai-codex')
  assert.equal(defaulted.model, 'gpt-5.5')

  ai.setLastSelectedModel({ connection: 'openai-codex', model: 'gpt-5.5-pro' })
  const recent = ai.createAgent({ name: 'Recent Model Agent', select: false })
  assert.equal(recent.connection, 'openai-codex')
  assert.equal(recent.model, 'gpt-5.5-pro')

  const explicit = ai.createAgent({ name: 'Explicit Model Agent', connection: 'mock', model: 'manual-model', select: false })
  assert.equal(explicit.connection, 'mock')
  assert.equal(explicit.model, 'manual-model')

  ai.deleteAgent(defaulted.id)
  ai.deleteAgent(recent.id)
  ai.deleteAgent(explicit.id)
  ai.setLastSelectedModel({ connection: null, model: '' })
  ai.setActiveConnection('mock')
}

function assertAgentsAreIdBasedTree() {
  const agent = ai.createAgent({
    name: 'Planner',
    connection: 'mock',
    model: 'fast',
    messages: [{ role: 'system', from: 'system', content: 'keep' }],
    contextRefs: ['ctx-1'],
    memory: { facts: ['stable'] },
    state: { count: 1 },
    permissions: { paths: [{ path: 'planner', mode: 'readwrite' }] },
    meta: { owner: 'test' },
  })
  const child = ai.createAgent({
    name: 'Planner',
    parentAgentId: agent.id,
    select: false,
    order: 2,
  })
  const peer = ai.createAgent({ name: 'Peer', select: false })
  const background = ai.createAgent({
    name: 'Background',
    select: false,
  })
  ai.deleteAgent(background.id)

  assert.equal(ai.activeAgentId(), agent.id)
  assert.equal(child.name, agent.name)
  assert.notEqual(child.id, agent.id)
  assert.equal(child.workingDirectory, undefined)
  assert.equal(byId(ai.agents(), child.id).parentAgentId, agent.id)
  assert.equal('path' in byId(ai.agents(), agent.id), false)
  assert.equal('groupId' in byId(ai.agents(), agent.id), false)

  const beforeMove = byId(ai.agents(), child.id)
  ai.reparentAgent(child.id, peer.id, 0)
  const afterMove = byId(ai.agents(), child.id)
  assert.equal(afterMove.parentAgentId, peer.id)
  assert.equal(afterMove.order, 0)
  assert.deepEqual(afterMove.messages, beforeMove.messages)
  assert.deepEqual(afterMove.contextRefs, beforeMove.contextRefs)
  assert.deepEqual(afterMove.memory, beforeMove.memory)
  assert.deepEqual(afterMove.state, beforeMove.state)
  assert.equal(afterMove.connection, beforeMove.connection)
  assert.equal(afterMove.model, beforeMove.model)
  assert.equal(afterMove.status, beforeMove.status)

  const deleted = ai.deleteAgent(peer.id)
  assert.equal(deleted.id, peer.id)
  assert.equal(ai.findAgent(child.id), null)

  return { agent: byId(ai.agents(), agent.id) }
}

function assertAgentRuntimeState(seedAgent) {
  const renamed = ai.renameAgent(seedAgent.id, 'Runtime Planner')
  assert.equal(renamed.name, 'Runtime Planner')

  const moved = ai.moveAgent(seedAgent.id, { parentAgentId: null, order: 4 })
  assert.equal(moved.parentAgentId, null)
  assert.equal(moved.order, 4)

  const child = ai.createAgent({ name: 'Child Agent', parentAgentId: seedAgent.id, select: false })
  const nested = ai.createAgent({ name: 'Nested Agent', parentAgentId: child.id, select: false })
  assert.equal(ai.isDescendant(seedAgent.id, child.id), true)
  assert.equal(ai.isDescendant(seedAgent.id, nested.id), true)

  const reparented = ai.reparentAgent(child.id, null)
  assert.equal(reparented.parentAgentId, null)
  assert.equal(byId(ai.agents(), nested.id).parentAgentId, child.id)

  const updated = ai.updateAgent(seedAgent.id, {
    contextRefs: ['ctx-2'],
    memory: { facts: ['changed'] },
    state: { count: 2 },
    permissions: { paths: [{ path: 'runtime', mode: 'read' }] },
  })
  assert.deepEqual(updated.contextRefs, ['ctx-2'])
  assert.deepEqual(updated.memory, { facts: ['changed'] })
  assert.deepEqual(updated.state, { count: 2 })
  assert.equal(updated.status, 'idle')
  assert.equal(updated.messages.length, 1)

  const appended = ai.appendMessage(seedAgent.id, {
    role: 'assistant',
    from: 'agent:' + seedAgent.id,
    content: 'manual note',
    contextRefs: ['ctx-2'],
    meta: { source: 'test' },
  })
  assert.equal(appended.role, 'assistant')
  assert.equal(appended.from, 'agent:' + seedAgent.id)
  assert.equal(appended.status, 'done')
  assert.equal(byId(ai.agents(), seedAgent.id).messages.length, 2)
  ai.deleteAgent(child.id)
}

function assertReferenceProviderContract(agentId) {
  let resolveCtxSeen = null
  ai.references.register('case', {
    describe: function (ref) { return { title: ref.title, summary: 'summary:' + ref.uri } },
    read: function (ref, options, ctx) {
      resolveCtxSeen = ctx
      return { uri: ref.uri, text: 'resolved:' + ref.uri }
    },
  }, { owner: 'test:ai' })

  const temp = ai.addAttachment({ resolver: 'case', uri: 'case://selection/temp', title: 'Temp' })
  ai.updateAgent(agentId, { contextRefs: [temp.id] })
  ai.removeAttachment(temp.id)
  assert.deepEqual(byId(ai.agents(), agentId).contextRefs, [])

  const ref = ai.addAttachment({
    resolver: 'case',
    uri: 'case://selection/item-1',
    kind: 'selection',
    title: 'Item 1',
    summary: 'short',
    meta: { table: 'items' },
  })
  ai.updateAgent(agentId, { contextRefs: [ref.id] })

  assert.equal(ai.attachments().length, 1)
  assert.deepEqual(ai.references.describe(ref), {
    title: 'Item 1',
    summary: 'summary:case://selection/item-1',
  })

  return {
    ref: ref,
    assertResolved: function () {
      assert.equal(resolveCtxSeen.agent.id, agentId)
    },
  }
}

function assertPermissionContract(agentId) {
  const managed = ai.createAgent({
    name: 'Managed',
    parentAgentId: agentId,
    select: false,
    permissions: { paths: [{ path: 'runtime/managed', mode: 'read' }] },
  })
  const sibling = ai.createAgent({ name: 'Sibling', select: false })

  assert.equal(ai.canRead('user', agentId, 'agent.full'), true)
  assert.equal(ai.canSend('user', agentId), true)
  assert.equal(ai.canManage('user', agentId), true)
  assert.equal(ai.canRead(agentId, agentId, 'messages.read'), true)
  assert.equal(ai.canSend(agentId, agentId), true)
  assert.equal(ai.canManage(agentId, agentId), true)
  assert.equal(ai.canRead(agentId, managed.id, 'agent.summary'), true)
  assert.equal(ai.canRead(agentId, sibling.id, 'agent.summary'), false)

  const runCtx = ai.createRunContext({
    agent: byId(ai.agents(), agentId),
    actor: managed.id,
    runId: 'permission_ctx',
    runtimeContext: [],
  }, { signal: null })
  assert.equal(runCtx.canRead(agentId, 'agent.full'), false)
  assert.equal(runCtx.canSend(agentId), false)
  assert.equal(runCtx.canManage(agentId), false)
  assert.equal(runCtx.canRead(managed.id, 'agent.full'), true)

  const calls = []
  ai.permissions.setResolver(function (ctx, next) {
    calls.push(ctx)
    if (ctx.actor === 'blocked') return false
    return next(ctx)
  })
  assert.equal(ai.canRead('blocked', agentId, 'agent.full'), false)
  assert.equal(calls.length > 0, true)
  ai.permissions.setResolver(null)

  ai.deleteAgent(sibling.id)
  return managed
}

async function assertChangeSetPermission(parentId, childId) {
  ai.updateAgent(childId, { permissionMode: 'full' })
  let applyCount = 0
  aiditor.changeSet.registerAdapter('permission.patch', {
    apply: function () {
      applyCount += 1
      return { applied: true }
    },
  })
  const parentSet = aiditor.changeSet.create({
    title: 'Parent owned change',
    source: { agentId: parentId },
    resources: [],
    apply: { mode: 'atomic', adapter: 'permission.patch', payload: {} },
  })
  const denied = await aiditor.changeSet.apply(parentSet.id, { type: 'all' }, childId)
  assert.equal(denied.status, 'failed')
  assert.match(denied.meta.error, /ChangeSet apply not allowed/)
  assert.equal(applyCount, 0)

  const childSet = aiditor.changeSet.create({
    title: 'Child owned change',
    source: { agentId: childId },
    resources: [],
    apply: { mode: 'atomic', adapter: 'permission.patch', payload: {} },
  })
  const allowed = await aiditor.changeSet.apply(childSet.id, { type: 'all' }, parentId)
  assert.equal(allowed.status, 'applied')
  assert.equal(applyCount, 1)
}

function assertRegistryContracts(agentId) {
  ai.tools.register('diff-preview', {
    title: 'Diff Preview',
    description: 'Preview a change before applying it.',
    schema: { type: 'object' },
    permissions: ['tool.call', 'tool.apply'],
    preview: function (args) { return { kind: 'diff', args: args } },
    run: function (args) { return { ok: true, args: args } },
    apply: function (result) { return { applied: result.ok } },
  }, { owner: 'test:registry' })
  ai.skills.register('review', { id: 'review', title: 'Review', toolDisclosure: 'always', tools: ['diff-preview'] }, { owner: 'test:registry' })
  ai.context.register('selection', {
    capture: function () { return { text: 'selected' } },
  }, { owner: 'test:registry' })
  ai.skills.register('plugin-skill', { id: 'plugin-skill', title: 'Plugin Skill' }, { owner: 'test:plugin' })

  assert.equal(ai.tools.list().includes('diff-preview'), true)
  assert.equal(ai.tools.get('diff-preview').preview({ id: 1 }).kind, 'diff')
  assert.equal(ai.tools.get('diff-preview').apply({ ok: true }).applied, true)
  assert.equal(ai.skills.get('review').title, 'Review')
  assert.equal(ai.skills.get('plugin-skill').title, 'Plugin Skill')
  assert.equal(ai.context.get('selection').capture().text, 'selected')
  assert.equal(ai.skills.meta('plugin-skill').owner, 'test:plugin')

  ai.updateAgent(agentId, {
    state: {
      projectRule: {
        maxRows: 3,
        reviewLevel: 'strict',
      },
    },
  })
}

async function assertSendRunStatusAndRequest(agentId, resourceCheck) {
  let requestSeen = null
  let ctxSeen = null
  let callCount = 0
  ai.registerTransport('capture', {
    toolProtocol: 'native',
    send: function (connection, request, ctx) {
      callCount += 1
      requestSeen = request
      ctxSeen = ctx
      return {
        role: 'assistant',
        content: 'captured ' + request.messages[request.messages.length - 1].content,
      }
    },
  })
  ai.registerConnection('capture', { auth: { type: 'none' }, transport: { type: 'capture' }, configDefaults: {} })

  ai.updateAgent(agentId, { connection: 'capture', model: 'reasoning' })
  const sent = ai.message.send(agentId, { content: 'balance sword prices' }, 'user')
  assert.equal(sent.message.role, 'user')
  assert.equal(sent.message.from, 'user')
  assert.equal(sent.message.content, 'balance sword prices')
  assert.equal(byId(ai.agents(), agentId).status, 'running')

  const reply = await sent.promise
  const afterSend = byId(ai.agents(), agentId)
  assert.equal(reply.role, 'assistant')
  assert.equal(reply.content, 'captured balance sword prices')
  assert.equal(afterSend.status, 'idle')
  assert.equal(afterSend.messages.at(-2).content, 'balance sword prices')
  assert.equal(afterSend.messages.at(-1).content, 'captured balance sword prices')
  assert.equal(callCount, 1)
  assert.equal(requestSeen.agent.id, agentId)
  assert.equal(requestSeen.agent.state.projectRule.maxRows, 3)
  assert.equal(requestSeen.connection, 'capture')
  assert.equal(requestSeen.model, 'reasoning')
  assert.deepEqual(requestSeen.attachments, [{ uri: 'case://selection/item-1', text: 'resolved:case://selection/item-1' }])
  assert.equal(requestSeen.tools.includes('diff-preview'), true)
  assert.equal(Object.hasOwn(requestSeen, 'skills'), false)
  assert.equal(ctxSeen.canRead(agentId), true)
  assert.equal(ctxSeen.canSend(agentId), true)
  assert.equal(ctxSeen.canManage(agentId), true)
  resourceCheck.assertResolved()
}

async function assertStopAgent(agentId) {
  let releaseRun
  const held = new Promise(function (resolve) { releaseRun = resolve })
  ai.registerTransport('hold', {
    toolProtocol: 'native',
    send: function () { return held.then(function () { return 'late' }) },
  })
  ai.registerConnection('hold', { auth: { type: 'none' }, transport: { type: 'hold' }, configDefaults: {} })
  ai.updateAgent(agentId, { connection: 'hold' })
  const run = ai.runAgent(agentId)
  assert.equal(byId(ai.agents(), agentId).status, 'running')
  assert.equal(ai.stopAgent(agentId), true)
  assert.equal(byId(ai.agents(), agentId).status, 'idle')
  releaseRun()
  assert.equal(await run.promise, null)
}

assertNoSessionSurface()
assertAgentNameGenerator()
assertAgentModelDefaults()
const seed = assertAgentsAreIdBasedTree()
assertAgentRuntimeState(seed.agent)
const resourceCheck = assertReferenceProviderContract(seed.agent.id)
const managed = assertPermissionContract(seed.agent.id)
await assertChangeSetPermission(seed.agent.id, managed.id)
assertRegistryContracts(seed.agent.id)
await assertSendRunStatusAndRequest(seed.agent.id, resourceCheck)
await assertStopAgent(seed.agent.id)

const removedManaged = ai.deleteAgent(managed.id)
assert.equal(removedManaged.id, managed.id)
const removedSeed = ai.deleteAgent(seed.agent.id)
assert.equal(removedSeed.id, seed.agent.id)
assert.deepEqual(ai.agents(), [])
assert.equal(ai.activeAgentId(), null)

function matchesSelector(el, selector) {
  if (!el || !selector) return false
  if (selector[0] === '.') return (el.className || '').split(/\s+/).includes(selector.slice(1))
  if (selector === '[data-message-payload]') return !!(el.dataset && el.dataset.messagePayload)
  return el.tagName && el.tagName.toLowerCase() === selector.toLowerCase()
}

function findInTree(el, selector) {
  const children = el && el.children || []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (matchesSelector(child, selector)) return child
    const found = findInTree(child, selector)
    if (found) return found
  }
  return null
}

function makeTextNode(text) {
  let value = String(text == null ? '' : text)
  return {
    nodeType: 3,
    parentNode: null,
    children: [],
    get nodeValue() { return value },
    set nodeValue(next) {
      value = String(next == null ? '' : next)
      this.textContent = value
    },
    textContent: value,
    remove: function () {
      if (this.parentNode) this.parentNode.removeChild(this)
    },
  }
}

function makeElement(tag) {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: '',
    attributes: {},
    dataset: {},
    events: {},
    children: [],
    parentNode: null,
    textContent: '',
    scrollTop: 0,
    clientHeight: 200,
    scrollHeight: 200,
    style: {},
    classList: {
      add: function (name) {
        this.el.className = this.el.className ? this.el.className + ' ' + name : name
      },
      el: null,
    },
    appendChild: function (child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    insertBefore: function (child, before) {
      if (!before) return this.appendChild(child)
      const index = this.children.indexOf(before)
      if (index < 0) return this.appendChild(child)
      if (child.parentNode) child.parentNode.removeChild(child)
      this.children.splice(index, 0, child)
      child.parentNode = this
      return child
    },
    replaceChild: function (next, prev) {
      const index = this.children.indexOf(prev)
      if (index < 0) throw new Error('NotFoundError')
      if (next.parentNode) next.parentNode.removeChild(next)
      this.children[index] = next
      next.parentNode = this
      prev.parentNode = null
      return prev
    },
    removeChild: function (child) {
      this.children = this.children.filter(function (item) { return item !== child })
      child.parentNode = null
      return child
    },
    remove: function () {
      if (this.parentNode) this.parentNode.removeChild(this)
    },
    setAttribute: function (name, value) {
      this.attributes[name] = value
    },
    addEventListener: function (type, fn) {
      if (!this.events[type]) this.events[type] = []
      this.events[type].push(fn)
    },
    contains: function (node) {
      if (node === this) return true
      const children = this.children || []
      for (let i = 0; i < children.length; i++) {
        if (children[i] === node || (children[i].contains && children[i].contains(node))) return true
      }
      return false
    },
    querySelector: function (selector) {
      return findInTree(this, selector)
    },
    get firstChild() {
      return this.children[0] || null
    },
    get childNodes() {
      return this.children
    },
  }
}

function collectText(el) {
  let out = el.textContent || ''
  ;(el.children || []).forEach(function (child) { out += '\n' + collectText(child) })
  return out
}

function countClass(el, className) {
  if (!el) return 0
  const own = String(el.className || '').split(/\s+/).indexOf(className) >= 0 ? 1 : 0
  return own + (el.children || []).reduce(function (total, child) {
    return total + countClass(child, className)
  }, 0)
}

function elementsWithClass(el, className, out) {
  out = out || []
  if (!el) return out
  if (String(el.className || '').split(/\s+/).indexOf(className) >= 0) out.push(el)
  ;(el.children || []).forEach(function (child) { elementsWithClass(child, className, out) })
  return out
}

function clickElement(el) {
  const listeners = el && el.events && el.events.click || []
  for (let i = 0; i < listeners.length; i++) listeners[i]({ currentTarget: el, stopPropagation: function () {} })
}

async function assertGdePatchPreviewRendering() {
  const components = {}
  global.document = {
    createElement: function (tag) {
      const el = makeElement(tag)
      el.classList.el = el
      return el
    },
    createTextNode: makeTextNode,
  }
  global.requestAnimationFrame = function (fn) { fn() }
  window.aiditor.ui = {
    isSignal: function (v) { return typeof v === 'function' && typeof v.peek === 'function' },
    h: function (tag, cls, attrs) {
      const el = document.createElement(tag)
      if (cls) el.className = cls
      if (attrs) Object.keys(attrs).forEach(function (key) {
        if (key === 'text') el.textContent = attrs[key]
        else el.setAttribute(key, attrs[key])
      })
      return el
    },
    dispose: function (el) { if (el && el.remove) el.remove() },
    collect: function () {},
    bindText: function (el, value) { el.textContent = String(this.isSignal(value) ? value() : (value || '')) },
    button: function (opts) {
      const text = this.isSignal(opts.text) ? opts.text() : (opts.text || '')
      const el = this.h('button', 'aiditor-ui-btn', { text: text })
      if (opts.onClick) el.addEventListener('click', opts.onClick)
      return el
    },
    stateButton: function () { return this.h('button', 'aiditor-ui-state-btn') },
    'switch': function (opts) {
      const label = this.isSignal(opts.label) ? opts.label() : (opts.label || '')
      const el = this.h('label', 'aiditor-ui-switch', { text: label })
      el.__change = opts.onChange || function () {}
      return el
    },
    tooltip: function (el) { return el },
    copyButton: function (opts) {
      const el = this.h('button', 'aiditor-ui-copy-btn', { text: 'Copy' })
      const text = opts && opts.text
      el.__copyText = typeof text === 'function' ? text() : text
      return el
    },
    scrollArea: function () { return this.h('div', 'aiditor-ui-scrollarea') },
    view: function (opts) {
      const el = this.h('div', 'aiditor-ui-view')
      const children = opts && opts.children
      const list = Array.isArray(children) ? children : (children ? [children] : [])
      for (let i = 0; i < list.length; i++) el.appendChild(list[i])
      return el
    },
  }
  window.aiditor.registerComponent = function (name, spec) { components[name] = spec }
  vm.runInThisContext(readFileSync('src/ui/data/changeReview.js', 'utf8'), { filename: 'ui/data/changeReview.js' })
  vm.runInThisContext(readFileSync('src/ai/message-markdown.js', 'utf8'), { filename: 'ai/message-markdown.js' })
  vm.runInThisContext(readFileSync('src/ai/message-renderers.js', 'utf8'), { filename: 'ai/message-renderers.js' })
  vm.runInThisContext(readFileSync('src/ai/panels/metrics-format.js', 'utf8'), { filename: 'ai/panels/metrics-format.js' })
  vm.runInThisContext(readFileSync('src/ai/panels/message-live-strip.js', 'utf8'), { filename: 'ai/panels/message-live-strip.js' })
  vm.runInThisContext(readFileSync('src/ai/panels/message-virtualizer.js', 'utf8'), { filename: 'ai/panels/message-virtualizer.js' })
  vm.runInThisContext(readFileSync('src/ai/panels/transcript.js', 'utf8'), { filename: 'ai/panels/transcript.js' })

  assert.equal(ai.metricFormat.duration(945000), '15m 45s')
  assert.equal(ai.metricFormat.duration(72000000), '20h')
  assert.equal(ai.metricFormat.tokens(5345461), '5.35M')
  assert.equal(ai.metricFormat.rate(635.3), '635.3')
  assert.equal(ai.metricFormat.rate(12345.6), '12.3K')
  assert.equal(ai.metricFormat.cost({ amount: 0.7393 }), '$0.7393')

  const compactMetricStrip = ai.createMessageLiveStrip()
  compactMetricStrip.update({
    state: 'idle',
    responseMetrics: true,
    startedAt: 1000,
    completedAt: 946000,
    totalTokens: 5345461,
    outputTokens: 635300,
    generationMs: 1000000,
    cost: { amount: 0.7393 },
  })
  assert.equal(collectText(compactMetricStrip.el.querySelector('.aiditor-ai-live-run-metrics')), '15m 45s · 5.35M tok · 635.3 tok/s · $0.7393')

  const waitingStrip = ai.createMessageLiveStrip()
  waitingStrip.update({
    state: 'waiting_approval',
    activityText: 'awaiting approval agent.delegate · 1/2',
    modelTail: 'agent.delegate{"outputSchema":{"type":"object"}}',
  })
  assert.equal(waitingStrip.el.querySelector('.aiditor-ai-live-run-preview').textContent, 'awaiting approval agent.delegate · 1/2')

  const preview = aiditor.changeSet.normalize({
    title: 'Tune swords',
    validation: { ok: false, errors: [{ path: 'ops[0].field', message: 'Field not in struct_def: missing' }] },
    resources: [{
      uri: 'gde://entity/data%2Fitems/100',
      kind: 'gde.entity',
      title: 'Iron Sword',
      subtitle: 'data/items / 100',
      changes: [{
        id: 'op_1',
        kind: 'gde.field',
        operation: 'update',
        path: 'price',
        title: 'setField',
        summary: 'data/items/100.price = 25',
        before: 20,
        after: 25,
      }],
    }],
    apply: { mode: 'atomic', adapter: 'gde.patch', payload: { type: 'gde.patch', ops: [] } },
  })
  const previewAgent = ai.createAgent({
    name: 'Patch Viewer',
    messages: [{
      role: 'assistant',
      content: 'preview',
      toolCalls: [{
        id: 'call-1',
        name: 'gde.patch',
        preview: preview,
        result: { ok: true, value: 1 },
      }],
    }],
  })
  ai.activeAgentId.set(previewAgent.id)

  const root = components['ai-messages'].factory(null, {})
  const text = collectText(root)
  assert.match(text, /Tune swords/)
  assert.match(text, /failed/)
  assert.match(text, /ops\[0\]\.field: Field not in struct_def: missing/)
  assert.match(text, /Iron Sword/)
  assert.match(text, /data\/items/)
  assert.match(text, /100/)
  assert.match(text, /price/)
  assert.match(text, /Before\s+20/)
  assert.match(text, /After\s+25/)
  assert.doesNotMatch(text, /"value": 1/)
  const footerCopy = root.querySelector('.aiditor-ai-message-footer').querySelector('.aiditor-ui-copy-btn')
  assert.match(footerCopy.__copyText, /preview/)
  assert.match(footerCopy.__copyText, /\[Tool\] gde\.patch/)
  assert.match(footerCopy.__copyText, /Preview:/)
  assert.match(footerCopy.__copyText, /Tune swords/)
  assert.match(footerCopy.__copyText, /Result:/)
  assert.match(footerCopy.__copyText, /"value": 1/)

  const streamAgent = ai.createAgent({
    name: 'Stable Transcript',
    messages: [{ id: 'stream-1', role: 'assistant', status: 'running', content: 'hello', reasoning_content: 'think' }],
  })
  ai.activeAgentId.set(streamAgent.id)
  const streamingRoot = components['ai-messages'].factory(null, {})
  const row = streamingRoot.querySelector('.aiditor-ai-message-row')
  const payload = streamingRoot.querySelector('[data-message-payload]')
  const firstTextPart = streamingRoot.querySelector('.aiditor-ai-message-text')
  const thinking = streamingRoot.querySelector('.aiditor-ai-message-reasoning')
  assert.ok(row)
  assert.ok(payload)
  assert.ok(firstTextPart)
  assert.ok(thinking)
  thinking.open = true
  const thinkingToggles = thinking.events.toggle || []
  for (let i = 0; i < thinkingToggles.length; i++) thinkingToggles[i]()

  ai.updateMessage(streamAgent.id, 'stream-1', { content: 'hello\n\nworld', reasoning_content: 'think more', status: 'running' })
  await new Promise(function (resolve) { setTimeout(resolve, 140) })

  assert.equal(streamingRoot.querySelector('.aiditor-ai-message-row'), row)
  assert.equal(streamingRoot.querySelector('[data-message-payload]'), payload)
  assert.equal(streamingRoot.querySelector('.aiditor-ai-message-text'), firstTextPart)
  assert.equal(streamingRoot.querySelector('.aiditor-ai-message-reasoning'), thinking)
  assert.equal(thinking.open, true)
  assert.match(collectText(thinking), /think more/)
  assert.match(collectText(streamingRoot), /world/)

  const responseAgent = ai.createAgent({
    name: 'Response Boundary',
    messages: [
      { id: 'response-input', role: 'user', status: 'done', content: 'work', meta: { responseId: 'response-input' } },
      { id: 'response-first', role: 'assistant', status: 'done', content: 'first part', meta: { runId: 'run-first', responseId: 'response-input' } },
      {
        id: 'response-continuation',
        role: 'user',
        status: 'queued',
        content: 'continue',
        meta: { runtimeEvent: 'post-delegation.continuation', responseId: 'response-input' },
      },
    ],
  })
  ai.activeAgentId.set(responseAgent.id)
  const responseRoot = components['ai-messages'].factory(null, {})
  assert.equal(countClass(responseRoot, 'aiditor-ai-message-footer'), 1)

  ai.updateMessage(responseAgent.id, 'response-continuation', { status: 'done' })
  ai.appendMessage(responseAgent.id, {
    id: 'response-final',
    role: 'assistant',
    status: 'done',
    content: 'final part',
    meta: { runId: 'run-final', responseId: 'response-input' },
  })
  await new Promise(function (resolve) { setTimeout(resolve, 140) })

  assert.equal(countClass(responseRoot, 'aiditor-ai-message-footer'), 2)
  const responseFooters = elementsWithClass(responseRoot, 'aiditor-ai-message-footer')
  const responseFooter = responseFooters[responseFooters.length - 1]
  assert.match(responseFooter.querySelector('.aiditor-ui-copy-btn').__copyText, /first part/)
  assert.match(responseFooter.querySelector('.aiditor-ui-copy-btn').__copyText, /final part/)

  const pendingChild = ai.createAgent({
    name: 'Pending Child',
    quests: [{ id: 'pending-quest', requestMessageId: 'pending-quest', status: 'running' }],
  })
  const delegatedAgent = ai.createAgent({
    name: 'Delegated Response Boundary',
    messages: [
      { id: 'delegated-input', role: 'user', status: 'done', content: 'delegate', meta: { responseId: 'delegated-input' } },
      {
        id: 'delegated-output',
        role: 'assistant',
        status: 'done',
        content: '',
        usage: { total_tokens: 40, output_tokens: 20 },
        stats: { generationMs: 1000, cost: { amount: 0.001 } },
        meta: { runId: 'run-delegated', responseId: 'delegated-input' },
        toolCalls: [{ toolId: 'agent.delegate', status: 'applied', applyResult: { agentId: pendingChild.id, questId: 'pending-quest' } }],
      },
    ],
  })
  ai.updateQuest(pendingChild.id, 'pending-quest', {
    fromAgentId: delegatedAgent.id,
    meta: { sourceResponseId: 'delegated-input' },
  })
  ai.activeAgentId.set(delegatedAgent.id)
  const delegatedRoot = components['ai-messages'].factory(null, {})
  assert.equal(countClass(delegatedRoot, 'aiditor-ai-message-footer'), 1)
  assert.equal(delegatedRoot.querySelector('.aiditor-ai-live-run').attributes['data-state'], 'waiting')
  assert.match(collectText(delegatedRoot.querySelector('.aiditor-ai-live-run-metrics')), /40 tok/)
  assert.match(collectText(delegatedRoot.querySelector('.aiditor-ai-live-run-metrics')), /20 tok\/s/)
  ai.appendMessage(pendingChild.id, {
    id: 'pending-result',
    role: 'assistant',
    status: 'done',
    content: 'pending child done',
    usage: { total_tokens: 25, output_tokens: 10 },
    stats: { generationMs: 500, cost: { amount: 0.002 } },
    meta: { runId: 'run-pending-child', responseId: 'pending-quest' },
  })
  ai.updateQuest(pendingChild.id, 'pending-quest', { status: 'completed', completedAt: Date.now() })
  ai.setAgentStatus(pendingChild.id, 'idle')
  await new Promise(function (resolve) { setTimeout(resolve, 140) })
  assert.equal(countClass(delegatedRoot, 'aiditor-ai-message-footer'), 2)
  assert.equal(delegatedRoot.querySelector('.aiditor-ai-live-run').attributes['data-state'], 'idle')

  const measuredChild = ai.createAgent({
    name: 'Measured Child',
    messages: [
      { id: 'measured-quest', role: 'user', status: 'done', content: 'child work', createdAt: 1500, completedAt: 1500, meta: { responseId: 'measured-quest' } },
      {
        id: 'measured-child-output',
        role: 'assistant',
        status: 'done',
        content: 'child result',
        createdAt: 1600,
        completedAt: 3000,
        usage: { total_tokens: 50, output_tokens: 20 },
        stats: { completedAt: 3000, generationMs: 1000, cost: { amount: 0.002 } },
        meta: { runId: 'run-child', responseId: 'measured-quest' },
        toolCalls: [{ toolId: 'child.read', status: 'completed', result: { ok: true } }],
      },
    ],
    quests: [{ id: 'measured-quest', requestMessageId: 'measured-quest', status: 'completed', completedAt: 3000 }],
  })
  const measuredParent = ai.createAgent({
    name: 'Measured Parent',
    messages: [
      { id: 'measured-input', role: 'user', status: 'done', content: 'measure all work', createdAt: 1000, completedAt: 1000, meta: { responseId: 'measured-input' } },
      {
        id: 'measured-parent-first',
        role: 'assistant',
        status: 'done',
        content: '',
        createdAt: 1100,
        completedAt: 2000,
        usage: { total_tokens: 100, output_tokens: 40 },
        stats: { completedAt: 2000, generationMs: 800, cost: { amount: 0.001 } },
        meta: { runId: 'run-parent-first', responseId: 'measured-input' },
        toolCalls: [{ toolId: 'agent.delegate', status: 'applied', applyResult: { agentId: measuredChild.id, questId: 'measured-quest' } }],
      },
      {
        id: 'measured-parent-final',
        role: 'assistant',
        status: 'done',
        content: 'all done',
        createdAt: 3100,
        completedAt: 4000,
        usage: { total_tokens: 70, output_tokens: 30 },
        stats: { completedAt: 4000, generationMs: 600, cost: { amount: 0.003 } },
        meta: { runId: 'run-parent-final', responseId: 'measured-input' },
      },
    ],
  })
  ai.updateQuest(measuredChild.id, 'measured-quest', {
    fromAgentId: measuredParent.id,
    meta: { sourceResponseId: 'measured-input' },
  })
  const measuredSummary = ai.response.read(measuredParent.id, 'measured-input')
  assert.equal(measuredSummary.status, 'completed')
  assert.equal(measuredSummary.lastAssistantMessageId, 'measured-parent-final')
  assert.deepEqual(measuredSummary.relatedAgentIds, [measuredParent.id, measuredChild.id])
  assert.equal(measuredSummary.metrics.durationMs, 3000)
  assert.equal(measuredSummary.metrics.generationMs, 2400)
  assert.equal(measuredSummary.metrics.totalTokens, 220)
  assert.equal(measuredSummary.metrics.outputTokens, 90)
  assert.equal(measuredSummary.metrics.tokensPerSecond, 37.5)
  assert.equal(measuredSummary.metrics.toolCallCount, 2)
  assert.equal(measuredSummary.metrics.providerTurnCount, 3)
  assert.equal(measuredSummary.metrics.cost.amount, 0.006)
  ai.activeAgentId.set(measuredParent.id)
  const measuredRoot = components['ai-messages'].factory(null, {})
  const measuredFooters = elementsWithClass(measuredRoot, 'aiditor-ai-message-footer')
  const measuredAssistantFooters = elementsWithClass(measuredRoot, 'aiditor-ai-message-row-assistant').filter(function (row) {
    return !!row.querySelector('.aiditor-ai-message-footer')
  })
  assert.equal(measuredAssistantFooters.length, 1)
  const measuredText = collectText(measuredFooters[measuredFooters.length - 1])
  assert.match(measuredText, /2 tool calls/)
  assert.match(measuredText, /3 s/)
  assert.match(measuredText, /220 tok/)
  assert.match(measuredText, /37\.5 tok\/s/)
  assert.match(measuredText, /\$0\.006/)

  ai.tools.register('test.remember-approval', {
    title: 'Remember approval',
    schema: { type: 'object', properties: {} },
    permissions: ['tool.call', 'tool.apply'],
    preview: function () { return { ok: true } },
    apply: function () { return { applied: true } },
  }, { owner: 'test:transcript-actions' })
  const automaticAgent = ai.createAgent({ name: 'Automatic Approval', permissionMode: 'full' })
  ai.createToolCall(automaticAgent.id, { toolId: 'test.remember-approval', args: {} }, automaticAgent.id)
  ai.activeAgentId.set(automaticAgent.id)
  const automaticRoot = components['ai-messages'].factory(null, {})
  assert.equal(automaticRoot.querySelector('.aiditor-ui-switch'), null)
  assert.equal(elementsWithClass(automaticRoot, 'aiditor-ui-btn').some(function (button) {
    return collectText(button).trim() === 'Apply' || collectText(button).trim() === 'Reject'
  }), false)

  const rememberAgent = ai.createAgent({ name: 'Remember Approval', permissionMode: 'auto' })
  const rememberCall = ai.createToolCall(rememberAgent.id, { toolId: 'test.remember-approval', args: {} }, rememberAgent.id)
  ai.requestToolCallApproval(rememberAgent.id, rememberCall.id, 'apply')
  ai.activeAgentId.set(rememberAgent.id)
  const rememberRoot = components['ai-messages'].factory(null, {})
  const rememberSwitch = rememberRoot.querySelector('.aiditor-ui-switch')
  assert.equal(collectText(rememberSwitch).trim(), 'Remember')
  rememberSwitch.__change(true)
  assert.equal(ai.isToolCallGranted(rememberAgent.id, rememberCall.id), false)
  const rememberButtons = elementsWithClass(rememberRoot, 'aiditor-ui-btn')
  const applyButton = rememberButtons.find(function (button) { return collectText(button).trim() === 'Apply' })
  clickElement(applyButton)
  assert.equal(ai.findToolCall(rememberAgent.id, rememberCall.id).toolCall.status, 'applied')
  assert.equal(ai.isToolCallGranted(rememberAgent.id, rememberCall.id), true)

  ai.tools.register('test.reject-remember', {
    title: 'Reject remembered approval',
    schema: { type: 'object', properties: {} },
    permissions: ['tool.call', 'tool.apply'],
    preview: function () { return { ok: true } },
    apply: function () { return { applied: true } },
  }, { owner: 'test:transcript-actions' })
  const rejectAgent = ai.createAgent({ name: 'Reject Remember', permissionMode: 'auto' })
  const rejectCall = ai.createToolCall(rejectAgent.id, { toolId: 'test.reject-remember', args: {} }, rejectAgent.id)
  ai.requestToolCallApproval(rejectAgent.id, rejectCall.id, 'apply')
  ai.activeAgentId.set(rejectAgent.id)
  const rejectRoot = components['ai-messages'].factory(null, {})
  const rejectSwitch = rejectRoot.querySelector('.aiditor-ui-switch')
  rejectSwitch.__change(true)
  const rejectButton = elementsWithClass(rejectRoot, 'aiditor-ui-btn').find(function (button) { return collectText(button).trim() === 'Reject' })
  clickElement(rejectButton)
  assert.equal(ai.findToolCall(rejectAgent.id, rejectCall.id).toolCall.status, 'rejected')
  assert.equal(ai.isToolCallGranted(rejectAgent.id, rejectCall.id), false)

  const batchAgent = ai.createAgent({ name: 'Batch Approval', permissionMode: 'auto' })
  const batchMessage = ai.appendMessage(batchAgent.id, { role: 'assistant', content: '', toolCalls: [] })
  const batchCalls = ai.attachToolCalls(batchAgent.id, batchMessage.id, [
    { toolId: 'test.remember-approval', args: {} },
    { toolId: 'test.reject-remember', args: {} },
  ], batchAgent.id)
  for (const call of batchCalls) ai.requestToolCallApproval(batchAgent.id, call.id, 'apply')
  ai.activeAgentId.set(batchAgent.id)
  const batchRoot = components['ai-messages'].factory(null, {})
  assert.match(collectText(batchRoot.querySelector('.aiditor-ai-tool-batch-count')), /2 pending actions/)
  const applyAll = elementsWithClass(batchRoot, 'aiditor-ui-btn').find(function (button) { return collectText(button).trim() === 'Apply all' })
  clickElement(applyAll)
  await new Promise(function (resolve) { setTimeout(resolve, 0) })
  assert.deepEqual(batchCalls.map(function (call) { return ai.findToolCall(batchAgent.id, call.id).toolCall.status }), ['applied', 'applied'])

  const emptyAgent = ai.createAgent({ name: 'Empty Transcript', messages: [] })
  ai.activeAgentId.set(emptyAgent.id)
  const emptyRoot = components['ai-messages'].factory(null, {})
  assert.match(collectText(emptyRoot), /No messages yet/)
  await new Promise(function (resolve) { setTimeout(resolve, 140) })
  assert.match(collectText(emptyRoot), /No messages yet/)
}

await assertGdePatchPreviewRendering()

console.log('ai tests ok')

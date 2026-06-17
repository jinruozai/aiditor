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
vm.runInThisContext(readFileSync('src/ai/registries.js', 'utf8'), { filename: 'ai/registries.js' })
vm.runInThisContext(readFileSync('src/ai/context.js', 'utf8'), { filename: 'ai/context.js' })
vm.runInThisContext(readFileSync('src/ai/reference.js', 'utf8'), { filename: 'ai/reference.js' })
vm.runInThisContext(readFileSync('src/ai/change-set.js', 'utf8'), { filename: 'ai/change-set.js' })
vm.runInThisContext(readFileSync('src/ai/request.js', 'utf8'), { filename: 'ai/request.js' })
vm.runInThisContext(readFileSync('src/ai/runtime.js', 'utf8'), { filename: 'ai/runtime.js' })

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
  })

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

  if (typeof ai.setPermissionResolver === 'function') {
    const calls = []
    ai.setPermissionResolver(function (ctx, next) {
      calls.push(ctx)
      if (ctx.actor === 'blocked') return false
      return next(ctx)
    })
    assert.equal(ai.canRead('blocked', agentId, 'agent.full'), false)
    assert.equal(calls.length > 0, true)
  }

  ai.deleteAgent(sibling.id)
  return managed
}

async function assertChangeSetPermission(parentId, childId) {
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
  })
  ai.skills.register('review', { id: 'review', title: 'Review', tools: ['diff-preview'] })
  ai.agentTemplates.register('goal-reviewer', {
    id: 'goal-reviewer',
    defaults: { connection: 'mock', model: 'fast' },
    skills: ['review'],
  })
  ai.context.register('selection', {
    capture: function () { return { text: 'selected' } },
  })
  ai.bundles.register('registry-test', {
    activate: function (ctx) {
      ctx.ai.skills.register('plugin-skill', { id: 'plugin-skill', title: 'Plugin Skill' })
    },
  })

  assert.equal(ai.tools.list().includes('diff-preview'), true)
  assert.equal(ai.tools.get('diff-preview').preview({ id: 1 }).kind, 'diff')
  assert.equal(ai.tools.get('diff-preview').apply({ ok: true }).applied, true)
  assert.equal(ai.skills.get('review').title, 'Review')
  assert.equal(ai.skills.get('plugin-skill').title, 'Plugin Skill')
  assert.equal(ai.agentTemplates.get('goal-reviewer').defaults.model, 'fast')
  assert.equal(ai.context.get('selection').capture().text, 'selected')
  assert.equal(ai.bundles.get('registry-test') != null, true)

  ai.updateAgent(agentId, {
    skillRefs: ['review'],
    toolRefs: ['diff-preview'],
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
  assert.deepEqual(requestSeen.tools, ['diff-preview'])
  assert.deepEqual(requestSeen.skills, ['review'])
  assert.equal(ctxSeen.canRead(agentId), true)
  assert.equal(ctxSeen.canSend(agentId), true)
  assert.equal(ctxSeen.canManage(agentId), true)
  resourceCheck.assertResolved()
}

async function assertStopAgent(agentId) {
  let releaseRun
  const held = new Promise(function (resolve) { releaseRun = resolve })
  ai.registerTransport('hold', {
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
    addEventListener: function () {},
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
    button: function (opts) { return this.h('button', 'aiditor-ui-btn', { text: opts.text || '' }) },
    stateButton: function () { return this.h('button', 'aiditor-ui-state-btn') },
    'switch': function (opts) { return this.h('label', 'aiditor-ui-switch', { text: opts.label || '' }) },
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
  vm.runInThisContext(readFileSync('src/ai/panels/message-live-strip.js', 'utf8'), { filename: 'ai/panels/message-live-strip.js' })
  vm.runInThisContext(readFileSync('src/ai/panels/message-virtualizer.js', 'utf8'), { filename: 'ai/panels/message-virtualizer.js' })
  vm.runInThisContext(readFileSync('src/ai/panels/transcript.js', 'utf8'), { filename: 'ai/panels/transcript.js' })

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
    messages: [{ id: 'stream-1', role: 'assistant', status: 'running', content: 'hello' }],
  })
  ai.activeAgentId.set(streamAgent.id)
  const streamingRoot = components['ai-messages'].factory(null, {})
  const row = streamingRoot.querySelector('.aiditor-ai-message-row')
  const payload = streamingRoot.querySelector('[data-message-payload]')
  const firstTextPart = streamingRoot.querySelector('.aiditor-ai-message-text')
  assert.ok(row)
  assert.ok(payload)
  assert.ok(firstTextPart)

  ai.updateMessage(streamAgent.id, 'stream-1', { content: 'hello\n\nworld', status: 'running' })
  await new Promise(function (resolve) { setTimeout(resolve, 140) })

  assert.equal(streamingRoot.querySelector('.aiditor-ai-message-row'), row)
  assert.equal(streamingRoot.querySelector('[data-message-payload]'), payload)
  assert.equal(streamingRoot.querySelector('.aiditor-ai-message-text'), firstTextPart)
  assert.match(collectText(streamingRoot), /world/)

  const emptyAgent = ai.createAgent({ name: 'Empty Transcript', messages: [] })
  ai.activeAgentId.set(emptyAgent.id)
  const emptyRoot = components['ai-messages'].factory(null, {})
  assert.match(collectText(emptyRoot), /No messages yet/)
  await new Promise(function (resolve) { setTimeout(resolve, 140) })
  assert.match(collectText(emptyRoot), /No messages yet/)
}

await assertGdePatchPreviewRendering()

console.log('ai tests ok')

// aiditor.ai permission policy, scoped grants, and audit.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const permissionAuditSig = aiditor.signal([])
  const MAX_PERMISSION_AUDIT = 500
  const ACTION_SCOPES = {
    'tool.call': true,
    'tool.apply': true,
    'operation.preview': true,
    'operation.apply': true,
    'reference.read': true,
    'changeset.apply': true,
    'extension.install': true,
    'extension.update': true,
    'extension.enable': true,
    'extension.disable': true,
    'extension.uninstall': true,
    'extension.promote': true,
    'adapter.call': true,
  }
  let permissionResolver = null
  let nextPermissionAuditId = 1
  let nextPermissionGrantId = 1
  let access = {
    findAgent: function () { return null },
    findQuest: function () { return null },
    isDescendant: function () { return false },
  }

  function now() { return Date.now() }

  function normalizePath(path) {
    let out = String(path || '').replace(/\\/g, '/')
    out = out.replace(/\/+/g, '/')
    return out.replace(/^\/+|\/+$/g, '')
  }

  function configureAccessors(spec) {
    spec = spec || {}
    access = {
      findAgent: spec.findAgent || access.findAgent,
      findQuest: spec.findQuest || access.findQuest,
      isDescendant: spec.isDescendant || access.isDescendant,
    }
    return access
  }

  function canMode(ruleMode, wantedMode) {
    if (ruleMode === 'readwrite') return true
    return ruleMode === wantedMode
  }

  function pathInside(path, root) {
    const child = normalizePath(path).toLowerCase().split('/').filter(Boolean)
    const parent = normalizePath(root).toLowerCase().split('/').filter(Boolean)
    if (!parent.length) return true
    if (child.length < parent.length) return false
    for (let i = 0; i < parent.length; i++) if (child[i] !== parent[i]) return false
    return true
  }

  function canAccessPath(agent, path, mode) {
    const rules = (agent && agent.permissions && agent.permissions.paths) || []
    if (!rules.length) return true
    const wantedMode = mode || 'read'
    for (let i = 0; i < rules.length; i++) {
      if (pathInside(path, rules[i].path) && canMode(rules[i].mode, wantedMode)) return true
    }
    return false
  }

  function normalizeDecision(value, ctx) {
    if (value === true) return { decision: 'allow', allowed: true, reason: 'allowed', ctx: ctx }
    if (value === false || value == null) return { decision: 'deny', allowed: false, reason: 'denied', ctx: ctx }
    if (typeof value === 'string') {
      const decision = value === 'allow' || value === 'ask' || value === 'unavailable' ? value : 'deny'
      return { decision: decision, allowed: decision === 'allow', reason: decision, ctx: ctx }
    }
    const decision = value.decision || value.status || (value.allowed ? 'allow' : 'deny')
    return {
      decision: decision,
      allowed: decision === 'allow',
      reason: value.reason || decision,
      details: value.details || null,
      ctx: value.ctx || ctx,
    }
  }

  function permissionEntry(ctx) {
    return ctx.entry || ctx.toolId || ctx.operation || ctx.op || ctx.changeSetId || ctx.extensionId || ctx.adapter || ctx.scope || ''
  }

  function grantFields(ctx) {
    return {
      entry: permissionEntry(ctx),
      phase: String(ctx.phase || ''),
      target: ctx.target == null ? '' : String(ctx.target),
      workspace: ctx.workspace == null ? '' : String(ctx.workspace),
      origin: ctx.origin == null ? '' : String(ctx.origin),
      risk: String(ctx.risk || 'read'),
      contract: ctx.contract == null ? '' : String(ctx.contract),
    }
  }

  function grantKey(value) {
    const fields = grantFields(value || {})
    return [fields.entry, fields.phase, fields.target, fields.workspace, fields.origin, fields.risk, fields.contract].join('\n')
  }

  function grants(agentId) {
    const agent = access.findAgent(agentId)
    const list = agent && agent.meta && agent.meta.permissionGrants || []
    const time = now()
    return list.filter(function (grant) { return !grant.expiresAt || grant.expiresAt > time })
  }

  function matchingGrant(ctx) {
    const list = grants(ctx.targetAgentId)
    const key = grantKey(ctx)
    for (let i = 0; i < list.length; i++) if (grantKey(list[i]) === key) return list[i]
    return null
  }

  function structuralPermission(ctx) {
    if (ctx.actor === 'user') return 'allow'
    const actorAgent = access.findAgent(ctx.actor)
    const target = access.findAgent(ctx.targetAgentId)
    if (!actorAgent || !target) return 'deny'
    if (actorAgent.id === target.id) return 'allow'
    if (ctx.scope === 'messages.send' || ctx.scope === 'agent.manage' || ctx.scope === 'agent.summary') {
      return access.isDescendant(actorAgent.id, target.id) ? 'allow' : 'deny'
    }
    if (ctx.scope === 'quest.read' || ctx.scope === 'quest.cancel') {
      const quest = access.findQuest(ctx.targetAgentId, ctx.questId)
      return quest && quest.fromAgentId === actorAgent.id ? 'allow' : 'deny'
    }
    return access.isDescendant(actorAgent.id, target.id) ? 'allow' : 'deny'
  }

  function actionPermission(ctx) {
    const structural = structuralPermission(ctx)
    if (structural !== 'allow' || ctx.actor === 'user') return structural
    if (matchingGrant(ctx)) return 'allow'
    const agent = access.findAgent(ctx.targetAgentId)
    const mode = agent && agent.permissionMode || 'auto'
    const risk = ctx.risk || 'read'
    const mutates = risk !== 'read'
    if (ctx.path != null && !canAccessPath(agent, ctx.path, mutates ? 'write' : 'read')) return 'deny'
    if (!mutates) return 'allow'
    if (mode === 'default') return 'deny'
    if (mode === 'auto') return 'ask'
    if (mode === 'full') return risk === 'execute' || risk === 'network' || risk === 'install' ? 'ask' : 'allow'
    return 'unavailable'
  }

  function defaultPermission(ctx) {
    if (ctx.unavailable) return 'unavailable'
    return ACTION_SCOPES[ctx.scope] ? actionPermission(ctx) : structuralPermission(ctx)
  }

  function auditPermission(ctx, decision) {
    const item = {
      id: 'perm_' + now().toString(36) + '_' + nextPermissionAuditId++,
      time: now(),
      traceId: ctx.traceId || null,
      runId: ctx.runId || null,
      agentId: ctx.targetAgentId || (ctx.agent && ctx.agent.id) || null,
      actor: ctx.actor || 'user',
      scope: ctx.scope || '',
      entry: permissionEntry(ctx),
      phase: ctx.phase || '',
      target: ctx.target == null ? null : ctx.target,
      workspace: ctx.workspace || null,
      origin: ctx.origin || null,
      risk: ctx.risk || null,
      decision: decision.decision,
      allowed: decision.allowed === true,
      reason: decision.reason || '',
      baseVersion: ctx.baseVersion || null,
      resultVersion: ctx.resultVersion || null,
    }
    permissionAuditSig.update(function (items) {
      const next = items.concat([item])
      return next.length > MAX_PERMISSION_AUDIT ? next.slice(next.length - MAX_PERMISSION_AUDIT) : next
    })
    return item
  }

  function decide(actor, targetAgentId, scope, details) {
    const ctx = Object.assign({
      actor: actor || 'user',
      targetAgentId: targetAgentId,
      scope: scope || 'agent.full',
      actorAgent: actor === 'user' ? null : access.findAgent(actor),
      agent: access.findAgent(targetAgentId),
    }, details || {})
    const next = function (nextCtx) { return defaultPermission(nextCtx || ctx) }
    const raw = permissionResolver ? permissionResolver(ctx, next) : next(ctx)
    const decision = normalizeDecision(raw, ctx)
    auditPermission(ctx, decision)
    return decision
  }

  function decideMany(actor, targetAgentId, scope, detailsList) {
    const checks = (detailsList && detailsList.length ? detailsList : [{}]).map(function (details) {
      return decide(actor, targetAgentId, scope, details)
    })
    let selected = checks[0]
    const priority = { allow: 0, ask: 1, unavailable: 2, deny: 3 }
    for (let i = 1; i < checks.length; i++) {
      if (priority[checks[i].decision] > priority[selected.decision]) selected = checks[i]
    }
    return Object.assign({}, selected, { checks: checks })
  }

  function grant(agentId, descriptors, options) {
    const agent = access.findAgent(agentId)
    const list = grants(agentId).slice()
    const values = Array.isArray(descriptors) ? descriptors : [descriptors]
    const opts = options || {}
    const added = []
    for (let i = 0; i < values.length; i++) {
      const fields = grantFields(values[i] || {})
      const key = grantKey(fields)
      if (list.some(function (item) { return grantKey(item) === key })) continue
      const item = Object.assign({
        id: 'pgrant_' + now().toString(36) + '_' + nextPermissionGrantId++,
        createdAt: now(),
        expiresAt: opts.expiresAt || null,
      }, fields)
      list.push(item)
      added.push(item)
    }
    const meta = Object.assign({}, agent.meta || {}, { permissionGrants: list })
    ai.updateAgent(agentId, { meta: meta })
    return added
  }

  function revoke(agentId, grantId) {
    const agent = access.findAgent(agentId)
    const list = grants(agentId)
    const next = list.filter(function (item) { return item.id !== grantId })
    if (next.length === list.length) return false
    const meta = Object.assign({}, agent.meta || {}, { permissionGrants: next })
    ai.updateAgent(agentId, { meta: meta })
    return true
  }

  function setResolver(fn) {
    permissionResolver = fn
    return fn
  }

  ai.permissionAudit = permissionAuditSig
  ai.permissions = {
    decide: decide,
    decideMany: decideMany,
    allowed: function (actor, targetAgentId, scope, details) { return decide(actor, targetAgentId, scope, details).allowed === true },
    configureAccessors: configureAccessors,
    canAccessPath: canAccessPath,
    grant: grant,
    revoke: revoke,
    grants: grants,
    grantKey: grantKey,
    setResolver: setResolver,
    getResolver: function () { return permissionResolver },
  }
  ai.canReadPath = function (agent, path) { return canAccessPath(agent, path, 'read') }
  ai.canWritePath = function (agent, path) { return canAccessPath(agent, path, 'write') }
  ai.canRead = function (actorId, targetId, scope) { return ai.permissions.allowed(actorId, targetId, scope || 'agent.full') }
  ai.canSend = function (actorId, targetId) { return ai.permissions.allowed(actorId, targetId, 'messages.send') }
  ai.canManage = function (actorId, targetId) { return ai.permissions.allowed(actorId, targetId, 'agent.manage') }
  ai.canCancelQuest = function (actorId, targetId, questId) {
    return ai.permissions.allowed(actorId, targetId, 'quest.cancel', { questId: questId })
  }
  ai.permissionAuditRecords = function () { return permissionAuditSig() }
  ai.clearPermissionAudit = function () { permissionAuditSig.set([]) }
})(window.aiditor = window.aiditor || {})

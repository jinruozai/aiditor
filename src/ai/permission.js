// aiditor.ai permissions - resolver, audit, and access helpers.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const permissionAuditSig = aiditor.signal([])
  const MAX_PERMISSION_AUDIT = 500
  let permissionResolver = null
  let nextPermissionAuditId = 1
  let access = {
    findAgent: function () { return null },
    findQuest: function () { return null },
    isDescendant: function () { return false },
  }

  function now() { return Date.now() }

  function normalizePath(path) {
    let out = String(path || '').replace(/\\/g, '/')
    out = out.replace(/\/+/g, '/')
    out = out.replace(/^\/+|\/+$/g, '')
    return out
  }

  function configurePermissionAccessors(spec) {
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
    if (wantedMode === 'read') return ruleMode === 'read'
    if (wantedMode === 'write') return ruleMode === 'write'
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
    const wantedMode = mode || 'read'
    const rules = (agent && agent.permissions && agent.permissions.paths) || []
    for (let i = 0; i < rules.length; i++) {
      if (pathInside(path, rules[i].path) && canMode(rules[i].mode, wantedMode)) return true
    }
    return false
  }

  function defaultPermission(ctx) {
    if (ctx.actor === 'user') return true
    const actorAgent = access.findAgent(ctx.actor)
    const target = access.findAgent(ctx.targetAgentId)
    if (!actorAgent || !target) return false
    if (actorAgent.id === target.id) return true
    if (ctx.scope === 'messages.send') return access.isDescendant(actorAgent.id, target.id)
    if (ctx.scope === 'agent.manage') return access.isDescendant(actorAgent.id, target.id)
    if (ctx.scope === 'agent.summary') return access.isDescendant(actorAgent.id, target.id)
    if (ctx.scope === 'quest.read') {
      const quest = access.findQuest(ctx.targetAgentId, ctx.questId)
      return !!(quest && quest.fromAgentId === actorAgent.id)
    }
    if (ctx.scope === 'quest.cancel') {
      const quest = access.findQuest(ctx.targetAgentId, ctx.questId)
      return !!(quest && quest.fromAgentId === actorAgent.id)
    }
    return access.isDescendant(actorAgent.id, target.id)
  }

  function normalizeDecision(value, ctx) {
    if (value === true) return { decision: 'allow', allowed: true, reason: 'allowed' }
    if (value === false || value == null) return { decision: 'deny', allowed: false, reason: 'denied' }
    if (typeof value === 'string') {
      const decision = value === 'allow' || value === 'ask' || value === 'unavailable' ? value : 'deny'
      return { decision: decision, allowed: decision === 'allow', reason: decision }
    }
    const decision = value.decision || value.status || (value.allowed ? 'allow' : 'deny')
    return {
      decision: decision,
      allowed: value.allowed != null ? !!value.allowed : decision === 'allow',
      reason: value.reason || decision,
      details: value.details || null,
      ctx: value.ctx || ctx || null,
    }
  }

  function permissionEntry(ctx) {
    return ctx.toolId || ctx.operation || ctx.op || ctx.changeSetId || ctx.extensionId || ctx.adapter || ctx.scope || ''
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
      target: ctx.target || ctx.path || ctx.dock || ctx.setting || null,
      workspace: ctx.workspace || null,
      origin: ctx.origin || null,
      risk: ctx.risk || null,
      decision: decision.decision,
      allowed: !!decision.allowed,
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

  function decidePermission(actor, targetAgentId, scope, details) {
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

  function allowed(actor, targetAgentId, scope, details) {
    return decidePermission(actor, targetAgentId, scope, details).allowed === true
  }

  function setPermissionResolver(fn) {
    permissionResolver = fn
    return fn
  }

  function canUseOperation(actorId, targetId, op, phase, details) {
    const apply = phase === 'apply'
    return allowed(actorId, targetId, apply ? 'operation.apply' : 'operation.preview', Object.assign({
      operation: op,
      op: op,
      phase: phase || 'preview',
    }, details || {}))
  }

  function canUseChangeSet(actorId, targetId, changeSetId, phase, details) {
    return allowed(actorId, targetId, phase === 'apply' ? 'changeset.apply' : 'changeset.preview', Object.assign({
      changeSetId: changeSetId,
      phase: phase || 'apply',
    }, details || {}))
  }

  ai.permissionAudit = permissionAuditSig
  ai.configurePermissionAccessors = configurePermissionAccessors
  ai.canAccessPath = canAccessPath
  ai.canReadPath = function (agent, path) { return canAccessPath(agent, path, 'read') }
  ai.canWritePath = function (agent, path) { return canAccessPath(agent, path, 'write') }
  ai.canRead = function (actorId, targetId, scope) { return allowed(actorId, targetId, scope || 'agent.full') }
  ai.canSend = function (actorId, targetId) { return allowed(actorId, targetId, 'messages.send') }
  ai.canManage = function (actorId, targetId) { return allowed(actorId, targetId, 'agent.manage') }
  ai.canCancelQuest = function (actorId, targetId, questId) {
    return allowed(actorId, targetId, 'quest.cancel', { questId: questId })
  }
  ai.canUseTool = function (actorId, targetId, toolId, phase, details) {
    return allowed(actorId, targetId, phase === 'apply' ? 'tool.apply' : 'tool.call', Object.assign({
      toolId: toolId,
      entry: toolId,
      phase: phase || 'call',
    }, details || {}))
  }
  ai.canUseOperation = canUseOperation
  ai.canUseChangeSet = canUseChangeSet
  ai.decidePermission = decidePermission
  ai.permissionAuditRecords = function () { return permissionAuditSig() }
  ai.clearPermissionAudit = function () { permissionAuditSig.set([]) }
  ai.setPermissionResolver = setPermissionResolver
  ai.getPermissionResolver = function () { return permissionResolver }
})(window.aiditor = window.aiditor || {})

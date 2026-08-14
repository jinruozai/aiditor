;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const itemsSig = aiditor.signal([])
  const adapters = {}
  const renderers = {}

  function clone(value) {
    return value == null ? value : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(value) : JSON.parse(JSON.stringify(value)))
  }

  function now() {
    return Date.now()
  }

  function nextId() {
    return 'cs_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36)
  }

  function isChangeSet(value) {
    return !!(value && typeof value === 'object' && value.type === 'aiditor.changeSet')
  }

  function normalizeStatus(status) {
    if (status === 'applied' || status === 'rejected' || status === 'failed' || status === 'partiallyApplied') return status
    return 'pending'
  }

  function normalizeSeverity(severity) {
    if (severity === 'error' || severity === 'warning' || severity === 'info') return severity
    return 'info'
  }

  function normalizeScope(scope) {
    if (!scope) return { type: 'all' }
    if (typeof scope === 'string') return { type: 'resource', resourceId: scope }
    if (scope.type === 'resource') return { type: 'resource', resourceId: scope.resourceId }
    if (scope.type === 'change') return { type: 'change', resourceId: scope.resourceId, changeId: scope.changeId }
    return { type: 'all' }
  }

  function normalizeChange(change, index) {
    const out = Object.assign({}, change || {})
    out.id = out.id || 'change_' + String(index + 1)
    out.kind = out.kind || 'generic'
    out.operation = out.operation || inferOperation(out.before, out.after)
    out.status = normalizeStatus(out.status)
    out.severity = normalizeSeverity(out.severity)
    return out
  }

  function normalizeResource(resource, index) {
    const out = Object.assign({}, resource || {})
    out.id = out.id || out.uri || 'resource_' + String(index + 1)
    out.uri = out.uri || out.id
    out.kind = out.kind || 'resource'
    out.title = out.title || out.uri
    out.status = normalizeStatus(out.status)
    out.severity = normalizeSeverity(out.severity)
    out.changes = (out.changes || []).map(normalizeChange)
    return out
  }

  function inferOperation(before, after) {
    if (before === undefined && after !== undefined) return 'insert'
    if (before !== undefined && after === undefined) return 'delete'
    return 'update'
  }

  function deriveSummary(resources, validation) {
    const summary = {
      resourceCount: resources.length,
      changeCount: 0,
      insertions: 0,
      deletions: 0,
      updates: 0,
      warnings: validation && validation.warnings ? validation.warnings.length : 0,
      errors: validation && validation.errors ? validation.errors.length : 0,
    }
    resources.forEach(function (resource) {
      ;(resource.changes || []).forEach(function (change) {
        summary.changeCount++
        if (change.operation === 'insert') summary.insertions++
        else if (change.operation === 'delete') summary.deletions++
        else summary.updates++
      })
    })
    return summary
  }

  function normalize(spec) {
    const created = spec.createdAt || now()
    const validation = spec.validation || { ok: true, warnings: [], errors: [] }
    const resources = (spec.resources || []).map(normalizeResource)
    const out = {
      type: 'aiditor.changeSet',
      id: spec.id || nextId(),
      title: spec.title || 'Change Set',
      description: spec.description || '',
      source: Object.assign({}, spec.source || {}),
      status: normalizeStatus(spec.status),
      createdAt: created,
      updatedAt: spec.updatedAt || created,
      summary: Object.assign(deriveSummary(resources, validation), spec.summary || {}),
      resources: resources,
      apply: Object.assign({ mode: 'atomic', adapter: '', payload: null }, spec.apply || {}),
      validation: validation,
      meta: Object.assign({}, spec.meta || {}),
    }
    if (out.validation.ok === false && out.status === 'pending') out.status = 'failed'
    return out
  }

  function storeReplace(next) {
    itemsSig.set(next)
  }

  function create(spec) {
    const set = normalize(spec || {})
    storeReplace(itemsSig().filter(function (item) { return item.id !== set.id }).concat([set]))
    return set
  }

  function update(id, patch) {
    let nextSet = null
    const next = itemsSig().map(function (item) {
      if (item.id !== id) return item
      nextSet = normalize(Object.assign({}, item, patch || {}, { id: id, updatedAt: now() }))
      return nextSet
    })
    storeReplace(next)
    return nextSet
  }

  function find(id) {
    const list = itemsSig()
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
    return null
  }

  function list() {
    return itemsSig()
  }

  function resolveSet(idOrSet) {
    return typeof idOrSet === 'string' ? find(idOrSet) : normalize(idOrSet)
  }

  function registerAdapter(id, adapter) {
    adapters[id] = adapter
  }

  function getAdapter(id) {
    return adapters[id]
  }

  function registerRenderer(kind, renderer) {
    renderers[kind] = renderer
  }

  function getRenderer(kind) {
    return renderers[kind]
  }

  function rendererFor(change, resource, set) {
    const all = Object.keys(renderers)
    for (let i = 0; i < all.length; i++) {
      const renderer = renderers[all[i]]
      if (renderer.match && renderer.match(change, resource, set)) return renderer
    }
    return renderers[change && change.kind] || renderers[resource && resource.kind] || renderers.generic || null
  }

  function scopeAllowed(set, scope) {
    const mode = (set.apply && set.apply.mode) || 'atomic'
    if (mode === 'atomic') return scope.type === 'all'
    if (mode === 'perResource') return scope.type === 'all' || scope.type === 'resource'
    return scope.type === 'all' || scope.type === 'resource' || scope.type === 'change'
  }

  function withScopedStatus(set, scope, status) {
    if (scope.type === 'all') return Object.assign({}, set, {
      status: status,
      updatedAt: now(),
      resources: set.resources.map(function (resource) {
        return Object.assign({}, resource, {
          status: status,
          changes: (resource.changes || []).map(function (change) { return Object.assign({}, change, { status: status }) }),
        })
      }),
    })
    const resources = set.resources.map(function (resource) {
      if (resource.id !== scope.resourceId) return resource
      if (scope.type === 'resource') {
        return Object.assign({}, resource, {
          status: status,
          changes: (resource.changes || []).map(function (change) { return Object.assign({}, change, { status: status }) }),
        })
      }
      return Object.assign({}, resource, {
        changes: (resource.changes || []).map(function (change) {
          return change.id === scope.changeId ? Object.assign({}, change, { status: status }) : change
        }),
      })
    })
    return Object.assign({}, set, {
      status: aggregateStatus(resources),
      updatedAt: now(),
      resources: resources,
    })
  }

  function aggregateStatus(resources) {
    let total = 0
    let applied = 0
    let rejected = 0
    let failed = 0
    resources.forEach(function (resource) {
      ;(resource.changes || []).forEach(function (change) {
        total++
        if (change.status === 'applied') applied++
        else if (change.status === 'rejected') rejected++
        else if (change.status === 'failed') failed++
      })
    })
    if (failed) return 'failed'
    if (total && applied === total) return 'applied'
    if (total && rejected === total) return 'rejected'
    if (applied || rejected) return 'partiallyApplied'
    return 'pending'
  }

  function persistResult(set, result, status, scope) {
    const next = withScopedStatus(set, scope, status)
    next.meta = Object.assign({}, next.meta, { lastResult: clone(result) })
    update(next.id, next)
    return next
  }

  function failResult(set, result, scope) {
    const next = withScopedStatus(set, scope, 'failed')
    next.meta = Object.assign({}, next.meta, { lastResult: clone(result), error: failureMessage(result) })
    update(next.id, next)
    return next
  }

  function success(result) {
    return result && (result.applied === true || result.status === 'applied' || result.rejected === true || result.status === 'rejected')
  }

  function failureMessage(result) {
    if (!result) return 'ChangeSet operation failed'
    if (result.message) return result.message
    if (result.error) return String(result.error && result.error.message || result.error)
    const validation = result.validation || {}
    const errors = validation.errors || result.errors
    if (errors && errors.length) {
      return errors.map(function (item) { return (item.path ? item.path + ': ' : '') + (item.message || String(item)) }).join('\n')
    }
    return 'ChangeSet operation failed'
  }

  function permissionTarget(set, actor) {
    return (set.source && (set.source.agentId || set.source.agent)) ||
      (set.meta && (set.meta.agentId || set.meta.agent)) ||
      actor ||
      'user'
  }

  function canApplyChangeSet(set, target, actor) {
    return ai.permissions.decide(actor || 'user', permissionTarget(set, actor), 'changeset.apply', {
      entry: set.id,
      changeSetId: set.id,
      phase: 'apply',
      target: target,
      risk: 'write',
    }).allowed === true
  }

  function apply(idOrSet, scope, actor) {
    const set = resolveSet(idOrSet)
    const target = normalizeScope(scope)
    if (!scopeAllowed(set, target)) return Promise.resolve(failResult(set, { message: 'Scope is not supported by ' + set.apply.mode + ' ChangeSet' }, target))
    if (!canApplyChangeSet(set, target, actor)) return Promise.resolve(failResult(set, { message: 'ChangeSet apply not allowed' }, target))
    const adapter = getAdapter(set.apply.adapter)
    if (!adapter || !adapter.apply) return Promise.resolve(failResult(set, { message: 'Missing ChangeSet adapter: ' + set.apply.adapter }, target))
    const ctx = { actor: actor || 'user', scope: target }
    if (adapter.canApply && !adapter.canApply(set, target, ctx)) return Promise.resolve(failResult(set, { message: 'ChangeSet cannot be applied' }, target))
    return Promise.resolve(adapter.apply(set, target, ctx)).then(function (result) {
      return success(result) ? persistResult(set, result, 'applied', target) : failResult(set, result, target)
    }, function (err) {
      return failResult(set, { error: err }, target)
    })
  }

  function reject(idOrSet, scope, actor) {
    const set = resolveSet(idOrSet)
    const target = normalizeScope(scope)
    const adapter = getAdapter(set.apply.adapter)
    const ctx = { actor: actor || 'user', scope: target }
    const run = adapter && adapter.reject ? adapter.reject(set, target, ctx) : { rejected: true }
    return Promise.resolve(run).then(function (result) {
      return persistResult(set, Object.assign({ rejected: true }, result || {}), 'rejected', target)
    }, function (err) {
      return failResult(set, { error: err }, target)
    })
  }

  aiditor.changeSet = {
    items: itemsSig,
    create: create,
    update: update,
    find: find,
    list: list,
    normalize: normalize,
    isChangeSet: isChangeSet,
    apply: apply,
    reject: reject,
    registerAdapter: registerAdapter,
    getAdapter: getAdapter,
    registerRenderer: registerRenderer,
    getRenderer: getRenderer,
    rendererFor: rendererFor,
  }
})(window.aiditor = window.aiditor || {})

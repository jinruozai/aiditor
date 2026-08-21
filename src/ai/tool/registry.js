// AI Host executable Tool registry.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function shorthandSchema(value, path) {
    if (typeof value !== 'string') return ai.schema.normalize(value || {}, path)
    if (value === 'any') return {}
    if (value === 'array') return { type: 'array' }
    return { type: value }
  }

  function normalizeToolSchema(schema) {
    if (schema == null) return { type: 'object', properties: {} }
    if (typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid tool schema at schema')
    if (!Object.keys(schema).length) return { type: 'object', properties: {} }
    if (schema.type) return ai.schema.normalize(schema, 'schema')
    const properties = {}
    Object.keys(schema).forEach(function (key) {
      properties[key] = shorthandSchema(schema[key], 'schema.properties.' + key)
    })
    return { type: 'object', properties: properties }
  }

  const registry = ai._contributionRegistry.create('ai.tools', {
    cleanupKey: 'tools',
    normalize: function (name, tool) {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool))
        throw new Error('ai.tools.register: invalid Tool "' + name + '"')
      if (tool.resolveSchema != null && typeof tool.resolveSchema !== 'function')
        throw new Error('ai.tools.register: resolveSchema must be a function for "' + name + '"')
      if (tool.resolveModelSpecs != null && typeof tool.resolveModelSpecs !== 'function')
        throw new Error('ai.tools.register: resolveModelSpecs must be a function for "' + name + '"')
      if (tool.permissionTargets != null && typeof tool.permissionTargets !== 'function')
        throw new Error('ai.tools.register: permissionTargets must be a function for "' + name + '"')
      if (tool.permissionDeniedHint != null && typeof tool.permissionDeniedHint !== 'string')
        throw new Error('ai.tools.register: permissionDeniedHint must be a string for "' + name + '"')
      if (tool.isConcurrencySafe != null && typeof tool.isConcurrencySafe !== 'function')
        throw new Error('ai.tools.register: isConcurrencySafe must be a function for "' + name + '"')
      if (tool.timeoutMs != null && (!Number.isFinite(tool.timeoutMs) || tool.timeoutMs <= 0))
        throw new Error('ai.tools.register: timeoutMs must be a positive finite number for "' + name + '"')
      return Object.assign({}, tool, { schema: normalizeToolSchema(tool.schema) })
    },
  })

  function schema(name, ctx) {
    const tool = registry.get(name)
    if (!tool) return null
    return normalizeToolSchema(typeof tool.resolveSchema === 'function' ? tool.resolveSchema(ctx || {}) : tool.schema)
  }

  function capabilities(name) {
    const tool = registry.get(name) || {}
    const explicit = tool.capabilities || {}
    const permissions = tool.permissions || []
    const hasApply = !!tool.apply
    const mutates = explicit.mutates != null ? !!explicit.mutates : hasApply
    return {
      preview: !!tool.preview,
      run: !!tool.run,
      apply: hasApply,
      mutates: mutates,
      read: explicit.read != null ? !!explicit.read : !mutates,
      write: explicit.write != null ? !!explicit.write : mutates,
      delete: !!explicit.delete,
      execute: !!explicit.execute,
      network: !!explicit.network,
      install: !!explicit.install,
      idempotent: !!explicit.idempotent,
      requiresApproval: explicit.requiresApproval != null ? !!explicit.requiresApproval : hasApply,
      risk: explicit.risk || tool.risk || (explicit.delete ? 'delete' : (mutates ? 'write' : 'read')),
      permissions: permissions.slice ? permissions.slice() : [],
    }
  }

  function available(name, ctx) {
    const tool = registry.get(name)
    if (!tool) return false
    if (typeof tool.available !== 'function') return true
    const value = aiditor.safeCall
      ? aiditor.safeCall({ scope: 'ai.tool', tool: name, phase: 'available' }, function () { return tool.available(ctx || {}) })
      : tool.available(ctx || {})
    return value === true
  }

  function availableList(ctx) {
    const out = []
    const names = registry.list()
    for (let i = 0; i < names.length; i++) {
      if (available(names[i], ctx)) out.push(names[i])
    }
    return out
  }

  function executionMode(name, args) {
    const tool = registry.get(name)
    if (!tool || !tool.isConcurrencySafe) return 'exclusive'
    const value = aiditor.safeCall
      ? aiditor.safeCall({ scope: 'ai.tool', tool: name, phase: 'concurrency' }, function () { return tool.isConcurrencySafe(args) })
      : tool.isConcurrencySafe(args)
    return value === true ? 'parallel' : 'exclusive'
  }

  function permissionOrigin(name) {
    const meta = registry.meta(name) || {}
    if (meta.owner && meta.owner.indexOf('extension:') === 0) return meta.owner
    if (meta.owner && meta.owner.indexOf('host:') === 0) return meta.owner
    return meta.layer || 'builtin'
  }

  function permissionContract(name, ctx) {
    const value = schema(name, ctx)
    return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value)
  }

  function permissionTargets(name, args, ctx, phase) {
    const tool = registry.get(name)
    if (!tool) return [{
      entry: name,
      phase: phase || 'call',
      target: name,
      origin: 'unregistered',
      risk: 'read',
      contract: '',
      unavailable: true,
    }]
    const caps = capabilities(name)
    const workspace = ai.workspaceMeta ? ai.workspaceMeta() : null
    const base = {
      entry: name,
      phase: phase || 'call',
      target: name,
      workspace: workspace && workspace.id || null,
      origin: permissionOrigin(name),
      risk: phase === 'preview' || (phase === 'run' && tool.apply) ? 'read' : caps.risk,
      contract: permissionContract(name, ctx),
    }
    if (!tool.permissionTargets) return [base]
    const projected = aiditor.safeCall
      ? aiditor.safeCall({ scope: 'ai.tool', tool: name, phase: 'permissionTargets' }, function () { return tool.permissionTargets(args, ctx || {}, phase || 'call') }, 'warn')
      : tool.permissionTargets(args, ctx || {}, phase || 'call')
    if (projected == null) return [Object.assign({}, base, { unavailable: true, reason: 'Tool permission targets are unavailable.' })]
    const values = Array.isArray(projected) ? projected : [projected]
    return values.map(function (value) {
      if (typeof value === 'string') return Object.assign({}, base, { target: value })
      return Object.assign({}, base, value || {})
    })
  }

  ai.tools = Object.assign(registry, {
    available: available,
    availableList: availableList,
    capabilities: capabilities,
    schema: schema,
    executionMode: executionMode,
    permissionTargets: permissionTargets,
  })
  ai.toolMeta = registry.meta
  ai.normalizeToolSchema = normalizeToolSchema
})(window.aiditor = window.aiditor || {})

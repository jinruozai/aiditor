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

  function visible(name, ctx, selectedBySkill) {
    const tool = registry.get(name)
    if (!tool || (tool.exposeToModel === false && !selectedBySkill)) return false
    if (typeof tool.available !== 'function') return true
    const value = aiditor.safeCall
      ? aiditor.safeCall({ scope: 'ai.tool', tool: name, phase: 'available' }, function () { return tool.available(ctx || {}) })
      : tool.available(ctx || {})
    return value === true
  }

  function visibleList(names, ctx, selectedBySkill) {
    const out = []
    const seen = {}
    for (let i = 0; i < (names || []).length; i++) {
      const name = names[i]
      if (!seen[name] && visible(name, ctx, selectedBySkill)) {
        seen[name] = true
        out.push(name)
      }
    }
    return out
  }

  ai.tools = Object.assign(registry, {
    visible: visible,
    visibleList: visibleList,
    capabilities: capabilities,
    schema: schema,
  })
  ai.toolMeta = registry.meta
  ai.normalizeToolSchema = normalizeToolSchema
})(window.aiditor = window.aiditor || {})

// aiditor.ai registries - tools, skills, context providers, templates, bundles.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const tools = {}
  const toolMeta = {}
  const skills = {}
  const skillMeta = {}
  const contextProviders = {}
  const contextProviderMeta = {}
  const agentTemplates = {}
  const bundles = {}
  const bundleRecords = {}
  const matchesPrefix = aiditor.names.matchesPrefix

  function keys(obj) { return Object.keys(obj) }

  function shorthandSchema(value, path) {
    if (typeof value !== 'string') return normalizeSchemaNode(value || {}, path)
    if (value === 'any') return {}
    if (value === 'array') return { type: 'array' }
    return { type: value }
  }

  function normalizeSchemaNode(schema, path) {
    return ai.schema.normalize(schema, path)
  }

  function normalizeToolSchema(schema) {
    if (schema == null) return { type: 'object', properties: {} }
    if (typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid tool schema at schema')
    if (!Object.keys(schema).length) return { type: 'object', properties: {} }
    if (schema.type) return normalizeSchemaNode(schema, 'schema')
    const properties = {}
    Object.keys(schema).forEach(function (key) { properties[key] = shorthandSchema(schema[key], 'schema.properties.' + key) })
    return { type: 'object', properties: properties }
  }

  function normalizeMeta(meta) {
    if (aiditor.runtime && aiditor.runtime.registrationMeta) meta = aiditor.runtime.registrationMeta(meta)
    meta = meta || {}
    const out = {}
    if (meta.owner != null) out.owner = String(meta.owner)
    if (meta.layer != null) out.layer = String(meta.layer)
    return out
  }

  function canReplace(meta) {
    return !!(meta && meta.replace === true)
  }

  function assertFree(kind, records, name, meta) {
    if (records[name] && !canReplace(meta))
      throw new Error(kind + '.register: duplicate name "' + name + '"')
  }

  function registerTool(name, tool, meta) {
    assertFree('ai.tools', tools, name, meta)
    tool.schema = normalizeToolSchema(tool.schema)
    tools[name] = tool
    toolMeta[name] = normalizeMeta(meta)
    return tool
  }

  function getTool(name) {
    return tools[name]
  }

  function toolCapabilities(name) {
    const tool = getTool(name) || {}
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

  function isToolVisibleToModel(name, ctx, explicit) {
    const tool = getTool(name)
    if (!tool) return false
    if (ctx && ctx.uiAuthoringBlocked) return false
    if (tool.exposeToModel === false && !explicit) return false
    if (typeof tool.available === 'function' && tool.available(ctx || {}) === false) return false
    return true
  }

  function visibleToolNames(refs, ctx, explicit) {
    const list = Array.isArray(refs) ? refs : keys(tools)
    const out = []
    for (let i = 0; i < list.length; i++) {
      if (isToolVisibleToModel(list[i], ctx, !!explicit)) out.push(list[i])
    }
    return out
  }

  function unregisterTool(name, meta) {
    if (!tools[name]) return false
    const existing = toolMeta[name] || {}
    if (meta && meta.owner != null && existing.owner !== meta.owner)
      throw new Error('ai.tools.unregister: owner mismatch for "' + name + '"')
    delete tools[name]
    delete toolMeta[name]
    return true
  }

  function unregisterToolOwner(owner) {
    const removed = []
    keys(toolMeta).forEach(function (name) {
      if (toolMeta[name].owner === owner) {
        delete tools[name]
        delete toolMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function unregisterToolPrefix(prefix) {
    const removed = []
    keys(tools).forEach(function (name) {
      if (matchesPrefix(name, prefix)) {
        delete tools[name]
        delete toolMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function normalizeStringList(value, field) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new Error('Invalid skill ' + field + ': expected array')
    return value.map(function (item) { return String(item) })
  }

  function normalizeSkillResources(value) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new Error('Invalid skill resources: expected array')
    return value.map(function (item) {
      if (!item || typeof item !== 'object' || !item.path) throw new Error('Invalid skill resource: path is required')
      return {
        path: String(item.path),
        kind: String(item.kind || 'reference'),
        size: item.size == null ? null : Number(item.size),
        hash: item.hash == null ? null : String(item.hash),
        mime: item.mime == null ? null : String(item.mime),
      }
    })
  }

  function skillFingerprint(name, skill) {
    const text = JSON.stringify([
      name,
      skill.title,
      skill.description,
      skill.whenToUse,
      skill.whenNotToUse,
      skill.systemPrompt,
      skill.rules,
      skill.examples,
      skill.tools,
      skill.relatedApis,
      skill.resources,
    ])
    let hash = 2166136261
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619) >>> 0
    }
    return 'aiditor-fnv1a-' + hash.toString(16)
  }

  function normalizeSkill(name, skill) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error('Invalid skill "' + name + '"')
    if (skill.auto != null && typeof skill.auto !== 'function') throw new Error('Invalid skill auto predicate: ' + name)
    if (skill.readResource != null && typeof skill.readResource !== 'function') throw new Error('Invalid skill resource reader: ' + name)
    const normalized = Object.assign({}, skill, {
      id: name,
      title: String(skill.title || name),
      description: String(skill.description || ''),
      whenToUse: String(skill.whenToUse || ''),
      whenNotToUse: String(skill.whenNotToUse || ''),
      systemPrompt: String(skill.systemPrompt || ''),
      rules: normalizeStringList(skill.rules, 'rules'),
      examples: Array.isArray(skill.examples) ? skill.examples.slice() : [],
      tools: normalizeStringList(skill.tools, 'tools'),
      relatedApis: normalizeStringList(skill.relatedApis, 'relatedApis'),
      resources: normalizeSkillResources(skill.resources),
      docPath: String(skill.docPath || ''),
    })
    return normalized
  }

  function normalizeSkillMeta(name, skill, meta) {
    if (aiditor.runtime && aiditor.runtime.registrationMeta) meta = aiditor.runtime.registrationMeta(meta)
    meta = meta || {}
    const normalized = normalizeMeta(meta)
    normalized.source = String(meta.source || normalized.layer || 'runtime')
    normalized.hash = String(meta.hash || skill.hash || skillFingerprint(name, skill))
    return normalized
  }

  function registerSkill(name, skill, meta) {
    assertFree('ai.skills', skills, name, meta)
    const normalized = normalizeSkill(name, skill)
    skills[name] = normalized
    skillMeta[name] = normalizeSkillMeta(name, normalized, meta)
    return normalized
  }

  function getSkill(name) {
    return skills[name]
  }

  function unregisterSkill(name, meta) {
    if (!skills[name]) return false
    const existing = skillMeta[name] || {}
    if (meta && meta.owner != null && existing.owner !== meta.owner)
      throw new Error('ai.skills.unregister: owner mismatch for "' + name + '"')
    delete skills[name]
    delete skillMeta[name]
    return true
  }

  function unregisterSkillOwner(owner) {
    const removed = []
    keys(skillMeta).forEach(function (name) {
      if (skillMeta[name].owner === owner) {
        delete skills[name]
        delete skillMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function unregisterSkillPrefix(prefix) {
    const removed = []
    keys(skills).forEach(function (name) {
      if (matchesPrefix(name, prefix)) {
        delete skills[name]
        delete skillMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function registerContextProvider(name, provider, meta) {
    assertFree('ai.context', contextProviders, name, meta)
    contextProviders[name] = provider
    contextProviderMeta[name] = normalizeMeta(meta)
    return provider
  }

  function unregisterContextProvider(name, meta) {
    if (!contextProviders[name]) return false
    const existing = contextProviderMeta[name] || {}
    if (meta && meta.owner != null && existing.owner !== meta.owner)
      throw new Error('ai.context.unregister: owner mismatch for "' + name + '"')
    delete contextProviders[name]
    delete contextProviderMeta[name]
    return true
  }

  function unregisterContextProviderOwner(owner) {
    const removed = []
    keys(contextProviderMeta).forEach(function (name) {
      if (contextProviderMeta[name].owner === owner) {
        delete contextProviders[name]
        delete contextProviderMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function unregisterContextProviderPrefix(prefix) {
    const removed = []
    keys(contextProviders).forEach(function (name) {
      if (matchesPrefix(name, prefix)) {
        delete contextProviders[name]
        delete contextProviderMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function getContextProvider(name) {
    return contextProviders[name]
  }

  function registerAgentTemplate(name, template, meta) {
    assertFree('ai.agentTemplates', agentTemplates, name, meta)
    agentTemplates[name] = template
    return template
  }

  function getAgentTemplate(name) {
    return agentTemplates[name]
  }

  function unregisterAgentTemplate(name) {
    if (!agentTemplates[name]) return false
    delete agentTemplates[name]
    return true
  }

  function unregisterAgentTemplatePrefix(prefix) {
    const removed = []
    keys(agentTemplates).forEach(function (name) {
      if (matchesPrefix(name, prefix)) {
        delete agentTemplates[name]
        removed.push(name)
      }
    })
    return removed
  }

  function registerBundle(name, bundle, meta) {
    if (bundles[name]) {
      if (!canReplace(meta)) throw new Error('ai.bundles.register: duplicate name "' + name + '"')
      unregisterBundle(name)
    }
    bundles[name] = bundle
    bundleRecords[name] = {
      connections: registerBundleList(bundle && bundle.connections, ai.registerConnection),
      skills: registerBundleList(bundle && bundle.skills, registerSkill),
      tools: registerBundleList(bundle && bundle.tools, registerTool),
      contextProviders: registerBundleList(bundle && bundle.contextProviders, registerContextProvider),
      agentTemplates: registerBundleList(bundle && bundle.agentTemplates, registerAgentTemplate),
    }
    if (bundle && typeof bundle.activate === 'function') {
      bundle.activate({ ai: ai })
    }
    return bundle
  }

  function getBundle(name) {
    return bundles[name]
  }

  function unregisterBundle(name) {
    if (!bundles[name]) return false
    unregisterBundleRecord(bundleRecords[name])
    delete bundles[name]
    delete bundleRecords[name]
    return true
  }

  function unregisterBundlePrefix(prefix) {
    const removed = []
    keys(bundles).forEach(function (name) {
      if (matchesPrefix(name, prefix)) {
        unregisterBundle(name)
        removed.push(name)
      }
    })
    return removed
  }

  function registerBundleList(items, register) {
    const names = []
    for (let i = 0; items && i < items.length; i++) {
      const name = items[i].id || items[i].name
      register(name, items[i])
      names.push(name)
    }
    return names
  }

  function unregisterBundleRecord(record) {
    record = record || {}
    unregisterNames(record.connections, ai.unregisterConnection)
    unregisterNames(record.skills, unregisterSkill)
    unregisterNames(record.tools, unregisterTool)
    unregisterNames(record.contextProviders, unregisterContextProvider)
    unregisterNames(record.agentTemplates, unregisterAgentTemplate)
  }

  function unregisterNames(names, unregister) {
    if (!unregister) return
    for (let i = 0; names && i < names.length; i++) unregister(names[i])
  }

  function collectContext(request, ctx) {
    const out = []
    const names = keys(contextProviders)
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const provider = contextProviders[name]
      const matched = !provider.match || provider.match(request.target || request.agent, request.event || null, ctx)
      if (matched) {
        const captured = aiditor.safeCall
          ? aiditor.safeCall({ scope: 'ai', provider: name }, function () {
            return provider.capture ? provider.capture(request.target || request.agent, request.event || null, ctx) : provider(request, ctx)
          })
          : (provider.capture ? provider.capture(request.target || request.agent, request.event || null, ctx) : provider(request, ctx))
        out.push({ id: name, value: captured })
      }
    }
    return out
  }

  ai.tools = {
    register: registerTool,
    unregister: unregisterTool,
    unregisterOwner: unregisterToolOwner,
    unregisterPrefix: unregisterToolPrefix,
    get: getTool,
    visible: isToolVisibleToModel,
    visibleList: visibleToolNames,
    list: function (prefix) {
      const names = keys(tools)
      return prefix ? names.filter(function (name) { return matchesPrefix(name, prefix) }) : names
    },
    meta: function (name) { return Object.assign({}, toolMeta[name] || {}) },
    capabilities: toolCapabilities,
  }
  ai.toolMeta = function (name) { return Object.assign({}, toolMeta[name] || {}) }
  ai.normalizeToolSchema = normalizeToolSchema
  ai.collectContext = collectContext
  ai.skills = {
    register: registerSkill,
    unregister: unregisterSkill,
    unregisterOwner: unregisterSkillOwner,
    unregisterPrefix: unregisterSkillPrefix,
    get: getSkill,
    list: function (filter) {
      const names = keys(skills)
      if (typeof filter === 'string') return names.filter(function (name) { return matchesPrefix(name, filter) })
      if (!filter) return names
      return names.filter(function (name) {
        const meta = skillMeta[name] || {}
        if (filter.owner != null && meta.owner !== filter.owner) return false
        if (filter.layer != null && meta.layer !== filter.layer) return false
        if (filter.source != null && meta.source !== filter.source) return false
        return true
      })
    },
    meta: function (name) { return Object.assign({}, skillMeta[name] || {}) },
  }
  ai.context = {
    register: registerContextProvider,
    unregister: unregisterContextProvider,
    unregisterOwner: unregisterContextProviderOwner,
    unregisterPrefix: unregisterContextProviderPrefix,
    get: getContextProvider,
    list: function (prefix) {
      const names = keys(contextProviders)
      return prefix ? names.filter(function (name) { return matchesPrefix(name, prefix) }) : names
    },
    meta: function (name) { return Object.assign({}, contextProviderMeta[name] || {}) },
  }
  ai.agentTemplates = {
    register: registerAgentTemplate,
    unregister: unregisterAgentTemplate,
    unregisterPrefix: unregisterAgentTemplatePrefix,
    get: getAgentTemplate,
    list: function (prefix) {
      const names = keys(agentTemplates)
      return prefix ? names.filter(function (name) { return matchesPrefix(name, prefix) }) : names
    },
  }
  ai.bundles = {
    register: registerBundle,
    unregister: unregisterBundle,
    unregisterPrefix: unregisterBundlePrefix,
    get: getBundle,
    list: function (prefix) {
      const names = keys(bundles)
      return prefix ? names.filter(function (name) { return matchesPrefix(name, prefix) }) : names
    },
  }
  if (aiditor.runtime && aiditor.runtime.registerOwnerCleanup) {
    aiditor.runtime.registerOwnerCleanup(function (owner) {
      return {
        tools: unregisterToolOwner(owner),
        skills: unregisterSkillOwner(owner),
        context: unregisterContextProviderOwner(owner),
      }
    })
  }
})(window.aiditor = window.aiditor || {})

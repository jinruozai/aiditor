// aiditor.ai registries - tools, skills, context providers, templates, bundles.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const tools = {}
  const toolMeta = {}
  const skills = {}
  const contextProviders = {}
  const contextProviderMeta = {}
  const agentTemplates = {}
  const bundles = {}
  const bundleRecords = {}
  const matchesPrefix = aiditor.names.matchesPrefix

  function keys(obj) { return Object.keys(obj) }

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

  function registerSkill(name, skill, meta) {
    assertFree('ai.skills', skills, name, meta)
    skills[name] = skill
    return skill
  }

  function getSkill(name) {
    return skills[name]
  }

  function unregisterSkill(name) {
    if (!skills[name]) return false
    delete skills[name]
    return true
  }

  function unregisterSkillPrefix(prefix) {
    const removed = []
    keys(skills).forEach(function (name) {
      if (matchesPrefix(name, prefix)) {
        delete skills[name]
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
  ai.collectContext = collectContext
  ai.skills = {
    register: registerSkill,
    unregister: unregisterSkill,
    unregisterPrefix: unregisterSkillPrefix,
    get: getSkill,
    list: function (prefix) {
      const names = keys(skills)
      return prefix ? names.filter(function (name) { return matchesPrefix(name, prefix) }) : names
    },
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
        context: unregisterContextProviderOwner(owner),
      }
    })
  }
})(window.aiditor = window.aiditor || {})

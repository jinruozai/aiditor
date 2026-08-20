// AI Host discoverable Skill registry.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const defaultRefsByOwner = {}

  function stringList(value, field) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new Error('Invalid skill ' + field + ': expected array')
    return value.map(function (item) { return String(item) })
  }

  function resources(value) {
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

  function fingerprint(name, skill) {
    const text = JSON.stringify([
      name, skill.title, skill.description, skill.argumentHint,
      skill.userInvocable, skill.modelInvocable, skill.whenToUse,
      skill.whenNotToUse, skill.systemPrompt, skill.rules, skill.examples,
      skill.tools, skill.relatedApis, skill.resources,
    ])
    let hash = 2166136261
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619) >>> 0
    }
    return 'aiditor-fnv1a-' + hash.toString(16)
  }

  function normalize(name, skill) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error('Invalid skill "' + name + '"')
    if (skill.auto != null) throw new Error('Invalid skill "' + name + '": auto activation is not supported')
    if (skill.available != null && typeof skill.available !== 'function') throw new Error('Invalid skill available predicate: ' + name)
    if (skill.unavailableReason != null && typeof skill.unavailableReason !== 'function' && typeof skill.unavailableReason !== 'string')
      throw new Error('Invalid skill unavailableReason: ' + name)
    if (skill.readResource != null && typeof skill.readResource !== 'function') throw new Error('Invalid skill resource reader: ' + name)
    return Object.assign({}, skill, {
      id: name,
      title: String(skill.title || name),
      description: String(skill.description || ''),
      argumentHint: String(skill.argumentHint || ''),
      userInvocable: skill.userInvocable !== false,
      modelInvocable: skill.modelInvocable !== false,
      whenToUse: String(skill.whenToUse || ''),
      whenNotToUse: String(skill.whenNotToUse || ''),
      systemPrompt: String(skill.systemPrompt || ''),
      rules: stringList(skill.rules, 'rules'),
      examples: Array.isArray(skill.examples) ? skill.examples.slice() : [],
      tools: stringList(skill.tools, 'tools'),
      relatedApis: stringList(skill.relatedApis, 'relatedApis'),
      resources: resources(skill.resources),
      docPath: String(skill.docPath || ''),
    })
  }

  const registry = ai._contributionRegistry.create('ai.skills', {
    cleanupKey: 'skills',
    normalize: normalize,
    meta: function (name, skill, meta, raw) {
      const out = Object.assign({}, meta)
      out.source = String(raw.source || meta.source || meta.layer || 'runtime')
      out.hash = String(raw.hash || skill.hash || fingerprint(name, skill))
      return out
    },
  })
  const unregisterRegistryOwner = registry.unregisterOwner

  function availability(name, ctx) {
    const skill = registry.get(name)
    if (!skill) return { available: false, reason: 'Skill is not registered.' }
    let available = true
    if (skill.available) {
      const value = aiditor.safeCall
        ? aiditor.safeCall({ scope: 'ai.skill', skill: name, phase: 'available' }, function () { return skill.available(ctx || {}) })
        : skill.available(ctx || {})
      available = value === true
    }
    if (available) return { available: true, reason: '' }
    let reason = skill.unavailableReason || 'Required runtime capability is unavailable.'
    if (typeof reason === 'function') {
      reason = aiditor.safeCall
        ? aiditor.safeCall({ scope: 'ai.skill', skill: name, phase: 'unavailableReason' }, function () { return reason(ctx || {}) })
        : reason(ctx || {})
    }
    return { available: false, reason: String(reason || 'Required runtime capability is unavailable.') }
  }

  function catalog(ctx, options) {
    options = options || {}
    const audience = options.audience === 'user' ? 'user' : 'model'
    const query = String(options.query || '').trim().toLowerCase()
    const limit = Math.max(1, Math.min(Number(options.limit) || 50, 100))
    const out = []
    const active = ctx && Array.isArray(ctx.skillRefs) ? ctx.skillRefs : []
    const ids = registry.list().slice().sort()
    for (let i = 0; i < ids.length; i++) {
      const skill = registry.get(ids[i])
      if (audience === 'user' ? !skill.userInvocable : !skill.modelInvocable) continue
      const text = [ids[i], skill.title, skill.description, skill.whenToUse, skill.whenNotToUse].join('\n').toLowerCase()
      if (query && text.indexOf(query) < 0) continue
      const state = availability(ids[i], ctx)
      const meta = registry.meta(ids[i])
      out.push({
        id: ids[i],
        title: skill.title,
        description: skill.description,
        whenToUse: skill.whenToUse,
        argumentHint: skill.argumentHint,
        tools: skill.tools.slice(),
        source: meta.source || '',
        owner: meta.owner || '',
        layer: meta.layer || '',
        available: state.available,
        unavailableReason: state.reason,
      })
    }
    out.sort(function (left, right) {
      const leftActive = active.indexOf(left.id) >= 0
      const rightActive = active.indexOf(right.id) >= 0
      if (leftActive !== rightActive) return leftActive ? -1 : 1
      const leftHost = left.layer === 'module' || left.layer === 'app' || left.layer === 'workspace'
      const rightHost = right.layer === 'module' || right.layer === 'app' || right.layer === 'workspace'
      if (leftHost !== rightHost) return leftHost ? -1 : 1
      if (left.available !== right.available) return left.available ? -1 : 1
      return left.id.localeCompare(right.id)
    })
    return out.slice(0, limit)
  }

  function configureDefaults(refs, meta) {
    const owner = String(meta && meta.owner || '')
    if (!owner) throw new Error('ai.skills.configureDefaults: owner is required')
    if (!Array.isArray(refs)) throw new Error('ai.skills.configureDefaults: refs must be an array')
    const out = []
    const seen = {}
    for (let i = 0; i < refs.length; i++) {
      const id = String(refs[i] || '')
      if (!id || seen[id]) continue
      const skill = registry.get(id)
      if (!skill || skill.modelInvocable === false) throw new Error('ai.skills.configureDefaults: Skill is not model-invocable: ' + id)
      seen[id] = true
      out.push(id)
    }
    defaultRefsByOwner[owner] = out
    return out.slice()
  }

  function clearDefaults(meta) {
    const owner = String(meta && meta.owner || '')
    if (!owner) throw new Error('ai.skills.clearDefaults: owner is required')
    const existed = Object.prototype.hasOwnProperty.call(defaultRefsByOwner, owner)
    delete defaultRefsByOwner[owner]
    return existed
  }

  function defaults() {
    const out = []
    const seen = {}
    const owners = Object.keys(defaultRefsByOwner).sort()
    for (let i = 0; i < owners.length; i++) {
      const refs = defaultRefsByOwner[owners[i]]
      for (let j = 0; j < refs.length; j++) {
        if (seen[refs[j]]) continue
        seen[refs[j]] = true
        out.push(refs[j])
      }
    }
    return out
  }

  function unregisterOwner(owner) {
    delete defaultRefsByOwner[String(owner || '')]
    return unregisterRegistryOwner(owner)
  }

  if (aiditor.runtime && aiditor.runtime.registerOwnerCleanup) {
    aiditor.runtime.registerOwnerCleanup(function (owner) {
      delete defaultRefsByOwner[String(owner || '')]
      return {}
    })
  }

  ai.skills = Object.assign(registry, {
    availability: availability,
    catalog: catalog,
    configureDefaults: configureDefaults,
    clearDefaults: clearDefaults,
    defaults: defaults,
    unregisterOwner: unregisterOwner,
  })
})(window.aiditor = window.aiditor || {})

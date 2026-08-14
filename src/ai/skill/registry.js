// AI Host discoverable Skill registry.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

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
    const ids = registry.list().slice().sort()
    for (let i = 0; i < ids.length && out.length < limit; i++) {
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
    return out
  }

  ai.skills = Object.assign(registry, {
    availability: availability,
    catalog: catalog,
  })
})(window.aiditor = window.aiditor || {})

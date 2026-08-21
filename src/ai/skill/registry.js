// AI Host Skill registry. Skills are readable instructions; they have no activation state.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const TOOL_DISCLOSURES = ['always', 'onRead']

  function skillError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
  }

  function stringList(value, field) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new Error('Invalid skill ' + field + ': expected array')
    const out = []
    for (let i = 0; i < value.length; i++) {
      const item = String(value[i])
      if (out.indexOf(item) >= 0) throw new Error('Invalid skill ' + field + ': duplicate "' + item + '"')
      out.push(item)
    }
    return out
  }

  function toolDisclosure(value) {
    const disclosure = String(value || 'onRead')
    if (TOOL_DISCLOSURES.indexOf(disclosure) < 0) throw new Error('Invalid skill toolDisclosure: ' + disclosure)
    return disclosure
  }

  function normalizeResources(value) {
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
      name,
      skill.title,
      skill.description,
      skill.argumentHint,
      skill.instructions,
      skill.toolDisclosure,
      skill.tools,
      skill.resources,
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
    if (skill.readResource != null && typeof skill.readResource !== 'function') throw new Error('Invalid skill resource reader: ' + name)
    return {
      id: name,
      title: String(skill.title || name),
      description: String(skill.description || ''),
      argumentHint: String(skill.argumentHint || ''),
      instructions: String(skill.instructions || ''),
      toolDisclosure: toolDisclosure(skill.toolDisclosure),
      tools: stringList(skill.tools, 'tools'),
      resources: normalizeResources(skill.resources),
      readResource: skill.readResource || null,
    }
  }

  const registry = ai._contributionRegistry.create('ai.skills', {
    cleanupKey: 'skills',
    normalize: normalize,
    meta: function (name, skill, meta, raw) {
      const out = Object.assign({}, meta)
      out.source = String(raw.source || meta.source || meta.layer || 'runtime')
      out.hash = String(raw.hash || fingerprint(name, skill))
      return out
    },
  })

  function entry(id) {
    const skill = registry.get(id)
    if (!skill) return null
    const meta = registry.meta(id) || {}
    return {
      id: id,
      title: skill.title,
      description: skill.description,
      argumentHint: skill.argumentHint,
      toolDisclosure: skill.toolDisclosure,
      tools: skill.tools.slice(),
      resources: skill.resources.slice(),
      owner: meta.owner || '',
      layer: meta.layer || '',
      source: meta.source || '',
      hash: meta.hash || '',
    }
  }

  function catalog() {
    return registry.list().slice().sort().map(entry)
  }

  function page(cursor, limit) {
    const match = cursor == null || cursor === '' ? null : /^skill:(\d+)$/.exec(String(cursor))
    if (cursor != null && cursor !== '' && !match) throw skillError('SKILL_CURSOR_INVALID', 'Invalid Skill cursor')
    const offset = match ? Number(match[1]) : 0
    const max = limit == null ? 20 : Number(limit)
    if (!Number.isInteger(max) || max < 1 || max > 20) throw skillError('SKILL_PAGE_LIMIT_INVALID', 'Invalid Skill page limit')
    const entries = catalog()
    const items = entries.slice(offset, offset + max)
    const next = offset + items.length
    return {
      items: items,
      total: entries.length,
      nextCursor: next < entries.length ? 'skill:' + next : null,
    }
  }

  function read(id, resource) {
    const skill = registry.get(id)
    if (!skill) throw skillError('SKILL_NOT_FOUND', 'Skill not found: ' + id)
    if (resource) {
      if (!skill.readResource) throw skillError('SKILL_RESOURCE_UNAVAILABLE', 'Skill has no readable resources: ' + id)
      return Promise.resolve(skill.readResource(String(resource)))
    }
    return {
      id: id,
      instructions: skill.instructions,
      resources: skill.resources.map(function (item) {
        return { path: item.path, kind: item.kind }
      }),
    }
  }

  ai.skills = Object.assign(registry, {
    catalog: catalog,
    page: page,
    read: read,
  })
})(window.aiditor = window.aiditor || {})

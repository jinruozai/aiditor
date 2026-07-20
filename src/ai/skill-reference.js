// aiditor.ai Skill reference provider.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  if (!ai.references || !ai.references.register || !ai.skills) return

  function skillNames() {
    return ai.skills.list ? ai.skills.list().sort() : []
  }

  function getSkill(id) {
    return ai.skills.get ? ai.skills.get(id) : null
  }

  function parseSkillUri(uri) {
    const text = String(uri || '')
    if (text === 'aiditor://skills') return { id: '', resource: '' }
    if (text.indexOf('aiditor://skills/') !== 0) return null
    const tail = text.slice('aiditor://skills/'.length)
    const marker = '/resources/'
    const index = tail.indexOf(marker)
    if (index < 0) return { id: decodeURIComponent(tail), resource: '' }
    return {
      id: decodeURIComponent(tail.slice(0, index)),
      resource: decodeURIComponent(tail.slice(index + marker.length)),
    }
  }

  function uriFor(id) {
    return 'aiditor://skills/' + encodeURIComponent(id)
  }

  function resourceUri(id, path) {
    return uriFor(id) + '/resources/' + encodeURIComponent(path)
  }

  function compactResources(id, skill) {
    const readable = typeof skill.readResource === 'function'
    return (skill.resources || []).map(function (resource) {
      const canRead = readable && resource.kind === 'reference'
      return Object.assign({}, resource, {
        uri: canRead ? resourceUri(id, resource.path) : null,
        readable: canRead,
      })
    })
  }

  function compactSkill(id, skill) {
    skill = skill || {}
    const meta = ai.skills.meta ? ai.skills.meta(id) : {}
    return {
      id: id,
      uri: uriFor(id),
      title: skill.title || id,
      description: skill.description || skill.systemPrompt || '',
      whenToUse: skill.whenToUse || '',
      whenNotToUse: skill.whenNotToUse || '',
      relatedApis: skill.relatedApis || [],
      tools: skill.tools || [],
      docPath: skill.docPath || '',
      resourceCount: (skill.resources || []).length,
      source: meta.source || '',
      layer: meta.layer || '',
      hash: meta.hash || '',
    }
  }

  function fullSkill(id, skill) {
    return Object.assign(compactSkill(id, skill), {
      kind: 'aiditor.skill',
      systemPrompt: skill.systemPrompt || '',
      rules: skill.rules || [],
      examples: skill.examples || [],
      resources: compactResources(id, skill),
    })
  }

  function indexRef() {
    return {
      resolver: 'skills',
      uri: 'aiditor://skills',
      kind: 'aiditor.skill.index',
      title: 'AIditor Skills',
      summary: 'Generated list of registered AIditor skills and when to use them.',
      meta: { count: skillNames().length },
      tools: ['aiditor.readReference'],
    }
  }

  function refFor(id, skill) {
    const compact = compactSkill(id, skill)
    return {
      resolver: 'skills',
      uri: compact.uri,
      kind: 'aiditor.skill',
      title: compact.title,
      summary: compact.whenToUse || compact.description || '',
      meta: compact,
      tools: ['aiditor.readReference'],
    }
  }

  function read(ref) {
    const parsed = parseSkillUri(ref && ref.uri)
    if (!parsed || !parsed.id) {
      return {
        uri: 'aiditor://skills',
        id: 'aiditor.skills.index',
        kind: 'aiditor.skill.index',
        title: 'AIditor Skills',
        summary: 'Registered AIditor skill list. Read a skill URI for full rules.',
        entries: skillNames().map(function (name) { return compactSkill(name, getSkill(name)) }),
      }
    }
    const skill = getSkill(parsed.id)
    if (!skill) return null
    if (!parsed.resource) return fullSkill(parsed.id, skill)
    const resource = (skill.resources || []).find(function (item) { return item.path === parsed.resource && item.kind === 'reference' })
    if (!resource || typeof skill.readResource !== 'function' || !ai.skills.readResource) return null
    return ai.skills.readResource(parsed.id, parsed.resource).then(function (value) {
      return Object.assign({
        uri: resourceUri(parsed.id, parsed.resource),
        id: parsed.id + ':' + parsed.resource,
        skillId: parsed.id,
        title: parsed.resource,
      }, value)
    })
  }

  function searchText(id, skill) {
    skill = skill || {}
    return [
      id,
      skill.title,
      skill.description,
      skill.systemPrompt,
      skill.whenToUse,
      skill.whenNotToUse,
      (skill.relatedApis || []).join(' '),
      (skill.tools || []).join(' '),
      (skill.rules || []).join(' '),
      (skill.resources || []).map(function (resource) { return resource.path }).join(' '),
    ].join(' ').toLowerCase()
  }

  function matches(id, skill, terms) {
    const text = searchText(id, skill)
    for (let i = 0; i < terms.length; i++) {
      if (text.indexOf(terms[i]) < 0) return false
    }
    return true
  }

  function search(query) {
    const q = String(query && (query.query || query.q || '') || '').trim().toLowerCase()
    const limit = Math.max(1, Math.min(50, Number(query && query.limit) || 10))
    if (q && q.indexOf('skill') < 0 && q.indexOf('authoring') < 0 && q.indexOf('aiditor') < 0) return []
    const out = [indexRef()]
    const terms = q ? q.split(/\s+/).filter(function (term) { return term !== 'skills' && term !== 'skill' }) : []
    const names = skillNames()
    for (let i = 0; i < names.length && out.length < limit; i++) {
      const skill = getSkill(names[i])
      if (!terms.length || matches(names[i], skill, terms)) out.push(refFor(names[i], skill))
    }
    return out
  }

  function schema() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        whenToUse: { type: 'string' },
        whenNotToUse: { type: 'string' },
        relatedApis: { type: 'array' },
        tools: { type: 'array' },
        docPath: { type: 'string' },
        resourceCount: { type: 'number' },
        resources: { type: 'array' },
        source: { type: 'string' },
        layer: { type: 'string' },
        hash: { type: 'string' },
        systemPrompt: { type: 'string' },
        rules: { type: 'array' },
      },
    }
  }

  function capabilities(ref) {
    const parsed = parseSkillUri(ref && ref.uri)
    if (!parsed || !parsed.id) return parsed ? ['read'] : []
    const skill = getSkill(parsed.id)
    if (!skill) return []
    if (!parsed.resource) return ['read']
    if (typeof skill.readResource !== 'function') return []
    return (skill.resources || []).some(function (item) {
      return item.path === parsed.resource && item.kind === 'reference'
    }) ? ['read'] : []
  }

  ai.references.register('skills', {
    search: search,
    read: read,
    schema: schema,
    capabilities: capabilities,
  }, { owner: 'aiditor.skills', layer: 'builtin' })
})(window.aiditor = window.aiditor || {})

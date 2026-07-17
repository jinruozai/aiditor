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

  function skillIdFromUri(uri) {
    const text = String(uri || '')
    if (text === 'aiditor://skills') return ''
    if (text.indexOf('aiditor://skills/') === 0) return decodeURIComponent(text.slice('aiditor://skills/'.length))
    return ''
  }

  function uriFor(id) {
    return 'aiditor://skills/' + encodeURIComponent(id)
  }

  function compactSkill(id, skill) {
    skill = skill || {}
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
    }
  }

  function fullSkill(id, skill) {
    return Object.assign(compactSkill(id, skill), {
      kind: 'aiditor.skill',
      systemPrompt: skill.systemPrompt || '',
      rules: skill.rules || [],
      examples: skill.examples || [],
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
    const id = skillIdFromUri(ref && ref.uri)
    if (!id) {
      return {
        uri: 'aiditor://skills',
        id: 'aiditor.skills.index',
        kind: 'aiditor.skill.index',
        title: 'AIditor Skills',
        summary: 'Registered AIditor skill list. Read a skill URI for full rules.',
        entries: skillNames().map(function (name) { return compactSkill(name, getSkill(name)) }),
      }
    }
    const skill = getSkill(id)
    return skill ? fullSkill(id, skill) : null
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
        systemPrompt: { type: 'string' },
        rules: { type: 'array' },
      },
    }
  }

  function capabilities(ref) {
    const id = skillIdFromUri(ref && ref.uri)
    return (!id || getSkill(id)) ? ['read'] : []
  }

  ai.references.register('skills', {
    search: search,
    read: read,
    schema: schema,
    capabilities: capabilities,
  }, { owner: 'aiditor.skills', layer: 'builtin' })
})(window.aiditor = window.aiditor || {})

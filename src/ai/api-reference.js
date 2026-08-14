// aiditor.ai API reference provider.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  if (!ai.references || !ai.references.register) return

  function payload() {
    return aiditor.apiDocs || { entries: [] }
  }

  function entries() {
    return payload().entries || []
  }

  function apiIdFromUri(uri) {
    const text = String(uri || '')
    if (text === 'aiditor://api' || text === 'api://') return ''
    if (text.indexOf('aiditor://api/') === 0) return decodeURIComponent(text.slice('aiditor://api/'.length))
    if (text.indexOf('api://') === 0) return decodeURIComponent(text.slice('api://'.length))
    return ''
  }

  function uriFor(entry) {
    return 'aiditor://api/' + encodeURIComponent(entry.id)
  }

  function findEntry(id) {
    const list = entries()
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i]
    }
    return null
  }

  function refFor(entry) {
    return {
      resolver: 'api',
      uri: uriFor(entry),
      kind: 'aiditor.api',
      title: entry.id,
      summary: entry.summary || '',
      meta: {
        group: entry.group,
        layer: entry.layer,
        kind: entry.kind,
        signature: entry.signature,
        params: entry.params || [],
        returns: entry.returns || null,
        examples: entry.examples || [],
        wrong: entry.wrong || [],
        related: entry.related || [],
        source: entry.source,
      },
    }
  }

  function indexRef() {
    return {
      resolver: 'api',
      uri: 'aiditor://api',
      kind: 'aiditor.api.index',
      title: 'AIditor API Index',
      summary: 'Generated list of documented AIditor APIs.',
      meta: { count: entries().length },
    }
  }

  function searchText(entry) {
    return [
      entry.id,
      entry.group,
      entry.layer,
      entry.kind,
      entry.signature,
      entry.summary,
      (entry.params || []).map(function (p) { return p.name + ' ' + p.type + ' ' + p.description }).join(' '),
      (entry.examples || []).join(' '),
      (entry.related || []).join(' '),
    ].join(' ').toLowerCase()
  }

  function matches(entry, terms) {
    if (!terms.length) return false
    const text = searchText(entry)
    for (let i = 0; i < terms.length; i++) {
      if (text.indexOf(terms[i]) < 0) return false
    }
    return true
  }

  function search(query) {
    const q = String(query && (query.query || query.q || '') || '').trim().toLowerCase()
    const limit = Math.max(1, Math.min(50, Number(query && query.limit) || 10))
    if (!q || q === 'api' || q === 'apis' || q === 'all api' || q === 'api list') {
      const out = [indexRef()]
      const list = entries()
      for (let i = 0; i < list.length && out.length < limit; i++) out.push(refFor(list[i]))
      return out
    }
    const terms = q.split(/\s+/).filter(Boolean)
    const out = []
    const list = entries()
    for (let i = 0; i < list.length && out.length < limit; i++) {
      if (matches(list[i], terms)) out.push(refFor(list[i]))
    }
    return out
  }

  function read(ref) {
    const id = apiIdFromUri(ref && ref.uri)
    if (!id) {
      return {
        uri: 'aiditor://api',
        id: 'aiditor.api.index',
        kind: 'aiditor.api.index',
        title: 'AIditor API Index',
        summary: 'Generated API list from structured source comments.',
        entries: entries().map(function (entry) {
          return {
            id: entry.id,
            uri: uriFor(entry),
            group: entry.group,
            layer: entry.layer,
            kind: entry.kind,
            signature: entry.signature,
            summary: entry.summary,
          }
        }),
      }
    }
    const entry = findEntry(id)
    return entry ? Object.assign({ uri: uriFor(entry) }, entry) : null
  }

  function schema() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string' },
        group: { type: 'string' },
        layer: { type: 'string' },
        kind: { type: 'string' },
        signature: { type: 'string' },
        summary: { type: 'string' },
        params: { type: 'array' },
        returns: { type: ['object', 'null'] },
        examples: { type: 'array' },
        wrong: { type: 'array' },
        related: { type: 'array' },
        source: { type: 'string' },
      },
    }
  }

  function capabilities(ref) {
    const id = apiIdFromUri(ref && ref.uri)
    return (!id || findEntry(id)) ? ['read'] : []
  }

  ai.references.register('api', {
    search: search,
    read: read,
    schema: schema,
    capabilities: capabilities,
  }, { owner: 'aiditor.ai.api', layer: 'builtin' })
})(window.aiditor = window.aiditor || {})

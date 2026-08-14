// Shared exact-owner registry primitive for AI Host contributions.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const matchesPrefix = aiditor.names.matchesPrefix

  function registrationMeta(meta) {
    return aiditor.runtime && aiditor.runtime.registrationMeta
      ? aiditor.runtime.registrationMeta(meta || {})
      : (meta || {})
  }

  function normalizeMeta(kind, meta) {
    meta = registrationMeta(meta)
    if (meta.owner == null || String(meta.owner) === '')
      throw new Error(kind + '.register: owner is required')
    const out = { owner: String(meta.owner) }
    if (meta.layer != null) out.layer = String(meta.layer)
    if (meta.source != null) out.source = String(meta.source)
    if (meta.hash != null) out.hash = String(meta.hash)
    return out
  }

  function create(kind, options) {
    options = options || {}
    const records = {}
    const metadata = {}

    function register(name, value, meta) {
      name = String(name || '')
      if (!name) throw new Error(kind + '.register: name is required')
      const normalizedMeta = normalizeMeta(kind, meta)
      if (records[name]) {
        if (!meta || meta.replace !== true)
          throw new Error(kind + '.register: duplicate name "' + name + '"')
        if (metadata[name].owner !== normalizedMeta.owner)
          throw new Error(kind + '.register: owner mismatch for "' + name + '"')
      }
      const normalized = options.normalize ? options.normalize(name, value, normalizedMeta) : value
      records[name] = normalized
      metadata[name] = options.meta ? options.meta(name, normalized, normalizedMeta, meta || {}) : normalizedMeta
      return normalized
    }

    function unregister(name, meta) {
      if (!records[name]) return false
      const normalizedMeta = normalizeMeta(kind, meta)
      if (metadata[name].owner !== normalizedMeta.owner)
        throw new Error(kind + '.unregister: owner mismatch for "' + name + '"')
      delete records[name]
      delete metadata[name]
      return true
    }

    function unregisterOwner(owner) {
      owner = String(owner || '')
      const removed = []
      Object.keys(records).forEach(function (name) {
        if (metadata[name].owner !== owner) return
        delete records[name]
        delete metadata[name]
        removed.push(name)
      })
      return removed
    }

    function list(filter) {
      const names = Object.keys(records)
      if (typeof filter === 'string')
        return names.filter(function (name) { return matchesPrefix(name, filter) })
      if (!filter) return names
      return names.filter(function (name) {
        const meta = metadata[name]
        if (filter.owner != null && meta.owner !== filter.owner) return false
        if (filter.layer != null && meta.layer !== filter.layer) return false
        if (filter.source != null && meta.source !== filter.source) return false
        return true
      })
    }

    if (aiditor.runtime && aiditor.runtime.registerOwnerCleanup) {
      aiditor.runtime.registerOwnerCleanup(function (owner) {
        const removed = unregisterOwner(owner)
        const result = {}
        result[options.cleanupKey || kind] = removed
        return result
      })
    }

    return {
      register: register,
      unregister: unregister,
      unregisterOwner: unregisterOwner,
      get: function (name) { return records[name] },
      list: list,
      meta: function (name) { return Object.assign({}, metadata[name] || {}) },
    }
  }

  ai._contributionRegistry = { create: create }
})(window.aiditor = window.aiditor || {})

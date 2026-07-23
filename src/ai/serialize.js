// aiditor.ai serialization boundary helpers.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function isDomLike(value) {
    return value && typeof value === 'object' && (
      value === window ||
      value.nodeType === 1 ||
      value.nodeType === 9 ||
      value.nodeType === 11
    )
  }

  function domLabel(value) {
    if (value === window) return '[Window]'
    const tag = value && value.tagName ? String(value.tagName).toLowerCase() : 'node'
    const id = value && value.id ? '#' + value.id : ''
    const cls = value && typeof value.className === 'string' && value.className.trim()
      ? '.' + value.className.trim().replace(/\s+/g, '.')
      : ''
    return '[DOM ' + tag + id + cls + ']'
  }

  function stringify(value) {
    const ancestors = []
    try {
      return JSON.stringify(value, function (key, item) {
        if (typeof item === 'function') return '[Function]'
        if (typeof item === 'bigint') return String(item)
        if (isDomLike(item)) return domLabel(item)
        if (item && typeof item === 'object') {
          while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop()
          if (ancestors.indexOf(item) >= 0) return '[Circular]'
          ancestors.push(item)
        }
        return item
      })
    } catch (err) {
      return String(value)
    }
  }

  function parseClone(value) {
    const text = stringify(value)
    return text == null ? null : JSON.parse(text)
  }

  function compactString(value, max) {
    const text = String(value == null ? '' : value)
    return max > 0 && text.length > max ? text.slice(0, max) + '\n...[truncated]' : text
  }

  function compactValue(value, maxString, depth) {
    if (value == null) return value
    if (typeof value === 'string') return compactString(value, maxString)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'function') return '[Function]'
    if (isDomLike(value)) return domLabel(value)
    if (depth <= 0) return compactString(stringify(value), maxString)
    if (Array.isArray(value)) {
      const out = []
      const n = Math.min(value.length, 32)
      for (let i = 0; i < n; i++) out.push(compactValue(value[i], maxString, depth - 1))
      if (value.length > n) out.push('[+' + (value.length - n) + ' items truncated]')
      return out
    }
    const out = {}
    const keys = Object.keys(value)
    const n = Math.min(keys.length, 48)
    for (let i = 0; i < n; i++) out[keys[i]] = compactValue(value[keys[i]], maxString, depth - 1)
    if (keys.length > n) out.__truncatedKeys = keys.length - n
    return out
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value))
  }

  function stableValue(value) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint') return String(value)
    if (typeof value === 'function') return '[Function]'
    if (isDomLike(value)) return domLabel(value)
    if (Array.isArray(value)) return value.map(function (item) {
      return item === undefined ? null : stableValue(item)
    })
    const out = {}
    const keys = Object.keys(value).sort()
    for (let i = 0; i < keys.length; i++) {
      const item = value[keys[i]]
      if (item !== undefined) out[keys[i]] = stableValue(item)
    }
    return out
  }

  function hash(value) {
    const text = stableStringify(value)
    let valueHash = 2166136261
    for (let i = 0; i < text.length; i++) {
      valueHash ^= text.charCodeAt(i)
      valueHash = Math.imul(valueHash, 16777619)
    }
    return 'fnv1a32:' + (valueHash >>> 0).toString(16).padStart(8, '0')
  }

  ai.serialize = {
    stringify: stringify,
    clone: parseClone,
    compactString: compactString,
    compactValue: compactValue,
    stableStringify: stableStringify,
    hash: hash,
  }
})(window.aiditor = window.aiditor || {})

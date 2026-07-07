// aiditor.ui.schema — shared helpers for schema-driven form value handling.
;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui = aiditor.ui || {}

  function resolveFieldDef(fieldDef) {
    if (typeof fieldDef === 'string') fieldDef = { type: fieldDef }
    if (fieldDef && fieldDef._resolved) return fieldDef
    return ui.resolveFieldDef ? ui.resolveFieldDef(fieldDef || {}) : (fieldDef || {})
  }

  function resolveValueFieldDef(valueType) {
    return resolveFieldDef(typeof valueType === 'string' ? { type: valueType } : valueType)
  }

  function resolveArrayElemFieldDef(fieldDef, agv) {
    const fd = fieldDef || {}
    const cfg = agv || fd.type_agv || {}
    const elem = cfg.elem_type || parseArrayElemType(fd.type) || 'string'
    return resolveValueFieldDef(elem)
  }

  function resolveDictValueFieldDef(fieldDef, agv) {
    const fd = fieldDef || {}
    const cfg = agv || fd.type_agv || {}
    return resolveValueFieldDef(cfg.value_type || 'string')
  }

  function normalizeStructDef(def) {
    if (!def || typeof def !== 'object') return null
    const keys = Object.keys(def)
    if (keys.length === 1 && def[keys[0]] && typeof def[keys[0]] === 'object') {
      const inner = def[keys[0]]
      const allString = Object.keys(inner).every(function (k) { return typeof inner[k] === 'string' })
      if (allString) {
        const norm = {}
        Object.keys(inner).forEach(function (k) { norm[k] = { type: inner[k] } })
        return norm
      }
      return inner
    }
    return def
  }

  function parseArrayElemType(typeName) {
    if (typeof typeName !== 'string') return null
    const m = /^array\[(.+)\]$/.exec(typeName)
    return m ? m[1] : null
  }

  function isStructField(fieldDef) {
    const fd = fieldDef || {}
    return fd.base_type === 'struct' || fd.type === 'struct' || fd.type_render === 'struct' || !!fd.struct_def
  }

  function isArrayField(fieldDef) {
    const fd = fieldDef || {}
    return fd.base_type === 'array'
      || fd.type === 'array'
      || fd.type_render === 'array'
      || fd.type_render === 'array_editor'
      || !!parseArrayElemType(fd.type)
  }

  function isDictField(fieldDef) {
    const fd = fieldDef || {}
    return fd.base_type === 'dict' || fd.type === 'dict' || fd.type_render === 'dict'
  }

  function cloneDefault(fieldDef) {
    const fd = fieldDef || {}
    if (fd.default !== undefined) return cloneValue(fd.default)
    if (isStructField(fd)) return []
    if (isArrayField(fd)) return []
    if (isDictField(fd)) return {}
    return undefined
  }

  function cloneValue(value) {
    if (value == null || typeof value !== 'object') return value
    return JSON.parse(JSON.stringify(value))
  }

  ui.schema = {
    resolveFieldDef: resolveFieldDef,
    resolveValueFieldDef: resolveValueFieldDef,
    resolveArrayElemFieldDef: resolveArrayElemFieldDef,
    resolveDictValueFieldDef: resolveDictValueFieldDef,
    normalizeStructDef: normalizeStructDef,
    parseArrayElemType: parseArrayElemType,
    isStructField: isStructField,
    isArrayField: isArrayField,
    isDictField: isDictField,
    cloneDefault: cloneDefault,
    cloneValue: cloneValue,
  }
})(window.aiditor = window.aiditor || {})

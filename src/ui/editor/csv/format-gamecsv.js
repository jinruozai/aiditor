// GameCSV: single-quoted column definitions and typed parenthesized values.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv
  const schema = ui.schema
  const FIELD_KEYS = ['type', 'type_agv', 'type_render', 'default', 'mem', 'struct_def', 'tag', 'fieldLayout', 'defaultCollapsed']

  function literalParser(source) {
    const text = String(source)
    let at = 0

    function space() { while (/\s/.test(text[at] || '')) at++ }
    function string() {
      const quote = text[at++]
      let value = ''
      while (at < text.length) {
        const ch = text[at++]
        if (ch === quote) return value
        if (ch !== '\\') { value += ch; continue }
        const escaped = text[at++]
        if (escaped === 'n') value += '\n'
        else if (escaped === 'r') value += '\r'
        else if (escaped === 't') value += '\t'
        else value += escaped
      }
      throw new Error('gamecsv header: unclosed string')
    }
    function number() {
      const start = at
      while (/[0-9eE+\-.]/.test(text[at] || '')) at++
      const token = text.slice(start, at)
      const value = Number(token)
      if (!token || !Number.isFinite(value)) throw new Error('gamecsv header: invalid number at offset ' + start)
      return value
    }
    function array() {
      const value = []
      at++
      space()
      if (text[at] === ']') { at++; return value }
      while (at < text.length) {
        value.push(read())
        space()
        if (text[at] === ']') { at++; return value }
        if (text[at++] !== ',') throw new Error('gamecsv header: expected comma at offset ' + (at - 1))
      }
      throw new Error('gamecsv header: unclosed array')
    }
    function object() {
      const value = {}
      at++
      space()
      if (text[at] === '}') { at++; return value }
      while (at < text.length) {
        space()
        if (text[at] !== "'" && text[at] !== '"') throw new Error('gamecsv header: quoted key expected at offset ' + at)
        const key = string()
        space()
        if (text[at++] !== ':') throw new Error('gamecsv header: expected colon at offset ' + (at - 1))
        value[key] = read()
        space()
        if (text[at] === '}') { at++; return value }
        if (text[at++] !== ',') throw new Error('gamecsv header: expected comma at offset ' + (at - 1))
      }
      throw new Error('gamecsv header: unclosed object')
    }
    function read() {
      space()
      const ch = text[at]
      if (ch === "'" || ch === '"') return string()
      if (ch === '{') return object()
      if (ch === '[') return array()
      if (text.slice(at, at + 4) === 'true') { at += 4; return true }
      if (text.slice(at, at + 5) === 'false') { at += 5; return false }
      if (text.slice(at, at + 4) === 'null') { at += 4; return null }
      if (/[0-9+\-.]/.test(ch || '')) return number()
      throw new Error('gamecsv header: invalid value at offset ' + at)
    }

    const value = read()
    space()
    if (at !== text.length) throw new Error('gamecsv header: trailing content at offset ' + at)
    return value
  }

  function stringifyLiteral(value) {
    if (value == null) return 'null'
    if (typeof value === 'string') return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + "'"
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return '[' + value.map(stringifyLiteral).join(',') + ']'
    const parts = []
    Object.keys(value).forEach(function (key) { parts.push(stringifyLiteral(key) + ':' + stringifyLiteral(value[key])) })
    return '{' + parts.join(',') + '}'
  }

  function definitionFor(column) {
    const out = { name: String(column.name || '') }
    const fieldDef = column.fieldDef || { type: 'var' }
    FIELD_KEYS.forEach(function (key) {
      if (fieldDef[key] !== undefined) out[key] = fieldDef[key]
    })
    if (Number(column.width) > 0) out.width = Number(column.width)
    if (column.align === 'left' || column.align === 'center' || column.align === 'right') out.align = column.align
    if (typeof column.color === 'string' && column.color) out.color = column.color
    return out
  }

  function signature(column) { return JSON.stringify(definitionFor(column)) }

  function parseDefinition(value) {
    if (typeof value === 'string') value = literalParser(value)
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.name !== 'string') return null
    if (value.type != null && typeof value.type !== 'string') return null
    const fieldDef = { type: value.type || 'var' }
    FIELD_KEYS.forEach(function (key) {
      if (key !== 'type' && value[key] !== undefined && !(value.isError && key === 'type_render')) fieldDef[key] = value[key]
    })
    const resolved = ui.resolveFieldDef(fieldDef)
    if (resolved.type_render === 'enum' && resolved.base_type === 'int' && Array.isArray(fieldDef.type_agv && fieldDef.type_agv.options)) {
      fieldDef.type_agv = Object.assign({}, fieldDef.type_agv, {
        options: fieldDef.type_agv.options.map(function (option) {
          if (!option || typeof option !== 'object' || integer(String(option.value)) == null) return option
          return Object.assign({}, option, { value: integer(String(option.value)) })
        }),
      })
    }
    const column = { name: value.name, fieldDef: fieldDef }
    if (Number(value.width) > 0) column.width = Number(value.width)
    if (value.align === 'left' || value.align === 'center' || value.align === 'right') column.align = value.align
    if (typeof value.color === 'string' && value.color) column.color = value.color
    return column
  }

  function parseColumn(text) {
    text = String(text == null ? '' : text)
    if (text[0] !== '{') return { name: text, fieldDef: { type: 'var' } }
    const column = parseDefinition(text)
    if (!column) throw new Error('gamecsv header: invalid column definition')
    column._gamecsvRaw = text
    column._gamecsvSignature = signature(column)
    return column
  }

  function stringifyColumn(column) {
    if (column._gamecsvRaw && column._gamecsvSignature === signature(column)) return column._gamecsvRaw
    const definition = definitionFor(column)
    if (definition.type === 'var' && Object.keys(definition).length === 2) return definition.name
    return stringifyLiteral(definition)
  }

  function resolvedField(fieldDef) {
    const source = fieldDef || { type: 'var' }
    const elemType = schema.parseArrayElemType(source.type)
    if (!elemType) return ui.resolveFieldDef(source)
    const arrayType = ui.resolveType('array')
    const resolved = Object.assign({}, arrayType, source)
    resolved.type_agv = Object.assign({}, arrayType.type_agv || {}, source.type_agv || {}, { elem_type: elemType })
    return resolved
  }

  function integer(raw) {
    if (!/^[+-]?(?:0[xX][0-9a-fA-F]+|\d+)$/.test(raw)) return null
    const value = Number(raw)
    return Number.isSafeInteger(value) ? value : null
  }

  function number(raw) {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  function tuple(source) {
    const text = String(source).trim()
    let at = 0

    function quoted() {
      const quote = text[at++]
      let value = ''
      while (at < text.length) {
        const ch = text[at++]
        if (ch === quote) return value
        if (ch === '\\' && at < text.length) value += text[at++]
        else value += ch
      }
      throw new Error('unclosed quoted value')
    }
    function item() {
      while (/\s/.test(text[at] || '')) at++
      if (text[at] === '(') return list(true)
      if (text[at] === "'" || text[at] === '"') return quoted()
      const start = at
      while (at < text.length && text[at] !== ',' && text[at] !== ')') at++
      return text.slice(start, at).trim()
    }
    function list(parenthesized) {
      const values = []
      if (parenthesized) at++
      while (at < text.length) {
        while (/\s/.test(text[at] || '')) at++
        if (parenthesized && text[at] === ')') { at++; return values }
        values.push(item())
        while (/\s/.test(text[at] || '')) at++
        if (parenthesized && text[at] === ')') { at++; return values }
        if (at >= text.length) return values
        if (text[at++] !== ',') throw new Error('expected comma at offset ' + (at - 1))
      }
      if (parenthesized) throw new Error('unclosed parenthesized value')
      return values
    }

    const values = list(text[0] === '(')
    while (/\s/.test(text[at] || '')) at++
    if (at !== text.length) throw new Error('trailing content at offset ' + at)
    return values
  }

  function enumValues(options) {
    if (Array.isArray(options)) return options.map(function (option) { return option && typeof option === 'object' ? option.value : option })
    return Object.keys(options || {})
  }

  function decodeScalar(raw, fieldDef) {
    raw = String(raw == null ? '' : raw)
    if (raw === '') return { value: null, error: null }
    if (raw.toLowerCase() === 'null') return { value: null, error: null }
    const resolved = resolvedField(fieldDef)
    const base = resolved.base_type
    const render = resolved.type_render
    let value

    if (render === 'color' && /^#[0-9a-f]{3,8}$/i.test(raw)) {
      value = raw
    } else if (render === 'toggle') {
      const token = raw.toLowerCase()
      if (token === '1' || token === 'true') value = 1
      else if (token === '0' || token === 'false') value = 0
      else return { value: 0, error: 'Expected boolean (0/1/true/false)' }
    } else if ((resolved.type === 'percent' || (resolved.type_agv || {}).percent) && /%$/.test(raw)) {
      value = number(raw.slice(0, -1).trim())
      if (value == null) return { value: raw, error: 'Expected percentage' }
      value /= 100
    } else if (base === 'int') {
      value = integer(raw)
      if (value == null) return { value: raw, error: 'Expected integer' }
    } else if (base === 'float') {
      value = number(raw)
      if (value == null) return { value: raw, error: 'Expected number' }
    } else {
      value = raw
    }

    if (render === 'enum') {
      const allowed = enumValues((resolved.type_agv || {}).options)
      if (allowed.length && !allowed.some(function (item) { return String(item) === String(value) })) {
        return { value: value, error: 'Value is not an enum option' }
      }
    }
    if (render === 'range' && typeof value === 'number') {
      const agv = resolved.type_agv || {}
      if (agv.min != null && value < Number(agv.min) || agv.max != null && value > Number(agv.max)) {
        return { value: value, error: 'Value is outside the configured range' }
      }
    }
    return { value: value, error: resolved._unknown ? 'Unknown type: ' + fieldDef.type : null }
  }

  function decodeNode(node, fieldDef) {
    const resolved = resolvedField(fieldDef)
    if (schema.isArrayField(resolved)) {
      if (!Array.isArray(node)) return { value: node, errors: ['Expected list'] }
      const elem = schema.resolveArrayElemFieldDef(resolved, resolved.type_agv)
      const values = []
      const errors = []
      node.forEach(function (item, index) {
        const decoded = decodeNode(item, elem)
        values.push(decoded.value)
        decoded.errors.forEach(function (error) { errors.push('[' + index + '] ' + error) })
      })
      return { value: values, errors: errors }
    }
    if (schema.isStructField(resolved)) {
      if (!Array.isArray(node)) return { value: node, errors: ['Expected tuple'] }
      const definition = schema.normalizeStructDef(resolved.struct_def) || {}
      const fields = Object.keys(definition)
      if (fields.length && node.length > fields.length) {
        const excess = node.length - fields.length
        const first = resolvedField(definition[fields[0]])
        const grouped = node.slice(0, excess + 1)
        if (first.base_type === 'int' && /^[+-]?\d+$/.test(String(grouped[0])) && grouped.slice(1).every(function (item) { return /^\d{3}$/.test(String(item)) })) {
          node = [grouped.join('')].concat(node.slice(excess + 1))
        }
      }
      const values = []
      const errors = []
      node.forEach(function (item, index) {
        if (index >= fields.length) { values.push(item); return }
        const decoded = decodeNode(item, definition[fields[index]])
        values.push(decoded.value)
        decoded.errors.forEach(function (error) { errors.push(fields[index] + ': ' + error) })
      })
      if (fields.length && node.length !== fields.length) errors.push('Expected ' + fields.length + ' tuple values, received ' + node.length)
      return { value: values, errors: errors }
    }
    const scalar = decodeScalar(node, resolved)
    return { value: scalar.value, errors: scalar.error ? [scalar.error] : [] }
  }

  function decodeCell(raw, fieldDef) {
    raw = String(raw == null ? '' : raw)
    if (raw === '') return { value: null, error: null }
    const resolved = resolvedField(fieldDef)
    if (!schema.isArrayField(resolved) && !schema.isStructField(resolved)) return decodeScalar(raw, resolved)
    let node
    try { node = tuple(raw) } catch (error) { return { value: raw, error: error.message } }
    const decoded = decodeNode(node, resolved)
    return { value: decoded.value, error: decoded.errors.length ? decoded.errors.join('; ') : null }
  }

  function encodeScalar(value, fieldDef, nested) {
    if (value == null) return ''
    const resolved = resolvedField(fieldDef)
    if (resolved.type_render === 'toggle') return value ? '1' : '0'
    if ((resolved.type === 'percent' || (resolved.type_agv || {}).percent) && typeof value === 'number') return String(value * 100) + '%'
    const text = String(value)
    if (!nested || resolved.base_type === 'int' || resolved.base_type === 'float') return text
    return "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
  }

  function encodeNode(value, fieldDef, nested) {
    const resolved = resolvedField(fieldDef)
    if (schema.isArrayField(resolved)) {
      const elem = schema.resolveArrayElemFieldDef(resolved, resolved.type_agv)
      return '(' + (Array.isArray(value) ? value : []).map(function (item) { return encodeNode(item, elem, true) }).join(',') + ')'
    }
    if (schema.isStructField(resolved)) {
      const definition = schema.normalizeStructDef(resolved.struct_def) || {}
      const fields = Object.keys(definition)
      return '(' + (Array.isArray(value) ? value : []).map(function (item, index) {
        return encodeNode(item, definition[fields[index]] || { type: 'var' }, true)
      }).join(',') + ')'
    }
    return encodeScalar(value, resolved, nested)
  }

  function encodeCell(value, fieldDef) { return value == null ? '' : encodeNode(value, fieldDef, false) }

  csv.formats.register({
    id: 'gamecsv',
    label: 'GameCSV',
    supportsColumnSchema: true,
    parseColumn: parseColumn,
    stringifyColumn: stringifyColumn,
    parseDefinition: parseDefinition,
    definitionFor: definitionFor,
    stringifyDefinition: function (column) { return stringifyLiteral(definitionFor(column)) },
    decodeCell: decodeCell,
    encodeCell: encodeCell,
    resolveField: resolvedField,
  })
})(window.aiditor = window.aiditor || {})

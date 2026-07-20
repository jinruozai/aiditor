// aiditor.ai JSON schema subset used by tool inputs and structured outputs.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function normalize(schema, path) {
    path = path || 'schema'
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw schemaError('SCHEMA_INVALID', path, 'Schema must be an object')
    const out = Object.assign({}, schema)
    if (out.type != null && !validTypeDeclaration(out.type)) throw schemaError('SCHEMA_INVALID_TYPE', path + '.type', 'Schema type is invalid')
    const types = schemaTypes(out.type)
    if (out.enum != null && !Array.isArray(out.enum)) throw schemaError('SCHEMA_INVALID_ENUM', path + '.enum', 'Schema enum must be an array')
    if (out.required != null && !Array.isArray(out.required)) throw schemaError('SCHEMA_INVALID_REQUIRED', path + '.required', 'Schema required must be an array')
    if (hasType(types, 'object') || out.properties) {
      const properties = out.properties || {}
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw schemaError('SCHEMA_INVALID_PROPERTIES', path + '.properties', 'Schema properties must be an object')
      out.properties = {}
      Object.keys(properties).forEach(function (key) {
        out.properties[key] = normalize(properties[key] || {}, path + '.properties.' + key)
      })
      const required = out.required || []
      for (let i = 0; i < required.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(out.properties, required[i])) {
          throw schemaError('SCHEMA_REQUIRED_UNKNOWN', path + '.required', 'required property is not defined: ' + required[i])
        }
      }
      if (out.additionalProperties && typeof out.additionalProperties === 'object') {
        out.additionalProperties = normalize(out.additionalProperties, path + '.additionalProperties')
      }
    }
    if ((hasType(types, 'array') || out.items) && out.items) out.items = normalize(out.items, path + '.items')
    normalizeAlternatives(out, 'anyOf', path)
    normalizeAlternatives(out, 'oneOf', path)
    normalizeAlternatives(out, 'allOf', path)
    if (out.not) out.not = normalize(out.not, path + '.not')
    if (out.pattern != null) {
      try { new RegExp(out.pattern) } catch (_) { throw schemaError('SCHEMA_INVALID_PATTERN', path + '.pattern', 'Schema pattern is invalid') }
    }
    return out
  }

  function normalizeAlternatives(schema, key, path) {
    if (schema[key] == null) return
    if (!Array.isArray(schema[key]) || !schema[key].length) throw schemaError('SCHEMA_INVALID_COMPOSITION', path + '.' + key, key + ' must be a non-empty array')
    schema[key] = schema[key].map(function (item, index) { return normalize(item, path + '.' + key + '[' + index + ']') })
  }

  function validate(value, schema) {
    const normalized = normalize(schema)
    const errors = []
    validateNode(value, normalized, '$', errors)
    return { valid: !errors.length, errors: errors }
  }

  function assertValue(value, schema) {
    const result = validate(value, schema)
    if (result.valid) return value
    const first = result.errors[0]
    const err = schemaError('SCHEMA_VALUE_INVALID', first.path, first.message)
    err.errors = result.errors
    throw err
  }

  function parse(text, schema) {
    const source = unwrapJsonFence(text)
    let value = null
    try { value = JSON.parse(source) } catch (cause) {
      const err = schemaError('OUTPUT_JSON_INVALID', '$', 'Structured output is not valid JSON')
      err.cause = cause
      throw err
    }
    const result = validate(value, schema)
    if (!result.valid) {
      const first = result.errors[0]
      const err = schemaError('OUTPUT_SCHEMA_INVALID', first.path, first.message)
      err.errors = result.errors
      throw err
    }
    return value
  }

  function unwrapJsonFence(text) {
    const source = String(text == null ? '' : text).trim()
    const match = source.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
    return match ? match[1].trim() : source
  }

  function validateNode(value, schema, path, errors) {
    if (schema.anyOf) {
      if (!matchesCount(value, schema.anyOf, 1)) addError(errors, path, 'Value does not match any allowed schema')
    }
    if (schema.oneOf) {
      if (matchesCount(value, schema.oneOf) !== 1) addError(errors, path, 'Value must match exactly one schema')
    }
    if (schema.allOf) {
      for (let i = 0; i < schema.allOf.length; i++) validateNode(value, schema.allOf[i], path, errors)
    }
    if (schema.not && matchesCount(value, [schema.not])) addError(errors, path, 'Value matches a forbidden schema')
    if (Object.prototype.hasOwnProperty.call(schema, 'const') && !sameValue(value, schema.const)) addError(errors, path, 'Value does not match const')
    if (schema.enum && !schema.enum.some(function (item) { return sameValue(value, item) })) addError(errors, path, 'Value is not in enum')
    const types = schemaTypes(schema.type)
    if (types.length && !types.some(function (type) { return matchesType(value, type) })) {
      addError(errors, path, 'Expected ' + types.join(' or '))
      return
    }
    if (value == null) return
    if (typeof value === 'string') validateString(value, schema, path, errors)
    if (typeof value === 'number') validateNumber(value, schema, path, errors)
    if (Array.isArray(value)) validateArray(value, schema, path, errors)
    if (isObject(value)) validateObject(value, schema, path, errors)
  }

  function matchesCount(value, schemas, stopAt) {
    let count = 0
    for (let i = 0; i < schemas.length; i++) {
      const errors = []
      validateNode(value, schemas[i], '$', errors)
      if (!errors.length) count++
      if (stopAt && count >= stopAt) return count
    }
    return count
  }

  function validateString(value, schema, path, errors) {
    if (schema.minLength != null && value.length < schema.minLength) addError(errors, path, 'String is shorter than minLength')
    if (schema.maxLength != null && value.length > schema.maxLength) addError(errors, path, 'String is longer than maxLength')
    if (schema.pattern != null && !(new RegExp(schema.pattern).test(value))) addError(errors, path, 'String does not match pattern')
  }

  function validateNumber(value, schema, path, errors) {
    if (schema.minimum != null && value < schema.minimum) addError(errors, path, 'Number is below minimum')
    if (schema.maximum != null && value > schema.maximum) addError(errors, path, 'Number is above maximum')
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) addError(errors, path, 'Number is not above exclusiveMinimum')
    if (schema.exclusiveMaximum != null && value >= schema.exclusiveMaximum) addError(errors, path, 'Number is not below exclusiveMaximum')
  }

  function validateArray(value, schema, path, errors) {
    if (schema.minItems != null && value.length < schema.minItems) addError(errors, path, 'Array has fewer than minItems')
    if (schema.maxItems != null && value.length > schema.maxItems) addError(errors, path, 'Array has more than maxItems')
    if (schema.uniqueItems) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) if (sameValue(value[i], value[j])) addError(errors, path, 'Array items must be unique')
      }
    }
    if (schema.items) for (let k = 0; k < value.length; k++) validateNode(value[k], schema.items, path + '[' + k + ']', errors)
  }

  function validateObject(value, schema, path, errors) {
    const properties = schema.properties || {}
    const required = schema.required || []
    for (let i = 0; i < required.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, required[i])) addError(errors, path + '.' + required[i], 'Required property is missing')
    }
    const keys = Object.keys(value)
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j]
      if (properties[key]) validateNode(value[key], properties[key], path + '.' + key, errors)
      else if (schema.additionalProperties === false) addError(errors, path + '.' + key, 'Additional property is not allowed')
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateNode(value[key], schema.additionalProperties, path + '.' + key, errors)
    }
  }

  function schemaTypes(type) {
    if (typeof type === 'string') return validType(type) ? [type] : []
    if (!Array.isArray(type)) return []
    const out = []
    for (let i = 0; i < type.length; i++) if (validType(type[i]) && out.indexOf(type[i]) < 0) out.push(type[i])
    return out
  }

  function validType(type) {
    return type === 'object' || type === 'array' || type === 'string' || type === 'number' || type === 'integer' || type === 'boolean' || type === 'null'
  }

  function validTypeDeclaration(type) {
    if (typeof type === 'string') return validType(type)
    if (!Array.isArray(type) || !type.length) return false
    for (let i = 0; i < type.length; i++) if (!validType(type[i])) return false
    return true
  }

  function hasType(types, type) { return types.indexOf(type) >= 0 }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value) }
  function matchesType(value, type) {
    if (type === 'null') return value === null
    if (type === 'array') return Array.isArray(value)
    if (type === 'object') return isObject(value)
    if (type === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
    return typeof value === type
  }
  function sameValue(a, b) {
    if (a === b) return true
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false
      return true
    }
    const aKeys = Object.keys(a).sort()
    const bKeys = Object.keys(b).sort()
    if (aKeys.length !== bKeys.length) return false
    for (let j = 0; j < aKeys.length; j++) {
      if (aKeys[j] !== bKeys[j] || !sameValue(a[aKeys[j]], b[bKeys[j]])) return false
    }
    return true
  }
  function addError(errors, path, message) { errors.push({ path: path, message: message }) }
  function schemaError(code, path, message) {
    const err = new Error(message + ' at ' + path)
    err.code = code
    err.path = path
    return err
  }

  ai.schema = {
    normalize: normalize,
    validate: validate,
    assert: assertValue,
    parse: parse,
  }
})(window.aiditor = window.aiditor || {})

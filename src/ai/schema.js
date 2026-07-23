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
        setOwn(out.properties, key, normalize(properties[key] || {}, path + '.properties.' + key))
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
    return { valid: !errors.length, errors: errors, error: bestError(errors) }
  }

  function assertValue(value, schema) {
    const result = validate(value, schema)
    if (result.valid) return value
    const first = result.error
    const err = schemaError('SCHEMA_VALUE_INVALID', first.path, first.message)
    err.keyword = first.keyword
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
      const first = result.error
      const err = schemaError('OUTPUT_SCHEMA_INVALID', first.path, first.message)
      err.keyword = first.keyword
      err.errors = result.errors
      throw err
    }
    return value
  }

  function strictTool(schema) {
    const normalized = normalize(schema)
    const types = schemaTypes(normalized.type)
    if (!hasType(types, 'object')) throw strictSchemaError('schema', 'Tool arguments must use an object schema')
    return strictNode(normalized, 'schema', true)
  }

  function strictNode(schema, path, root) {
    assertStrictKeywords(schema, path)
    if (schema.oneOf) return strictObjectUnion(schema, path)
    if (schema.allOf || schema.not) throw strictSchemaError(path, 'allOf and not cannot be represented by the portable strict Tool schema')
    const types = schemaTypes(schema.type)
    const nullable = hasType(types, 'null')
    const valueTypes = types.filter(function (type) { return type !== 'null' })
    const pureNull = nullable && valueTypes.length === 0
    if (valueTypes.length > 1) throw strictSchemaError(path + '.type', 'Multiple non-null types require an explicit anyOf')
    const out = {}
    copyStrictAnnotations(schema, out)
    copyStrictConstraints(schema, out, path)
    if (schema.enum) out.enum = schema.enum.slice()
    if (Object.prototype.hasOwnProperty.call(schema, 'const')) out.enum = [schema.const]
    if (schema.anyOf) {
      out.anyOf = schema.anyOf.map(function (item, index) {
        return strictNode(item, path + '.anyOf[' + index + ']', false)
      })
    }
    const type = valueTypes[0]
    if (pureNull) out.type = 'null'
    if (!type && !pureNull && !schema.anyOf && !schema.enum && !Object.prototype.hasOwnProperty.call(schema, 'const')) {
      throw strictSchemaError(path, 'Unconstrained values cannot be schema-constrained')
    }
    if (type === 'object') {
      if (schema.additionalProperties && schema.additionalProperties !== false) {
        throw strictSchemaError(path + '.additionalProperties', 'Open-ended object properties cannot be schema-constrained')
      }
      const properties = schema.properties || {}
      const keys = Object.keys(properties)
      if (!root && !keys.length && schema.additionalProperties !== false) {
        throw strictSchemaError(path, 'Open-ended objects cannot be schema-constrained')
      }
      const required = schema.required || []
      out.type = 'object'
      out.properties = {}
      out.required = keys.slice()
      out.additionalProperties = false
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const child = strictNode(properties[key], path + '.properties.' + key, false)
        setOwn(out.properties, key, required.indexOf(key) >= 0 || acceptsNull(properties[key]) ? child : nullableSchema(child))
      }
    } else if (type === 'array') {
      if (!schema.items) throw strictSchemaError(path + '.items', 'Array items must be defined for schema-constrained generation')
      out.type = 'array'
      out.items = strictNode(schema.items, path + '.items', false)
    } else if (type) {
      out.type = type
    }
    return nullable && !pureNull ? nullableSchema(out) : out
  }

  function strictObjectUnion(schema, path) {
    const baseTypes = schemaTypes(schema.type)
    if (baseTypes.length && !hasType(baseTypes, 'object')) throw strictSchemaError(path + '.oneOf', 'oneOf Tool alternatives must be objects')
    const branches = schema.oneOf.map(function (branch, index) {
      return strictNode(mergeObjectAlternative(schema, branch, path + '.oneOf[' + index + ']'), path + '.oneOf[' + index + ']', false)
    })
    const keys = []
    for (let i = 0; i < branches.length; i++) {
      if (branches[i].type !== 'object') throw strictSchemaError(path + '.oneOf[' + i + ']', 'oneOf Tool alternatives must be objects')
      const branchKeys = Object.keys(branches[i].properties || {})
      for (let j = 0; j < branchKeys.length; j++) if (keys.indexOf(branchKeys[j]) < 0) keys.push(branchKeys[j])
    }
    for (let k = 0; k < branches.length; k++) {
      for (let m = 0; m < keys.length; m++) {
        if (!Object.prototype.hasOwnProperty.call(branches[k].properties, keys[m])) setOwn(branches[k].properties, keys[m], { type: 'null' })
      }
      branches[k].required = keys.slice()
      branches[k].additionalProperties = false
    }
    const out = { type: 'object', properties: {}, required: keys.slice(), additionalProperties: false, anyOf: branches }
    copyStrictAnnotations(schema, out)
    for (let n = 0; n < keys.length; n++) {
      const alternatives = uniqueSchemas(branches.map(function (branch) { return branch.properties[keys[n]] }))
      setOwn(out.properties, keys[n], alternatives.length === 1 ? alternatives[0] : { anyOf: alternatives })
    }
    return out
  }

  function mergeObjectAlternative(base, branch, path) {
    const branchTypes = schemaTypes(branch.type)
    if (branchTypes.length && !hasType(branchTypes, 'object')) throw strictSchemaError(path, 'oneOf Tool alternatives must be objects')
    const out = Object.assign({}, branch, {
      type: 'object',
      properties: mergeProperties(base.properties, branch.properties),
      required: uniqueStrings((base.required || []).concat(branch.required || [])),
      additionalProperties: false,
    })
    delete out.oneOf
    return out
  }

  function uniqueStrings(values) {
    const out = []
    for (let i = 0; i < values.length; i++) if (out.indexOf(values[i]) < 0) out.push(values[i])
    return out
  }

  function uniqueSchemas(values) {
    const out = []
    const seen = {}
    for (let i = 0; i < values.length; i++) {
      const key = JSON.stringify(values[i])
      if (seen[key]) continue
      seen[key] = true
      out.push(values[i])
    }
    return out
  }

  function restoreStrictTool(value, schema) {
    return restoreStrictNode(value, normalize(schema))
  }

  function restoreStrictNode(value, schema) {
    if (value == null) return value
    if (schema.oneOf) {
      const strict = strictObjectUnion(schema, 'schema')
      for (let i = 0; i < schema.oneOf.length; i++) {
        if (!validate(value, strict.anyOf[i]).valid) continue
        return restoreStrictNode(value, mergeObjectAlternative(schema, schema.oneOf[i], 'schema.oneOf[' + i + ']'))
      }
    }
    if (schema.anyOf) {
      for (let i = 0; i < schema.anyOf.length; i++) {
        const strict = strictNode(schema.anyOf[i], 'schema.anyOf[' + i + ']', false)
        if (validate(value, strict).valid) return restoreStrictNode(value, schema.anyOf[i])
      }
    }
    const types = schemaTypes(schema.type)
    if (hasType(types, 'array') && Array.isArray(value) && schema.items) {
      return value.map(function (item) { return restoreStrictNode(item, schema.items) })
    }
    if (hasType(types, 'object') && isObject(value)) {
      const out = {}
      const properties = schema.properties || {}
      const required = schema.required || []
      const keys = Object.keys(value)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        const child = Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null
        if (child && value[key] === null && required.indexOf(key) < 0 && !acceptsNull(child)) continue
        if (!child && value[key] === null) continue
        setOwn(out, key, child ? restoreStrictNode(value[key], child) : value[key])
      }
      return out
    }
    return value
  }

  function nullableSchema(schema) {
    if (schema.type && typeof schema.type === 'string') {
      const out = Object.assign({}, schema)
      out.type = [schema.type, 'null']
      if (out.enum && out.enum.indexOf(null) < 0) out.enum = out.enum.concat([null])
      return out
    }
    return { anyOf: [schema, { type: 'null' }] }
  }

  function acceptsNull(schema) {
    const errors = []
    validateNode(null, schema, '$', errors)
    return !errors.length
  }

  function copyStrictAnnotations(source, target) {
    if (source.title != null) target.title = source.title
    if (source.description != null) target.description = source.description
  }

  function copyStrictConstraints(source, target, path) {
    const keys = ['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems']
    for (let i = 0; i < keys.length; i++) if (source[keys[i]] != null) target[keys[i]] = source[keys[i]]
    if (source.uniqueItems) throw strictSchemaError(path + '.uniqueItems', 'uniqueItems is not supported by the portable strict Tool schema')
  }

  function assertStrictKeywords(schema, path) {
    const allowed = {
      type: true, enum: true, const: true, required: true, properties: true, additionalProperties: true,
      items: true, anyOf: true, oneOf: true, allOf: true, not: true, pattern: true,
      minLength: true, maxLength: true, minimum: true, maximum: true,
      exclusiveMinimum: true, exclusiveMaximum: true, minItems: true, maxItems: true,
      uniqueItems: true, title: true, description: true, default: true,
    }
    const keys = Object.keys(schema)
    for (let i = 0; i < keys.length; i++) {
      if (!allowed[keys[i]]) throw strictSchemaError(path + '.' + keys[i], 'Unsupported JSON Schema keyword for strict Tool generation')
    }
  }

  function strictSchemaError(path, message) {
    return schemaError('TOOL_SCHEMA_STRICT_UNSUPPORTED', path, message)
  }

  function unwrapJsonFence(text) {
    const source = String(text == null ? '' : text).trim()
    const match = source.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
    return match ? match[1].trim() : source
  }

  function validateNode(value, schema, path, errors) {
    if (schema.anyOf) {
      validateUnion(value, schema.anyOf, path, errors, 'anyOf')
    }
    if (schema.oneOf) {
      validateUnion(value, schema.oneOf, path, errors, 'oneOf')
    }
    if (schema.allOf) {
      for (let i = 0; i < schema.allOf.length; i++) validateNode(value, schema.allOf[i], path, errors)
    }
    if (schema.not && matchesCount(value, [schema.not])) addError(errors, path, 'Value matches a forbidden schema', 'not')
    if (Object.prototype.hasOwnProperty.call(schema, 'const') && !sameValue(value, schema.const)) addError(errors, path, 'Value does not match const', 'const')
    if (schema.enum && !schema.enum.some(function (item) { return sameValue(value, item) })) addError(errors, path, 'Value is not in enum', 'enum')
    const types = schemaTypes(schema.type)
    if (types.length && !types.some(function (type) { return matchesType(value, type) })) {
      addError(errors, path, 'Expected ' + types.join(' or '), 'type')
      return
    }
    if (value == null) return
    if (typeof value === 'string') validateString(value, schema, path, errors)
    if (typeof value === 'number') validateNumber(value, schema, path, errors)
    if (Array.isArray(value)) validateArray(value, schema, path, errors)
    if (isObject(value)) validateObject(value, schema, path, errors)
  }

  function validateUnion(value, schemas, path, errors, keyword) {
    const results = schemas.map(function (branch) {
      const branchErrors = []
      validateNode(value, branch, path, branchErrors)
      return branchErrors
    })
    const matches = results.filter(function (branchErrors) { return !branchErrors.length }).length
    if (keyword === 'anyOf' && matches) return
    if (keyword === 'oneOf' && matches === 1) return
    if (keyword === 'oneOf' && matches > 1) {
      addError(errors, path, 'Value matches multiple oneOf branches', 'oneOf')
      return
    }
    const branchIndex = discriminatedBranch(value, schemas)
    if (branchIndex >= 0) {
      for (let i = 0; i < results[branchIndex].length; i++) errors.push(results[branchIndex][i])
      return
    }
    addError(errors, path, keyword === 'oneOf' ? 'Value does not match any oneOf branch' : 'Value does not match any allowed schema', keyword)
  }

  function discriminatedBranch(value, schemas) {
    if (!isObject(value)) return -1
    const keys = Object.keys(schemas[0].properties || {})
    for (let i = 0; i < keys.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, keys[i])) continue
      const literals = []
      let complete = true
      for (let j = 0; j < schemas.length; j++) {
        const properties = schemas[j].properties
        const property = properties && Object.prototype.hasOwnProperty.call(properties, keys[i]) ? properties[keys[i]] : null
        const literal = discriminatorLiteral(property)
        if (!literal) {
          complete = false
          break
        }
        literals.push(literal.value)
      }
      if (!complete || !uniqueValues(literals)) continue
      for (let k = 0; k < literals.length; k++) if (sameValue(value[keys[i]], literals[k])) return k
    }
    return -1
  }

  function discriminatorLiteral(schema) {
    if (!schema) return null
    if (Object.prototype.hasOwnProperty.call(schema, 'const')) return { value: schema.const }
    if (schema.enum && schema.enum.length === 1) return { value: schema.enum[0] }
    return null
  }

  function uniqueValues(values) {
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) if (sameValue(values[i], values[j])) return false
    }
    return true
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
    if (schema.minLength != null && value.length < schema.minLength) addError(errors, path, 'String is shorter than minLength', 'minLength')
    if (schema.maxLength != null && value.length > schema.maxLength) addError(errors, path, 'String is longer than maxLength', 'maxLength')
    if (schema.pattern != null && !(new RegExp(schema.pattern).test(value))) addError(errors, path, 'String does not match pattern', 'pattern')
  }

  function validateNumber(value, schema, path, errors) {
    if (schema.minimum != null && value < schema.minimum) addError(errors, path, 'Number is below minimum', 'minimum')
    if (schema.maximum != null && value > schema.maximum) addError(errors, path, 'Number is above maximum', 'maximum')
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) addError(errors, path, 'Number is not above exclusiveMinimum', 'exclusiveMinimum')
    if (schema.exclusiveMaximum != null && value >= schema.exclusiveMaximum) addError(errors, path, 'Number is not below exclusiveMaximum', 'exclusiveMaximum')
  }

  function validateArray(value, schema, path, errors) {
    if (schema.minItems != null && value.length < schema.minItems) addError(errors, path, 'Array has fewer than minItems', 'minItems')
    if (schema.maxItems != null && value.length > schema.maxItems) addError(errors, path, 'Array has more than maxItems', 'maxItems')
    if (schema.uniqueItems) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) if (sameValue(value[i], value[j])) addError(errors, path, 'Array items must be unique', 'uniqueItems')
      }
    }
    if (schema.items) for (let k = 0; k < value.length; k++) validateNode(value[k], schema.items, path + '[' + k + ']', errors)
  }

  function validateObject(value, schema, path, errors) {
    const properties = schema.properties || {}
    const required = schema.required || []
    for (let i = 0; i < required.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, required[i])) addError(errors, path + '.' + required[i], 'Required property is missing', 'required')
    }
    const keys = Object.keys(value)
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j]
      if (Object.prototype.hasOwnProperty.call(properties, key)) validateNode(value[key], properties[key], path + '.' + key, errors)
      else if (schema.additionalProperties === false) addError(errors, path + '.' + key, 'Additional property is not allowed', 'additionalProperties')
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
  function setOwn(target, key, value) {
    Object.defineProperty(target, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  function mergeProperties() {
    const out = {}
    for (let i = 0; i < arguments.length; i++) {
      const source = arguments[i] || {}
      const keys = Object.keys(source)
      for (let j = 0; j < keys.length; j++) setOwn(out, keys[j], source[keys[j]])
    }
    return out
  }
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
  function bestError(errors) {
    let best = null
    let bestScore = -Infinity
    for (let i = 0; i < errors.length; i++) {
      const error = errors[i]
      const score = errorScore(error)
      if (score > bestScore) {
        best = error
        bestScore = score
      }
    }
    return best
  }

  function errorScore(error) {
    const weak = error.keyword === 'oneOf' || error.keyword === 'anyOf' ? -1000 : 0
    const depth = (String(error.path || '').match(/\.|\[/g) || []).length * 10
    const priority = {
      required: 9,
      enum: 8,
      const: 8,
      minItems: 7,
      maxItems: 7,
      type: 6,
      additionalProperties: 5,
    }[error.keyword] || 0
    return weak + depth + priority
  }

  function addError(errors, path, message, keyword) { errors.push({ path: path, message: message, keyword: keyword }) }
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
    strictTool: strictTool,
    restoreStrictTool: restoreStrictTool,
  }
})(window.aiditor = window.aiditor || {})

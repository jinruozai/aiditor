// aiditor.inspector — ordered selection + provider registry for generic inspectors.
;(function (aiditor) {
  'use strict'

  const providers = {}
  const providerMeta = {}
  const selectionSig = aiditor.signal([])
  const metaSig = aiditor.signal({})
  const schemaUtil = aiditor.ui.schema
  let formulaEvaluator = null

  function cloneTargets(targets) {
    if (targets == null) return []
    const list = Array.isArray(targets) ? targets : [targets]
    return list.filter(Boolean)
  }

  function targetType(target) {
    return target && (target.type || target.kind)
  }

  /**
   * @aiditorApi aiditor.inspector.registerProvider
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.registerProvider(type, provider, meta?)
   * @summary Register the editor-owned provider that turns selected targets of one type into an inspector schema, values, and write handlers.
   * @param {string} type - Target type matched against target.type or target.kind.
   * @param {object} provider - Provider with inspect(targets, ctx), plus optional accept(targets).
   * @param {object} meta - Optional owner/layer metadata; pass { replace: true } only when intentionally replacing an existing provider.
   * @returns {Function} unregister callback.
   * @example
   * aiditor.inspector.registerProvider('cube', {
   *   inspect: function (targets) {
   *     return {
   *       schema: {
   *         x: { type: 'number', label: 'X', step: 0.1 },
   *         color: { type: 'color', label: 'Color' },
   *       },
   *       values: targets.map(function (target) { return target.value }),
   *       write: function (field, change, ctx) {
   *         ctx.targets.forEach(function (target, index) {
   *           target.value = ctx.applyChange(target.value, change, ctx.schema)
   *         })
   *       },
   *     }
   *   },
   * })
   * @wrong
   * aiditor.inspector.registerProvider({
   *   id: 'cube',
   *   getProperties: function () {},
   *   patchProperties: function () {},
   * })
   * @related aiditor.inspector.select,aiditor.inspector.refresh,aiditor.ui.propertyForm
   */
  function registerProvider(type, provider, meta) {
    if (!type || typeof type !== 'string') throw new Error('inspector.registerProvider: type is required')
    if (!provider || typeof provider.inspect !== 'function') throw new Error('inspector.registerProvider: provider.inspect is required')
    const m = aiditor.runtime && aiditor.runtime.registrationMeta ? aiditor.runtime.registrationMeta(meta) : (meta || {})
    if (providers[type] && !m.replace) throw new Error('inspector.registerProvider: duplicate provider "' + type + '"')
    providers[type] = provider
    providerMeta[type] = Object.assign({}, m)
    return function () { unregisterProvider(type, { owner: m.owner }) }
  }

  function unregisterProvider(type, meta) {
    const m = meta || {}
    if (!providers[type]) return false
    if (m.owner && providerMeta[type] && providerMeta[type].owner !== m.owner) {
      throw new Error('inspector.unregisterProvider: owner mismatch for "' + type + '"')
    }
    delete providers[type]
    delete providerMeta[type]
    return true
  }

  function unregisterOwner(owner) {
    const removed = []
    Object.keys(providerMeta).forEach(function (type) {
      if (providerMeta[type].owner === owner) {
        unregisterProvider(type, { owner: owner })
        removed.push(type)
      }
    })
    return removed
  }

  function providerFor(targets) {
    const list = cloneTargets(targets)
    if (!list.length) return null
    const primaryType = targetType(list[0])
    if (!primaryType) return null
    const provider = providers[primaryType]
    if (!provider) return null
    if (typeof provider.accept === 'function') {
      return safe('accept', primaryType, function () { return provider.accept(list) }) ? provider : null
    }
    for (let i = 1; i < list.length; i++) {
      if (targetType(list[i]) !== primaryType) return null
    }
    return provider
  }

  function inspect(targets, ctx) {
    const list = cloneTargets(targets)
    const provider = providerFor(list)
    if (!provider) return null
    const type = targetType(list[0])
    const raw = safe('inspect', type, function () { return provider.inspect(list, Object.assign({
      targets: list,
      primary: list[0],
      valueForChange: valueForChange,
      applyChange: applyChange,
      pathChange: pathChange,
    }, ctx || {})) })
    if (!raw) return null
    const out = Object.assign({}, raw)
    out.provider = provider
    out.type = type
    out.targets = list
    out.values = valuesFor(out, list)
    return out
  }

  function valuesFor(inspection, targets) {
    if (inspection.values) return inspection.values
    if (typeof inspection.read === 'function') {
      return targets.map(function (target, index) { return inspection.read(target, index, targets) })
    }
    return targets.map(function (target) { return target.value || target.data || target })
  }

  function hasField(inspection, field, value, index) {
    if (typeof inspection.hasField === 'function') {
      return !!safe('hasField', inspection.type, function () {
        return inspection.hasField(inspection.targets[index], field, value, index)
      })
    }
    return !!value && Object.prototype.hasOwnProperty.call(value, field)
  }

  function canWrite(inspection, field, value, index, rawField) {
    if (inspection.readonly || !inspection.write) return false
    if (rawField && rawField.disabled === true) return false
    if (typeof inspection.canWrite === 'function') {
      return !!safe('canWrite', inspection.type, function () {
        return inspection.canWrite(inspection.targets[index], field, value, index)
      })
    }
    return true
  }

  function safe(action, type, fn) {
    const source = { scope: 'inspector', action: action, type: type }
    return aiditor.safeCall ? aiditor.safeCall(source, fn) : fn()
  }

  function canEditField(inspection, field, values, rawField) {
    const list = values || []
    if (!list.length) return false
    for (let i = 0; i < list.length; i++) {
      if (!hasField(inspection, field, list[i], i)) return false
      if (!canWrite(inspection, field, list[i], i, rawField)) return false
    }
    return true
  }

  /**
   * @aiditorApi aiditor.inspector.literalChange
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.literalChange(field, value)
   * @summary Create a whole-field replacement change for providers that intentionally replace a complete top-level field value.
   * @param {string} field - Top-level schema field name.
   * @param {*} value - Replacement value for that field.
   * @returns {object} Change object with mode "literal".
   * @example
   * const change = aiditor.inspector.literalChange('transform', [[0, 1, 2], 1])
   * @related aiditor.inspector.pathChange,aiditor.inspector.applyChange
   */
  function literalChange(field, value) {
    return { field: field, mode: 'literal', value: value }
  }

  /**
   * @aiditorApi aiditor.inspector.pathChange
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.pathChange(fieldPath, value)
   * @summary Create a leaf-level inspector change whose field is a dotted/bracketed schema path such as transform.pos.x or items[2].name.
   * @param {string} fieldPath - Schema path. Field keys are path tokens; keys containing "." or "[]" are invalid schema usage.
   * @param {*} value - Leaf replacement value.
   * @returns {object} Change object with mode "path".
   * @example
   * const change = aiditor.inspector.pathChange('transform.pos.x', 12)
   * @related aiditor.inspector.applyChange,aiditor.inspector.formatFieldPath
   */
  function pathChange(field, value) {
    return { field: field, mode: 'path', value: value }
  }

  function valueForChange(change, target, index, ctx) {
    if (!change || change.mode === 'literal' || change.mode === 'path') return change ? change.value : undefined
    if (change.mode === 'formula' && formulaEvaluator) return formulaEvaluator(change, target, index, ctx || {})
    throw new Error('inspector.valueForChange: unsupported change mode "' + change.mode + '"')
  }

  /**
   * @aiditorApi aiditor.inspector.applyChange
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.applyChange(value, change, schema)
   * @summary Apply a literal or path inspector change to a schema-encoded value without mutating the original value.
   * @param {*} value - Current top-level inspected value.
   * @param {object} change - Change created by pathChange or literalChange.
   * @param {object} schema - PropertyForm/Inspector schema used to preserve struct tuple, array, and dict encoding.
   * @returns {*} Updated value.
   * @example
   * const next = aiditor.inspector.applyChange(
   *   current,
   *   aiditor.inspector.pathChange('transform.pos.x', 12),
   *   schema
   * )
   * @related aiditor.inspector.pathChange,aiditor.inspector.literalChange
   */
  function applyChange(value, change, schema) {
    if (!change) return value
    if (change.mode !== 'literal' && change.mode !== 'path') {
      throw new Error('inspector.applyChange: unsupported change mode "' + change.mode + '"')
    }
    const segments = parseFieldPath(change.field)
    return writeRootPath(value, segments, change.value, schema || {})
  }

  /**
   * @aiditorApi aiditor.inspector.parseFieldPath
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.parseFieldPath(fieldPath)
   * @summary Parse an inspector field path into string and numeric segments.
   * @param {string} fieldPath - Path such as "items[2].transform.pos.x".
   * @returns {Array} Path segments.
   * @example
   * aiditor.inspector.parseFieldPath('items[2].name')
   * // ['items', 2, 'name']
   * @related aiditor.inspector.formatFieldPath,aiditor.inspector.pathChange
   */
  function parseFieldPath(field) {
    const text = String(field == null ? '' : field)
    const out = []
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      if (ch === '.') { i++; continue }
      if (ch === '[') {
        const end = findBracketEnd(text, i)
        const body = text.slice(i + 1, end)
        if (body[0] === '"') out.push(JSON.parse(body))
        else if (/^\d+$/.test(body)) out.push(Number(body))
        else throw new Error('inspector.parseFieldPath: invalid segment "' + body + '"')
        i = end + 1
        continue
      }
      let j = i
      while (j < text.length && text[j] !== '.' && text[j] !== '[') j++
      out.push(text.slice(i, j))
      i = j
    }
    return out
  }

  function findBracketEnd(text, start) {
    let quote = ''
    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i]
      if (quote) {
        if (ch === '\\') { i++; continue }
        if (ch === quote) quote = ''
        continue
      }
      if (ch === '"' || ch === "'") { quote = ch; continue }
      if (ch === ']') return i
    }
    throw new Error('inspector.parseFieldPath: invalid path "' + text + '"')
  }

  /**
   * @aiditorApi aiditor.inspector.formatFieldPath
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.formatFieldPath(segments)
   * @summary Format string and numeric path segments into the inspector field path syntax.
   * @param {Array} segments - String field names and numeric array indices.
   * @returns {string} Formatted field path.
   * @example
   * aiditor.inspector.formatFieldPath(['items', 2, 'name'])
   * // 'items[2].name'
   * @related aiditor.inspector.parseFieldPath,aiditor.inspector.pathChange
   */
  function formatFieldPath(segments) {
    const arr = Array.isArray(segments) ? segments : []
    let out = ''
    for (let i = 0; i < arr.length; i++) {
      const seg = arr[i]
      if (typeof seg === 'number') {
        out += '[' + seg + ']'
      } else if (isIdentifier(seg)) {
        out += (out ? '.' : '') + seg
      } else {
        out += '[' + JSON.stringify(String(seg)) + ']'
      }
    }
    return out
  }

  function writeRootPath(value, segments, nextValue, schema) {
    if (!segments.length) return nextValue
    const key = segments[0]
    const rest = segments.slice(1)
    const next = cloneObject(value)
    next[key] = writeFieldPath(value && value[key], rest, nextValue, schema && schema[key])
    return next
  }

  function writeFieldPath(value, segments, nextValue, fieldDef) {
    if (!segments.length) return nextValue
    const fd = resolveFieldDef(fieldDef)
    if (schemaUtil.isStructField(fd)) return writeStructPath(value, segments, nextValue, fd)
    if (schemaUtil.isArrayField(fd)) return writeArrayPath(value, segments, nextValue, fd)
    if (schemaUtil.isDictField(fd)) return writeDictPath(value, segments, nextValue, fd)
    return writeGenericPath(value, segments, nextValue)
  }

  function writeStructPath(value, segments, nextValue, fieldDef) {
    const def = schemaUtil.normalizeStructDef(fieldDef && fieldDef.struct_def) || {}
    const keys = Object.keys(def || {})
    const key = segments[0]
    const index = keys.indexOf(String(key))
    if (index < 0) return writeGenericPath(value, segments, nextValue)
    const rawSub = def[key]
    const subFd = resolveFieldDef(typeof rawSub === 'string' ? { type: rawSub } : rawSub)
    const tuple = Array.isArray(value) ? value : []
    const len = Math.max(tuple.length, index + 1)
    const next = new Array(len)
    for (let i = 0; i < len; i++) next[i] = i < tuple.length ? tuple[i] : schemaUtil.cloneDefault(resolveFieldDef(typeof def[keys[i]] === 'string' ? { type: def[keys[i]] } : def[keys[i]]))
    next[index] = writeFieldPath(index < tuple.length ? tuple[index] : schemaUtil.cloneDefault(subFd), segments.slice(1), nextValue, subFd)
    return next
  }

  function writeArrayPath(value, segments, nextValue, fieldDef) {
    const index = Number(segments[0])
    const elemFd = schemaUtil.resolveArrayElemFieldDef(fieldDef)
    const arr = Array.isArray(value) ? value : []
    const len = Math.max(arr.length, index + 1)
    const next = new Array(len)
    for (let i = 0; i < len; i++) next[i] = i < arr.length ? arr[i] : schemaUtil.cloneDefault(elemFd)
    next[index] = writeFieldPath(index < arr.length ? arr[index] : schemaUtil.cloneDefault(elemFd), segments.slice(1), nextValue, elemFd)
    return next
  }

  function writeDictPath(value, segments, nextValue, fieldDef) {
    const key = String(segments[0])
    const valueFd = schemaUtil.resolveDictValueFieldDef(fieldDef)
    const dict = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const next = Object.assign({}, dict)
    next[key] = writeFieldPath(dict[key], segments.slice(1), nextValue, valueFd)
    return next
  }

  function writeGenericPath(value, segments, nextValue) {
    if (!segments.length) return nextValue
    const key = segments[0]
    if (typeof key === 'number') {
      const arr = Array.isArray(value) ? value : []
      const len = Math.max(arr.length, key + 1)
      const next = new Array(len)
      for (let i = 0; i < len; i++) next[i] = i < arr.length ? arr[i] : undefined
      next[key] = writeGenericPath(arr[key], segments.slice(1), nextValue)
      return next
    }
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const next = Object.assign({}, obj)
    next[key] = writeGenericPath(obj[key], segments.slice(1), nextValue)
    return next
  }

  function resolveFieldDef(fieldDef) {
    return schemaUtil.resolveFieldDef(fieldDef)
  }

  function cloneObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.assign({}, value) : {}
  }

  function isIdentifier(value) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value))
  }

  function emitSelection() {
    if (aiditor.bus && aiditor.bus.emit) aiditor.bus.emit('inspector:selection', selectionSig.peek())
  }

  /**
   * @aiditorApi aiditor.inspector.select
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.select(targets, meta?)
   * @summary Set the ordered inspector selection. The first target is primary; multi-edit uses only fields present and writable on every target.
   * @param {object|object[]} targets - One target or ordered targets; each target should include type or kind.
   * @param {object} meta - Optional selection metadata for the host/editor.
   * @returns {void} No return value.
   * @example
   * aiditor.inspector.select([
   *   { type: 'cube', id: 'cube-1', value: cubeState },
   * ])
   * @related aiditor.inspector.registerProvider,aiditor.inspector.refresh
   */
  function select(targets, meta) {
    selectionSig.set(cloneTargets(targets))
    metaSig.set(meta || {})
    emitSelection()
  }

  /**
   * @aiditorApi aiditor.inspector.refresh
   * @group inspector
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.inspector.refresh()
   * @summary Notify inspector panels to re-read the current selection after external state changes.
   * @returns {void} No return value.
   * @example
   * cubeState.color = '#ffcc00'
   * aiditor.inspector.refresh()
   * @related aiditor.inspector.select,aiditor.inspector.registerProvider
   */
  function refresh() {
    selectionSig.set(selectionSig.peek().slice())
    emitSelection()
  }

  function clear() {
    select([], {})
  }

  aiditor.inspector = {
    selection: selectionSig,
    meta: metaSig,
    select: select,
    refresh: refresh,
    clear: clear,
    registerProvider: registerProvider,
    unregisterProvider: unregisterProvider,
    unregisterOwner: unregisterOwner,
    providerFor: providerFor,
    inspect: inspect,
    listProviders: function () { return Object.keys(providers).sort() },
    providerMeta: function (type) { return Object.assign({}, providerMeta[type] || {}) },
    canEditField: canEditField,
    literalChange: literalChange,
    pathChange: pathChange,
    parseFieldPath: parseFieldPath,
    formatFieldPath: formatFieldPath,
    applyChange: applyChange,
    valueForChange: valueForChange,
    setFormulaEvaluator: function (fn) { formulaEvaluator = fn || null },
  }
  if (aiditor.runtime && aiditor.runtime.registerOwnerCleanup) {
    aiditor.runtime.registerOwnerCleanup(function (owner) {
      return { inspector: unregisterOwner(owner) }
    })
  }
})(window.aiditor = window.aiditor || {})

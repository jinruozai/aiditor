// aiditor.ai Reference / Operation protocol.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const TOOL_META = { owner: 'aiditor.ai.reference', layer: 'builtin', source: 'builtin' }
  const referenceProviders = {}
  const referenceProviderMeta = {}
  const operations = {}
  const operationMeta = {}
  const previews = {}
  let transactionDriver = null
  let nextPreviewId = 1

  function clone(value) {
    return value == null ? value : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(value) : JSON.parse(JSON.stringify(value)))
  }

  function keys(obj) { return Object.keys(obj) }

  function inferResolver(uri, kind) {
    const text = String(uri || '')
    if (text === 'aiditor://api' || text.indexOf('aiditor://api/') === 0) return 'api'
    if (text === 'aiditor://skills' || text.indexOf('aiditor://skills/') === 0) return 'skills'
    if (text === 'aiditor://host' || text.indexOf('aiditor://host/') === 0) return 'editor'
    const idx = text.indexOf('://')
    if (idx > 0) return text.slice(0, idx)
    const dot = String(kind || '').indexOf('.')
    return dot > 0 ? String(kind).slice(0, dot) : (kind || 'reference')
  }

  function normalizeReference(ref) {
    if (!ref) return null
    if (typeof ref === 'string') ref = { uri: ref }
    const uri = String(ref.uri || ref.id || '')
    if (!uri) return null
    const kind = ref.kind || ref.type || inferResolver(uri, ref.kind)
    return {
      resolver: ref.resolver || inferResolver(uri, kind),
      uri: uri,
      kind: kind,
      title: ref.title || ref.label || uri,
      summary: ref.summary || '',
      meta: clone(ref.meta || {}),
      schema: clone(ref.schema || null),
      capabilities: clone(ref.capabilities || []),
    }
  }

  function normalizeReferences(value) {
    if (!value) return []
    const list = Array.isArray(value) ? value : [value]
    const out = []
    for (let i = 0; i < list.length; i++) {
      const ref = normalizeReference(list[i])
      if (ref) out.push(ref)
    }
    return out
  }

  function providerFor(ref) {
    const r = normalizeReference(ref)
    return r ? referenceProviders[r.resolver] || null : null
  }

  function withRefContext(ctx) {
    return Object.assign({ ai: ai, actor: 'user' }, ctx || {})
  }

  function safeProviderCall(ref, name, args, ctx) {
    const provider = providerFor(ref)
    const fn = provider && provider[name]
    if (!fn) return null
    return fn.apply(provider, args.concat([withRefContext(ctx)]))
  }

  function normalizeMeta(kind, meta) {
    if (aiditor.runtime && aiditor.runtime.registrationMeta) meta = aiditor.runtime.registrationMeta(meta)
    meta = meta || {}
    if (meta.owner == null || String(meta.owner) === '') throw new Error(kind + '.register: owner is required')
    const out = { owner: String(meta.owner) }
    if (meta.layer != null) out.layer = String(meta.layer)
    return out
  }

  const matchesPrefix = aiditor.names.matchesPrefix

  function canReplace(meta) {
    return !!(meta && meta.replace === true)
  }

  function assertFree(kind, records, name, meta) {
    if (records[name] && !canReplace(meta))
      throw new Error(kind + '.register: duplicate name "' + name + '"')
  }

  function registerReferenceProvider(name, provider, meta) {
    const normalizedMeta = normalizeMeta('ai.references', meta)
    assertFree('ai.references', referenceProviders, name, meta)
    if (referenceProviders[name] && referenceProviderMeta[name].owner !== normalizedMeta.owner)
      throw new Error('ai.references.register: owner mismatch for "' + name + '"')
    referenceProviders[name] = Object.assign({ id: name }, provider || {})
    referenceProviderMeta[name] = normalizedMeta
    return referenceProviders[name]
  }

  function getReferenceProvider(name) {
    return referenceProviders[name] || null
  }

  function unregisterReferenceProvider(name, meta) {
    if (!referenceProviders[name]) return false
    const normalizedMeta = normalizeMeta('ai.references', meta)
    const existing = referenceProviderMeta[name] || {}
    if (existing.owner !== normalizedMeta.owner)
      throw new Error('unregisterReferenceProvider: owner mismatch for "' + name + '"')
    delete referenceProviders[name]
    delete referenceProviderMeta[name]
    return true
  }

  function unregisterReferenceProviderOwner(owner) {
    const removed = []
    keys(referenceProviderMeta).forEach(function (name) {
      if (referenceProviderMeta[name].owner === owner) {
        delete referenceProviders[name]
        delete referenceProviderMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function describeReference(ref, ctx) {
    const r = normalizeReference(ref)
    if (!r) return null
    const described = safeProviderCall(r, 'describe', [r], ctx)
    return described == null ? r : described
  }

  function readReference(ref, options, ctx) {
    const r = normalizeReference(ref)
    if (!r) return null
    const providerRead = safeProviderCall(r, 'read', [r, options || {}], ctx)
    if (providerRead != null) return providerRead
    return r
  }

  function referencePermissionTargets(ref, ctx) {
    const r = normalizeReference(ref)
    const provider = providerFor(r)
    const meta = r && referenceProviderMeta[r.resolver] || {}
    if (provider && provider.permissionTargets) {
      const projected = aiditor.safeCall
        ? aiditor.safeCall({ scope: 'ai.reference', resolver: r.resolver, method: 'permissionTargets' }, function () { return provider.permissionTargets(r, withRefContext(ctx)) })
        : provider.permissionTargets(r, withRefContext(ctx))
      if (projected == null) return [{
        entry: 'reference:' + r.resolver,
        target: r.uri,
        origin: meta.owner || meta.layer || 'builtin',
        risk: 'read',
        unavailable: true,
      }]
      return Array.isArray(projected) ? projected : [projected]
    }
    return [{
      entry: 'reference:' + r.resolver,
      target: r.uri,
      origin: meta.owner || meta.layer || 'builtin',
      risk: 'read',
    }]
  }

  function referenceSchema(ref, ctx) {
    const r = normalizeReference(ref)
    if (!r) return null
    const schema = safeProviderCall(r, 'schema', [r], ctx)
    return schema != null ? schema : r.schema
  }

  function referenceCapabilities(ref, ctx) {
    const r = normalizeReference(ref)
    if (!r) return []
    const caps = safeProviderCall(r, 'capabilities', [r], ctx)
    return caps != null ? caps : (r.capabilities || [])
  }

  function snapshotReference(ref, ctx) {
    const r = normalizeReference(ref)
    if (!r) return null
    return safeProviderCall(r, 'snapshot', [r], ctx)
  }

  function searchReferences(query, ctx) {
    const out = []
    const names = keys(referenceProviders)
    for (let i = 0; i < names.length; i++) {
      const provider = referenceProviders[names[i]]
      if (!provider.search) continue
      const found = provider.search(query || {}, withRefContext(ctx)) || []
      const refs = normalizeReferences(found)
      for (let j = 0; j < refs.length; j++) out.push(refs[j])
    }
    return out
  }

  function selectedReferences(ctx) {
    const out = []
    const names = keys(referenceProviders)
    for (let i = 0; i < names.length; i++) {
      const provider = referenceProviders[names[i]]
      if (!provider.selection) continue
      const refs = normalizeReferences(provider.selection(withRefContext(ctx)))
      for (let j = 0; j < refs.length; j++) out.push(refs[j])
    }
    return out
  }

  function registerOperation(name, spec, meta) {
    const normalizedMeta = normalizeMeta('ai.operations', meta)
    assertFree('ai.operations', operations, name, meta)
    if (operations[name] && operationMeta[name].owner !== normalizedMeta.owner)
      throw new Error('ai.operations.register: owner mismatch for "' + name + '"')
    const normalized = Object.assign({ id: name }, spec || {})
    if (normalized.schema != null)
      throw new Error('ai.operations.register: use inputSchema instead of schema for "' + name + '"')
    if (normalized.inputSchema != null)
      normalized.inputSchema = ai.schema.normalize(normalized.inputSchema, 'operation.' + name + '.inputSchema')
    if (normalized.exposeToModel === true && !normalized.inputSchema)
      throw new Error('ai.operations.register: model-visible operation requires inputSchema for "' + name + '"')
    if (normalized.exposeToModel === true && typeof (normalized.preview || normalized.plan || normalized.run) !== 'function')
      throw new Error('ai.operations.register: model-visible operation requires preview for "' + name + '"')
    if (normalized.exposeToModel === true && typeof normalized.apply !== 'function')
      throw new Error('ai.operations.register: model-visible operation requires apply for "' + name + '"')
    if (normalized.permissionTargets != null && typeof normalized.permissionTargets !== 'function')
      throw new Error('ai.operations.register: permissionTargets must be a function for "' + name + '"')
    operations[name] = normalized
    operationMeta[name] = normalizedMeta
    return operations[name]
  }

  function getOperation(name) {
    return operations[name] || null
  }

  function unregisterOperation(name, meta) {
    if (!operations[name]) return false
    const normalizedMeta = normalizeMeta('ai.operations', meta)
    const existing = operationMeta[name] || {}
    if (existing.owner !== normalizedMeta.owner)
      throw new Error('unregisterOperation: owner mismatch for "' + name + '"')
    delete operations[name]
    delete operationMeta[name]
    return true
  }

  function unregisterOperationOwner(owner) {
    const removed = []
    keys(operationMeta).forEach(function (name) {
      if (operationMeta[name].owner === owner) {
        delete operations[name]
        delete operationMeta[name]
        removed.push(name)
      }
    })
    return removed
  }

  function operationRisk(op, input, ctx) {
    const spec = getOperation(op)
    if (!spec) return 'edit'
    if (typeof spec.risk === 'function') return spec.risk(input === undefined ? {} : input, withOperationContext(op, ctx))
    return spec.risk || 'edit'
  }

  function permissionRisk(value) {
    if (value === 'destructive' || value === 'delete') return 'delete'
    if (value === 'external' || value === 'network') return 'network'
    if (value === 'execute' || value === 'install') return value
    return value === 'read' ? 'read' : 'write'
  }

  function operationPermissionTargets(op, input, ctx, phase) {
    const spec = getOperation(op)
    const meta = operationMeta[op] || {}
    const base = {
      entry: op,
      target: op,
      origin: meta.owner || meta.layer || 'builtin',
      risk: phase === 'apply' ? permissionRisk(operationRisk(op, input, ctx)) : 'read',
    }
    if (!spec || !spec.permissionTargets) return [base]
    const projected = aiditor.safeCall
      ? aiditor.safeCall({ scope: 'ai.operation', operation: op, method: 'permissionTargets' }, function () { return spec.permissionTargets(input || {}, withOperationContext(op, ctx), phase) })
      : spec.permissionTargets(input || {}, withOperationContext(op, ctx), phase)
    if (projected == null) return [Object.assign({}, base, { unavailable: true })]
    const values = Array.isArray(projected) ? projected : [projected]
    return values.map(function (value) {
      if (typeof value === 'string') return Object.assign({}, base, { target: value })
      return Object.assign({}, base, value || {})
    })
  }

  function makePreviewId() {
    return 'opv_' + Date.now().toString(36) + '_' + nextPreviewId++
  }

  function normalizePreview(op, input, raw, ctx) {
    const obj = raw && typeof raw === 'object' ? raw : { result: raw }
    const id = obj.id || makePreviewId()
    const risk = obj.risk || operationRisk(op, input, ctx)
    const preview = Object.assign({}, obj, {
      id: id,
      op: op,
      input: clone(input === undefined ? {} : input),
      ok: obj.ok !== false,
      risk: risk,
      title: obj.title || (getOperation(op) && getOperation(op).title) || op,
      summary: obj.summary || '',
      createdAt: obj.createdAt || Date.now(),
    })
    previews[id] = preview
    return preview
  }

  function runTransaction(label, fn, meta) {
    if (transactionDriver && typeof transactionDriver.run === 'function') {
      return transactionDriver.run(label || 'AI operation', fn, meta || {})
    }
    return fn()
  }

  function withOperationContext(op, ctx) {
    return Object.assign({
      ai: ai,
      actor: 'user',
      op: op,
      transaction: runTransaction,
      readReference: readReference,
      schema: referenceSchema,
      capabilities: referenceCapabilities,
    }, ctx || {})
  }

  function previewOperation(opOrSpec, inputArg, ctx) {
    const specInput = typeof opOrSpec === 'object' && opOrSpec
      ? opOrSpec
      : { op: opOrSpec, input: inputArg }
    const op = specInput.op || specInput.operation
    const input = Object.prototype.hasOwnProperty.call(specInput, 'input')
      ? specInput.input
      : (Object.prototype.hasOwnProperty.call(specInput, 'args') ? specInput.args : {})
    const spec = getOperation(op)
    if (!spec) throw new Error('Operation not found: ' + op)
    const fn = spec.preview || spec.plan || spec.run
    if (!fn) throw new Error('Operation has no preview: ' + op)
    if (spec.inputSchema) {
      const validation = ai.schema.validate(input, spec.inputSchema)
      if (!validation.valid) {
        const errors = validation.errors.map(function (item) {
          return {
            code: 'SCHEMA_VALUE_INVALID',
            path: item.path,
            message: item.message,
          }
        })
        return normalizePreview(op, input, {
          ok: false,
          code: 'OPERATION_INPUT_INVALID',
          error: 'Operation input does not match inputSchema',
          errors: errors,
        }, ctx)
      }
    }
    const raw = fn(input, withOperationContext(op, ctx))
    return normalizePreview(op, input, raw, ctx)
  }

  function operationVisibleToModel(op, ctx) {
    const spec = getOperation(op)
    if (!spec) return false
    if (spec.exposeToModel !== true) return false
    if (typeof spec.available === 'function' && spec.available(withOperationContext(op, ctx)) === false) return false
    return true
  }

  function modelOperationNames(ctx) {
    return keys(operations).filter(function (name) {
      return operationVisibleToModel(name, ctx)
    }).sort()
  }

  function operationSchemaBranch(name) {
    const spec = getOperation(name)
    return {
      type: 'object',
      required: ['op', 'input'],
      additionalProperties: false,
      properties: {
        op: {
          type: 'string',
          enum: [name],
          description: spec.description || spec.title || name,
        },
        input: clone(spec.inputSchema),
      },
    }
  }

  function operationGatewaySchema(ctx, includePreviewId) {
    const variants = modelOperationNames(ctx).map(operationSchemaBranch)
    if (includePreviewId) {
      variants.unshift({
        type: 'object',
        required: ['previewId'],
        additionalProperties: false,
        properties: {
          previewId: { type: 'string', description: 'A preview id returned by aiditor.previewOperation.' },
        },
      })
    }
    if (!variants.length) {
      return {
        type: 'object',
        properties: {},
        additionalProperties: false,
        description: 'No editor operations are available in the current request context.',
      }
    }
    return { type: 'object', oneOf: variants }
  }

  function operationModelSpecs(ctx) {
    const out = []
    const names = modelOperationNames(ctx)
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const spec = getOperation(name)
      out.push({
        id: name,
        title: spec.title || name,
        description: spec.description || ('Preview, review, and apply editor operation "' + name + '".'),
        schema: clone(spec.inputSchema),
        route: {
          inputKey: 'input',
          args: { op: name },
        },
      })
    }
    return out
  }

  function operationGatewayError(code, message, op, ctx, details) {
    return Object.assign({
      ok: false,
      code: code,
      error: message,
      op: op || null,
      allowedValues: modelOperationNames(ctx),
    }, details || {})
  }

  function unavailableOperationResult(args, ctx) {
    const op = args && args.op
    if (!op) return operationGatewayError('OPERATION_REQUIRED', 'Operation id is required', null, ctx)
    if (!getOperation(op)) return operationGatewayError('OPERATION_NOT_FOUND', 'Operation is not registered: ' + op, op, ctx)
    if (!operationVisibleToModel(op, ctx)) return operationGatewayError('OPERATION_NOT_AVAILABLE', 'Operation is not available in the current request context: ' + op, op, ctx)
    return null
  }

  function resolvePreview(spec) {
    if (!spec) return null
    if (typeof spec === 'string') return previews[spec] || null
    if (spec.previewId) return previews[spec.previewId] || null
    if (spec.id && previews[spec.id]) return previews[spec.id]
    return spec
  }

  function applyOperation(previewOrSpec, ctx) {
    let preview = resolvePreview(previewOrSpec)
    if (!preview && previewOrSpec && (previewOrSpec.op || previewOrSpec.operation)) {
      preview = previewOperation(previewOrSpec, null, ctx)
    }
    if (!preview) throw new Error('Operation preview not found')
    if (preview.ok === false) return { applied: false, ok: false, error: 'Preview is not valid', preview: preview }
    const op = preview.op || preview.operation
    const spec = getOperation(op)
    if (!spec || !spec.apply) throw new Error('Operation has no apply: ' + op)
    const opCtx = withOperationContext(op, ctx)
    const apply = function () { return spec.apply(preview, opCtx) }
    const result = spec.transaction === false
      ? apply()
      : runTransaction(preview.title || op, apply, { source: 'aiditor.ai', op: op, previewId: preview.id, risk: preview.risk })
    if (result && typeof result === 'object') return Object.assign({ applied: true, previewId: preview.id }, result)
    return { applied: true, previewId: preview.id, result: result }
  }

  function configureTransactions(driver) {
    transactionDriver = driver || null
    return transactionDriver
  }

  function registerEditorTools() {
    ai.tools.register('aiditor.readReference', {
      title: 'Read Editor Reference',
      description: 'Read a referenced editor object. Use this before editing so schemas, values, and summaries are grounded in the host editor.',
      schema: {
        type: 'object',
        required: ['uri'],
        properties: {
          uri: { type: 'string' },
          kind: { type: 'string' },
          projection: { type: 'string' },
          page: { type: 'object' },
        },
      },
      run: function (args, ctx) {
        return readReference(args, args, ctx)
      },
      permissionTargets: function (args, ctx) { return referencePermissionTargets(args, ctx) },
      isConcurrencySafe: function () { return true },
    }, TOOL_META)
    ai.tools.register('aiditor.searchReferences', {
      title: 'Search Editor References',
      description: 'Search host-provided editor references by query and optional kind.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          kind: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      run: function (args, ctx) {
        return searchReferences(args || {}, ctx)
      },
      permissionTargets: function (args) {
        return { target: 'references:' + (args && args.kind || '*'), risk: 'read' }
      },
      isConcurrencySafe: function () { return true },
    }, TOOL_META)
    ai.tools.register('aiditor.getSelection', {
      title: 'Get Editor Selection',
      description: 'Return current host editor selection as references.',
      schema: { type: 'object', properties: {} },
      run: function (args, ctx) {
        return selectedReferences(ctx)
      },
      permissionTargets: function () { return { target: 'selection', risk: 'read' } },
      isConcurrencySafe: function () { return true },
    }, TOOL_META)
    ai.tools.register('aiditor.getCapabilities', {
      title: 'Get Reference Capabilities',
      description: 'Return schemas and operations available for a reference.',
      schema: {
        type: 'object',
        required: ['uri'],
        properties: {
          uri: { type: 'string' },
          kind: { type: 'string' },
        },
      },
      run: function (args, ctx) {
        const ref = normalizeReference(args)
        return {
          ref: ref,
          schema: referenceSchema(ref, ctx),
          capabilities: referenceCapabilities(ref, ctx),
        }
      },
      permissionTargets: function (args, ctx) { return referencePermissionTargets(args, ctx) },
      isConcurrencySafe: function () { return true },
    }, TOOL_META)
    ai.tools.register('aiditor.previewOperation', {
      title: 'Preview Editor Operation',
      description: 'Preview a registered editor operation. Never apply invalid previews; repair input from returned validation errors.',
      exposeToModel: false,
      schema: { type: 'object', properties: {}, additionalProperties: false },
      resolveSchema: function (ctx) { return operationGatewaySchema(ctx, false) },
      resolveModelSpecs: function () { return [] },
      available: function (ctx) { return modelOperationNames(ctx).length > 0 },
      permissionTargets: function (args, ctx, phase) {
        return operationPermissionTargets(args && args.op, args && args.input, ctx, phase)
      },
      run: function (args, ctx) {
        const unavailable = unavailableOperationResult(args, ctx)
        if (unavailable) return unavailable
        return previewOperation(args, null, ctx)
      },
    }, TOOL_META)
    ai.tools.register('aiditor.applyOperation', {
      title: 'Apply Editor Operation',
      description: 'Preview and apply a registered editor operation through the host transaction bridge.',
      exposeToModel: false,
      schema: { type: 'object', properties: {}, additionalProperties: false },
      resolveSchema: function (ctx) { return operationGatewaySchema(ctx, true) },
      resolveModelSpecs: function (ctx) { return operationModelSpecs(ctx) },
      permissionTargets: function (args, ctx, phase) {
        const preview = args && args.previewId && previews[args.previewId]
        return operationPermissionTargets(preview && preview.op || args && args.op, preview && preview.input || args && args.input, ctx, phase)
      },
      preview: function (args, ctx) {
        if (args && args.previewId && previews[args.previewId]) {
          const resolved = previews[args.previewId]
          if (!operationVisibleToModel(resolved.op, ctx)) {
            return operationGatewayError('OPERATION_NOT_AVAILABLE', 'Operation is not available in the current request context: ' + resolved.op, resolved.op, ctx, { previewId: args.previewId })
          }
          return resolved
        }
        if (args && args.previewId) {
          return operationGatewayError('OPERATION_PREVIEW_NOT_FOUND', 'Operation preview not found: ' + args.previewId, null, ctx, { previewId: args.previewId })
        }
        const unavailable = unavailableOperationResult(args, ctx)
        if (unavailable) return unavailable
        return previewOperation(args, null, ctx)
      },
      apply: function (preview, ctx) {
        if (preview && preview.ok === false) return { applied: false, ok: false, error: preview.error || 'Preview is not valid', preview: preview }
        const op = preview && (preview.op || preview.operation)
        if (!operationVisibleToModel(op, ctx)) {
          return Object.assign({ applied: false, preview: preview }, operationGatewayError('OPERATION_NOT_AVAILABLE', 'Operation is not available in the current request context: ' + op, op, ctx))
        }
        return applyOperation(preview, ctx)
      },
    }, TOOL_META)
  }

  ai.references = {
    register: registerReferenceProvider,
    unregister: unregisterReferenceProvider,
    unregisterOwner: unregisterReferenceProviderOwner,
    get: getReferenceProvider,
    list: function (filter) {
      const names = keys(referenceProviders)
      if (typeof filter === 'string') return names.filter(function (name) { return matchesPrefix(name, filter) })
      if (!filter) return names
      return names.filter(function (name) {
        const meta = referenceProviderMeta[name] || {}
        if (filter.owner != null && meta.owner !== filter.owner) return false
        if (filter.layer != null && meta.layer !== filter.layer) return false
        return true
      })
    },
    meta: function (name) { return clone(referenceProviderMeta[name] || {}) },
    normalize: normalizeReference,
    normalizeAll: normalizeReferences,
    describe: describeReference,
    read: readReference,
    permissionTargets: referencePermissionTargets,
    schema: referenceSchema,
    capabilities: referenceCapabilities,
    snapshot: snapshotReference,
    search: searchReferences,
    selection: selectedReferences,
  }
  ai.operations = {
    register: registerOperation,
    unregister: unregisterOperation,
    unregisterOwner: unregisterOperationOwner,
    get: getOperation,
    list: function (filter) {
      const names = keys(operations)
      if (typeof filter === 'string') return names.filter(function (name) { return matchesPrefix(name, filter) })
      if (!filter) return names
      return names.filter(function (name) {
        const meta = operationMeta[name] || {}
        if (filter.owner != null && meta.owner !== filter.owner) return false
        if (filter.layer != null && meta.layer !== filter.layer) return false
        return true
      })
    },
    meta: function (name) { return clone(operationMeta[name] || {}) },
    risk: operationRisk,
    permissionTargets: operationPermissionTargets,
    preview: previewOperation,
    apply: applyOperation,
    getPreview: function (id) { return previews[id] || null },
  }
  ai.transactions = {
    configure: configureTransactions,
    run: runTransaction,
  }
  if (aiditor.runtime && aiditor.runtime.registerOwnerCleanup) {
    aiditor.runtime.registerOwnerCleanup(function (owner) {
      return {
        references: unregisterReferenceProviderOwner(owner),
        operations: unregisterOperationOwner(owner),
      }
    })
  }

  registerEditorTools()
})(window.aiditor = window.aiditor || {})

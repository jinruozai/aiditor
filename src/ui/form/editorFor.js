// aiditor.ui.editorFor — FieldDef → editor-element dispatcher.
//
//   aiditor.ui.editorFor(fieldDef, value, onChange, [ctx]) → HTMLElement
//     fieldDef: FieldDef (raw or already-resolved TypeDef)
//     value   : current value (plain) OR a signal — plain values are wrapped
//     onChange: (nv, meta?) => void   callback invoked when the picked renderer commits
//     ctx?    : free-form context forwarded to the renderer (opaque to us)
//
// The renderer is resolved by FieldDef.type_render against the registry
// (ui.registerRenderer / ui.getRenderer). Built-in renderers registered here
// are thin adapters between a ResolvedFieldDef + sig and a ui.* primitive;
// they do NOT touch ctx. Domain-specific behavior (cross-table navigation on
// ref_id, project file import, …) belongs in caller-registered overrides.
//
// Each renderer receives { fieldDef, sig, write, ctx } and returns an
// HTMLElement. Built-ins: input_string | textarea | input_int | input_float
// | range | enum | toggle | color | vector | date | filepath | img | snd | id
// | ref_id | struct | array | array_editor.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}
  const schema = ui.schema

  function editorFor(fieldDef, value, onChange, ctx) {
    const resolved = fieldDef && fieldDef._resolved
      ? fieldDef
      : ui.resolveFieldDef(fieldDef || {})
    if (resolved) resolved._resolved = true

    const sig = ui.isSignal(value) ? value : aiditor.signal(value)
    const write = function (nv, meta) {
      const outMeta = meta && meta.change ? meta : changeMeta(ctx, nv, meta)
      if (typeof onChange === 'function') onChange(nv, outMeta)
      else if (typeof sig.set === 'function') sig.set(nv)
    }

    const kind = (resolved && resolved.type_render) || 'input_string'
    const fn = ui.getRenderer(kind) || ui.getRenderer('input_string')
    return fn({ fieldDef: resolved, sig: sig, write: write, ctx: ctx || {} })
  }

  ui.editorFor = editorFor

  // ── Built-in renderers ───────────────────────────────────────
  function asPlain(v) { return ui.isSignal(v) ? v.peek() : v }

  ui.registerRenderer('input_string', function (a) {
    const agv = a.fieldDef.type_agv || {}
    if (a.fieldDef.commit === 'blur') {
      const local = aiditor.signal(asPlain(a.sig))
      const el = ui.input({
        value: local,
        onChange: function (v) { local.set(v) },
        onCommit: a.write,
        type: agv.password ? 'password' : 'text',
      })
      ui.collect(el, aiditor.effect(function () { local.set(asPlain(a.sig)) }))
      return el
    }
    return ui.input({ value: a.sig, onChange: a.write, type: agv.password ? 'password' : 'text' })
  })
  ui.registerRenderer('textarea', function (a) {
    return ui.textarea({ value: a.sig, onChange: a.write })
  })

  // Numeric renderers need a finite-number view. numberInput's bind effects
  // run a clamp on every mount; clamp(undefined) = NaN and NaN !== undefined
  // would trigger a spurious feedback write. Tap through a coerced signal.
  function toNumOr(v, fb) { const n = Number(v); return Number.isFinite(n) ? n : fb }
  function asNumericSig(sig, fallback) {
    const fb  = fallback != null ? fallback : 0
    const tap = aiditor.signal(toNumOr(asPlain(sig), fb))
    tap.dispose = aiditor.effect(function () { tap.set(toNumOr(sig(), fb)) })
    return tap
  }

  function collectSignal(el, sig) {
    if (sig && sig.dispose) ui.collect(el, sig.dispose)
    return el
  }

  ui.registerRenderer('input_int', function (a) {
    const agv = a.fieldDef.type_agv || {}
    const sig = asNumericSig(a.sig)
    return collectSignal(ui.numberInput({
      value: sig, onChange: a.write,
      step: 1, precision: 0,
      radix: agv.radix || 'dec',
    }), sig)
  })
  ui.registerRenderer('input_float', function (a) {
    const agv = a.fieldDef.type_agv || {}
    const sig = asNumericSig(a.sig)
    return collectSignal(ui.numberInput({
      value: sig, onChange: a.write,
      step: agv.step != null ? agv.step : 0.01,
      precision: agv.decimal_places,
      percent: !!agv.percent,
    }), sig)
  })
  ui.registerRenderer('range', function (a) {
    const agv   = a.fieldDef.type_agv || {}
    const isInt = a.fieldDef.base_type === 'int'
    const min   = agv.min != null ? agv.min : 0
    const sig = asNumericSig(a.sig, min)
    return collectSignal(ui.slider({
      value: sig,
      onChange: function (v, meta) { a.write(isInt ? Math.trunc(v) : v, meta) },
      min: min,
      max: agv.max != null ? agv.max : 100,
      step: agv.step != null ? agv.step : (isInt ? 1 : 0.01),
      showValue: true,
    }), sig)
  })
  ui.registerRenderer('enum', function (a) {
    const agv   = a.fieldDef.type_agv || {}
    const isInt = a.fieldDef.base_type === 'int'
    return ui.select({
      value: a.sig,
      onChange: function (v) { a.write(isInt ? Number(v) : v) },
      options: normEnumOptions(agv.options),
    })
  })
  ui.registerRenderer('toggle', function (a) {
    const isInt  = a.fieldDef.base_type === 'int'
    const shimSig = aiditor.signal(!!asPlain(a.sig))
    shimSig.dispose = aiditor.effect(function () { shimSig.set(!!a.sig()) })
    return collectSignal(ui.switch({
      value: shimSig,
      onChange: function (v) { a.write(isInt ? (v ? 1 : 0) : !!v) },
    }), shimSig)
  })
  ui.registerRenderer('color', function (a) {
    const agv = a.fieldDef.type_agv || {}
    return ui.colorInput({
      value:     a.sig,
      onChange:  a.write,
      valueKind: agv.valueKind || (a.fieldDef.base_type === 'int' ? 'int' : 'hex'),
      valueScale: agv.valueScale,
    })
  })
  ui.registerRenderer('vector', function (a) {
    const agv = a.fieldDef.type_agv || {}
    const fields = vectorFields(a.fieldDef)
    const sig = asVectorSig(a.sig, fields)
    return collectSignal(ui.vectorInput({
      value: sig,
      onChange: function (next, meta) { a.write(next, meta) },
      labels: fields.map(function (f) { return f.key.toUpperCase() }),
      layout: agv.layout || 'row',
      step: agv.step != null ? agv.step : 0.01,
      precision: agv.decimal_places != null ? agv.decimal_places : 2,
      linked: agv.linked,
    }), sig)
  })
  ui.registerRenderer('date', function (a) {
    return ui.dateInput({ value: a.sig, onChange: a.write })
  })

  function filePathEditor(a, defaults) {
    const agv = a.fieldDef.type_agv || {}
    const fileKind = agv.kind || defaults.kind
    const accept = agv.accept || defaults.accept
    return ui.filePathInput({
      value:       a.sig,
      onChange:    a.write,
      kind:        fileKind,
      accept:      accept,
      placeholder: agv.placeholder || agv.suffix || '',
      resolveSrc:  a.ctx && a.ctx.resolveFileSrc,
      exists:      a.ctx && a.ctx.filePathExists,
      onBrowse:    a.ctx && a.ctx.onBrowseFile,
      onFile:      a.ctx && a.ctx.onFile,
      actions: function (inputCtx) {
        const fn = a.ctx && a.ctx.filePathActions
        if (typeof fn === 'function') return fn(filePathActionCtx(a, inputCtx, fileKind, accept))
        return Array.isArray(agv.actions) ? agv.actions : []
      },
    })
  }
  ui.registerRenderer('filepath', function (a) {
    return filePathEditor(a, { kind: 'file', accept: '' })
  })
  ui.registerRenderer('img', function (a) {
    return filePathEditor(a, { kind: 'image', accept: '.png,.jpg,.jpeg,.gif,.webp' })
  })
  ui.registerRenderer('snd', function (a) {
    return filePathEditor(a, { kind: 'audio', accept: '.mp3,.wav,.ogg' })
  })
  ui.registerRenderer('id', function (a) {
    return ui.input({ value: a.sig, readOnly: true })
  })
  ui.registerRenderer('ref_id', function (a) {
    // Default ref_id: plain int input, no cross-table jump. Apps that know
    // about table topology should override this renderer.
    return ui.numberInput({ value: a.sig, onChange: a.write, step: 1, precision: 0 })
  })

  // ── struct / array: delegate to the general-purpose ui.* components.
  ui.registerRenderer('struct', function (a) {
    const def = schema.normalizeStructDef(a.fieldDef.struct_def)
    if (!def) {
      const err = ui.h('div', 'aiditor-ui-struct-input', { text: '(invalid struct_def)' })
      return err
    }
    const fields = Object.keys(def).map(function (fname) {
      const raw     = def[fname]
      const rawObj  = typeof raw === 'string' ? { type: raw } : raw
      const subFd   = ui.resolveFieldDef(typeof raw === 'string' ? { type: raw } : raw)
      const labeled = (subFd && subFd.name && subFd.name !== subFd.base_type) ? subFd.name : fname
      return {
        key:    fname,
        fieldDef: subFd,
        group: rawObj && rawObj.group,
        label:  rawObj && Object.prototype.hasOwnProperty.call(rawObj, 'label') ? rawObj.label : labeled,
        labelMode: rawObj && rawObj.labelMode,
        fieldLayout: rawObj && rawObj.fieldLayout,
        defaultCollapsed: rawObj && rawObj.defaultCollapsed,
        collapsed: rawObj && rawObj.collapsed,
        onToggle: rawObj && rawObj.onToggle,
        visibleWhen: rawObj && rawObj.visibleWhen,
        searchText: [schema.fieldSearchText(fname, rawObj), subFd && subFd.name, subFd && subFd.desc],
        searchDescendants: schema.descendantSearchText(rawObj),
        actions: rawObj && rawObj.actions,
        messages: messagesForContext(withFieldPath(a.ctx, fname)),
        editor: function (sig, write, ctx) { return editorFor(subFd, sig, write, withFieldPath(ctx, fname)) },
      }
    })
    const projection = aiditor.derived(function () {
      return tupleToRecord(a.sig(), fields)
    })
    const el = ui.structInput({
      value: projection,
      fields: fields,
      groups: a.fieldDef.groups || {},
      searchQuery: a.ctx && a.ctx.searchQuery,
      searchAncestorMatch: a.ctx && a.ctx.searchAncestorMatch,
      foldingState: a.ctx && a.ctx.foldingState,
      foldingScope: a.ctx && a.ctx.foldingScope,
      fieldPath: readFieldPath(a.ctx) || '',
      onChange: function (_nextRecord, key, nv, meta) {
        const next = writeTupleMember(asPlain(a.sig), fields, key, nv)
        if (next) a.write(next, meta)
      },
      ctx: a.ctx,
    })
    ui.collect(el, projection.dispose)
    return el
  })

  ui.registerRenderer('array', function (a) {
    const agv      = a.fieldDef.type_agv || {}
    const elemFd   = schema.resolveArrayElemFieldDef(a.fieldDef, agv)
    return ui.arrayInput({
      value:        a.sig,
      itemLayout:   arrayItemLayout(agv, elemFd),
      defaultCollapsed: agv.defaultCollapsed,
      editor:       function (sig, write, ctx, index, rowCtx) {
        return editorFor(elemFd, sig, write, withFieldPath(ctx, function () { return rowCtx ? rowCtx.index : index }))
      },
      createItem: arrayItemFactory(agv, elemFd),
      canAdd: agv.canAdd,
      onChange: a.write,
      ctx:      a.ctx,
    })
  })

  ui.registerRenderer('array_editor', function (a) {
    const agv      = a.fieldDef.type_agv || {}
    const elemFd   = schema.resolveArrayElemFieldDef(a.fieldDef, agv)
    const hasKey   = typeof agv.getKey === 'function'
    return ui.arrayEditor({
      items:         a.sig,
      onChange:      a.write,
      getKey:        hasKey ? agv.getKey : null,
      selectionMode: agv.selectionMode || (hasKey ? 'single' : 'none'),
      indexMode:     agv.indexMode || 'number-handle',
      density:       agv.density || 'compact',
      actions:       agv.actions || 'end',
      itemLayout:    arrayItemLayout(agv, elemFd),
      defaultCollapsed: agv.defaultCollapsed,
      capabilities:  agv.capabilities || null,
      createItem: arrayItemFactory(agv, elemFd),
      canAdd: agv.canAdd,
      duplicateItem: function (item) { return cloneItem(item) },
      renderItem: function (_, __, rowCtx) {
        return editorFor(elemFd, rowCtx.value, rowCtx.writeItem, withFieldPath(a.ctx, function () { return rowCtx.index }))
      },
      emptyText: agv.emptyText || 'No items',
      ctx: a.ctx,
    })
  })

  ui.registerRenderer('dict', function (a) {
    const agv = a.fieldDef.type_agv || {}
    const valueFd = schema.resolveDictValueFieldDef(a.fieldDef, agv)
    return ui.dictInput({
      value: a.sig,
      onChange: a.write,
      valueType: valueFd,
      defaultValue: cloneDefault(valueFd),
      createValue: function () { return cloneDefault(valueFd) },
      renderValue: function (sig, write, ctx) {
        return editorFor(valueFd, sig, write, withFieldPath(a.ctx, function () {
          return ctx && typeof ctx.keyRef === 'function' ? ctx.keyRef() : ctx && ctx.key
        }))
      },
      ctx: a.ctx,
    })
  })

  // ── helpers ──────────────────────────────────────────────────
  function normEnumOptions(opts) {
    if (!opts) return []
    if (Array.isArray(opts)) {
      return opts.map(function (o) {
        if (o == null) return null
        if (typeof o === 'object') return { value: o.value, label: o.label != null ? o.label : String(o.value) }
        return { value: o, label: String(o) }
      }).filter(Boolean)
    }
    return Object.keys(opts).map(function (k) {
      const raw = opts[k]
      if (raw && typeof raw === 'object') return { value: k, label: raw.label || raw.value || k }
      return { value: k, label: String(raw) }
    })
  }

  function cloneDefault(fieldDef) {
    return fieldDef && fieldDef.default !== undefined
      ? schema.cloneValue(fieldDef.default)
      : null
  }

  function arrayItemFactory(agv, fieldDef) {
    return typeof agv.createItem === 'function'
      ? agv.createItem
      : function () { return cloneDefault(fieldDef) }
  }

  function arrayItemLayout(agv, fieldDef) {
    if (agv.itemLayout != null) return agv.itemLayout
    return schema.isStructField(fieldDef) || schema.isDictField(fieldDef) || schema.isArrayField(fieldDef)
      ? 'section'
      : 'inline'
  }

  function cloneItem(item) {
    return schema.cloneValue(item)
  }

  function vectorFields(fieldDef) {
    const def = schema.normalizeStructDef(fieldDef && fieldDef.struct_def)
    if (!def) return [{ key: 'x' }, { key: 'y' }, { key: 'z' }]
    return Object.keys(def).map(function (key) {
      return { key: key, fieldDef: ui.resolveFieldDef(typeof def[key] === 'string' ? { type: def[key] } : def[key]) }
    })
  }

  function asVectorSig(sig, fields) {
    const tap = aiditor.signal(vectorTuple(asPlain(sig), fields))
    tap.dispose = aiditor.effect(function () {
      const next = vectorTuple(sig(), fields)
      if (!equalArray(tap.peek(), next)) tap.set(next)
    })
    return tap
  }

  function vectorTuple(value, fields) {
    const tuple = Array.isArray(value) ? value : []
    const out = new Array(fields.length)
    for (let i = 0; i < fields.length; i++) {
      const raw = i < tuple.length ? tuple[i] : cloneFieldDefault(fields[i].fieldDef)
      const n = Number(raw)
      out[i] = Number.isFinite(n) ? n : 0
    }
    return out
  }

  function equalArray(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
    return true
  }

  function tupleToRecord(value, fields) {
    const tuple = Array.isArray(value) ? value : []
    const out = {}
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      out[f.key] = i < tuple.length ? tuple[i] : cloneFieldDefault(f.fieldDef)
    }
    return out
  }

  function writeTupleMember(value, fields, key, nv) {
    const tuple = Array.isArray(value) ? value : []
    let target = -1
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].key === key) { target = i; break }
    }
    if (target < 0) return null
    const current = target < tuple.length ? tuple[target] : cloneFieldDefault(fields[target].fieldDef)
    if (Object.is(current, nv)) return null
    const nextLen = Math.max(tuple.length, target + 1)
    const next = new Array(nextLen)
    for (let i = 0; i < nextLen; i++) {
      next[i] = i < tuple.length ? tuple[i] : cloneFieldDefault(fields[i] && fields[i].fieldDef)
    }
    next[target] = nv
    return next
  }

  function cloneFieldDefault(fieldDef) {
    return schema.cloneDefault(fieldDef)
  }

  function changeMeta(ctx, value, meta) {
    const fieldPath = readFieldPath(ctx)
    if (!fieldPath) return meta
    const change = aiditor.inspector && aiditor.inspector.pathChange
      ? aiditor.inspector.pathChange(fieldPath, value)
      : { field: fieldPath, mode: 'path', value: value }
    return Object.assign({}, meta || {}, { change: change })
  }

  function filePathActionCtx(a, inputCtx, kind, accept) {
    const path = readFieldPath(a.ctx)
    return Object.assign({}, inputCtx || {}, {
      field: a.ctx && a.ctx.field || path || '',
      fieldPath: path || '',
      label: a.ctx && a.ctx.label || path || '',
      rawField: a.ctx && a.ctx.rawField || a.fieldDef,
      resolvedField: a.ctx && a.ctx.resolvedField || a.fieldDef,
      value: inputCtx && inputCtx.value,
      directory: inputCtx && inputCtx.directory,
      kind: kind,
      accept: accept,
      ctx: a.ctx || {},
    })
  }

  function withFieldPath(ctx, segment) {
    const base = ctx || {}
    const next = Object.assign({}, base)
    next.fieldPath = function () {
      return appendFieldPath(readFieldPath(base), typeof segment === 'function' ? segment() : segment)
    }
    return next
  }

  function readFieldPath(ctx) {
    const path = ctx && ctx.fieldPath
    return typeof path === 'function' ? path() : path
  }

  function messagesForContext(ctx) {
    const source = ctx && ctx.fieldMessages
    if (!ui.isSignal(source)) return null
    return aiditor.derived(function () {
      const map = source() || {}
      return map[readFieldPath(ctx)] || []
    })
  }

  function appendFieldPath(base, segment) {
    const parts = []
    if (base) {
      if (aiditor.inspector && aiditor.inspector.parseFieldPath) parts.push.apply(parts, aiditor.inspector.parseFieldPath(base))
      else return fallbackAppendPath(base, segment)
    }
    parts.push(segment)
    if (aiditor.inspector && aiditor.inspector.formatFieldPath) return aiditor.inspector.formatFieldPath(parts)
    return fallbackFormatPath(parts)
  }

  function fallbackAppendPath(base, segment) {
    return String(base || '') + fallbackFormatSegment(segment, true)
  }

  function fallbackFormatPath(segments) {
    let out = ''
    for (let i = 0; i < segments.length; i++) {
      out += fallbackFormatSegment(segments[i], !!out)
    }
    return out
  }

  function fallbackFormatSegment(segment, hasBase) {
    if (typeof segment === 'number') return '[' + segment + ']'
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(segment))) return (hasBase ? '.' : '') + segment
    return '[' + JSON.stringify(String(segment)) + ']'
  }

})(window.aiditor = window.aiditor || {})

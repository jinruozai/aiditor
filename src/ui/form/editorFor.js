// aiditor.ui.editorFor — FieldDef → editor-element dispatcher.
//
//   aiditor.ui.editorFor(fieldDef, value, onChange, [ctx]) → HTMLElement
//     fieldDef: FieldDef (raw or already-resolved TypeDef)
//     value   : current value (plain) OR a signal — plain values are wrapped
//     onChange: (nv) => void   callback invoked when the picked renderer commits
//     ctx?    : free-form context forwarded to the renderer (opaque to us)
//
// The renderer is resolved by FieldDef.type_render against the registry
// (ui.registerRenderer / ui.getRenderer). Built-in renderers registered here
// are thin adapters between a ResolvedFieldDef + sig and a ui.* primitive;
// they do NOT touch ctx. Domain-specific behavior (cross-table navigation on
// ref_id, custom asset pickers, …) belongs in caller-registered overrides.
//
// Each renderer receives { fieldDef, sig, write, ctx } and returns an
// HTMLElement. Built-ins: input_string | textarea | input_int | input_float
// | range | enum | toggle | color | date | img | snd | id | ref_id | struct
// | array | array_editor.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  function editorFor(fieldDef, value, onChange, ctx) {
    const resolved = fieldDef && fieldDef._resolved
      ? fieldDef
      : ui.resolveFieldDef(fieldDef || {})
    if (resolved) resolved._resolved = true

    const sig = ui.isSignal(value) ? value : aiditor.signal(value)
    const write = function (nv) {
      if (typeof onChange === 'function') onChange(nv)
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
      onChange: function (v) { a.write(isInt ? Math.trunc(v) : v) },
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
    })
  })
  ui.registerRenderer('date', function (a) {
    return ui.dateInput({ value: a.sig, onChange: a.write })
  })
  ui.registerRenderer('img', function (a) {
    const agv = a.fieldDef.type_agv || {}
    return ui.assetPicker({
      value:       a.sig,
      onChange:    a.write,
      kind:        'image',
      accept:      agv.accept || '.png,.jpg,.jpeg,.gif,.webp',
      placeholder: agv.placeholder || agv.suffix || '',
    })
  })
  ui.registerRenderer('snd', function (a) {
    const agv = a.fieldDef.type_agv || {}
    return ui.assetPicker({
      value:       a.sig,
      onChange:    a.write,
      kind:        'audio',
      accept:      agv.accept || '.mp3,.wav,.ogg',
      placeholder: agv.placeholder || agv.suffix || '',
    })
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
    const def = normalizeStructDef(a.fieldDef.struct_def)
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
        label:  rawObj && Object.prototype.hasOwnProperty.call(rawObj, 'label') ? rawObj.label : labeled,
        labelMode: rawObj && rawObj.labelMode,
        actions: rawObj && rawObj.actions,
        editor: function (sig, write, ctx) { return editorFor(subFd, sig, write, ctx) },
      }
    })
    return ui.structInput({ value: a.sig, fields: fields, onChange: a.write, ctx: a.ctx })
  })

  ui.registerRenderer('array', function (a) {
    const agv      = a.fieldDef.type_agv || {}
    const elemType = agv.elem_type || parseArrayElemType(a.fieldDef.type) || 'string'
    const elemFd   = ui.resolveFieldDef({ type: elemType })
    return ui.arrayInput({
      value:        a.sig,
      editor:       function (sig, write, ctx) { return editorFor(elemFd, sig, write, ctx) },
      defaultValue: function () {
        return elemFd && elemFd.default !== undefined
          ? JSON.parse(JSON.stringify(elemFd.default))
          : null
      },
      onChange: a.write,
      ctx:      a.ctx,
    })
  })

  ui.registerRenderer('array_editor', function (a) {
    const agv      = a.fieldDef.type_agv || {}
    const elemType = agv.elem_type || parseArrayElemType(a.fieldDef.type) || 'string'
    const elemFd   = ui.resolveFieldDef({ type: elemType })
    const hasKey   = typeof agv.getKey === 'function'
    return ui.arrayEditor({
      items:         a.sig,
      onChange:      a.write,
      getKey:        hasKey ? agv.getKey : null,
      selectionMode: agv.selectionMode || (hasKey ? 'single' : 'none'),
      indexMode:     agv.indexMode || 'number-handle',
      density:       agv.density || 'compact',
      actions:       agv.actions || 'end',
      capabilities:  agv.capabilities || null,
      createItem: function () { return cloneDefault(elemFd) },
      duplicateItem: function (item) { return cloneItem(item) },
      renderItem: function (_, __, rowCtx) {
        return editorFor(elemFd, rowCtx.value, rowCtx.writeItem, a.ctx)
      },
      emptyText: agv.emptyText || 'No items',
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

  function parseArrayElemType(typeName) {
    if (typeof typeName !== 'string') return null
    const m = /^array\[(.+)\]$/.exec(typeName)
    return m ? m[1] : null
  }

  function cloneDefault(fieldDef) {
    return fieldDef && fieldDef.default !== undefined
      ? cloneItem(fieldDef.default)
      : null
  }

  function cloneItem(item) {
    if (item == null || typeof item !== 'object') return item
    return JSON.parse(JSON.stringify(item))
  }

  // Accept two struct_def shapes for convenience:
  //   { field1: typeName, field2: typeName }                  (flat)
  //   { wrapperKey: { field1: typeName, field2: typeName } }  (wrapped)
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
})(window.aiditor = window.aiditor || {})

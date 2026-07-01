// aiditor.ui TypeConfig: schema-driven property editing.
//
// TypeConfig is a two-level registry:
//   1. Builtin types        (int, float, string, enum, bool, color, ...)
//   2. Application overlays  (application-specific aliases / variants)
//
// A `FieldDef` references a type by name and optionally refines its
// presentation via `type_agv` (args). Resolution layers the three, with
// the field's own agv winning over overrides over builtin.
//
//   aiditor.ui.setTypeConfig(builtin, { overrides })
//   aiditor.ui.getTypeConfig()                  -> { [name]: TypeDef }
//   aiditor.ui.resolveType(typeName)            -> merged TypeDef or null
//   aiditor.ui.resolveFieldDef(fieldDef)        -> TypeDef + field overrides merged
//   aiditor.ui.registerRenderer(kind, fn)       -> extend the render kind table
//   aiditor.ui.getRenderer(kind)                -> fn or null
//   aiditor.ui.listRenderKinds()                -> [name, ...] (for picker UIs)
//
// See propertyForm.js for consumption.
//
// Data shapes:
//   TypeDef = {
//     name:        string,        // human-readable
//     base_type:   'int'|'float'|'string'|'struct'|'array'|'dict'|'var',
//     type_render: string,        // kind key -> a registered renderer
//     default:     any,
//     mem?:        string,        // tooltip / description
//     type_agv?:   object,        // renderer args (radix/min/max/options/...)
//     struct_def?: object,        // { field: FieldDef | typeName } for struct
//     support_render?: string[],  // optional whitelist the TypeConfig editor
//                                 // uses to populate render-kind dropdowns
//   }
//   FieldDef = {
//     type: string,
//     mem?: string,
//     type_agv?: object,
//     fieldLayout?: 'row'|'block'|'section',
//     defaultCollapsed?: boolean,
//     ...
//   }
//
// The merge in resolveFieldDef is shallow on the top level but DEEP on
// type_agv, so a field that sets `type_agv: { max: 60 }` doesn't erase
// the type's baseline `type_agv: { min: 1 }`.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // Default builtin TypeConfig.
  // Fields not overridden by user's setTypeConfig() fall back to these.
  // These are the types every editor is expected to support out of the box.
  const DEFAULT_BUILTIN = {
    'int':          { name: 'int',     base_type: 'int',    type_render: 'input_int',    default: 0,    mem: 'Standard integer', type_agv: { radix: 'dec' }, support_render: ['input_int','enum','range','toggle','color','id','ref_id'] },
    'float':        { name: 'float',   base_type: 'float',  type_render: 'input_float',  default: 0.0,  mem: 'Standard floating-point number', type_agv: { decimal_places: 2, percent: false }, support_render: ['input_float','range'] },
    'string':       { name: 'string',  base_type: 'string', type_render: 'input_string', default: '',   mem: 'Standard text', support_render: ['input_string','textarea','enum','img','snd','date'] },
    'struct':       { name: 'struct',  base_type: 'struct', type_render: 'struct',       default: [],   mem: 'Composite tuple', support_render: ['struct'] },
    'array':        { name: 'array',   base_type: 'array',  type_render: 'array',        default: [],   mem: 'Ordered list', support_render: ['array','array_editor'] },
    'dict':         { name: 'dict',    base_type: 'dict',   type_render: 'dict',         default: {},   mem: 'Dynamic key-value dictionary', type_agv: { value_type: 'string' }, support_render: ['dict'] },
    'var':          { name: 'var',     base_type: 'var',    type_render: 'input_string', default: null, mem: 'Auto-typed variable', support_render: ['input_string','textarea','input_int','input_float','range','enum','toggle','color','date','img','snd','id','ref_id','struct','array','array_editor','dict'] },

    'enum_int':     { name: 'int',           base_type: 'int',    type_render: 'enum',    default: 0,  mem: 'Integer enumeration',  type_agv: { options: { '0': 'Option 1', '1': 'Option 2' } } },
    'enum_string':  { name: 'string',        base_type: 'string', type_render: 'enum',    default: '', mem: 'String enumeration',   type_agv: { options: {} } },
    'range_int':    { name: 'int',           base_type: 'int',    type_render: 'range',   default: 0,  mem: 'Integer within a range',  type_agv: { min: 0, max: 100, step: 1 } },
    'range_float':  { name: 'float',         base_type: 'float',  type_render: 'range',   default: 0,  mem: 'Float within a range',    type_agv: { min: 0, max: 1, step: 0.01 } },

    'bool':         { name: 'bool',          base_type: 'int',    type_render: 'toggle',  default: 0,  mem: 'Boolean toggle' },
    'percent':      { name: 'percent',       base_type: 'float',  type_render: 'input_float', default: 0, mem: 'Fractional value displayed / parsed as %', type_agv: { decimal_places: 0, percent: true, step: 0.01 } },
    'color':        { name: 'color',         base_type: 'int',    type_render: 'color',   default: 0,  mem: 'Color picker',     type_agv: { valueKind: 'int' } },
    'date':         { name: 'date',          base_type: 'string', type_render: 'date',    default: '', mem: 'ISO date string' },
    'img':          { name: 'img',           base_type: 'string', type_render: 'img',     default: '', mem: 'Image asset',      type_agv: { accept: '.png,.jpg,.jpeg,.gif,.webp' } },
    'snd':          { name: 'snd',           base_type: 'string', type_render: 'snd',     default: '', mem: 'Audio asset',      type_agv: { accept: '.mp3,.wav,.ogg' } },

    'id':           { name: 'id',            base_type: 'int',    type_render: 'id',      default: 0,  mem: 'Unique identifier' },
    'ref_id':       { name: 'refid',         base_type: 'int',    type_render: 'ref_id',  default: 0,  mem: 'Reference to another entity id' },
  }

  // Mutable state.
  let builtin   = Object.assign({}, DEFAULT_BUILTIN)
  let overrides = {}
  // Derived on demand in resolveType().

  function setTypeConfig(nextBuiltin, opts) {
    if (nextBuiltin && typeof nextBuiltin === 'object') {
      builtin = Object.assign({}, DEFAULT_BUILTIN, nextBuiltin)
    }
    if (opts && opts.overrides && typeof opts.overrides === 'object') {
      overrides = Object.assign({}, opts.overrides)
    } else if (opts && opts.overrides === null) {
      overrides = {}
    }
  }

  function setOverrides(tc) {
    overrides = Object.assign({}, tc || {})
  }

  function getTypeConfig() {
    // Merged view. Overrides win per top-level key, but individual fields
    // merge shallowly; an override can add `name`/`mem`/`type_agv`
    // without having to re-declare `base_type`.
    const merged = {}
    Object.keys(builtin).forEach(function (k) { merged[k] = builtin[k] })
    Object.keys(overrides).forEach(function (k) {
      merged[k] = Object.assign({}, builtin[k] || {}, overrides[k])
      const baseAgv = (builtin[k] && builtin[k].type_agv) || null
      const overAgv = overrides[k].type_agv
      if (baseAgv && overAgv) merged[k].type_agv = Object.assign({}, baseAgv, overAgv)
    })
    return merged
  }

  function resolveType(typeName) {
    if (!typeName) return null
    const o = overrides[typeName]
    const b = builtin[typeName]
    if (!o && !b) return null
    const base = Object.assign({}, b || {}, o || {})
    const agv = Object.assign({}, (b && b.type_agv) || {}, (o && o.type_agv) || {})
    if (b || o) base.type_agv = agv
    return base
  }

  function resolveFieldDef(fieldDef) {
    if (!fieldDef || !fieldDef.type) return null
    const t = resolveType(fieldDef.type)
    // Fallback: unknown type → treat as string with an _unknown marker so
    // calling code can surface it in the UI (e.g. ghosted label).
    if (!t) {
      return Object.assign({
        base_type: 'string', type_render: 'input_string', default: '', mem: '',
      }, fieldDef, { _unknown: true })
    }
    const merged = Object.assign({}, t, fieldDef)
    const agv = Object.assign({}, t.type_agv || {}, fieldDef.type_agv || {})
    merged.type_agv = agv
    return merged
  }

  // ── Renderer registry ────────────────────────────────────────
  const renderers = new Map()

  function registerRenderer(kind, fn) {
    if (typeof kind !== 'string' || !kind) throw new Error('registerRenderer: kind required')
    if (typeof fn !== 'function')           throw new Error('registerRenderer: fn required')
    renderers.set(kind, fn)
  }

  function getRenderer(kind) {
    return renderers.get(kind) || null
  }

  function listRenderKinds() {
    return Array.from(renderers.keys())
  }

  // Exports.
  ui.setTypeConfig    = setTypeConfig
  ui.setTypeOverrides = setOverrides
  ui.getTypeConfig    = getTypeConfig
  ui.resolveType      = resolveType
  ui.resolveFieldDef  = resolveFieldDef
  ui.registerRenderer = registerRenderer
  ui.getRenderer      = getRenderer
  ui.listRenderKinds  = listRenderKinds
})(window.aiditor = window.aiditor || {})

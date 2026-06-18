// aiditor.ui.propertyForm — schema-driven form for editing one or more objects.
// One form can edit a single object (length-1 targets) or batch-edit many;
// multi-target reads display the first target's value, and a user edit fans
// out to every target.
//
// opts:
//   targets:  signal<T[]> | T[]                       required (single-edit = [obj])
//   schema:   signal<StructDef> | StructDef           field shape; rare changes rebuild rows
//   onChange?:(field, newValue, targets, meta) => void app persistence; if omitted writes are
//                                                     fan-out into `targets` directly
//   disabled?:signal<boolean> | boolean               toggles `inert` on the root
//   defaults?:object                                  per-key reset-to-default values; when
//                                                     supplied, each row gets a small reset
//                                                     iconButton (faded when already at default)
//   groups?:  object|signal<object>                  optional group label/action metadata
//   groupActions?:(groupCtx) => UiAction[]            optional per-group actions
//   groupActionCtx?:(groupCtx) => object              optional per-group action ctx mapper
//   fieldActions?:(fieldCtx) => UiAction[]            optional per-field row actions
//   requireAllTargets?:boolean                        disables a field when any target lacks it
//   canEdit?:(field, targets, rawField) => boolean     extra per-field edit gate
//   ctx?:     any                                     forwarded to editorFor
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  // Schema fields can carry a `group` tag; propertyForm collects fields
  // by tag and renders a labeled section per group. The order below is
  // the canonical "what most users want to see" ranking. Anything not in
  // PROP_GROUPS appears in declaration order at the end. Apps can mutate
  // these tables to reskin / extend the form without touching propertyForm.
  ui.PROP_GROUPS = ['text', 'background', 'border', 'spacing', 'effects', 'shadow']
  ui.PROP_GROUP_LABELS = {
    text:       'Text',
    background: 'Background',
    border:     'Border',
    spacing:    'Spacing',
    effects:    'Effects',
    shadow:     'Shadow',
  }

  /**
   * @aiditorApi aiditor.ui.propertyForm
   * @group ui
   * @layer core-ui
   * @kind js-api
   * @signature aiditor.ui.propertyForm(opts)
   * @summary Render a schema-driven property editor for one target or a multi-target batch edit. Multi-target reads use the first target value; writes fan out only through enabled fields.
   * @param {object} opts - Form options.
   * @param {Signal<object[]>|object[]} opts.targets - Targets to edit.
   * @param {Signal<object>|object} opts.schema - Field schema passed to editorFor.
   * @param {Function} opts.onChange - Optional persistence hook: (field, newValue, targets, meta) => void.
   * @param {object|Signal<object>} opts.groups - Optional grouped section metadata, including labels and UiAction arrays.
   * @param {Function} opts.groupActions - Optional per-group UiAction factory. Returning null/undefined falls back to groups[groupId].actions; returning [] explicitly clears actions.
   * @param {Function} opts.groupActionCtx - Optional mapper for the context passed to group actions.
   * @param {Function} opts.fieldActions - Optional per-field UiAction factory. Returning null/undefined falls back to schemaField.actions; returning [] explicitly clears actions.
   * @param {boolean} opts.requireAllTargets - When true, disable fields missing from any target.
   * @param {Function} opts.canEdit - Optional field gate: (field, targets, rawField) => boolean.
   * @returns {HTMLElement} Property form root element.
   * @example
   * var form = aiditor.ui.propertyForm({
   *   targets: aiditor.signal([{ x: 0, color: '#44aaff' }]),
   *   schema: { x: { type: 'number' }, color: { type: 'color' } },
   * })
   * @related aiditor.inspector.registerProvider
   */
  ui.propertyForm = function (opts) {
    const o = opts || {}
    const targets   = ui.isSignal(o.targets) ? o.targets : aiditor.signal(o.targets || [])
    const schemaSig = ui.isSignal(o.schema)  ? o.schema  : aiditor.signal(o.schema  || {})
    const groupsSig = ui.isSignal(o.groups)  ? o.groups  : aiditor.signal(o.groups  || {})
    const disabled  = ui.asSig(o.disabled != null ? o.disabled : false)
    const defaults  = o.defaults || null
    const onChange  = typeof o.onChange === 'function' ? o.onChange : null
    const groupActions = typeof o.groupActions === 'function' ? o.groupActions : null
    const groupActionCtx = typeof o.groupActionCtx === 'function' ? o.groupActionCtx : null
    const fieldActions = typeof o.fieldActions === 'function' ? o.fieldActions : null
    const requireAllTargets = !!o.requireAllTargets
    const canEdit = typeof o.canEdit === 'function' ? o.canEdit : null
    const ctx       = o.ctx

    const root = ui.h('div', 'aiditor-ui-property-form')
    ui.bind(root, disabled, function (v) { root.toggleAttribute('inert', !!v) })

    const composite = aiditor.derived(function () {
      const arr    = targets() || []
      if (arr.length === 0) return {}
      return arr[0] || {}
    })
    ui.collect(root, composite.dispose)

    function fanOut(field, nv) {
      const change = { field: field, mode: 'literal', value: nv }
      if (onChange) { onChange(field, nv, targets.peek(), { change: change }); return }
      const arr = (targets.peek() || []).map(function (t) {
        const next = Object.assign({}, t || {})
        next[field] = nv
        return next
      })
      targets.set(arr)
    }

    // Structure is intentionally separated from values. `targets` may update
    // while a field editor is scrubbing, typing, or holding pointer capture;
    // equivalent schema/group refreshes must update existing slot signals,
    // not dispose the editor DOM.
    let mounted = []
    let mountedStructureKey = null
    let groupChrome = Object.create(null)
    const stopSchema = aiditor.effect(function () {
      const schema = schemaSig() || {}
      const groupConfig = groupsSig() || {}
      const currentTargets = targets() || []
      const grouped = groupBySchema(schema)
      const structureKey = formStructureKey(schema, grouped)
      aiditor.untracked(function () {
        if (structureKey !== mountedStructureKey) rebuild(schema, groupConfig, grouped, currentTargets, structureKey)
        else refreshGroupChrome(grouped, groupConfig, currentTargets)
      })
    })
    ui.collect(root, stopSchema)
    ui.collect(root, function () { mounted.forEach(function (n) { ui.dispose(n) }) })

    return root

    function rebuild(schema, groupConfig, grouped, currentTargets, structureKey) {
      mounted.forEach(function (n) { ui.dispose(n); if (n.parentNode) n.parentNode.removeChild(n) })
      mounted = []
      groupChrome = Object.create(null)
      mountedStructureKey = structureKey

      for (let i = 0; i < grouped.length; i++) {
        const g = grouped[i]
        const fields = g.keys.map(function (fname) {
          const raw   = schema[fname]
          const subFd = ui.resolveFieldDef(typeof raw === 'string' ? { type: raw } : raw)
          const label = fieldLabel(raw, fname)
          const action = fieldActionSignals(fname, label, raw, subFd)
          return {
            key:     fname,
            label:   label.value,
            labelMode: label.mode,
            tooltip: subFd.desc || '',
            actions: action.actions,
            actionCtx: action.ctx,
            editor:  function (slotSig, write, innerCtx) {
              return slotEditor(slotSig, write, fieldCtx(innerCtx, fname), subFd, fname, defaults,
                fieldDisabled(targets, requireAllTargets, canEdit, fname, raw))
            },
          }
        })
        const body = ui.structInput({
          value:    composite,
          fields:   fields,
          onChange: function (_next, key, nv) { fanOut(key, nv) },
          ctx:      ctx,
        })
        body.classList.add('aiditor-ui-property-form-struct')
        // Named groups wrap in a collapsible section; the unnamed
        // "essentials" bucket renders flat at the top so the most
        // important fields are always visible without a click.
        let mountedEl
        if (g.name) {
          const info = groupInfo(g.name, g.keys, groupConfig, currentTargets, ctx, groupActions, groupActionCtx)
          const chrome = {
            title: aiditor.signal(info.label),
            actions: aiditor.signal(info.actions || []),
            actionCtx: aiditor.signal(info.actionCtx),
          }
          groupChrome[g.name] = chrome
          mountedEl = ui.section({
            title:    chrome.title,
            actions:  chrome.actions,
            actionCtx: chrome.actionCtx,
            children: [body],
          })
          mountedEl.classList.add('aiditor-ui-property-section')
        } else {
          mountedEl = body
        }
        root.appendChild(mountedEl)
        mounted.push(mountedEl)
      }
    }

    function refreshGroupChrome(grouped, groupConfig, currentTargets) {
      for (let i = 0; i < grouped.length; i++) {
        const g = grouped[i]
        if (!g.name || !groupChrome[g.name]) continue
        const info = groupInfo(g.name, g.keys, groupConfig, currentTargets, ctx, groupActions, groupActionCtx)
        groupChrome[g.name].title.set(info.label)
        groupChrome[g.name].actions.set(info.actions || [])
        groupChrome[g.name].actionCtx.set(info.actionCtx)
      }
    }

    function fieldActionSignals(field, label, raw, resolved) {
      const rawObj = typeof raw === 'string' ? null : (raw || null)
      const actionCtx = aiditor.derived(function () {
        const arr = targets() || []
        const values = composite()
        return {
          field: field,
          label: label.value,
          rawField: raw,
          resolvedField: resolved,
          value: values == null ? undefined : values[field],
          targets: arr,
          ctx: ctx,
        }
      })
      const actions = aiditor.derived(function () {
        const currentCtx = actionCtx()
        const fromFn = fieldActions
          ? aiditor.safeCall({ scope: 'propertyForm', action: 'fieldActions', field: field }, function () { return fieldActions(currentCtx) })
          : null
        return fromFn != null ? fromFn : (rawObj && rawObj.actions || [])
      })
      return { actions: actions, ctx: actionCtx }
    }
  }

  // Walk the schema and produce ordered groups. Ungrouped fields go FIRST
  // (component-specific essentials usually live at the top — value /
  // width / etc.); then PROP_GROUPS in declared order, then any unknown
  // tags in first-appearance order.
  function groupBySchema(schema) {
    const buckets = Object.create(null)
    const seen = []
    Object.keys(schema).forEach(function (k) {
      const fd = schema[k] || {}
      const tag = fd.group || ''
      if (!buckets[tag]) { buckets[tag] = []; seen.push(tag) }
      buckets[tag].push(k)
    })
    const order = []
    if (buckets['']) order.push('')
    ;(ui.PROP_GROUPS || []).forEach(function (g) { if (buckets[g]) order.push(g) })
    seen.forEach(function (g) { if (g && order.indexOf(g) < 0) order.push(g) })
    return order.map(function (g) { return { name: g, keys: buckets[g] } })
  }

  function formStructureKey(schema, grouped) {
    return stableStringify(grouped.map(function (group) {
      return {
        group: group.name,
        fields: group.keys.map(function (key) {
          const raw = schema[key]
          const fd = typeof raw === 'string' ? { type: raw } : (raw || {})
          return { key: key, field: structuralFieldDef(fd) }
        }),
      }
    }))
  }

  function structuralFieldDef(fd) {
    if (!fd || typeof fd !== 'object') return fd
    if (Array.isArray(fd)) return fd.map(structuralFieldDef)
    const out = {}
    const keys = Object.keys(fd)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (key === 'actions') continue
      out[key] = structuralFieldDef(fd[key])
    }
    return out
  }

  function stableStringify(value) {
    if (value == null) return String(value)
    if (typeof value === 'function') return '[function:' + (value.name || '') + ']'
    if (typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) {
      return '[' + value.map(stableStringify).join(',') + ']'
    }
    const keys = Object.keys(value).sort()
    let out = '{'
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (i) out += ','
      out += JSON.stringify(key) + ':' + stableStringify(value[key])
    }
    return out + '}'
  }

  function groupInfo(groupId, fields, groupConfig, targets, ctx, groupActions, groupActionCtx) {
    const raw = groupConfig && groupConfig[groupId] || {}
    const label = raw.label || (ui.PROP_GROUP_LABELS && ui.PROP_GROUP_LABELS[groupId]) || groupId
    const baseCtx = {
      groupId: groupId,
      label: label,
      fields: fields.slice(),
      targets: targets || [],
      ctx: ctx,
    }
    const actionCtx = groupActionCtx
      ? aiditor.safeCall({ scope: 'propertyForm', action: 'groupActionCtx', group: groupId }, function () { return groupActionCtx(baseCtx) }) || baseCtx
      : baseCtx
    const fromFn = groupActions
      ? aiditor.safeCall({ scope: 'propertyForm', action: 'groupActions', group: groupId }, function () { return groupActions(actionCtx) })
      : null
    return {
      label: label,
      actions: fromFn != null ? fromFn : (raw.actions || null),
      actionCtx: actionCtx,
    }
  }

  function fieldCtx(ctx, field) {
    return typeof ctx === 'function' ? ctx(field) : ctx
  }

  function fieldDisabled(targets, requireAllTargets, canEdit, field, raw) {
    return aiditor.derived(function () {
      const arr = targets() || []
      if (raw && raw.disabled === true) return true
      if (requireAllTargets && !allHave(arr, field)) return true
      return canEdit ? !canEdit(field, arr, raw) : false
    })
  }

  function allHave(arr, field) {
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i] || !Object.prototype.hasOwnProperty.call(arr[i], field)) return false
    }
    return arr.length > 0
  }

  function fieldLabel(raw, fname) {
    if (raw && raw.label === false) return { value: fname, mode: 'hidden' }
    if (raw && raw.labelMode === 'hidden') return { value: raw.label || fname, mode: 'hidden' }
    if (raw && raw.labelMode === 'sr-only') return { value: raw.label || fname, mode: 'sr-only' }
    return { value: raw && raw.label || fname, mode: 'visible' }
  }

  // Slot wrapper. Optional reset button: present when `defaults[fname]` is defined; faded
  // when the current slot value already equals that default.
  function slotEditor(slotSig, write, innerCtx, fieldDef, fname, defaults, disabled) {
    const editorEl = ui.editorFor(fieldDef, slotSig, write, innerCtx)
    const slot = ui.h('div', 'aiditor-ui-slot')
    slot.appendChild(editorEl)
    if (defaults) slot.appendChild(buildReset(slotSig, write, function () {
      const current = defaultsFor(defaults) || {}
      return current[fname]
    }, function () {
      const current = defaultsFor(defaults) || {}
      return Object.prototype.hasOwnProperty.call(current, fname)
    }))
    ui.bind(slot, disabled, function (v) {
      slot.toggleAttribute('inert', !!v)
      slot.classList.toggle('aiditor-ui-slot-disabled', !!v)
      slot.title = v ? 'Not editable for the current selection' : ''
    })
    ui.collect(slot, disabled.dispose)
    ui.collect(slot, function () { ui.dispose(editorEl) })
    return slot
  }

  function defaultsFor(defaults) {
    return typeof defaults === 'function' ? defaults() : defaults
  }

  function buildReset(slotSig, write, defaultValue, hasDefault) {
    const btn = ui.iconButton({
      icon: 'refresh', kind: 'ghost', size: 'sm', title: 'Reset to default',
      onClick: function () { if (hasDefault()) write(defaultValue()) },
    })
    btn.classList.add('aiditor-ui-slot-reset')
    // Fade when already at default — visual cue that the button is a
    // no-op right now without removing it (so layout doesn't shift).
    // undefined / null / '' are treated as the same "empty" state so a
    // freshly-created node (where the field was never set) reads as
    // "at default" even when the default literal is ''.
    ui.collect(btn, aiditor.effect(function () {
      const v = slotSig()
      const has = hasDefault()
      const atDefault = has && isAtDefault(v, defaultValue())
      btn.hidden = !has
      btn.style.opacity = atDefault ? '0.3' : '1'
      btn.style.cursor  = !has || atDefault ? 'default' : ''
    }))
    return btn
  }
  function isAtDefault(v, def) {
    const ve = v   == null || v   === ''
    const de = def == null || def === ''
    if (ve && de) return true
    return equalValues(v, def)
  }
  function equalValues(a, b) {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    return JSON.stringify(a) === JSON.stringify(b)
  }
})(window.aiditor = window.aiditor || {})

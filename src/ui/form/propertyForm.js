// aiditor.ui.propertyForm — schema-driven form for editing one or more objects.
// One form can edit a single object (length-1 targets) or batch-edit many;
// multi-target reads display the first target's value, and a user edit fans
// out to every target.
//
// opts:
//   targets:  signal<T[]> | T[]                       required (single-edit = [obj])
//   schema:   signal<StructDef> | StructDef           field shape; rare changes rebuild rows
//   onChange?:(fieldPath, newValue, targets, meta) => void app persistence; if omitted writes are
//                                                     fan-out into `targets` directly
//   disabled?:signal<boolean> | boolean               toggles `inert` on the root
//   defaults?:object                                  per-key reset-to-default values; when
//                                                     supplied, each row gets a small reset
//                                                     iconButton in the label chrome
//   groups?:  object|signal<object>                  optional group label/action metadata
//   groupActions?:(groupCtx) => UiAction[]            optional per-group actions
//   groupActionCtx?:(groupCtx) => object              optional per-group action ctx mapper
//   fieldActions?:(fieldCtx) => UiAction[]            optional per-field row actions
//   fieldContextActions?:(fieldCtx) => UiAction[]|Promise<UiAction[]>
//                                                     optional per-field context-menu actions
//   fieldMessages?:signal<object>|object              fieldPath -> FieldMessage[]
//   filePathActions?:(fieldCtx) => UiAction[]          optional extra actions for
//                                                     filepath/img/snd editors
//   searchQuery?:signal<string>|string                 display-only recursive filter
//   foldingState?:InspectorFoldingStateStore           optional Section state owner
//   foldingScope?:signal<object>|object                workspace/provider/primary identity
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
   * @param {Function} opts.onChange - Optional persistence hook: (fieldPath, newValue, targets, meta) => void.
   * @param {object|Signal<object>} opts.groups - Optional grouped section metadata, including labels, actions, defaultCollapsed, and enabledBy.
   * @param {Function} opts.groupActions - Optional per-group UiAction factory. Returning null/undefined falls back to groups[groupId].actions; returning [] explicitly clears actions.
   * @param {Function} opts.groupActionCtx - Optional mapper for the context passed to group actions.
   * @param {Function} opts.fieldActions - Optional per-field UiAction factory. Returning null/undefined falls back to schemaField.actions; returning [] explicitly clears actions.
   * @param {Function} opts.fieldContextActions - Optional field context-menu UiAction factory. May return UiAction[] or Promise<UiAction[]>.
   * @param {Function} opts.filePathActions - Optional UiAction factory appended to file path input menus.
   * @param {string|Signal<string>} opts.searchQuery - Optional display-only recursive field filter.
   * @param {object} opts.foldingState - Optional Inspector FoldingStateStore shared by field Sections, recursive Structs, and Groups.
   * @param {object|Signal<object>} opts.foldingScope - Optional workspace/provider/primary identity consumed by foldingState.
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
    const fieldContextActions = typeof o.fieldContextActions === 'function' ? o.fieldContextActions : null
    const filePathActions = typeof o.filePathActions === 'function' ? o.filePathActions : null
    const fieldMessages = ui.isSignal(o.fieldMessages) ? o.fieldMessages : aiditor.signal(o.fieldMessages || {})
    const requireAllTargets = !!o.requireAllTargets
    const canEdit = typeof o.canEdit === 'function' ? o.canEdit : null
    const searchQuery = ui.asSig(o.searchQuery != null ? o.searchQuery : '')
    const foldingState = o.foldingState || null
    const foldingScope = o.foldingScope || null
    const ctx       = o.ctx

    const root = ui.h('div', 'aiditor-ui-property-form')
    ui.bind(root, disabled, function (v) { root.toggleAttribute('inert', !!v) })

    const composite = aiditor.derived(function () {
      const arr    = targets() || []
      if (arr.length === 0) return {}
      return arr[0] || {}
    })
    ui.collect(root, composite.dispose)

    function fanOut(field, nv, meta) {
      const change = meta && meta.change || pathChange(field, nv)
      const outMeta = Object.assign({}, meta || {}, { change: change })
      if (onChange) { onChange(change.field, change.value, targets.peek(), outMeta); return }
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
    let mounted = null
    let mountedStructureKey = null
    const stopSchema = aiditor.effect(function () {
      const schema = schemaSig() || {}
      const groupConfig = groupsSig() || {}
      const grouped = groupBySchema(schema)
      const structureKey = formStructureKey(schema, grouped, groupConfig)
      aiditor.untracked(function () {
        if (structureKey !== mountedStructureKey) rebuild(schema, grouped, structureKey)
      })
    })
    ui.collect(root, stopSchema)
    ui.collect(root, function () { if (mounted) ui.dispose(mounted) })

    return root

    function rebuild(schema, grouped, structureKey) {
      if (mounted) {
        ui.dispose(mounted)
        if (mounted.parentNode) mounted.parentNode.removeChild(mounted)
      }
      mounted = null
      mountedStructureKey = structureKey

      const fields = []
      for (let i = 0; i < grouped.length; i++) {
        const g = grouped[i]
        for (let j = 0; j < g.keys.length; j++) {
          const fname = g.keys[j]
          const raw   = schema[fname]
          const subFd = ui.resolveFieldDef(typeof raw === 'string' ? { type: raw } : raw)
          const label = fieldLabel(raw, fname)
          const action = fieldActionSignals(fname, label, raw, subFd)
          const reset = resetActionSignal(fname, defaults)
          const messages = messagesForPath(fieldMessages, fname)
          fields.push({
            key:     fname,
            fieldDef: subFd,
            group:   raw && raw.group,
            label:   label.value,
            labelMode: label.mode,
            labelActions: reset,
            fieldLayout: raw && raw.fieldLayout,
            defaultCollapsed: raw && raw.defaultCollapsed,
            collapsed: raw && raw.collapsed,
            onToggle: raw && raw.onToggle,
            visibleWhen: raw && raw.visibleWhen,
            searchText: [ui.schema.fieldSearchText(fname, raw), subFd && subFd.name, subFd && subFd.desc],
            searchDescendants: ui.schema.descendantSearchText(raw),
            tooltip: subFd.desc || '',
            actions: action.actions,
            actionCtx: action.ctx,
            contextActions: action.contextActions,
            contextCtx: action.ctx,
            messages: messages,
            editor:  function (slotSig, write, innerCtx) {
              return slotEditor(slotSig, write, editorFieldCtx(innerCtx, fname, label, raw, subFd, action.filePathActions, fieldMessages,
                foldingState, foldingScope), subFd,
                fieldDisabled(targets, requireAllTargets, canEdit, fname, raw))
            },
          })
        }
      }

      const body = ui.structInput({
        value: composite,
        fields: fields,
        groups: groupsSig,
        groupActions: groupActions,
        groupActionCtx: function (baseCtx) {
          const enriched = Object.assign({}, baseCtx, {
            targets: targets(),
            ctx: ctx,
          })
          return groupActionCtx ? groupActionCtx(enriched) || enriched : enriched
        },
        searchQuery: searchQuery,
        foldingState: foldingState,
        foldingScope: foldingScope,
        fieldPath: '',
        onChange: function (_next, key, nv, meta) { fanOut(key, nv, meta) },
        ctx: ctx,
      })
      body.classList.add('aiditor-ui-property-form-struct')
      body.classList.add('aiditor-ui-property-form-root')
      const sections = body.querySelectorAll('.aiditor-ui-struct-group')
      for (let i = 0; i < sections.length; i++) {
        sections[i].classList.add('aiditor-ui-property-section')
        sections[i].body.classList.add('aiditor-ui-property-form-struct')
      }
      root.appendChild(body)
      mounted = body
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
          ctx: fieldCtx(ctx, field),
        }
      })
      const actions = aiditor.derived(function () {
        const currentCtx = actionCtx()
        const fromFn = fieldActions
          ? aiditor.safeCall({ scope: 'propertyForm', action: 'fieldActions', field: field }, function () { return fieldActions(currentCtx) })
          : null
        return fromFn != null ? fromFn : (rawObj && rawObj.actions || [])
      })
      const contextActions = fieldContextActions
        ? function (currentCtx) { return fieldContextActions(currentCtx) }
        : null
      const pathActions = filePathActions
        ? function (inputCtx) {
          return filePathActions(Object.assign({}, actionCtx.peek ? actionCtx.peek() : actionCtx(), inputCtx || {}))
        }
        : null
      return { actions: actions, ctx: actionCtx, contextActions: contextActions, filePathActions: pathActions }
    }

    function resetActionSignal(field, defaults) {
      return aiditor.derived(function () {
        const currentDefaults = defaultsFor(defaults) || {}
        if (!Object.prototype.hasOwnProperty.call(currentDefaults, field)) return []
        const def = currentDefaults[field]
        const values = composite() || {}
        const atDefault = isAtDefault(values[field], def)
        return [{
          id: 'reset-default',
          icon: 'refresh',
          title: 'Reset to default',
          disabled: atDefault,
          onSelect: function () { fanOut(field, def, { change: pathChange(field, def) }) },
        }]
      })
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

  function formStructureKey(schema, grouped, groups) {
    return stableStringify({
      fields: grouped.map(function (group) {
        return {
        group: group.name,
        fields: group.keys.map(function (key) {
          const raw = schema[key]
          const fd = typeof raw === 'string' ? { type: raw } : (raw || {})
          return { key: key, field: structuralFieldDef(fd) }
        }),
        }
      }),
      enabledBy: grouped.filter(function (group) { return group.name }).map(function (group) {
        return [group.name, groups[group.name] && groups[group.name].enabledBy || '']
      }),
    })
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

  function fieldCtx(ctx, field) {
    const base = typeof ctx === 'function' ? ctx(field) : ctx
    const out = Object.assign({}, base || {})
    out.fieldPath = out.fieldPath || field
    return out
  }

  function editorFieldCtx(ctx, field, label, raw, resolved, filePathActions, fieldMessages, foldingState, foldingScope) {
    const out = fieldCtx(ctx, field)
    out.field = field
    out.label = label && label.value || field
    out.rawField = raw
    out.resolvedField = resolved
    out.fieldMessages = fieldMessages
    if (foldingState) out.foldingState = foldingState
    if (foldingScope) out.foldingScope = foldingScope
    if (filePathActions) out.filePathActions = filePathActions
    return out
  }

  function messagesForPath(messages, path) {
    return aiditor.derived(function () {
      const map = messages() || {}
      return map[path] || []
    })
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

  // Slot wrapper keeps the editor stable while disabled state changes. Field
  // chrome such as reset-to-default belongs to structInput's label area.
  function slotEditor(slotSig, write, innerCtx, fieldDef, disabled) {
    const editorEl = ui.editorFor(fieldDef, slotSig, write, innerCtx)
    const slot = ui.h('div', 'aiditor-ui-slot')
    slot.appendChild(editorEl)
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

  function pathChange(field, value) {
    return aiditor.inspector && aiditor.inspector.pathChange
      ? aiditor.inspector.pathChange(field, value)
      : { field: field, mode: 'path', value: value }
  }
})(window.aiditor = window.aiditor || {})

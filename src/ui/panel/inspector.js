// Built-in Inspector panel: renders the current aiditor.inspector selection.
;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui

  function disposeTree(el) {
    if (!el) return
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function titleOf(targets, inspection) {
    if (inspection && inspection.title) {
      return typeof inspection.title === 'function' ? inspection.title(targets) : inspection.title
    }
    if (targets.length > 1) return targets.length + ' selected'
    const t = targets[0]
    return (t && (t.title || t.label || t.name || t.id)) || 'Inspector'
  }

  function subtitleOf(targets, inspection) {
    if (inspection && inspection.subtitle) return inspection.subtitle
    if (targets.length > 1) return targetType(targets[0]) + ' / primary ' + (targets[0].title || targets[0].id || '')
    return targetType(targets[0]) || ''
  }

  function targetType(target) {
    return target && (target.type || target.kind) || ''
  }

  function filterSchema(schema, query) {
    const q = normalizeQuery(query)
    if (!q) return schema || {}
    const out = {}
    Object.keys(schema || {}).forEach(function (key) {
      const raw = schema[key]
      if (fieldMatches(key, raw, q)) out[key] = raw
    })
    return out
  }

  function normalizeQuery(value) {
    return String(value == null ? '' : value).trim().toLowerCase()
  }

  function fieldMatches(key, raw, query) {
    const field = raw && typeof raw === 'object' ? raw : {}
    const parts = [key]
    if (field.label && field.label !== false) parts.push(field.label)
    if (field.group) {
      parts.push(field.group)
      if (ui.PROP_GROUP_LABELS && ui.PROP_GROUP_LABELS[field.group]) parts.push(ui.PROP_GROUP_LABELS[field.group])
    }
    if (field.desc) parts.push(field.desc)
    return parts.join(' ').toLowerCase().indexOf(query) >= 0
  }

  function factory(propsSig, ctx) {
    const root = ui.h('div', 'aiditor-inspector')
    const head = ui.h('div', 'aiditor-inspector-head')
    const titleLine = ui.h('div', 'aiditor-inspector-title-line')
    const title = ui.h('span', 'aiditor-inspector-title')
    const subtitle = ui.h('span', 'aiditor-inspector-subtitle')
    titleLine.appendChild(title)
    titleLine.appendChild(subtitle)
    const actionsSig = aiditor.signal([])
    const actionCtxSig = aiditor.signal({})
    const actions = ui.actionBar({ actions: actionsSig, ctx: actionCtxSig, density: 'compact' })
    actions.classList.add('aiditor-inspector-actions')
    titleLine.appendChild(actions)
    const querySig = aiditor.signal('')
    const search = ui.searchInput({
      value: querySig,
      placeholder: 'Search properties...',
    })
    search.classList.add('aiditor-inspector-search')
    search.hidden = true
    head.appendChild(titleLine)
    head.appendChild(search)
    const body = ui.h('div', 'aiditor-inspector-body')
    root.appendChild(head)
    root.appendChild(body)

    const schemaSig = aiditor.signal({})
    const filteredSchemaSig = aiditor.derived(function () { return filterSchema(schemaSig(), querySig()) })
    const groupsSig = aiditor.signal({})
    const valuesSig = aiditor.signal([])
    const disabledSig = aiditor.signal(false)
    let currentInspection = null
    let currentDispose = null
    let currentTargets = []
    let currentSubKey = ''
    let currentSubscribe = null
    let mode = ''
    let customEl = null
    ui.collect(root, filteredSchemaSig.dispose)

    function clearBody() {
      if (customEl) {
        ui.dispose(customEl)
        customEl = null
      }
      while (body.firstChild) ui.dispose(body.firstChild)
      mode = ''
    }

    function setSearchVisible(visible) {
      search.hidden = !visible
    }

    function setHeaderActions(inspection, targets) {
      if (!inspection) {
        actionsSig.set([])
        actionCtxSig.set({})
        return
      }
      const actionCtx = {
        source: 'inspector',
        inspection: inspection,
        targets: targets,
        primary: targets[0],
        panel: ctx.panel,
        bus: ctx.bus,
        refresh: refresh,
      }
      actionCtxSig.set(actionCtx)
      actionsSig.set(inspection.actions || [])
    }

    function setSubscription(inspection, targets) {
      const nextKey = inspection ? subscriptionKey(inspection, targets) : ''
      const nextSubscribe = inspection && typeof inspection.subscribe === 'function' ? inspection.subscribe : null
      if (nextKey === currentSubKey && nextSubscribe === currentSubscribe) return
      if (currentDispose) currentDispose()
      currentDispose = null
      currentSubKey = nextKey
      currentSubscribe = nextSubscribe
      if (nextSubscribe) {
        currentDispose = aiditor.safeCall({ scope: 'inspector', action: 'subscribe', type: inspection.type }, function () {
          return nextSubscribe(refresh, {
            targets: targets,
            primary: targets[0],
            panel: ctx.panel,
            bus: ctx.bus,
          })
        })
      }
    }

    function callWrite(field, change, values) {
      aiditor.safeCall({ scope: 'inspector', action: 'write', type: currentInspection.type, field: field }, function () {
        currentInspection.write(field, change, {
          targets: currentTargets,
          primary: currentTargets[0],
          values: values,
          primaryValue: values[0],
          valueForChange: aiditor.inspector.valueForChange,
        })
      })
    }

    function subscriptionKey(inspection, targets) {
      if (typeof inspection.key === 'function') return inspection.type + ':' + inspection.key(targets)
      if (inspection.key != null) return inspection.type + ':' + inspection.key
      return inspection.type + ':' + targets.map(function (target) {
        return target.uri || target.id || target.name || target.title || targetType(target)
      }).join('|')
    }

    function mountEmpty(text, hint, bodyText) {
      clearBody()
      setSearchVisible(false)
      title.textContent = text
      subtitle.textContent = hint || ''
      body.appendChild(ui.h('div', 'aiditor-inspector-empty', { text: bodyText || hint || 'Select something to inspect.' }))
      mode = 'empty'
    }

    function mountCustom(inspection, targets) {
      clearBody()
      setSearchVisible(false)
      customEl = aiditor.safeCall({ scope: 'inspector', action: 'render', type: inspection.type }, function () { return inspection.render({
        targets: targets,
        primary: targets[0],
        values: inspection.values,
        panel: ctx.panel,
        bus: ctx.bus,
        refresh: refresh,
      }) })
      if (!customEl) {
        body.appendChild(ui.h('div', 'aiditor-inspector-empty', { text: 'Inspector renderer failed.' }))
        mode = 'empty'
        return
      }
      body.appendChild(customEl)
      mode = 'custom'
    }

    function mountForm(inspection, targets) {
      if (mode !== 'form') {
        clearBody()
        const form = ui.propertyForm({
          schema: filteredSchemaSig,
          targets: valuesSig,
          disabled: disabledSig,
          defaults: function () { return currentInspection && currentInspection.defaults },
          groups: groupsSig,
          groupActions: function (groupCtx) {
            const fn = currentInspection && currentInspection.groupActions
            return typeof fn === 'function' ? fn(groupCtx) : null
          },
          groupActionCtx: function (groupCtx) {
            const values = groupCtx.targets || []
            return Object.assign({}, groupCtx, {
              source: 'inspector',
              inspection: currentInspection,
              targets: currentTargets,
              primary: currentTargets[0],
              values: values,
              primaryValue: values[0],
              panel: ctx.panel,
              bus: ctx.bus,
              refresh: refresh,
            })
          },
          requireAllTargets: true,
          canEdit: function (field, values, rawField) {
            return aiditor.inspector.canEditField(currentInspection, field, values, rawField)
          },
          onChange: function (field, value, values, meta) {
            const change = meta && meta.change || aiditor.inspector.literalChange(field, value)
            callWrite(field, change, values)
          },
          ctx: function (field) {
            return { source: 'aiditor-inspector', field: field, targets: currentTargets, panel: ctx.panel }
          },
        })
        body.appendChild(form)
        mode = 'form'
      }
      setSearchVisible(true)
      schemaSig.set(inspection.schema || {})
      groupsSig.set(inspection.groups || {})
      valuesSig.set(inspection.values || [])
      disabledSig.set(!!inspection.readonly || !inspection.write)
    }

    function refresh() {
      const targets = aiditor.inspector.selection()
      if (!targets.length) {
        currentInspection = null
        currentTargets = []
        setSubscription(null, targets)
        setHeaderActions(null, targets)
        mountEmpty('Inspector', '', 'Select something to inspect.')
        return
      }
      const inspection = aiditor.inspector.inspect(targets, { panel: ctx.panel, bus: ctx.bus })
      if (!inspection) {
        currentInspection = null
        currentTargets = targets
        setSubscription(null, targets)
        setHeaderActions(null, targets)
        mountEmpty('No Inspector', '', 'No provider for ' + (targetType(targets[0]) || 'selection') + '.')
        return
      }
      currentInspection = inspection
      currentTargets = targets
      title.textContent = titleOf(targets, inspection)
      subtitle.textContent = subtitleOf(targets, inspection)
      setHeaderActions(inspection, targets)
      setSubscription(inspection, targets)
      if (inspection.render) mountCustom(inspection, targets)
      else mountForm(inspection, targets)
    }

    ctx.onCleanup(function () {
      if (currentDispose) currentDispose()
      currentDispose = null
      currentSubKey = ''
      currentSubscribe = null
      clearBody()
    })
    ctx.onCleanup(aiditor.effect(refresh))
    return root
  }

  aiditor.registerComponent('inspector', {
    category: 'panel',
    label: 'Inspector',
    icon: 'settings',
    defaults: function () { return { title: 'Inspector', icon: 'settings', props: {} } },
    factory: factory,
    dispose: disposeTree,
  })
})(window.aiditor = window.aiditor || {})

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
    const beforeForm = ui.h('div', 'aiditor-inspector-before-form')
    beforeForm.hidden = true
    head.appendChild(titleLine)
    head.appendChild(search)
    head.appendChild(beforeForm)
    const body = ui.h('div', 'aiditor-inspector-body')
    root.appendChild(head)
    root.appendChild(body)

    const schemaSig = aiditor.signal({})
    const groupsSig = aiditor.signal({})
    const valuesSig = aiditor.signal([])
    const disabledSig = aiditor.signal(false)
    const fieldMessagesSig = aiditor.signal({})
    const foldingScopeSig = aiditor.signal(null)
    const foldingState = aiditor.inspector.foldingState
    let currentInspection = null
    let currentDispose = null
    let currentTargets = []
    let currentSubKey = ''
    let currentSubscribe = null
    let mode = ''
    let customEl = null
    let fieldMessageDispose = null
    let fieldMessageController = null
    let fieldMessageGeneration = 0

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

    function setBeforeForm(inspection, targets) {
      ui.disposeChildren(beforeForm)
      beforeForm.hidden = true
      if (!inspection || typeof inspection.renderBeforeForm !== 'function') return
      const element = aiditor.safeCall({ scope: 'inspector', action: 'renderBeforeForm', type: inspection.type }, function () {
        return inspection.renderBeforeForm({
          targets: targets,
          primary: targets[0],
          values: inspection.values || [],
          panel: ctx.panel,
          bus: ctx.bus,
          refresh: refresh,
        })
      })
      if (!(element instanceof HTMLElement)) return
      beforeForm.appendChild(element)
      beforeForm.hidden = false
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
        let subscribing = true
        currentDispose = aiditor.safeCall({ scope: 'inspector', action: 'subscribe', type: inspection.type }, function () {
          return nextSubscribe(function (change) {
            // The inspection captured the current state immediately before subscribing.
            // Providers may synchronously publish that same initial state while registering.
            if (!subscribing) invalidate(change)
          }, {
            targets: targets,
            primary: targets[0],
            panel: ctx.panel,
            bus: ctx.bus,
          })
        })
        subscribing = false
      }
    }

    function invalidate(change) {
      if (!change || change.kind === 'structure') {
        refresh()
        return
      }
      if (change.kind !== 'value' && change.kind !== 'collection') {
        throw new Error('inspector subscription: unknown invalidation kind "' + change.kind + '"')
      }
      const values = change.values || (typeof currentInspection.readValues === 'function'
        ? currentInspection.readValues(currentTargets, change)
        : null)
      if (!values) {
        refresh()
        return
      }
      currentInspection.values = values
      valuesSig.set(values)
    }

    function callWrite(field, change, values, meta) {
      aiditor.safeCall({ scope: 'inspector', action: 'write', type: currentInspection.type, field: field }, function () {
        currentInspection.write(field, change, {
          targets: currentTargets,
          primary: currentTargets[0],
          values: values,
          primaryValue: values[0],
          schema: currentInspection.schema || {},
          applyChange: aiditor.inspector.applyChange,
          pathChange: aiditor.inspector.pathChange,
          valueForChange: aiditor.inspector.valueForChange,
          commands: aiditor.commands || null,
          edit: meta && meta.edit || null,
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
          schema: schemaSig,
          targets: valuesSig,
          disabled: disabledSig,
          defaults: function () { return currentInspection && currentInspection.defaults },
          fieldMessages: fieldMessagesSig,
          groups: groupsSig,
          searchQuery: querySig,
          foldingState: foldingState,
          foldingScope: foldingScopeSig,
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
          fieldContextActions: function (fieldCtx) {
            const fn = currentInspection && currentInspection.fieldContextActions
            if (typeof fn !== 'function') return null
            const values = fieldCtx.targets || []
            return fn(Object.assign({}, fieldCtx, {
              source: 'inspector',
              inspection: currentInspection,
              targets: currentTargets,
              primary: currentTargets[0],
              values: values,
              primaryValue: values[0],
              panel: ctx.panel,
              bus: ctx.bus,
              refresh: refresh,
            }))
          },
          filePathActions: function (fieldCtx) {
            const fn = currentInspection && currentInspection.filePathActions
            if (typeof fn !== 'function') return null
            const values = fieldCtx.targets || []
            return fn(Object.assign({}, fieldCtx, {
              source: 'inspector',
              inspection: currentInspection,
              targets: currentTargets,
              primary: currentTargets[0],
              values: values,
              primaryValue: values[0],
              panel: ctx.panel,
              bus: ctx.bus,
              refresh: refresh,
            }))
          },
          requireAllTargets: true,
          canEdit: function (field, values, rawField) {
            return aiditor.inspector.canEditField(currentInspection, field, values, rawField)
          },
          onChange: function (field, value, values, meta) {
            const change = meta && meta.change || aiditor.inspector.literalChange(field, value)
            callWrite(field, change, values, meta)
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

    function setFieldMessages(inspection, targets) {
      if (fieldMessageDispose) fieldMessageDispose()
      fieldMessageDispose = null
      if (fieldMessageController) fieldMessageController.abort()
      fieldMessageController = null
      const generation = ++fieldMessageGeneration
      fieldMessagesSig.set({})
      const source = inspection && inspection.fieldMessages
      if (!source) return
      if (ui.isSignal(source)) {
        fieldMessageDispose = aiditor.effect(function () { fieldMessagesSig.set(source() || {}) })
        return
      }
      const controller = new AbortController()
      fieldMessageController = controller
      const messageCtx = {
        targets: targets,
        primary: targets[0],
        values: inspection.values || [],
        panel: ctx.panel,
        bus: ctx.bus,
        refresh: refresh,
        signal: controller.signal,
      }
      const result = typeof source === 'function'
        ? aiditor.safeCall({ scope: 'inspector', action: 'fieldMessages', type: inspection.type }, function () { return source(messageCtx) })
        : source
      if (!result || typeof result.then !== 'function') {
        if (generation === fieldMessageGeneration) fieldMessagesSig.set(result || {})
        fieldMessageController = null
        return
      }
      Promise.resolve(result).then(function (messages) {
        if (controller.signal.aborted || generation !== fieldMessageGeneration) return
        fieldMessagesSig.set(messages || {})
      }).catch(function (err) {
        if (controller.signal.aborted || generation !== fieldMessageGeneration) return
        aiditor.reportError(err, { scope: 'inspector', action: 'fieldMessages', type: inspection.type })
      }).finally(function () {
        if (fieldMessageController === controller) fieldMessageController = null
      })
    }

    function refresh() {
      const targets = aiditor.inspector.selection()
      const selectionMeta = aiditor.inspector.meta()
      if (!targets.length) {
        mountEmpty('Inspector', '', 'Select something to inspect.')
        setFieldMessages(null, targets)
        setSubscription(null, targets)
        setHeaderActions(null, targets)
        setBeforeForm(null, targets)
        currentInspection = null
        currentTargets = []
        foldingScopeSig.set(null)
        return
      }
      const inspection = aiditor.inspector.inspect(targets, { panel: ctx.panel, bus: ctx.bus })
      if (!inspection) {
        mountEmpty('No Inspector', '', 'No provider for ' + (targetType(targets[0]) || 'selection') + '.')
        setFieldMessages(null, targets)
        setSubscription(null, targets)
        setHeaderActions(null, targets)
        setBeforeForm(null, targets)
        currentInspection = null
        currentTargets = targets
        foldingScopeSig.set(null)
        return
      }
      if (inspection.render ? mode === 'form' : mode === 'custom') clearBody()
      currentInspection = inspection
      currentTargets = targets
      setFieldMessages(inspection, targets)
      title.textContent = titleOf(targets, inspection)
      subtitle.textContent = subtitleOf(targets, inspection)
      setHeaderActions(inspection, targets)
      setSubscription(inspection, targets)
      if (inspection.render) {
        foldingScopeSig.set(null)
        setBeforeForm(null, targets)
        mountCustom(inspection, targets)
      } else {
        foldingScopeSig.set(aiditor.inspector.foldingScope(inspection, targets, selectionMeta))
        setBeforeForm(inspection, targets)
        mountForm(inspection, targets)
      }
    }

    ctx.onCleanup(function () {
      if (currentDispose) currentDispose()
      if (fieldMessageDispose) fieldMessageDispose()
      if (fieldMessageController) fieldMessageController.abort()
      currentDispose = null
      fieldMessageDispose = null
      fieldMessageController = null
      currentSubKey = ''
      currentSubscribe = null
      foldingScopeSig.set(null)
      setBeforeForm(null, [])
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

// aiditor extension contribution installers.
;(function (aiditor) {
  'use strict'

  const Manifest = aiditor._extensionsManifest
  const clone = Manifest.clone
  const ownerFor = Manifest.ownerFor
  const componentMap = Manifest.componentMap
  const normalizeUiNode = Manifest.normalizeUiNode

  function makeComponentSpec(manifest, contribution) {
    const map = componentMap(manifest)
    const uiTree = normalizeUiNode(contribution.ui || contribution.view, map)
    const defaults = {
      title: contribution.title,
      icon: contribution.icon || '',
      props: clone(contribution.props || {}),
      owner: ownerFor(manifest.id),
      extensionId: manifest.id,
    }
    return {
      title: contribution.title,
      icon: contribution.icon || '',
      category: contribution.category || 'Extension',
      defaults: function () { return clone(defaults) },
      factory: function (propsSig, ctx) {
        if (contribution.kind === 'iframe') {
          const frame = document.createElement('iframe')
          frame.className = 'aiditor-extension-iframe'
          frame.setAttribute('sandbox', contribution.sandbox || 'allow-scripts')
          frame.setAttribute('referrerpolicy', 'no-referrer')
          frame.srcdoc = contribution.srcdoc || contribution.source || ''
          return frame
        }
        if (contribution.kind === 'factory') {
          if (contribution.isolation !== 'same-page') throw new Error('Unsupported factory isolation: ' + contribution.isolation)
          const maker = Function('aiditor', '"use strict"; return (' + contribution.source + ')')(aiditor)
          return maker(propsSig, ctx || {})
        }
        if (!uiTree) {
          const el = document.createElement('div')
          el.className = 'aiditor-extension-empty'
          el.textContent = contribution.title
          return el
        }
        const extCtx = Object.assign({}, ctx || {}, {
          extension: {
            id: manifest.id,
            owner: ownerFor(manifest.id),
            manifest: manifest,
            component: contribution.id,
          },
          data: propsSig,
        })
        return aiditor.ui.renderUITree(uiTree, extCtx)
      },
      dispose: function (el) {
        if (aiditor.ui && aiditor.ui.dispose) aiditor.ui.dispose(el)
      },
    }
  }

  function makeAdapterCall(adapters, adapterId, method) {
    return function (arg, ctx) {
      const adapter = adapters[adapterId]
      if (!adapter || !adapter[method]) return null
      return adapter[method](arg, ctx || {})
    }
  }

  function makeContextAdapterCall(adapters, adapterId, method) {
    return function (target, event, ctx) {
      const adapter = adapters[adapterId]
      if (!adapter || !adapter[method]) return method === 'match' ? true : null
      return adapter[method](target, event, ctx || {})
    }
  }

  function registerComponents(manifest, rollback) {
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.components
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      aiditor.registerComponent(c.publicId, makeComponentSpec(manifest, c), { owner: owner, layer: manifest.layer })
      rollback.push(function (name) {
        return function () { aiditor.unregisterComponent(name, { owner: owner }) }
      }(c.publicId))
    }
  }

  function registerTools(manifest, rollback, adapters) {
    const ai = aiditor.ai
    if (!ai || !ai.tools) return
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.tools
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      const adapterId = t.adapter || t.run && t.run.adapter
      const spec = {
        title: t.title || t.label || t.id,
        description: t.description || '',
        schema: clone(t.schema || null),
        permissions: clone(t.permissions || ['tool.call']),
        risk: t.risk || (t.permission && t.permission.risk) || null,
        origin: 'extension:' + manifest.id,
        available: t.available,
        preview: t.preview || (adapterId ? makeAdapterCall(adapters, adapterId, 'preview') : null),
        run: t.run && typeof t.run === 'function'
          ? t.run
          : (adapterId ? makeAdapterCall(adapters, adapterId, 'run') : null),
        apply: t.apply || (adapterId ? makeAdapterCall(adapters, adapterId, 'apply') : null),
      }
      ai.tools.register(t.publicId, spec, { owner: owner, layer: manifest.layer })
      rollback.push(function (name) {
        return function () { ai.tools.unregister(name, { owner: owner }) }
      }(t.publicId))
    }
  }

  function registerSkills(manifest, rollback) {
    const ai = aiditor.ai
    if (!ai || !ai.skills) return
    const owner = ownerFor(manifest.id)
    const toolIds = {}
    const tools = manifest.contributes.tools
    for (let i = 0; i < tools.length; i++) toolIds[tools[i].id] = tools[i].publicId
    const list = manifest.contributes.skills
    for (let j = 0; j < list.length; j++) {
      const item = list[j]
      const spec = {
        title: item.title || item.label || item.id,
        description: item.description || '',
        argumentHint: item.argumentHint || '',
        instructions: item.instructions || '',
        toolDisclosure: item.toolDisclosure || 'onRead',
        tools: (item.tools || []).map(function (name) { return toolIds[name] || name }),
        resources: clone(item.resources || []),
      }
      ai.skills.register(item.publicId, spec, { owner: owner, layer: manifest.layer, source: owner })
      rollback.push(function (name) {
        return function () { ai.skills.unregister(name, { owner: owner }) }
      }(item.publicId))
    }
  }

  function registerContextProviders(manifest, rollback, adapters) {
    const ai = aiditor.ai
    if (!ai || !ai.context) return
    const owner = ownerFor(manifest.id)
    const meta = { owner: owner, layer: manifest.layer }
    const list = manifest.contributes.context
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      const adapterId = c.adapter || c.provider && c.provider.adapter
      const provider = Object.assign({}, c.provider || {})
      if (adapterId) {
        provider.match = provider.match || makeContextAdapterCall(adapters, adapterId, 'match')
        provider.capture = provider.capture || makeContextAdapterCall(adapters, adapterId, 'capture')
      }
      ai.context.register(c.publicId, provider, meta)
      rollback.push(function (name) {
        return function () { ai.context.unregister(name, { owner: owner }) }
      }(c.publicId))
    }
  }

  function registerReferences(manifest, rollback, adapters) {
    const ai = aiditor.ai
    if (!ai || !ai.references) return
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.references
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      const adapterId = r.adapter
      const provider = Object.assign({}, r.provider || {})
      if (adapterId) {
        provider.describe = provider.describe || makeAdapterCall(adapters, adapterId, 'describe')
        provider.read = provider.read || makeAdapterCall(adapters, adapterId, 'read')
        provider.search = provider.search || makeAdapterCall(adapters, adapterId, 'search')
        provider.selection = provider.selection || makeAdapterCall(adapters, adapterId, 'selection')
        provider.schema = provider.schema || function () { return clone(r.schema || null) }
        provider.capabilities = provider.capabilities || function () { return clone(r.capabilities || []) }
      }
      ai.references.register(r.publicId, provider, { owner: owner, layer: manifest.layer })
      rollback.push(function (name) {
        return function () { ai.references.unregister(name, { owner: owner }) }
      }(r.publicId))
    }
  }

  function registerOperations(manifest, rollback, adapters) {
    const ai = aiditor.ai
    if (!ai || !ai.operations) return
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.operations
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      const adapterId = o.adapter
      const spec = {
        title: o.title || o.id,
        description: o.description || '',
        inputSchema: o.inputSchema || null,
        exposeToModel: o.exposeToModel === true,
        risk: o.risk || 'edit',
        preview: o.preview || (adapterId ? makeAdapterCall(adapters, adapterId, 'preview') : null),
        apply: o.apply || (adapterId ? makeAdapterCall(adapters, adapterId, 'apply') : null),
      }
      ai.operations.register(o.publicId, spec, { owner: owner, layer: manifest.layer })
      rollback.push(function (name) {
        return function () { ai.operations.unregister(name, { owner: owner }) }
      }(o.publicId))
    }
  }

  function registerCommands(manifest, rollback, adapters) {
    if (!aiditor.commands) return
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.commands
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      const adapterId = c.adapter || c.run && c.run.adapter
      const spec = {
        title: c.title || c.label || c.id,
        label: c.label || c.title || c.id,
        description: c.description || '',
        argumentHint: c.argumentHint || '',
        icon: c.icon || '',
        kbd: c.kbd || '',
        danger: !!c.danger,
        run: c.run && typeof c.run === 'function'
          ? c.run
          : (adapterId ? makeAdapterCall(adapters, adapterId, 'run') : null),
      }
      aiditor.commands.register(c.publicId, spec, { owner: owner, layer: manifest.layer })
      rollback.push(function (name) {
        return function () { aiditor.commands.unregister(name, { owner: owner }) }
      }(c.publicId))
    }
  }

  function registerMenus(manifest, rollback) {
    if (!aiditor.commands) return
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.menus
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      aiditor.commands.registerMenu(m.publicId, m, { owner: owner, layer: manifest.layer })
      rollback.push(function (name) {
        return function () { aiditor.commands.unregisterMenu(name, { owner: owner }) }
      }(m.publicId))
    }
  }

  function registerSettings(manifest, rollback) {
    if (!aiditor.settings) return
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.settings
    const meta = { owner: owner, layer: manifest.layer }
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      if (s.section) {
        const id = s.section.id || s.id || manifest.id
        aiditor.settings.registerSection(id, s.section, meta)
      }
      if (s.schemas) aiditor.settings.registerSchema(s.section && s.section.id || s.sectionId || s.id || manifest.id, s.schemas, meta)
      if (s.schema) aiditor.settings.registerSchema(s.section && s.section.id || s.sectionId || s.id || manifest.id, s.schema, meta)
      if (s.pages) {
        const pages = Array.isArray(s.pages) ? s.pages : [s.pages]
        for (let j = 0; j < pages.length; j++) aiditor.settings.registerPage(pages[j].id, pages[j], meta)
      }
      if (s.page) aiditor.settings.registerPage(s.page.id, s.page, meta)
    }
    rollback.push(function () { aiditor.settings.unregisterOwner(owner) })
  }

  function registerAll(manifest, rollback, adapters) {
    registerComponents(manifest, rollback)
    registerTools(manifest, rollback, adapters)
    registerSkills(manifest, rollback)
    registerContextProviders(manifest, rollback, adapters)
    registerReferences(manifest, rollback, adapters)
    registerOperations(manifest, rollback, adapters)
    registerCommands(manifest, rollback, adapters)
    registerMenus(manifest, rollback)
    registerSettings(manifest, rollback)
  }

  aiditor._extensionsInstall = {
    registerAll: registerAll,
  }
})(window.aiditor = window.aiditor || {})

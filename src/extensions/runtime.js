// aiditor.extensions owner-aware extension runtime.
;(function (aiditor) {
  'use strict'

  const extensions = {}
  const layouts = {}
  const adapters = {}
  const DEFAULT_STORAGE_KEY = 'aiditor.extensions.v1'
  let storageKey = DEFAULT_STORAGE_KEY
  let storage = null
  let safeModeEnabled = false
  let safeModeAllowApp = false
  let maxLayer = 'session'
  const disabledLayers = {}
  let permissionPolicy = null

  const Manifest = aiditor._extensionsManifest
  const Install = aiditor._extensionsInstall
  const clone = Manifest.clone
  const keys = Manifest.keys
  const ownerFor = Manifest.ownerFor
  const normalizeLayer = Manifest.normalizeLayer
  const layerRank = Manifest.layerRank
  const sourceHash = Manifest.sourceHash
  const normalizeManifest = Manifest.normalizeManifest
  const componentMap = Manifest.componentMap
  const resolveComponentRef = Manifest.resolveComponentRef
  const hasCodeContribution = Manifest.hasCodeContribution
  const extensionPermissions = Manifest.extensionPermissions
  const matchesPrefix = aiditor.names.matchesPrefix

  function defaultStorage() {
    try { return window.localStorage || null } catch (_) { return null }
  }

  function canActivateLayer(layer) {
    layer = normalizeLayer(layer)
    if (safeModeEnabled && layerRank(layer) > (safeModeAllowApp ? 1 : 0)) return false
    if (disabledLayers[layer]) return false
    return layerRank(layer) <= layerRank(maxLayer)
  }

  function configurePermissions(policy) {
    permissionPolicy = policy || null
    return permissionPolicy
  }

  function checkExtensionPermission(action, manifest, opts) {
    opts = opts || {}
    const details = {
      action: action,
      manifest: manifest,
      permissions: extensionPermissions(manifest),
      allowCode: !!opts.allowCode,
      actor: opts.actor || 'user',
      agentId: opts.agentId || null,
      origin: 'extension:' + manifest.id,
      risk: hasCodeContribution(manifest) ? 'install' : 'write',
    }
    if (permissionPolicy && permissionPolicy[action]) return permissionPolicy[action](details) === true
    if (permissionPolicy && permissionPolicy.can) return permissionPolicy.can(details) === true
    if (aiditor.ai && aiditor.ai.decidePermission) {
      return aiditor.ai.decidePermission(details.actor, details.agentId, 'extension.' + action, {
        extensionId: manifest.id,
        entry: 'extension.' + action,
        phase: action === 'preview' ? 'preview' : action,
        origin: details.origin,
        risk: details.risk,
        target: manifest.id,
        permissions: details.permissions,
      }).allowed === true
    }
    return true
  }

  function validateInstall(manifest, opts) {
    opts = opts || {}
    const action = opts.action || 'install'
    if (!checkExtensionPermission(action, manifest, opts)) {
      throw new Error('Extension ' + action + ' permission denied: ' + manifest.id)
    }
    if (hasCodeContribution(manifest) && !opts.allowCode) {
      throw new Error('Code panel contribution requires allowCode')
    }
    const errors = collectValidationErrors(manifest, opts)
    if (errors.length) throw new Error(errors[0].message)
  }

  function collectValidationErrors(manifest, opts) {
    opts = opts || {}
    const errors = []
    const owner = ownerFor(manifest.id)
    const list = manifest.contributes.components
    for (let i = 0; i < list.length; i++) {
      const trustError = Manifest.codeTrustError(manifest, list[i])
      if (trustError) errors.push({ path: 'contributes.components[' + i + '].kind', message: trustError })
      if (list[i].kind === 'factory' && !list[i].source) {
        errors.push({ path: 'contributes.components[' + i + '].source', message: 'Factory component requires source: ' + list[i].publicId })
      }
      if ((list[i].kind === 'factory' || list[i].kind === 'iframe') && list[i].hash && list[i].hash !== sourceHash(list[i].source || list[i].srcdoc || '')) {
        errors.push({ path: 'contributes.components[' + i + '].hash', message: 'Code panel hash mismatch: ' + list[i].publicId })
      }
      const existing = aiditor.componentRegistration && aiditor.componentRegistration(list[i].publicId)
      if (existing && existing.owner !== owner) {
        errors.push({ path: 'contributes.components[' + i + '].id', message: 'Component already registered: ' + list[i].publicId })
      }
    }
    validateRegistryConflicts(manifest, owner, errors)
    Manifest.validatePublicNames(manifest, errors)
    Manifest.validateComponentUi(manifest, errors)
    validateAdapters(manifest, errors)
    if (!opts.deferLayout) validateDockTargets(manifest, errors)
    return errors
  }

  function validateRegistryConflicts(manifest, owner, errors) {
    const ai = aiditor.ai
    function check(listName, registry, label) {
      const list = manifest.contributes[listName] || []
      for (let i = 0; i < list.length; i++) {
        const id = list[i].publicId
        const existing = registry && registry.get && registry.get(id)
        const meta = registry && registry.meta && registry.meta(id) || {}
        if (existing && meta.owner !== owner) {
          errors.push({ path: 'contributes.' + listName + '[' + i + '].id', message: label + ' already registered: ' + id })
        }
      }
    }
    check('tools', ai && ai.tools, 'Tool')
    check('skills', ai && ai.skills, 'Skill')
    check('context', ai && ai.context, 'Context provider')
    check('references', ai && ai.references, 'Reference provider')
    check('operations', ai && ai.operations, 'Operation')
    check('commands', aiditor.commands, 'Command')
    const menus = manifest.contributes.menus || []
    for (let j = 0; j < menus.length; j++) {
      const id = menus[j].publicId
      const exists = aiditor.commands && aiditor.commands.listMenus && aiditor.commands.listMenus().indexOf(id) >= 0
      const meta = aiditor.commands && aiditor.commands.menuMeta && aiditor.commands.menuMeta(id) || {}
      if (exists && meta.owner !== owner) {
        errors.push({ path: 'contributes.menus[' + j + '].id', message: 'Menu already registered: ' + id })
      }
    }
  }

  function validateAdapters(manifest, errors) {
    const tools = manifest.contributes.tools || []
    for (let t = 0; t < tools.length; t++) {
      const toolAdapterId = tools[t].adapter || tools[t].run && tools[t].run.adapter
      if (toolAdapterId && !adapters[toolAdapterId]) {
        errors.push({ path: 'contributes.tools[' + t + '].adapter', message: 'Adapter not registered: ' + toolAdapterId })
      }
    }
    const context = manifest.contributes.context || []
    for (let c = 0; c < context.length; c++) {
      const contextAdapterId = context[c].adapter || context[c].provider && context[c].provider.adapter
      if (contextAdapterId && !adapters[contextAdapterId]) {
        errors.push({ path: 'contributes.context[' + c + '].adapter', message: 'Adapter not registered: ' + contextAdapterId })
      }
    }
    const refs = manifest.contributes.references || []
    for (let i = 0; i < refs.length; i++) {
      if (refs[i].adapter && !adapters[refs[i].adapter]) {
        errors.push({ path: 'contributes.references[' + i + '].adapter', message: 'Adapter not registered: ' + refs[i].adapter })
      }
    }
    const ops = manifest.contributes.operations || []
    for (let j = 0; j < ops.length; j++) {
      if (ops[j].adapter && !adapters[ops[j].adapter]) {
        errors.push({ path: 'contributes.operations[' + j + '].adapter', message: 'Adapter not registered: ' + ops[j].adapter })
      }
    }
    const cmds = manifest.contributes.commands || []
    for (let k = 0; k < cmds.length; k++) {
      const adapterId = cmds[k].adapter || cmds[k].run && cmds[k].run.adapter
      if (adapterId && !adapters[adapterId]) {
        errors.push({ path: 'contributes.commands[' + k + '].adapter', message: 'Adapter not registered: ' + adapterId })
      }
    }
  }

  function validateDockTargets(manifest, errors) {
    const docks = manifest.contributes.dockPanels || []
    const map = componentMap(manifest)
    for (let i = 0; i < docks.length; i++) {
      if (docks[i].mode === 'manual') continue
      const layout = resolveLayout(docks[i].layout)
      if (!layout || !layout.tree) {
        errors.push({ path: 'contributes.dockPanels[' + i + '].layout', message: 'Layout not registered: ' + docks[i].layout })
        continue
      }
      const dockName = docks[i].dock || docks[i].dockId || docks[i].target || 'main'
      if (!dockExists(layout.tree(), dockName)) {
        errors.push({ path: 'contributes.dockPanels[' + i + '].dock', message: 'Dock not found: ' + dockName })
      }
      const component = resolveComponentRef(map, docks[i].component)
      if (!map[docks[i].component] && !(aiditor.componentRegistration && aiditor.componentRegistration(component))) {
        errors.push({ path: 'contributes.dockPanels[' + i + '].component', message: 'Component not registered: ' + component })
      }
    }
  }

  function dockExists(tree, idOrName) {
    let hit = false
    function walk(n) {
      if (!n || hit) return
      if (n.type === 'dock') {
        if (n.id === idOrName || n.name === idOrName) hit = true
      } else if (n.children) {
        for (let i = 0; i < n.children.length; i++) walk(n.children[i])
      }
    }
    walk(tree)
    return hit
  }

  function registerLayout(name, handle) {
    name = name || 'default'
    layouts[name] = handle
    applyPendingDockPanels()
    return function () {
      if (layouts[name] === handle) delete layouts[name]
    }
  }

  function firstLayout() {
    const names = keys(layouts)
    return names.length ? layouts[names[0]] : null
  }

  function resolveLayout(name) {
    if (name) return layouts[name] || null
    return layouts.default || firstLayout()
  }

  function inspectDocks(input) {
    input = input || {}
    const selected = input.layout ? [input.layout] : keys(layouts)
    const out = []
    for (let i = 0; i < selected.length; i++) {
      const name = selected[i]
      const layout = layouts[name]
      if (!layout) {
        if (input.layout) throw new Error('Layout not registered: ' + input.layout)
        continue
      }
      const docks = layout.inspectDocks ? layout.inspectDocks() : inspectDocksFromTree(layout.tree && layout.tree())
      for (let j = 0; j < docks.length; j++) out.push(Object.assign({ layout: name }, docks[j]))
    }
    return out
  }

  function inspectDocksFromTree(tree) {
    const out = []
    function walk(node) {
      if (!node) return
      if (node.type === 'dock') {
        const panels = node.panels || []
        out.push({
          dockId: node.id,
          name: node.name || '',
          rect: null,
          visible: null,
          activeId: node.activeId || null,
          panels: panels.map(function (panel) {
            return {
              panelId: panel.id,
              component: panel.component,
              title: panel.title || panel.component,
              active: node.activeId === panel.id,
              transient: !!panel.transient,
              dirty: !!panel.dirty,
            }
          }),
          panelCount: panels.length,
          accept: node.accept || null,
          collapsed: !!node.collapsed,
          focused: !!node.focused,
        })
        return
      }
      for (let i = 0; node.children && i < node.children.length; i++) walk(node.children[i])
    }
    walk(tree)
    return out
  }

  function panelDockTarget(input) {
    return input.dock || input.dockId || input.target || 'main'
  }

  function runtimeScriptPath(input) {
    return input.path || input.entryPath || input.src || ''
  }

  function runtimeScriptOwner(input) {
    if (input.owner) return String(input.owner)
    const meta = aiditor.ai && aiditor.ai.workspaceMeta && aiditor.ai.workspaceMeta()
    return 'workspace:' + String(meta && meta.id || meta && meta.label || 'current')
  }

  function currentWorkspace() {
    return aiditor.ai && aiditor.ai.currentWorkspace && aiditor.ai.currentWorkspace()
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function registrationPattern(component) {
    return new RegExp(
      '(aiditor\\s*\\.\\s*registerComponent|registerComponent|Demo\\s*\\.\\s*project\\s*\\.\\s*component)' +
      '\\s*\\(\\s*[\'"]' + escapeRegExp(component) + '[\'"]'
    )
  }

  function uniqueJsPaths(results) {
    const seen = {}
    const out = []
    for (let i = 0; i < (results || []).length; i++) {
      const path = String(results[i] && results[i].path || '').replace(/\\/g, '/')
      const lower = path.toLowerCase()
      if (!path || seen[path]) continue
      if (!/\.js$/.test(lower)) continue
      if (lower.indexOf('node_modules/') === 0 || lower.indexOf('.git/') === 0 || lower.indexOf('aiditor-runtime/') === 0) continue
      seen[path] = true
      out.push(path)
    }
    return out
  }

  function findComponentScript(component) {
    const ws = currentWorkspace()
    const pattern = registrationPattern(component)
    if (!ws || !ws.search) return Promise.resolve({ matches: [], reason: 'Current workspace is required to find component script.' })
    return ws.search(component, {
      limit: 50,
      include: ['*.js', '**/*.js'],
      exclude: ['node_modules/**', '.git/**', 'aiditor-runtime/**'],
    }).then(function (results) {
      const paths = uniqueJsPaths(results)
      const matches = []
      function readNext(index) {
        if (index >= paths.length) return Promise.resolve({ matches: matches })
        return ws.readText(paths[index]).then(function (file) {
          if (pattern.test(file.text)) matches.push({ path: paths[index], file: file })
          return readNext(index + 1)
        }, function () {
          return readNext(index + 1)
        })
      }
      return readNext(0)
    }, function (err) {
      return { matches: [], reason: String(err && err.message || err) }
    })
  }

  function loadRuntimeScriptForPanel(input, preview) {
    const path = runtimeScriptPath(input)
    if (!path || aiditor.componentRegistration && aiditor.componentRegistration(input.component)) return Promise.resolve(null)
    const ws = currentWorkspace()
    if (!ws) return Promise.reject(new Error('aiditor.addPanelToDock: current workspace is required to load ' + path))
    if (!aiditor.runtime || !aiditor.runtime.loadScript) return Promise.reject(new Error('aiditor.runtime.loadScript is not available'))
    return ws.readText(path).then(function (file) {
      if (preview && preview.hash && file.hash !== preview.hash) throw new Error('aiditor.addPanelToDock: script changed since preview')
      return aiditor.runtime.loadScript({
        id: input.id || path,
        path: path,
        source: file.text,
        type: 'script',
        owner: runtimeScriptOwner(input),
        layer: input.layer || 'workspace',
      })
    })
  }

  function loadRuntimeScriptForReload(input, preview) {
    const path = runtimeScriptPath(input)
    if (!path) return Promise.resolve(null)
    const ws = currentWorkspace()
    if (!ws) return Promise.reject(new Error('aiditor.reloadPanel: current workspace is required to load ' + path))
    if (!aiditor.runtime || !aiditor.runtime.loadScript) return Promise.reject(new Error('aiditor.runtime.loadScript is not available'))
    return ws.readText(path).then(function (file) {
      if (preview && preview.hash && file.hash !== preview.hash) throw new Error('aiditor.reloadPanel: script changed since preview')
      return aiditor.runtime.loadScript({
        id: input.id || path,
        path: path,
        source: file.text,
        type: 'script',
        owner: runtimeScriptOwner(input),
        layer: input.layer || 'workspace',
        replace: true,
      })
    })
  }

  function panelPartialFromInput(input, opts) {
    opts = opts || {}
    const component = resolveComponentRef(opts.componentMap || {}, input.component)
    const partial = {
      component: component,
      title: input.title,
      icon: input.icon,
      props: clone(input.props || {}),
      owner: input.owner || opts.owner || null,
      extensionId: input.extensionId || opts.extensionId || null,
    }
    const sourcePath = runtimeScriptPath(input)
    if (sourcePath) partial.sourcePath = sourcePath
    return partial
  }

  function placePanel(input, opts) {
    opts = opts || {}
    input = input || {}
    const layout = resolveLayout(input.layout)
    if (!layout) {
      if (opts.deferLayout) return { pendingLayout: true }
      throw new Error('Layout not registered: ' + (input.layout || 'default'))
    }
    const component = resolveComponentRef(opts.componentMap || {}, input.component)
    const result = layout.addPanel(panelDockTarget(input), panelPartialFromInput(input, opts), { transient: !!input.transient })
    if (!result || !result.panelId) {
      if (opts.deferLayout) return { pendingLayout: true }
      throw new Error('Dock not found: ' + panelDockTarget(input))
    }
    if (opts.rollback) {
      opts.rollback.push(function (handle, panelId) {
        return function () { handle.removePanel(panelId) }
      }(layout, result.panelId))
    }
    const failure = panelHealthError(layout, result.panelId)
    if (failure) {
      layout.removePanel(result.panelId)
      throw new Error(failure)
    }
    return Object.assign({ component: component }, result)
  }

  function addDockPanels(manifest, rollback, opts) {
    opts = opts || {}
    const owner = ownerFor(manifest.id)
    const map = componentMap(manifest)
    const list = manifest.contributes.dockPanels
    const added = []
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (p.mode === 'manual') continue
      const placed = placePanel(p, {
        componentMap: map,
        owner: owner,
        extensionId: manifest.id,
        rollback: rollback,
        deferLayout: opts.deferLayout,
      })
      if (placed.pendingLayout) { added.pendingLayout = true; continue }
      added.push(placed.panelId)
    }
    return added
  }

  function panelHealthError(layout, panelId) {
    const info = layout.inspectPanel && layout.inspectPanel(panelId)
    if (!info) return ''
    if (info.textSample && /\{\{[\s\S]*?\}\}/.test(info.textSample)) return 'Panel rendered unresolved template text: {{...}}'
    if (info.status !== 'error') return ''
    return 'Panel failed to render: ' + info.component + ' (' + panelId + '): ' + (info.error && info.error.message || 'unknown error')
  }

  function panelSmokeError(layout, panelId) {
    const info = layout.inspectPanel && layout.inspectPanel(panelId)
    if (!info) return ''
    if (info.status === 'error') return panelHealthError(layout, panelId)
    if (info.textSample && /\{\{[\s\S]*?\}\}/.test(info.textSample)) return 'Panel rendered unresolved template text: {{...}}'
    return ''
  }

  function applyPendingDockPanels() {
    const ids = keys(extensions)
    for (let i = 0; i < ids.length; i++) {
      const entry = extensions[ids[i]]
      if (!entry.active || !entry.pendingLayout || entry.panels.length) continue
      const rollback = []
      try {
        const panels = addDockPanels(entry.manifest, rollback, { deferLayout: true })
        entry.panels = panels
        entry.pendingLayout = !!panels.pendingLayout
      } catch (err) {
        for (let j = rollback.length - 1; j >= 0; j--) rollback[j]()
        entry.lastError = String(err && err.message || err)
      }
    }
  }

  function removeExtensionPanels(entry) {
    const removed = []
    const names = keys(layouts)
    for (let i = 0; i < names.length; i++) {
      const layout = layouts[names[i]]
      const ids = panelsByExtension(layout.tree(), entry)
      for (let j = 0; j < ids.length; j++) {
        layout.removePanel(ids[j])
        removed.push(ids[j])
      }
    }
    return removed
  }

  function removeRecoveryPanels(extensionId) {
    const removed = []
    const names = keys(layouts)
    for (let i = 0; i < names.length; i++) {
      const layout = layouts[names[i]]
      const ids = recoveryPanels(layout.tree(), extensionId)
      for (let j = 0; j < ids.length; j++) {
        layout.removePanel(ids[j])
        removed.push(ids[j])
      }
    }
    return removed
  }

  function recoveryPanels(tree, extensionId) {
    const out = []
    function walk(n) {
      if (!n) return
      if (n.type === 'dock') {
        const panels = n.panels || []
        for (let i = 0; i < panels.length; i++) {
          const props = panels[i].props || {}
          if (panels[i].component === 'extension-disabled' && props.extensionId === extensionId) out.push(panels[i].id)
        }
      } else if (n.children) {
        for (let i = 0; i < n.children.length; i++) walk(n.children[i])
      }
    }
    walk(tree)
    return out
  }

  function panelsByExtension(tree, entry) {
    const out = []
    const owner = entry.owner
    const id = entry.manifest.id
    function walk(n) {
      if (!n) return
      if (n.type === 'dock') {
        const panels = n.panels || []
        for (let i = 0; i < panels.length; i++) {
          if (
            panels[i].owner === owner ||
            panels[i].extensionId === id ||
            matchesPrefix(panels[i].component || '', id + '/')
          ) out.push(panels[i].id)
        }
      } else if (n.children) {
        for (let i = 0; i < n.children.length; i++) walk(n.children[i])
      }
    }
    walk(tree)
    return out
  }

  function ownedComponents(manifest) {
    const out = {}
    const list = manifest.contributes.components || []
    for (let i = 0; i < list.length; i++) out[list[i].publicId] = true
    return out
  }

  function replaceExternalPanels(entry) {
    const owned = ownedComponents(entry.manifest)
    const names = keys(layouts)
    for (let i = 0; i < names.length; i++) {
      const layout = layouts[names[i]]
      if (!layout.setTree) continue
      const next = mapPanels(layout.tree(), function (panel) {
        if (!owned[panel.component] || panel.owner === entry.owner) return panel
        const props = {
          extensionId: entry.manifest.id,
          extensionTitle: entry.manifest.title,
          component: panel.component,
          previousPanel: clone(panel),
        }
        return Object.assign({}, panel, {
          component: 'extension-disabled',
          title: panel.title || 'Extension disabled',
          icon: 'alert-triangle',
          props: props,
        })
      })
      if (next !== layout.tree()) layout.setTree(next)
    }
  }

  function restoreRecoveryPanels(entry) {
    const names = keys(layouts)
    for (let i = 0; i < names.length; i++) {
      const layout = layouts[names[i]]
      if (!layout.setTree) continue
      const next = mapPanels(layout.tree(), function (panel) {
        const props = panel.props || {}
        if (panel.component !== 'extension-disabled' || props.extensionId !== entry.manifest.id || !props.previousPanel) return panel
        return props.previousPanel
      })
      if (next !== layout.tree()) layout.setTree(next)
    }
  }

  function mapPanels(node, fn) {
    if (!node) return node
    if (node.type === 'dock') {
      let changed = false
      const panels = (node.panels || []).map(function (panel) {
        const next = fn(panel)
        if (next !== panel) changed = true
        return next
      })
      return changed ? Object.assign({}, node, { panels: panels }) : node
    }
    if (!node.children) return node
    let changedChildren = false
    const children = node.children.map(function (child) {
      const next = mapPanels(child, fn)
      if (next !== child) changedChildren = true
      return next
    })
    return changedChildren ? Object.assign({}, node, { children: children }) : node
  }

  function previewExtension(input) {
    const manifest = normalizeManifest(input && input.manifest ? input.manifest : input)
    const errors = collectValidationErrors(manifest, input || {})
    const owner = ownerFor(manifest.id)
    const changes = []
    const c = manifest.contributes.components
    for (let i = 0; i < c.length; i++) changes.push({ type: 'component', id: c[i].publicId, owner: owner })
    const d = manifest.contributes.dockPanels
    for (let j = 0; j < d.length; j++) changes.push({ type: 'dockPanel', dock: d[j].dock || d[j].dockId || d[j].target || 'main', component: d[j].component })
    const tools = manifest.contributes.tools
    for (let t = 0; t < tools.length; t++) changes.push({ type: 'tool', id: tools[t].publicId, owner: owner })
    const skills = manifest.contributes.skills
    for (let u = 0; u < skills.length; u++) changes.push({ type: 'skill', id: skills[u].publicId, owner: owner })
    const context = manifest.contributes.context
    for (let q = 0; q < context.length; q++) changes.push({ type: 'context', id: context[q].publicId, owner: owner })
    const r = manifest.contributes.references
    for (let k = 0; k < r.length; k++) changes.push({ type: 'reference', id: r[k].publicId, owner: owner })
    const o = manifest.contributes.operations
    for (let x = 0; x < o.length; x++) changes.push({ type: 'operation', id: o[x].publicId, owner: owner })
    const cmds = manifest.contributes.commands
    for (let y = 0; y < cmds.length; y++) changes.push({ type: 'command', id: cmds[y].publicId, owner: owner })
    const menus = manifest.contributes.menus
    for (let z = 0; z < menus.length; z++) changes.push({ type: 'menu', id: menus[z].publicId, target: menus[z].target })
    const settings = manifest.contributes.settings
    for (let s = 0; s < settings.length; s++) changes.push({ type: 'settings', id: settings[s].id || settings[s].sectionId || manifest.id })
    return {
      ok: errors.length === 0,
      risk: 'edit',
      title: 'Install extension: ' + manifest.title,
      summary: changes.length + ' contribution(s)',
      manifest: manifest,
      input: clone(input || {}),
      changes: changes,
      permissions: extensionPermissions(manifest),
      requiresApproval: hasCodeContribution(manifest),
      errors: errors,
      warnings: hasCodeContribution(manifest) ? ['Code panel contribution requires explicit allowCode approval.'] : [],
    }
  }

  function reviewInstall(input, opts) {
    opts = opts || {}
    const preview = previewExtension(input)
    const manifest = preview.manifest
    const canInstall = preview.ok && checkExtensionPermission('install', manifest, opts)
    return Object.assign({}, preview, {
      canInstall: canInstall,
      canApply: canInstall && (!hasCodeContribution(manifest) || !!opts.allowCode),
      requiredConsent: hasCodeContribution(manifest) && !opts.allowCode ? 'allowCode' : null,
    })
  }

  function installWithReview(input, opts) {
    opts = opts || {}
    const review = reviewInstall(input, opts)
    if (!review.canInstall) return Promise.resolve(Object.assign({}, review, { installed: false, error: 'Permission denied' }))
    if (review.canApply && !opts.confirm) return Promise.resolve(installExtension(review.manifest, opts))
    if (!aiditor.ui || !aiditor.ui.confirm) return Promise.resolve(review)
    const lines = [
      review.title,
      review.summary,
      review.permissions.length ? 'Permissions: ' + review.permissions.join(', ') : '',
      review.requiredConsent ? 'Requires explicit consent: ' + review.requiredConsent : '',
    ].filter(Boolean)
    return aiditor.ui.confirm(lines.join('\n')).then(function (ok) {
      if (!ok) return Object.assign({}, review, { installed: false, cancelled: true })
      return installExtension(review.manifest, Object.assign({}, opts, { allowCode: opts.allowCode || review.requiredConsent === 'allowCode' }))
    })
  }

  function activateEntry(entry) {
    if (entry.active) return { ok: true, active: true, id: entry.manifest.id, panels: entry.panels || [] }
    if (!canActivateLayer(entry.manifest.layer)) return { ok: true, active: false, filtered: true, id: entry.manifest.id, layer: entry.manifest.layer }
    const rollback = []
    try {
      validateInstall(entry.manifest, { action: entry.action || 'install', allowCode: !!entry.allowCode, actor: entry.actor, agentId: entry.agentId, deferLayout: !!entry.deferLayout || keys(layouts).length === 0 })
      Install.registerAll(entry.manifest, rollback, adapters)
      restoreRecoveryPanels(entry)
      const panels = addDockPanels(entry.manifest, rollback, { deferLayout: !!entry.deferLayout || keys(layouts).length === 0 })
      entry.panels = panels
      entry.pendingLayout = !!panels.pendingLayout
      entry.active = true
      entry.lastError = null
      return { ok: true, active: true, id: entry.manifest.id, panels: entry.panels }
    } catch (err) {
      for (let i = rollback.length - 1; i >= 0; i--) rollback[i]()
      entry.active = false
      entry.panels = []
      entry.lastError = String(err && err.message || err)
      throw err
    }
  }

  function deactivateEntry(entry, opts) {
    opts = opts || {}
    const owner = entry.owner
    if (opts.replaceExternal !== false) replaceExternalPanels(entry)
    const removedPanels = removeExtensionPanels(entry)
    unregisterOwned(aiditor.ai && aiditor.ai.tools, owner)
    unregisterOwned(aiditor.ai && aiditor.ai.skills, owner)
    unregisterOwned(aiditor.ai && aiditor.ai.context, owner)
    unregisterOwned(aiditor.ai && aiditor.ai.references, owner)
    unregisterOwned(aiditor.ai && aiditor.ai.operations, owner)
    unregisterOwned(aiditor.commands, owner)
    unregisterOwned(aiditor.settings, owner)
    aiditor.unregisterComponentOwner(owner)
    entry.active = false
    entry.panels = []
    return removedPanels
  }

  function unregisterOwned(registry, owner) {
    if (!registry) return
    registry.unregisterOwner(owner)
  }

  function saveExtensions() {
    if (!storage) return
    const entries = keys(extensions).map(function (id) {
      const entry = extensions[id]
      return {
        manifest: clone(entry.manifest),
        enabled: entry.enabled !== false,
        allowCode: !!entry.allowCode,
        actor: entry.actor || null,
        agentId: entry.agentId || null,
        deferLayout: !!entry.deferLayout,
        installedAt: entry.installedAt,
        updatedAt: entry.updatedAt,
      }
    })
    storage.setItem(storageKey, JSON.stringify({ version: 1, entries: entries }))
  }

  function loadStoredEntries() {
    if (!storage) return []
    const raw = storage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return parsed && parsed.entries ? parsed.entries : []
  }

  function clearRuntimeEntries() {
    const ids = keys(extensions)
    for (let i = 0; i < ids.length; i++) {
      const entry = extensions[ids[i]]
      if (entry.active) deactivateEntry(entry)
      delete extensions[ids[i]]
    }
  }

  function installExtension(input, opts) {
    opts = opts || {}
    const manifest = normalizeManifest(input && input.manifest ? input.manifest : input)
    const owner = ownerFor(manifest.id)
    const previous = extensions[manifest.id] ? {
      manifest: clone(extensions[manifest.id].manifest),
      enabled: extensions[manifest.id].enabled !== false,
      active: !!extensions[manifest.id].active,
      allowCode: !!extensions[manifest.id].allowCode,
      action: extensions[manifest.id].action,
      actor: extensions[manifest.id].actor,
      agentId: extensions[manifest.id].agentId,
      installedAt: extensions[manifest.id].installedAt,
    } : null
    if (previous && extensions[manifest.id].active) deactivateEntry(extensions[manifest.id], { replaceExternal: false })
    try {
      const now = Date.now()
      const entry = {
        manifest: manifest,
        owner: owner,
        panels: [],
        enabled: opts.enabled === false ? false : true,
        allowCode: !!opts.allowCode,
        action: opts.action || 'install',
        deferLayout: !!opts.deferLayout,
        actor: opts.actor || 'user',
        agentId: opts.agentId || null,
        active: false,
        installedAt: previous ? previous.installedAt : now,
        updatedAt: now,
      }
      extensions[manifest.id] = entry
      if (entry.enabled) activateEntry(entry)
      if (opts.save !== false) saveExtensions()
      return { ok: true, installed: true, id: manifest.id, owner: owner, enabled: entry.enabled, active: entry.active, panels: entry.panels }
    } catch (err) {
      delete extensions[manifest.id]
      if (previous) {
        extensions[manifest.id] = {
          manifest: previous.manifest,
          owner: owner,
          panels: [],
          enabled: previous.enabled,
          allowCode: previous.allowCode,
          action: previous.action,
          deferLayout: previous.deferLayout,
          actor: previous.actor,
          agentId: previous.agentId,
          active: false,
          installedAt: previous.installedAt,
          updatedAt: Date.now(),
        }
        if (previous.active) activateEntry(extensions[manifest.id])
      }
      throw err
    }
  }

  function uninstallExtension(id, opts) {
    opts = opts || {}
    const entry = extensions[id]
    const owner = entry ? entry.owner : ownerFor(id)
    if (entry && !checkExtensionPermission('uninstall', entry.manifest, opts)) throw new Error('Extension uninstall permission denied: ' + id)
    const removedPanels = entry
      ? deactivateEntry(entry)
      : removeExtensionPanels({ owner: owner, manifest: { id: id } })
    const removedRecovery = removeRecoveryPanels(id)
    delete extensions[id]
    if (opts.save !== false) saveExtensions()
    return { ok: true, removed: true, id: id, owner: owner, panels: removedPanels.concat(removedRecovery) }
  }

  function updateExtension(id, manifest, opts) {
    manifest = normalizeManifest(manifest)
    if (manifest.id !== id) throw new Error('Extension update id mismatch: ' + id)
    return installExtension(manifest, Object.assign({}, opts || {}, { action: 'update' }))
  }

  function enableExtension(id, opts) {
    opts = opts || {}
    const entry = extensions[id]
    if (!entry) throw new Error('Extension not found: ' + id)
    if (!checkExtensionPermission('enable', entry.manifest, opts)) throw new Error('Extension enable permission denied: ' + id)
    entry.enabled = true
    const result = activateEntry(entry)
    if (opts.save !== false) saveExtensions()
    return Object.assign({ enabled: true }, result)
  }

  function disableExtension(id, opts) {
    opts = opts || {}
    const entry = extensions[id]
    if (!entry) throw new Error('Extension not found: ' + id)
    if (!checkExtensionPermission('disable', entry.manifest, opts)) throw new Error('Extension disable permission denied: ' + id)
    const panels = entry.active ? deactivateEntry(entry) : []
    entry.enabled = false
    if (opts.save !== false) saveExtensions()
    return { ok: true, disabled: true, id: id, panels: panels }
  }

  function setLayer(id, layer, opts) {
    opts = opts || {}
    const entry = extensions[id]
    if (!entry) throw new Error('Extension not found: ' + id)
    if (!checkExtensionPermission('promote', entry.manifest, opts)) throw new Error('Extension promote permission denied: ' + id)
    const manifest = clone(entry.manifest)
    manifest.layer = normalizeLayer(layer)
    return installExtension(manifest, {
      enabled: entry.enabled !== false,
      allowCode: !!entry.allowCode,
      save: opts.save,
    })
  }

  function removePanelFromDock(input) {
    input = input || {}
    const layout = resolveLayout(input.layout)
    if (!layout) throw new Error('Layout not registered: ' + (input.layout || 'default'))
    const ids = input.panelId ? [input.panelId] : findPanels(layout.tree(), input)
    for (let i = 0; i < ids.length; i++) layout.removePanel(ids[i])
    return { ok: true, removed: ids }
  }

  function findPanels(tree, input) {
    const out = []
    function walk(n) {
      if (!n) return
      if (n.type === 'dock') {
        if (input.dock && n.id !== input.dock && n.name !== input.dock) return
        const panels = n.panels || []
        for (let i = 0; i < panels.length; i++) {
          if (input.owner && panels[i].owner !== input.owner) continue
          if (input.extensionId && panels[i].extensionId !== input.extensionId) continue
          if (input.component && panels[i].component !== input.component) continue
          out.push(panels[i].id)
        }
      } else if (n.children) {
        for (let i = 0; i < n.children.length; i++) walk(n.children[i])
      }
    }
    walk(tree)
    return out
  }

  function setSafeMode(enable, opts) {
    opts = opts || {}
    safeModeEnabled = !!enable
    safeModeAllowApp = !!opts.allowApp
    const ids = keys(extensions)
    const results = []
    for (let i = 0; i < ids.length; i++) {
      const entry = extensions[ids[i]]
      if (!canActivateLayer(entry.manifest.layer) && entry.active) {
        results.push({ id: ids[i], panels: deactivateEntry(entry), active: false })
      } else if (canActivateLayer(entry.manifest.layer) && entry.enabled && !entry.active) {
        try {
          results.push(activateEntry(entry))
        } catch (err) {
          results.push({ ok: false, id: ids[i], error: String(err && err.message || err) })
        }
      }
    }
    if (opts.save !== false) saveExtensions()
    return { ok: true, safeMode: safeModeEnabled, allowApp: safeModeAllowApp, results: results }
  }

  function refreshActivation(opts) {
    opts = opts || {}
    const ids = keys(extensions)
    const results = []
    for (let i = 0; i < ids.length; i++) {
      const entry = extensions[ids[i]]
      if (!canActivateLayer(entry.manifest.layer) && entry.active) {
        results.push({ id: ids[i], panels: deactivateEntry(entry), active: false })
      } else if (canActivateLayer(entry.manifest.layer) && entry.enabled && !entry.active) {
        try {
          results.push(activateEntry(entry))
        } catch (err) {
          results.push({ ok: false, id: ids[i], error: String(err && err.message || err) })
        }
      }
    }
    if (opts.save !== false) saveExtensions()
    return results
  }

  function setMaxLayer(layer, opts) {
    maxLayer = normalizeLayer(layer)
    const results = refreshActivation(opts || {})
    return { ok: true, maxLayer: maxLayer, results: results }
  }

  function disableLayer(layer, opts) {
    layer = normalizeLayer(layer)
    disabledLayers[layer] = true
    const results = refreshActivation(opts || {})
    return { ok: true, layer: layer, disabled: true, results: results }
  }

  function enableLayer(layer, opts) {
    layer = normalizeLayer(layer)
    delete disabledLayers[layer]
    const results = refreshActivation(opts || {})
    return { ok: true, layer: layer, disabled: false, results: results }
  }

  function bootExtensions(opts) {
    opts = opts || {}
    safeModeEnabled = !!opts.safeMode
    safeModeAllowApp = !!opts.allowApp
    if (opts.maxLayer) maxLayer = normalizeLayer(opts.maxLayer)
    if (opts.disabledLayers) {
      keys(disabledLayers).forEach(function (layer) { delete disabledLayers[layer] })
      for (let i = 0; i < opts.disabledLayers.length; i++) disabledLayers[normalizeLayer(opts.disabledLayers[i])] = true
    }
    clearRuntimeEntries()
    const stored = loadStoredEntries()
    for (let i = 0; i < stored.length; i++) {
      const manifest = normalizeManifest(stored[i].manifest)
      const entry = {
        manifest: manifest,
        owner: ownerFor(manifest.id),
        panels: [],
        enabled: stored[i].enabled !== false,
        allowCode: !!stored[i].allowCode,
        actor: stored[i].actor || 'user',
        agentId: stored[i].agentId || null,
        deferLayout: true,
        active: false,
        installedAt: stored[i].installedAt || Date.now(),
        updatedAt: stored[i].updatedAt || Date.now(),
      }
      extensions[manifest.id] = entry
      if (entry.enabled) {
        try { activateEntry(entry) }
        catch (_) {}
      }
    }
    return { ok: true, booted: true, safeMode: safeModeEnabled, allowApp: safeModeAllowApp, maxLayer: maxLayer, count: keys(extensions).length }
  }

  function configureStorage(opts) {
    opts = opts || {}
    storageKey = opts.key || DEFAULT_STORAGE_KEY
    storage = opts.storage === null ? null : (opts.storage || defaultStorage())
    if (opts.load !== false) return bootExtensions({ safeMode: !!opts.safeMode })
    return { ok: true, configured: true, key: storageKey }
  }

  function clearStoredExtensions() {
    if (storage) storage.removeItem(storageKey)
  }

  function registerAdapter(id, spec) {
    adapters[id] = spec || {}
    return function () {
      if (adapters[id] === spec) delete adapters[id]
    }
  }

  function registerRecoveryComponent() {
    if (aiditor.componentRegistration && aiditor.componentRegistration('extension-disabled')) return
    aiditor.registerComponent('extension-disabled', {
      palette: false,
      title: 'Extension Disabled',
      icon: 'alert-triangle',
      defaults: function () {
        return { title: 'Extension disabled', icon: 'alert-triangle', props: {} }
      },
      factory: function (propsSig) {
        const el = document.createElement('div')
        el.className = 'aiditor-extension-disabled'
        const title = document.createElement('div')
        title.className = 'aiditor-extension-disabled-title'
        const body = document.createElement('div')
        body.className = 'aiditor-extension-disabled-body'
        el.appendChild(title)
        el.appendChild(body)
        const stop = aiditor.effect(function () {
          const p = propsSig() || {}
          title.textContent = 'Extension disabled'
          body.textContent = (p.extensionTitle || p.extensionId || 'Extension') + ' is disabled or unavailable. Component: ' + (p.component || 'unknown')
        })
        if (aiditor.ui && aiditor.ui.collect) aiditor.ui.collect(el, stop)
        return el
      },
    })
  }

  function listExtensions() {
    return keys(extensions).map(function (id) {
      const entry = extensions[id]
      return {
        id: id,
        manifest: clone(entry.manifest),
        enabled: entry.enabled !== false,
        active: !!entry.active,
        filtered: !canActivateLayer(entry.manifest.layer),
        owner: entry.owner,
        panels: clone(entry.panels || []),
        lastError: entry.lastError || null,
      }
    })
  }

  function getExtension(id) {
    if (!extensions[id]) return null
    const entry = extensions[id]
    return {
      id: id,
      manifest: clone(entry.manifest),
      enabled: entry.enabled !== false,
      active: !!entry.active,
      filtered: !canActivateLayer(entry.manifest.layer),
      owner: entry.owner,
      panels: clone(entry.panels || []),
      lastError: entry.lastError || null,
    }
  }

  function previewAddPanelToDock(input) {
    input = input || {}
    const errors = []
    const layoutName = input.layout || 'default'
    const dockName = input.dock || 'main'
    const component = input.component
    const path = runtimeScriptPath(input)
    const layout = resolveLayout(input.layout)
    if (!layout) errors.push({ path: 'layout', message: 'Layout not registered: ' + layoutName })
    else if (!dockExists(layout.tree(), dockName)) errors.push({ path: 'dock', message: 'Dock not found: ' + dockName })
    if (!component) errors.push({ path: 'component', message: 'Component is required' })
    else if (!(aiditor.componentRegistration && aiditor.componentRegistration(component)) && !path) {
      return previewAddPanelAutoScript(input, errors, dockName, component)
    }
    if (path) return previewAddPanelScript(input, errors, dockName, component, path)
    return {
      ok: errors.length === 0,
      risk: 'edit',
      title: 'Add panel: ' + (component || ''),
      input: clone(input),
      changes: [{ type: 'dockPanel', dock: dockName, component: component }],
      errors: errors,
    }
  }

  function previewAddPanelScript(input, errors, dockName, component, path) {
    const ws = currentWorkspace()
    if (!ws) {
      errors.push({ path: 'path', message: 'Current workspace is required to load script: ' + path })
      return previewAddPanelObject(input, errors, dockName, component, path, null)
    }
    return ws.readText(path).then(function (file) {
      return previewAddPanelObject(input, errors, dockName, component, path, file)
    }, function (err) {
      errors.push({ path: 'path', message: String(err && err.message || err) })
      return previewAddPanelObject(input, errors, dockName, component, path, null)
    })
  }

  function previewAddPanelAutoScript(input, errors, dockName, component) {
    return findComponentScript(component).then(function (found) {
      const matches = found.matches || []
      if (matches.length === 1) {
        const path = matches[0].path
        const nextInput = Object.assign({}, input, { path: path })
        return previewAddPanelObject(nextInput, errors, dockName, component, path, matches[0].file)
      }
      if (matches.length > 1) {
        errors.push({ path: 'component', message: 'Component not registered: ' + component + '. Multiple candidate scripts found; retry with path: ' + matches.map(function (m) { return m.path }).join(', ') })
      } else {
        errors.push({ path: 'component', message: 'Component not registered: ' + component + '. If this component was just written to the workspace, retry with path, for example { path: "your-panel.js" }.' })
        if (found.reason) errors.push({ path: 'path', message: found.reason })
      }
      return previewAddPanelObject(input, errors, dockName, component, '', null)
    })
  }

  function previewAddPanelObject(input, errors, dockName, component, path, file) {
    const nextInput = Object.assign({}, input, {
      owner: runtimeScriptOwner(input),
      layer: input.layer || 'workspace',
    })
    const changes = []
    if (path) changes.push({ type: 'runtimeScript', path: path, owner: nextInput.owner })
    changes.push({ type: 'dockPanel', dock: dockName, component: component })
    return {
      ok: errors.length === 0,
      risk: 'edit',
      title: 'Add panel: ' + (component || ''),
      input: clone(nextInput),
      resourceVersion: file ? { type: 'workspaceFile', path: path, version: file.hash } : null,
      hash: file && file.hash || null,
      changes: changes,
      errors: errors,
    }
  }

  function applyAddPanelToDock(preview) {
    if (preview && preview.ok === false) return { applied: false, ok: false, errors: preview.errors || [], preview: preview }
    const input = preview.input || {}
    return loadRuntimeScriptForPanel(input, preview).then(function () {
      if (input.component && aiditor.componentRegistration && !aiditor.componentRegistration(input.component)) {
        throw new Error('Component not registered after loading script: ' + input.component)
      }
      const placed = placePanel(input)
      return Object.assign({ applied: true }, placed)
    }, function (err) {
      return { applied: false, ok: false, error: String(err && err.message || err) }
    })
  }

  function previewReplacePanel(input) {
    input = input || {}
    const errors = []
    const layoutName = input.layout || 'default'
    const layout = resolveLayout(input.layout)
    const panelId = input.panelId || input.panel || input.target || input.id || ''
    const component = input.component
    const path = runtimeScriptPath(input)
    let target = null
    if (!layout) errors.push({ path: 'layout', message: 'Layout not registered: ' + layoutName })
    else {
      target = aiditor.findPanel(layout.tree(), panelId)
      if (!target) errors.push({ path: 'panelId', message: 'Panel not found: ' + panelId })
      else if (target.panel && target.panel.dirty && !input.discardDirty) {
        errors.push({ path: 'discardDirty', message: 'Panel is dirty. Pass discardDirty: true to replace it.' })
      }
    }
    if (!panelId) errors.push({ path: 'panelId', message: 'panelId is required' })
    if (!component) errors.push({ path: 'component', message: 'Component is required' })
    else if (!(aiditor.componentRegistration && aiditor.componentRegistration(component)) && !path) {
      return previewReplacePanelAutoScript(input, errors, panelId, target, component)
    }
    if (path) return previewReplacePanelScript(input, errors, panelId, target, component, path)
    return previewReplacePanelObject(input, errors, panelId, target, component, '', null)
  }

  function previewReplacePanelScript(input, errors, panelId, target, component, path) {
    const ws = currentWorkspace()
    if (!ws) {
      errors.push({ path: 'path', message: 'Current workspace is required to load script: ' + path })
      return previewReplacePanelObject(input, errors, panelId, target, component, path, null)
    }
    return ws.readText(path).then(function (file) {
      return previewReplacePanelObject(input, errors, panelId, target, component, path, file)
    }, function (err) {
      errors.push({ path: 'path', message: String(err && err.message || err) })
      return previewReplacePanelObject(input, errors, panelId, target, component, path, null)
    })
  }

  function previewReplacePanelAutoScript(input, errors, panelId, target, component) {
    return findComponentScript(component).then(function (found) {
      const matches = found.matches || []
      if (matches.length === 1) {
        const path = matches[0].path
        const nextInput = Object.assign({}, input, { path: path })
        return previewReplacePanelObject(nextInput, errors, panelId, target, component, path, matches[0].file)
      }
      if (matches.length > 1) {
        errors.push({ path: 'component', message: 'Component not registered: ' + component + '. Multiple candidate scripts found; retry with path: ' + matches.map(function (m) { return m.path }).join(', ') })
      } else {
        errors.push({ path: 'component', message: 'Component not registered: ' + component + '. If this component was just written to the workspace, retry with path, for example { path: "your-panel.js" }.' })
        if (found.reason) errors.push({ path: 'path', message: found.reason })
      }
      return previewReplacePanelObject(input, errors, panelId, target, component, '', null)
    })
  }

  function previewReplacePanelObject(input, errors, panelId, target, component, path, file) {
    const nextInput = Object.assign({}, input, {
      panelId: panelId,
      owner: runtimeScriptOwner(input),
      layer: input.layer || 'workspace',
    })
    delete nextInput.panel
    delete nextInput.target
    delete nextInput.id
    const changes = []
    if (path) changes.push({ type: 'runtimeScript', path: path, owner: nextInput.owner })
    changes.push({
      type: 'dockPanelReplace',
      panelId: panelId,
      dock: target && target.dockId || null,
      from: target && target.panel && target.panel.component || null,
      to: component,
    })
    return {
      ok: errors.length === 0,
      risk: 'edit',
      title: 'Replace panel: ' + (panelId || ''),
      input: clone(nextInput),
      resourceVersion: file ? { type: 'workspaceFile', path: path, version: file.hash } : null,
      hash: file && file.hash || null,
      changes: changes,
      errors: errors,
    }
  }

  function restorePanelData(layout, panelId, panelData) {
    const tree = layout.tree()
    const found = aiditor.findPanel(tree, panelId)
    if (!found) return false
    const dockNode = aiditor.getAt(tree, found.path)
    const idx = dockNode.panels.findIndex(function (p) { return p.id === panelId })
    if (idx < 0) return false
    const panels = dockNode.panels.slice()
    panels[idx] = panelData
    const dock = Object.assign({}, dockNode, {
      panels: panels,
      activeId: dockNode.activeId === panelId ? panelData.id : dockNode.activeId,
    })
    layout.setTree(aiditor.replaceAt(tree, found.path, dock))
    return true
  }

  function applyReplacePanel(preview) {
    if (preview && preview.ok === false) return { applied: false, ok: false, errors: preview.errors || [], preview: preview }
    const input = preview.input || {}
    return loadRuntimeScriptForPanel(input, preview).then(function () {
      if (input.component && aiditor.componentRegistration && !aiditor.componentRegistration(input.component)) {
        throw new Error('Component not registered after loading script: ' + input.component)
      }
      const layout = resolveLayout(input.layout)
      if (!layout) throw new Error('Layout not registered: ' + (input.layout || 'default'))
      const target = aiditor.findPanel(layout.tree(), input.panelId)
      if (!target) throw new Error('Panel not found: ' + input.panelId)
      if (target.panel && target.panel.dirty && !input.discardDirty) throw new Error('Panel is dirty. Pass discardDirty: true to replace it.')
      const result = layout.replacePanel(input.panelId, panelPartialFromInput(input), { transient: !!input.transient })
      const newPanelId = result && result.panelId
      const failure = newPanelId ? panelHealthError(layout, newPanelId) : null
      if (failure) {
        restorePanelData(layout, newPanelId, target.panel)
        throw new Error(failure)
      }
      return { applied: true, ok: true, panelId: newPanelId, replacedPanelId: input.panelId, component: input.component }
    }, function (err) {
      return { applied: false, ok: false, error: String(err && err.message || err) }
    })
  }

  function previewReloadPanel(input) {
    input = input || {}
    const errors = []
    const layoutName = input.layout || 'default'
    const layout = resolveLayout(input.layout)
    const panelId = input.panelId || input.panel || input.target || input.id || ''
    const path = runtimeScriptPath(input)
    let target = null
    if (!layout) errors.push({ path: 'layout', message: 'Layout not registered: ' + layoutName })
    else {
      target = aiditor.findPanel(layout.tree(), panelId)
      if (!target) errors.push({ path: 'panelId', message: 'Panel not found: ' + panelId })
    }
    if (!panelId) errors.push({ path: 'panelId', message: 'panelId is required' })
    const component = input.component || target && target.panel && target.panel.component || ''
    if (input.component && target && target.panel && target.panel.component !== input.component) {
      errors.push({ path: 'component', message: 'reloadPanel keeps the existing panel component. Use replacePanel to change component from ' + target.panel.component + ' to ' + input.component + '.' })
    }
    if (!component) errors.push({ path: 'component', message: 'Component is required or panel must exist' })
    if (path) return previewReloadPanelScript(input, errors, panelId, target, component, path)
    return previewReloadPanelObject(input, errors, panelId, target, component, '', null)
  }

  function previewReloadPanelScript(input, errors, panelId, target, component, path) {
    const ws = currentWorkspace()
    if (!ws) {
      errors.push({ path: 'path', message: 'Current workspace is required to load script: ' + path })
      return previewReloadPanelObject(input, errors, panelId, target, component, path, null)
    }
    return ws.readText(path).then(function (file) {
      return previewReloadPanelObject(input, errors, panelId, target, component, path, file)
    }, function (err) {
      errors.push({ path: 'path', message: String(err && err.message || err) })
      return previewReloadPanelObject(input, errors, panelId, target, component, path, null)
    })
  }

  function previewReloadPanelObject(input, errors, panelId, target, component, path, file) {
    const nextInput = Object.assign({}, input, {
      panelId: panelId,
      component: component,
      owner: runtimeScriptOwner(input),
      layer: input.layer || 'workspace',
    })
    delete nextInput.panel
    delete nextInput.target
    delete nextInput.id
    const changes = []
    if (path) changes.push({ type: 'runtimeScript', path: path, owner: nextInput.owner, replace: true })
    changes.push({
      type: 'dockPanelReload',
      panelId: panelId,
      dock: target && target.dockId || null,
      component: component,
    })
    return {
      ok: errors.length === 0,
      risk: 'edit',
      title: 'Reload panel: ' + (panelId || ''),
      input: clone(nextInput),
      resourceVersion: file ? { type: 'workspaceFile', path: path, version: file.hash } : null,
      hash: file && file.hash || null,
      changes: changes,
      errors: errors,
    }
  }

  function applyReloadPanel(preview) {
    if (preview && preview.ok === false) return { applied: false, ok: false, errors: preview.errors || [], preview: preview }
    const input = preview.input || {}
    return loadRuntimeScriptForReload(input, preview).then(function () {
      if (input.component && aiditor.componentRegistration && !aiditor.componentRegistration(input.component)) {
        throw new Error('Component not registered after loading script: ' + input.component)
      }
      const layout = resolveLayout(input.layout)
      if (!layout) throw new Error('Layout not registered: ' + (input.layout || 'default'))
      const target = aiditor.findPanel(layout.tree(), input.panelId)
      if (!target) throw new Error('Panel not found: ' + input.panelId)
      if (input.component && target.panel && target.panel.component !== input.component) {
        throw new Error('reloadPanel keeps the existing panel component. Use replacePanel to change component from ' + target.panel.component + ' to ' + input.component + '.')
      }
      const result = layout.reloadPanel(input.panelId)
      const panelId = result && result.panelId || input.panelId
      const failure = panelHealthError(layout, panelId)
      if (failure) throw new Error(failure)
      return { applied: true, ok: true, panelId: panelId, component: target.panel.component }
    }, function (err) {
      return { applied: false, ok: false, error: String(err && err.message || err) }
    })
  }

  aiditor.extensions = {
    preview: previewExtension,
    review: reviewInstall,
    installWithReview: installWithReview,
    install: installExtension,
    update: updateExtension,
    uninstall: uninstallExtension,
    enable: enableExtension,
    disable: disableExtension,
    setLayer: setLayer,
    setMaxLayer: setMaxLayer,
    disableLayer: disableLayer,
    enableLayer: enableLayer,
    removePanelFromDock: removePanelFromDock,
    previewAddPanelToDock: previewAddPanelToDock,
    applyAddPanelToDock: applyAddPanelToDock,
    previewReplacePanel: previewReplacePanel,
    applyReplacePanel: applyReplacePanel,
    previewReloadPanel: previewReloadPanel,
    applyReloadPanel: applyReloadPanel,
    safeMode: setSafeMode,
    boot: bootExtensions,
    list: listExtensions,
    get: getExtension,
    ownerFor: ownerFor,
    hashSource: sourceHash,
    permissions: extensionPermissions,
    configurePermissions: configurePermissions,
    configureStorage: configureStorage,
    save: saveExtensions,
    clearStored: clearStoredExtensions,
    registerLayout: registerLayout,
    inspectDocks: inspectDocks,
    registerAdapter: registerAdapter,
  }

  registerRecoveryComponent()
})(window.aiditor = window.aiditor || {})

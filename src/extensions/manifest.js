// aiditor extension manifest normalization and validation helpers.
;(function (aiditor) {
  'use strict'

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value))
  }

  function keys(obj) { return Object.keys(obj) }

  function ownerFor(id) { return 'extension:' + id }

  function publicId(manifestId, localId, explicit) {
    if (explicit) return String(explicit)
    manifestId = String(manifestId)
    localId = String(localId)
    return localId === manifestId || localId.indexOf(manifestId + '.') === 0
      ? localId
      : manifestId + '.' + localId
  }

  function normalizeLayer(layer) {
    layer = layer || 'session'
    if (layer !== 'core' && layer !== 'builtin' && layer !== 'app' && layer !== 'user' && layer !== 'session') {
      throw new Error('Invalid extension layer: ' + layer)
    }
    return layer
  }

  function layerRank(layer) {
    layer = normalizeLayer(layer)
    if (layer === 'builtin' || layer === 'core') return 0
    if (layer === 'app') return 1
    if (layer === 'user') return 2
    return 3
  }

  function sourceHash(source) {
    source = String(source || '')
    let h = 2166136261
    for (let i = 0; i < source.length; i++) {
      h ^= source.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return 'aiditor-fnv1a-' + h.toString(16)
  }

  function normalizeManifest(input) {
    const m = clone(input || {})
    if (!m.id) throw new Error('Extension manifest requires id')
    m.id = String(m.id)
    m.title = m.title || m.id
    m.layer = normalizeLayer(m.layer)
    m.version = m.version || '0.0.0'
    m.trust = normalizeTrust(m.trust)
    m.permissions = clone(m.permissions || {})
    m.contributes = m.contributes || {}
    m.contributes.components = normalizeComponents(m)
    m.contributes.dockPanels = normalizeDockPanels(m)
    m.contributes.tools = normalizePublicEntries(m, m.contributes.tools)
    m.contributes.skills = normalizePublicEntries(m, m.contributes.skills)
    m.contributes.context = normalizePublicEntries(m, m.contributes.context)
    m.contributes.references = normalizePublicEntries(m, m.contributes.references)
    m.contributes.operations = normalizePublicEntries(m, m.contributes.operations)
    m.contributes.commands = normalizePublicEntries(m, m.contributes.commands)
    m.contributes.menus = normalizeMenus(m)
    m.contributes.settings = clone(m.contributes.settings || [])
    return m
  }

  function normalizeTrust(trust) {
    const t = clone(trust || {})
    const code = t.code || 'none'
    if (code !== 'none' && code !== 'trusted' && code !== 'sandbox') throw new Error('Invalid extension trust.code: ' + code)
    return { code: code }
  }

  function normalizePublicEntries(manifest, list) {
    list = list || []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const item = clone(list[i])
      if (!item.id) throw new Error('Extension contribution requires id')
      item.id = String(item.id)
      item.publicId = publicId(manifest.id, item.id, item.publicId)
      out.push(item)
    }
    return out
  }

  function normalizeComponents(manifest) {
    const list = manifest.contributes.components || []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const c = clone(list[i])
      if (!c.id) throw new Error('Extension component requires id')
      c.id = String(c.id)
      c.publicId = publicId(manifest.id, c.id, c.publicId)
      c.kind = c.kind || 'declarative-panel'
      c.title = c.title || c.label || c.id
      c.props = c.props || {}
      if (c.kind === 'factory') c.isolation = c.isolation || 'same-page'
      if (c.kind === 'iframe') c.isolation = 'iframe'
      out.push(c)
    }
    return out
  }

  function normalizeDockPanels(manifest) {
    const list = manifest.contributes.dockPanels || []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const p = clone(list[i])
      if (!p.component) throw new Error('Dock panel contribution requires component')
      p.id = p.id || p.component
      p.layout = p.layout || 'default'
      p.title = p.title || p.component
      p.mode = p.mode || 'open-on-install'
      out.push(p)
    }
    return out
  }

  function normalizeMenus(manifest) {
    const list = manifest.contributes.menus || []
    const out = []
    for (let i = 0; i < list.length; i++) {
      const item = clone(list[i])
      item.id = item.id || (item.target || 'global') + ':' + (item.command || i)
      item.publicId = publicId(manifest.id, item.id, item.publicId)
      if (item.command) item.command = publicId(manifest.id, item.command)
      out.push(item)
    }
    return out
  }

  function componentMap(manifest) {
    const map = {}
    const list = manifest.contributes.components || []
    for (let i = 0; i < list.length; i++) map[list[i].id] = list[i].publicId
    return map
  }

  function resolveComponentRef(map, name) {
    return map[name] || name
  }

  function normalizeUiNode(node, map) {
    if (!node) return null
    const out = clone(node)
    if (out.component) out.component = resolveComponentRef(map, out.component)
    if (out.children && out.children.length) {
      for (let i = 0; i < out.children.length; i++) {
        out.children[i] = normalizeUiNode(out.children[i], map)
      }
    }
    return out
  }

  function hasCodeContribution(manifest) {
    const list = manifest.contributes.components || []
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === 'factory' || list[i].kind === 'iframe') return true
    }
    return false
  }

  function codeTrustError(manifest, contribution) {
    if (contribution.kind === 'factory' && manifest.trust.code !== 'trusted') {
      return 'Factory component requires trust.code="trusted": ' + contribution.publicId
    }
    if (contribution.kind === 'iframe' && manifest.trust.code !== 'sandbox' && manifest.trust.code !== 'trusted') {
      return 'Iframe component requires trust.code="sandbox" or "trusted": ' + contribution.publicId
    }
    return null
  }

  function extensionPermissions(manifest) {
    const out = []
    out.push('extensions.layer.' + manifest.layer + '.write')
    const list = manifest.contributes.components || []
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === 'factory') out.push('extensions.code.install')
      if (list[i].kind === 'iframe') out.push('extensions.iframe.install')
    }
    const declared = manifest.permissions || []
    if (Array.isArray(declared)) {
      for (let j = 0; j < declared.length; j++) out.push(declared[j])
    } else {
      const names = keys(declared)
      for (let k = 0; k < names.length; k++) if (declared[names[k]]) out.push(names[k])
    }
    return out.filter(function (item, idx) { return out.indexOf(item) === idx })
  }

  function validateFactorySource(source) {
    source = String(source || '')
    if (!source.trim()) return { ok: false, error: 'Panel source is required' }
    if (!/^\s*function\b/.test(source)) return { ok: false, error: 'Panel source must be a function expression: function (propsSig, ctx) { return HTMLElement }' }
    try {
      Function('aiditor', '"use strict"; return (' + source + ')')
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) }
    }
    return { ok: true }
  }

  function validatePublicNames(manifest, errors) {
    const groups = ['components', 'tools', 'skills', 'context', 'references', 'operations', 'commands', 'menus']
    for (let i = 0; i < groups.length; i++) {
      const name = groups[i]
      const list = manifest.contributes[name] || []
      for (let j = 0; j < list.length; j++) {
        const id = list[j].publicId
        if (id && !(id === manifest.id || id.indexOf(manifest.id + '.') === 0)) {
          errors.push({ path: 'contributes.' + name + '[' + j + '].id', message: 'Extension contribution must use dotted prefix "' + manifest.id + '.": ' + id })
        }
      }
    }
  }

  function validateComponentUi(manifest, errors) {
    const map = componentMap(manifest)
    const list = manifest.contributes.components
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === 'factory' || list[i].kind === 'iframe') continue
      const uiTree = list[i].ui || list[i].view
      if (uiTree) validateUiNode(uiTree, map, 'contributes.components[' + i + '].ui', errors)
    }
  }

  function validateUiNode(node, map, path, errors) {
    if (!node.component) {
      errors.push({ path: path + '.component', message: 'UI node requires component' })
      return
    }
    const component = resolveComponentRef(map, node.component)
    if (!map[node.component] && !(aiditor.componentRegistration && aiditor.componentRegistration(component))) {
      errors.push({ path: path + '.component', message: 'UI component not registered: ' + component })
    }
    for (let i = 0; node.children && i < node.children.length; i++) {
      validateUiNode(node.children[i], map, path + '.children[' + i + ']', errors)
    }
  }

  aiditor._extensionsManifest = {
    clone: clone,
    keys: keys,
    ownerFor: ownerFor,
    publicId: publicId,
    normalizeLayer: normalizeLayer,
    layerRank: layerRank,
    sourceHash: sourceHash,
    normalizeManifest: normalizeManifest,
    componentMap: componentMap,
    resolveComponentRef: resolveComponentRef,
    normalizeUiNode: normalizeUiNode,
    hasCodeContribution: hasCodeContribution,
    codeTrustError: codeTrustError,
    extensionPermissions: extensionPermissions,
    validateFactorySource: validateFactorySource,
    validatePublicNames: validatePublicNames,
    validateComponentUi: validateComponentUi,
  }
})(window.aiditor = window.aiditor || {})

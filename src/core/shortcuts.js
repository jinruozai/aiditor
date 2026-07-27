// aiditor.shortcuts — generic keyboard shortcut runtime.
//
// This is keyboard infrastructure, not an application keymap. Bindings name
// commands; execution always routes through aiditor.commands.run.
;(function (aiditor) {
  'use strict'

  const SOURCE_ORDER = { builtin: 0, module: 1, app: 2, user: 3 }
  const LAYERS = { modal: 1, menu: 1, editable: 1, panel: 1, selection: 1, global: 1 }
  const MOD_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta']
  const HANDLED = '__aiditorShortcutHandled'
  const EDITABLE_SELECTOR = 'input,textarea,select,[contenteditable],[role="textbox"],[role="searchbox"]'
  const DEFAULT_NAMESPACE = 'aiditor'
  const DEFAULT_SCHEMA_VERSION = 1

  const bindings = {}
  const bindingMeta = {}
  const scopes = {}
  const scopeMeta = {}
  const overrides = {}
  const surfaces = typeof WeakMap === 'function' ? new WeakMap() : null
  const surfaceRecords = []
  const listeners = []
  const keyIndex = {}
  const transientDiagnostics = []

  let bound = false
  let seq = 0
  let effective = []
  let diagnosticsList = []
  let storageDiagnostic = null
  let hoverSurface = null
  let activeSurface = null
  let selectionProvider = null
  let storageOptions = { namespace: DEFAULT_NAMESPACE, schemaVersion: DEFAULT_SCHEMA_VERSION, adapter: null }

  function keys(obj) { return Object.keys(obj) }

  function cloneMeta(meta) {
    if (!meta) return {}
    const out = {}
    keys(meta).forEach(function (key) { out[key] = meta[key] })
    return out
  }

  function cloneBinding(binding) {
    const out = {}
    keys(binding || {}).forEach(function (key) { out[key] = binding[key] })
    if (binding && binding.keys) out.keys = binding.keys.slice()
    if (binding && binding.meta) out.meta = cloneMeta(binding.meta)
    if (binding && binding.__override) out.override = cloneMeta(binding.__override)
    delete out.__seq
    delete out.__sourceRank
    delete out.__disabled
    delete out.__override
    delete out.__rawKeys
    return out
  }

  function normalizeMeta(meta, binding) {
    if (aiditor.runtime && aiditor.runtime.registrationMeta) meta = aiditor.runtime.registrationMeta(meta)
    meta = meta || {}
    const out = {}
    if (meta.owner != null) out.owner = String(meta.owner)
    else if (binding && binding.owner != null) out.owner = String(binding.owner)
    if (meta.layer != null) out.layer = String(meta.layer)
    return out
  }

  function passFilter(item, filter) {
    if (!filter) return true
    if (filter.owner != null && (bindingMeta[item.id] || {}).owner !== filter.owner) return false
    if (filter.source != null && item.source !== filter.source) return false
    if (filter.layer != null && item.layer !== filter.layer) return false
    if (filter.scope != null && item.scope !== filter.scope) return false
    if (filter.command != null && item.command !== filter.command) return false
    return true
  }

  function matchesPrefix(name, prefix) {
    return aiditor.names && aiditor.names.matchesPrefix
      ? aiditor.names.matchesPrefix(name, prefix)
      : String(name).indexOf(String(prefix)) === 0
  }

  function emitChanged() {
    for (let i = 0; i < listeners.length; i++) listeners[i]()
  }

  function rebuild() {
    const next = []
    transientDiagnostics.length = 0
    keys(keyIndex).forEach(function (key) { delete keyIndex[key] })
    keys(bindings).forEach(function (id) {
      const base = bindings[id]
      const patch = overrides[id] || null
      const item = applyOverride(base, patch)
      if (!item.__disabled) {
        next.push(item)
        for (let i = 0; i < item.keys.length; i++) {
          const key = item.keys[i]
          if (!keyIndex[key]) keyIndex[key] = []
          keyIndex[key].push(id)
        }
      }
    })
    next.sort(compareBinding)
    keys(keyIndex).forEach(function (key) {
      keyIndex[key].sort(function (a, b) {
        return compareBinding(bindingById(a), bindingById(b))
      })
    })
    effective = next
    diagnosticsList = computeDiagnostics()
    emitChanged()
  }

  function bindingById(id) {
    for (let i = 0; i < effective.length; i++) if (effective[i].id === id) return effective[i]
    return null
  }

  function compareBinding(a, b) {
    if (!a && !b) return 0
    if (!a) return 1
    if (!b) return -1
    if (a.__sourceRank !== b.__sourceRank) return b.__sourceRank - a.__sourceRank
    if (a.priority !== b.priority) return b.priority - a.priority
    return b.__seq - a.__seq
  }

  function applyOverride(base, patch) {
    const item = cloneBinding(base)
    item.__seq = base.__seq
    item.__disabled = false
    item.__rawKeys = base.__rawKeys ? base.__rawKeys.slice() : item.keys.slice()
    if (patch) {
      item.__override = cloneMeta(patch)
      if (patch.disabled === true) item.__disabled = true
      if (patch.keys) {
        item.__rawKeys = patch.__rawKeys ? patch.__rawKeys.slice() : rawKeys(patch.keys)
        item.keys = normalizeKeys(patch.keys)
      }
      if (patch.editablePolicy) item.editablePolicy = normalizeEditablePolicy(patch.editablePolicy)
      if (patch.priority != null) item.priority = Number(patch.priority) || 0
      if (patch.preventDefault != null) item.preventDefault = patch.preventDefault !== false
      item.source = 'user'
    }
    item.__sourceRank = SOURCE_ORDER[item.source] != null ? SOURCE_ORDER[item.source] : SOURCE_ORDER.app
    return item
  }

  function register(binding, meta) {
    bind()
    const item = normalizeBinding(binding, meta)
    if (bindings[item.id]) {
      transientDiagnostics.push(diag('error', 'duplicate_binding', 'Duplicate shortcut binding "' + item.id + '"', [item.id]))
      diagnosticsList = computeDiagnostics()
      throw new Error('shortcuts.register: duplicate id "' + item.id + '"')
    }
    const normalizedMeta = normalizeMeta(meta, binding)
    if (!item.owner && normalizedMeta.owner) item.owner = normalizedMeta.owner
    bindings[item.id] = item
    bindingMeta[item.id] = normalizedMeta
    rebuild()
    return cloneBinding(item)
  }

  function normalizeBinding(binding, meta) {
    if (!binding || !binding.id) throw new Error('shortcuts.register: id is required')
    if (!binding.command) throw new Error('shortcuts.register: command is required for "' + binding.id + '"')
    const item = {}
    item.id = String(binding.id)
    item.command = String(binding.command)
    item.__rawKeys = Array.isArray(binding.keys) ? binding.keys.slice() : (binding.keys ? [binding.keys] : [])
    item.keys = normalizeKeys(binding.keys)
    if (!item.keys.length) throw new Error('shortcuts.register: keys are required for "' + item.id + '"')
    item.args = binding.args
    item.layer = normalizeLayer(binding.layer)
    item.scope = binding.scope != null ? String(binding.scope) : ''
    item.when = binding.when || null
    item.source = normalizeSource(binding.source || (meta && meta.source) || 'app')
    item.owner = binding.owner != null ? String(binding.owner) : null
    item.priority = Number(binding.priority) || 0
    item.editablePolicy = normalizeEditablePolicy(binding.editablePolicy)
    item.preventDefault = binding.preventDefault !== false
    item.__seq = ++seq
    return item
  }

  function normalizeKeys(list) {
    const raw = Array.isArray(list) ? list : (list ? [list] : [])
    const out = []
    for (let i = 0; i < raw.length; i++) {
      const key = normalizeKey(raw[i])
      if (key && out.indexOf(key) < 0) out.push(key)
    }
    return out
  }

  function rawKeys(list) {
    return Array.isArray(list) ? list.slice() : (list ? [list] : [])
  }

  function normalizeLayer(layer) {
    const value = layer == null ? 'global' : String(layer)
    if (!LAYERS[value]) throw new Error('shortcuts: unknown layer "' + value + '"')
    return value
  }

  function normalizeSource(source) {
    const value = source == null ? 'app' : String(source)
    return SOURCE_ORDER[value] != null ? value : 'app'
  }

  function normalizeEditablePolicy(policy) {
    const value = policy == null ? 'block' : String(policy)
    if (value === 'allow' || value === 'local' || value === 'block') return value
    return 'block'
  }

  function unregister(id, meta) {
    id = String(id || '')
    if (!bindings[id]) return false
    const existing = bindingMeta[id] || {}
    if (meta && meta.owner != null && existing.owner !== meta.owner)
      throw new Error('shortcuts.unregister: owner mismatch for "' + id + '"')
    delete bindings[id]
    delete bindingMeta[id]
    rebuild()
    return true
  }

  function unregisterOwner(owner) {
    const removed = []
    keys(bindingMeta).forEach(function (id) {
      if (bindingMeta[id].owner === owner) {
        delete bindings[id]
        delete bindingMeta[id]
        removed.push(id)
      }
    })
    keys(scopeMeta).forEach(function (id) {
      if (scopeMeta[id].owner === owner) {
        delete scopes[id]
        delete scopeMeta[id]
        removed.push(id)
      }
    })
    if (removed.length) rebuild()
    return removed
  }

  function unregisterPrefix(prefix) {
    const removed = []
    keys(bindings).forEach(function (id) {
      if (matchesPrefix(id, prefix)) {
        delete bindings[id]
        delete bindingMeta[id]
        removed.push(id)
      }
    })
    keys(scopes).forEach(function (id) {
      if (matchesPrefix(id, prefix)) {
        delete scopes[id]
        delete scopeMeta[id]
        removed.push(id)
      }
    })
    if (removed.length) rebuild()
    return removed
  }

  function registerScope(scope, meta) {
    if (!scope || !scope.id) throw new Error('shortcuts.registerScope: id is required')
    const id = String(scope.id)
    if (scopes[id]) throw new Error('shortcuts.registerScope: duplicate id "' + id + '"')
    scopes[id] = {
      id: id,
      label: scope.label != null ? String(scope.label) : id,
      description: scope.description != null ? String(scope.description) : '',
    }
    scopeMeta[id] = normalizeMeta(meta, scope)
    rebuild()
    return cloneMeta(scopes[id])
  }

  function unregisterScope(id, meta) {
    id = String(id || '')
    if (!scopes[id]) return false
    const existing = scopeMeta[id] || {}
    if (meta && meta.owner != null && existing.owner !== meta.owner)
      throw new Error('shortcuts.unregisterScope: owner mismatch for "' + id + '"')
    delete scopes[id]
    delete scopeMeta[id]
    rebuild()
    return true
  }

  function listScopes() {
    return keys(scopes).sort()
  }

  function surfaceFrom(input, layer) {
    if (!input) return null
    return {
      layer: layer || input.layer || 'panel',
      panelId: input.panelId != null ? String(input.panelId) : undefined,
      component: input.component != null ? String(input.component) : undefined,
      scope: input.scope != null ? String(input.scope) : undefined,
      meta: input.meta ? cloneMeta(input.meta) : undefined,
    }
  }

  function sameSurface(a, b) {
    a = surfaceData(a)
    b = surfaceData(b)
    return a && b && a.panelId === b.panelId && a.component === b.component && a.scope === b.scope
  }

  function surfaceData(value) {
    return value && value.surface ? value.surface : value
  }

  function attachPanelSurface(el, surface) {
    if (!el) throw new Error('shortcuts.attachPanelSurface: element is required')
    const data = surfaceFrom(surface, 'panel')
    const record = { el: el, surface: data }
    surfaceRecords.push(record)
    if (surfaces) surfaces.set(el, data)

    function enter() { hoverSurface = record }
    function leave() { if (sameSurface(hoverSurface, data)) hoverSurface = null }
    if (el.addEventListener) {
      el.addEventListener('pointerenter', enter)
      el.addEventListener('pointerleave', leave)
    }

    const dispose = function () {
      const at = surfaceRecords.indexOf(record)
      if (at >= 0) surfaceRecords.splice(at, 1)
      if (surfaces) surfaces.delete(el)
      if (el.removeEventListener) {
        el.removeEventListener('pointerenter', enter)
        el.removeEventListener('pointerleave', leave)
      }
      if (sameSurface(hoverSurface, data)) hoverSurface = null
      if (sameSurface(activeSurface, data)) activeSurface = null
    }
    if (aiditor.ui && aiditor.ui.collect) aiditor.ui.collect(el, dispose)
    return dispose
  }

  function setHoverSurface(surface) {
    hoverSurface = surfaceFrom(surface, surface && surface.layer || 'panel')
  }

  function setActiveSurface(surface) {
    activeSurface = surfaceFrom(surface, surface && surface.layer || 'panel')
  }

  function clearTransientTargets(options) {
    options = options || {}
    if (options.hover !== false) hoverSurface = null
    if (options.active === true) activeSurface = null
  }

  function setSelectionProvider(provider) {
    selectionProvider = provider || null
    return function () {
      if (selectionProvider === provider) selectionProvider = null
    }
  }

  function nearestSurface(el) {
    let node = el
    const doc = typeof document !== 'undefined' ? document : null
    while (node && node !== doc) {
      if (node.isConnected === false) return null
      if (surfaces && surfaces.has(node)) return surfaces.get(node)
      node = node.parentElement
    }
    return null
  }

  function isEditableTarget(el) {
    if (!el || !el.closest) return false
    const target = el.closest(EDITABLE_SELECTOR)
    if (!target) return false
    const name = String(target.nodeName || target.tagName || '').toLowerCase()
    if (name === 'input') return target.type !== 'hidden' && !target.disabled
    if (name === 'textarea' || name === 'select') return !target.disabled
    const role = attr(target, 'role')
    if (role === 'textbox' || role === 'searchbox') return true
    const editable = attr(target, 'contenteditable')
    return editable != null && String(editable).toLowerCase() !== 'false'
  }

  function attr(el, name) {
    return el && el.getAttribute ? el.getAttribute(name) : el && el[name]
  }

  function overlayTarget(el) {
    const menu = el && el.closest && el.closest('.aiditor-ui-menu')
    if (menu) return { layer: 'menu' }
    const modal = el && el.closest && el.closest('.aiditor-ui-modal,.aiditor-ui-drawer')
    if (modal) return { layer: 'modal' }
    return null
  }

  function context(ev) {
    return contextForInput(normalizeKeyInput(ev || {}), null, ev || null)
  }

  function contextForInput(input, surface, ev) {
    const targetEl = ev && ev.target || null
    const panel = nearestSurface(targetEl)
    const editableTarget = isEditableTarget(targetEl)
    const overlay = overlayTarget(targetEl)
    const key = eventKey(input)
    let target = null

    const hover = liveSurface(hoverSurface)
    const active = liveSurface(activeSurface)

    if (surface) target = surfaceFrom(surface, surface.layer || 'panel')
    else if (overlay) target = mergeSurface(overlay.layer, panel)
    else if (editableTarget) target = mergeSurface('editable', panel)
    else if (panel) target = surfaceFrom(panel, 'panel')
    else if (hover) target = surfaceFrom(hover, 'panel')
    else if (active) target = surfaceFrom(active, 'panel')
    else target = selectionTarget(ev || input) || { layer: 'global' }

    const editable = editableTarget || target && target.layer === 'editable'

    return {
      event: ev || null,
      input: input,
      key: key,
      layer: target && target.layer || 'global',
      target: target,
      editable: editable,
      handled: ev ? isHandled(ev) || !!ev.defaultPrevented : !!input.handled,
      scope: target && target.scope || '',
    }
  }

  function mergeSurface(layer, surface) {
    const out = surface ? surfaceFrom(surface, layer) : { layer: layer }
    out.layer = layer
    return out
  }

  function liveSurface(value) {
    if (!value) return null
    if (value.el) {
      if (value.el.isConnected === false) {
        if (hoverSurface === value) hoverSurface = null
        if (activeSurface === value) activeSurface = null
        return null
      }
      return value.surface
    }
    return value
  }

  function selectionTarget(ev) {
    if (!selectionProvider) return null
    const value = selectionProvider(ev)
    return value ? surfaceFrom(value, 'selection') : null
  }

  function bind() {
    if (bound) return
    bound = true
    if (typeof document !== 'undefined' && document.addEventListener)
      document.addEventListener('keydown', onKeydown, false)
  }

  function onKeydown(ev) {
    return dispatchInput(normalizeKeyInput(ev), null, ev)
  }

  function dispatchKey(input, surface) {
    return dispatchInput(normalizeKeyInput(input), surface || null, null)
  }

  function dispatchInput(input, surface, ev) {
    if (input.phase !== 'down') return false
    const ctx = contextForInput(input, surface, ev)
    const ids = eventKeyCandidates(input)
    const seen = {}
    const candidates = []
    for (let i = 0; i < ids.length; i++) {
      const list = keyIndex[ids[i]] || []
      for (let j = 0; j < list.length; j++) {
        const id = list[j]
        if (seen[id]) continue
        seen[id] = true
        const item = bindingById(id)
        if (item) candidates.push(item)
      }
    }
    candidates.sort(function (a, b) { return compareCandidateForContext(a, b, ctx) })
    for (let k = 0; k < candidates.length; k++) {
      const item = candidates[k]
      if (!bindingMatchesContext(item, ctx)) continue
      if (!commandAvailable(item)) continue
      ctx.command = item.command
      ctx.binding = cloneBinding(item)
      if (item.preventDefault !== false && ev && ev.preventDefault) ev.preventDefault()
      if (ev) markHandled(ev)
      ctx.handled = true
      aiditor.commands.run(item.command, item.args || {}, ctx)
      return true
    }
    return false
  }

  function commandAvailable(item) {
    return !!(item && aiditor.commands && aiditor.commands.get && aiditor.commands.run && aiditor.commands.get(item.command))
  }

  function compareCandidateForContext(a, b, ctx) {
    const ar = contextRank(a, ctx)
    const br = contextRank(b, ctx)
    if (ar !== br) return br - ar
    return compareBinding(a, b)
  }

  function contextRank(item, ctx) {
    let score = layerRank(item.layer, ctx)
    if (item.scope) score += 50
    score += whenSpecificity(item.when)
    return score
  }

  function layerRank(layer, ctx) {
    const current = ctx && ctx.layer || 'global'
    if (layer === current) return 400
    if (current === 'editable' && layer === 'panel') return 300
    if (!layer || layer === 'global') return 100
    return 0
  }

  function whenSpecificity(when) {
    if (!when) return 0
    if (typeof when === 'function') return 5
    if (typeof when === 'object') return keys(when).length
    return 0
  }

  function bindingMatchesContext(item, ctx) {
    if (!item) return false
    if (!layerMatches(item.layer, ctx.layer)) return false
    if (item.scope && item.scope !== ctx.scope) return false
    if (ctx.editable) {
      if (item.editablePolicy === 'block') return false
      if (item.editablePolicy === 'local' && (ctx.handled || isHandled(ctx.event) || !!(ctx.event && ctx.event.defaultPrevented))) return false
    }
    return matchesWhen(item.when, ctx)
  }

  function layerMatches(bindingLayer, contextLayer) {
    if (!bindingLayer || bindingLayer === 'global') return true
    if (bindingLayer === contextLayer) return true
    if (contextLayer === 'editable' && bindingLayer === 'panel') return true
    return false
  }

  function matchesWhen(when, ctx) {
    if (!when) return true
    if (typeof when === 'function') return when(ctx) !== false
    if (typeof when !== 'object') return true
    if (when.layer != null && when.layer !== ctx.layer) return false
    if (when.scope != null && when.scope !== ctx.scope) return false
    if (when.editable != null && !!when.editable !== !!ctx.editable) return false
    const target = ctx.target || {}
    if (when.panelId != null && when.panelId !== target.panelId) return false
    if (when.component != null && when.component !== target.component) return false
    return true
  }

  function eventKey(ev) {
    const list = eventKeyCandidates(ev)
    return list[0] || ''
  }

  function eventKeyCandidates(ev) {
    const key = normalizeMainKey(ev && ev.key)
    if (!key) return []
    const mods = eventMods(ev)
    const out = [joinKey(mods.primary, key)]
    const alternate = joinKey(mods.alternate, key)
    if (alternate && alternate !== out[0]) out.push(alternate)
    return out
  }

  function eventMods(ev) {
    const mac = isMac()
    const raw = []
    if (ev && ev.altKey) raw.push('Alt')
    if (ev && ev.shiftKey) raw.push('Shift')
    if (mac) {
      if (ev && ev.metaKey) raw.push('Mod')
      if (ev && ev.ctrlKey) raw.push('Ctrl')
      return { primary: raw, alternate: ev && ev.metaKey ? replaceMod(raw, 'Meta') : raw }
    }
    if (ev && ev.ctrlKey) raw.push('Mod')
    if (ev && ev.metaKey) raw.push('Meta')
    return { primary: raw, alternate: ev && ev.ctrlKey ? replaceMod(raw, 'Ctrl') : raw }
  }

  function normalizeKeyInput(input) {
    input = input || {}
    const phaseValue = String(input.phase || input.type || 'down').toLowerCase()
    return {
      key: input.key == null ? '' : String(input.key),
      code: input.code == null ? '' : String(input.code),
      phase: phaseValue === 'up' || phaseValue === 'keyup' ? 'up' : 'down',
      ctrlKey: input.ctrlKey != null ? !!input.ctrlKey : !!input.control,
      metaKey: input.metaKey != null ? !!input.metaKey : !!input.meta,
      altKey: input.altKey != null ? !!input.altKey : !!input.alt,
      shiftKey: input.shiftKey != null ? !!input.shiftKey : !!input.shift,
      repeat: input.repeat != null ? !!input.repeat : !!input.isAutoRepeat,
      isComposing: !!input.isComposing,
      location: input.location == null ? 0 : Number(input.location) || 0,
      handled: !!input.handled,
    }
  }

  function replaceMod(list, value) {
    const out = list.slice()
    const at = out.indexOf('Mod')
    if (at >= 0) out[at] = value
    return out
  }

  function normalizeKey(input, options) {
    if (!input) return ''
    if (typeof input === 'object' && input.key != null) return eventKey(normalizeKeyInput(input))
    const mac = isMac(options)
    const parts = String(input).split('+')
    const mods = []
    let main = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      const mod = normalizeModifier(part, mac)
      if (mod) {
        if (mods.indexOf(mod) < 0) mods.push(mod)
      } else {
        main = normalizeMainKey(part)
      }
    }
    return joinKey(mods, main)
  }

  function normalizeModifier(value, mac) {
    const v = String(value || '').toLowerCase()
    if (v === 'mod') return 'Mod'
    if (v === 'cmd' || v === 'command') return mac ? 'Mod' : 'Meta'
    if (v === 'meta') return mac ? 'Mod' : 'Meta'
    if (v === 'ctrl' || v === 'control') return mac ? 'Ctrl' : 'Mod'
    if (v === 'alt' || v === 'option') return 'Alt'
    if (v === 'shift') return 'Shift'
    return ''
  }

  function normalizeMainKey(value) {
    if (value == null) return ''
    const raw = String(value)
    const lower = raw.toLowerCase()
    const map = {
      esc: 'Escape',
      escape: 'Escape',
      return: 'Enter',
      enter: 'Enter',
      tab: 'Tab',
      space: 'Space',
      ' ': 'Space',
      spacebar: 'Space',
      backspace: 'Backspace',
      delete: 'Delete',
      del: 'Delete',
      arrowup: 'ArrowUp',
      up: 'ArrowUp',
      arrowdown: 'ArrowDown',
      down: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      left: 'ArrowLeft',
      arrowright: 'ArrowRight',
      right: 'ArrowRight',
      pageup: 'PageUp',
      pagedown: 'PageDown',
      home: 'Home',
      end: 'End',
    }
    if (map[lower]) return map[lower]
    if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase()
    if (raw.length === 1) return raw.toUpperCase()
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }

  function joinKey(mods, main) {
    if (!main) return ''
    const ordered = []
    for (let i = 0; i < MOD_ORDER.length; i++) {
      if (mods.indexOf(MOD_ORDER[i]) >= 0) ordered.push(MOD_ORDER[i])
    }
    ordered.push(main)
    return ordered.join('+')
  }

  function isMac(options) {
    const platform = options && options.platform ||
      (typeof navigator !== 'undefined' && (navigator.userAgentData && navigator.userAgentData.platform || navigator.platform)) || ''
    return /mac|iphone|ipad|ipod/i.test(platform)
  }

  function formatShortcut(keyOrKeys, options) {
    if (Array.isArray(keyOrKeys)) return keyOrKeys.map(function (key) { return formatShortcut(key, options) }).join(' / ')
    const key = normalizeKey(keyOrKeys, options)
    if (!key) return ''
    const mac = isMac(options)
    const parts = key.split('+')
    const main = parts.pop()
    if (mac) {
      const map = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
      return parts.map(function (part) { return map[part] || part }).join('') + displayMainKey(main, mac)
    }
    const map = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' }
    return parts.map(function (part) { return map[part] || part }).concat([displayMainKey(main, mac)]).join('+')
  }

  function displayMainKey(key, mac) {
    if (key === 'ArrowUp') return mac ? '↑' : 'Up'
    if (key === 'ArrowDown') return mac ? '↓' : 'Down'
    if (key === 'ArrowLeft') return mac ? '←' : 'Left'
    if (key === 'ArrowRight') return mac ? '→' : 'Right'
    if (key === 'Space') return 'Space'
    return key
  }

  function record(ev, options) {
    const key = eventKey(ev)
    return { key: key, display: formatShortcut(key, options), risks: risks(key) }
  }

  function risks(keyOrKeys) {
    const list = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]
    const out = []
    for (let i = 0; i < list.length; i++) {
      const key = normalizeKey(list[i])
      if (!key) continue
      if (reservedKey(key)) out.push({ level: 'warn', code: 'browser_reserved', key: key, message: 'Browser or OS may reserve ' + formatShortcut(key) })
      else if (riskyKey(key)) out.push({ level: 'warn', code: 'browser_risky', key: key, message: 'Browser may already use ' + formatShortcut(key) })
    }
    return out
  }

  function reservedKey(key) {
    return [
      'Mod+L', 'Mod+R', 'Mod+W', 'Mod+T', 'Mod+N', 'Mod+Q',
      'Mod+Shift+I', 'F5', 'Alt+F4',
    ].indexOf(key) >= 0
  }

  function riskyKey(key) {
    return ['Mod+S', 'Mod+P', 'Mod+F', 'Mod+D', 'Mod+O'].indexOf(key) >= 0
  }

  function getBindings(filter) {
    return keys(bindings).map(function (id) { return bindings[id] })
      .filter(function (item) { return passFilter(item, filter) })
      .sort(compareBinding)
      .map(cloneBinding)
  }

  function getEffectiveBindings(filter) {
    return effective.filter(function (item) { return passFilter(item, filter) }).map(cloneBinding)
  }

  function getShortcutsForCommand(commandId, ctx) {
    const out = []
    const nctx = ctx ? normalizeShortcutContext(ctx) : null
    const list = nctx
      ? effective.slice().sort(function (a, b) { return compareCandidateForContext(a, b, nctx) })
      : effective
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (item.command !== commandId) continue
      if (nctx && !bindingMatchesContext(item, nctx)) continue
      for (let j = 0; j < item.keys.length; j++) if (out.indexOf(item.keys[j]) < 0) out.push(item.keys[j])
    }
    return out
  }

  function getShortcutForCommand(commandId, ctx) {
    const list = getShortcutsForCommand(commandId, ctx)
    return list.length ? formatShortcut(list[0]) : ''
  }

  function normalizeShortcutContext(ctx) {
    if (ctx && ctx.event) return context(ctx.event)
    ctx = ctx || {}
    const target = ctx.target || null
    return {
      event: ctx.event || null,
      input: ctx.input || null,
      key: ctx.key || '',
      layer: ctx.layer || target && target.layer || 'global',
      target: target,
      editable: !!ctx.editable,
      handled: !!ctx.handled,
      scope: ctx.scope || target && target.scope || '',
    }
  }

  function updateUserOverride(bindingId, patch) {
    bindingId = String(bindingId || '')
    overrides[bindingId] = sanitizeOverride(patch || {})
    rebuild()
    return cloneOverride(overrides[bindingId])
  }

  function sanitizeOverride(patch) {
    const out = {}
    if (patch.keys) {
      out.__rawKeys = rawKeys(patch.keys)
      out.keys = normalizeKeys(patch.keys)
    }
    if (patch.disabled === true) out.disabled = true
    if (patch.disabled === false) out.disabled = false
    if (patch.editablePolicy) out.editablePolicy = normalizeEditablePolicy(patch.editablePolicy)
    if (patch.priority != null) out.priority = Number(patch.priority) || 0
    if (patch.preventDefault != null) out.preventDefault = patch.preventDefault !== false
    return out
  }

  function resetOverride(bindingId) {
    bindingId = String(bindingId || '')
    if (!overrides[bindingId]) return false
    delete overrides[bindingId]
    rebuild()
    return true
  }

  function resetAllOverrides() {
    keys(overrides).forEach(function (id) { delete overrides[id] })
    rebuild()
  }

  function storageKey() {
    return 'aiditor.shortcuts.' + (storageOptions.namespace || DEFAULT_NAMESPACE) + '.v' + (storageOptions.schemaVersion || DEFAULT_SCHEMA_VERSION)
  }

  function defaultStorage() {
    let store = null
    try { store = window.localStorage || null } catch (_) { store = null }
    return {
      read: function () {
        if (!store) return null
        const raw = store.getItem(storageKey())
        return raw ? JSON.parse(raw) : null
      },
      write: function (value) {
        if (store) store.setItem(storageKey(), JSON.stringify(value || {}))
      },
      clear: function () {
        if (store) store.removeItem(storageKey())
      },
    }
  }

  function configureStorage(options) {
    options = options || {}
    storageOptions = {
      namespace: options.namespace || DEFAULT_NAMESPACE,
      schemaVersion: options.schemaVersion || DEFAULT_SCHEMA_VERSION,
      adapter: options.adapter || null,
    }
  }

  function storageAdapter() {
    return storageOptions.adapter || defaultStorage()
  }

  function load() {
    return Promise.resolve().then(function () {
      storageDiagnostic = null
      return storageAdapter().read()
    }).then(function (value) {
      resetAllOverrides()
      value = value || {}
      keys(value).forEach(function (id) { overrides[id] = sanitizeOverride(value[id] || {}) })
      rebuild()
      return cloneOverrides()
    }).catch(function (err) {
      storageDiagnostic = { level: 'error', code: 'storage_error', message: err && err.message || String(err) }
      diagnosticsList = computeDiagnostics()
      throw err
    })
  }

  function save() {
    return Promise.resolve().then(function () {
      storageDiagnostic = null
      return storageAdapter().write(storageOverrides())
    }).catch(function (err) {
      storageDiagnostic = { level: 'error', code: 'storage_error', message: err && err.message || String(err) }
      diagnosticsList = computeDiagnostics()
      throw err
    })
  }

  function storageOverrides() {
    const out = {}
    keys(overrides).forEach(function (id) {
      out[id] = cloneOverride(overrides[id])
    })
    return out
  }

  function cloneOverride(patch) {
    const out = cloneMeta(patch)
    delete out.__rawKeys
    if (out.keys) out.keys = out.keys.slice()
    return out
  }

  function cloneOverrides() {
    const out = {}
    keys(overrides).forEach(function (id) { out[id] = cloneOverride(overrides[id]) })
    return out
  }

  function computeDiagnostics() {
    const out = transientDiagnostics.slice()
    if (storageDiagnostic) out.push(storageDiagnostic)
    for (let i = 0; i < effective.length; i++) {
      const item = effective[i]
      const id = item.id
      if (aiditor.commands && aiditor.commands.get && !aiditor.commands.get(item.command))
        out.push(diag('warn', 'unknown_command', 'Unknown command "' + item.command + '"', [id]))
      if (item.scope && !scopes[item.scope])
        out.push(diag('warn', 'unknown_scope', 'Unknown shortcut scope "' + item.scope + '"', [id], null, item.scope))
      duplicateKeys(item, out)
      if (item.layer === 'panel' && !item.scope)
        out.push(diag('warn', 'ambiguous_panel_scope', 'Panel shortcut has no scope', [id]))
      editableConflict(item, out)
      riskDiagnostics(item, out)
    }
    keys(overrides).forEach(function (id) {
      if (!bindings[id]) out.push(diag('warn', 'unknown_binding', 'Override references unknown binding "' + id + '"', [id]))
    })
    conflictDiagnostics(out)
    globalOverlapDiagnostics(out)
    return out
  }

  function diag(level, code, message, ids, key, scope) {
    const out = { level: level, code: code, message: message }
    if (ids) out.bindingIds = ids
    if (key) out.key = key
    if (scope) out.scope = scope
    return out
  }

  function duplicateKeys(item, out) {
    const seen = {}
    const raw = Array.isArray(item.__rawKeys) ? item.__rawKeys : []
    for (let i = 0; i < raw.length; i++) {
      const key = normalizeKey(raw[i])
      if (seen[key]) out.push(diag('warn', 'equivalent_key', 'Binding has equivalent duplicate key "' + key + '"', [item.id], key))
      seen[key] = true
    }
  }

  function editableConflict(item, out) {
    if (item.editablePolicy === 'block') return
    for (let i = 0; i < item.keys.length; i++) {
      const main = item.keys[i].split('+').pop()
      if (['Tab', 'Enter', 'Backspace', 'Delete', 'Space'].indexOf(main) >= 0)
        out.push(diag('warn', 'editable_local_conflict', 'Editable shortcut may conflict with editor-local keymap', [item.id], item.keys[i]))
    }
  }

  function riskDiagnostics(item, out) {
    const list = risks(item.keys)
    for (let i = 0; i < list.length; i++) out.push(diag('warn', list[i].code, list[i].message, [item.id], list[i].key))
  }

  function conflictDiagnostics(out) {
    const groups = {}
    for (let i = 0; i < effective.length; i++) {
      const item = effective[i]
      for (let j = 0; j < item.keys.length; j++) {
        const group = item.keys[j] + '|' + item.layer + '|' + (item.scope || '') + '|' + item.source
        if (!groups[group]) groups[group] = []
        groups[group].push(item)
      }
    }
    keys(groups).forEach(function (group) {
      const list = groups[group]
      if (list.length < 2) return
      for (let i = 0; i < list.length - 1; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (whenMayOverlap(list[i].when, list[j].when)) {
            out.push(diag('warn', 'key_conflict', 'Shortcut key may match multiple bindings', [list[i].id, list[j].id], group.split('|')[0], group.split('|')[2]))
            return
          }
        }
      }
    })
  }

  function globalOverlapDiagnostics(out) {
    for (let i = 0; i < effective.length - 1; i++) {
      for (let j = i + 1; j < effective.length; j++) {
        const a = effective[i]
        const b = effective[j]
        if ((a.layer === 'global') === (b.layer === 'global')) continue
        if (!scopeMayOverlap(a, b)) continue
        if (!whenMayOverlap(a.when, b.when)) continue
        const key = sharedKey(a, b)
        if (!key) continue
        out.push(diag('warn', 'global_key_overlap', 'Global shortcut may overlap a scoped shortcut', [a.id, b.id], key))
      }
    }
  }

  function scopeMayOverlap(a, b) {
    if (a.scope && b.scope && a.scope !== b.scope) return false
    return true
  }

  function sharedKey(a, b) {
    for (let i = 0; i < a.keys.length; i++) {
      if (b.keys.indexOf(a.keys[i]) >= 0) return a.keys[i]
    }
    return ''
  }

  function whenMayOverlap(a, b) {
    if (!a || !b) return true
    if (typeof a === 'function' || typeof b === 'function') return true
    if (typeof a !== 'object' || typeof b !== 'object') return true
    const ak = keys(a)
    const bk = keys(b)
    for (let i = 0; i < ak.length; i++) {
      if (bk.indexOf(ak[i]) < 0) continue
      if (JSON.stringify(a[ak[i]]) !== JSON.stringify(b[ak[i]])) return false
    }
    return true
  }

  function diagnostics(filter) {
    diagnosticsList = computeDiagnostics()
    return diagnosticsList.filter(function (item) {
      if (!filter) return true
      if (filter.level != null && item.level !== filter.level) return false
      if (filter.code != null && item.code !== filter.code) return false
      return true
    }).map(function (item) { return Object.assign({}, item, { bindingIds: item.bindingIds && item.bindingIds.slice() }) })
  }

  function onChanged(handler) {
    listeners.push(handler)
    return function () {
      const at = listeners.indexOf(handler)
      if (at >= 0) listeners.splice(at, 1)
    }
  }

  function markHandled(ev) {
    if (ev) ev[HANDLED] = true
  }

  function isHandled(ev) {
    return !!(ev && ev[HANDLED])
  }

  aiditor.shortcuts = {
    register: register,
    unregister: unregister,
    unregisterOwner: unregisterOwner,
    unregisterPrefix: unregisterPrefix,
    registerScope: registerScope,
    unregisterScope: unregisterScope,
    listScopes: listScopes,
    scopeMeta: function (id) { return cloneMeta(scopeMeta[id] || {}) },
    attachPanelSurface: attachPanelSurface,
    setHoverSurface: setHoverSurface,
    setActiveSurface: setActiveSurface,
    setSelectionProvider: setSelectionProvider,
    clearTransientTargets: clearTransientTargets,
    context: context,
    dispatchKey: dispatchKey,
    normalizeKey: normalizeKey,
    eventKey: eventKey,
    formatShortcut: formatShortcut,
    record: record,
    risks: risks,
    getBindings: getBindings,
    getEffectiveBindings: getEffectiveBindings,
    getShortcutForCommand: getShortcutForCommand,
    getShortcutsForCommand: getShortcutsForCommand,
    updateUserOverride: updateUserOverride,
    resetOverride: resetOverride,
    resetAllOverrides: resetAllOverrides,
    configureStorage: configureStorage,
    load: load,
    save: save,
    diagnostics: diagnostics,
    onChanged: onChanged,
    markHandled: markHandled,
    isHandled: isHandled,
    isEditableTarget: isEditableTarget,
  }
})(window.aiditor = window.aiditor || {})

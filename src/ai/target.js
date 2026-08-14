// aiditor.ai target protocol - stable editor object references for AI context.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const providers = {}
  const TARGET_MIME = 'application/x-aiditor-target'
  const TARGET_LIST_MIME = 'application/x-aiditor-target-list'

  function clone(v) {
    return v == null ? v : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(v) : JSON.parse(JSON.stringify(v)))
  }

  function inferResolver(uri, kind) {
    const text = String(uri || '')
    const idx = text.indexOf('://')
    if (idx > 0) return text.slice(0, idx)
    const dot = String(kind || '').indexOf('.')
    return dot > 0 ? String(kind).slice(0, dot) : (kind || 'target')
  }

  function normalizeTarget(target) {
    if (ai.references && ai.references.normalize) return ai.references.normalize(target)
    if (!target) return null
    if (typeof target === 'string') target = { uri: target }
    const uri = String(target.uri || target.id || '')
    if (!uri) return null
    const kind = target.kind || target.type || inferResolver(uri, target.kind)
    return {
      resolver: target.resolver || inferResolver(uri, kind),
      uri: uri,
      kind: kind,
      title: target.title || target.label || uri,
      summary: target.summary || '',
      meta: clone(target.meta || {}),
      schema: clone(target.schema || null),
      capabilities: clone(target.capabilities || []),
    }
  }

  function normalizeTargets(value) {
    if (!value) return []
    const list = Array.isArray(value) ? value : [value]
    const out = []
    for (let i = 0; i < list.length; i++) {
      const target = normalizeTarget(list[i])
      if (target) out.push(target)
    }
    return out
  }

  function registerTargetProvider(name, provider) {
    providers[name] = Object.assign({ id: name }, provider || {})
    return providers[name]
  }

  function getTargetProvider(name) {
    return providers[name] || null
  }

  function listTargetProviders() {
    return Object.keys(providers)
  }

  function captureTarget(source, ctx) {
    if (source && source.uri) return normalizeTarget(source)
    const names = Object.keys(providers)
    for (let i = 0; i < names.length; i++) {
      const provider = providers[names[i]]
      if (provider.match && !provider.match(source, ctx || {})) continue
      if (!provider.capture) continue
      const captured = provider.capture(source, ctx || {})
      const targets = normalizeTargets(captured)
      if (targets.length) return targets.length === 1 ? targets[0] : targets
    }
    return null
  }

  function findAttachment(target) {
    const list = ai.attachments && ai.attachments.peek ? ai.attachments.peek() : []
    for (let i = 0; i < list.length; i++) {
      if (list[i].resolver === target.resolver && list[i].uri === target.uri) return list[i]
    }
    return null
  }

  function addTarget(target) {
    const normalized = normalizeTarget(target)
    if (!normalized) return null
    const existing = findAttachment(normalized)
    return existing || ai.addAttachment(normalized)
  }

  function attachTargetToAgent(agentId, target) {
    const agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    const stored = addTarget(target)
    if (!agent || !stored) return null
    const refs = (agent.contextRefs || []).slice()
    if (refs.indexOf(stored.id) < 0) refs.push(stored.id)
    return ai.updateAgent(agent.id, { contextRefs: refs })
  }

  function attachTargetsToAgent(agentId, targets) {
    const agent = agentId ? ai.findAgent(agentId) : ai.getActiveAgent()
    if (!agent) return null
    const refs = (agent.contextRefs || []).slice()
    const list = normalizeTargets(targets)
    for (let i = 0; i < list.length; i++) {
      const stored = addTarget(list[i])
      if (stored && refs.indexOf(stored.id) < 0) refs.push(stored.id)
    }
    return ai.updateAgent(agent.id, { contextRefs: refs })
  }

  function addTargetsToChat(targets) {
    const list = normalizeTargets(targets)
    if (!list.length) return []
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aiditor-ai-add-to-chat', { detail: { targets: list } }))
    }
    return list
  }

  function resolveTarget(targetOrFn, ev) {
    const value = typeof targetOrFn === 'function' ? targetOrFn(ev) : targetOrFn
    return normalizeTargets(value)
  }

  function writeDragData(ev, targets) {
    const list = normalizeTargets(targets)
    if (!list.length || !ev.dataTransfer) return false
    ev.dataTransfer.effectAllowed = 'copy'
    ev.dataTransfer.setData(TARGET_LIST_MIME, JSON.stringify(list))
    ev.dataTransfer.setData(TARGET_MIME, JSON.stringify(list[0]))
    ev.dataTransfer.setData('text/plain', list.map(function (t) { return t.title || t.uri }).join('\n'))
    return true
  }

  function readTargetFromDragEvent(ev) {
    const dt = ev && ev.dataTransfer
    if (!dt) return []
    const rawList = dt.getData(TARGET_LIST_MIME)
    const rawOne = dt.getData(TARGET_MIME)
    try {
      if (rawList) return normalizeTargets(JSON.parse(rawList))
      if (rawOne) return normalizeTargets(JSON.parse(rawOne))
    } catch (_) {}
    return []
  }

  function hasTargetDrag(ev) {
    const types = ev && ev.dataTransfer && ev.dataTransfer.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) {
      if (types[i] === TARGET_MIME || types[i] === TARGET_LIST_MIME) return true
    }
    return false
  }

  function hasFileDrag(ev) {
    const types = ev && ev.dataTransfer && ev.dataTransfer.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
    return false
  }

  function fileKind(file) {
    const type = String(file.type || '')
    if (type.indexOf('image/') === 0) return 'file.image'
    if (type.indexOf('text/') === 0 || /\.(json|txt|md|csv|js|css|html|xml|yml|yaml)$/i.test(file.name || '')) return 'file.text'
    return 'file.binary'
  }

  function fileUri(file) {
    return 'file://upload/' + encodeURIComponent(file.name || 'file') + '?size=' + String(file.size || 0) + '&mtime=' + String(file.lastModified || 0)
  }

  function readFileText(file) {
    if (typeof file.text === 'function') return file.text()
    return Promise.resolve('')
  }

  function readFileDataUrl(file) {
    if (typeof FileReader === 'undefined') return Promise.resolve('')
    return new Promise(function (resolve) {
      const reader = new FileReader()
      reader.onload = function () { resolve(String(reader.result || '')) }
      reader.onerror = function () { resolve('') }
      reader.readAsDataURL(file)
    })
  }

  function loadImageFromFile(file) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(file)
    if (typeof Image === 'undefined' || typeof URL === 'undefined') return Promise.resolve(null)
    return new Promise(function (resolve) {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = function () {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = function () {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      img.src = url
    })
  }

  function compressImageFile(file) {
    if (typeof document === 'undefined') return Promise.resolve('')
    return loadImageFromFile(file).then(function (img) {
      if (!img) return ''
      const maxSide = 1600
      const width = img.width || img.naturalWidth || 0
      const height = img.height || img.naturalHeight || 0
      if (!width || !height) return ''
      const scale = Math.min(1, maxSide / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      if (img.close) img.close()
      let out = ''
      try { out = canvas.toDataURL('image/webp', 0.82) } catch (_) {}
      if (!out || out.indexOf('data:image/webp') !== 0) {
        try { out = canvas.toDataURL('image/jpeg', 0.84) } catch (_) {}
      }
      return out || ''
    })
  }

  function fileToTarget(file) {
    const kind = fileKind(file)
    const maxText = 128 * 1024
    const maxImage = 2 * 1024 * 1024
    const meta = {
      name: file.name || 'file',
      size: Number(file.size || 0),
      type: file.type || '',
      lastModified: file.lastModified || 0,
    }
    const finish = function () {
      return normalizeTarget({
        resolver: 'file',
        uri: fileUri(file),
        kind: kind,
        title: file.name || 'File',
        summary: meta.type ? meta.type + ' · ' + meta.size + ' bytes' : meta.size + ' bytes',
        meta: meta,
      })
    }
    if (kind === 'file.text' && meta.size <= maxText) {
      return readFileText(file).then(function (text) {
        meta.text = text
        meta.encoding = 'utf8'
        return finish()
      })
    }
    if (kind === 'file.image' && meta.size <= maxImage) {
      return readFileDataUrl(file).then(function (dataUrl) {
        if (dataUrl) meta.dataUrl = dataUrl
        return finish()
      })
    }
    if (kind === 'file.image') {
      return compressImageFile(file).then(function (dataUrl) {
        if (dataUrl) {
          meta.dataUrl = dataUrl
          meta.compressed = true
          meta.originalSize = meta.size
          meta.encodedSize = dataUrl.length
          return finish()
        }
        meta.truncated = true
        return finish()
      })
    }
    meta.truncated = true
    return Promise.resolve(finish())
  }

  function filesFromDragEvent(ev) {
    const files = ev && ev.dataTransfer && ev.dataTransfer.files
    const out = []
    for (let i = 0; files && i < files.length; i++) out.push(files[i])
    return out
  }

  if (ai.references && ai.references.register) {
    ai.references.register('file', {
      read: function (ref) {
        return {
          name: ref.meta && ref.meta.name || ref.title || '',
          size: ref.meta && ref.meta.size || 0,
          type: ref.meta && ref.meta.type || '',
          text: ref.meta && ref.meta.text || '',
          dataUrl: ref.meta && ref.meta.dataUrl || '',
          truncated: !!(ref.meta && ref.meta.truncated),
        }
      },
    }, { owner: 'aiditor.ai.target', layer: 'builtin' })
  }

  function addCleanup(el, fn) {
    el.__aiditorCleanups = el.__aiditorCleanups || []
    el.__aiditorCleanups.push(fn)
  }

  function resolveDragHandle(el, opts) {
    const handle = opts.dragHandle || opts.dragSelector || null
    if (!handle) return el
    if (typeof handle === 'string') return el.querySelector(handle)
    if (typeof handle === 'function') return handle(el)
    return handle
  }

  function closestMatch(node, root, selector) {
    while (node && node !== root) {
      if (node.matches && node.matches(selector)) return node
      node = node.parentElement
    }
    return null
  }

  function shouldIgnoreDragStart(ev, root, dragEl, opts) {
    if (opts.ignoreInteractive === false) return false
    const target = ev.target
    if (!target || target === dragEl) return false
    if (closestMatch(target, dragEl, '[data-aiditor-ai-drag-handle]')) return false
    return !!closestMatch(target, root, [
      '[data-aiditor-ai-drag-ignore]',
      'input',
      'textarea',
      'select',
      'option',
      'button',
      'a[href]',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="slider"]',
      '[role="spinbutton"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="tree"]',
      '[role="grid"]',
    ].join(','))
  }

  function attach(el, targetOrFn, opts) {
    opts = opts || {}
    el.dataset.efAiTarget = '1'
    const dragEl = opts.draggable === false ? null : resolveDragHandle(el, opts)
    if (dragEl) {
      const hadDraggable = dragEl.hasAttribute && dragEl.hasAttribute('draggable')
      const prevDraggable = hadDraggable ? dragEl.getAttribute('draggable') : null
      dragEl.draggable = true
      if (dragEl !== el) dragEl.setAttribute('data-aiditor-ai-drag-handle', '1')
      const onDragStart = function (ev) {
        if (shouldIgnoreDragStart(ev, el, dragEl, opts)) {
          ev.preventDefault()
          return
        }
        const targets = resolveTarget(targetOrFn, ev)
        if (!writeDragData(ev, targets)) ev.preventDefault()
      }
      dragEl.addEventListener('dragstart', onDragStart)
      addCleanup(el, function () {
        dragEl.removeEventListener('dragstart', onDragStart)
        if (hadDraggable) dragEl.setAttribute('draggable', prevDraggable)
        else dragEl.removeAttribute('draggable')
        if (dragEl !== el) dragEl.removeAttribute('data-aiditor-ai-drag-handle')
      })
    }

    if (opts.contextMenu) {
      const onContext = function (ev) {
        const targets = resolveTarget(targetOrFn, ev)
        if (!targets.length || !aiditor.ui || !aiditor.ui.contextMenu) return
        ev.preventDefault()
        aiditor.ui.contextMenu({ x: ev.clientX, y: ev.clientY }, [
          {
            label: 'Add to Chat',
            icon: 'plus',
            onSelect: function () { addTargetsToChat(targets) },
          },
        ])
      }
      el.addEventListener('contextmenu', onContext)
      addCleanup(el, function () { el.removeEventListener('contextmenu', onContext) })
    }

    return el
  }

  function installTargetDrop(el, opts) {
    opts = opts || {}
    const onDragOver = function (ev) {
      if (!hasTargetDrag(ev) && !hasFileDrag(ev)) return
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
      el.classList.add('aiditor-ai-target-drop-active')
    }
    const onDragLeave = function (ev) {
      if (ev.currentTarget === el) el.classList.remove('aiditor-ai-target-drop-active')
    }
    const onDrop = function (ev) {
      const targets = readTargetFromDragEvent(ev)
      const files = filesFromDragEvent(ev)
      if (!targets.length && !files.length) return
      ev.preventDefault()
      el.classList.remove('aiditor-ai-target-drop-active')
      if (files.length) {
        Promise.all(files.map(fileToTarget)).then(function (fileTargets) {
          const all = targets.concat(fileTargets.filter(Boolean))
          if (opts.onDrop) opts.onDrop(all, ev)
          else attachTargetsToAgent(null, all)
        })
        return
      }
      if (opts.onDrop) opts.onDrop(targets, ev)
      else attachTargetsToAgent(null, targets)
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    addCleanup(el, function () {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    })
    return el
  }

  ai.registerTargetProvider = registerTargetProvider
  ai.getTargetProvider = getTargetProvider
  ai.listTargetProviders = listTargetProviders
  ai.captureTarget = captureTarget
  ai.normalizeTarget = normalizeTarget
  ai.addTarget = addTarget
  ai.attachTargetToAgent = attachTargetToAgent
  ai.attachTargetsToAgent = attachTargetsToAgent
  ai.addTargetsToChat = addTargetsToChat
  ai.attach = attach
  ai.bindTarget = attach
  ai.installTargetDrop = installTargetDrop
  ai.readTargetFromDragEvent = readTargetFromDragEvent
  ai.writeTargetDragData = writeDragData
  ai.fileToTarget = fileToTarget
})(window.aiditor = window.aiditor || {})

// aiditor.ai message rendering primitives - normalized message parts + renderer registry.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const ui = aiditor.ui
  const renderers = []

  function readText(value) {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && value.type === 'rich-prompt') {
      return value.renderedText || (ai.richPrompt && ai.richPrompt.toModelText ? ai.richPrompt.toModelText(value) : '')
    }
    return safeJson(value, 2)
  }

  function safeJson(value, space) {
    try { return ai.serialize && ai.serialize.stringify ? ai.serialize.stringify(value) : JSON.stringify(value, null, space || 0) } catch (_) { return String(value) }
  }

  function clip(value, max) {
    const text = String(value == null ? '' : value)
    return text.length > max ? text.slice(0, max - 3) + '...' : text
  }

  function normalizeMime(value) {
    return String(value || '').toLowerCase()
  }

  function partKey(part, index) {
    return part.key || part.id || part.refId || part.uri || part.src || part.url || (part.type || 'part') + ':' + index
  }

  function isImage(part) {
    return part.type === 'image' || normalizeMime(part.mime || part.mediaType || part.mimeType).indexOf('image/') === 0
  }

  function isAudio(part) {
    return part.type === 'audio' || normalizeMime(part.mime || part.mediaType || part.mimeType).indexOf('audio/') === 0
  }

  function isVideo(part) {
    return part.type === 'video' || normalizeMime(part.mime || part.mediaType || part.mimeType).indexOf('video/') === 0
  }

  function mediaSrc(part) {
    if (!part) return ''
    const source = part.source || {}
    const inlineData = part.inlineData || part.inline_data || {}
    const fileData = part.fileData || part.file_data || {}
    const mime = part.mime || part.mimeType || part.mediaType || part.media_type || source.media_type || source.mimeType || inlineData.mimeType || inlineData.mime_type || fileData.mimeType || fileData.mime_type || ''
    if (part.src) return part.src
    if (part.url) return part.url
    if (part.href) return part.href
    if (part.imageUrl) return part.imageUrl
    if (part.image_url) return typeof part.image_url === 'string' ? part.image_url : part.image_url.url
    if (source.url) return source.url
    if (source.data && mime) return 'data:' + mime + ';base64,' + source.data
    if (inlineData.data && mime) return 'data:' + mime + ';base64,' + inlineData.data
    if (fileData.fileUri) return fileData.fileUri
    if (fileData.file_uri) return fileData.file_uri
    if (part.data && mime) return 'data:' + mime + ';base64,' + part.data
    if (part.base64 && mime) return 'data:' + mime + ';base64,' + part.base64
    if (part.result && part.type === 'image_generation_call') return 'data:image/png;base64,' + part.result
    return ''
  }

  function labelOf(value, fallback) {
    if (!value) return fallback || ''
    return value.title || value.label || value.name || value.filename || value.path || value.uri || value.src || value.url || value.id || value.refId || fallback || ''
  }

  function normalizeTextParts(text) {
    return [{ type: 'text', text: String(text == null ? '' : text) }]
  }

  function normalizeProviderPart(part) {
    if (part == null) return []
    if (typeof part === 'string') return normalizeTextParts(part)
    const type = part.type || part.kind || ''
    const inlineData = part.inlineData || part.inline_data
    const fileData = part.fileData || part.file_data
    if (inlineData || fileData) {
      const mime = part.mime || part.mediaType || part.media_type || inlineData && (inlineData.mimeType || inlineData.mime_type) || fileData && (fileData.mimeType || fileData.mime_type) || ''
      const media = Object.assign({}, part, { mime: mime, src: mediaSrc(part) })
      if (normalizeMime(mime).indexOf('image/') === 0) return [Object.assign(media, { type: 'image' })]
      if (normalizeMime(mime).indexOf('audio/') === 0) return [Object.assign(media, { type: 'audio' })]
      if (normalizeMime(mime).indexOf('video/') === 0) return [Object.assign(media, { type: 'video' })]
      return [Object.assign(media, { type: 'file' })]
    }
    if (type === 'text' || type === 'input_text' || type === 'output_text' || type === 'refusal') return normalizeTextParts(part.text || part.content || part.refusal || '')
    if (type === 'reasoning' || type === 'thinking') return [{ type: 'reasoning', text: part.text || part.content || part.thinking || part.summary || '', collapsed: part.collapsed !== false }]
    if (type === 'code') return [{ type: 'code', lang: part.lang || part.language || '', text: part.text || part.content || '' }]
    if (type === 'image' || type === 'input_image' || type === 'output_image' || type === 'image_url') {
      return [Object.assign({}, part, { type: 'image', src: mediaSrc(part) })]
    }
    if (type === 'image_generation_call' && part.result) return [Object.assign({}, part, { type: 'image', mime: 'image/png', src: mediaSrc(part) })]
    if (type === 'audio' || type === 'input_audio' || type === 'output_audio') return [Object.assign({}, part, { type: 'audio', src: mediaSrc(part) })]
    if (type === 'video') return [Object.assign({}, part, { type: 'video', src: mediaSrc(part) })]
    if (type === 'file' || type === 'input_file' || type === 'document' || type === 'resource_link') return [Object.assign({}, part, { type: 'file', src: mediaSrc(part) })]
    if (type === 'resource' && part.resource) {
      if (part.resource.text != null) return [{ type: 'code', lang: '', text: part.resource.text }]
      return [Object.assign({}, part.resource, { type: 'file', src: mediaSrc(part.resource) })]
    }
    if (type === 'tool_use' || type === 'tool-call') return [{ type: 'tool-call', call: part.call || part }]
    if (type === 'tool_result' || type === 'tool-result') return [{ type: 'tool-result', result: part.result || part }]
    if (type === 'reference' || type === 'context-ref') return [Object.assign({}, part, { type: 'context-ref' })]
    if (type === 'attachment') return [part]
    if (type === 'error') return [part]
    if (type === 'card') return [part]
    if (isImage(part)) return [Object.assign({}, part, { type: 'image', src: mediaSrc(part) })]
    if (isAudio(part)) return [Object.assign({}, part, { type: 'audio', src: mediaSrc(part) })]
    if (isVideo(part)) return [Object.assign({}, part, { type: 'video', src: mediaSrc(part) })]
    return [{ type: 'json', value: part }]
  }

  function normalizeParts(message, options) {
    options = options || {}
    const out = []
    const raw = message && (message.parts || (message.meta && message.meta.parts))
    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const parts = normalizeProviderPart(raw[i])
        for (let j = 0; j < parts.length; j++) out.push(parts[j])
      }
    } else {
      const content = message && (message.content != null ? message.content : message.text)
      if (Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) {
          const parts = normalizeProviderPart(content[i])
          for (let j = 0; j < parts.length; j++) out.push(parts[j])
        }
      } else if (content && typeof content === 'object' && content.type !== 'rich-prompt') {
        const parts = normalizeProviderPart(content)
        for (let i = 0; i < parts.length; i++) out.push(parts[i])
      } else {
        const parts = normalizeTextParts(readText(content))
        for (let i = 0; i < parts.length; i++) out.push(parts[i])
      }
    }
    const reasoning = message && (message.reasoning_content != null ? message.reasoning_content : message.reasoningContent)
    if (reasoning && !out.some(function (part) { return part.type === 'reasoning' })) {
      out.unshift({ type: 'reasoning', text: String(reasoning), collapsed: true })
    }
    if (options.includeToolCalls !== false) {
      const calls = message && (message.toolCalls || (message.meta && message.meta.toolCalls)) || []
      for (let i = 0; i < calls.length; i++) out.push({ type: 'tool-call', call: calls[i] })
    }
    if (options.includeRelated !== false) {
      const refs = message && message.contextRefs || []
      for (let i = 0; i < refs.length; i++) out.push(Object.assign({ type: 'context-ref' }, typeof refs[i] === 'string' ? { uri: refs[i] } : refs[i]))
      const attachments = message && (message.attachments || (message.meta && message.meta.attachments)) || []
      for (let i = 0; i < attachments.length; i++) out.push(Object.assign({ type: 'attachment' }, typeof attachments[i] === 'string' ? { uri: attachments[i] } : attachments[i]))
    }
    if (options.includeError !== false && message && message.status === 'error' && message.meta && message.meta.error) out.push({ type: 'error', error: message.meta.error })
    return out
  }

  function disposeTree(el) {
    if (!el) return
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function setStableText(el, text) {
    const s = String(text == null ? '' : text)
    if (el.childNodes && el.childNodes.length === 1 && el.firstChild && el.firstChild.nodeType === 3) {
      if (el.firstChild.nodeValue !== s) el.firstChild.nodeValue = s
      return
    }
    while (el.firstChild) el.removeChild(el.firstChild)
    el.appendChild(document.createTextNode(s))
  }

  function renderText(part, ctx) {
    const el = ai.messageMarkdown
      ? ai.messageMarkdown.render(part.text || '', ctx)
      : ui.h('p', 'aiditor-ai-message-text')
    if (!ai.messageMarkdown) setStableText(el, part.text || '')
    el.dataset.messagePartKind = 'text'
    return el
  }

  function renderCode(part) {
    if (ai.messageMarkdown) return ai.messageMarkdown.renderCode(part.lang || '', part.text || '')
    const wrap = ui.h('div', 'aiditor-ai-message-code-wrap')
    const head = ui.h('div', 'aiditor-ai-message-code-head')
    const lang = ui.h('span', 'aiditor-ai-message-code-lang', { text: part.lang || 'code' })
    head.appendChild(lang)
    head.appendChild(ui.copyButton({ text: part.text || '', title: 'Copy code', size: 'sm' }))
    const pre = ui.h('pre', 'aiditor-ai-message-code aiditor-ui-scrollarea')
    setStableText(pre, part.text || '')
    wrap.appendChild(head)
    wrap.appendChild(pre)
    return wrap
  }

  function renderJson(part) {
    const pre = ui.h('pre', 'aiditor-ai-message-code aiditor-ui-scrollarea')
    pre.dataset.messagePartKind = 'json'
    setStableText(pre, safeJson(part.value, 2))
    return pre
  }

  function renderError(part) {
    return ui.h('div', 'aiditor-ai-message-error', { text: readText(part.error || part.text || part.message) })
  }

  function renderReferenceLike(part, className) {
    const chip = ui.h('span', className || 'aiditor-ai-message-chip')
    chip.appendChild(ui.h('span', 'aiditor-ai-message-chip-kind', { text: part.kind || part.type || 'ref' }))
    chip.appendChild(ui.h('span', 'aiditor-ai-message-chip-title', { text: labelOf(part, 'reference') }))
    return chip
  }

  function renderFile(part) {
    const card = ui.h('div', 'aiditor-ai-message-file-card')
    const icon = ui.h('span', 'aiditor-ai-message-file-icon')
    icon.appendChild(ui.icon(isImage(part) ? 'image' : (isAudio(part) ? 'volume-2' : (isVideo(part) ? 'film' : 'file'))))
    const body = ui.h('div', 'aiditor-ai-message-file-body')
    body.appendChild(ui.h('div', 'aiditor-ai-message-file-title', { text: labelOf(part, 'file') }))
    const meta = [part.mime || part.mediaType || '', part.size ? String(part.size) + ' bytes' : ''].filter(Boolean).join(' · ')
    if (meta) body.appendChild(ui.h('div', 'aiditor-ai-message-file-meta', { text: meta }))
    card.appendChild(icon)
    card.appendChild(body)
    return card
  }

  function renderImage(part) {
    const src = mediaSrc(part)
    if (!src) return renderFile(Object.assign({}, part, { type: 'file' }))
    const figure = ui.h('figure', 'aiditor-ai-message-image')
    const img = ui.h('img', 'aiditor-ai-message-image-img')
    img.src = src
    img.alt = part.alt || labelOf(part, 'image')
    img.loading = 'lazy'
    figure.appendChild(img)
    const title = labelOf(part, '')
    if (title) figure.appendChild(ui.h('figcaption', 'aiditor-ai-message-image-caption', { text: title }))
    img.addEventListener('click', function () {
      const viewer = ui.h('div', 'aiditor-ai-message-image-viewer')
      const large = ui.h('img', 'aiditor-ai-message-image-viewer-img')
      large.src = src
      large.alt = img.alt
      viewer.appendChild(large)
      ui.modal({ title: title || 'Image', content: viewer })
    })
    return figure
  }

  function renderAudio(part) {
    const src = mediaSrc(part)
    const card = renderFile(Object.assign({}, part, { type: 'audio' }))
    if (src) {
      const audio = ui.h('audio', 'aiditor-ai-message-media')
      audio.controls = true
      audio.src = src
      card.appendChild(audio)
    }
    return card
  }

  function renderVideo(part) {
    const src = mediaSrc(part)
    if (!src) return renderFile(Object.assign({}, part, { type: 'video' }))
    const video = ui.h('video', 'aiditor-ai-message-video')
    video.controls = true
    video.src = src
    return video
  }

  function renderCard(part) {
    const card = ui.h('div', 'aiditor-ai-message-card')
    const head = ui.h('div', 'aiditor-ai-message-card-head')
    head.appendChild(ui.h('div', 'aiditor-ai-message-card-title', { text: part.title || part.label || part.kind || 'Card' }))
    if (part.subtitle || part.summary) head.appendChild(ui.h('div', 'aiditor-ai-message-card-subtitle', { text: part.subtitle || part.summary }))
    card.appendChild(head)
    if (part.data != null) {
      const pre = ui.h('pre', 'aiditor-ai-message-card-data aiditor-ui-scrollarea')
      setStableText(pre, safeJson(part.data, 2))
      card.appendChild(pre)
    }
    return card
  }

  function renderReasoning(part, ctx) {
    const details = ui.h('details', 'aiditor-ai-message-reasoning')
    const disclosureState = ctx && ctx.disclosureState
    const disclosureKey = ctx && ctx.message && ctx.message.id
      ? String(ctx.message.id) + '/' + String(ctx.partKey || 'reasoning')
      : null
    details.open = disclosureState && disclosureKey && Object.prototype.hasOwnProperty.call(disclosureState, disclosureKey)
      ? !!disclosureState[disclosureKey]
      : part.collapsed === false
    if (disclosureState && disclosureKey) {
      details.addEventListener('toggle', function () { disclosureState[disclosureKey] = details.open })
    }
    details.appendChild(ui.h('summary', 'aiditor-ai-message-reasoning-head', { text: part.title || 'Thinking' }))
    const body = ui.h('div', 'aiditor-ai-message-reasoning-body')
    body.appendChild(renderText({ text: part.text || part.summary || '' }, ctx))
    details.appendChild(body)
    return details
  }

  function copyPart(part, ctx) {
    const renderer = resolve(part, ctx)
    if (renderer && renderer.copyText) return renderer.copyText(part, ctx) || ''
    if (part.type === 'tool-call') return copyToolCall(part.call || part)
    if (part.type === 'tool-result') return 'Tool result:\n' + readText(part.result || part)
    if (part.type === 'text' || part.type === 'reasoning') return part.text || ''
    if (part.type === 'code') return part.text || ''
    if (part.type === 'json') return safeJson(part.value, 2)
    if (part.type === 'image' || part.type === 'audio' || part.type === 'video' || part.type === 'file' || part.type === 'attachment') {
      return [part.type, labelOf(part, ''), part.src || part.url || part.uri || '', part.mime || part.mediaType || ''].filter(Boolean).join(' · ')
    }
    if (part.type === 'context-ref') return [part.kind || 'ref', labelOf(part, ''), part.uri || part.id || part.refId || ''].filter(Boolean).join(' · ')
    if (part.type === 'error') return 'Error:\n' + readText(part.error || part.text || part.message)
    if (part.type === 'card') return [part.title || part.kind || 'Card', part.subtitle || part.summary || '', part.data == null ? '' : safeJson(part.data, 2)].filter(Boolean).join('\n')
    return readText(part)
  }

  function copyBlock(title, value) {
    if (value == null) return ''
    const text = readText(value).trim()
    return text ? title + ':\n' + text : ''
  }

  function copyToolCall(call) {
    call = call || {}
    const lines = []
    const name = call.name || call.toolId || call.tool || call.id || 'tool'
    const status = call.status || call.state || 'proposed'
    lines.push('[Tool] ' + name + (status ? ' (' + status + ')' : ''))
    if (call.description || call.title) lines.push('Description: ' + (call.description || call.title))
    const args = copyBlock('Args', call.args)
    if (args) lines.push(args)
    const preview = copyBlock('Preview', call.preview)
    if (preview) lines.push(preview)
    const result = copyBlock('Result', call.result)
    if (result) lines.push(result)
    const applied = copyBlock('Applied', call.applyResult)
    if (applied) lines.push(applied)
    const error = copyBlock('Error', call.error)
    if (error) lines.push(error)
    return lines.join('\n')
  }

  function copyMessage(message, ctx) {
    const parts = normalizeParts(message)
    const out = []
    for (let i = 0; i < parts.length; i++) {
      const text = copyPart(parts[i], ctx)
      if (String(text || '').trim()) out.push(text)
    }
    return out.join('\n\n')
  }

  function resolve(part, ctx) {
    for (let i = renderers.length - 1; i >= 0; i--) {
      const item = renderers[i]
      if (!item.renderer || item.disabled) continue
      if (!item.renderer.match || item.renderer.match(part, ctx)) return item.renderer
    }
    return null
  }

  function renderPart(part, ctx) {
    const renderer = resolve(part, ctx)
    const el = renderer && renderer.render ? renderer.render(part, ctx) : renderJson({ value: part })
    if (el && el.dataset) {
      el.dataset.aiMessagePartType = part.type || 'json'
      el.dataset.aiMessagePartKey = ctx && ctx.partKey || ''
    }
    return el
  }

  function renderParts(parent, message, ctx) {
    ctx = ctx || {}
    const parts = normalizeParts(message, ctx.options || {})
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === 'tool-call') continue
      const el = renderPart(parts[i], Object.assign({ partIndex: i, partKey: partKey(parts[i], i) }, ctx || {}))
      if (el) parent.appendChild(el)
    }
  }

  function patchBuiltInPart(el, part) {
    if (!el) return false
    if (part.type === 'text') {
      if (ai.messageMarkdown) ai.messageMarkdown.patch(el, part.text || '')
      else setStableText(el, part.text || '')
      return true
    }
    if (part.type === 'json') {
      setStableText(el, safeJson(part.value, 2))
      return true
    }
    if (part.type === 'error') {
      el.textContent = readText(part.error || part.text || part.message)
      return true
    }
    if (part.type === 'reasoning') {
      const body = el.children && el.children[1]
      const text = body && body.children && body.children[0]
      if (!text) return false
      if (ai.messageMarkdown) ai.messageMarkdown.patch(text, part.text || part.summary || '')
      else setStableText(text, part.text || part.summary || '')
      return true
    }
    return false
  }

  function patchParts(parent, message, ctx) {
    ctx = ctx || {}
    const all = normalizeParts(message, ctx.options || {})
    const parts = []
    for (let i = 0; i < all.length; i++) if (all[i].type !== 'tool-call') parts.push(all[i])
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const key = partKey(part, i)
      let child = parent.children && parent.children[i]
      if (!child || !child.dataset || child.dataset.aiMessagePartType !== (part.type || 'json')) {
        const next = renderPart(part, Object.assign({ partIndex: i, partKey: key }, ctx))
        if (child) {
          parent.insertBefore(next, child)
          disposeTree(child)
        } else {
          parent.appendChild(next)
        }
        continue
      }
      child.dataset.aiMessagePartKey = key
      if (!patchBuiltInPart(child, part)) {
        const next = renderPart(part, Object.assign({ partIndex: i, partKey: key }, ctx))
        parent.insertBefore(next, child)
        disposeTree(child)
      }
    }
    while (parent.children && parent.children.length > parts.length) {
      disposeTree(parent.children[parent.children.length - 1])
    }
  }

  function register(id, renderer, options) {
    const owner = options && options.owner || renderer && renderer.owner || 'aiditor.ai'
    for (let i = 0; i < renderers.length; i++) {
      if (renderers[i].id === id) throw new Error('Duplicate AI message renderer: ' + id)
    }
    renderers.push({ id: id, renderer: renderer, owner: owner })
    return function () { unregister(id) }
  }

  function unregister(id) {
    for (let i = renderers.length - 1; i >= 0; i--) {
      if (renderers[i].id === id) renderers.splice(i, 1)
    }
  }

  function unregisterOwner(owner) {
    for (let i = renderers.length - 1; i >= 0; i--) {
      if (renderers[i].owner === owner) renderers.splice(i, 1)
    }
  }

  function list() {
    return renderers.map(function (item) { return { id: item.id, owner: item.owner } })
  }

  function registerBuiltins() {
    register('builtin.text', { match: function (part) { return part.type === 'text' }, render: renderText, copyText: function (part) { return part.text || '' } })
    register('builtin.reasoning', { match: function (part) { return part.type === 'reasoning' }, render: renderReasoning, copyText: function (part) { return part.text || '' } })
    register('builtin.code', { match: function (part) { return part.type === 'code' }, render: renderCode, copyText: function (part) { return part.text || '' } })
    register('builtin.json', { match: function (part) { return part.type === 'json' }, render: renderJson, copyText: function (part) { return safeJson(part.value, 2) } })
    register('builtin.image', { match: function (part) { return part.type === 'image' || isImage(part) }, render: renderImage })
    register('builtin.audio', { match: function (part) { return part.type === 'audio' || isAudio(part) }, render: renderAudio })
    register('builtin.video', { match: function (part) { return part.type === 'video' || isVideo(part) }, render: renderVideo })
    register('builtin.file', { match: function (part) { return part.type === 'file' }, render: renderFile })
    register('builtin.context-ref', { match: function (part) { return part.type === 'context-ref' }, render: function (part) { return renderReferenceLike(part, 'aiditor-ai-message-chip') } })
    register('builtin.attachment', {
      match: function (part) { return part.type === 'attachment' },
      render: function (part) {
        if (isImage(part)) return renderImage(Object.assign({}, part, { type: 'image', src: mediaSrc(part) }))
        if (isAudio(part)) return renderAudio(Object.assign({}, part, { type: 'audio', src: mediaSrc(part) }))
        if (isVideo(part)) return renderVideo(Object.assign({}, part, { type: 'video', src: mediaSrc(part) }))
        return renderReferenceLike(part, 'aiditor-ai-message-chip')
      },
    })
    register('builtin.error', { match: function (part) { return part.type === 'error' }, render: renderError })
    register('builtin.card', { match: function (part) { return part.type === 'card' }, render: renderCard })
  }

  ai.messageParts = normalizeParts
  ai.messageCopyText = copyMessage
  ai.messageRenderers = {
    register: register,
    unregister: unregister,
    unregisterOwner: unregisterOwner,
    list: list,
    normalizeParts: normalizeParts,
    renderPart: renderPart,
    renderParts: renderParts,
    patchParts: patchParts,
    copyPart: copyPart,
    copyMessage: copyMessage,
    disposeTree: disposeTree,
  }
  registerBuiltins()
})(window.aiditor = window.aiditor || {})

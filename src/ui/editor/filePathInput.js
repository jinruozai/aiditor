// aiditor.ui.filePathInput - path string editor with file-kind affordance.
//
// This component edits a string path/URL. It does not own project asset
// semantics, import policy, workspace object URL leasing, or history.
//
// opts:
//   value:        string | signal<string>       the file path or URL
//   onChange?:    (v) => void
//   kind?:        'image' | 'audio' | 'text' | 'file'
//                                                preview/control shape +
//                                                drop filter
//   placeholder?: string | signal               path hint
//   accept?:      string                        native picker accept filter
//   onBrowse?:    (current,ctx) => Promise<string|null> | string | null
//                                                custom "pick" action;
//                                                default opens a hidden
//                                                file input and stores an
//                                                object URL.
//   onFile?:      (file,current) => Promise<string|null> | string | null
//                                                custom import path;
//                                                used by drop + default browse.
//   resolveSrc?:  (value) => string             preview/playback URL resolver for
//                                                workspace-relative paths.
//   exists?:      (value) => boolean            marks missing paths
//   preview?:     (ctx) => Node|null            custom leading preview/control
//   actions?:     UiAction[] | (ctx) => UiAction[]
//                                                extra trailing menu actions
//   onAction?:    (ctx) => void                 optional observer for built-in
//                                                load/clear actions
//
// Layout: [preview/control] [path input] [actions]. Clicking a non-audio
// preview opens the picker. Dragging the preview exports the current value as
// text/uri-list plus typed aiditor file-path MIME data.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  ui.filePathInput = function (opts) {
    const o = opts || {}
    const sig         = ui.asSig(o.value       != null ? o.value       : '')
    const placeholder = ui.asSig(o.placeholder != null ? o.placeholder : '')
    const kind        = o.kind || 'file'
    const accept      = o.accept || ''
    const doWrite     = ui.writer(sig, o.onChange, 'ui.filePathInput')

    const wrap = ui.h('div', 'aiditor-ui-file-path-input aiditor-ui-field')
    let ownedUrl = null
    let audioEl = null
    function revokeOwnedUrl() {
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
      ownedUrl = null
    }
    function writeOwnedUrl(url) {
      if (ownedUrl && ownedUrl !== url) revokeOwnedUrl()
      ownedUrl = url
      doWrite(url)
    }
    ui.collect(wrap, revokeOwnedUrl)
    ui.collect(wrap, function () { if (audioEl) audioEl.pause() })

    const preview = ui.h('div', 'aiditor-ui-file-path-preview')
    function mediaSrc(v) {
      return typeof o.resolveSrc === 'function' ? o.resolveSrc(v) : v
    }
    function paintPreview(value) {
      preview.innerHTML = ''
      const v = value == null ? '' : String(value)
      if (audioEl) audioEl.pause()
      audioEl = null
      if (typeof o.preview === 'function') {
        const custom = o.preview({
          value: v,
          kind: kind,
          browse: doBrowse,
          resolveSrc: mediaSrc,
        })
        if (custom) preview.appendChild(custom)
        else preview.appendChild(placeholderIcon())
        return
      }
      if (kind === 'image' && v) {
        const src = mediaSrc(v)
        if (!src) {
          preview.appendChild(placeholderIcon())
          return
        }
        const img = document.createElement('img')
        img.src = src
        img.onerror = function () { img.remove(); preview.appendChild(placeholderIcon()) }
        preview.appendChild(img)
      } else if (kind === 'audio') {
        preview.appendChild(audioButton(v))
      } else {
        preview.appendChild(placeholderIcon())
      }
    }
    function placeholderIcon() {
      return ui.icon({ name: kind === 'image' ? 'image' : kind === 'audio' ? 'music' : 'file', size: 'sm' })
    }
    function audioButton(value) {
      const button = ui.h('button', 'aiditor-ui-file-path-play', { type: 'button', title: value ? 'Play audio' : 'Choose audio file' })
      let playing = false
      function paint() {
        button.replaceChildren(ui.icon({ name: playing ? 'pause' : 'music', size: 'sm' }))
      }
      button.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        if (!value) {
          doBrowse()
          return
        }
        if (!audioEl) {
          audioEl = new Audio(mediaSrc(value))
          audioEl.addEventListener('ended', function () { playing = false; paint() })
          audioEl.addEventListener('pause', function () { playing = false; paint() })
          audioEl.addEventListener('play', function () { playing = true; paint() })
        }
        if (audioEl.paused) audioEl.play().catch(function () {})
        else audioEl.pause()
      })
      paint()
      return button
    }
    preview.addEventListener('click', function () { if (kind !== 'audio') doBrowse() })
    wrap.appendChild(preview)

    // Path input. We reuse ui.input, which already arrives wrapped in its
    // own .aiditor-ui-field — strip that layer's border so our outer frame
    // stays the only visible box.
    const pathSig = aiditor.signal(String(sig.peek() || ''))
    const input = ui.input({ value: pathSig, placeholder: placeholder })
    input.classList.add('aiditor-ui-file-path-field')
    input.style.flex = '1 1 auto'
    input.style.minWidth = '0'
    const innerInput = input.querySelector('input')
    if (innerInput) innerInput.style.border = '0'
    wrap.appendChild(input)
    ui.collect(wrap, function () { ui.dispose(input) })

    const menuBtn = ui.iconButton({
      icon: 'more-vertical',
      title: 'File path actions',
      ariaLabel: 'File path actions',
      size: 'sm',
      kind: 'ghost',
      onClick: openActionMenu,
    })
    menuBtn.classList.add('aiditor-ui-file-path-actions')
    wrap.appendChild(menuBtn)

    // signal ⇄ input bi-sync
    ui.bind(wrap, sig, function (v) {
      const s = v == null ? '' : String(v)
      if (ownedUrl && s !== ownedUrl) revokeOwnedUrl()
      if (pathSig.peek() !== s) pathSig.set(s)
      wrap.classList.toggle('is-missing', !!s && typeof o.exists === 'function' && !o.exists(s))
      paintPreview(s)
    })
    ui.collect(wrap, aiditor.effect(function () {
      const s = pathSig()
      if (s !== String(sig.peek() || '')) doWrite(s)
    }))

    // Drop target — the whole frame accepts dragged file paths that match
    // our `kind`. Files, URL drops, and other aiditor path sources all flow
    // through ui.dnd.extractUrl so the consumer just sees a final string.
    ui.dropzone(wrap, {
      accept:  ['Files', 'text/uri-list', 'text/plain', 'application/aiditor.file-path+json', 'application/aiditor.file-path.' + kind + '+json', 'application/aiditor.asset+json', 'application/aiditor.asset.' + kind + '+json'],
      canDrop: function (d) { return matchesInputKind(d, kind) && matchesAccept(d, accept) },
      onDrop:  function (d) {
        if (d.filePath && d.filePath.value) {
          doWrite(ui.dnd.extractUrl(d))
          return
        }
        if (d.asset && d.asset.value) {
          doWrite(ui.dnd.extractUrl(d))
          return
        }
        if (d.files && d.files[0] && typeof o.onFile === 'function') {
          const res = o.onFile(d.files[0], sig.peek())
          if (res && typeof res.then === 'function') res.then(function (v) { if (v != null) doWrite(v) })
          else if (res != null) doWrite(res)
          return
        }
        if (d.files && d.files[0]) {
          writeOwnedUrl(URL.createObjectURL(d.files[0]))
          return
        }
        doWrite(ui.dnd.extractUrl(d))
      },
    })

    // Drag source — the preview exports the current value. Other compatible
    // file path inputs can receive it; OS targets get the plain URL.
    ui.dragsource(preview, {
      effect:  'copyMove',
      getData: function () {
        const v = sig.peek() || ''
        if (!v) return {}
        return {
          'text/uri-list':              v,
          'text/plain':                 v,
          'application/aiditor.file-path+json':  JSON.stringify({ kind: kind, value: v }),
          ['application/aiditor.file-path.' + kind + '+json']: JSON.stringify({ kind: kind, value: v }),
        }
      },
    })

    let browseInput = null
    ui.collect(wrap, function () {
      if (browseInput && browseInput.parentNode) browseInput.parentNode.removeChild(browseInput)
      browseInput = null
    })

    function doBrowse() {
      if (typeof o.onBrowse === 'function') {
        const res = o.onBrowse(sig.peek(), actionCtx('load'))
        if (res && typeof res.then === 'function') {
          res.then(function (v) { if (v != null) doWrite(v) })
        } else if (res != null) {
          doWrite(res)
        }
        return
      }
      // Fallback: hidden native file input → object URL.
      if (browseInput && browseInput.parentNode) browseInput.parentNode.removeChild(browseInput)
      const f = document.createElement('input')
      browseInput = f
      f.type = 'file'
      if (accept) f.accept = accept
      f.style.display = 'none'
      document.body.appendChild(f)
      function cleanup() {
        if (f.parentNode) f.parentNode.removeChild(f)
        if (browseInput === f) browseInput = null
      }
      f.addEventListener('change', function () {
        const file = f.files && f.files[0]
        if (file && typeof o.onFile === 'function') {
          const res = o.onFile(file, sig.peek())
          if (res && typeof res.then === 'function') res.then(function (v) { if (v != null) doWrite(v) })
          else if (res != null) doWrite(res)
        } else if (file) {
          writeOwnedUrl(URL.createObjectURL(file))
        }
        cleanup()
      })
      f.addEventListener('cancel', cleanup)
      f.click()
    }

    function openActionMenu(event) {
      if (event && event.preventDefault) event.preventDefault()
      if (event && event.stopPropagation) event.stopPropagation()
      ui.actionMenu({
        anchor: menuBtn,
      actions: actionItems(),
      ctx: actionCtx('menu'),
        sourceScope: 'ui.filePathInput',
        side: 'bottom',
        align: 'end',
      })
    }

    function actionItems() {
      const hasValue = !!String(sig.peek() || '')
      const ctx = actionCtx('menu')
      const extra = resolveActions(o.actions, ctx)
      const items = [
        { id: 'load', label: 'Load', icon: 'folder', onSelect: function () { runAction('load') } },
        { id: 'clear', label: 'Clear', icon: 'x', disabled: !hasValue, onSelect: function () { runAction('clear') } },
      ]
      if (extra.length) items.push({ type: 'divider' })
      return items.concat(extra)
    }

    function runAction(action) {
      if (action === 'load') doBrowse()
      else if (action === 'clear') doWrite('')
      const ctx = actionCtx(action)
      if (typeof o.onAction === 'function') {
        const result = aiditor.safeCall({ scope: 'ui.filePathInput', action: action }, function () {
          return o.onAction(ctx)
        })
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(function (err) { aiditor.reportError({ scope: 'ui.filePathInput', action: action }, err) })
        }
      }
    }

    function actionCtx(action) {
      return {
        action: action,
        value: sig.peek() == null ? '' : String(sig.peek()),
        directory: parentPath(sig.peek()),
        kind: kind,
        accept: accept,
        input: wrap,
      }
    }

    paintPreview(sig.peek())
    return wrap
  }

  function matchesInputKind(data, kind) {
    if (!kind || kind === 'file' || kind === 'text') return true
    if (ui.dnd && ui.dnd.matchesKind && ui.dnd.matchesKind(data, kind)) return true
    if (kind === 'image') return matchesKnownKind(data, /^image\//, IMG_EXT)
    if (kind === 'audio') return matchesKnownKind(data, /^audio\//, AUD_EXT)
    return false
  }

  function matchesKnownKind(data, mimeRe, extRe) {
    if (!data) return false
    if (data.files) for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i]
      if (mimeRe.test(file.type || '') || extRe.test(file.name || '')) return true
    }
    if (data.fileMimes) for (let i = 0; i < data.fileMimes.length; i++) {
      if (mimeRe.test(data.fileMimes[i] || '')) return true
    }
    return extRe.test(String(data.uri || '').split(/[?#]/)[0])
      || extRe.test(String(data.text || '').split(/[?#]/)[0])
      || extRe.test(String(data.filePath && data.filePath.value || '').split(/[?#]/)[0])
      || extRe.test(String(data.asset && data.asset.value || '').split(/[?#]/)[0])
  }

  function resolveActions(actions, ctx) {
    if (!actions) return []
    const list = typeof actions === 'function'
      ? aiditor.safeCall({ scope: 'ui.filePathInput', action: 'actions' }, function () { return actions(ctx) })
      : actions
    return Array.isArray(list) ? list : []
  }

  function parentPath(value) {
    const text = String(value == null ? '' : value)
    const clean = text.split(/[?#]/)[0]
    const scheme = clean.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//)
    if (scheme) {
      const rootEnd = scheme[0].length
      const slashAfterRoot = clean.indexOf('/', rootEnd)
      if (slashAfterRoot < 0) return clean.slice(0, rootEnd)
      return clean.slice(0, slashAfterRoot)
    }
    const slash = clean.lastIndexOf('/')
    if (slash < 0) return ''
    if (slash === 0) return '/'
    return clean.slice(0, slash)
  }

  function matchesAccept(data, accept) {
    const spec = String(accept || '').trim()
    if (!spec) return true
    const parts = spec.split(',').map(function (s) { return s.trim().toLowerCase() }).filter(Boolean)
    if (!parts.length) return true
    const values = []
    if (data && data.files) data.files.forEach(function (file) {
      values.push({ name: String(file.name || '').toLowerCase(), mime: String(file.type || '').toLowerCase() })
    })
    if (data && data.fileMimes) data.fileMimes.forEach(function (mime) {
      values.push({ name: '', mime: String(mime || '').toLowerCase() })
    })
    const path = data && (data.uri || data.text || data.filePath && data.filePath.value || data.asset && data.asset.value)
    if (path) values.push({ name: String(path).split(/[?#]/)[0].toLowerCase(), mime: '' })
    if (!values.length) return true
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < parts.length; j++) {
        if (acceptValue(values[i], parts[j])) return true
      }
    }
    return false
  }

  function acceptValue(value, part) {
    if (!part) return false
    if (part[0] === '.') return value.name.endsWith(part) || mimeMatchesExt(value.mime, part)
    if (part.slice(-2) === '/*') return !!value.mime && value.mime.indexOf(part.slice(0, -1)) === 0
    return value.mime === part || value.name.endsWith('.' + part)
  }

  function mimeMatchesExt(mime, ext) {
    if (!mime) return false
    const list = MIME_EXTENSIONS[mime]
    return !!list && list.indexOf(ext) >= 0
  }

  const MIME_EXTENSIONS = {
    'image/png':       ['.png'],
    'image/jpeg':      ['.jpg', '.jpeg'],
    'image/gif':       ['.gif'],
    'image/webp':      ['.webp'],
    'image/svg+xml':   ['.svg'],
    'image/avif':      ['.avif'],
    'image/bmp':       ['.bmp'],
    'audio/mpeg':      ['.mp3'],
    'audio/mp3':       ['.mp3'],
    'audio/wav':       ['.wav'],
    'audio/x-wav':     ['.wav'],
    'audio/ogg':       ['.ogg'],
    'audio/flac':      ['.flac'],
    'audio/aac':       ['.aac'],
    'audio/mp4':       ['.m4a'],
    'text/plain':      ['.txt'],
    'application/json':['.json'],
  }
  const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
  const AUD_EXT = /\.(mp3|wav|ogg|flac|m4a|aac)$/i
})(window.aiditor = window.aiditor || {})

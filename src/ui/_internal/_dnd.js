// aiditor.ui.dropzone / aiditor.ui.dragsource — HTML5-native DnD primitives.
//
// Two small helpers that any component can opt into. Both rely on the native
// DataTransfer API, which means OS file drops work out of the box and
// cross-window transfers behave the way users expect from web apps.
//
// This is the *generic* DnD layer. Components that need pixel-precise
// drop feedback (tree row reordering, dock panel tearing) keep their own
// pointer-based implementations — the two paths listen to disjoint event
// families and can coexist on the same element.
//
// ── MIME conventions (UI-library-wide) ────────────────────────────────
//   Files                            virtual type — DataTransfer.files
//   text/uri-list                    single URL (image/audio/doc paths)
//   text/plain                       fallback for plain strings
//   application/aiditor.file-path+json        { kind:'image'|'audio'|'text'|'file', value, meta? }
//   application/aiditor.file-path.<kind>+json  same payload, hover-readable kind hint
//   application/aiditor.asset+json        { kind:'image'|'audio'|'file', value, meta? }
//   application/aiditor.asset.<kind>+json  same payload, hover-readable kind hint
//   application/aiditor.asset.entry+json   [{ kind, path?, url?, name? }]
//   application/aiditor.entity+json       { id, pathKey }  — game-entity reference
//
// dropzone unpacks all of the above into a flat `data` object so handlers
// don't have to know which MIME the source used. dragsource takes a
// type→string map and writes them all at dragstart.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}

  const CLASS_ACTIVE = 'aiditor-ui-dropzone-active'
  const CLASS_REJECT = 'aiditor-ui-dropzone-reject'

  // Browser rules at dragover time:
  //   dt.types        — readable (list of MIMEs + the 'Files' virtual type)
  //   dt.items[*].type — readable (MIME per item — including files!)
  //   dt.files         — blocked (empty until drop)
  //   dt.getData(...)  — allowed for 'text/*' only; blocked for other MIMEs
  // At drop time all three are fully readable.
  //
  // We surface the item-level file MIMEs as `fileMimes` so helpers like
  // matchesKind can accurately refuse a non-image file before drop —
  // that's what the user sees as correct green/red feedback.
  function peekTypes(dt) {
    const out = []
    if (dt.files && dt.files.length) out.push('Files')
    const types = dt.types
    if (types) for (let i = 0; i < types.length; i++) out.push(types[i])
    // 'Files' might be reported via items even when dt.types misses it.
    if (out.indexOf('Files') < 0 && dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file') { out.push('Files'); break }
      }
    }
    return out
  }

  function peekFileMimes(dt) {
    const out = []
    if (dt.items) for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i]
      if (it.kind === 'file' && it.type) out.push(it.type)
    }
    return out
  }

  function extractData(dt, full) {
    const data = { types: peekTypes(dt) }
    const mimes = peekFileMimes(dt)
    if (mimes.length) data.fileMimes = mimes
    if (dt.files && dt.files.length) data.files = Array.from(dt.files)
    const uri = safeRead(dt, 'text/uri-list')
    if (uri) data.uri = uri.split('\n').find(function (l) { return l && l[0] !== '#' }) || ''
    const text = safeRead(dt, 'text/plain')
    if (text && !data.uri) data.text = text
    if (full) {
      const filePath = safeRead(dt, 'application/aiditor.file-path+json')
      if (filePath) { try { data.filePath = JSON.parse(filePath) } catch (_) {} }
      const asset = safeRead(dt, 'application/aiditor.asset+json')
      if (asset) { try { data.asset = JSON.parse(asset) } catch (_) {} }
      const assetEntries = safeRead(dt, 'application/aiditor.asset.entry+json')
      if (assetEntries) { try { data.assetEntries = JSON.parse(assetEntries) } catch (_) {} }
      const entity = safeRead(dt, 'application/aiditor.entity+json')
      if (entity) { try { data.entity = JSON.parse(entity) } catch (_) {} }
    }
    return data
  }
  function safeRead(dt, type) { try { return dt.getData(type) } catch (_) { return '' } }

  // Shallow gate that works with only dt.types (no file/JSON content).
  // If `accept` is a function, caller owns the full decision; we pass the
  // shallow `data` and they can `return true` optimistically at dragover
  // then refine in canDrop at drop time.
  function matchesAccept(accept, types) {
    if (!accept || !accept.length) return true
    for (let i = 0; i < accept.length; i++) {
      const a = accept[i]
      if (a === 'Files' && types.indexOf('Files') >= 0) return true
      if (types.indexOf(a) >= 0) return true
    }
    return false
  }

  ui.dropzone = function (el, opts) {
    const o = opts || {}
    const accept  = o.accept || null
    const canDrop = typeof o.canDrop === 'function' ? o.canDrop : function () { return true }
    const onDrop  = typeof o.onDrop  === 'function' ? o.onDrop  : null
    if (!onDrop) throw new Error('ui.dropzone: onDrop is required')

    let depth = 0     // track nested dragenter/leave so we don't flicker on child hover

    function clear() {
      depth = 0
      el.classList.remove(CLASS_ACTIVE)
      el.classList.remove(CLASS_REJECT)
    }

    // preventDefault is decoupled from canDrop: if the types are in our
    // accept list, we *commit* to handling the drop (calling
    // preventDefault everywhere). canDrop only steers the visual class
    // and whether onDrop fires at commit. Without this split, any
    // canDrop false-negative at hover would let the browser fall back
    // to its default behavior — which for a file drop is "navigate to
    // the file" and loses the user's data.
    function typesOk(ev) {
      return matchesAccept(accept, peekTypes(ev.dataTransfer))
    }
    function shallowCanDrop(ev) {
      return canDrop(extractData(ev.dataTransfer, false))
    }

    function onEnter(ev) {
      depth++
      if (!typesOk(ev)) return
      ev.preventDefault()
      const ok = shallowCanDrop(ev)
      el.classList.toggle(CLASS_ACTIVE, ok)
      el.classList.toggle(CLASS_REJECT, !ok)
    }
    function onOver(ev) {
      if (!typesOk(ev)) return
      // Owning the event: browser's default (open file / navigate) suppressed.
      ev.preventDefault()
      ev.dataTransfer.dropEffect = shallowCanDrop(ev) ? (o.effect || 'copy') : 'none'
    }
    function onLeave() {
      if (--depth <= 0) clear()
    }
    function onDropEv(ev) {
      if (!typesOk(ev)) return
      ev.preventDefault()
      clear()
      const data = extractData(ev.dataTransfer, true)
      if (!canDrop(data)) return
      onDrop(data, ev)
    }

    el.addEventListener('dragenter', onEnter)
    el.addEventListener('dragover',  onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop',      onDropEv)

    const detach = function () {
      el.removeEventListener('dragenter', onEnter)
      el.removeEventListener('dragover',  onOver)
      el.removeEventListener('dragleave', onLeave)
      el.removeEventListener('drop',      onDropEv)
      clear()
    }
    ui.collect(el, detach)
    return detach
  }

  ui.dragsource = function (el, opts) {
    const o = opts || {}
    const getData = typeof o.getData === 'function' ? o.getData : null
    if (!getData) throw new Error('ui.dragsource: getData is required')
    el.setAttribute('draggable', 'true')

    function onStart(ev) {
      const payload = getData() || {}
      for (const type in payload) {
        const v = payload[type]
        if (v != null) ev.dataTransfer.setData(type, String(v))
      }
      if (o.effect) ev.dataTransfer.effectAllowed = o.effect
      if (typeof o.preview === 'function') {
        const img = o.preview(el)
        if (img) {
          // The browser needs the element visible in the DOM to snapshot it.
          // We park it off-screen, call setDragImage, and drop it on the next
          // tick — setDragImage has already taken its bitmap by then.
          img.style.position = 'fixed'
          img.style.top = '-9999px'
          document.body.appendChild(img)
          ev.dataTransfer.setDragImage(img, 12, 12)
          setTimeout(function () { if (img.parentNode) img.parentNode.removeChild(img) }, 0)
        }
      }
      el.classList.add('aiditor-ui-dragging')
    }
    function onEnd() { el.classList.remove('aiditor-ui-dragging') }

    el.addEventListener('dragstart', onStart)
    el.addEventListener('dragend',   onEnd)

    const detach = function () {
      el.removeAttribute('draggable')
      el.removeEventListener('dragstart', onStart)
      el.removeEventListener('dragend',   onEnd)
      el.classList.remove('aiditor-ui-dragging')
    }
    ui.collect(el, detach)
    return detach
  }

  // ── shared predicate helpers (used by asset-kind consumers) ─────────
  // Two tiny functions so every asset consumer doesn't re-implement the
  // same "is this image-shaped?" test. Exposed under ui.dnd.* so users
  // can compose their own canDrop quickly.
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i
  const AUD_RE = /\.(mp3|wav|ogg|flac|m4a|aac)$/i

  function anyMimeMatches(list, re) {
    if (!list) return false
    for (let i = 0; i < list.length; i++) if (re.test(list[i])) return true
    return false
  }
  function anyFileMatches(files, re) {
    if (!files) return false
    for (let i = 0; i < files.length; i++) if (re.test(files[i].type || '')) return true
    return false
  }
  function urlMatches(v, re) {
    if (!v) return false
    return re.test(String(v).split(/[?#]/)[0])
  }

  function matchesKind(data, kind) {
    if (!data) return false
    // Prefer the most specific signal that's actually readable at this
    // phase: files (drop) → fileMimes (hover via dt.items) → uri/text → asset.
    if (kind === 'image') {
      if (data.types && data.types.indexOf('application/aiditor.file-path.image+json') >= 0) return true
      if (data.types && data.types.indexOf('application/aiditor.asset.image+json') >= 0) return true
      if (anyFileMatches(data.files, /^image\//))      return true
      if (anyMimeMatches(data.fileMimes, /^image\//))  return true
      if (urlMatches(data.uri, IMG_RE))  return true
      if (urlMatches(data.text, IMG_RE)) return true
      if (data.filePath) return data.filePath.kind === 'image' || urlMatches(data.filePath.value, IMG_RE)
      if (data.asset) return data.asset.kind === 'image' || urlMatches(data.asset.value, IMG_RE)
      return false
    }
    if (kind === 'audio') {
      if (data.types && data.types.indexOf('application/aiditor.file-path.audio+json') >= 0) return true
      if (data.types && data.types.indexOf('application/aiditor.asset.audio+json') >= 0) return true
      if (anyFileMatches(data.files, /^audio\//))      return true
      if (anyMimeMatches(data.fileMimes, /^audio\//))  return true
      if (urlMatches(data.uri, AUD_RE))  return true
      if (urlMatches(data.text, AUD_RE)) return true
      if (data.filePath) return data.filePath.kind === 'audio' || urlMatches(data.filePath.value, AUD_RE)
      if (data.asset) return data.asset.kind === 'audio' || urlMatches(data.asset.value, AUD_RE)
      return false
    }
    // 'file' / default — accept anything that carries a File or URL.
    return !!(data.files || data.fileMimes || data.uri || (data.filePath && data.filePath.value) || (data.asset && data.asset.value))
  }

  // Pull the best URL out of a dropped payload. Priority: asset.value >
  // uri > first File's object URL. The caller decides what to do with
  // object URLs (persist, upload, discard on unload).
  function extractUrl(data) {
    if (!data) return ''
    if (data.filePath && data.filePath.value) return String(data.filePath.value)
    if (data.asset && data.asset.value) return String(data.asset.value)
    if (data.uri) return data.uri
    if (data.files && data.files.length) return URL.createObjectURL(data.files[0])
    if (data.text) return data.text
    return ''
  }

  ui.dnd = { matchesKind: matchesKind, extractUrl: extractUrl }
})(window.aiditor = window.aiditor || {})

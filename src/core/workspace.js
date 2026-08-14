// aiditor.workspace - bounded file access adapters.
;(function (aiditor) {
  'use strict'

  const workspace = {}
  const HANDLE_DB = 'aiditor.workspace.handles'
  const HANDLE_STORE = 'handles'
  const SEARCH_MAX_FILES = 1000
  const SEARCH_MAX_FILE_BYTES = 1024 * 1024
  const SEARCH_MAX_RESULTS = 50
  const SEARCH_MAX_PER_FILE = 20
  const SEARCH_MAX_DIAGNOSTICS = 100
  const bindingsSig = aiditor.signal({})

  /**
   * @aiditorApi aiditor.workspace.bind
   * @group workspace
   * @layer core
   * @kind js-api
   * @signature aiditor.workspace.bind(id, adapter)
   * @summary Bind a runtime workspace adapter to a JSON-safe id so PanelData stores identity rather than live adapter objects.
   * @param {string} id - Stable host-owned workspace id.
   * @param {object} adapter - Workspace adapter created by memory, fromHandle, fromBridge, or another contract-compatible host.
   * @returns {Function} Idempotent owner-safe unbind callback.
   * @related aiditor.workspace.binding,aiditor.ui.createTextDocument
   */
  function bind(id, adapter) {
    id = String(id || 'default')
    const current = Object.assign({}, bindingsSig.peek())
    current[id] = adapter
    bindingsSig.set(current)
    return function () { unbind(id, adapter) }
  }

  function unbind(id, adapter) {
    id = String(id || 'default')
    const current = Object.assign({}, bindingsSig.peek())
    if (adapter && current[id] !== adapter) return false
    if (!Object.prototype.hasOwnProperty.call(current, id)) return false
    delete current[id]
    bindingsSig.set(current)
    return true
  }

  function binding(id) {
    return bindingsSig()[String(id || 'default')] || null
  }

  function hashText(text) {
    text = String(text == null ? '' : text)
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return 'aiditor-fnv1a-' + h.toString(16)
  }

  function hashBytes(bytes) {
    let h = 2166136261
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]
      h = Math.imul(h, 16777619) >>> 0
    }
    return 'aiditor-fnv1a-bytes-' + h.toString(16)
  }

  async function hashBlob(blob) {
    const buffer = await blob.arrayBuffer()
    return hashBytes(new Uint8Array(buffer))
  }

  function isBlob(value) {
    return value && typeof value.arrayBuffer === 'function' && typeof value.size === 'number'
  }

  async function blobText(blob) {
    if (blob.text) return blob.text()
    return new Promise(function (resolve, reject) {
      const reader = new FileReader()
      reader.onload = function () { resolve(String(reader.result || '')) }
      reader.onerror = function () { reject(reader.error) }
      reader.readAsText(blob)
    })
  }

  function makeBlob(value, type) {
    if (isBlob(value)) return value
    return new Blob([String(value == null ? '' : value)], { type: type || 'text/plain' })
  }

  function normalizePath(path) {
    path = String(path || '').replace(/\\/g, '/')
    const raw = path.split('/')
    const out = []
    for (let i = 0; i < raw.length; i++) {
      const part = raw[i]
      if (!part || part === '.') continue
      if (part === '..') throw new Error('workspace: path escapes root: ' + path)
      out.push(part)
    }
    return out.join('/')
  }

  function parentPath(path) {
    const i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
  }

  function fileName(path) {
    const i = path.lastIndexOf('/')
    return i < 0 ? path : path.slice(i + 1)
  }

  function textResult(path, text, mtime) {
    text = String(text == null ? '' : text)
    return { path: path, text: text, hash: hashText(text), size: text.length, mtime: mtime || null, mime: 'text/plain' }
  }

  async function blobResult(path, blob, hash) {
    return {
      path: path,
      blob: blob,
      hash: hash || await hashBlob(blob),
      size: blob.size,
      mime: blob.type || null,
    }
  }

  function workspaceError(code, message, extra) {
    const err = new Error(message)
    err.code = code
    if (extra) Object.keys(extra).forEach(function (key) { err[key] = extra[key] })
    return err
  }

  function workspaceReason(err) {
    const raw = String(err && (err.reason || err.code || err.name) || '').toLowerCase()
    const message = String(err && err.message || '').toLowerCase()
    if (raw.indexOf('notfound') >= 0 || raw === 'enoent' || raw === 'not_found' || message.indexOf('not found') >= 0) return 'not_found'
    if (raw.indexOf('notallowed') >= 0 || raw.indexOf('security') >= 0 || raw === 'eacces' || raw === 'eperm' || raw === 'permission_denied') return 'permission_denied'
    if (raw.indexOf('notreadable') >= 0 || raw === 'not_readable') return 'not_readable'
    if (raw.indexOf('quota') >= 0 || raw === 'enospc' || raw === 'quota_exceeded') return 'quota_exceeded'
    if (raw === 'missing_base_hash' || raw === 'stale_file' || raw === 'stale') return 'stale'
    if (message.indexOf('appeared after preview') >= 0 || message.indexOf('disappeared after preview') >= 0 || message.indexOf('changed after preview') >= 0 || message.indexOf('basehash mismatch') >= 0 || message.indexOf('targetbasehash mismatch') >= 0) return 'stale'
    if (raw === 'max_memory_bytes' || raw === 'size_limit') return 'size_limit'
    if (raw === 'recursive_required') return 'recursive_required'
    return 'platform_error'
  }

  function structuredWorkspaceError(op, path, err, extra) {
    const reason = workspaceReason(err)
    const code = String(err && err.code || reason).toUpperCase()
    const safePath = normalizePath(path || '')
    const detail = err && err.message ? ': ' + err.message : ''
    const out = workspaceError(code, 'workspace.' + op + ': ' + reason + ': ' + safePath + detail, Object.assign({
      op: op,
      path: safePath,
      reason: reason,
      permissionRecovery: reason === 'permission_denied',
    }, extra || {}))
    out.cause = err
    return out
  }

  function diffSummary(before, after) {
    before = String(before == null ? '' : before)
    after = String(after == null ? '' : after)
    const a = before.split(/\r?\n/)
    const b = after.split(/\r?\n/)
    let prefix = 0
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
    let suffix = 0
    while (
      suffix + prefix < a.length &&
      suffix + prefix < b.length &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) suffix++
    const removed = Math.max(0, a.length - prefix - suffix)
    const added = Math.max(0, b.length - prefix - suffix)
    return {
      beforeHash: hashText(before),
      afterHash: hashText(after),
      beforeSize: before.length,
      afterSize: after.length,
      beforeLines: a.length,
      afterLines: b.length,
      startLine: prefix + 1,
      removedLines: removed,
      addedLines: added,
      changed: before !== after,
    }
  }

  function extensionOf(path) {
    const name = fileName(normalizePath(path)).toLowerCase()
    const i = name.lastIndexOf('.')
    return i >= 0 ? name.slice(i) : ''
  }

  function normalizeSaveTargetOptions(opts) {
    const input = opts || {}
    const extensions = []
    if (input.extensions != null && !Array.isArray(input.extensions)) {
      throw workspaceError('INVALID_EXTENSIONS', 'workspace.pickSaveTarget: extensions must be an array')
    }
    for (let i = 0; i < (input.extensions || []).length; i++) {
      let ext = String(input.extensions[i] || '').trim().toLowerCase()
      if (!ext) continue
      if (ext[0] !== '.') ext = '.' + ext
      if (!/^\.[a-z0-9][a-z0-9._+-]*$/i.test(ext)) {
        throw workspaceError('INVALID_EXTENSION', 'workspace.pickSaveTarget: invalid extension: ' + ext)
      }
      if (extensions.indexOf(ext) < 0) extensions.push(ext)
    }

    let suggestedName = String(input.suggestedName || '')
    if (suggestedName && /[\\/]/.test(suggestedName)) {
      throw workspaceError('INVALID_SUGGESTED_NAME', 'workspace.pickSaveTarget: suggestedName must be a file name')
    }
    if (suggestedName && extensions.length) {
      const ext = extensionOf(suggestedName)
      if (!ext) suggestedName += extensions[0]
      else if (!matchesSaveExtension(suggestedName, extensions)) {
        throw workspaceError('INVALID_EXTENSION', 'workspace.pickSaveTarget: suggestedName does not match extensions')
      }
    }

    return {
      suggestedName: suggestedName,
      extensions: extensions,
      description: String(input.description || ''),
      mimeType: String(input.mimeType || 'application/octet-stream'),
    }
  }

  function matchesSaveExtension(path, extensions) {
    const name = fileName(normalizePath(path)).toLowerCase()
    for (let i = 0; i < extensions.length; i++) {
      if (name.slice(-extensions[i].length) === extensions[i]) return true
    }
    return false
  }

  function normalizeSaveTargetPath(path, extensions) {
    const raw = String(path || '')
    if (!raw || /^[\\/]/.test(raw) || /^[a-z]:[\\/]/i.test(raw)) {
      throw workspaceError('OUTSIDE_WORKSPACE', 'workspace.pickSaveTarget: target is outside the workspace')
    }
    const normalized = normalizePath(raw)
    if (!normalized) throw workspaceError('INVALID_TARGET', 'workspace.pickSaveTarget: target file is required')
    if (extensions.length && !matchesSaveExtension(normalized, extensions)) {
      throw workspaceError('INVALID_EXTENSION', 'workspace.pickSaveTarget: target extension is not allowed: ' + normalized)
    }
    return normalized
  }

  function nativeSavePickerOptions(rootHandle, opts) {
    const out = { startIn: rootHandle }
    if (opts.suggestedName) out.suggestedName = opts.suggestedName
    if (opts.extensions.length) {
      out.types = [{
        description: opts.description || opts.extensions.join(', '),
        accept: (function () {
          const accept = {}
          accept[opts.mimeType] = opts.extensions.slice()
          return accept
        })(),
      }]
      out.excludeAcceptAllOption = true
    }
    return out
  }

  function hasTruncationMarker(text) {
    return String(text || '').indexOf('...[truncated]') >= 0
  }

  function isClassicScript(text) {
    return !/(^|\n)\s*(import\s+[\w*{(]|export\s+)/.test(String(text || ''))
  }

  function validateText(path, text, opts) {
    const o = opts || {}
    const mode = o.validate || 'auto'
    if (mode === false || mode === 'none') return true
    text = String(text == null ? '' : text)
    if (hasTruncationMarker(text)) throw new Error('workspace.validate: text contains a truncation marker: ' + path)
    const ext = extensionOf(path)
    const jsonLike = mode === 'json' || (mode === 'auto' && (ext === '.json' || ext === '.jsonc'))
    const jsLike = mode === 'javascript' || (mode === 'auto' && ['.js', '.mjs', '.cjs'].indexOf(ext) >= 0)
    if (jsonLike) {
      try { JSON.parse(text) } catch (err) {
        throw new Error('workspace.validate: invalid JSON in ' + path + ': ' + (err && err.message || err))
      }
    }
    if (jsLike) {
      if (mode === 'javascript' || isClassicScript(text)) {
        try { ;(new Function(text)) } catch (err) {
          throw new Error('workspace.validate: invalid JavaScript in ' + path + ': ' + (err && err.message || err))
        }
      }
    }
    return true
  }

  function applyLinePatches(text, baseHash, patches) {
    if (baseHash && hashText(text) !== baseHash) throw new Error('workspace.patchText: baseHash mismatch')
    const lines = String(text || '').split(/\r?\n/)
    const list = (patches || []).slice().sort(function (a, b) {
      return (b.startLine || b.start || 1) - (a.startLine || a.start || 1)
    })
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const start = (p.startLine || p.start || 1) - 1
      const end = (p.endLine || p.end || p.startLine || p.start || 1) - 1
      const replacement = String(p.replacement == null ? '' : p.replacement)
      const next = replacement === '' ? [] : replacement.split(/\r?\n/)
      lines.splice.apply(lines, [start, Math.max(0, end - start + 1)].concat(next))
    }
    return lines.join('\n')
  }

  function countText(text, needle) {
    if (!needle) return 0
    let count = 0
    let at = 0
    while (true) {
      const index = text.indexOf(needle, at)
      if (index < 0) return count
      count++
      at = index + needle.length
    }
  }

  function applyTextEdits(text, baseHash, edits) {
    text = String(text == null ? '' : text)
    if (!baseHash) throw workspaceError('MISSING_BASE_HASH', 'workspace.edit: baseHash is required')
    const currentHash = hashText(text)
    if (currentHash !== baseHash) {
      throw workspaceError('STALE_FILE', 'workspace.edit: baseHash mismatch', {
        expectedHash: baseHash,
        currentHash: currentHash,
      })
    }
    const list = edits || []
    if (!list.length) throw workspaceError('NO_EDITS', 'workspace.edit: edits is required')
    let next = text
    for (let i = 0; i < list.length; i++) {
      const edit = list[i] || {}
      const oldText = String(edit.oldText == null ? '' : edit.oldText)
      const newText = String(edit.newText == null ? '' : edit.newText)
      if (!oldText) throw workspaceError('EMPTY_OLD_TEXT', 'workspace.edit: oldText is required', { editIndex: i })
      const count = countText(next, oldText)
      if (count === 0) {
        throw workspaceError('OLD_TEXT_NOT_FOUND', 'workspace.edit: oldText was not found', {
          editIndex: i,
          hint: 'Read the current range and copy the exact oldText from the latest file content.',
        })
      }
      if (!edit.replaceAll && count > 1) {
        throw workspaceError('AMBIGUOUS_MATCH', 'workspace.edit: oldText matched more than once', {
          editIndex: i,
          matchCount: count,
          hint: 'Include more surrounding context in oldText so it matches exactly once.',
        })
      }
      next = edit.replaceAll ? next.split(oldText).join(newText) : next.replace(oldText, newText)
    }
    if (next === text) throw workspaceError('NO_CHANGE', 'workspace.edit: edits did not change the file')
    return next
  }

  function wildcardToRegExp(pattern) {
    pattern = String(pattern || '')
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*')
    return new RegExp('^' + escaped + '$')
  }

  function patternList(value) {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
  }

  function pathAllowed(path, opts) {
    const o = opts || {}
    const include = patternList(o.include)
    const exclude = patternList(o.exclude)
    if (include.length) {
      let ok = false
      for (let i = 0; i < include.length; i++) if (wildcardToRegExp(include[i]).test(path)) ok = true
      if (!ok) return false
    }
    for (let i = 0; i < exclude.length; i++) if (wildcardToRegExp(exclude[i]).test(path)) return false
    return true
  }

  function searchText(path, text, query, opts) {
    const o = opts || {}
    const max = o.maxPerFile || 20
    const before = o.before != null ? o.before : 2
    const after = o.after != null ? o.after : 2
    const sourceQuery = String(query || '')
    const caseSensitive = !!o.caseSensitive
    const needle = caseSensitive ? sourceQuery : sourceQuery.toLowerCase()
    const regex = o.mode === 'regex'
      ? new RegExp(sourceQuery, caseSensitive ? 'g' : 'gi')
      : null
    const lines = String(text || '').split(/\r?\n/)
    const out = []
    const fileHash = hashText(text)
    for (let i = 0; i < lines.length && out.length < max; i++) {
      const line = lines[i]
      const haystack = caseSensitive ? line : line.toLowerCase()
      let index = -1
      let matchText = ''
      if (regex) {
        regex.lastIndex = 0
        const m = regex.exec(line)
        if (m) {
          index = m.index
          matchText = m[0]
        }
      } else {
        index = needle ? haystack.indexOf(needle) : 0
        if (index >= 0) matchText = needle ? line.slice(index, index + sourceQuery.length) : ''
      }
      if (index >= 0) {
        const s = Math.max(0, i - before)
        const e = Math.min(lines.length - 1, i + after)
        out.push({
          path: path,
          fileHash: fileHash,
          line: i + 1,
          column: index + 1,
          matchText: matchText,
          text: line,
          previewStartLine: s + 1,
          previewEndLine: e + 1,
          preview: lines.slice(s, e + 1).join('\n'),
        })
      }
    }
    return out
  }

  function searchNumber(value, fallback, maximum) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return fallback
    return Math.min(maximum, Math.floor(number))
  }

  function searchContextLines(value) {
    if (value == null) return 2
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return 0
    return Math.min(50, Math.floor(number))
  }

  function textByteSize(text) {
    return typeof Blob !== 'undefined' ? new Blob([text]).size : text.length
  }

  function normalizeSearchOptions(opts) {
    const input = opts || {}
    return Object.assign({}, input, {
      path: normalizePath(input.path || ''),
      limit: searchNumber(input.limit, SEARCH_MAX_RESULTS, 100000),
      maxPerFile: searchNumber(input.maxPerFile, SEARCH_MAX_PER_FILE, 10000),
      maxFiles: searchNumber(input.maxFiles, SEARCH_MAX_FILES, 100000),
      maxFileBytes: searchNumber(input.maxFileBytes, SEARCH_MAX_FILE_BYTES, 1024 * 1024 * 1024),
      before: searchContextLines(input.before),
      after: searchContextLines(input.after),
    })
  }

  function searchDiagnostic(op, path, err) {
    const reason = workspaceReason(err)
    return {
      path: normalizePath(path || ''),
      op: op,
      code: String(err && err.code || reason).toUpperCase(),
      reason: reason,
      message: String(err && err.message || err || reason),
    }
  }

  function sizeDiagnostic(path, size, limit) {
    return {
      path: normalizePath(path),
      op: 'readText',
      code: 'SIZE_LIMIT',
      reason: 'size_limit',
      message: 'workspace.search: file size ' + size + ' exceeds maxFileBytes ' + limit,
    }
  }

  async function boundedTextSearch(api, query, opts) {
    const o = normalizeSearchOptions(opts)
    if (o.mode === 'regex') {
      try { new RegExp(String(query || ''), o.caseSensitive ? 'g' : 'gi') } catch (err) {
        throw workspaceError('INVALID_REGEX', 'workspace.search: invalid regular expression: ' + err.message, {
          op: 'search',
          path: o.path,
          reason: 'invalid_query',
        })
      }
    }

    const result = { matches: [], errors: [], scannedFiles: 0, skippedFiles: 0, limitHit: false }
    const directories = []
    let stopped = false

    function addError(error) {
      if (result.errors.length < SEARCH_MAX_DIAGNOSTICS) result.errors.push(error)
      else result.limitHit = true
    }

    async function scanFile(path, knownSize) {
      if (stopped || !pathAllowed(path, o)) return
      if (result.scannedFiles >= o.maxFiles) {
        result.limitHit = true
        stopped = true
        return
      }
      result.scannedFiles++
      if (knownSize != null && knownSize > o.maxFileBytes) {
        result.skippedFiles++
        result.limitHit = true
        addError(sizeDiagnostic(path, knownSize, o.maxFileBytes))
        return
      }

      let file
      try {
        file = await api.readText(path)
      } catch (err) {
        result.skippedFiles++
        addError(searchDiagnostic('readText', path, err))
        return
      }

      const text = String(file.text == null ? '' : file.text)
      const measuredSize = textByteSize(text)
      const size = file && file.size != null ? Math.max(Number(file.size) || 0, measuredSize) : measuredSize
      if (size > o.maxFileBytes) {
        result.skippedFiles++
        result.limitHit = true
        addError(sizeDiagnostic(path, size, o.maxFileBytes))
        return
      }

      const matches = searchText(path, text, query, o)
      for (let i = 0; i < matches.length; i++) {
        if (result.matches.length >= o.limit) {
          result.limitHit = true
          stopped = true
          return
        }
        result.matches.push(matches[i])
      }
      if (result.matches.length >= o.limit) {
        result.limitHit = true
        stopped = true
      }
    }

    async function listDirectory(path) {
      let entries
      try {
        entries = await api.list(path)
      } catch (err) {
        addError(searchDiagnostic('list', path, err))
        return false
      }
      entries = (entries || []).slice().sort(function (a, b) {
        return String(a.path || '').localeCompare(String(b.path || ''))
      })
      for (let i = 0; i < entries.length && !stopped; i++) {
        const entry = entries[i]
        const entryPath = normalizePath(entry.path || (path ? path + '/' + entry.name : entry.name))
        if (entry.kind === 'directory') directories.push(entryPath)
        else await scanFile(entryPath, entry.size == null ? null : Number(entry.size))
      }
      return true
    }

    if (o.path) {
      const listed = await listDirectory(o.path)
      if (!listed) {
        result.errors.length = 0
        await scanFile(o.path, null)
      }
    } else {
      directories.push('')
    }

    while (directories.length && !stopped) await listDirectory(directories.shift())
    return result
  }

  function capabilityValue(adapter, key) {
    if (key === 'objectUrl') return typeof URL !== 'undefined' && !!URL.createObjectURL && !!adapter.readBlob
    if (key === 'permissionRecovery') return !!adapter.recoverPermission
    if (key === 'revealInSystem') return !!adapter.__aiditorRevealInSystemSupported
    if (key === 'pickSaveTarget') return !!adapter.__aiditorPickSaveTargetSupported
    if (key === 'previewOperation' || key === 'applyOperation') return true
    if (key === 'snapshot') return !!adapter.stat && !!adapter.readBlob && !!adapter.writeBlob
    return !!adapter[key]
  }

  function defaultCapabilities(adapter) {
    const keys = [
      'list', 'search', 'readText', 'writeText', 'readBlob', 'writeBlob',
      'mkdir', 'move', 'copy', 'delete', 'recursiveDelete', 'stat',
      'objectUrl', 'snapshot', 'previewOperation', 'applyOperation',
      'revealInSystem', 'pickSaveTarget', 'permissionRecovery', 'watch',
    ]
    const out = {}
    keys.forEach(function (key) { out[key] = capabilityValue(adapter, key) })
    out.recursiveDelete = !!adapter.delete
    return out
  }

  function stableStat(stat) {
    return {
      path: normalizePath(stat.path),
      name: stat.name || fileName(normalizePath(stat.path)),
      kind: stat.kind,
      size: stat.size == null ? null : stat.size,
      mtime: stat.mtime == null ? null : stat.mtime,
      hash: stat.hash == null ? null : stat.hash,
      mime: stat.mime == null ? null : stat.mime,
    }
  }

  function versionMode(stat) {
    if (!stat) return 'missing'
    if (stat.hash != null) return 'strong'
    if (stat.mtime != null) return 'weak'
    return 'none'
  }

  function revealReason(reason) {
    if (reason === 'unsupported') return reason
    if (reason === 'not_found') return reason
    if (reason === 'permission_denied') return reason
    if (reason === 'platform_error') return reason
    return 'platform_error'
  }

  function normalizeRevealResult(result) {
    if (result && result.ok === true) return { ok: true }
    return { ok: false, reason: revealReason(result && result.reason) }
  }

  function revealErrorResult(err) {
    const code = String(err && (err.code || err.name) || '')
    if (code === 'NotFoundError' || code === 'ENOENT' || code === 'not_found') return { ok: false, reason: 'not_found' }
    if (code === 'NotAllowedError' || code === 'SecurityError' || code === 'EACCES' || code === 'EPERM' || code === 'permission_denied') return { ok: false, reason: 'permission_denied' }
    return { ok: false, reason: 'platform_error' }
  }

  function ownerCleanup(owner, fn) {
    if (owner && owner.onCleanup) owner.onCleanup(fn)
    if (owner && owner.__aiditorCleanups) owner.__aiditorCleanups.push(fn)
  }

  function enhanceWorkspace(adapter) {
    const leases = []
    const snapshots = {}
    const previews = {}
    const api = adapter
    const adapterCapabilities = api.capabilities
    const adapterRevealInSystem = api.revealInSystem
    const adapterPickSaveTarget = api.pickSaveTarget
    api.__aiditorRevealInSystemSupported = typeof adapterRevealInSystem === 'function'
    api.__aiditorPickSaveTargetSupported = typeof adapterPickSaveTarget === 'function'

    if (!api.search && api.list && api.readText) {
      api.search = function (query, opts) { return boundedTextSearch(api, query, opts || {}) }
    }

    api.capabilities = function () {
      const caps = adapterCapabilities ? adapterCapabilities.call(api) : defaultCapabilities(api)
      caps.search = !!api.search
      if (caps.revealInSystem == null) caps.revealInSystem = !!api.__aiditorRevealInSystemSupported
      caps.pickSaveTarget = !!api.__aiditorPickSaveTargetSupported
      return caps
    }

    api.pickSaveTarget = async function (opts) {
      if (!api.__aiditorPickSaveTargetSupported) {
        throw workspaceError('UNSUPPORTED', 'workspace.pickSaveTarget: save picker is not supported', {
          op: 'pickSaveTarget', reason: 'unsupported',
        })
      }
      const options = normalizeSaveTargetOptions(opts)
      let path
      try {
        path = await adapterPickSaveTarget.call(api, options)
      } catch (err) {
        if (err && err.name === 'AbortError') return null
        throw err
      }
      if (path == null) return null
      return normalizeSaveTargetPath(path, options.extensions)
    }

    api.revealInSystem = async function (path, opts) {
      path = normalizePath(path)
      if (!api.__aiditorRevealInSystemSupported) return { ok: false, reason: 'unsupported' }
      if (api.stat) {
        try { await api.stat(path) } catch (err) { return revealErrorResult(err) }
      }
      try {
        return normalizeRevealResult(await adapterRevealInSystem.call(api, path, opts || {}))
      } catch (err) {
        return revealErrorResult(err)
      }
    }

    if (!api.readBlob && api.readText) {
      api.readBlob = async function (path) {
        const file = await api.readText(path)
        const blob = makeBlob(file.text)
        return blobResult(file.path, blob, file.hash)
      }
    }

    if (!api.writeBlob && api.writeText) {
      api.writeBlob = async function (path, blob, opts) {
        const text = await blobText(makeBlob(blob))
        const result = await api.writeText(path, text, opts || {})
        return blobResult(result.path, makeBlob(text, blob && blob.type), result.hash)
      }
    }

    if (!api.copy && api.list && api.readBlob && api.writeBlob && api.mkdir) {
      api.copy = async function (from, to, opts) {
        from = normalizePath(from)
        to = normalizePath(to)
        const stat = stableStat(await api.stat(from))
        if (opts && opts.baseHash && stat.hash && stat.hash !== opts.baseHash) throw new Error('workspace.copy: baseHash mismatch')
        if (stat.kind === 'directory') {
          if (!opts || !opts.recursive) throw new Error('workspace.copy: recursive directory copy requires recursive:true')
          await api.mkdir(to)
          const entries = await api.list(from)
          for (let i = 0; i < entries.length; i++) {
            await api.copy(entries[i].path, to ? to + '/' + entries[i].name : entries[i].name, opts || {})
          }
          return { from: from, to: to, copied: true, kind: 'directory' }
        }
        const file = await api.readBlob(from)
        return api.writeBlob(to, file.blob, opts || {}).then(function (result) {
          return Object.assign({ from: from, to: to, copied: true, kind: 'file' }, result)
        })
      }
    }

    if (!api.move && api.copy && api.delete) {
      api.move = async function (from, to, opts) {
        from = normalizePath(from)
        to = normalizePath(to)
        const result = await api.copy(from, to, opts || {})
        await api.delete(from, { recursive: true, baseHash: opts && opts.baseHash })
        return Object.assign({ from: from, to: to, moved: true }, result)
      }
    }

    if (!api.rename && api.move) {
      api.rename = function (from, to, opts) { return api.move(from, to, opts || {}) }
    }

    async function statOrNull(path) {
      try { return stableStat(await api.stat(path)) } catch (_) { return null }
    }

    async function readTreeFingerprint(path) {
      path = normalizePath(path || '')
      let entries
      try {
        entries = await api.list(path)
      } catch (err) {
        throw structuredWorkspaceError('list', path, err)
      }
      const out = []
      for (let i = 0; i < entries.length; i++) {
        let entry
        try {
          entry = stableStat(await api.stat(entries[i].path))
        } catch (err) {
          throw structuredWorkspaceError('stat', entries[i].path, err)
        }
        out.push({
          path: entry.path,
          kind: entry.kind,
          hash: entry.hash,
          mtime: entry.mtime,
        })
        if (entry.kind === 'directory') out.push.apply(out, await readTreeFingerprint(entry.path))
      }
      out.sort(function (a, b) { return a.path.localeCompare(b.path) })
      return out
    }

    function baseEntry(path, stat, exists, children) {
      const entry = {
        path: normalizePath(path),
        exists: !!exists,
        kind: stat ? stat.kind : null,
        hash: stat ? stat.hash : null,
        mtime: stat ? stat.mtime : null,
        versioned: versionMode(stat),
      }
      if (children) entry.children = children
      return entry
    }

    function addVersionWarnings(preview) {
      for (let i = 0; i < preview.base.length; i++) {
        const entry = preview.base[i]
        if (!entry.exists) continue
        if (entry.versioned === 'weak') preview.warnings.push({ path: entry.path, message: 'workspace.preview: weak version check uses mtime because hash is unavailable' })
        if (entry.versioned === 'none') preview.warnings.push({ path: entry.path, message: 'workspace.preview: no stable version is available for this path' })
      }
    }

    function targetNeedsIntent(target, input) {
      if (!target || !target.exists) return false
      return !input.baseHash && !input.targetBaseHash && !input.overwrite
    }

    async function makePreview(rawInput) {
      const input = Object.assign({}, rawInput || {})
      input.op = input.op || input.action
      const op = input.op
      const id = 'workspace-preview-' + Date.now() + '-' + Math.random().toString(16).slice(2)
      const preview = {
        id: id,
        op: op,
        input: Object.assign({}, input),
        base: [],
        effects: [],
        summary: '',
        warnings: [],
        errors: [],
      }

      if (op === 'writeText' || op === 'writeBlob') {
        input.path = normalizePath(input.path)
        const stat = await statOrNull(input.path)
        preview.base.push(baseEntry(input.path, stat, !!stat))
        preview.effects.push({ path: input.path, action: stat ? 'update' : 'create' })
        preview.summary = (stat ? 'Update ' : 'Create ') + input.path
        if (targetNeedsIntent(preview.base[0], input)) preview.errors.push({ path: input.path, message: 'workspace.preview: existing target requires baseHash or overwrite:true' })
        if (input.baseHash && stat && stat.hash && stat.hash !== input.baseHash) preview.errors.push({ path: input.path, message: 'workspace.preview: baseHash mismatch' })
        if (input.overwrite && stat && !input.baseHash && !input.targetBaseHash) preview.warnings.push({ path: input.path, message: 'workspace.preview: overwrite requested without targetBaseHash' })
      } else if (op === 'mkdir') {
        input.path = normalizePath(input.path)
        const stat = await statOrNull(input.path)
        preview.base.push(baseEntry(input.path, stat, !!stat))
        preview.effects.push({ path: input.path, action: 'create' })
        preview.summary = 'Create directory ' + input.path
        if (stat && !input.overwrite) preview.errors.push({ path: input.path, message: 'workspace.preview: target already exists' })
      } else if (op === 'delete') {
        input.path = normalizePath(input.path)
        const stat = await statOrNull(input.path)
        if (!stat) preview.errors.push({ path: input.path, message: 'workspace.preview: path not found' })
        if (stat && stat.kind === 'directory' && !input.recursive) preview.errors.push({ path: input.path, message: 'workspace.preview: recursive directory delete requires recursive:true' })
        const children = stat && stat.kind === 'directory' && input.recursive ? await readTreeFingerprint(input.path) : null
        preview.base.push(baseEntry(input.path, stat, !!stat, children))
        preview.effects.push({ path: input.path, action: 'delete' })
        preview.summary = 'Delete ' + input.path
        if (input.baseHash && stat && stat.hash && stat.hash !== input.baseHash) preview.errors.push({ path: input.path, message: 'workspace.preview: baseHash mismatch' })
      } else if (op === 'copy' || op === 'move') {
        input.from = normalizePath(input.from)
        input.to = normalizePath(input.to)
        const source = await statOrNull(input.from)
        const target = await statOrNull(input.to)
        const sourceChildren = source && source.kind === 'directory' ? await readTreeFingerprint(input.from) : null
        const targetChildren = target && target.kind === 'directory' ? await readTreeFingerprint(input.to) : null
        preview.base.push(baseEntry(input.from, source, !!source, sourceChildren))
        preview.base.push(baseEntry(input.to, target, !!target, targetChildren))
        preview.effects.push({ path: input.to, action: op, from: input.from, to: input.to })
        if (op === 'move') preview.effects.push({ path: input.from, action: 'delete' })
        preview.summary = op + ' ' + input.from + ' to ' + input.to
        if (!source) preview.errors.push({ path: input.from, message: 'workspace.preview: source not found' })
        if (source && source.kind === 'directory' && !input.recursive) preview.errors.push({ path: input.from, message: 'workspace.preview: recursive directory ' + op + ' requires recursive:true' })
        if (targetNeedsIntent(preview.base[1], input)) preview.errors.push({ path: input.to, message: 'workspace.preview: existing target requires targetBaseHash or overwrite:true' })
        if (input.baseHash && source && source.hash && source.hash !== input.baseHash) preview.errors.push({ path: input.from, message: 'workspace.preview: baseHash mismatch' })
        if (input.targetBaseHash && target && target.hash && target.hash !== input.targetBaseHash) preview.errors.push({ path: input.to, message: 'workspace.preview: targetBaseHash mismatch' })
        if (input.overwrite && target && !input.targetBaseHash) preview.warnings.push({ path: input.to, message: 'workspace.preview: overwrite requested without targetBaseHash' })
      } else {
        preview.errors.push({ message: 'workspace.preview: unsupported operation: ' + op })
      }

      addVersionWarnings(preview)
      preview.ok = preview.errors.length === 0
      preview.risk = op === 'delete' ? 'delete' : 'edit'
      preview.title = preview.summary
      preview.changes = preview.effects.map(function (effect) {
        const base = preview.base.filter(function (entry) { return entry.path === effect.path || entry.path === effect.from })[0] || null
        return {
          type: 'workspacePath',
          action: effect.action,
          path: effect.path,
          from: effect.from || null,
          to: effect.to || null,
          baseHash: base && base.hash || null,
          baseVersion: base && (base.hash || base.mtime) || null,
          kind: base && base.kind || null,
        }
      })
      previews[id] = preview
      return preview
    }

    async function assertBaseUnchanged(entry) {
      const current = await statOrNull(entry.path)
      if (!entry.exists && !current) return
      if (!entry.exists && current) throw new Error('workspace.apply: target appeared after preview: ' + entry.path)
      if (entry.exists && !current) throw new Error('workspace.apply: path disappeared after preview: ' + entry.path)
      if (entry.hash != null && current.hash !== entry.hash) throw new Error('workspace.apply: hash changed after preview: ' + entry.path)
      if (entry.hash == null && entry.mtime != null && current.mtime !== entry.mtime) throw new Error('workspace.apply: mtime changed after preview: ' + entry.path)
      if (entry.children) {
        const nextChildren = await readTreeFingerprint(entry.path)
        if (JSON.stringify(nextChildren) !== JSON.stringify(entry.children)) throw new Error('workspace.apply: directory contents changed after preview: ' + entry.path)
      }
    }

    async function executePreview(preview, opts) {
      const o = opts || {}
      if (preview.errors && preview.errors.length) throw new Error(preview.errors[0].message)
      if (preview.warnings && preview.warnings.length && !o.confirmWarnings) throw new Error('workspace.apply: warnings require confirmWarnings:true')
      const input = preview.input || {}
      if ((input.overwrite || input.targetBaseHash) && !o.confirmOverwrite && (preview.op === 'copy' || preview.op === 'move' || preview.op === 'writeText' || preview.op === 'writeBlob')) {
        throw new Error('workspace.apply: overwrite requires confirmOverwrite:true')
      }
      try {
        for (let i = 0; i < preview.base.length; i++) await assertBaseUnchanged(preview.base[i])
      } catch (err) {
        throw structuredWorkspaceError('applyOperation', operationPath(preview), err, { operation: preview.op, previewId: preview.id })
      }
      let result
      try {
        if (preview.op === 'writeText') result = await api.writeText(input.path, input.text, { baseHash: input.baseHash || null, overwrite: !!input.overwrite })
        else if (preview.op === 'writeBlob') result = await api.writeBlob(input.path, input.blob, { baseHash: input.baseHash || null, overwrite: !!input.overwrite })
        else if (preview.op === 'mkdir') result = await api.mkdir(input.path, { recursive: !!input.recursive, overwrite: !!input.overwrite })
        else if (preview.op === 'delete') result = await api.delete(input.path, { recursive: !!input.recursive, baseHash: input.baseHash || null })
        else if (preview.op === 'copy') result = await api.copy(input.from, input.to, { recursive: !!input.recursive, baseHash: input.baseHash || null, targetBaseHash: input.targetBaseHash || null, overwrite: !!input.overwrite })
        else if (preview.op === 'move') result = await api.move(input.from, input.to, { recursive: !!input.recursive, baseHash: input.baseHash || null, targetBaseHash: input.targetBaseHash || null, overwrite: !!input.overwrite })
      } catch (err) {
        throw structuredWorkspaceError('applyOperation', operationPath(preview), err, { operation: preview.op, previewId: preview.id })
      }
      const stats = []
      for (let i = 0; i < preview.effects.length; i++) {
        const effect = preview.effects[i]
        const stat = await statOrNull(effect.path)
        stats.push({ effect: effect, stat: stat })
      }
      return { applied: true, op: preview.op, effects: preview.effects, stats: stats, result: result }
    }

    function operationPath(preview) {
      const input = preview && preview.input || {}
      return input.path || input.to || input.from || ''
    }

    api.previewOperation = function (input) { return makePreview(input) }
    api.applyOperation = function (previewOrId, opts) {
      const preview = typeof previewOrId === 'string' ? previews[previewOrId] : previewOrId
      if (!preview) throw new Error('workspace.apply: preview not found')
      return executePreview(preview, opts || {})
    }

    api.createObjectUrl = async function (path, opts) {
      if (typeof URL === 'undefined' || !URL.createObjectURL) throw new Error('workspace.createObjectUrl: URL.createObjectURL is not available')
      const file = await api.readBlob(path)
      let released = false
      const url = URL.createObjectURL(file.blob)
      const lease = {
        path: file.path,
        url: url,
        hash: file.hash,
        size: file.size,
        mime: file.mime || null,
        owner: opts && opts.owner || null,
        release: function () {
          if (released) return
          released = true
          URL.revokeObjectURL(url)
          const i = leases.indexOf(lease)
          if (i >= 0) leases.splice(i, 1)
        },
      }
      leases.push(lease)
      ownerCleanup(lease.owner, lease.release)
      return lease
    }

    api.revokeObjectUrl = function (url) {
      leases.slice().forEach(function (lease) {
        if (lease.url === url) lease.release()
      })
    }

    api.createUrlBundle = async function (paths, opts) {
      const urls = {}
      const bundleLeases = []
      const list = paths || []
      for (let i = 0; i < list.length; i++) {
        const lease = await api.createObjectUrl(list[i], opts || {})
        urls[lease.path] = lease.url
        bundleLeases.push(lease)
      }
      return {
        urls: urls,
        resolve: function (path) { return urls[normalizePath(path)] || null },
        release: function () { bundleLeases.slice().forEach(function (lease) { lease.release() }) },
      }
    }

    api.releaseObjectUrls = function (owner) {
      leases.slice().forEach(function (lease) {
        if (!owner || lease.owner === owner) lease.release()
      })
    }

    api.snapshot = async function (path, opts) {
      path = normalizePath(path)
      const o = opts || {}
      const maxMemoryBytes = o.maxMemoryBytes == null ? 16 * 1024 * 1024 : o.maxMemoryBytes
      let stat
      try {
        stat = stableStat(await api.stat(path))
      } catch (err) {
        throw structuredWorkspaceError('snapshot', path, err)
      }
      const id = path + '@' + (stat.hash || stat.mtime || 'unversioned') + '#' + Date.now()
      if (stat.kind === 'directory') {
        if (!o.recursive) throw structuredWorkspaceError('snapshot', path, workspaceError('RECURSIVE_REQUIRED', 'workspace.snapshot: directory snapshot requires recursive:true'), { rootPath: path })
        let entries
        try {
          entries = await readTreeFingerprint(path)
        } catch (err) {
          throw structuredWorkspaceError('snapshot', err.path || path, err, { rootPath: path })
        }
        let size = 0
        const files = []
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].kind !== 'file') continue
          let file
          try {
            file = await api.readBlob(entries[i].path)
          } catch (err) {
            throw structuredWorkspaceError('snapshot', entries[i].path, err, { rootPath: path })
          }
          size += file.size || 0
          if (size > maxMemoryBytes) throw structuredWorkspaceError('snapshot', entries[i].path, workspaceError('MAX_MEMORY_BYTES', 'workspace.snapshot: maxMemoryBytes exceeded'), { rootPath: path, maxMemoryBytes: maxMemoryBytes })
          files.push({ path: entries[i].path, blob: file.blob, hash: file.hash, size: file.size, mime: file.mime || null })
        }
        snapshots[id] = { id: id, path: path, kind: 'directory', hash: stat.hash, mtime: stat.mtime, size: size, entries: entries, files: files }
        return { id: id, path: path, kind: 'directory', hash: stat.hash, mtime: stat.mtime, size: size, storage: 'memory' }
      }
      let file
      try {
        file = await api.readBlob(path)
      } catch (err) {
        throw structuredWorkspaceError('snapshot', path, err)
      }
      if ((file.size || 0) > maxMemoryBytes) throw structuredWorkspaceError('snapshot', path, workspaceError('MAX_MEMORY_BYTES', 'workspace.snapshot: maxMemoryBytes exceeded'), { maxMemoryBytes: maxMemoryBytes })
      snapshots[id] = { id: id, path: path, kind: 'file', hash: file.hash, mtime: stat.mtime, size: file.size, mime: file.mime || null, blob: file.blob }
      return { id: id, path: path, kind: 'file', hash: file.hash, mtime: stat.mtime, size: file.size, storage: 'memory' }
    }

    api.compareSnapshot = async function (snapshot, path) {
      const ref = snapshots[snapshot && snapshot.id || snapshot]
      if (!ref) throw new Error('workspace.snapshot: snapshot not found')
      const target = normalizePath(path || ref.path)
      const stat = await statOrNull(target)
      if (!stat) return { path: target, snapshotHash: ref.hash, currentHash: null, changed: true }
      if (ref.kind === 'directory') {
        const entries = await readTreeFingerprint(target)
        return { path: target, snapshotHash: ref.hash, currentHash: stat.hash || null, changed: JSON.stringify(entries) !== JSON.stringify(ref.entries) }
      }
      return { path: target, snapshotHash: ref.hash, currentHash: stat.hash || null, changed: stat.hash !== ref.hash || stat.mtime !== ref.mtime }
    }

    api.restoreSnapshot = async function (snapshot, opts) {
      const ref = snapshots[snapshot && snapshot.id || snapshot]
      const o = opts || {}
      if (!ref) throw new Error('workspace.snapshot: snapshot not found')
      const targetPath = normalizePath(o.targetPath || ref.path)
      const baseHash = o.baseHash || null
      if (ref.kind === 'directory') {
        try {
          await api.mkdir(targetPath, { recursive: true, overwrite: !!o.overwrite })
        } catch (err) {
          throw structuredWorkspaceError('restoreSnapshot', targetPath, err, { snapshotId: ref.id })
        }
        const restored = []
        for (let i = 0; i < ref.files.length; i++) {
          const rel = ref.files[i].path === ref.path ? '' : ref.files[i].path.slice(ref.path.length + 1)
          const target = targetPath ? targetPath + '/' + rel : rel
          const parent = parentPath(target)
          try {
            if (parent) await api.mkdir(parent, { recursive: true, overwrite: true })
            restored.push(await api.writeBlob(target, ref.files[i].blob, { overwrite: !!o.overwrite }))
          } catch (err) {
            throw structuredWorkspaceError('restoreSnapshot', target, err, { snapshotId: ref.id, sourcePath: ref.files[i].path })
          }
        }
        return { path: targetPath, restored: true, effects: restored }
      }
      try {
        return await api.writeBlob(targetPath, ref.blob, { baseHash: baseHash, overwrite: !!o.overwrite })
      } catch (err) {
        throw structuredWorkspaceError('restoreSnapshot', targetPath, err, { snapshotId: ref.id })
      }
    }

    return api
  }

  function memory(files) {
    const data = {}
    const dirs = { '': true }
    const mtimes = {}
    const input = files || {}
    Object.keys(input).forEach(function (path) {
      path = normalizePath(path)
      data[path] = input[path]
      touchParents(path)
      touch(path)
    })

    function touch(path) { mtimes[path] = Date.now() }
    function isFile(path) { return Object.prototype.hasOwnProperty.call(data, path) }
    function isDir(path) { return !!dirs[path] }
    function fileBlob(path) { return makeBlob(data[path]) }
    async function fileText(path) { return isBlob(data[path]) ? blobText(data[path]) : String(data[path] == null ? '' : data[path]) }
    async function fileHash(path) { return isBlob(data[path]) ? hashBlob(data[path]) : hashText(String(data[path] == null ? '' : data[path])) }

    function touchParents(path) {
      let parent = parentPath(path)
      while (true) {
        dirs[parent] = true
        if (!parent) return
        parent = parentPath(parent)
      }
    }

    function assertWriteHash(path, opts, action) {
      const expected = opts && (opts.baseHash || opts.expectedHash)
      if (!expected || !isFile(path)) return Promise.resolve()
      return fileHash(path).then(function (hash) {
        if (hash !== expected) throw new Error('workspace.' + action + ': baseHash mismatch')
      })
    }

    function assertTargetIntent(path, opts, action) {
      const o = opts || {}
      if ((isFile(path) || isDir(path)) && !o.baseHash && !o.targetBaseHash && !o.overwrite) {
        throw new Error('workspace.' + action + ': existing target requires baseHash or overwrite:true')
      }
      return Promise.resolve()
    }

    async function assertTargetHash(path, opts, action) {
      const expected = opts && opts.targetBaseHash
      if (!expected || !isFile(path)) return
      const hash = await fileHash(path)
      if (hash !== expected) throw new Error('workspace.' + action + ': targetBaseHash mismatch')
    }

    function hasChildren(path) {
      const prefix = path ? path + '/' : ''
      return Object.keys(data).some(function (p) { return p !== path && p.indexOf(prefix) === 0 })
        || Object.keys(dirs).some(function (p) { return p !== path && p.indexOf(prefix) === 0 })
    }

    function allPaths(prefix) {
      prefix = normalizePath(prefix || '')
      return Object.keys(data).filter(function (path) {
        return !prefix || path === prefix || path.indexOf(prefix + '/') === 0
      }).sort()
    }

    const api = {
      rootId: function () { return 'memory' },
      kind: function () { return 'memory' },
      capabilities: function () {
        return {
          list: true, readText: true, writeText: true, readBlob: true, writeBlob: true,
          mkdir: true, move: true, copy: true, delete: true, recursiveDelete: true, stat: true,
          objectUrl: typeof URL !== 'undefined' && !!URL.createObjectURL, snapshot: true,
          previewOperation: true, applyOperation: true, revealInSystem: false,
          permissionRecovery: true, watch: true,
        }
      },
      list: function (path) {
        path = normalizePath(path || '')
        const seen = {}
        const out = []
        const prefix = path ? path + '/' : ''
        Object.keys(dirs).forEach(function (dir) {
          if (!dir || dir === path || (path && dir.indexOf(prefix) !== 0)) return
          const rest = dir.slice(prefix.length)
          const slash = rest.indexOf('/')
          const child = slash < 0 ? dir : prefix + rest.slice(0, slash)
          if (seen[child]) return
          seen[child] = true
          out.push({ path: child, name: fileName(child), kind: 'directory', size: null, mtime: mtimes[child] || null, hash: null, mime: null })
        })
        allPaths(path).forEach(function (item) {
          if (path && item === path) return
          const rest = item.slice(prefix.length)
          const slash = rest.indexOf('/')
          const child = slash < 0 ? item : prefix + rest.slice(0, slash)
          if (seen[child]) return
          seen[child] = true
          out.push({
            path: child,
            name: fileName(child),
            kind: slash < 0 ? 'file' : 'directory',
            size: slash < 0 ? fileBlob(child).size : null,
            mtime: mtimes[child] || null,
            hash: null,
            mime: slash < 0 && isBlob(data[child]) ? data[child].type || null : null,
          })
        })
        out.sort(function (a, b) { return a.path.localeCompare(b.path) })
        return Promise.resolve(out)
      },
      readText: function (path) {
        path = normalizePath(path)
        if (!isFile(path)) throw new Error('workspace.readText: file not found: ' + path)
        return fileText(path).then(function (text) { return textResult(path, text, mtimes[path] || null) })
      },
      readBlob: function (path) {
        path = normalizePath(path)
        if (!isFile(path)) throw new Error('workspace.readBlob: file not found: ' + path)
        if (isBlob(data[path])) return blobResult(path, data[path])
        return blobResult(path, fileBlob(path), hashText(String(data[path] == null ? '' : data[path])))
      },
      writeText: function (path, text, opts) {
        path = normalizePath(path)
        return assertTargetIntent(path, opts || {}, 'writeText').then(function () {
          return assertWriteHash(path, opts || {}, 'writeText')
        }).then(function () {
          data[path] = String(text == null ? '' : text)
          touchParents(path)
          touch(path)
          return textResult(path, data[path], mtimes[path] || null)
        })
      },
      writeBlob: function (path, blob, opts) {
        path = normalizePath(path)
        return assertTargetIntent(path, opts || {}, 'writeBlob').then(function () {
          return assertWriteHash(path, opts || {}, 'writeBlob')
        }).then(function () {
          data[path] = makeBlob(blob)
          touchParents(path)
          touch(path)
          return blobResult(path, data[path])
        })
      },
      mkdir: function (path, opts) {
        path = normalizePath(path)
        if ((isFile(path) || isDir(path)) && !(opts && opts.overwrite)) throw new Error('workspace.mkdir: target already exists: ' + path)
        dirs[path] = true
        touchParents(path)
        touch(path)
        return Promise.resolve({ path: path, name: fileName(path), kind: 'directory', size: null, hash: null, mtime: mtimes[path] || null, mime: null })
      },
      patchText: function (path, baseHash, patches) {
        path = normalizePath(path)
        if (!isFile(path)) throw new Error('workspace.patchText: file not found: ' + path)
        return fileText(path).then(function (before) {
          data[path] = applyLinePatches(before, baseHash, patches || [])
          touch(path)
          return textResult(path, data[path], mtimes[path] || null)
        })
      },
      delete: function (path, opts) {
        path = normalizePath(path)
        const o = opts || {}
        return assertWriteHash(path, o, 'delete').then(function () {
          if (isFile(path)) {
            delete data[path]
            delete mtimes[path]
            return { path: path, deleted: true }
          }
          if (!isDir(path)) throw new Error('workspace.delete: path not found: ' + path)
          if (!o.recursive && hasChildren(path)) throw new Error('workspace.delete: directory is not empty: ' + path)
          const prefix = path ? path + '/' : ''
          Object.keys(data).forEach(function (p) { if (p === path || p.indexOf(prefix) === 0) { delete data[p]; delete mtimes[p] } })
          Object.keys(dirs).forEach(function (p) { if (p === path || p.indexOf(prefix) === 0) { delete dirs[p]; delete mtimes[p] } })
          dirs[''] = true
          return { path: path, deleted: true }
        })
      },
      copy: async function (from, to, opts) {
        from = normalizePath(from)
        to = normalizePath(to)
        await assertTargetIntent(to, opts || {}, 'copy')
        await assertTargetHash(to, opts || {}, 'copy')
        if (isFile(from)) {
          await assertWriteHash(from, opts || {}, 'copy')
          data[to] = isBlob(data[from]) ? data[from].slice(0, data[from].size, data[from].type) : String(data[from] == null ? '' : data[from])
          touchParents(to)
          touch(to)
          return { from: from, to: to, copied: true, kind: 'file' }
        }
        if (!isDir(from)) throw new Error('workspace.copy: path not found: ' + from)
        if (!opts || !opts.recursive) throw new Error('workspace.copy: recursive directory copy requires recursive:true')
        dirs[to] = true
        touchParents(to)
        touch(to)
        const prefix = from ? from + '/' : ''
        Object.keys(dirs).forEach(function (dir) {
          if (dir === from || dir.indexOf(prefix) !== 0) return
          const next = to ? to + '/' + dir.slice(prefix.length) : dir.slice(prefix.length)
          dirs[next] = true
          touch(next)
        })
        Object.keys(data).forEach(function (item) {
          if (item.indexOf(prefix) !== 0) return
          const next = to ? to + '/' + item.slice(prefix.length) : item.slice(prefix.length)
          data[next] = isBlob(data[item]) ? data[item].slice(0, data[item].size, data[item].type) : String(data[item] == null ? '' : data[item])
          touchParents(next)
          touch(next)
        })
        return { from: from, to: to, copied: true, kind: 'directory' }
      },
      move: async function (from, to, opts) {
        from = normalizePath(from)
        to = normalizePath(to)
        await this.copy(from, to, opts || {})
        await this.delete(from, { recursive: true, baseHash: opts && opts.baseHash })
        return { from: from, to: to, moved: true }
      },
      rename: function (from, to, opts) { return this.move(from, to, opts || {}) },
      stat: function (path) {
        path = normalizePath(path)
        if (isFile(path)) {
          if (isBlob(data[path])) {
            return hashBlob(data[path]).then(function (hash) {
              return { path: path, name: fileName(path), kind: 'file', size: data[path].size, hash: hash, mtime: mtimes[path] || null, mime: data[path].type || null }
            })
          }
          return fileText(path).then(function (text) {
            return { path: path, name: fileName(path), kind: 'file', size: fileBlob(path).size, hash: hashText(text), mtime: mtimes[path] || null, mime: 'text/plain' }
          })
        }
        if (isDir(path)) return Promise.resolve({ path: path, name: fileName(path), kind: 'directory', size: null, hash: null, mtime: mtimes[path] || null, mime: null })
        throw new Error('workspace.stat: path not found: ' + path)
      },
      watch: function () { return function () {} },
      resolveUrl: function (path) { return normalizePath(path) },
      recoverPermission: function () { return Promise.resolve(true) },
      _files: function () { return Object.assign({}, data) },
    }
    return enhanceWorkspace(api)
  }

  function openHandleDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(HANDLE_DB, 1)
      req.onupgradeneeded = function () {
        req.result.createObjectStore(HANDLE_STORE)
      }
      req.onsuccess = function () { resolve(req.result) }
      req.onerror = function () { reject(req.error) }
    })
  }

  async function withHandleStore(mode, task) {
    const db = await openHandleDb()
    if (!db) return null
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(HANDLE_STORE, mode)
      const store = tx.objectStore(HANDLE_STORE)
      let done = false
      tx.oncomplete = function () {
        db.close()
        if (!done) resolve(null)
      }
      tx.onerror = function () {
        db.close()
        reject(tx.error)
      }
      task(store, function (value) {
        done = true
        resolve(value)
      }, reject)
    })
  }

  async function saveDirectoryHandle(key, handle) {
    if (!key || !handle) return false
    await withHandleStore('readwrite', function (store, resolve, reject) {
      const req = store.put(handle, String(key))
      req.onsuccess = function () { resolve(true) }
      req.onerror = function () { reject(req.error) }
    })
    return true
  }

  async function loadDirectoryHandle(key) {
    if (!key) return null
    return withHandleStore('readonly', function (store, resolve, reject) {
      const req = store.get(String(key))
      req.onsuccess = function () { resolve(req.result || null) }
      req.onerror = function () { reject(req.error) }
    })
  }

  async function permissionState(handle, mode) {
    if (!handle || !handle.queryPermission) return 'granted'
    return handle.queryPermission({ mode: mode || 'readwrite' })
  }

  async function restorePermission(handle, mode, requestPermission) {
    const permission = await permissionState(handle, mode)
    if (permission === 'granted') return true
    if (permission !== 'prompt' || !requestPermission || !handle.requestPermission) return false
    return await handle.requestPermission({ mode: mode || 'readwrite' }) === 'granted'
  }

  async function openDirectory(opts) {
    if (!window.showDirectoryPicker) throw new Error('aiditor.workspace.openDirectory: File System Access API is not available')
    opts = opts || {}
    const pickerOpts = Object.assign({}, opts)
    const rememberKey = pickerOpts.rememberKey || ''
    delete pickerOpts.rememberKey
    const handle = await window.showDirectoryPicker(pickerOpts)
    if (rememberKey) await saveDirectoryHandle(rememberKey, handle)
    return fromHandle(handle)
  }

  async function restoreDirectory(key, opts) {
    opts = opts || {}
    const handle = await loadDirectoryHandle(key)
    if (!handle) return null
    const mode = opts.mode || 'readwrite'
    const granted = await restorePermission(handle, mode, opts.requestPermission === true)
    if (!granted) return null
    return fromHandle(handle)
  }

  function fromHandle(rootHandle) {
    async function dirHandle(path, create) {
      path = normalizePath(path)
      if (!path) return rootHandle
      const parts = path.split('/')
      let dir = rootHandle
      for (let i = 0; i < parts.length; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: !!create })
      }
      return dir
    }

    async function fileHandle(path, create) {
      path = normalizePath(path)
      const dir = await dirHandle(parentPath(path), create)
      return dir.getFileHandle(fileName(path), { create: !!create })
    }

    async function handleFor(path) {
      path = normalizePath(path)
      if (!path) return rootHandle
      const parent = await dirHandle(parentPath(path), false)
      const name = fileName(path)
      try {
        return await parent.getDirectoryHandle(name)
      } catch (_) {
        return parent.getFileHandle(name)
      }
    }

    async function statOrMissing(path) {
      try { return await api.stat(path) } catch (_) { return null }
    }

    async function assertWriteIntent(path, opts, action) {
      const stat = await statOrMissing(path)
      const o = opts || {}
      if (stat && !o.baseHash && !o.targetBaseHash && !o.overwrite) throw new Error('workspace.' + action + ': existing target requires baseHash or overwrite:true')
      if (stat && o.baseHash && stat.hash && stat.hash !== o.baseHash) throw new Error('workspace.' + action + ': baseHash mismatch')
      if (stat && o.targetBaseHash && stat.hash && stat.hash !== o.targetBaseHash) throw new Error('workspace.' + action + ': targetBaseHash mismatch')
    }

    const api = {
      rootId: function () { return rootHandle.name || 'directory' },
      kind: function () { return 'browser-fsa' },
      capabilities: function () {
        return {
          list: true, readText: true, writeText: true, readBlob: true, writeBlob: true,
          mkdir: true, move: true, copy: true, delete: true, recursiveDelete: true, stat: true,
          objectUrl: typeof URL !== 'undefined' && !!URL.createObjectURL, snapshot: true,
          previewOperation: true, applyOperation: true, revealInSystem: false,
          permissionRecovery: !!rootHandle.requestPermission, watch: true,
        }
      },
      list: async function (path) {
        path = normalizePath(path || '')
        try {
          const dir = await dirHandle(path, false)
          const out = []
          for await (const entry of dir.values()) out.push({ path: path ? path + '/' + entry.name : entry.name, name: entry.name, kind: entry.kind })
          return out
        } catch (err) {
          throw structuredWorkspaceError('list', path, err)
        }
      },
      readText: async function (path) {
        path = normalizePath(path)
        try {
          const h = await fileHandle(path, false)
          const file = await h.getFile()
          return textResult(path, await file.text(), file.lastModified || null)
        } catch (err) {
          throw structuredWorkspaceError('readText', path, err)
        }
      },
      readBlob: async function (path) {
        path = normalizePath(path)
        try {
          const h = await fileHandle(path, false)
          const file = await h.getFile()
          return blobResult(path, file.arrayBuffer ? file : makeBlob(await file.text(), file.type || ''))
        } catch (err) {
          throw structuredWorkspaceError('readBlob', path, err)
        }
      },
      writeText: async function (path, text, opts) {
        path = normalizePath(path)
        try {
          await assertWriteIntent(path, opts || {}, 'writeText')
          const h = await fileHandle(path, true)
          const w = await h.createWritable()
          await w.write(String(text == null ? '' : text))
          await w.close()
          return textResult(path, String(text == null ? '' : text))
        } catch (err) {
          throw structuredWorkspaceError('writeText', path, err)
        }
      },
      writeBlob: async function (path, blob, opts) {
        path = normalizePath(path)
        try {
          await assertWriteIntent(path, opts || {}, 'writeBlob')
          const h = await fileHandle(path, true)
          const w = await h.createWritable()
          await w.write(makeBlob(blob))
          await w.close()
          return blobResult(path, makeBlob(blob))
        } catch (err) {
          throw structuredWorkspaceError('writeBlob', path, err)
        }
      },
      mkdir: async function (path, opts) {
        path = normalizePath(path)
        try {
          if (await statOrMissing(path)) {
            if (!(opts && opts.overwrite)) throw new Error('workspace.mkdir: target already exists: ' + path)
            return this.stat(path)
          }
          await dirHandle(path, true)
          return { path: path, name: fileName(path), kind: 'directory', size: null, hash: null, mtime: null, mime: null }
        } catch (err) {
          throw structuredWorkspaceError('mkdir', path, err)
        }
      },
      delete: async function (path, opts) {
        path = normalizePath(path)
        try {
          const dir = await dirHandle(parentPath(path), false)
          await dir.removeEntry(fileName(path), { recursive: !!(opts && opts.recursive) })
          return { path: path, deleted: true }
        } catch (err) {
          throw structuredWorkspaceError('delete', path, err)
        }
      },
      copy: async function (from, to, opts) {
        from = normalizePath(from)
        to = normalizePath(to)
        const stat = await this.stat(from)
        await assertWriteIntent(to, opts || {}, 'copy')
        if (opts && opts.baseHash && stat.hash && stat.hash !== opts.baseHash) throw new Error('workspace.copy: baseHash mismatch')
        if (stat.kind === 'directory') {
          if (!opts || !opts.recursive) throw new Error('workspace.copy: recursive directory copy requires recursive:true')
          await this.mkdir(to, { overwrite: !!(opts && opts.overwrite) })
          const entries = await this.list(from)
          for (let i = 0; i < entries.length; i++) await this.copy(entries[i].path, to ? to + '/' + entries[i].name : entries[i].name, opts || {})
          return { from: from, to: to, copied: true, kind: 'directory' }
        }
        const file = await this.readBlob(from)
        const result = await this.writeBlob(to, file.blob, opts || {})
        return Object.assign({ from: from, to: to, copied: true, kind: 'file' }, result)
      },
      move: async function (from, to, opts) {
        from = normalizePath(from)
        to = normalizePath(to)
        const result = await this.copy(from, to, opts || {})
        await this.delete(from, { recursive: true, baseHash: opts && opts.baseHash })
        return Object.assign({ from: from, to: to, moved: true }, result)
      },
      rename: function (from, to, opts) { return this.move(from, to, opts || {}) },
      patchText: async function (path, baseHash, patches) {
        const current = await this.readText(path)
        const next = applyLinePatches(current.text, baseHash, patches || [])
        return this.writeText(path, next, { baseHash: baseHash })
      },
      stat: async function (path) {
        path = normalizePath(path)
        try {
          const h = await handleFor(path)
          if (h.kind === 'directory') return { path: path, name: fileName(path), kind: 'directory', size: null, hash: null, mtime: null, mime: null }
          const file = await h.getFile()
          const blob = file.arrayBuffer ? file : makeBlob(await file.text(), file.type || '')
          return { path: path, name: fileName(path), kind: 'file', size: blob.size, hash: await hashBlob(blob), mtime: file.lastModified || null, mime: file.type || null }
        } catch (err) {
          throw structuredWorkspaceError('stat', path, err)
        }
      },
      watch: function () { return function () {} },
      resolveUrl: function (path) { return normalizePath(path) },
      recoverPermission: async function (options) {
        if (!rootHandle.requestPermission) return true
        const mode = typeof options === 'string' ? options : options && options.mode || 'readwrite'
        return await rootHandle.requestPermission({ mode: mode }) === 'granted'
      },
    }
    if (typeof window.showSaveFilePicker === 'function' && typeof rootHandle.resolve === 'function') {
      api.pickSaveTarget = async function (opts) {
        let handle
        try {
          handle = await window.showSaveFilePicker(nativeSavePickerOptions(rootHandle, opts))
        } catch (err) {
          if (err && err.name === 'AbortError') return null
          throw structuredWorkspaceError('pickSaveTarget', '', err)
        }
        let parts
        try {
          parts = await rootHandle.resolve(handle)
        } catch (err) {
          throw structuredWorkspaceError('pickSaveTarget', '', err)
        }
        if (!parts || !parts.length) {
          throw workspaceError('OUTSIDE_WORKSPACE', 'workspace.pickSaveTarget: target is outside the workspace', {
            op: 'pickSaveTarget', reason: 'outside_workspace',
          })
        }
        return parts.join('/')
      }
    }
    return enhanceWorkspace(api)
  }

  function fromBridge(bridge) {
    return enhanceWorkspace(bridge)
  }

  workspace.hashBytes = hashBytes
  workspace.hashBlob = hashBlob
  workspace.hashText = hashText
  workspace.diffSummary = diffSummary
  workspace.workspaceError = workspaceError
  workspace.validateText = validateText
  workspace.applyLinePatches = applyLinePatches
  workspace.applyTextEdits = applyTextEdits
  workspace.normalizePath = normalizePath
  workspace.parentPath = parentPath
  workspace.memory = memory
  workspace.openDirectory = openDirectory
  workspace.restoreDirectory = restoreDirectory
  workspace.saveDirectoryHandle = saveDirectoryHandle
  workspace.fromHandle = fromHandle
  workspace.fromBridge = fromBridge
  workspace.bind = bind
  workspace.unbind = unbind
  workspace.binding = binding
  workspace.bindings = bindingsSig

  aiditor.workspace = workspace
})(window.aiditor = window.aiditor || {})

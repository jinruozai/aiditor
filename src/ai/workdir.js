// aiditor.ai workspace - one optional bounded root shared by all agents.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const version = aiditor.signal(0)
  let workspace = null
  let directory = null

  function bump() { version.set(version.peek() + 1) }

  function clone(value) {
    return value == null ? value : (ai.serialize && ai.serialize.clone ? ai.serialize.clone(value) : JSON.parse(JSON.stringify(value)))
  }

  function directoryId(kind, label) {
    return String(kind || 'workspace') + ':' + String(label || 'Project')
  }

  function normalizeWorkspaceMeta(ws, meta) {
    const m = meta || {}
    const kind = String(m.kind || (ws && ws.kind && ws.kind()) || 'workspace')
    const label = String(m.label || m.name || m.path || (ws && ws.rootId && ws.rootId()) || 'Workspace')
    return {
      id: String(m.id || m.path || directoryId(kind, label)),
      label: label,
      kind: kind,
    }
  }

  function setWorkspace(ws, meta) {
    if (!ws) throw new Error('AI workspace is required')
    workspace = ws
    directory = normalizeWorkspaceMeta(ws, meta)
    bump()
    return directory
  }

  function clearWorkspace() {
    workspace = null
    directory = null
    bump()
  }

  async function selectWorkspaceDirectory() {
    const ws = await aiditor.workspace.openDirectory({ mode: 'readwrite' })
    return setWorkspace(ws)
  }

  function currentWorkspace() { return workspace }
  function workspaceMeta() { return directory }
  function workspaceLabel() { return directory && directory.label ? directory.label : 'Untitled' }

  function requireWorkspace() {
    if (!workspace) throw new Error('AI workspace is not available. Set an AI workspace first.')
    return workspace
  }

  function workspaceAvailable() {
    return !!workspace
  }

  function compactText(text, opts) {
    const o = opts || {}
    const source = String(text == null ? '' : text)
    const sourceLines = source.split(/\r?\n/)
    let out = source
    if (o.maxLines > 0) out = sourceLines.slice(0, o.maxLines).join('\n')
    const maxChars = o.full ? 0 : (o.maxChars || 20000)
    if (maxChars > 0 && out.length > maxChars) out = out.slice(0, maxChars)
    return {
      text: out,
      truncated: out.length < source.length,
      originalSize: source.length,
      originalLines: sourceLines.length,
      previewLines: out ? out.split(/\r?\n/).length : 0,
    }
  }

  async function readText(args) {
    const file = await requireWorkspace().readText(args.path)
    return Object.assign({}, file, compactText(file.text, args || {}))
  }

  async function readTextRange(args) {
    const file = await requireWorkspace().readText(args.path)
    const lines = file.text.split(/\r?\n/)
    const start = Math.max(1, args.startLine || 1)
    const end = Math.min(lines.length, args.endLine || start)
    return { path: file.path, hash: file.hash, startLine: start, endLine: end, text: lines.slice(start - 1, end).join('\n') }
  }

  async function fileSummary(args) {
    args = args || {}
    const ws = requireWorkspace()
    const root = args.path || ''
    const maxFiles = Math.max(1, args.maxFiles || 200)
    const maxDepth = args.maxDepth == null ? 4 : Math.max(0, args.maxDepth)
    const files = []
    const directories = []
    let truncated = false

    async function walk(path, depth) {
      if (files.length >= maxFiles) {
        truncated = true
        return
      }
      const entries = await ws.list(path || '')
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry.kind === 'directory') {
          directories.push({ path: entry.path, name: entry.name || entry.path.split('/').pop() })
          if (depth < maxDepth) await walk(entry.path, depth + 1)
          else truncated = true
        } else {
          files.push({
            path: entry.path,
            name: entry.name || entry.path.split('/').pop(),
            size: entry.size == null ? null : entry.size,
          })
          if (files.length >= maxFiles) {
            truncated = true
            return
          }
        }
      }
    }

    await walk(root, 0)
    return {
      root: root,
      files: files,
      directories: directories,
      fileCount: files.length,
      directoryCount: directories.length,
      truncated: truncated,
    }
  }

  function editFailurePreview(args, before, err) {
    return {
      id: 'workspace-preview-error-' + Date.now(),
      op: 'writeText',
      input: clone(args || {}),
      base: [],
      effects: [],
      summary: 'Edit ' + (args && args.path || ''),
      warnings: [],
      errors: [{ path: args && args.path || '', message: String(err && err.message || err) }],
      ok: false,
      diff: aiditor.workspace.diffSummary(before && before.text || '', before && before.text || ''),
      code: err && err.code || 'EDIT_FAILED',
      error: String(err && err.message || err),
      hint: err && err.hint || recoveryHint(err && err.code),
      expectedHash: err && err.expectedHash || args && args.baseHash || null,
      currentHash: err && err.currentHash || before && before.hash || null,
      editIndex: err && err.editIndex != null ? err.editIndex : null,
      matchCount: err && err.matchCount != null ? err.matchCount : null,
    }
  }

  function recoveryHint(code) {
    if (code === 'STALE_FILE') return 'The file changed after it was read. Search or read the current range again and retry with the new hash.'
    if (code === 'OLD_TEXT_NOT_FOUND') return 'Read the current range and copy the exact oldText from the latest file content.'
    if (code === 'AMBIGUOUS_MATCH') return 'Include more surrounding context in oldText so it matches exactly once.'
    if (code === 'VALIDATION_FAILED') return 'Inspect the edited range and repair the syntax or data shape before retrying.'
    return null
  }

  function readExistingFileState(path) {
    return Promise.resolve().then(function () {
      return requireWorkspace().readText(path)
    }).then(function (file) {
      return { exists: true, text: file.text, hash: file.hash }
    }, function () {
      return { exists: false, text: '', hash: aiditor.workspace.hashText('') }
    })
  }

  function readExistingFile(path) {
    return readExistingFileState(path).then(function (file) { return file.text })
  }

  function attachDiff(result, before, after) {
    return Object.assign({}, result, {
      diff: aiditor.workspace.diffSummary(before, after),
    })
  }

  function omitWrittenText(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, 'text')) return result
    const next = Object.assign({}, result)
    delete next.text
    next.textOmitted = true
    return next
  }

  function writeText(args) {
    const ws = requireWorkspace()
    return readExistingFile(args.path).then(function (before) {
      const text = String(args.text == null ? '' : args.text)
      aiditor.workspace.validateText(args.path, text, args || {})
      const input = { op: 'writeText', path: args.path, text: text, baseHash: args.baseHash || null, overwrite: !!args.overwrite }
      return ws.previewOperation(input).then(function (preview) {
        return ws.applyOperation(preview, { confirmWarnings: !!args.confirmWarnings, confirmOverwrite: !!args.confirmOverwrite })
      }).then(function (applied) {
        const result = applied.result || {}
        return omitWrittenText(attachDiff(result, before, result.text))
      })
    })
  }

  function patchText(args) {
    const ws = requireWorkspace()
    return readExistingFileState(args.path).then(function (file) {
      if (!file.exists) throw new Error('workspace.patchText: file not found: ' + args.path)
      const before = file.text
      const text = aiditor.workspace.applyLinePatches(before, args.baseHash, args.patches || [])
      aiditor.workspace.validateText(args.path, text, args || {})
      return ws.previewOperation({ op: 'writeText', path: args.path, text: text, baseHash: args.baseHash }).then(function (preview) {
        return ws.applyOperation(preview)
      }).then(function (applied) {
        const result = applied.result || {}
        return omitWrittenText(attachDiff(result, before, result.text))
      })
    })
  }

  function editText(args) {
    const ws = requireWorkspace()
    return readExistingFileState(args.path).then(function (file) {
      if (!file.exists) throw new Error('workspace.edit: file not found: ' + args.path)
      const before = file.text
      let text
      try {
        text = aiditor.workspace.applyTextEdits(before, args.baseHash, args.edits || [])
      } catch (err) {
        if (!err.hint) err.hint = recoveryHint(err.code)
        throw err
      }
      aiditor.workspace.validateText(args.path, text, args || {})
      return ws.previewOperation({ op: 'writeText', path: args.path, text: text, baseHash: args.baseHash }).then(function (preview) {
        return ws.applyOperation(preview)
      }).then(function (applied) {
        const result = applied.result || {}
        return omitWrittenText(attachDiff(result, before, result.text))
      })
    })
  }

  async function previewTextOperation(action, args) {
    args = args || {}
    const ws = requireWorkspace()
    const before = await readExistingFileState(args.path)
    let text = args.text || ''
    if (action === 'edit') {
      if (!before.exists) return editFailurePreview(args, before, { code: 'FILE_NOT_FOUND', message: 'workspace.edit: file not found: ' + args.path })
      try { text = aiditor.workspace.applyTextEdits(before.text, args.baseHash, args.edits || []) } catch (err) { return editFailurePreview(args, before, err) }
    }
    if (action === 'patch') {
      if (!before.exists) return editFailurePreview(args, before, { code: 'FILE_NOT_FOUND', message: 'workspace.patchText: file not found: ' + args.path })
      try { text = aiditor.workspace.applyLinePatches(before.text, args.baseHash, args.patches || []) } catch (err) { return editFailurePreview(args, before, err) }
    }
    try { aiditor.workspace.validateText(args.path, text, args || {}) } catch (err) {
      return editFailurePreview(args, before, { code: 'VALIDATION_FAILED', message: String(err && err.message || err) })
    }
    const preview = await ws.previewOperation({
      op: action === 'delete' ? 'delete' : 'writeText',
      path: args.path,
      text: text,
      baseHash: args.baseHash || null,
      overwrite: !!args.overwrite,
    })
    preview.diff = aiditor.workspace.diffSummary(before.text || '', text)
    preview.before = before.exists ? { hash: before.hash, size: before.text.length } : null
    return preview
  }

  async function previewPathOperation(action, args) {
    args = args || {}
    const input = Object.assign({ op: action }, args)
    return requireWorkspace().previewOperation(input)
  }

  function mkdirPath(args) {
    const ws = requireWorkspace()
    return ws.previewOperation({ op: 'mkdir', path: args.path, recursive: !!args.recursive, overwrite: !!args.overwrite }).then(function (preview) {
      return ws.applyOperation(preview, { confirmWarnings: args.confirmWarnings !== false, confirmOverwrite: !!args.confirmOverwrite })
    })
  }

  function copyPath(args) {
    const ws = requireWorkspace()
    return ws.previewOperation(Object.assign({ op: 'copy' }, args || {})).then(function (preview) {
      return ws.applyOperation(preview, { confirmWarnings: args.confirmWarnings !== false, confirmOverwrite: !!args.confirmOverwrite })
    })
  }

  function movePath(args) {
    const ws = requireWorkspace()
    return ws.previewOperation(Object.assign({ op: 'move' }, args || {})).then(function (preview) {
      return ws.applyOperation(preview, { confirmWarnings: args.confirmWarnings !== false, confirmOverwrite: !!args.confirmOverwrite })
    })
  }

  function deletePath(args) {
    const ws = requireWorkspace()
    return ws.previewOperation(Object.assign({ op: 'delete' }, args || {})).then(function (preview) {
      return ws.applyOperation(preview, { confirmWarnings: args.confirmWarnings !== false })
    })
  }

  function applyPathOperation(action, preview) {
    return requireWorkspace().applyOperation(preview, { confirmWarnings: true, confirmOverwrite: true }).then(function (result) {
      return Object.assign({ action: action }, result)
    })
  }

  function applyWriteText(preview) {
    return requireWorkspace().applyOperation(preview, { confirmWarnings: true, confirmOverwrite: true }).then(function (applied) {
      const result = applied.result || {}
      return Object.assign({ applied: true, resultVersion: result.hash || null }, result)
    })
  }

  function registerTools() {
    const owner = 'aiditor.ai.workdir'
    ai.tools.register('workspace.listFiles', {
      title: 'List Workspace Files',
      description: 'List files under the current AI workspace.',
      schema: { type: 'object', properties: { path: { type: 'string' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: function (args) { return requireWorkspace().list(args && args.path || '') },
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.fileSummary', {
      title: 'Workspace File Summary',
      description: 'Read a compact recursive file tree summary. Use this before reading many files.',
      schema: { type: 'object', properties: { path: { type: 'string' }, maxFiles: { type: 'number' }, maxDepth: { type: 'number' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: fileSummary,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.capabilities', {
      title: 'Workspace Capabilities',
      description: 'Read the generic capabilities supported by the current workspace adapter.',
      schema: { type: 'object', properties: {} },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: function () {
        const ws = requireWorkspace()
        return ws.capabilities ? ws.capabilities() : {}
      },
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.searchFiles', {
      title: 'Search Workspace Files',
      description: 'Search text in the current AI workspace. Results include fileHash, line, column, and preview ranges for precise follow-up reads.',
      schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, path: { type: 'string' }, include: { type: 'array' }, exclude: { type: 'array' }, mode: { type: 'string', enum: ['literal', 'regex'] }, caseSensitive: { type: 'boolean' }, before: { type: 'number' }, after: { type: 'number' }, limit: { type: 'number' }, maxPerFile: { type: 'number' }, maxFiles: { type: 'number' }, maxFileBytes: { type: 'number' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: function (args) { return requireWorkspace().search(args.query || '', args || {}) },
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.readText', {
      title: 'Read Workspace Text',
      description: 'Read one text file from the current AI workspace. Use readTextRange for large source files.',
      schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, full: { type: 'boolean' }, maxChars: { type: 'number' }, maxLines: { type: 'number' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: readText,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.readTextRange', {
      title: 'Read Workspace Text Range',
      description: 'Read a 1-based line range from one workspace file.',
      schema: { type: 'object', required: ['path', 'startLine', 'endLine'], properties: { path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: readTextRange,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.editText', {
      title: 'Edit Workspace Text',
      description: 'Precisely edit an existing workspace file with baseHash and exact oldText/newText replacements. Prefer this for existing source files.',
      schema: {
        type: 'object',
        required: ['path', 'baseHash', 'edits'],
        properties: {
          path: { type: 'string' },
          baseHash: { type: 'string' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              required: ['oldText', 'newText'],
              properties: {
                oldText: { type: 'string' },
                newText: { type: 'string' },
                replaceAll: { type: 'boolean' },
              },
            },
          },
          validate: { type: 'string', enum: ['auto', 'none', 'javascript', 'json'] },
        },
      },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewTextOperation('edit', args) },
      apply: applyWriteText,
      run: editText,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.writeText', {
      title: 'Write Workspace Text',
      description: 'Write one complete text file inside the current AI workspace. JS/JSON writes are validated before commit; prefer editText for existing source files.',
      schema: { type: 'object', required: ['path', 'text'], properties: { path: { type: 'string' }, text: { type: 'string' }, baseHash: { type: 'string' }, overwrite: { type: 'boolean' }, confirmOverwrite: { type: 'boolean' }, confirmWarnings: { type: 'boolean' }, validate: { type: 'string', enum: ['auto', 'none', 'javascript', 'json'] } } },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewTextOperation('write', args) },
      apply: applyWriteText,
      run: writeText,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.patchText', {
      title: 'Patch Workspace Text',
      description: 'Patch a workspace file with 1-based line patches and a base hash. JS/JSON results are validated before commit.',
      schema: { type: 'object', required: ['path', 'baseHash', 'patches'], properties: { path: { type: 'string' }, baseHash: { type: 'string' }, patches: { type: 'array' }, validate: { type: 'string', enum: ['auto', 'none', 'javascript', 'json'] } } },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewTextOperation('patch', args) },
      apply: applyWriteText,
      run: patchText,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.mkdir', {
      title: 'Create Workspace Directory',
      description: 'Create one directory inside the current workspace.',
      schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewPathOperation('mkdir', args) },
      apply: function (preview) { return applyPathOperation('mkdir', preview) },
      run: mkdirPath,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.copy', {
      title: 'Copy Workspace Path',
      description: 'Copy one file or directory inside the current workspace.',
      schema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, baseHash: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewPathOperation('copy', args) },
      apply: function (preview) { return applyPathOperation('copy', preview) },
      run: copyPath,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.move', {
      title: 'Move Workspace Path',
      description: 'Move or rename one file or directory inside the current workspace.',
      schema: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, baseHash: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewPathOperation('move', args) },
      apply: function (preview) { return applyPathOperation('move', preview) },
      run: movePath,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.delete', {
      title: 'Delete Workspace Path',
      description: 'Delete one file or directory inside the current workspace. Directories require recursive:true.',
      schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, recursive: { type: 'boolean' }, baseHash: { type: 'string' } } },
      permissions: ['tool.call', 'tool.apply'],
      available: workspaceAvailable,
      preview: function (args) { return previewPathOperation('delete', args) },
      apply: function (preview) { return applyPathOperation('delete', preview) },
      run: deletePath,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('workspace.stat', {
      title: 'Stat Workspace Path',
      description: 'Read metadata for one path in the current AI workspace.',
      schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: function (args) { return requireWorkspace().stat(args.path) },
    }, { owner: owner, layer: 'builtin' })
  }

  ai.setWorkspace = setWorkspace
  ai.clearWorkspace = clearWorkspace
  ai.selectWorkspaceDirectory = selectWorkspaceDirectory
  ai.currentWorkspace = currentWorkspace
  ai.workspaceMeta = workspaceMeta
  ai.workspaceLabel = workspaceLabel
  ai.workspaceVersion = function () { return version() }

  registerTools()
})(window.aiditor = window.aiditor || {})

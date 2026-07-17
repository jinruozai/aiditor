// aiditor.ai code tools - generic workspace code context.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  const CODE_EXT = {
    js: true,
    mjs: true,
    cjs: true,
    ts: true,
    tsx: true,
    jsx: true,
    css: true,
    html: true,
    json: true,
    md: true,
  }

  const SKIP_CALLS = {
    if: true,
    for: true,
    while: true,
    switch: true,
    catch: true,
    function: true,
    return: true,
    typeof: true,
    new: true,
  }

  function requireWorkspace() {
    const ws = ai.currentWorkspace && ai.currentWorkspace()
    if (!ws) throw new Error('AI workspace is not available. Set an AI workspace first.')
    return ws
  }

  function workspaceAvailable() {
    return !!(ai.currentWorkspace && ai.currentWorkspace())
  }

  function extension(path) {
    const i = String(path || '').lastIndexOf('.')
    return i < 0 ? '' : String(path).slice(i + 1).toLowerCase()
  }

  function isCodeFile(path) {
    return !!CODE_EXT[extension(path)]
  }

  function pushLimited(list, item, limit) {
    if (list.length < limit) list.push(item)
  }

  function uniqueLimited(list, item, key, limit) {
    for (let i = 0; i < list.length; i++) if (list[i][key] === item[key]) return
    pushLimited(list, item, limit)
  }

  function compactLine(line) {
    return String(line || '').trim().replace(/\s+/g, ' ')
  }

  function tokenize(text) {
    const words = String(text || '').toLowerCase().split(/[^a-z0-9_$.-]+/).filter(function (item) { return item.length > 1 })
    const seen = {}
    const out = []
    for (let i = 0; i < words.length; i++) {
      if (seen[words[i]]) continue
      seen[words[i]] = true
      out.push(words[i])
    }
    return out
  }

  function includesFolded(text, term) {
    return String(text || '').toLowerCase().indexOf(term) >= 0
  }

  function scoreOutline(outline, query) {
    const terms = tokenize(query)
    if (!terms.length) return { score: 0, reasons: [] }
    let score = 0
    const reasons = []
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]
      if (includesFolded(outline.path, term)) {
        score += 12
        reasons.push('path:' + term)
      }
      for (let s = 0; s < outline.symbols.length; s++) {
        if (includesFolded(outline.symbols[s].name, term)) {
          score += 10
          reasons.push('symbol:' + outline.symbols[s].name)
        }
      }
      for (let c = 0; c < outline.calls.length; c++) {
        if (includesFolded(outline.calls[c].name, term)) {
          score += 4
          reasons.push('call:' + outline.calls[c].name)
        }
      }
      for (let e = 0; e < outline.events.length; e++) {
        if (includesFolded(outline.events[e].text, term)) {
          score += 3
          reasons.push('event:' + term)
        }
      }
    }
    return { score: score, reasons: reasons.slice(0, 8) }
  }

  function outlineText(path, text, opts) {
    const o = opts || {}
    const maxSymbols = o.maxSymbols || 80
    const maxCalls = o.maxCalls || 120
    const maxEvents = o.maxEvents || 40
    const lines = String(text == null ? '' : text).split(/\r?\n/)
    const symbols = []
    const calls = []
    const events = []
    const callRe = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNo = i + 1
      let m = line.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/)
      if (m) pushLimited(symbols, { kind: 'function', name: m[1], line: lineNo }, maxSymbols)
      m = line.match(/\bclass\s+([A-Za-z_$][\w$]*)\b/)
      if (m) pushLimited(symbols, { kind: 'class', name: m[1], line: lineNo }, maxSymbols)
      m = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/)
      if (m) pushLimited(symbols, { kind: 'binding', name: m[1], line: lineNo }, maxSymbols)
      m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/)
      if (m) pushLimited(symbols, { kind: 'method', name: m[1], line: lineNo }, maxSymbols)

      callRe.lastIndex = 0
      while ((m = callRe.exec(line))) {
        const name = m[1]
        const head = name.split('.')[0]
        if (!SKIP_CALLS[head]) uniqueLimited(calls, { name: name, line: lineNo }, 'name', maxCalls)
      }

      if (
        line.indexOf('addEventListener') >= 0 ||
        line.indexOf('dispatchEvent') >= 0 ||
        line.indexOf('.on(') >= 0 ||
        line.indexOf('ctx.bus') >= 0 ||
        line.indexOf('aiditor.bus') >= 0 ||
        line.indexOf('onCleanup') >= 0 ||
        line.indexOf('register') >= 0
      ) {
        pushLimited(events, { line: lineNo, text: compactLine(line) }, maxEvents)
      }
    }

    return {
      path: path,
      hash: aiditor.workspace.hashText(text),
      size: String(text == null ? '' : text).length,
      lines: lines.length,
      symbols: symbols,
      calls: calls,
      events: events,
    }
  }

  async function walk(ws, path, out, limit) {
    if (out.length >= limit) return true
    const entries = await ws.list(path || '')
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (entry.kind === 'directory') {
        const stopped = await walk(ws, entry.path, out, limit)
        if (stopped) return true
      } else if (isCodeFile(entry.path)) {
        out.push(entry.path)
        if (out.length >= limit) return true
      }
    }
    return false
  }

  async function outline(args) {
    args = args || {}
    const file = await requireWorkspace().readText(args.path)
    return outlineText(file.path, file.text, args)
  }

  async function map(args) {
    args = args || {}
    const ws = requireWorkspace()
    const maxFiles = Math.max(1, args.maxFiles || 80)
    const maxResults = Math.max(1, args.maxResults || maxFiles)
    const paths = []
    const truncated = await walk(ws, args.path || '', paths, maxFiles + 1)
    const files = []
    for (let i = 0; i < paths.length && files.length < maxFiles; i++) {
      const file = await ws.readText(paths[i])
      const outline = outlineText(file.path, file.text, {
        maxSymbols: args.maxSymbols || 24,
        maxCalls: args.maxCalls || 40,
        maxEvents: args.maxEvents || 16,
      })
      const match = scoreOutline(outline, args.query || '')
      if (args.query) outline.match = match
      files.push(outline)
    }
    if (args.query) {
      files.sort(function (a, b) {
        return (b.match.score || 0) - (a.match.score || 0) || a.path.localeCompare(b.path)
      })
    }
    return {
      root: args.path || '',
      query: args.query || '',
      files: args.query ? files.filter(function (file) { return file.match.score > 0 }).slice(0, maxResults) : files,
      truncated: truncated || paths.length > maxFiles,
      scannedFiles: Math.min(paths.length, maxFiles),
      totalMatches: args.query ? files.filter(function (file) { return file.match.score > 0 }).length : files.length,
    }
  }

  function registerTools() {
    const owner = 'aiditor.ai.code'
    ai.tools.register('code.outline', {
      title: 'Outline Code File',
      description: 'Read a compact structural outline for one workspace code file.',
      schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, maxSymbols: { type: 'number' }, maxCalls: { type: 'number' }, maxEvents: { type: 'number' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: outline,
    }, { owner: owner, layer: 'builtin' })
    ai.tools.register('code.map', {
      title: 'Map Workspace Code',
      description: 'Build compact ranked outlines for code files under one workspace path. Use query to get a relevant repo map before reading exact ranges.',
      schema: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' }, maxFiles: { type: 'number' }, maxResults: { type: 'number' }, maxSymbols: { type: 'number' }, maxCalls: { type: 'number' }, maxEvents: { type: 'number' } } },
      permissions: ['tool.call'],
      available: workspaceAvailable,
      run: map,
    }, { owner: owner, layer: 'builtin' })
  }

  ai.code = {
    outlineText: outlineText,
    isCodeFile: isCodeFile,
    scoreOutline: scoreOutline,
  }

  registerTools()
})(window.aiditor = window.aiditor || {})

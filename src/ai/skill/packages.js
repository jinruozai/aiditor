// Bounded file-backed Skill packages over a workspace adapter.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  if (!ai.skills) return

  const PACKAGE_DIRS = [
    { path: 'references', kind: 'reference' },
    { path: 'assets', kind: 'asset' },
    { path: 'scripts', kind: 'script' },
  ]

  function normalizePath(path, label) {
    path = String(path || '').replace(/\\/g, '/')
    if (path.charAt(0) === '/' || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new Error(label + ' must be workspace-relative')
    const parts = path.split('/')
    const out = []
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === '.') continue
      if (parts[i] === '..') throw new Error(label + ' cannot traverse outside the package')
      out.push(parts[i])
    }
    return out.join('/')
  }

  function joinPath(left, right) {
    return left ? left + '/' + right : right
  }

  function fileText(value) {
    return String(value && value.text != null ? value.text : value || '')
  }

  function scalar(text) {
    text = String(text || '').trim()
    if (text === 'true') return true
    if (text === 'false') return false
    if (text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') return JSON.parse(text)
    if (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'") return text.slice(1, -1).replace(/''/g, "'")
    return text
  }

  function parseFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(String(text || '').replace(/^\uFEFF/, ''))
    if (!match) throw new Error('SKILL.md requires YAML frontmatter')
    const lines = match[1].split(/\r?\n/)
    const data = {}
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim() || /^\s*#/.test(line)) continue
      const pair = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
      if (!pair) continue
      const key = pair[1]
      const raw = pair[2]
      if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
        const block = []
        while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) {
          i += 1
          block.push(lines[i].replace(/^\s+/, ''))
        }
        data[key] = raw.charAt(0) === '>' ? block.join(' ').trim() : block.join('\n').trim()
      } else {
        data[key] = scalar(raw)
      }
    }
    const name = String(data.name || '')
    const description = String(data.description || '')
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('SKILL.md name must be lowercase letters, digits, and hyphens (max 64)')
    if (!description || description.length > 1024) throw new Error('SKILL.md description is required and must be at most 1024 characters')
    return {
      name: name,
      description: description,
      argumentHint: String(data['argument-hint'] || ''),
      userInvocable: data['user-invocable'] !== false,
      body: match[2].trim(),
    }
  }

  function relativeToRoot(root, path) {
    const prefix = root ? root + '/' : ''
    if (path.indexOf(prefix) !== 0) throw new Error('Skill resource escaped package root: ' + path)
    return path.slice(prefix.length)
  }

  async function collectResources(ws, root, maxResources) {
    const out = []
    const rootEntries = await ws.list(root)
    const directories = Object.create(null)
    for (let i = 0; i < rootEntries.length; i++) {
      const entry = rootEntries[i]
      const entryPath = normalizePath(entry.path || joinPath(root, entry.name), 'Skill resource path')
      const relative = relativeToRoot(root, entryPath)
      const entryKind = entry.kind || entry.type
      if (entryKind !== 'directory' || relative.indexOf('/') !== -1) continue
      for (let j = 0; j < PACKAGE_DIRS.length; j++) {
        if (PACKAGE_DIRS[j].path === relative) directories[relative] = entryPath
      }
    }
    for (let i = 0; i < PACKAGE_DIRS.length; i++) {
      const folder = PACKAGE_DIRS[i]
      const path = directories[folder.path]
      if (path) await walkResources(ws, root, path, folder.kind, maxResources, out)
    }
    out.sort(function (a, b) { return a.path.localeCompare(b.path) })
    return out
  }

  async function walkResources(ws, root, path, kind, maxResources, out) {
    const entries = await ws.list(path)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const entryPath = normalizePath(entry.path || joinPath(path, entry.name), 'Skill resource path')
      const relative = relativeToRoot(root, entryPath)
      const entryKind = entry.kind || entry.type
      if (entryKind === 'directory') {
        await walkResources(ws, root, entryPath, kind, maxResources, out)
        continue
      }
      if (out.length >= maxResources) throw new Error('Skill package exceeds maxResources (' + maxResources + ')')
      out.push({
        path: relative,
        kind: kind,
        size: entry.size == null ? null : Number(entry.size),
        hash: entry.hash == null ? null : String(entry.hash),
        mime: entry.mime == null ? null : String(entry.mime),
      })
    }
  }

  function resourceReader(ws, root, resources) {
    const readable = {}
    for (let i = 0; i < resources.length; i++) {
      if (resources[i].kind === 'reference') readable[resources[i].path] = resources[i]
    }
    return async function (path) {
      path = normalizePath(path, 'Skill resource path')
      const resource = readable[path]
      if (!resource) throw new Error('Skill reference resource not found: ' + path)
      const file = await ws.readText(joinPath(root, path))
      return {
        path: path,
        kind: resource.kind,
        text: fileText(file),
        size: file && file.size != null ? file.size : resource.size,
        hash: file && file.hash != null ? file.hash : resource.hash,
        mime: file && file.mime != null ? file.mime : resource.mime,
      }
    }
  }

  function resourceLimit(value) {
    if (value == null) return 200
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) throw new Error('Skill package maxResources must be a non-negative finite number')
    return Math.floor(number)
  }

  async function loadPackage(input, meta) {
    input = input || {}
    const ws = input.workspace || (ai.currentWorkspace && ai.currentWorkspace())
    if (!ws || typeof ws.readText !== 'function' || typeof ws.list !== 'function') throw new Error('Skill package requires a workspace with readText and list')
    const root = normalizePath(input.root, 'Skill package root')
    const manifestPath = joinPath(root, 'SKILL.md')
    const file = await ws.readText(manifestPath)
    const parsed = parseFrontmatter(fileText(file))
    const id = String(input.id || parsed.name)
    if (!id) throw new Error('Skill package id is required')
    const maxResources = resourceLimit(input.maxResources)
    const resources = await collectResources(ws, root, maxResources)
    const spec = {
      title: String(input.title || parsed.name),
      description: parsed.description,
      argumentHint: String(input.argumentHint != null ? input.argumentHint : parsed.argumentHint),
      userInvocable: input.userInvocable == null ? parsed.userInvocable : input.userInvocable !== false,
      modelInvocable: input.modelInvocable !== false,
      whenToUse: String(input.whenToUse || parsed.description),
      whenNotToUse: String(input.whenNotToUse || ''),
      systemPrompt: parsed.body,
      rules: Array.isArray(input.rules) ? input.rules.slice() : [],
      examples: Array.isArray(input.examples) ? input.examples.slice() : [],
      tools: Array.isArray(input.tools) ? input.tools.slice() : [],
      relatedApis: Array.isArray(input.relatedApis) ? input.relatedApis.slice() : [],
      resources: resources,
      docPath: manifestPath,
      available: input.available,
      unavailableReason: input.unavailableReason,
      readResource: resourceReader(ws, root, resources),
    }
    const registration = Object.assign({
      owner: 'skill-package:' + id,
      layer: 'workspace',
      source: root || 'SKILL.md',
    }, meta || {})
    if (file && file.hash != null && registration.hash == null) registration.hash = file.hash
    return ai.skills.register(id, spec, registration)
  }

  function readResource(skillId, path) {
    const skill = ai.skills.get(skillId)
    if (!skill || typeof skill.readResource !== 'function') return Promise.reject(new Error('Skill has no readable package resources: ' + skillId))
    return Promise.resolve(skill.readResource(path))
  }

  ai.skills.loadPackage = loadPackage
  ai.skills.readResource = readResource
})(window.aiditor = window.aiditor || {})

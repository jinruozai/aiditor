import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }

for (const file of [
  'src/core/signal.js',
  'src/core/log.js',
  'src/core/workspace.js',
  'src/core/names.js',
  'src/ai/name-generator.js',
  'src/ai/permission.js',
  'src/ai/store.js',
  'src/ai/connection.js',
  'src/ai/adapter.js',
  'src/ai/schema.js',
  'src/ai/contribution-registry.js',
  'src/ai/tool/registry.js',
  'src/ai/context/registry.js',
  'src/ai/skill/registry.js',
  'src/ai/tool/runtime.js',
  'src/ai/skill/builtins.js',
  'src/ai/workdir.js',
  'src/ai/code.js',
  'src/ai/request.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ai = aiditor.ai
ai.registerTransport('workspace-test', { toolProtocol: 'native' })
ai.registerConnection('workspace-test', { auth: { type: 'none' }, transport: { type: 'workspace-test' }, configDefaults: {} })
ai.setActiveConnection('workspace-test')
const workspace = aiditor.workspace.memory({
  'src/app.js': 'const value = 1\nconsole.log(value)\n',
  'README.md': 'hello workspace',
})

const agent = ai.createAgent({ name: 'Workspace Agent', permissionMode: 'default', skillRefs: ['aiditor.workspace-authoring'] })
const noWorkspaceRequest = ai.makeRequest(agent, null, 'run_no_workspace_tools', 'user', 0)
assert.equal(noWorkspaceRequest.tools.some(function (tool) { return tool.indexOf('workspace.') === 0 }), false)
assert.equal(noWorkspaceRequest.tools.some(function (tool) { return tool.indexOf('code.') === 0 }), false)
const blockedUiRequest = ai.makeRequest(agent, { role: 'user', content: '写一个简单的背包界面，放在主dock' }, 'run_blocked_ui_tools', 'user', 0)
assert.equal(blockedUiRequest.tools.length, 0)
assert.doesNotMatch(blockedUiRequest.messages[0].content, /CURRENT_REQUEST_BLOCKED/)
assert.equal(blockedUiRequest.skills.includes('aiditor.workspace-authoring'), false)
assert.equal(ai.skills.availability('aiditor.workspace-authoring', {}).available, false)
assert.match(blockedUiRequest.messages[0].content, /Current runtime state and available tools/)
const escapedChineseUiRequest = ai.makeRequest(agent, { role: 'user', content: '\u5199\u4e00\u4e2a\u7b80\u5355\u7684\u80cc\u5305\u754c\u9762\uff0c\u653e\u5728\u4e3bdock' }, 'run_escaped_chinese_ui_tools', 'user', 0)
assert.equal(escapedChineseUiRequest.tools.length, 0)
assert.doesNotMatch(escapedChineseUiRequest.messages[0].content, /CURRENT_REQUEST_BLOCKED/)
const dir = ai.setWorkspace(workspace, { id: 'memory:test', label: 'Test Workspace', kind: 'memory' })
const plainWorkspaceRequest = ai.makeRequest(ai.createAgent({ name: 'Plain Workspace Agent' }), null, 'run_plain_workspace', 'user', 0)
assert.deepEqual(plainWorkspaceRequest.tools, [])
assert.equal(plainWorkspaceRequest.skills.includes('aiditor.workspace-authoring'), false)
const workspaceRequest = ai.makeRequest(agent, null, 'run_workspace_tools', 'user', 0)
assert.equal(workspaceRequest.tools.includes('workspace.fileSummary'), true)
assert.equal(workspaceRequest.tools.includes('workspace.mkdir'), true)
assert.equal(workspaceRequest.tools.includes('workspace.move'), true)
assert.equal(workspaceRequest.tools.includes('code.map'), true)
assert.equal(workspaceRequest.skills.includes('aiditor.workspace-authoring'), true)
assert.match(workspaceRequest.messages[0].content, /bounded workspace contract/)
assert.equal(workspaceRequest.messages[0].meta.contextLayer, 'runtime')
assert.equal(workspaceRequest.messages[1].meta.contextLayer, 'workspace')
assert.match(workspaceRequest.messages[1].content, /Current workspace context/)
assert.match(workspaceRequest.messages[1].content, /workspace\.editText/)
assert.equal(workspaceRequest.messages.some(function (message) { return message.meta && message.meta.contextLayer === 'task' }), false)

assert.deepEqual(dir, { id: 'memory:test', label: 'Test Workspace', kind: 'memory' })
assert.equal(ai.workspaceLabel(), 'Test Workspace')
assert.equal(ai.currentWorkspace(), workspace)

const child = ai.createAgent({ name: 'Child', parentAgentId: agent.id, select: false })
assert.equal(child.workingDirectory, undefined)
assert.equal(ai.currentWorkspace(), workspace)

const ctx = { agent: ai.findAgent(agent.id) }
const files = await ai.tools.get('workspace.listFiles').run({}, ctx)
assert.deepEqual(files.map(function (file) { return file.path }).sort(), ['README.md', 'src'])

const summary = await ai.tools.get('workspace.fileSummary').run({ maxFiles: 10 }, ctx)
assert.deepEqual(summary.files.map(function (file) { return file.path }).sort(), ['README.md', 'src/app.js'])
assert.deepEqual(summary.directories.map(function (dir) { return dir.path }), ['src'])
assert.equal(summary.truncated, false)

const caps = await ai.tools.get('workspace.capabilities').run({}, ctx)
assert.equal(caps.mkdir, true)
await ai.tools.get('workspace.mkdir').run({ path: 'docs' }, ctx)
await ai.tools.get('workspace.copy').run({ from: 'README.md', to: 'docs/README-copy.md' }, ctx)
assert.equal((await ai.tools.get('workspace.readText').run({ path: 'docs/README-copy.md' }, ctx)).text, 'hello workspace')
const movePreview = await ai.tools.get('workspace.move').preview({ from: 'docs/README-copy.md', to: 'docs/README-moved.md' }, ctx)
assert.equal(movePreview.ok, true)
await ai.tools.get('workspace.move').apply(movePreview, ctx)
assert.equal((await ai.tools.get('workspace.stat').run({ path: 'docs/README-moved.md' }, ctx)).kind, 'file')
await ai.tools.get('workspace.delete').run({ path: 'docs', recursive: true }, ctx)
await assert.rejects(
  async () => ai.tools.get('workspace.stat').run({ path: 'docs/README-moved.md' }, ctx),
  /path not found/
)

const read = await ai.tools.get('workspace.readText').run({ path: 'src/app.js' }, ctx)
assert.equal(read.hash, aiditor.workspace.hashText(read.text))
assert.match(read.text, /const value/)
assert.equal(read.truncated, false)

const patched = await ai.tools.get('workspace.patchText').run({
  path: 'src/app.js',
  baseHash: read.hash,
  patches: [{ startLine: 1, endLine: 1, replacement: 'const value = 2' }],
}, ctx)
assert.equal(patched.text, undefined)
assert.equal(patched.textOmitted, true)
assert.equal(patched.diff.changed, true)
assert.equal(patched.diff.startLine, 1)
const patchedRead = await ai.tools.get('workspace.readText').run({ path: 'src/app.js' }, ctx)
assert.equal(patched.hash, patchedRead.hash)
assert.match(patchedRead.text, /value = 2/)

const edited = await ai.tools.get('workspace.editText').run({
  path: 'src/app.js',
  baseHash: patchedRead.hash,
  edits: [{ oldText: 'console.log(value)', newText: 'console.info(value)' }],
}, ctx)
assert.equal(edited.text, undefined)
assert.equal(edited.textOmitted, true)
const editedRead = await ai.tools.get('workspace.readText').run({ path: 'src/app.js' }, ctx)
assert.equal(edited.hash, editedRead.hash)
assert.match(editedRead.text, /console\.info/)

const ambiguousPreview = await ai.tools.get('workspace.editText').preview({
  path: 'src/app.js',
  baseHash: editedRead.hash,
  edits: [{ oldText: 'value', newText: 'count' }],
}, ctx)
assert.equal(ambiguousPreview.ok, false)
assert.equal(ambiguousPreview.code, 'AMBIGUOUS_MATCH')

const staleEditPreview = await ai.tools.get('workspace.editText').preview({
  path: 'src/app.js',
  baseHash: patchedRead.hash,
  edits: [{ oldText: 'console.info(value)', newText: 'console.warn(value)' }],
}, ctx)
assert.equal(staleEditPreview.ok, false)
assert.equal(staleEditPreview.code, 'STALE_FILE')

await ai.tools.get('workspace.writeText').run({ path: 'src/extra.js', text: 'export const ok = true\n' }, ctx)
const matches = await ai.tools.get('workspace.searchFiles').run({ query: 'ok', path: 'src' }, ctx)
assert.equal(matches.matches[0].path, 'src/extra.js')
assert.equal(typeof matches.matches[0].fileHash, 'string')
assert.deepEqual(matches.errors, [])
await ai.tools.get('workspace.writeText').run({ path: 'src/long.txt', text: 'a'.repeat(64) }, ctx)
const compactRead = await ai.tools.get('workspace.readText').run({ path: 'src/long.txt', maxChars: 12 }, ctx)
assert.equal(compactRead.text, 'aaaaaaaaaaaa')
assert.equal(compactRead.truncated, true)
assert.equal(compactRead.originalSize, 64)
assert.equal(compactRead.text.includes('...[truncated]'), false)

await assert.rejects(
  ai.tools.get('workspace.writeText').run({ path: 'src/broken.js', text: 'function broken() {\n  const value = "cut off\n' }, ctx),
  /unterminated|string|invalid JavaScript|unclosed/
)
assert.throws(
  () => ai.tools.get('workspace.stat').run({ path: 'src/broken.js' }, ctx),
  /path not found|file not found/
)

const jsonBefore = await ai.tools.get('workspace.writeText').run({ path: 'data/config.json', text: '{"ok":true}\n' }, ctx)
await assert.rejects(
  ai.tools.get('workspace.writeText').run({ path: 'data/config.json', text: '{"ok":\n', baseHash: jsonBefore.hash }, ctx),
  /invalid JSON/
)
assert.equal((await ai.tools.get('workspace.readText').run({ path: 'data/config.json', full: true }, ctx)).text, '{"ok":true}\n')

const patchTarget = await ai.tools.get('workspace.writeText').run({ path: 'src/patch-target.js', text: 'function ok() {\n  return 1\n}\n' }, ctx)
await assert.rejects(
  ai.tools.get('workspace.patchText').run({
    path: 'src/patch-target.js',
    baseHash: patchTarget.hash,
    patches: [{ startLine: 2, endLine: 2, replacement: '  return "cut off' }],
  }, ctx),
  /unterminated|string|invalid JavaScript/
)
assert.match((await ai.tools.get('workspace.readText').run({ path: 'src/patch-target.js', full: true }, ctx)).text, /return 1/)
await ai.tools.get('workspace.writeText').run({ path: 'src/regex.js', text: 'const re = /[{}]/g\nconsole.log(re.test(\"{\"))\n' }, ctx)

const writeCall = ai.createToolCall(agent.id, {
  toolId: 'workspace.writeText',
  args: { path: 'src/via-apply.js', text: 'export const applied = true\n' },
}, 'user')
const writePreview = ai.previewToolCall(agent.id, writeCall.id, 'user')
await writePreview.promise
assert.equal(ai.findToolCall(agent.id, writeCall.id).toolCall.status, 'previewed')
assert.equal(ai.findToolCall(agent.id, writeCall.id).toolCall.preview.diff.changed, true)
const writeApply = ai.applyToolCall(agent.id, writeCall.id, 'user')
await writeApply.promise
assert.equal(ai.findToolCall(agent.id, writeCall.id).toolCall.status, 'applied')
const appliedRead = await ai.tools.get('workspace.readText').run({ path: 'src/via-apply.js' }, ctx)
assert.match(appliedRead.text, /applied/)

const stalePreview = await ai.tools.get('workspace.writeText').preview({ path: 'src/via-apply.js', text: 'export const stale = true\n', baseHash: appliedRead.hash }, ctx)
assert.equal(stalePreview.base[0].hash, appliedRead.hash)
await ai.tools.get('workspace.writeText').run({ path: 'src/via-apply.js', text: 'export const newer = true\n', baseHash: appliedRead.hash }, ctx)
await assert.rejects(
  ai.tools.get('workspace.writeText').apply(stalePreview, ctx),
  /hash changed|baseHash mismatch/
)
assert.match((await ai.tools.get('workspace.readText').run({ path: 'src/via-apply.js', full: true }, ctx)).text, /newer/)

const deleted = await ai.tools.get('workspace.delete').run({ path: 'src/extra.js' }, ctx)
assert.equal(deleted.applied, true)
assert.equal(deleted.effects[0].path, 'src/extra.js')

ai.setPermissionResolver(function (perm, next) {
  if (perm.toolId === 'workspace.delete' && perm.phase === 'apply') return false
  return next(perm)
})
const deleteCall = ai.createToolCall(agent.id, {
  toolId: 'workspace.delete',
  args: { path: 'src/via-apply.js' },
}, 'user')
const deletePreview = ai.previewToolCall(agent.id, deleteCall.id, 'user')
await deletePreview.promise
assert.equal(ai.applyToolCall(agent.id, deleteCall.id, 'user'), null)
assert.equal((await ai.tools.get('workspace.stat').run({ path: 'src/via-apply.js' }, ctx)).path, 'src/via-apply.js')
ai.setPermissionResolver(null)

console.log('ai workdir tests ok')

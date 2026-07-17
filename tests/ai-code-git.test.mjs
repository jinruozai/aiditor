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
  'src/ai/registries.js',
  'src/ai/context.js',
  'src/ai/workdir.js',
  'src/ai/code.js',
  'src/ai/git.js',
  'src/ai/verify.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
const ai = aiditor.ai
const workspace = aiditor.workspace.memory({
  'src/app.js': [
    'aiditor.registerComponent("demo.card", {',
    '  factory: function (propsSig, ctx) {',
    '    const root = document.createElement("div")',
    '    root.addEventListener("click", function () { ctx.bus.emit("demo.click", {}) })',
    '    return root',
    '  }',
    '})',
    '',
  ].join('\n'),
  'src/util.js': [
    'export function sum(a, b) {',
    '  return a + b',
    '}',
    '',
  ].join('\n'),
  'assets/readme.txt': 'not code',
})

const agent = ai.createAgent({ name: 'Code Agent', permissionMode: 'default' })
ai.setWorkspace(workspace, { id: 'memory:code', label: 'Code Workspace', kind: 'memory' })

const outline = await ai.tools.get('code.outline').run({ path: 'src/app.js' })
assert.equal(outline.path, 'src/app.js')
assert.equal(outline.hash, aiditor.workspace.hashText((await workspace.readText('src/app.js')).text))
assert.ok(outline.symbols.some(function (item) { return item.name === 'root' }))
assert.ok(outline.calls.some(function (item) { return item.name === 'aiditor.registerComponent' }))
assert.ok(outline.events.some(function (item) { return item.text.indexOf('addEventListener') >= 0 }))

const map = await ai.tools.get('code.map').run({ path: 'src', maxFiles: 10 })
assert.deepEqual(map.files.map(function (file) { return file.path }).sort(), ['src/app.js', 'src/util.js'])
assert.equal(map.truncated, false)

const rankedMap = await ai.tools.get('code.map').run({ path: 'src', query: 'registerComponent click bus', maxFiles: 10 })
assert.equal(rankedMap.query, 'registerComponent click bus')
assert.equal(rankedMap.files[0].path, 'src/app.js')
assert.equal(rankedMap.files[0].match.score > 0, true)
assert.equal(rankedMap.files.some(function (file) { return file.path === 'src/util.js' }), false)
assert.equal(rankedMap.totalMatches, 1)

assert.equal(ai.tools.get('git.status'), undefined)
ai.configureGit({
  status: function () { return { clean: false, files: ['src/app.js'] } },
  diff: function () { return { text: 'diff --git a/src/app.js b/src/app.js' } },
  diffFile: function (args) { return { path: args.path, text: '@@ -1 +1 @@' } },
  log: function () { return [{ ref: 'abc123', subject: 'initial' }] },
  show: function (args) { return { ref: args.ref, text: 'commit ' + args.ref } },
  stage: function (args) { return { staged: args.paths || [] } },
  restoreFile: function (args) { return { restored: args.paths || [args.path] } },
  commit: function (args) { return { hash: 'def456', message: args.message } },
})

assert.deepEqual(await ai.tools.get('git.status').run({}), { clean: false, files: ['src/app.js'] })
assert.match((await ai.tools.get('git.diff').run({})).text, /diff --git/)
assert.equal((await ai.tools.get('git.diffFile').run({ path: 'src/app.js' })).path, 'src/app.js')
assert.equal((await ai.tools.get('git.log').run({ limit: 1 }))[0].subject, 'initial')
assert.equal((await ai.tools.get('git.show').run({ ref: 'abc123' })).ref, 'abc123')

const commitCall = ai.createToolCall(agent.id, {
  toolId: 'git.commit',
  args: { message: 'test commit', paths: ['src/app.js'] },
}, 'user')
assert.equal(ai.previewToolCall(agent.id, commitCall.id, 'user').status, 'previewed')
ai.setPermissionResolver(function (perm, next) {
  if (perm.toolId === 'git.commit' && perm.phase === 'apply') return false
  return next(perm)
})
assert.equal(ai.applyToolCall(agent.id, commitCall.id, 'user'), null)
ai.setPermissionResolver(null)
const applied = ai.applyToolCall(agent.id, commitCall.id, 'user')
await applied.promise
const finalCall = ai.findToolCall(agent.id, commitCall.id).toolCall
assert.equal(finalCall.status, 'applied')
assert.equal(finalCall.applyResult.hash, 'def456')
ai.configureGit(null)
assert.equal(ai.tools.get('git.status'), undefined)

assert.equal(ai.tools.get('verify.run'), undefined)
ai.configureVerify({
  list: function () {
    return [{ id: 'check', title: 'Check' }]
  },
  run: function (args) {
    return {
      ok: args.check === 'check',
      check: args.check,
      exitCode: args.check === 'check' ? 0 : 1,
      output: 'checked ' + args.check,
    }
  },
  diagnostics: function () {
    return [{ path: 'src/app.js', line: 1, message: 'sample diagnostic' }]
  },
})

assert.deepEqual(await ai.tools.get('verify.list').run({}), [{ id: 'check', title: 'Check' }])
assert.equal((await ai.tools.get('verify.run').run({ check: 'check' })).ok, true)
assert.equal((await ai.tools.get('verify.diagnostics').run({ path: 'src/app.js' }))[0].line, 1)
ai.configureVerify(null)
assert.equal(ai.tools.get('verify.run'), undefined)

console.log('ai code/git/verify tests ok')

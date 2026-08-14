import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/core/signal.js', 'utf8'), { filename: 'signal.js' })
vm.runInThisContext(readFileSync('src/core/i18n.js', 'utf8'), { filename: 'i18n.js' })
vm.runInThisContext(readFileSync('src/ai/i18n.js', 'utf8'), { filename: 'ai/i18n.js' })

const aiditor = window.aiditor

aiditor.i18n.register('en', { hello: 'Hello {name}', only: 'Only English' })
aiditor.i18n.register('zh', { hello: '你好 {name}' })
assert.equal(aiditor.i18n.t('hello', { name: 'Ada' }), 'Hello Ada')
assert.equal(aiditor.i18n.t('ai.tool.remember'), 'Remember')
aiditor.i18n.setLocale('zh')
assert.equal(aiditor.i18n.t('hello', { name: 'Ada' }), '你好 Ada')
assert.equal(aiditor.i18n.t('ai.tool.remember'), '记住')
assert.equal(aiditor.i18n.t('only'), 'Only English')
assert.equal(aiditor.i18n.t('missing.key'), 'missing.key')

const sig = aiditor.i18n.text('hello', { name: 'Lin' })
assert.equal(sig(), '你好 Lin')
aiditor.i18n.setLocale('en')
assert.equal(sig(), 'Hello Lin')
sig.dispose()

console.log('i18n tests ok')

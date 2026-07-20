import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
for (const file of [
  'src/core/signal.js',
  'src/core/names.js',
  'src/core/settings.js',
  'src/ai/serialize.js',
  'src/ai/trace.js',
  'src/ai/connection.js',
  'src/ai/provider.js',
]) vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })

const ai = window.aiditor.ai
const httpError = ai.provider.providerError({
  status: 429,
  statusText: 'Too Many Requests',
  headers: { get: function () { return '2' } },
}, { error: { message: 'slow down' } })
assert.equal(httpError.code, 'PROVIDER_RATE_LIMITED')
assert.equal(httpError.retryable, true)
assert.equal(httpError.retryAfterMs, 2000)

let attempts = 0
ai.registerTransport('retry-test', {
  toolProtocol: 'none',
  send: function () {
    attempts++
    if (attempts < 3) {
      const err = new Error('busy')
      err.code = 'PROVIDER_UNAVAILABLE'
      err.status = 503
      err.retryable = true
      throw err
    }
    return { role: 'assistant', content: 'ok' }
  },
})
ai.registerConnection('retry-test', {
  auth: { type: 'none' },
  transport: { type: 'retry-test' },
  retryPolicy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 },
  configDefaults: {},
})

const reply = await ai.sendViaConnection('retry-test', { runId: 'retry-run', messages: [] }, {})
assert.equal(reply.content, 'ok')
assert.equal(attempts, 3)
assert.equal(ai.connectionHealthState('retry-test').state, 'healthy')
assert.equal(ai.connectionHealthState('retry-test').consecutiveFailures, 0)
assert.equal(ai.trace.list('retry-run').filter(function (event) { return event.type === 'provider_retry' }).length, 2)

ai.registerTransport('rate-limit-test', {
  toolProtocol: 'none',
  send: function () {
    const err = new Error('rate limited')
    err.code = 'PROVIDER_RATE_LIMITED'
    err.status = 429
    err.retryable = true
    err.retryAfterMs = 0
    throw err
  },
})
ai.registerConnection('rate-limit-test', {
  auth: { type: 'none' },
  transport: { type: 'rate-limit-test' },
  retryPolicy: { maxAttempts: 1 },
  configDefaults: {},
})
await assert.rejects(ai.sendViaConnection('rate-limit-test', { messages: [] }, {}), function (err) { return err.code === 'PROVIDER_RATE_LIMITED' })
assert.equal(ai.connectionHealthState('rate-limit-test').state, 'rate_limited')
assert.equal(ai.connectionHealthState('rate-limit-test').lastError.status, 429)

ai.registerTransport('stream-health-test', {
  toolProtocol: 'none',
  send: function () {
    return { deltas: (async function* () {
      yield { text: 'partial' }
      const err = new Error('stream lost')
      err.code = 'PROVIDER_NETWORK_ERROR'
      throw err
    })() }
  },
})
ai.registerConnection('stream-health-test', {
  auth: { type: 'none' },
  transport: { type: 'stream-health-test' },
  configDefaults: {},
})
const stream = await ai.sendViaConnection('stream-health-test', { messages: [] }, {})
await assert.rejects(async function () { for await (const _ of stream.deltas) {} })
assert.equal(ai.connectionHealthState('stream-health-test').state, 'offline')

const controller = new AbortController()
controller.abort()
await assert.rejects(ai.sendViaConnection('retry-test', { messages: [] }, { signal: controller.signal }), function (err) { return err.name === 'AbortError' })

console.log('ai provider reliability tests ok')

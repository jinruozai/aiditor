// aiditor.ai lightweight deterministic evaluation runner.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  function run(spec) {
    spec = spec || {}
    if (typeof spec.execute !== 'function') return Promise.reject(new Error('Eval execute function is required'))
    const cases = Array.isArray(spec.cases) ? spec.cases : []
    const evaluators = normalizeEvaluators(spec.evaluators || [])
    const startedAt = Date.now()
    const results = []
    let chain = Promise.resolve()
    for (let i = 0; i < cases.length; i++) {
      chain = chain.then(function () { return runCase(cases[i], i, spec, evaluators) }).then(function (result) { results.push(result) })
    }
    return chain.then(function () {
      const completedAt = Date.now()
      const passed = results.filter(function (item) { return item.pass === true }).length
      const failed = results.filter(function (item) { return item.pass === false }).length
      const errors = results.filter(function (item) { return !!item.error }).length
      return {
        id: spec.id || ('eval_' + startedAt.toString(36)),
        startedAt: startedAt,
        completedAt: completedAt,
        durationMs: completedAt - startedAt,
        summary: { total: results.length, passed: passed, failed: failed, errors: errors },
        cases: results,
      }
    })
  }

  function runCase(testCase, index, spec, evaluators) {
    const startedAt = Date.now()
    let traceId = null
    const ctx = {
      case: testCase,
      index: index,
      trace: function (id) { traceId = id || null; return traceId },
    }
    let output = null
    let error = null
    return Promise.resolve().then(function () {
      return spec.execute(testCase, ctx)
    }).then(function (value) {
      output = value
    }, function (err) {
      error = err
    }).then(function () {
      const completedAt = Date.now()
      const traceEvents = traceId && ai.trace ? ai.trace.list(traceId) : []
      const evalCtx = {
        case: testCase,
        index: index,
        input: testCase && testCase.input,
        expected: testCase && testCase.expected,
        output: output,
        error: error,
        durationMs: completedAt - startedAt,
        traceId: traceId,
        traceEvents: traceEvents,
      }
      return evaluateAll(evaluators, evalCtx).then(function (scores) {
        const determinate = scores.filter(function (score) { return score.pass != null })
        return {
          id: testCase && testCase.id || ('case_' + String(index + 1)),
          input: testCase && testCase.input,
          expected: testCase && testCase.expected,
          output: output,
          error: error ? errorSummary(error) : null,
          startedAt: startedAt,
          completedAt: completedAt,
          durationMs: completedAt - startedAt,
          traceId: traceId,
          scores: scores,
          pass: determinate.length ? determinate.every(function (score) { return score.pass === true }) : !error,
        }
      })
    })
  }

  function evaluateAll(evaluators, ctx) {
    const out = []
    let chain = Promise.resolve()
    for (let i = 0; i < evaluators.length; i++) {
      chain = chain.then(function () {
        const evaluator = evaluators[i]
        return Promise.resolve().then(function () { return evaluator.evaluate(ctx) }).then(function (value) {
          out.push(normalizeScore(evaluator.id, value))
        }, function (err) {
          out.push({ id: evaluator.id, pass: false, score: null, reason: String(err && err.message || err), error: errorSummary(err) })
        })
      })
    }
    return chain.then(function () { return out })
  }

  function normalizeEvaluators(list) {
    return list.map(function (item, index) {
      if (typeof item === 'function') return { id: item.id || item.name || ('evaluator_' + String(index + 1)), evaluate: item }
      if (!item || typeof item.evaluate !== 'function') throw new Error('Invalid evaluator at index ' + index)
      return { id: item.id || ('evaluator_' + String(index + 1)), evaluate: item.evaluate }
    })
  }

  function normalizeScore(id, value) {
    if (typeof value === 'boolean') return { id: id, pass: value, score: value ? 1 : 0, reason: '' }
    if (typeof value === 'number') return { id: id, pass: null, score: value, reason: '' }
    value = value || {}
    return {
      id: id,
      pass: value.pass == null ? null : !!value.pass,
      score: value.score == null ? null : value.score,
      reason: value.reason || '',
      metrics: value.metrics || null,
    }
  }

  function deepEqual(a, b) {
    if (a === b) return true
    if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
      return true
    }
    const aKeys = Object.keys(a).sort()
    const bKeys = Object.keys(b).sort()
    if (aKeys.length !== bKeys.length) return false
    for (let j = 0; j < aKeys.length; j++) {
      if (aKeys[j] !== bKeys[j] || !deepEqual(a[aKeys[j]], b[bKeys[j]])) return false
    }
    return true
  }

  function errorSummary(err) {
    return { code: err && err.code || null, message: String(err && err.message || err) }
  }

  const evaluators = {
    noError: function () {
      return { id: 'no-error', evaluate: function (ctx) { return { pass: !ctx.error, reason: ctx.error ? String(ctx.error.message || ctx.error) : '' } } }
    },
    equalsExpected: function () {
      return { id: 'equals-expected', evaluate: function (ctx) { return { pass: deepEqual(ctx.output, ctx.expected), reason: 'Output must equal expected value' } } }
    },
    schema: function (schema) {
      return { id: 'schema', evaluate: function (ctx) {
        const result = ai.schema.validate(ctx.output, schema)
        return { pass: result.valid, reason: result.valid ? '' : result.errors[0].message, metrics: { errors: result.errors.length } }
      } }
    },
    maxDuration: function (ms) {
      return { id: 'max-duration', evaluate: function (ctx) { return { pass: ctx.durationMs <= ms, reason: 'Duration must be <= ' + ms + 'ms', metrics: { durationMs: ctx.durationMs } } } }
    },
    trace: function (id, predicate) {
      return { id: id || 'trace', evaluate: function (ctx) {
        const pass = ctx.traceEvents.some(function (event) { return predicate(event, ctx) })
        return { pass: pass, reason: pass ? '' : 'Expected trace event was not found' }
      } }
    },
  }

  ai.evals = { run: run, evaluators: evaluators }
})(window.aiditor = window.aiditor || {})

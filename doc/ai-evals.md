# AI Evals

`aiditor.ai.evals` is a small deterministic evaluation primitive for Agent
Runtime integrations. It runs cases, calls host-supplied execution code, applies
evaluators, and returns one report. It does not introduce a dataset registry,
LLM judge, dashboard, experiment database, or provider dependency.

## API

```js
const report = await aiditor.ai.evals.run({
  id: 'extract-title',
  cases: [
    { id: 'basic', input: 'Hello', expected: { title: 'Hello' } },
  ],
  execute(testCase, ctx) {
    const run = aiditor.ai.message.send(agentId, { content: testCase.input })
    ctx.trace(run.request.runId)
    return run.promise.then(message => message.output)
  },
  evaluators: [
    aiditor.ai.evals.evaluators.noError(),
    aiditor.ai.evals.evaluators.equalsExpected(),
    aiditor.ai.evals.evaluators.schema(outputSchema),
    aiditor.ai.evals.evaluators.maxDuration(5000),
  ],
})
```

Cases run sequentially. This keeps local resource use and trace association
predictable; a host that needs distributed or high-volume evaluation should own
that orchestration outside the browser runtime.

`ctx.trace(traceId)` associates existing compact runtime trace events with the
case. Evaluators receive:

```text
case / input / expected
output / error
durationMs
traceId / traceEvents
```

An evaluator is either a function or `{ id, evaluate(ctx) }`. It may return a
boolean, number, or `{ pass, score, reason, metrics }`. Evaluator exceptions are
captured as failed scores and do not abort later cases.

Built-ins are deterministic:

```text
noError()
equalsExpected()
schema(schema)
maxDuration(ms)
trace(id, predicate)
```

Eval reports are returned to the caller and are not persisted automatically.
The host decides whether a report belongs in tests, logs, CI, or a product UI.

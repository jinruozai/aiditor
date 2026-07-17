# AI Agent-Computer Interface

ACI is the interface shape that lets an agent inspect, edit, verify, and recover
inside a bounded workspace.

AIditor does not copy a full coding-agent platform. The framework provides a
small set of model-friendly primitives that fit the existing workspace,
permission, trace, and tool lifecycle contracts.

## Design Rules

1. The workspace is bounded. Agents never receive host paths or raw handles.
2. Structure comes before bulk. Use summaries and maps before full reads.
3. Exact reads precede mutation. Use line ranges and current hashes before
   editing.
4. Mutation remains preview/apply capable. Writes must not bypass workspace
   version checks.
5. Verification is a host adapter, not a project concept in Core.
6. Trace records what happened; it does not become another model-facing system.

## Current Primitives

```text
workspace.fileSummary     bounded file tree summary
workspace.searchFiles     literal/regex search with line previews
workspace.readTextRange   exact line range read
workspace.editText        CAS oldText/newText precise edit
workspace.patchText       CAS line patch edit
workspace.writeText       whole-file write for new or deliberate replacement
code.outline              one-file structural outline
code.map                  compact workspace code map, optionally ranked by query
verify.*                  optional host-provided checks and diagnostics
```

## Code Map

`code.map` is the lightweight repo-map primitive. It scans code-like files under
one workspace path, extracts compact file outlines, and optionally ranks them
against a query.

```js
aiditor.ai.tools.get('code.map').run({
  path: 'src',
  query: 'registerComponent dock panel',
  maxFiles: 120,
  maxResults: 20,
})
```

Returned files include:

```text
path
hash
size
lines
symbols[]     functions/classes/bindings/methods with lines
calls[]       compact call names with lines
events[]      event/registry/bus/cleanup lines
match         score and reasons when query is provided
```

This is intentionally not semantic vector search and not a long-lived index. It
is a deterministic, zero-dependency context map that helps the model choose
which exact ranges to read next.

## Non-goals

- No project, game, asset, scene, or domain model.
- No server requirement.
- No vector database.
- No hidden workspace mutation.
- No replacement for host verification or project history.

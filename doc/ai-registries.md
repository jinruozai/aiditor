# AI Contributions and Owners

AIditor AI Host has four contribution registries:

| registry | owns | does not own |
| --- | --- | --- |
| `aiditor.ai.skills` | intent, instructions, Tool ids, discovery metadata | execution or permission |
| `aiditor.ai.tools` | executable schemas and lifecycle | Agent capability selection |
| `aiditor.ai.context` | request-time factual snapshots | Tool authorization |
| `aiditor.ai.references` / `operations` | semantic resource and mutation contracts | Skill discovery |

`src/ai/contribution-registry.js` provides the shared exact-owner lifecycle for
Skill, Tool, and Context. Reference and Operation apply the same contract.

## Owner contract

Every contribution registration requires metadata with `owner`:

```js
const meta = { owner: 'extension:sample', layer: 'extension' }

aiditor.ai.tools.register('sample.read', tool, meta)
aiditor.ai.skills.register('sample.authoring', skill, meta)
aiditor.ai.context.register('sample.selection', provider, meta)
aiditor.ai.references.register('sample', provider, meta)
aiditor.ai.operations.register('sample.setValue', operation, meta)
```

Owner answers one question: **which contributions must be unloaded together?**

Recommended shapes:

- framework: `aiditor.ai.<subsystem>`
- extension: `extension:<id>`
- project: `project:<id>`
- workspace generation: `workspace:<id>@<generation>`
- standalone package: `skill-package:<id>`

Names answer discovery and identity. Layers answer precedence/policy. Neither
is a lifecycle boundary.

Registration rejects duplicates. `{ replace: true }` may replace only a record
owned by the same Owner. Single-record unregister also requires that Owner.

```js
aiditor.ai.tools.unregister('sample.read', { owner: 'extension:sample' })
aiditor.ai.tools.unregisterOwner('extension:sample')
```

Prefix matching remains available on `list(prefix)` for discovery. Prefix
unregister is intentionally absent.

## Registry APIs

All contribution registries provide:

```text
register(name, value, meta)
unregister(name, { owner })
unregisterOwner(owner)
get(name)
list(filter?)
meta(name)
```

Tool additionally provides:

```text
visible(name, requestContext, selectedBySkill?)
visibleList(names, requestContext, selectedBySkill?)
schema(name, requestContext)
capabilities(name)
```

Skill additionally provides:

```text
availability(name, requestContext)
catalog(requestContext, { query?, limit? })
loadPackage(input, meta)
readResource(skillId, path)
```

## Removed concepts

AI `agentTemplates` and AI `bundles` were unused parallel packaging concepts.
Extension Runtime is the package/lifecycle owner, and project code can create
Agent specs directly, so those registries do not exist. Agent profiles also do
not contain direct Tool ids.

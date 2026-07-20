# Extensions

## Purpose

An extension packages things AIditor already knows how to register.

```text
extension
+-- components
+-- dock panels
+-- tools
+-- context providers
+-- reference providers
+-- operations
+-- settings
+-- commands
`-- menus
```

Extension Runtime is not a separate programming model. It is a delivery,
review, trust, and lifecycle layer around existing registries.

The main model is only:

```text
manifest -> contributes -> publish dotted names -> unregister by owner
```

Everything else in the extension runtime is a safeguard around that model, not a
new extension kind.

Preview and review validate the same names install would register. Component,
tool, context, reference, operation, command, and menu conflicts should be
reported before any registry is mutated.

## Manifest Shape

```js
{
  id: 'sample',
  title: 'Sample Tools',
  trust: {
    code: 'none' // none | trusted | sandbox
  },
  contributes: {
    components: [
      { id: 'panel', /* component spec or adapter reference */ }
    ],
    dockPanels: [
      { dock: 'main', component: 'panel', title: 'Sample' }
    ],
    tools: [
      {
        id: 'makeThing',
        adapter: 'sample.adapter',
        permissions: ['tool.call', 'tool.apply'],
        risk: 'write',
        visibleToModel: true
      }
    ],
    skills: [
      {
        id: 'authoring',
        description: 'Guide an Agent through this extension workflow.',
        systemPrompt: 'Use the extension tools through their registered ids.',
        tools: ['makeThing']
      }
    ],
    context: [
      { id: 'schema', adapter: 'sample.adapter' }
    ],
    references: [
      { id: 'data', adapter: 'sample.adapter' }
    ],
    operations: [
      { id: 'patchThing', adapter: 'sample.adapter' }
    ],
    settings: [
      { section: { id: 'sample', title: 'Sample' }, schema: { key: 'sample.display' } }
    ],
    commands: [
      { id: 'refresh', adapter: 'sample.adapter' }
    ],
    menus: [
      { id: 'refreshMenu', target: 'global', command: 'refresh' }
    ]
  }
}
```

Contribution ids are local by default. AIditor publishes them with the extension
id as a dotted prefix:

```text
panel     -> sample.panel
makeThing -> sample.makeThing
```

An id may already include the prefix, but public names must stay under that
dotted prefix.

The dotted name is the public namespace. The lifecycle owner is separate:
every installed contribution is tagged with `owner: "extension:<id>"`. This
keeps uninstall exact even when extension ids share prefixes, such as `sample`
and `sample.child`.

## Install

Install registers each contribution with the normal registry:

```js
aiditor.registerComponent('sample.panel', spec)
aiditor.ai.references.register('sample.data', spec)
aiditor.ai.tools.register('sample.makeThing', spec)
aiditor.ai.context.register('sample.schema', spec)
aiditor.ai.operations.register('sample.patchThing', spec)
aiditor.settings.registerSchema('sample', spec)
aiditor.commands.register('sample.refresh', spec)
aiditor.commands.registerMenu('sample.refreshMenu', spec)
```

Dock panel contributions are not a new registry. They add panel records that
reference already registered component names.

Commands are UI/human actions for menus, buttons, command palettes, shortcuts,
and context menus. Tools are AI/model actions with schemas, permissions,
tool-call state, and model-visible results. Extensions may contribute both when
the same feature should be available to both humans and agents.

Implemented extension APIs currently include:

```js
aiditor.extensions.preview(input)
aiditor.extensions.review(input)
aiditor.extensions.install(manifest, options)
aiditor.extensions.installWithReview(input, options)
aiditor.extensions.update(id, manifest, options)
aiditor.extensions.uninstall(id, options)
aiditor.extensions.enable(id)
aiditor.extensions.disable(id)
aiditor.extensions.list()
aiditor.extensions.get(id)
aiditor.extensions.ownerFor(name)
aiditor.extensions.hashSource(source)
aiditor.extensions.permissions(manifest)
```

## Uninstall

Uninstall removes by owner:

```js
aiditor.ai.tools.unregisterOwner('extension:sample')
aiditor.ai.skills.unregisterOwner('extension:sample')
aiditor.ai.context.unregisterOwner('extension:sample')
aiditor.ai.references.unregisterOwner('extension:sample')
aiditor.ai.operations.unregisterOwner('extension:sample')
aiditor.settings.unregisterOwner('extension:sample')
aiditor.commands.unregisterOwner('extension:sample')
aiditor.unregisterComponentOwner('extension:sample')
```

The same dotted path model is still used everywhere for public names,
diagnostics, recovery UI, and permission targets. Owner metadata is the
lifecycle model; prefix cleanup exists only as a low-level registry helper.

## Trust Tiers

Extension contributions are reviewed by trust tier:

| Tier | Meaning | Default |
| --- | --- | --- |
| data-only | Manifest data, settings schema, menu records, dock panel records, and declarative component references allowed by host policy. | Allowed after manifest validation. |
| trusted same-window code | Component/tool/context/operation code runs in the host page. | Requires explicit trusted install. |
| sandbox iframe | UI runs in an iframe and talks through postMessage capability tokens. | Requires host iframe adapter. |
| host-adapter tool | Calls privileged local/remote adapter code. | Requires adapter contract and permission policy. |

The default extension path is data-only. Code execution is never implied by
installing a manifest. Tool contributions must declare permission intent, risk,
origin, and model visibility so the AI permission resolver can make the final
decision.

## Dynamic UI

AI-created panels use the same component model as handwritten panels:

```text
write component file -> register component -> add panel by component name
```

Agent authoring should not send panel source through extension tools. Workspace
files are the source of truth; dock panel data only references registered
component names. Host apps may provide file loaders that scan a workspace and
register components, but that loader belongs to the host app, not to Core/UI.

## Runtime Safeguards

The extension runtime may also expose safety and recovery helpers:

```js
aiditor.extensions.safeMode(enabled, options)
aiditor.extensions.setLayer(id, layer)
aiditor.extensions.setMaxLayer(layer)
aiditor.extensions.enableLayer(layer)
aiditor.extensions.removePanelFromDock(panelId)
aiditor.extensions.previewAddPanelToDock(input)
aiditor.extensions.applyAddPanelToDock(preview)
aiditor.extensions.disableLayer(layer)
aiditor.extensions.configurePermissions(policy)
aiditor.extensions.configureStorage(options)
aiditor.extensions.boot(options)
aiditor.extensions.save()
aiditor.extensions.clearStored()
```

These are operational safeguards around the same contribution model. They are
not extra extension kinds and should stay secondary in docs, UI, and prompts.

Advanced host hooks:

```js
aiditor.extensions.registerLayout(name, handle)
aiditor.extensions.registerAdapter(id, spec)
```

Use them only when normal registries cannot express the integration. The
default path for visible UI remains: register a component, then add panel data
to a dock.

## Recovery

Extensions may be disabled by id. This keeps recovery simple:

```js
aiditor.extensions.disable('sample')
```

Internally that means the runtime deactivates the `extension:sample` owner,
replaces open contributed panels with recovery placeholders, and removes only
that owner's registry entries.

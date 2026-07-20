// Built-in AI skills for AIditor.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  if (!ai.skills || !ai.skills.register) return
  const BUILTIN_META = { owner: 'aiditor.skills', layer: 'builtin', source: 'builtin' }

  const COMMON_RULES = [
    'Write AIditor UI as plain .js scripts. Do not create .tsx, .jsx, TypeScript annotations, import/export statements, React hooks, or framework-specific component syntax in zero-build AIditor code.',
    'The UI authoring model is a registered component: spec.defaults() returns title/icon/props, and spec.factory(propsSig, ctx) returns one HTMLElement root.',
    'propsSig is a signal function. Read props with propsSig.peek() for one-shot reads, or with propsSig() inside aiditor.effect. Do not use propsSig.get() or propsSig.on().',
    'Panel roots must fit resizable docks: height:100%, minHeight:0, boxSizing:border-box, and flex/grid layouts that adapt to narrow and wide dock sizes.',
    'Prefer aiditor.ui.* controls over hand-built controls when the UI layer has a suitable component. Use aiditor.ui.view for primary scroll surfaces.',
    'For schema-driven local fields, use aiditor.ui.propertyForm. For generic selection properties shared across panels, register an inspector provider and select targets with aiditor.inspector.select.',
    'When an API shape is unclear, search generated API references first: aiditor.searchReferences({ query: "api", limit: 50 }) and aiditor.readReference({ uri: "aiditor://api" }).',
  ]

  const RUNTIME_RULES = COMMON_RULES.concat([
    'Use this skill when running inside an AIditor host and the user wants UI created, mounted, or replaced in the current live editor.',
    'Durable live UI is file-backed: inspect workspace files, edit/write component files, inspect docks, then call aiditor.addPanelToDock with component name, returned dock id, and path when the component file was just written.',
    'After editing the file for an already-mounted panel, call aiditor.reloadPanel with panelId and path. Do not use replacePanel to refresh the same component.',
    'To replace one existing panel, call aiditor.replacePanel with the returned panelId and the same component/path/title/icon/props shape. It keeps the dock position and returns a fresh panel id.',
    'Do not pass source code inside panel or dock tool arguments. Do not hand-write layout JSON for live placement. Do not guess dock names.',
    'If no writable workspace is available for a durable UI request, tell the user to open or select a workspace first instead of looking for a workaround.',
  ])

  const LIBRARY_RULES = COMMON_RULES.concat([
    'Use this skill when coding an AIditor-based repository or host app directly, outside the live editor agent runtime.',
    'Standalone AIditor code registers with aiditor.registerComponent(name, spec). Host applications may provide their own wrapper; use exactly one registration path for a file.',
    'Load the smallest bundle the host needs: aiditor-kernel for dock runtime, aiditor-ui for widgets, aiditor-ai for AI Host/Extension Runtime, aiditor-core for Kernel+UI, and aiditor-full for everything.',
    'App menus, save/open behavior, app shortcuts, project formats, provider transports, and privileged filesystem bridges belong to the host app, not framework core.',
    'After changing AIditor src/ in this repo, rebuild with node tools/build.mjs and run checks before handing off.',
  ])

  ai.skills.register('aiditor.runtime-authoring', {
    title: 'AIditor Runtime Authoring',
    description: 'Create, edit, load, mount, or replace workspace-backed AIditor panels in the current live editor.',
    whenToUse: 'Use when the agent is running inside an AIditor host and the user asks for UI to appear in current docks.',
    whenNotToUse: 'Do not use for standalone repository or host-app implementation work outside the live editor runtime.',
    relatedApis: ['aiditor.inspectDocks', 'aiditor.addPanelToDock', 'aiditor.reloadPanel', 'aiditor.replacePanel', 'aiditor.registerComponent', 'aiditor.runtime.loadScript'],
    tools: ['workspace.fileSummary', 'workspace.searchFiles', 'workspace.readTextRange', 'workspace.writeText', 'workspace.editText', 'code.map', 'verify.run', 'aiditor.searchReferences', 'aiditor.readReference', 'aiditor.inspectDocks', 'aiditor.addPanelToDock', 'aiditor.reloadPanel', 'aiditor.replacePanel'],
    docPath: 'doc/skill/aiditor-runtime-authoring/SKILL.md',
    systemPrompt: 'You are running inside an AIditor host. Create durable UI by writing plain JavaScript workspace component files, then mount or replace registered components in live docks through AIditor tools.',
    rules: RUNTIME_RULES,
  }, BUILTIN_META)

  ai.skills.register('aiditor.library-authoring', {
    title: 'AIditor Library Authoring',
    description: 'Use AIditor as a zero-build JavaScript UI framework in a repository or host app.',
    whenToUse: 'Use when coding an AIditor-based project, host app, demo, layout, or component library outside the live editor agent runtime.',
    whenNotToUse: 'Do not use when the task is to place UI into the currently running editor dock; use aiditor.runtime-authoring instead.',
    relatedApis: ['aiditor.registerComponent', 'aiditor.ui.propertyForm', 'aiditor.inspector.registerProvider', 'aiditor.runtime.loadScript'],
    tools: ['workspace.fileSummary', 'workspace.searchFiles', 'workspace.readTextRange', 'workspace.editText', 'workspace.writeText', 'code.map', 'verify.run', 'aiditor.searchReferences', 'aiditor.readReference'],
    docPath: 'doc/skill/aiditor-library-authoring/SKILL.md',
    systemPrompt: 'Use AIditor as a zero-build, plain JavaScript editor UI library in a repository or host app. Author registered components and host integration code without React, TSX, JSX, import/export, or bundled-module assumptions.',
    rules: LIBRARY_RULES,
  }, BUILTIN_META)

  ai.skills.register('aiditor.authoring', {
    title: 'AIditor Authoring',
    description: 'Compatibility umbrella for AIditor authoring. Prefer the focused runtime or library authoring skills.',
    whenToUse: 'Use only for older agents or when a focused AIditor authoring skill is unavailable.',
    whenNotToUse: 'Prefer aiditor.runtime-authoring in live editor sessions and aiditor.library-authoring in repository work.',
    relatedApis: ['aiditor.registerComponent', 'aiditor.inspectDocks', 'aiditor.addPanelToDock'],
    tools: ['aiditor.inspectDocks', 'aiditor.addPanelToDock'],
    docPath: 'doc/skill/aiditor-authoring/SKILL.md',
    systemPrompt: 'Compatibility skill for AIditor authoring. Prefer aiditor.runtime-authoring inside the live editor, and aiditor.library-authoring when coding a host app or repository.',
    rules: [
      'Choose aiditor.runtime-authoring for live editor workspace edits and dock mounting.',
      'Choose aiditor.library-authoring for repository or host-app code that uses AIditor as a library.',
    ].concat(COMMON_RULES),
  }, BUILTIN_META)
})(window.aiditor = window.aiditor || {})

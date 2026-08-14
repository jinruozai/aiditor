// Built-in framework Skills for AIditor AI Host.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const META = { owner: 'aiditor.ai.skills', layer: 'builtin', source: 'builtin' }

  const READ_CODE = [
    'workspace.fileSummary', 'workspace.searchFiles', 'workspace.readText',
    'workspace.readTextRange', 'workspace.stat', 'code.map', 'code.outline',
    'aiditor.searchReferences', 'aiditor.readReference',
  ]
  const WRITE_CODE = READ_CODE.concat([
    'workspace.editText', 'workspace.writeText', 'workspace.patchText',
    'workspace.mkdir', 'workspace.copy', 'workspace.move', 'workspace.delete',
  ])
  const RUNTIME = WRITE_CODE.concat([
    'aiditor.inspectDocks', 'aiditor.addPanelToDock',
    'aiditor.reloadPanel', 'aiditor.replacePanel',
  ])
  const COMMON_RULES = [
    'Treat current workspace files and runtime inspection results as the source of truth.',
    'Use only Tools exposed by the active Skill. Activate another focused Skill when a distinct capability is required.',
    'A Skill grants discoverability and instructions, never permission. Respect Tool approval and host permission decisions.',
  ]
  const UI_RULES = COMMON_RULES.concat([
    'AIditor source is classic plain JavaScript: IIFE files, window.aiditor namespace, no import/export, JSX, TSX, or framework runtime.',
    'Registered components return one HTMLElement root and consume caller-owned signals. Core/UI must not own project data models.',
    'Keep panel roots responsive inside resizable docks and prefer aiditor.ui primitives over duplicate controls.',
    'Do not add application shortcuts, project formats, save semantics, or business workflow to framework Core/UI.',
  ])

  function workspaceAvailable(ctx) {
    return !!((ctx && ctx.workspace) || (ai.currentWorkspace && ai.currentWorkspace()))
  }

  function extensionsAvailable() { return !!aiditor.extensions }

  function register(id, spec) {
    ai.skills.register(id, spec, META)
  }

  register('aiditor.framework-authoring', {
    title: 'AIditor Framework Authoring',
    description: 'Develop AIditor Core, UI, Dock, themes, and ordinary host applications while preserving framework boundaries.',
    argumentHint: '[framework task]',
    whenToUse: 'Use for AIditor framework code, UI components, dock behavior, themes, inspector primitives, or a host app built on AIditor.',
    whenNotToUse: 'Do not use to mount a workspace component into the currently running editor; use aiditor.runtime-authoring.',
    available: workspaceAvailable,
    unavailableReason: 'Open the repository workspace first.',
    tools: WRITE_CODE,
    relatedApis: ['aiditor.registerComponent', 'aiditor.ui', 'aiditor.inspector', 'aiditor.createDockLayout'],
    docPath: 'doc/skill/aiditor-framework-authoring/SKILL.md',
    systemPrompt: 'Work as an AIditor framework engineer. Preserve the zero-dependency classic-script architecture and strict Core/UI/host ownership boundaries.',
    rules: UI_RULES.concat(['After changing src/, rebuild committed distributions and run the repository checks.']),
  })

  register('aiditor.runtime-authoring', {
    title: 'AIditor Runtime Authoring',
    description: 'Create, edit, load, mount, reload, or replace workspace-backed panels in the current live editor.',
    argumentHint: '[panel or UI task]',
    whenToUse: 'Use when the requested UI must appear in a current AIditor dock.',
    whenNotToUse: 'Do not use for framework/library development without live dock placement.',
    available: function (ctx) { return workspaceAvailable(ctx) && extensionsAvailable() },
    unavailableReason: 'Open a writable workspace in a live AIditor host first.',
    tools: RUNTIME,
    relatedApis: ['aiditor.inspectDocks', 'aiditor.addPanelToDock', 'aiditor.reloadPanel', 'aiditor.replacePanel'],
    docPath: 'doc/skill/aiditor-runtime-authoring/SKILL.md',
    systemPrompt: 'Create durable live UI as workspace-backed registered components, then place it through the dock runtime Tools.',
    rules: UI_RULES.concat([
      'Inspect real dock ids before placement; never guess layout JSON or dock names.',
      'Write component source to the workspace, then pass its path to addPanelToDock.',
      'Reload the same component with reloadPanel; use replacePanel only when changing the component identity.',
    ]),
  })

  register('aiditor.ai-host-authoring', {
    title: 'AIditor AI Host Authoring',
    description: 'Develop Agent, Skill, Tool, Context, provider, permission, request, runtime, and persistence integration.',
    argumentHint: '[AI Host task]',
    whenToUse: 'Use for AIditor AI Host architecture or host-side AI integration.',
    whenNotToUse: 'Do not use for ordinary UI work that does not touch AI Host.',
    available: workspaceAvailable,
    unavailableReason: 'Open the repository workspace first.',
    tools: WRITE_CODE,
    relatedApis: ['aiditor.ai.skills', 'aiditor.ai.tools', 'aiditor.ai.context', 'aiditor.ai.permission'],
    docPath: 'doc/skill/aiditor-ai-host-authoring/SKILL.md',
    systemPrompt: 'Preserve Skill-first capability discovery, internal Tool execution, factual Context, exact Owner lifecycle, and centralized Permission enforcement.',
    rules: COMMON_RULES.concat([
      'Agent capability selection is Skill-only. Do not add direct Agent Tool lists or Context-provided Tool authorization.',
      'Tools are executable protocol endpoints; Skills are the model and project capability surface.',
      'Owner identifies one unload boundary. Dotted names identify contributions and never substitute for ownership.',
    ]),
  })

  register('aiditor.extension-authoring', {
    title: 'AIditor Extension Authoring',
    description: 'Build and maintain AIditor Extension manifests and contribution installers.',
    argumentHint: '[extension task]',
    whenToUse: 'Use when implementing an Extension package or contribution lifecycle.',
    whenNotToUse: 'Do not use merely to enable, disable, or inspect installed Extensions.',
    available: workspaceAvailable,
    unavailableReason: 'Open the Extension source workspace first.',
    tools: WRITE_CODE,
    relatedApis: ['aiditor.extensions', 'aiditor.runtime.withOwner'],
    docPath: 'doc/skill/aiditor-extension-authoring/SKILL.md',
    systemPrompt: 'Implement Extensions as owner-scoped contributions installed into existing framework registries, never as duplicate component or AI systems.',
    rules: UI_RULES.concat([
      'An Extension is a packaging and lifecycle boundary, not a second Registry model.',
      'Install every contribution with owner extension:<id> and unload only through that exact Owner.',
    ]),
  })

  register('aiditor.editor-control', {
    title: 'AIditor Editor Control',
    description: 'Inspect current editor selection and references, then preview or apply host-provided semantic operations.',
    argumentHint: '[editor action]',
    whenToUse: 'Use when acting on the current editor state through host Reference and Operation contracts.',
    whenNotToUse: 'Do not use for direct repository file editing.',
    tools: ['aiditor.getSelection', 'aiditor.getCapabilities', 'aiditor.searchReferences', 'aiditor.readReference', 'aiditor.previewOperation', 'aiditor.applyOperation'],
    relatedApis: ['aiditor.ai.references', 'aiditor.ai.operations', 'aiditor.ai.targets'],
    docPath: 'doc/skill/aiditor-editor-control/SKILL.md',
    systemPrompt: 'Read current semantic state before changes, use canonical host Operations, and preserve preview/apply plus permission boundaries.',
    rules: COMMON_RULES.concat(['Re-read mutable state before applying a change and never infer business semantics from DOM structure.']),
  })

  register('aiditor.workspace-authoring', {
    title: 'AIditor Workspace Authoring',
    description: 'Inspect, search, read, edit, create, move, or delete files through the bounded workspace contract.',
    argumentHint: '[workspace task]',
    whenToUse: 'Use for generic code and file work in the current workspace.',
    whenNotToUse: 'Do not use when no workspace is open or when a semantic editor Operation is more precise.',
    available: workspaceAvailable,
    unavailableReason: 'No workspace is currently open.',
    tools: ['workspace.listFiles', 'workspace.capabilities'].concat(WRITE_CODE),
    relatedApis: ['aiditor.workspace', 'aiditor.ai.configureWorkspace'],
    docPath: 'doc/skill/aiditor-workspace-authoring/SKILL.md',
    systemPrompt: 'Use the bounded workspace contract for precise file work. Read current content and stable hashes before editing.',
    rules: COMMON_RULES.concat(['Prefer exact range/edit operations for existing files and whole-file writes only for new or deliberate replacements.']),
  })

  register('aiditor.verify-changes', {
    title: 'AIditor Verify Changes',
    description: 'Discover and run host-provided tests, lint, type checks, health checks, and diagnostics.',
    argumentHint: '[check or path]',
    whenToUse: 'Use after implementation or when diagnosing a failing project check.',
    whenNotToUse: 'Do not claim verification when the host provides no Verify adapter.',
    available: function () { return !!(ai.currentVerify && ai.currentVerify()) },
    unavailableReason: 'The host has not configured a Verify adapter.',
    tools: ['verify.list', 'verify.run', 'verify.diagnostics'],
    relatedApis: ['aiditor.ai.configureVerify'],
    docPath: 'doc/skill/aiditor-verify-changes/SKILL.md',
    systemPrompt: 'Run the narrowest relevant checks, inspect diagnostics, and report exactly what was verified.',
    rules: COMMON_RULES,
  })

  register('aiditor.version-control', {
    title: 'AIditor Version Control',
    description: 'Inspect and modify repository state through the host-provided Git adapter.',
    argumentHint: '[Git task]',
    whenToUse: 'Use for status, diff, log, stage, restore, or commit requests.',
    whenNotToUse: 'Do not use when the host has no Git adapter or when only workspace file edits are requested.',
    available: function () { return !!(ai.currentGit && ai.currentGit()) },
    unavailableReason: 'The host has not configured a Git adapter.',
    tools: ['git.status', 'git.diff', 'git.diffFile', 'git.log', 'git.show', 'git.stage', 'git.restoreFile', 'git.commit'],
    relatedApis: ['aiditor.ai.configureGit'],
    docPath: 'doc/skill/aiditor-version-control/SKILL.md',
    systemPrompt: 'Use the host Git adapter, inspect state before mutation, and preserve explicit review and approval boundaries.',
    rules: COMMON_RULES,
  })

  register('aiditor.extension-management', {
    title: 'AIditor Extension Management',
    description: 'Inspect, install, update, enable, disable, remove, or change the layer of installed Extensions.',
    argumentHint: '[extension action]',
    whenToUse: 'Use for Extension lifecycle administration in a running AIditor host.',
    whenNotToUse: 'Do not use to author Extension source code.',
    available: extensionsAvailable,
    unavailableReason: 'The Extension Runtime is not loaded.',
    tools: ['aiditor.inspectExtensions', 'aiditor.installExtension', 'aiditor.updateExtension', 'aiditor.enableExtension', 'aiditor.disableExtension', 'aiditor.removeExtension', 'aiditor.promoteExtensionLayer'],
    relatedApis: ['aiditor.extensions'],
    docPath: 'doc/skill/aiditor-extension-management/SKILL.md',
    systemPrompt: 'Manage Extension lifecycle through reviewed, owner-scoped runtime actions.',
    rules: COMMON_RULES,
  })

  register('aiditor.agent-orchestration', {
    title: 'AIditor Agent Orchestration',
    description: 'Create, configure, delegate to, communicate with, and close child Agent quests.',
    argumentHint: '[delegation task]',
    whenToUse: 'Use when work should be delegated to focused child Agents or existing quests must be managed.',
    whenNotToUse: 'Do not create children for trivial work or use Agent controls as an application workflow engine.',
    tools: ['agent.read', 'agent.create', 'agent.configure', 'agent.delegate', 'agent.reparent', 'agent.delete', 'agent.send', 'quest.read', 'quest.result', 'quest.cancel', 'message.read', 'agent.stop'],
    relatedApis: ['aiditor.ai.createAgent', 'aiditor.ai.delegate', 'aiditor.ai.readQuest'],
    docPath: 'doc/skill/aiditor-agent-orchestration/SKILL.md',
    systemPrompt: 'Delegate bounded work with focused Skill ids, track quests precisely, and respect Agent ancestry and budgets.',
    rules: COMMON_RULES.concat(['Child capabilities are selected only with skillRefs; never pass raw Tool ids.']),
  })
})(window.aiditor = window.aiditor || {})

// Built-in AIditor Skills. Skills organize disclosure; Tool execution remains independent.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const META = { owner: 'aiditor.ai.skills', layer: 'builtin', source: 'builtin' }

  const READ_CODE = [
    'workspace.fileSummary', 'workspace.searchFiles', 'workspace.readText',
    'workspace.readTextRange', 'workspace.stat', 'code.map', 'code.outline',
  ]
  const WRITE_CODE = READ_CODE.concat([
    'workspace.editText', 'workspace.writeText', 'workspace.patchText',
    'workspace.mkdir', 'workspace.copy', 'workspace.move', 'workspace.delete',
  ])
  const RUNTIME = [
    'aiditor.inspectDocks', 'aiditor.addPanelToDock',
    'aiditor.reloadPanel', 'aiditor.replacePanel',
  ]
  const UI_INSTRUCTIONS = [
    'AIditor source uses classic JavaScript IIFEs and the window.aiditor namespace; do not add import/export, JSX, TSX, or a framework runtime.',
    'Registered components return one HTMLElement root and consume caller-owned signals. Core/UI must not own project data models.',
    'Keep panel roots responsive inside resizable docks and prefer aiditor.ui primitives over duplicate controls.',
    'Do not add application shortcuts, project formats, save semantics, or business workflow to framework Core/UI.',
  ]

  function register(id, title, description, instructions, tools, argumentHint, toolDisclosure) {
    ai.skills.register(id, {
      title: title,
      description: description,
      argumentHint: argumentHint || '',
      instructions: instructions.join('\n'),
      toolDisclosure: toolDisclosure || 'onRead',
      tools: tools,
    }, META)
  }

  register(
    'aiditor.framework-authoring',
    'AIditor Framework Authoring',
    'Develop AIditor Core, UI, Dock, themes, and ordinary host applications while preserving framework boundaries.',
    ['Use for AIditor framework code, UI components, dock behavior, themes, inspector primitives, or host applications.']
      .concat(UI_INSTRUCTIONS)
      .concat([
        'Read aiditor.workspace-authoring before changing workspace files.',
        'After changing src/, rebuild committed distributions and run the repository checks.',
      ]),
    [],
    '[framework task]',
    'onRead'
  )

  register(
    'aiditor.runtime-authoring',
    'AIditor Runtime Authoring',
    'Create, edit, load, mount, reload, or replace workspace-backed panels in the current live editor.',
    ['Use when requested UI must appear in a current AIditor dock.']
      .concat(UI_INSTRUCTIONS)
      .concat([
        'Inspect real dock ids before placement; never guess layout JSON or dock names.',
        'Write component source to the workspace, then pass its path to addPanelToDock.',
        'Reload the same component with reloadPanel; use replacePanel only when changing component identity.',
      ]),
    RUNTIME,
    '[panel or UI task]',
    'onRead'
  )

  register(
    'aiditor.ai-host-authoring',
    'AIditor AI Host Authoring',
    'Develop Agent, Skill, Tool, Context, provider, permission, request, runtime, and persistence integration.',
    [
      'Keep Agent, Skill, Tool, Context, Operation, ChangeSet, provider, and permission ownership explicit.',
      'Skills are readable instructions and Tool organization only; they never activate, authorize, or unlock Tools.',
      'Registered Tools are model-callable execution endpoints. Context and References provide facts, never authorization.',
      'Owner identifies one unload boundary. Dotted names identify contributions and never substitute for ownership.',
      'Read aiditor.workspace-authoring before changing workspace files.',
    ],
    [],
    '[AI Host task]',
    'onRead'
  )

  register(
    'aiditor.extension-authoring',
    'AIditor Extension Authoring',
    'Build and maintain AIditor Extension manifests and contribution installers.',
    ['Extensions are packaging and lifecycle boundaries, not duplicate Registry or AI systems.']
      .concat(UI_INSTRUCTIONS)
      .concat([
        'Read aiditor.workspace-authoring before changing workspace files.',
        'Install every contribution with owner extension:<id> and unload only through that exact Owner.',
      ]),
    [],
    '[extension task]',
    'onRead'
  )

  register(
    'aiditor.editor-control',
    'AIditor Editor Control',
    'Inspect current editor selection and references, then preview or apply host-provided semantic operations.',
    [
      'Read current semantic state before changes and use canonical host Operations.',
      'Preserve preview/apply and permission boundaries.',
      'Re-read mutable state before applying a change and never infer business semantics from DOM structure.',
    ],
    ['aiditor.getSelection', 'aiditor.getCapabilities', 'aiditor.searchReferences', 'aiditor.readReference', 'aiditor.previewOperation', 'aiditor.applyOperation'],
    '[editor action]',
    'always'
  )

  register(
    'aiditor.workspace-authoring',
    'AIditor Workspace Authoring',
    'Inspect, search, read, edit, create, move, or delete files through the bounded workspace contract.',
    [
      'Use workspace files as the source of truth and read current content plus stable hashes before editing.',
      'Prefer exact range/edit operations for existing files and whole-file writes only for new or deliberate replacements.',
    ],
    ['workspace.listFiles', 'workspace.capabilities'].concat(WRITE_CODE),
    '[workspace task]',
    'onRead'
  )

  register(
    'aiditor.verify-changes',
    'AIditor Verify Changes',
    'Discover and run host-provided tests, lint, type checks, health checks, and diagnostics.',
    ['Run the narrowest relevant checks, inspect diagnostics, and report exactly what was verified.'],
    ['verify.list', 'verify.run', 'verify.diagnostics'],
    '[check or path]',
    'onRead'
  )

  register(
    'aiditor.version-control',
    'AIditor Version Control',
    'Inspect and modify repository state through the host-provided Git adapter.',
    ['Inspect repository state before mutation and preserve explicit review and approval boundaries.'],
    ['git.status', 'git.diff', 'git.diffFile', 'git.log', 'git.show', 'git.stage', 'git.restoreFile', 'git.commit'],
    '[Git task]',
    'onRead'
  )

  register(
    'aiditor.extension-management',
    'AIditor Extension Management',
    'Inspect, install, update, enable, disable, remove, or change the layer of installed Extensions.',
    ['Manage Extension lifecycle through reviewed, owner-scoped runtime actions.'],
    ['aiditor.inspectExtensions', 'aiditor.installExtension', 'aiditor.updateExtension', 'aiditor.enableExtension', 'aiditor.disableExtension', 'aiditor.removeExtension', 'aiditor.promoteExtensionLayer'],
    '[extension action]',
    'onRead'
  )

  register(
    'aiditor.agent-orchestration',
    'AIditor Agent Orchestration',
    'Create, configure, delegate to, communicate with, and close child Agent quests.',
    [
      'Delegate bounded independent work, track quests precisely, and respect Agent ancestry and budgets.',
      'When an Agent should perform work, call agent.delegate directly. Use agent.create only when the request explicitly needs an idle Agent profile.',
      'Agents may manage only descendants and cannot escape to the root.',
      'Use Quest read/result/cancel for task lifecycle and reserve Agent stop for current-run cancellation.',
    ],
    ['agent.read', 'agent.delegate', 'agent.send', 'quest.read', 'quest.result', 'quest.cancel', 'message.read', 'agent.create', 'agent.configure', 'agent.reparent', 'agent.stop', 'agent.delete'],
    '[delegation task]',
    'onRead'
  )
})(window.aiditor = window.aiditor || {})

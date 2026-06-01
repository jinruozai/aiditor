// Demo-only AI targets for the component explorer.
;(function () {
  'use strict'

  const Demo = window.Demo = window.Demo || {}

  function readSpec(spec) {
    if (spec && spec.signal) return spec.signal.peek()
    return spec && spec.peek ? spec.peek() : spec
  }

  function optionsOf(spec) {
    const opts = spec && spec.options || []
    return opts.map(function (item) {
      return typeof item === 'string'
        ? { value: item, label: item }
        : { value: item.value, label: item.label || String(item.value) }
    })
  }

  function editSpec(componentId, prop) {
    const edit = Demo.editFor(componentId)
    return edit && edit[prop]
  }

  function signalOf(spec) {
    return spec && spec.signal ? spec.signal : spec
  }

  function entrySummary(entry) {
    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      description: entry.description || '',
    }
  }

  function propMap(componentId) {
    const edit = Demo.editFor(componentId)
    const keys = Object.keys(edit || {})
    const out = {}
    for (let i = 0; i < keys.length; i++) {
      const spec = edit[keys[i]]
      out[keys[i]] = {
        value: readSpec(spec),
        options: optionsOf(spec),
      }
    }
    return out
  }

  function componentTarget(entry) {
    const props = propMap(entry.id)
    return {
      resolver: 'demo',
      uri: 'demo://component/' + encodeURIComponent(entry.id),
      kind: 'demo.component',
      title: entry.name,
      summary: entry.description || 'Demo component',
      meta: {
        component: entrySummary(entry),
        props: props,
      },
      capabilities: Object.keys(props).map(function (prop) {
        return { op: 'demo.setProp', risk: 'edit', input: { componentId: entry.id, prop: prop } }
      }),
      tools: ['aiditor.readReference', 'aiditor.applyOperation', 'demo.setProp'],
    }
  }

  function propertyTarget(entry, prop, spec) {
    const label = prop.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, function (c) { return c.toUpperCase() })
    return {
      resolver: 'demo',
      uri: 'demo://component/' + encodeURIComponent(entry.id) + '/prop/' + encodeURIComponent(prop),
      kind: 'demo.property',
      title: entry.name + ' / ' + label,
      summary: 'Editable demo property ' + prop + ' on ' + entry.name + '.',
      meta: {
        component: entrySummary(entry),
        prop: prop,
        label: label,
        value: readSpec(spec),
        options: optionsOf(spec),
      },
      capabilities: [{ op: 'demo.setProp', risk: 'edit' }],
      tools: ['aiditor.readReference', 'aiditor.applyOperation', 'demo.setProp'],
    }
  }

  function coerceValue(spec, value) {
    const sig = signalOf(spec)
    const current = sig.peek()
    const opts = optionsOf(spec)
    if (opts.length) {
      for (let i = 0; i < opts.length; i++) {
        if (String(opts[i].value) === String(value)) return opts[i].value
      }
      throw new Error('Invalid option: ' + value)
    }
    if (typeof current === 'boolean') return value === true || value === 'true' || value === 1 || value === '1'
    if (typeof current === 'number') return Number(value)
    return value == null ? '' : String(value)
  }

  function resolveRef(ref) {
    const meta = ref.meta || {}
    const componentId = meta.component && meta.component.id
    const entry = componentId ? Demo.byId(componentId) : null
    if (!entry) return { uri: ref.uri, kind: ref.kind, title: ref.title, meta: meta }
    if (meta.prop) {
      const spec = editSpec(componentId, meta.prop)
      return {
        uri: ref.uri,
        kind: ref.kind,
        title: ref.title,
        component: entrySummary(entry),
        prop: meta.prop,
        value: readSpec(spec),
        options: optionsOf(spec),
      }
    }
    return {
      uri: ref.uri,
      kind: ref.kind,
      title: ref.title,
      component: entrySummary(entry),
      props: propMap(componentId),
    }
  }

  function previewSetProp(args) {
    const entry = Demo.byId(args.componentId)
    if (!entry) throw new Error('Unknown demo component: ' + args.componentId)
    const spec = editSpec(args.componentId, args.prop)
    const sig = signalOf(spec)
    if (!sig || !sig.set) throw new Error('Unknown editable property: ' + args.prop)
    const before = sig.peek()
    const after = coerceValue(spec, args.value)
    return {
      componentId: args.componentId,
      componentName: entry.name,
      prop: args.prop,
      before: before,
      after: after,
      summary: entry.name + '.' + args.prop + ': ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after),
    }
  }

  function applySetProp(preview) {
    const spec = editSpec(preview.componentId, preview.prop)
    const sig = signalOf(spec)
    sig.set(preview.after)
    return {
      applied: true,
      componentId: preview.componentId,
      prop: preview.prop,
      value: sig.peek(),
    }
  }

  const themeTokens = {}
  let themeModeSig = null
  const THEME_STORAGE_KEY = 'aiditor-theme-overrides-v3'
  const THEME_MODE_KEY = 'aiditor-theme-mode'
  const THEME_MODES = ['dark', 'dracula', 'harbor', 'abyss', 'hadal', 'linen', 'light']

  function themeMode() {
    return themeModeSig ? themeModeSig.peek() : (localStorage.getItem(THEME_MODE_KEY) || 'dark')
  }

  function persistThemeToken(name, value) {
    let data = {}
    try { data = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '{}') } catch (_) {}
    data[name] = value
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(data))
  }

  function registerThemeToken(spec) {
    themeTokens[spec.name] = spec
    return spec
  }

  function registerThemeMode(sig) {
    themeModeSig = sig
  }

  function themeTokenTarget(name) {
    const spec = themeTokens[name]
    return {
      resolver: 'demo',
      uri: 'demo://theme/token/' + encodeURIComponent(name),
      kind: 'demo.themeToken',
      title: 'Theme / ' + spec.label,
      summary: 'Editable AIditor demo theme token ' + name + '.',
      meta: {
        token: name,
        label: spec.label,
        category: spec.category,
        value: spec.format ? spec.format(spec.signal.peek()) : spec.signal.peek(),
        rawValue: spec.signal.peek(),
        unit: spec.unit || '',
        min: spec.min,
        max: spec.max,
        mode: themeMode(),
      },
      capabilities: [{ op: 'demo.setThemeToken', risk: 'edit' }, { op: 'demo.setThemeMode', risk: 'edit' }],
      tools: ['aiditor.readReference', 'aiditor.applyOperation', 'demo.setThemeToken', 'demo.setThemeMode'],
    }
  }

  function themeModeTarget() {
    return {
      resolver: 'demo',
      uri: 'demo://theme/mode',
      kind: 'demo.themeMode',
      title: 'Theme / Mode',
      summary: 'Current AIditor demo theme mode.',
      meta: {
        value: themeMode(),
        options: THEME_MODES,
      },
      capabilities: [{ op: 'demo.setThemeMode', risk: 'edit' }],
      tools: ['aiditor.readReference', 'aiditor.applyOperation', 'demo.setThemeMode'],
    }
  }

  function resolveTheme(ref) {
    const meta = ref.meta || {}
    if (ref.kind === 'demo.themeMode') return {
      uri: ref.uri,
      kind: ref.kind,
      title: ref.title,
      value: themeMode(),
      options: THEME_MODES,
    }
    const spec = themeTokens[meta.token]
    if (!spec) return { uri: ref.uri, kind: ref.kind, title: ref.title, meta: meta }
    return {
      uri: ref.uri,
      kind: ref.kind,
      title: ref.title,
      token: meta.token,
      label: spec.label,
      category: spec.category,
      value: spec.format ? spec.format(spec.signal.peek()) : spec.signal.peek(),
      rawValue: spec.signal.peek(),
      unit: spec.unit || '',
      min: spec.min,
      max: spec.max,
      mode: themeMode(),
    }
  }

  function previewSetThemeToken(args) {
    const spec = themeTokens[args.token]
    if (!spec) throw new Error('Unknown theme token: ' + args.token)
    const before = spec.format ? spec.format(spec.signal.peek()) : spec.signal.peek()
    const rawAfter = spec.parse ? spec.parse(String(args.value)) : args.value
    const after = spec.format ? spec.format(rawAfter) : rawAfter
    return {
      token: args.token,
      label: spec.label,
      before: before,
      after: after,
      rawAfter: rawAfter,
      summary: args.token + ': ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after),
    }
  }

  function applySetThemeToken(preview) {
    const spec = themeTokens[preview.token]
    spec.signal.set(preview.rawAfter)
    persistThemeToken(preview.token, preview.after)
    document.documentElement.style.setProperty(preview.token, preview.after)
    return {
      applied: true,
      token: preview.token,
      value: preview.after,
    }
  }

  function previewSetThemeMode(args) {
    const mode = String(args.mode || '')
    if (THEME_MODES.indexOf(mode) < 0) throw new Error('Invalid theme mode: ' + mode)
    return {
      before: themeMode(),
      after: mode,
      summary: 'Theme mode: ' + themeMode() + ' -> ' + mode,
    }
  }

  function applySetThemeMode(preview) {
    if (themeModeSig) themeModeSig.set(preview.after)
    else {
      aiditor.theme.set(preview.after)
      localStorage.setItem(THEME_MODE_KEY, preview.after)
    }
    return {
      applied: true,
      mode: preview.after,
    }
  }

  function walkDocks(node, out) {
    if (!node) return out
    if (node.type === 'dock') {
      out.push({
        id: node.id,
        name: node.name || node.id,
        panels: (node.panels || []).map(function (panel) {
          return { id: panel.id, title: panel.title || panel.component, component: panel.component }
        }),
      })
      return out
    }
    for (let i = 0; node.children && i < node.children.length; i++) walkDocks(node.children[i], out)
    return out
  }

  function hostDocks() {
    if (Demo.layout && Demo.layout.tree) {
      const docks = walkDocks(Demo.layout.tree(), [])
      const inspected = Demo.layout.inspectPanels ? Demo.layout.inspectPanels() : []
      const byId = {}
      for (let i = 0; i < inspected.length; i++) byId[inspected[i].panelId] = inspected[i]
      for (let j = 0; j < docks.length; j++) {
        for (let k = 0; k < docks[j].panels.length; k++) {
          docks[j].panels[k].health = byId[docks[j].panels[k].id] || null
        }
      }
      return docks
    }
    return [
      { name: 'sidebar', panels: [] },
      { name: 'editor', panels: [] },
      { name: 'bottom', panels: [] },
      { name: 'properties', panels: [] },
    ]
  }

  function recentErrors() {
    const list = aiditor.log && aiditor.log.peek ? aiditor.log.peek() : []
    return list.filter(function (entry) { return entry.level === 'error' }).slice(-10).map(function (entry) {
      return {
        time: entry.time,
        source: entry.source,
        message: entry.message,
      }
    })
  }

  function hostTarget() {
    const project = window.Demo && Demo.project && Demo.project.current ? Demo.project.current() : null
    const workspace = aiditor.ai && aiditor.ai.currentWorkspace && aiditor.ai.currentWorkspace()
    const projectWorkflow = project ? [
      'This demo has an open workspace-backed editor project.',
      'For durable UI, inspect and edit files with workspace.* and code.* tools; demo.project.* is only for demo-specific descriptor and health checks.',
      'Project panel files should call Demo.project.component(componentId, spec).',
      'After writing a panel file, inspect docks with aiditor.inspectDocks, then call aiditor.addPanelToDock with component, dock, and path so the runtime loads it before adding the panel. To replace one existing panel, use aiditor.replacePanel with the returned panelId and the same component/path/title/icon/props shape. If path is omitted, the tool can infer one matching JS file and will ask for an explicit path when ambiguous.',
      'Runtime panel placement is separate from descriptor/layout persistence; the host Save command decides when to persist layout.',
    ] : workspace ? [
      'An AI workspace is selected, but it is not opened as a demo project yet.',
      'A valid demo workspace contains aiditor.project.json with type "aiditor-project", id, entries, layout, and project.code.load permission.',
      'Ask the user to open the workspace as a demo project before adding panels; do not edit descriptor/layout JSON as a mounting shortcut.',
      'Do not guess dock/panel operation names such as dock.addPanel, panel.create, or panel.add.',
    ] : [
      'No workspace-backed demo project is open.',
      'Open or select a workspace project before asking the agent to create or modify durable editor UI.',
      'Agent-authored panels are always project files, then mounted by registered component name.',
      'Do not fall back to low-level extension install or dock panel tools when no project workspace is open.',
    ]
    return {
      resolver: 'editor',
      uri: 'aiditor://host',
      kind: 'aiditor.host',
      title: 'AIditor Demo Host',
      summary: project
        ? 'Current AIditor demo shell with an open workspace-backed editor project. Durable UI should be created as project files, then placed by registered component name.'
        : (workspace
          ? 'Current AIditor demo shell with an AI workspace selected, but no demo project opened. Open the workspace project before mounting panels.'
          : 'Current AIditor demo shell. No workspace project is open, so the agent should inspect the shell but not generate panels.'),
      meta: {
        project: project ? {
          id: project.id,
          title: project.title,
          descriptor: project.descriptor,
        } : null,
        docks: hostDocks(),
        panelHealth: Demo.layout && Demo.layout.inspectPanels ? Demo.layout.inspectPanels() : [],
        recentErrors: recentErrors(),
        preferredDockForNewMainPanels: 'editor',
        generatedPanelGuidelines: projectWorkflow.concat([
          'Prefer aiditor.ui.* components when they fit the requested UI.',
          'Use aiditor.ui.view for view surfaces and scrollable panel content instead of raw overflow scrollbars; do not put raw overflowY/overflow:auto on the main panel content when aiditor.ui.view fits.',
          'Use aiditor.ui.button/iconButton/card/list/tree/table/form controls before hand-building equivalent controls.',
          'Use aiditor.ui.tooltip/popover/menu for floating UI; scoped aiditor.ui overlays close automatically when the panel is no longer active. If you manually append floating DOM outside the root, register it with aiditor.ui.registerScopedOverlay(anchor, close).',
          'Make the panel root responsive to dock resize: height 100%, minHeight 0, boxSizing border-box, and avoid fixed viewport dimensions.',
          'Use flex/grid with minmax(), auto-fit, and container-relative sizing for card grids.',
        ]),
        projectPanelPattern: project ? {
          file: 'src/panels/main-panel.js',
          component: project.id + '.mainPanel',
          registration: "Demo.project.component('" + project.id + ".mainPanel', { defaults: function () { return { title: 'Main Panel', icon: 'columns', props: {} } }, factory: function (propsSig, ctx) { const root = document.createElement('div'); root.style.cssText = 'height:100%;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;'; const view = aiditor.ui.view({ children: [] }); view.style.flex = '1 1 auto'; view.style.minHeight = '0'; root.appendChild(view); return root } })",
          inspectTool: 'aiditor.inspectDocks',
          addPanelTool: 'aiditor.addPanelToDock',
          replacePanelTool: 'aiditor.replacePanel',
        } : null,
      },
      capabilities: [
        project
          ? { op: 'aiditor.addPanelToDock', risk: 'edit', purpose: 'Place a component into a runtime dock; pass path for newly written workspace files, or let the tool infer one unique matching JS file. Use aiditor.replacePanel when replacing an existing panelId.' }
          : null
      ].filter(Boolean),
      tools: project
        ? ['aiditor.readReference', 'aiditor.getCapabilities', 'workspace.fileSummary', 'workspace.searchFiles', 'workspace.readText', 'workspace.readTextRange', 'workspace.editText', 'workspace.patchText', 'workspace.writeText', 'code.map', 'code.outline', 'aiditor.inspectDocks', 'aiditor.addPanelToDock', 'aiditor.replacePanel', 'demo.project.readDescriptor', 'demo.project.readSource', 'demo.project.inspectPanel', 'demo.project.runCheck']
        : ['aiditor.readReference', 'aiditor.getCapabilities'],
    }
  }

  function readHost(ref) {
    const target = hostTarget()
    return {
      uri: target.uri,
      kind: target.kind,
      title: target.title,
      summary: target.summary,
      docks: target.meta.docks,
      panelHealth: target.meta.panelHealth,
      recentErrors: target.meta.recentErrors,
      preferredDockForNewMainPanels: target.meta.preferredDockForNewMainPanels,
      generatedPanelGuidelines: target.meta.generatedPanelGuidelines,
      projectPanelPattern: target.meta.projectPanelPattern,
      capabilities: target.capabilities,
      tools: target.tools,
    }
  }

  Demo.aiTargets = {
    component: componentTarget,
    property: propertyTarget,
    registerThemeToken: registerThemeToken,
    registerThemeMode: registerThemeMode,
    themeToken: themeTokenTarget,
    themeMode: themeModeTarget,
  }

  aiditor.ai.references.register('demo', {
    read: function (ref) {
      if (ref.kind === 'demo.themeToken' || ref.kind === 'demo.themeMode') return resolveTheme(ref)
      return resolveRef(ref)
    },
    schema: function (ref) {
      const meta = ref.meta || {}
      if (ref.kind === 'demo.property') {
        return {
          type: 'object',
          required: ['componentId', 'prop', 'value'],
          properties: {
            componentId: { type: 'string', const: meta.component && meta.component.id },
            prop: { type: 'string', const: meta.prop },
            value: meta.options && meta.options.length ? { enum: meta.options.map(function (item) { return item.value }) } : {},
          },
        }
      }
      if (ref.kind === 'demo.themeToken') return {
        type: 'object',
        required: ['token', 'value'],
        properties: {
          token: { type: 'string', const: meta.token },
          value: {},
        },
      }
      if (ref.kind === 'demo.themeMode') return {
        type: 'object',
        required: ['mode'],
        properties: { mode: { type: 'string', enum: THEME_MODES } },
      }
      return null
    },
    capabilities: function (ref) {
      return ref.capabilities || []
    },
  })

  aiditor.ai.references.register('editor', {
    read: function (ref) {
      return ref.uri === 'aiditor://host' ? readHost(ref) : ref
    },
    schema: function (ref) {
      if (ref.uri !== 'aiditor://host') return null
      return {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'Registered component id to place in a dock.' },
          entryPath: { type: 'string', description: 'Workspace file path containing Demo.project.component registration.' },
          dock: { type: 'string', enum: hostDocks().map(function (dock) { return dock.name }) },
        },
      }
    },
    capabilities: function (ref) {
      return ref.uri === 'aiditor://host' ? hostTarget().capabilities : []
    },
    search: function (query) {
      const text = String(query && (query.query || query.kind || '') || '').toLowerCase()
      return /host|dock|panel|window|editor|main|ui|界面|面板|窗口|主视图/.test(text)
        ? [hostTarget()]
        : []
    },
  })

  aiditor.ai.operations.register('demo.setProp', {
    title: 'Set Demo Property',
    schema: {
      type: 'object',
      required: ['componentId', 'prop', 'value'],
      properties: {
        componentId: { type: 'string' },
        prop: { type: 'string' },
        value: {},
      },
    },
    risk: 'edit',
    preview: previewSetProp,
    apply: applySetProp,
  })

  aiditor.ai.operations.register('demo.setThemeToken', {
    title: 'Set Demo Theme Token',
    schema: {
      type: 'object',
      required: ['token', 'value'],
      properties: {
        token: { type: 'string' },
        value: {},
      },
    },
    risk: 'edit',
    preview: previewSetThemeToken,
    apply: applySetThemeToken,
  })

  aiditor.ai.operations.register('demo.setThemeMode', {
    title: 'Set Demo Theme Mode',
    schema: {
      type: 'object',
      required: ['mode'],
      properties: { mode: { type: 'string', enum: THEME_MODES } },
    },
    risk: 'edit',
    preview: previewSetThemeMode,
    apply: applySetThemeMode,
  })

  aiditor.ai.tools.register('demo.setProp', {
    title: 'Set Demo Property',
    description: 'Change an editable property in the AIditor component explorer demo. Use only prop keys returned by demo.property refs or by component meta.props; never invent keys such as children if they are not listed.',
    schema: {
      type: 'object',
      required: ['componentId', 'prop', 'value'],
      properties: {
        componentId: { type: 'string', description: 'Demo component id, for example button or numberInput.' },
        prop: { type: 'string', description: 'Editable property key from the property form.' },
        value: { description: 'New JSON-serializable property value. Must match options for enum properties.' },
      },
    },
    preview: previewSetProp,
    apply: applySetProp,
  })

  aiditor.ai.tools.register('demo.setThemeToken', {
    title: 'Set Demo Theme Token',
    description: 'Change an AIditor component explorer theme token such as --aiditor-brand or --aiditor-surface-panel.',
    schema: {
      type: 'object',
      required: ['token', 'value'],
      properties: {
        token: { type: 'string', description: 'CSS custom property name, for example --aiditor-brand.' },
        value: { description: 'New token value. Use hex colors for palette tokens, numbers for px/ms tokens, or strings for font tokens.' },
      },
    },
    preview: previewSetThemeToken,
    apply: applySetThemeToken,
  })

  aiditor.ai.tools.register('demo.setThemeMode', {
    title: 'Set Demo Theme Mode',
    description: 'Switch the AIditor component explorer theme mode.',
    schema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: THEME_MODES },
      },
    },
    preview: previewSetThemeMode,
    apply: applySetThemeMode,
  })
})()

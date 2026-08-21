// AI chat composer slash discovery over the existing Skill and Command registries.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const ui = aiditor.ui
  const MENU_TARGET = 'ai.composer.slash'

  function prefixAllowsSkills(draft, end) {
    for (let i = 0; i < end; i++) {
      const ch = draft.text[i]
      if (/\s/.test(ch)) continue
      const token = draft.tokens[ch]
      if (!token || token.type !== 'skill') return false
    }
    return true
  }

  function prefixAllowsCommands(draft, end) {
    return !draft.text.slice(0, end).trim()
  }

  function triggerFor(draft, range) {
    const d = ai.richPrompt.normalize(draft)
    if (!range || !range.collapsed) return null
    let start = range.end
    while (start > 0) {
      const ch = d.text[start - 1]
      if (/\s/.test(ch) || d.tokens[ch]) break
      start--
    }
    if (d.text[start] !== '/' || !prefixAllowsSkills(d, start)) return null
    const query = d.text.slice(start + 1, range.end)
    if (!query || query.indexOf('/') < 0) {
      return {
        start: start,
        end: range.end,
        query: query,
        commands: prefixAllowsCommands(d, start),
      }
    }
    return null
  }

  function skillDetail(skill, meta) {
    const parts = []
    if (skill.argumentHint) parts.push(skill.argumentHint)
    if (skill.description) parts.push(skill.description)
    if (skill.tools && skill.tools.length) parts.push(skill.tools.length + (skill.tools.length === 1 ? ' tool' : ' tools'))
    if (meta && meta.source) parts.push(meta.source)
    return parts.join(' · ')
  }

  function skillItems(draft, ctx) {
    if (!ai.skills || !ai.skills.catalog) return []
    const active = {}
    const selected = ai.richPrompt.skills(draft)
    for (let i = 0; i < selected.length; i++) active[selected[i]] = true
    const catalog = ai.skills.catalog(ctx || {}, { audience: 'user', limit: 100 })
    const out = []
    for (let j = 0; j < catalog.length; j++) {
      const item = catalog[j]
      const id = item.id
      const skill = ai.skills.get(id)
      const meta = { source: item.source, owner: item.owner, layer: item.layer }
      const unavailable = !item.available
      out.push({
        key: 'skill:' + id,
        kind: 'skill',
        id: id,
        name: id,
        label: '/' + id,
        description: skill.title && skill.title !== id ? skill.title : '',
        detail: active[id] ? 'Already selected' : (unavailable ? item.unavailableReason : skillDetail(skill, meta)),
        icon: 'tag',
        group: 'Skills',
        disabled: !!active[id] || unavailable,
        search: [id, skill.title, skill.description, skill.argumentHint, meta.owner, meta.layer, meta.source, (skill.tools || []).join(' ')],
        skill: skill,
      })
    }
    return out
  }

  function commandItems(ctx) {
    if (!aiditor.commands || !aiditor.commands.menuItems) return []
    const items = aiditor.commands.menuItems(MENU_TARGET, null, ctx)
    const out = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.command || item.type) continue
      const name = String(item.name || item.command).replace(/^\/+/, '')
      out.push({
        key: 'command:' + item.id,
        kind: 'command',
        id: item.id,
        name: name,
        label: '/' + name,
        description: item.description || item.label || '',
        detail: item.argumentHint || item.detail || item.command,
        icon: item.icon || 'settings',
        group: 'Commands',
        disabled: !!item.disabled,
        search: [name, item.label, item.description, item.detail, item.argumentHint, item.command],
        command: item.command,
        input: item.input || {},
      })
    }
    return out
  }

  function projectedItems(draft, ctx, includeCommands) {
    const out = includeCommands ? commandItems(ctx) : []
    return out.concat(skillItems(draft, ctx))
  }

  function install(opts) {
    const root = opts.input
    const editorApi = root.__aiditorRichPromptApi
    const draft = opts.value
    const query = aiditor.signal('')
    const items = aiditor.signal([])
    let picker = null
    let current = null
    let dismissed = ''

    function commandContext() {
      const base = typeof opts.context === 'function' ? opts.context() : (opts.context || {})
      return Object.assign({}, base, {
        source: MENU_TARGET,
        draft: draft.peek(),
      })
    }

    function triggerKey(next, value) {
      return next.start + ':' + next.end + ':' + value.text + ':' + next.query
    }

    function close() {
      if (picker) picker.close()
      picker = null
      current = null
    }

    function onSelect(item) {
      const trigger = current
      if (!trigger) return null
      if (item.kind === 'skill') {
        let fragment = ai.richPrompt.insertSkill(ai.richPrompt.empty(), 0, {
          id: item.id,
          title: item.skill.title || item.id,
        })
        fragment = ai.richPrompt.insertText(fragment, fragment.text.length, ' ')
        editorApi.replaceRange(trigger.start, trigger.end, fragment)
        editorApi.focus()
        return null
      }
      editorApi.replaceRange(trigger.start, trigger.end, ai.richPrompt.empty())
      return aiditor.commands.run(item.command, item.input, commandContext())
    }

    function open(next, value) {
      current = next
      query.set(next.query)
      items.set(projectedItems(value, commandContext(), next.commands))
      if (picker) return
      picker = ui.quickPick({
        anchor: root,
        query: query,
        items: items,
        showSearch: false,
        focus: false,
        ariaTarget: editorApi.editor,
        side: 'top',
        align: 'start',
        acceptTab: true,
        className: 'aiditor-ai-composer-slash',
        emptyText: 'No matching commands or skills',
        getKey: function (item) { return item.key },
        getLabel: function (item) { return item.label },
        getDescription: function (item) { return item.description },
        getDetail: function (item) { return item.detail },
        getIcon: function (item) { return item.icon },
        getGroup: function (item) { return item.group },
        getDisabled: function (item) { return item.disabled },
        getSearchText: function (item) { return item.search },
        onSelect: onSelect,
        onDismiss: function () { picker = null },
      })
    }

    function refresh() {
      const value = ai.richPrompt.normalize(draft())
      const next = triggerFor(value, editorApi.selectionRange())
      if (!next) {
        dismissed = ''
        close()
        return
      }
      const key = triggerKey(next, value)
      if (dismissed === key) return
      open(next, value)
    }

    const stop = aiditor.effect(refresh)
    function refreshSelection(ev) {
      if (ev && ev.type === 'keyup' && ev.key === 'Escape') {
        const value = ai.richPrompt.normalize(draft.peek())
        const next = triggerFor(value, editorApi.selectionRange())
        dismissed = next ? triggerKey(next, value) : ''
        close()
        return
      }
      refresh()
    }
    editorApi.editor.addEventListener('keyup', refreshSelection)
    editorApi.editor.addEventListener('mouseup', refreshSelection)
    editorApi.editor.addEventListener('focus', refreshSelection)

    return {
      handleKeyDown: function (ev) {
        if (!picker) return false
        if (ev.key === 'Escape') {
          const value = ai.richPrompt.normalize(draft.peek())
          dismissed = current ? triggerKey(current, value) : ''
        }
        return picker.handleKeyDown(ev)
      },
      dispose: function () {
        editorApi.editor.removeEventListener('keyup', refreshSelection)
        editorApi.editor.removeEventListener('mouseup', refreshSelection)
        editorApi.editor.removeEventListener('focus', refreshSelection)
        close()
        stop()
      },
    }
  }

  ai.composerSlash = {
    menuTarget: MENU_TARGET,
    triggerFor: triggerFor,
    items: projectedItems,
    install: install,
  }
})(window.aiditor = window.aiditor || {})

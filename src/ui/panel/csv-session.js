// Shared CSV sessions: one file/format owns one document, history, and save state.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv
  const sessions = new Map()

  function sessionKey(workspaceId, path, formatId) {
    return String(workspaceId || 'default') + ':' + String(formatId || 'csv') + ':' + aiditor.workspace.normalizePath(path)
  }

  function createSession(workspaceId, path, formatId, options) {
    const key = sessionKey(workspaceId, path, formatId)
    const document = ui.createTextDocument({
      workspaceId: workspaceId,
      path: path,
      decode: function (text) { return csv.model.parse(text, formatId, options && options.columns) },
      encode: csv.model.stringify,
      equals: Object.is,
    })
    const savedIndex = aiditor.signal(null)
    const editing = aiditor.signal(false)
    const history = aiditor.history.create({
      capture: function () { return document.value.peek() },
      apply: function (snapshot) { document.set(snapshot) },
      clone: function (snapshot) { return snapshot },
      equals: Object.is,
    })
    const historyId = 'csv:' + key
    const unbindHistory = aiditor.history.bind(historyId, history, { savedIndex: savedIndex })
    let refs = 0
    let loading = null
    let edit = null

    function load() {
      if (document.loaded.peek()) return Promise.resolve(document.value.peek())
      if (!loading) loading = document.load().then(function (value) {
        if (!history.entries.peek().length) {
          history.reset('Loaded')
          savedIndex.set(history.index.peek())
        }
        return value
      }).finally(function () { loading = null })
      return loading
    }

    function finishEdit() {
      if (!edit) return
      const active = edit
      edit = null
      editing.set(false)
      history.commit(active.label, active.meta)
    }

    function beginEdit(editKey, label, meta) {
      if (edit && edit.key === editKey) return
      finishEdit()
      history.begin(label, meta)
      edit = { key: editKey, label: label, meta: meta || null, before: document.value.peek() }
      editing.set(true)
    }

    function updateEdit(editKey, label, value, meta) {
      beginEdit(editKey, label, meta)
      if (!Object.is(value, document.value.peek())) document.set(value)
      return value
    }

    function cancelEdit(editKey) {
      if (!edit || editKey && edit.key !== editKey) return
      const before = edit.before
      edit = null
      editing.set(false)
      history.cancel()
      if (!Object.is(before, document.value.peek())) document.set(before)
    }

    function editValue(editKey, label, value, meta) {
      const phase = meta && meta.edit && meta.edit.phase
      if (phase === 'cancel') { cancelEdit(editKey); return document.value.peek() }
      if (phase === 'update') return updateEdit(editKey, label, value, meta)
      if (phase === 'commit') {
        updateEdit(editKey, label, value, meta)
        finishEdit()
        return value
      }
      return commit(label, value, meta)
    }

    function commit(label, value, meta) {
      finishEdit()
      if (Object.is(value, document.value.peek())) return value
      document.set(value)
      history.capture(label, meta)
      return value
    }

    async function save() {
      finishEdit()
      const result = await document.save()
      savedIndex.set(history.index.peek())
      return result
    }

    async function reload() {
      finishEdit()
      if (document.dirty.peek()) throw new Error('csv.reload: unsaved changes must be resolved first')
      const value = await document.reload()
      history.reset('Reloaded')
      savedIndex.set(history.index.peek())
      return value
    }

    function undo() { finishEdit(); return history.undo() }
    function redo() { finishEdit(); return history.redo() }

    function restore(state) {
      cancelEdit()
      document.restore(state.document)
      history.reset('Restored')
      savedIndex.set(document.dirty.peek() ? null : history.index.peek())
    }

    const session = {
      key: key,
      workspaceId: workspaceId,
      path: aiditor.workspace.normalizePath(path),
      formatId: formatId,
      document: document,
      history: history,
      historyId: historyId,
      savedIndex: savedIndex,
      editing: editing,
      load: load,
      save: save,
      reload: reload,
      undo: undo,
      redo: redo,
      beginEdit: beginEdit,
      updateEdit: updateEdit,
      finishEdit: finishEdit,
      cancelEdit: cancelEdit,
      edit: editValue,
      commit: commit,
      restore: restore,
      retain: function () { refs++; return session },
      release: function () {
        refs--
        if (refs > 0) return
        finishEdit()
        unbindHistory()
        document.dispose()
        sessions.delete(key)
      },
    }
    return session
  }

  function acquire(workspaceId, path, formatId, options) {
    const normalizedFormatId = csv.formats.resolve(formatId || 'csv').id
    const key = sessionKey(workspaceId, path, normalizedFormatId)
    let session = sessions.get(key)
    if (!session) {
      session = createSession(String(workspaceId || 'default'), path, normalizedFormatId, options)
      sessions.set(key, session)
    }
    return session.retain()
  }

  csv.sessions = {
    key: sessionKey,
    acquire: acquire,
    get: function (key) { return sessions.get(key) || null },
  }
})(window.aiditor = window.aiditor || {})

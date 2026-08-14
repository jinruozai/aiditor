// CSV cell-value drag/drop on top of the shared aiditor DnD primitives.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv
  const MIME = 'application/aiditor.csv-cell+json'
  const MIME_PREFIX = 'application/aiditor.csv-cell.'

  function mimeFor(kind) { return MIME_PREFIX + String(kind || 'value').replace(/[^a-z0-9_-]/gi, '-') + '+json' }

  function payloadFor(descriptor) {
    return {
      raw: String(descriptor.raw == null ? '' : descriptor.raw),
      type: String(descriptor.type || 'var'),
      render: String(descriptor.render || 'input_string'),
      workspaceId: descriptor.workspaceId,
      path: descriptor.path,
      rowId: descriptor.rowId,
      columnId: descriptor.columnId,
    }
  }

  function source(el, getDescriptor) {
    el.classList.add('aiditor-csv-drag-source')
    return ui.dragsource(el, {
      effect: 'copy',
      getData: function () {
        const descriptor = payloadFor(getDescriptor())
        const json = JSON.stringify(descriptor)
        const out = { 'text/plain': descriptor.raw }
        out[MIME] = json
        out[mimeFor(descriptor.render)] = json
        if (descriptor.render === 'img' || descriptor.render === 'snd') {
          const kind = descriptor.render === 'img' ? 'image' : 'audio'
          const pathPayload = JSON.stringify({ kind: kind, value: descriptor.raw })
          out['text/uri-list'] = descriptor.raw
          out['application/aiditor.file-path+json'] = pathPayload
          out['application/aiditor.file-path.' + kind + '+json'] = pathPayload
        }
        if (descriptor.render === 'id') {
          out['application/aiditor.entity+json'] = JSON.stringify({ id: descriptor.raw, pathKey: descriptor.path || '' })
        }
        return out
      },
    })
  }

  function sourceKind(data) {
    const types = data.types || []
    for (let i = 0; i < types.length; i++) {
      const type = String(types[i])
      if (type.indexOf(MIME_PREFIX) === 0 && /\+json$/.test(type)) return type.slice(MIME_PREFIX.length, -5).replace(/-/g, '_')
    }
    if (types.indexOf('application/aiditor.entity+json') >= 0) return 'id'
    return ''
  }

  function compatible(data, kind) {
    const source = sourceKind(data)
    if (kind === 'ref_id') return source === 'id' || source === 'ref_id'
    if (kind === 'img') return source === 'img' || ui.dnd.matchesKind(data, 'image')
    if (kind === 'snd') return source === 'snd' || ui.dnd.matchesKind(data, 'audio')
    return !!source && source === kind
  }

  function readPayload(data, event) {
    const transfer = event.dataTransfer
    const text = transfer.getData(MIME)
    if (text) {
      try { return JSON.parse(text) } catch (_) { return null }
    }
    if (data.entity) return { raw: String(data.entity.id == null ? '' : data.entity.id), render: 'id' }
    const value = ui.dnd.extractUrl(data)
    return value ? { raw: value, render: sourceKind(data) } : null
  }

  function target(el, kind, onDrop) {
    const accept = [MIME, mimeFor('id'), mimeFor('ref_id'), mimeFor(kind)]
    if (kind === 'ref_id') accept.push('application/aiditor.entity+json')
    if (kind === 'img' || kind === 'snd') {
      const assetKind = kind === 'img' ? 'image' : 'audio'
      accept.push('Files', 'text/uri-list', 'text/plain', 'application/aiditor.file-path+json',
        'application/aiditor.file-path.' + assetKind + '+json', 'application/aiditor.asset+json',
        'application/aiditor.asset.' + assetKind + '+json')
    }
    return ui.dropzone(el, {
      accept: accept,
      effect: 'copy',
      canDrop: function (data, event) {
        const ok = compatible(data, kind)
        if (ok) event.stopPropagation()
        return ok
      },
      onDrop: function (data, event) {
        event.stopPropagation()
        const payload = readPayload(data, event)
        if (payload) onDrop(payload.raw, payload)
      },
    })
  }

  function grip(descriptor, content) {
    const read = typeof descriptor === 'function' ? descriptor : function () { return descriptor }
    const el = ui.h('span', 'aiditor-csv-value-handle')
    el.dataset.kind = read().render || 'value'
    if (content) el.appendChild(content)
    else {
      el.appendChild(ui.h('i'))
      el.appendChild(ui.h('i'))
      el.appendChild(ui.h('i'))
    }
    el.addEventListener('pointerdown', function (event) { event.stopPropagation() })
    source(el, read)
    return el
  }

  csv.drag = {
    mime: MIME,
    source: source,
    target: target,
    grip: grip,
    shouldHandle: function (field) {
      const kind = field && field.type_render
      return kind === 'id' || kind === 'ref_id' || kind === 'img' || kind === 'snd' || kind === 'composite' || field && field.tag === 'res'
    },
  }
})(window.aiditor = window.aiditor || {})

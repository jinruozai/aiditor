// aiditor.workspaceState — project-scoped JSON state persistence.
//
// This is intentionally separate from aiditor.workspace: workspace adapters
// own bounded files, while workspaceState owns small opaque UI/runtime state.
;(function (aiditor) {
  'use strict'

  const DEFAULT_PREFIX = 'aiditor.workspace-state.v1'
  let adapter = localStorageAdapter()
  const queues = new Map()

  function localStorageAdapter(opts) {
    const o = opts || {}
    const prefix = String(o.prefix || DEFAULT_PREFIX)
    const storage = Object.prototype.hasOwnProperty.call(o, 'storage')
      ? o.storage
      : defaultStorage()

    function storageKey(workspaceId, key) {
      return prefix + ':' + encodeURIComponent(String(workspaceId)) + ':' + encodeURIComponent(String(key))
    }

    return {
      load: function (workspaceId, key) {
        if (!storage) return null
        const raw = storage.getItem(storageKey(workspaceId, key))
        return raw == null ? null : JSON.parse(raw)
      },
      save: function (workspaceId, key, value) {
        if (storage) storage.setItem(storageKey(workspaceId, key), JSON.stringify(value))
      },
      remove: function (workspaceId, key) {
        if (storage) storage.removeItem(storageKey(workspaceId, key))
      },
    }
  }

  function defaultStorage() {
    try { return window.localStorage || null } catch (_) { return null }
  }

  /**
   * @aiditorApi aiditor.workspaceState.configure
   * @group workspace
   * @layer core
   * @kind js-api
   * @signature aiditor.workspaceState.configure(options)
   * @summary Configure the project-scoped JSON state adapter used for small UI/runtime state; this storage is separate from workspace files.
   * @param {object} options - Adapter options.
   * @param {object} options.adapter - Optional adapter with load(workspaceId,key), save(workspaceId,key,value), and remove(workspaceId,key).
   * @returns {object} Active adapter.
   * @related aiditor.workspaceState.load,aiditor.workspaceState.save
   */
  function configure(opts) {
    const o = opts || {}
    adapter = o.adapter || localStorageAdapter(o)
    return adapter
  }

  /**
   * @aiditorApi aiditor.workspaceState.load
   * @group workspace
   * @layer core
   * @kind js-api
   * @signature aiditor.workspaceState.load(workspaceId, key)
   * @summary Load one JSON-safe state value from an opaque project/workspace namespace.
   * @param {string} workspaceId - Stable host-owned project/workspace identity.
   * @param {string} key - State owner key.
   * @returns {Promise<*>} Stored value or null.
   * @related aiditor.workspaceState.save,aiditor.workspaceState.remove
   */
  function load(workspaceId, key) {
    try {
      return Promise.resolve(adapter.load(String(workspaceId), String(key)))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  /**
   * @aiditorApi aiditor.workspaceState.save
   * @group workspace
   * @layer core
   * @kind js-api
   * @signature aiditor.workspaceState.save(workspaceId, key, value)
   * @summary Enqueue a JSON-safe state write; writes for the same workspaceId and key are serialized and pending snapshots are coalesced to the newest value.
   * @param {string} workspaceId - Stable host-owned project/workspace identity.
   * @param {string} key - State owner key.
   * @param {*} value - JSON-safe state value.
   * @returns {Promise<*>} Completion of this write or a newer coalesced write.
   * @related aiditor.workspaceState.load,aiditor.workspaceState.remove
   */
  function save(workspaceId, key, value) {
    return enqueue(String(workspaceId), String(key), 'save', value)
  }

  /**
   * @aiditorApi aiditor.workspaceState.remove
   * @group workspace
   * @layer core
   * @kind js-api
   * @signature aiditor.workspaceState.remove(workspaceId, key)
   * @summary Enqueue removal of one project-scoped state value through the same serialized write queue as save.
   * @param {string} workspaceId - Stable host-owned project/workspace identity.
   * @param {string} key - State owner key.
   * @returns {Promise<*>} Completion of this removal or a newer coalesced operation.
   * @related aiditor.workspaceState.load,aiditor.workspaceState.save
   */
  function remove(workspaceId, key) {
    return enqueue(String(workspaceId), String(key), 'remove', null)
  }

  function enqueue(workspaceId, key, kind, value) {
    const id = JSON.stringify([workspaceId, key])
    let queue = queues.get(id)
    if (!queue) {
      queue = { id: id, workspaceId: workspaceId, key: key, running: false, pending: null }
      queues.set(id, queue)
    }
    const promise = new Promise(function (resolve, reject) {
      if (!queue.pending) queue.pending = { kind: kind, value: value, waiters: [] }
      else {
        queue.pending.kind = kind
        queue.pending.value = value
      }
      queue.pending.waiters.push({ resolve: resolve, reject: reject })
    })
    pump(queue)
    return promise
  }

  function pump(queue) {
    if (queue.running) return
    queue.running = true
    runNext(queue)
  }

  function runNext(queue) {
    const op = queue.pending
    if (!op) {
      queue.running = false
      if (!queue.pending) queues.delete(queue.id)
      return
    }
    queue.pending = null
    let result
    try {
      result = op.kind === 'remove'
        ? adapter.remove(queue.workspaceId, queue.key)
        : adapter.save(queue.workspaceId, queue.key, op.value)
    } catch (err) {
      settle(op.waiters, 'reject', err)
      runNext(queue)
      return
    }
    Promise.resolve(result).then(function (value) {
      settle(op.waiters, 'resolve', value)
      runNext(queue)
    }, function (err) {
      settle(op.waiters, 'reject', err)
      runNext(queue)
    })
  }

  function settle(waiters, method, value) {
    for (let i = 0; i < waiters.length; i++) waiters[i][method](value)
  }

  aiditor.workspaceState = {
    configure: configure,
    load: load,
    save: save,
    remove: remove,
    localStorageAdapter: localStorageAdapter,
  }
})(window.aiditor = window.aiditor || {})

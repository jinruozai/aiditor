// aiditor.workspace File System Access change observation.
;(function (aiditor) {
  'use strict'

  const workspace = aiditor.workspace
  const MERGE_DELAY = 60
  const POLL_INTERVAL = 4000

  function normalize(path) { return workspace.normalizePath(path || '') }

  function parent(path) { return workspace.parentPath(path) }

  function within(path, root) {
    return !root || path === root || path.indexOf(root + '/') === 0
  }

  function intersects(path, root) {
    return within(path, root) || within(root, path)
  }

  function missing(err) {
    return !!err && (err.name === 'NotFoundError' || err.code === 'ENOENT')
  }

  function typeMismatch(err) {
    return !!err && (err.name === 'TypeMismatchError' || err.code === 'EISDIR' || err.code === 'ENOTDIR')
  }

  function permissionError(err) {
    return !!err && (err.name === 'NotAllowedError' || err.name === 'SecurityError'
      || err.code === 'EACCES' || err.code === 'EPERM')
  }

  function componentsPath(components) {
    return normalize(Array.isArray(components) ? components.join('/') : '')
  }

  function compactScopes(scopes) {
    const sorted = Array.from(scopes).sort(function (a, b) {
      return a.length - b.length || a.localeCompare(b)
    })
    const out = []
    for (let i = 0; i < sorted.length; i++) {
      if (!out.some(function (scope) { return within(sorted[i], scope) })) out.push(sorted[i])
    }
    return out
  }

  function create(rootHandle, api) {
    let snapshot = new Map()
    let observer = null
    let started = false
    let ready = false
    let starting = null
    let disposed = false
    let mergeTimer = null
    let pollTimer = null
    let source = 'observer'
    let observerErrored = false
    let permissionLost = false
    let listenerId = 0
    let generation = 0
    const listeners = new Map()
    const pendingScopes = new Set()
    const forcedModified = new Set()
    const hintedMoves = []
    const ownPaths = new Map()

    async function permissionGranted() {
      if (!rootHandle.queryPermission) return true
      return await rootHandle.queryPermission({ mode: 'read' }) === 'granted'
    }

    async function childHandle(path) {
      if (!path) return rootHandle
      const parts = path.split('/')
      let handle = rootHandle
      for (let i = 0; i < parts.length; i++) {
        if (handle.kind !== 'directory') throw new DOMException('Entry not found', 'NotFoundError')
        try {
          handle = await handle.getDirectoryHandle(parts[i])
        } catch (err) {
          if (!missing(err) && !typeMismatch(err)) throw err
          handle = await handle.getFileHandle(parts[i])
        }
      }
      return handle
    }

    async function entry(path, handle) {
      if (handle.kind === 'directory') {
        return { path: path, kind: 'directory', size: null, mtime: null, handle: handle }
      }
      const file = await handle.getFile()
      return {
        path: path,
        kind: 'file',
        size: typeof file.size === 'number' ? file.size : null,
        mtime: file.lastModified || null,
        handle: handle,
      }
    }

    async function scanDirectory(path, handle, out) {
      out.set(path, await entry(path, handle))
      for await (const child of handle.values()) {
        const childPath = path ? path + '/' + child.name : child.name
        if (child.kind === 'directory') await scanDirectory(childPath, child, out)
        else out.set(childPath, await entry(childPath, child))
      }
    }

    async function scanScope(path) {
      const out = new Map()
      let handle
      try {
        handle = await childHandle(path)
      } catch (err) {
        if (missing(err)) return out
        throw err
      }
      if (handle.kind === 'directory') await scanDirectory(path, handle, out)
      else out.set(path, await entry(path, handle))
      return out
    }

    async function scan(scopes) {
      if (!await permissionGranted()) {
        const err = new Error('Workspace directory permission is not granted')
        err.name = 'NotAllowedError'
        throw err
      }
      const next = new Map(snapshot)
      for (let i = 0; i < scopes.length; i++) {
        const scope = scopes[i]
        Array.from(next.keys()).forEach(function (path) {
          if (within(path, scope)) next.delete(path)
        })
        const found = await scanScope(scope)
        found.forEach(function (value, path) { next.set(path, value) })
      }
      return next
    }

    async function sameEntry(a, b) {
      if (a.handle === b.handle) return true
      if (!a.handle.isSameEntry) return false
      return await a.handle.isSameEntry(b.handle)
    }

    function coversRemoved(item, moves) {
      return moves.some(function (move) {
        return move.before.kind === 'directory' && within(item.path, move.before.path)
      })
    }

    function coversAdded(item, moves) {
      return moves.some(function (move) {
        return move.after.kind === 'directory' && within(item.path, move.after.path)
      })
    }

    async function pairMoves(removed, added) {
      const moves = []
      const usedRemoved = new Set()
      const usedAdded = new Set()

      async function pair(beforePath, afterPath) {
        const ri = removed.findIndex(function (item, index) { return !usedRemoved.has(index) && item.path === beforePath })
        const ai = added.findIndex(function (item, index) { return !usedAdded.has(index) && item.path === afterPath })
        if (ri < 0 || ai < 0 || removed[ri].kind !== added[ai].kind) return false
        if (!await sameEntry(removed[ri], added[ai])) return false
        usedRemoved.add(ri)
        usedAdded.add(ai)
        moves.push({ before: removed[ri], after: added[ai] })
        return true
      }

      for (let i = 0; i < hintedMoves.length; i++) {
        await pair(hintedMoves[i].from, hintedMoves[i].to)
      }

      const kinds = ['directory', 'file']
      for (let k = 0; k < kinds.length; k++) {
        for (let i = 0; i < removed.length; i++) {
          if (usedRemoved.has(i) || removed[i].kind !== kinds[k] || coversRemoved(removed[i], moves)) continue
          for (let j = 0; j < added.length; j++) {
            if (usedAdded.has(j) || added[j].kind !== kinds[k] || coversAdded(added[j], moves)) continue
            if (!await sameEntry(removed[i], added[j])) continue
            usedRemoved.add(i)
            usedAdded.add(j)
            moves.push({ before: removed[i], after: added[j] })
            break
          }
        }
      }
      return { moves: moves, usedRemoved: usedRemoved, usedAdded: usedAdded }
    }

    function own(change, now) {
      let matched = false
      ownPaths.forEach(function (expires, path) {
        if (expires <= now) ownPaths.delete(path)
        else if (intersects(change.path, path) || (change.fromPath && intersects(change.fromPath, path))) matched = true
      })
      return matched
    }

    async function changesBetween(before, after) {
      const removed = []
      const added = []
      const changes = []
      before.forEach(function (item, path) { if (!after.has(path)) removed.push(item) })
      after.forEach(function (item, path) { if (!before.has(path)) added.push(item) })
      removed.sort(function (a, b) { return a.path.length - b.path.length })
      added.sort(function (a, b) { return a.path.length - b.path.length })
      const paired = await pairMoves(removed, added)

      paired.moves.forEach(function (move) {
        changes.push({ type: 'moved', path: move.after.path, fromPath: move.before.path, kind: move.after.kind })
      })
      const deletedDirectories = []
      const createdDirectories = []
      for (let i = 0; i < removed.length; i++) {
        if (!paired.usedRemoved.has(i) && !coversRemoved(removed[i], paired.moves)
          && !deletedDirectories.some(function (path) { return within(removed[i].path, path) })) {
          changes.push({ type: 'deleted', path: removed[i].path, kind: removed[i].kind })
          if (removed[i].kind === 'directory') deletedDirectories.push(removed[i].path)
        }
      }
      for (let i = 0; i < added.length; i++) {
        if (!paired.usedAdded.has(i) && !coversAdded(added[i], paired.moves)
          && !createdDirectories.some(function (path) { return within(added[i].path, path) })) {
          changes.push({ type: 'created', path: added[i].path, kind: added[i].kind })
          if (added[i].kind === 'directory') createdDirectories.push(added[i].path)
        }
      }
      after.forEach(function (item, path) {
        const previous = before.get(path)
        if (!previous || item.kind !== 'file') return
        if (item.size !== previous.size || item.mtime !== previous.mtime || forcedModified.has(path)) {
          changes.push({ type: 'modified', path: path, kind: 'file' })
        }
      })

      const now = Date.now()
      const unique = new Map()
      changes.forEach(function (change) {
        if (change.path === '' || own(change, now)) return
        const key = change.type + ':' + (change.fromPath || '') + ':' + change.path
        unique.set(key, change)
      })
      return Array.from(unique.values()).sort(function (a, b) {
        return a.path.localeCompare(b.path) || a.type.localeCompare(b.type)
      })
    }

    function publish(changes, batchSource) {
      if (!changes.length || disposed) return
      const batch = { changes: changes, source: batchSource, time: Date.now() }
      listeners.forEach(function (record) {
        const relevant = changes.some(function (change) {
          return change.type === 'unavailable' || intersects(change.path, record.path)
            || !!change.fromPath && intersects(change.fromPath, record.path)
        })
        if (!relevant) return
        const callback = function () { record.listener(batch) }
        if (aiditor.safeCall) aiditor.safeCall({ scope: 'workspace-watch', path: record.path }, callback)
        else callback()
      })
    }

    function unavailable(reason) {
      if (permissionLost) return
      permissionLost = true
      publish([{ type: 'unavailable', path: '', kind: 'directory', reason: reason }], 'permission')
      stopNative()
      stopPolling()
      attachForeground()
    }

    async function flush() {
      mergeTimer = null
      if (!started || disposed || !pendingScopes.size) return
      if (!ready) {
        mergeTimer = setTimeout(flush, MERGE_DELAY)
        return
      }
      const scopes = compactScopes(pendingScopes)
      pendingScopes.clear()
      const batchSource = source
      source = 'observer'
      try {
        const next = await scan(scopes)
        const changes = await changesBetween(snapshot, next)
        snapshot = next
        publish(changes, batchSource)
        permissionLost = false
        if (observerErrored) {
          observerErrored = false
          stopNative()
          startPolling()
        }
      } catch (err) {
        if (permissionError(err)) unavailable('permission_lost')
        else if (aiditor.reportError) aiditor.reportError({ scope: 'workspace-watch', action: 'scan' }, err)
      } finally {
        forcedModified.clear()
        hintedMoves.length = 0
      }
    }

    function queue(scopes, nextSource) {
      for (let i = 0; i < scopes.length; i++) pendingScopes.add(normalize(scopes[i]))
      if (nextSource === 'focus' || nextSource === 'poll') source = nextSource
      if (!mergeTimer) mergeTimer = setTimeout(flush, MERGE_DELAY)
    }

    function knownDirectory(path) {
      const item = snapshot.get(path)
      return !!item && item.kind === 'directory'
    }

    function onRecords(records) {
      if (disposed || !listeners.size) return
      const scopes = []
      for (let i = 0; i < records.length; i++) {
        const record = records[i]
        const path = componentsPath(record.relativePathComponents)
        if (record.type === 'errored') {
          observerErrored = true
          scopes.push('')
        } else if (record.type === 'unknown') {
          scopes.push(knownDirectory(path) ? path : parent(path))
        } else if (record.type === 'moved') {
          const from = componentsPath(record.relativePathMovedFrom)
          hintedMoves.push({ from: from, to: path })
          scopes.push(parent(from), parent(path))
        } else if (record.type === 'modified') {
          forcedModified.add(path)
          scopes.push(path)
        } else {
          scopes.push(parent(path))
        }
      }
      queue(scopes, 'observer')
    }

    function stopNative() {
      if (observer) observer.disconnect()
      observer = null
    }

    function watchedScopes() {
      const out = []
      listeners.forEach(function (record) {
        const item = snapshot.get(record.path)
        out.push(item && item.kind === 'directory' ? record.path : parent(record.path))
      })
      return compactScopes(new Set(out.length ? out : ['']))
    }

    function poll(sourceName) {
      if (!disposed && listeners.size && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        queue(watchedScopes(), sourceName)
      }
    }

    function startPolling() {
      if (pollTimer || disposed || !listeners.size) return
      attachForeground()
      pollTimer = setInterval(function () { poll('poll') }, POLL_INTERVAL)
    }

    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }

    function onFocus() {
      if (!permissionLost) poll('focus')
      else restartAfterPermission().catch(startError)
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') onFocus()
    }

    let foregroundAttached = false
    function attachForeground() {
      if (foregroundAttached) return
      foregroundAttached = true
      window.addEventListener('focus', onFocus)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    }

    function detachForeground() {
      if (!foregroundAttached) return
      foregroundAttached = false
      window.removeEventListener('focus', onFocus)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    }

    async function restartAfterPermission() {
      if (!await permissionGranted()) return
      permissionLost = false
      await begin(true, generation)
    }

    function active(token) {
      return started && !disposed && listeners.size > 0 && token === generation
    }

    function startError(err) {
      if (permissionError(err)) unavailable('permission_lost')
      else if (aiditor.reportError) aiditor.reportError({ scope: 'workspace-watch', action: 'start' }, err)
    }

    async function begin(restart, token) {
      if (starting) return starting
      starting = (async function () {
        if (!restart) {
          const initial = await scan([''])
          if (!active(token)) return
          snapshot = initial
        }
        if (typeof window.FileSystemObserver === 'function') {
          try {
            if (!await permissionGranted()) {
              const denied = new Error('Workspace directory permission is not granted')
              denied.name = 'NotAllowedError'
              throw denied
            }
            if (!active(token)) return
            observer = new window.FileSystemObserver(onRecords)
            await observer.observe(rootHandle, { recursive: true })
            if (!active(token)) {
              stopNative()
              return
            }
            if (!restart) {
              const verified = await scan([''])
              if (!active(token)) {
                stopNative()
                return
              }
              const setupChanges = await changesBetween(snapshot, verified)
              snapshot = verified
              publish(setupChanges, 'observer')
              forcedModified.clear()
              hintedMoves.length = 0
            }
            ready = true
            stopPolling()
            detachForeground()
          } catch (err) {
            stopNative()
            if (!active(token)) return
            if (permissionError(err)) unavailable('permission_lost')
            else {
              ready = true
              startPolling()
            }
          }
        } else {
          if (!active(token)) return
          ready = true
          startPolling()
        }
        if (restart && ready && active(token)) queue([''], 'focus')
      })().finally(function () {
        starting = null
        if (token !== generation && started && listeners.size && !ready && !permissionLost && !disposed) {
          begin(false, generation).catch(startError)
        }
      })
      return starting
    }

    function start() {
      if (started || disposed) return
      started = true
      const token = ++generation
      begin(false, token).catch(startError)
    }

    function stop() {
      if (!started) return
      started = false
      generation++
      ready = false
      stopNative()
      stopPolling()
      detachForeground()
      if (mergeTimer) clearTimeout(mergeTimer)
      mergeTimer = null
      pendingScopes.clear()
      forcedModified.clear()
      hintedMoves.length = 0
      ownPaths.clear()
      snapshot = new Map()
    }

    function watch(path, listener) {
      if (disposed) throw new Error('workspace.watch: workspace is disposed')
      if (typeof listener !== 'function') throw new Error('workspace.watch: listener must be a function')
      const id = ++listenerId
      listeners.set(id, { path: normalize(path), listener: listener })
      start()
      let active = true
      return function () {
        if (!active) return
        active = false
        listeners.delete(id)
        if (!listeners.size) stop()
      }
    }

    function markOwn(paths) {
      const expires = Date.now() + 1500
      for (let i = 0; i < paths.length; i++) ownPaths.set(normalize(paths[i]), expires)
    }

    function wrap(name, pathsForArgs) {
      const original = api[name]
      if (typeof original !== 'function') return
      api[name] = async function () {
        const args = Array.prototype.slice.call(arguments)
        const result = await original.apply(this, args)
        markOwn(pathsForArgs(args))
        if (started) queue(pathsForArgs(args).map(parent), 'observer')
        return result
      }
    }

    wrap('writeText', function (args) { return [args[0]] })
    wrap('writeBlob', function (args) { return [args[0]] })
    wrap('mkdir', function (args) { return [args[0]] })
    wrap('delete', function (args) { return [args[0]] })
    wrap('copy', function (args) { return [args[1]] })
    wrap('move', function (args) { return [args[0], args[1]] })
    wrap('rename', function (args) { return [args[0], args[1]] })
    wrap('patchText', function (args) { return [args[0]] })

    function dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      stop()
    }

    return { watch: watch, dispose: dispose }
  }

  workspace._watch = { create: create }
})(window.aiditor = window.aiditor || {})

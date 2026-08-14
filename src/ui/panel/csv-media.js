// Compact image/audio projection for GameCSV cells.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv

  function directUrl(value) { return /^(?:https?:|data:|blob:)/i.test(value) }

  function imagePreview(valueSig, workspace) {
    const frame = ui.h('span', 'aiditor-csv-image-preview')
    const image = ui.h('img', 'aiditor-csv-cell-thumbnail', { alt: '' })
    const missing = ui.icon({ name: 'image', size: 'sm' })
    missing.classList.add('aiditor-csv-image-placeholder')
    frame.appendChild(image)
    frame.appendChild(missing)
    let lease = null
    let generation = 0

    function release() {
      if (lease) lease.release()
      lease = null
    }
    function render(value) {
      generation++
      const current = generation
      release()
      value = value == null ? '' : String(value)
      frame.dataset.state = value ? 'loading' : 'empty'
      image.removeAttribute('src')
      if (!value) return
      image.onload = function () { if (current === generation) frame.dataset.state = 'ready' }
      image.onerror = function () { if (current === generation) frame.dataset.state = 'missing' }
      if (directUrl(value)) { image.src = value; return }
      image.src = workspace.resolveUrl(value)
      workspace.createObjectUrl(value).then(function (nextLease) {
        if (current !== generation) { nextLease.release(); return }
        lease = nextLease
        image.src = nextLease.url
      }).catch(function () { if (current === generation) frame.dataset.state = 'missing' })
    }

    ui.bind(frame, valueSig, render)
    ui.collect(frame, release)
    return frame
  }

  function imageCell(options) {
    const root = ui.h('span', 'aiditor-csv-cell-media')
    root.dataset.kind = 'img'
    const preview = imagePreview(options.value, options.workspace)
    const label = ui.h('span', 'aiditor-csv-cell-media-label')
    root.appendChild(preview)
    root.appendChild(label)
    ui.collect(root, function () { ui.dispose(preview) })
    ui.bind(root, options.value, function (value) { label.textContent = value == null ? '' : String(value) })
    options.attachSource(preview)
    options.attachTarget(root)
    return root
  }

  function audioCell(options) {
    const root = ui.h('span', 'aiditor-csv-cell-media')
    root.dataset.kind = 'snd'
    const handle = csv.drag.grip(options.descriptor(), null)
    const play = ui.h('button', 'aiditor-csv-audio-play', { type: 'button', title: 'Play audio', 'aria-label': 'Play audio' })
    const icon = ui.h('span', 'aiditor-csv-audio-play-icon')
    const info = ui.h('span', 'aiditor-csv-audio-info')
    const label = ui.h('span', 'aiditor-csv-cell-media-label')
    const track = ui.h('span', 'aiditor-csv-audio-track')
    const progress = ui.h('span', 'aiditor-csv-audio-progress')
    track.appendChild(progress)
    info.appendChild(label)
    info.appendChild(track)
    play.appendChild(icon)
    root.appendChild(handle)
    root.appendChild(play)
    root.appendChild(info)
    ui.collect(root, function () { ui.dispose(handle) })

    let audio = null
    let lease = null
    let loading = null
    let generation = 0

    function setState(state) {
      root.dataset.state = state
      play.title = state === 'playing' ? 'Pause audio' : state === 'loading' ? 'Loading audio' : state === 'missing' ? 'Audio file not found' : 'Play audio'
      play.setAttribute('aria-label', play.title)
    }
    function release() {
      if (audio) {
        audio.pause()
        audio.src = ''
      }
      audio = null
      loading = null
      if (lease) lease.release()
      lease = null
    }
    function reset(value) {
      generation++
      release()
      value = value == null ? '' : String(value)
      label.textContent = value ? value.split(/[\\/]/).pop() || value : ''
      progress.style.width = '0%'
      play.disabled = !value
      setState(value ? 'idle' : 'empty')
    }
    function wire(nextAudio, current) {
      audio = nextAudio
      audio.addEventListener('play', function () { if (current === generation) setState('playing') })
      audio.addEventListener('pause', function () { if (current === generation && audio.currentTime < audio.duration) setState('idle') })
      audio.addEventListener('ended', function () {
        if (current !== generation) return
        progress.style.width = '0%'
        setState('idle')
      })
      audio.addEventListener('timeupdate', function () {
        if (current !== generation || !Number.isFinite(audio.duration) || !audio.duration) return
        progress.style.width = Math.max(0, Math.min(100, audio.currentTime / audio.duration * 100)) + '%'
      })
      audio.addEventListener('error', function () { if (current === generation) setState('missing') })
      return audio.play()
    }
    function start() {
      const value = String(options.value.peek() || '')
      if (!value || loading) return
      if (audio) {
        if (audio.paused) audio.play().catch(function () { setState('missing') })
        else audio.pause()
        return
      }
      const current = generation
      setState('loading')
      loading = (directUrl(value) ? Promise.resolve({ url: value }) : options.workspace.createObjectUrl(value))
        .then(function (source) {
          if (current !== generation) { if (source.release) source.release(); return }
          lease = source.release ? source : null
          return wire(new Audio(source.url), current)
        }).catch(function () { if (current === generation) setState('missing') })
        .finally(function () { if (current === generation) loading = null })
    }

    ui.bind(root, options.value, reset)
    play.addEventListener('pointerdown', function (event) { event.stopPropagation() })
    play.addEventListener('click', function (event) { event.preventDefault(); start() })
    ui.collect(root, release)
    options.attachTarget(root)
    return root
  }

  csv.media = {
    imagePreview: imagePreview,
    render: function (kind, options) { return kind === 'img' ? imageCell(options) : audioCell(options) },
  }
})(window.aiditor = window.aiditor || {})

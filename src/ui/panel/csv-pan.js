// CSV viewport middle-button grab panning.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const csv = ui.csv = ui.csv || {}

  function attach(grid) {
    const viewport = grid.querySelector('.aiditor-ui-data-grid-body')
    let stop = null

    function finish() {
      if (!stop) return
      stop()
      stop = null
    }

    function begin(event) {
      if (event.button !== 1) return
      event.preventDefault()
      event.stopPropagation()
      finish()

      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      const startLeft = viewport.scrollLeft
      const startTop = viewport.scrollTop
      grid.classList.add('aiditor-csv-panning')

      function move(next) {
        if (next.pointerId !== pointerId) return
        viewport.scrollLeft = startLeft - (next.clientX - startX)
        viewport.scrollTop = startTop - (next.clientY - startY)
      }

      function end(next) {
        if (next && next.pointerId !== pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', end)
        document.removeEventListener('pointercancel', end)
        document.removeEventListener('keydown', cancel, true)
        grid.classList.remove('aiditor-csv-panning')
        stop = null
      }

      function cancel(next) {
        if (next.key !== 'Escape') return
        next.preventDefault()
        next.stopPropagation()
        end()
      }

      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', end)
      document.addEventListener('pointercancel', end)
      document.addEventListener('keydown', cancel, true)
      stop = end
    }

    function blockMiddleClick(event) {
      if (event.button === 1) event.preventDefault()
    }

    grid.addEventListener('pointerdown', begin, true)
    grid.addEventListener('auxclick', blockMiddleClick, true)
    return function () {
      finish()
      grid.removeEventListener('pointerdown', begin, true)
      grid.removeEventListener('auxclick', blockMiddleClick, true)
    }
  }

  csv.pan = { attach: attach }
})(window.aiditor = window.aiditor || {})

;(function (aiditor) {
  'use strict'

  const frameworkUi = aiditor.ui = aiditor.ui || {}
  const timeline = frameworkUi.timeline = frameworkUi.timeline || {}

  function createTimelineSurface(root, options) {
    const opts = options || {}
    const layout = opts.layout || (timeline.createLayout && timeline.createLayout())
    if (!root || !layout) throw new Error('Timeline surface requires a root and layout.')
    const ownerDocument = root.ownerDocument || document
    const ownerWindow = ownerDocument.defaultView || window
    const classes = Object.assign({}, defaultClasses(), opts.classes || {})
    const elements = createElements(root, classes, opts, ownerDocument)
    const listeners = []
    const observers = []
    let paintFrame = null
    let disposed = false
    let currentFrame = layout.frame({})
    root.classList.add('aiditor-ui-timeline')
    root.style.setProperty('--aiditor-timeline-ruler-size', layout.config.rulerSize + 'px')
    if (frameworkUi.collect) frameworkUi.collect(root, dispose)

    return {
      kind: 'timelineSurface',
      elements: elements,
      layout: layout,
      frame: function () { return currentFrame },
      bindInput: bindInput,
      observeResize: observeResize,
      resize: resize,
      requestPaint: requestPaint,
      cancelPaint: cancelPaint,
      pointFromEvent: function (event) { return layout.pointFromEvent(event, elements.canvas, currentFrame) },
      hitTest: function (model, point, input) { return layout.hitTest(model, currentFrame, point, input) },
      valueAtX: function (x, clampToRange) { return layout.xToValue(x, currentFrame, clampToRange) },
      setSelectionBox: setSelectionBox,
      capturePointer: capturePointer,
      releasePointer: releasePointer,
      setBoundaryInsets: setBoundaryInsets,
      updateBoundaryHandle: updateBoundaryHandle,
      dispose: dispose,
    }

    function bindInput(input) {
      const handlers = input || {}
      const canvas = elements.canvas
      const boundaryHandle = elements.boundaryHandle
      const scroll = elements.scroll
      bindPointerSurface(canvas, handlers.onPointerDown, handlers)
      if (boundaryHandle) bindPointerSurface(boundaryHandle, handlers.onBoundaryPointerDown || handlers.onPointerDown, handlers)
      listen(canvas, 'dblclick', function (event) {
        if (!enabled(handlers)) return
        call(handlers.onDoubleClick, event)
      })
      listen(root, 'keydown', function (event) {
        if (event.key !== 'Escape' || !hasTransientInput(handlers)) return
        event.preventDefault()
        call(handlers.onCancel, { reason: 'escape', event: event })
      })
      listen(scroll, 'scroll', function (event) {
        notifyScroll(handlers, event, 'scroll')
      })
      listen(scroll, 'wheel', function (event) {
        handleWheel(handlers, event, false)
      }, { passive: false })
      listen(canvas, 'wheel', function (event) {
        handleWheel(handlers, event, true)
      }, { passive: false })
      listen(ownerWindow, 'blur', function (event) {
        call(handlers.onInterrupt, { reason: 'blur', event: event })
      })
      listen(ownerDocument, 'visibilitychange', function (event) {
        if (ownerDocument.hidden) call(handlers.onInterrupt, { reason: 'hidden', event: event })
      })
      return function unbindTimelineInput() {
        while (listeners.length) listeners.pop()()
      }
    }

    function observeResize(callback) {
      if (ownerWindow.ResizeObserver) {
        const observer = new ownerWindow.ResizeObserver(function () { call(callback) })
        observer.observe(elements.scroll)
        observers.push(function () { observer.disconnect() })
        return observers[observers.length - 1]
      }
      const handler = function () { call(callback) }
      ownerWindow.addEventListener('resize', handler)
      const cleanup = function () { ownerWindow.removeEventListener('resize', handler) }
      observers.push(cleanup)
      return cleanup
    }

    function resize(input) {
      const source = input || {}
      const viewportWidth = Math.max(1, Math.floor(source.width || elements.scroll.clientWidth || elements.body.clientWidth || 1))
      const viewportHeight = Math.max(1, Math.floor(source.height || elements.scroll.clientHeight || 1))
      currentFrame = layout.frame(Object.assign({}, source, {
        width: viewportWidth,
        height: viewportHeight,
        scrollLeft: elements.scroll.scrollLeft,
        scrollTop: elements.scroll.scrollTop,
      }))
      const extraContent = Math.max(0, numberValue(source.extraContentSize, 0))
      const totalContentSize = currentFrame.layout.timelineStart + currentFrame.contentSize + extraContent
      elements.spacer.style.height = currentFrame.contentHeight + 'px'
      elements.spacer.style.width = totalContentSize + 'px'
      elements.spacer.style.minWidth = totalContentSize + 'px'
      const dpr = Math.max(1, numberValue(source.devicePixelRatio, ownerWindow.devicePixelRatio || 1))
      elements.canvas.style.width = currentFrame.width + 'px'
      elements.canvas.style.height = currentFrame.height + 'px'
      const pixelWidth = Math.max(1, Math.floor(currentFrame.width * dpr))
      const pixelHeight = Math.max(1, Math.floor(currentFrame.height * dpr))
      if (elements.canvas.width !== pixelWidth) elements.canvas.width = pixelWidth
      if (elements.canvas.height !== pixelHeight) elements.canvas.height = pixelHeight
      syncDataset(elements.canvas, currentFrame)
      return currentFrame
    }

    function requestPaint(callback) {
      if (disposed || paintFrame != null) return false
      paintFrame = requestFrame(ownerWindow, function () {
        paintFrame = null
        if (!disposed) call(callback, currentFrame)
      })
      return true
    }

    function cancelPaint() {
      if (paintFrame == null) return
      cancelFrame(ownerWindow, paintFrame)
      paintFrame = null
    }

    function setSelectionBox(box) {
      const element = elements.selectionBox
      if (!element || !box) {
        if (element) element.hidden = true
        return
      }
      const startX = numberValue(box.startX, 0)
      const startY = numberValue(box.startY, 0)
      const endX = box.endX == null
        ? numberValue(box.currentX, startX)
        : numberValue(box.endX, startX)
      const endY = box.endY == null
        ? numberValue(box.currentY, startY)
        : numberValue(box.endY, startY)
      const x = Math.min(startX, endX)
      const y = Math.min(startY, endY)
      const width = Math.abs(endX - startX)
      const height = Math.abs(endY - startY)
      element.hidden = width < 1 && height < 1
      element.style.left = x + 'px'
      element.style.top = y + 'px'
      element.style.width = width + 'px'
      element.style.height = height + 'px'
    }

    function capturePointer(target, pointerId) {
      const element = target || elements.canvas
      if (!element || !element.setPointerCapture || pointerId == null) return false
      try {
        element.setPointerCapture(pointerId)
        return true
      } catch (_) {
        return false
      }
    }

    function releasePointer(target, pointerId) {
      const element = target || elements.canvas
      if (!element || !element.releasePointerCapture || pointerId == null) return false
      try {
        element.releasePointerCapture(pointerId)
        return true
      } catch (_) {
        return false
      }
    }

    function setBoundaryInsets(left, right) {
      if (!elements.boundaryOverlay) return
      elements.boundaryOverlay.style.left = Math.max(0, numberValue(left, 0)) + 'px'
      elements.boundaryOverlay.style.right = Math.max(0, numberValue(right, 0)) + 'px'
    }

    function updateBoundaryHandle(value, options) {
      const handle = elements.boundaryHandle
      const overlay = elements.boundaryOverlay
      if (!handle || !overlay || value == null) {
        if (handle) handle.hidden = true
        return false
      }
      const input = options || {}
      const x = layout.valueToX(value, currentFrame)
      const localX = x - currentFrame.layout.timelineStart
      const halfSize = Math.max(0, numberValue(input.halfSize, 0))
      const width = Math.max(0, overlay.clientWidth || 0)
      handle.hidden = localX < halfSize || localX > width - halfSize
      handle.style.left = localX + 'px'
      handle.setAttribute('aria-valuenow', String(value))
      if (input.valueText != null) handle.setAttribute('aria-valuetext', String(input.valueText))
      return !handle.hidden
    }

    function bindPointerSurface(surface, pointerDown, handlers) {
      listen(surface, 'pointerdown', function (event) {
        if (!enabled(handlers)) return
        focusRoot(root)
        call(pointerDown, event)
      })
      listen(surface, 'pointermove', function (event) { call(handlers.onPointerMove, event) })
      listen(surface, 'pointerup', function (event) { call(handlers.onPointerUp, event) })
      listen(surface, 'pointercancel', function (event) { call(handlers.onCancel, { reason: 'pointercancel', event: event }) })
      listen(surface, 'pointerleave', function (event) { call(handlers.onPointerLeave, event) })
      listen(surface, 'lostpointercapture', function (event) { call(handlers.onCancel, { reason: 'lostpointercapture', event: event }) })
    }

    function handleWheel(handlers, event, fromFixedCanvas) {
      if (!enabled(handlers)) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const rect = elements.scroll.getBoundingClientRect()
        call(handlers.onZoom, {
          anchorX: event.clientX - rect.left,
          event: event,
          factor: event.deltaY > 0 ? 0.88 : 1.14,
        })
        return
      }
      if (event.shiftKey) {
        const delta = dominantWheelDelta(event, elements.scroll.clientHeight)
        if (!delta) return
        event.preventDefault()
        elements.scroll.scrollLeft = Math.max(0, numberValue(elements.scroll.scrollLeft, 0) + delta)
        notifyScroll(handlers, event, 'shift-wheel')
        return
      }
      if (!fromFixedCanvas) return
      const delta = wheelDelta(event, elements.scroll.clientHeight)
      if (!delta.x && !delta.y) return
      event.preventDefault()
      elements.scroll.scrollLeft = Math.max(0, numberValue(elements.scroll.scrollLeft, 0) + delta.x)
      elements.scroll.scrollTop = Math.max(0, numberValue(elements.scroll.scrollTop, 0) + delta.y)
      notifyScroll(handlers, event, 'canvas-wheel')
    }

    function notifyScroll(handlers, event, source) {
      currentFrame = Object.assign({}, currentFrame, {
        scrollLeft: Math.max(0, numberValue(elements.scroll.scrollLeft, 0)),
        scrollTop: Math.max(0, numberValue(elements.scroll.scrollTop, 0)),
      })
      syncDataset(elements.canvas, currentFrame)
      call(handlers.onScroll, {
        event: event,
        left: currentFrame.scrollLeft,
        top: currentFrame.scrollTop,
        source: source,
      })
    }

    function listen(target, type, handler, listenerOptions) {
      target.addEventListener(type, handler, listenerOptions)
      const cleanup = function () { target.removeEventListener(type, handler, listenerOptions) }
      listeners.push(cleanup)
      return cleanup
    }

    function dispose() {
      if (disposed) return
      disposed = true
      cancelPaint()
      while (listeners.length) listeners.pop()()
      while (observers.length) observers.pop()()
    }
  }

  function createElements(root, classes, options, ownerDocument) {
    const createElement = function (tag, className) { return element(ownerDocument, tag, className) }
    const toolbar = createElement('div', classes.toolbar)
    const body = createElement('div', classes.body)
    const footer = createElement('div', classes.footer)
    const header = createElement('div', classes.header)
    const headerLeft = createElement('div', classes.headerLeft)
    const headerRight = createElement('div', classes.headerRight)
    const scroll = frameworkUi.scrollArea ? frameworkUi.scrollArea({ both: true }) : createElement('div', '')
    scroll.classList.add.apply(scroll.classList, classList(classes.scroll))
    const spacer = createElement('div', classes.spacer)
    const canvas = createElement('canvas', classes.canvas)
    const selectionBox = createElement('div', classes.selectionBox)
    const boundaryOverlay = createElement('div', classes.boundaryOverlay)
    const boundaryHandle = createElement('div', classes.boundaryHandle)
    const emptyState = createElement('div', classes.emptyState)
    const emptyTitle = createElement('div', classes.emptyTitle)
    const emptyText = createElement('div', classes.emptyText)
    const emptyAction = createElement('div', classes.emptyAction)
    selectionBox.hidden = true
    boundaryHandle.hidden = true
    emptyState.hidden = true
    boundaryHandle.title = options.boundaryTitle || 'Drag boundary'
    boundaryHandle.setAttribute('role', 'slider')
    boundaryHandle.setAttribute('aria-label', options.boundaryLabel || 'Timeline boundary')
    boundaryHandle.setAttribute('aria-valuemin', String(options.boundaryMin == null ? 0 : options.boundaryMin))
    header.appendChild(headerLeft)
    header.appendChild(headerRight)
    scroll.appendChild(spacer)
    boundaryOverlay.appendChild(boundaryHandle)
    emptyState.appendChild(emptyTitle)
    emptyState.appendChild(emptyText)
    emptyState.appendChild(emptyAction)
    body.appendChild(header)
    body.appendChild(scroll)
    body.appendChild(canvas)
    body.appendChild(boundaryOverlay)
    body.appendChild(selectionBox)
    body.appendChild(emptyState)
    root.appendChild(toolbar)
    root.appendChild(body)
    root.appendChild(footer)
    return {
      root: root,
      toolbar: toolbar,
      body: body,
      footer: footer,
      header: header,
      headerLeft: headerLeft,
      headerRight: headerRight,
      scroll: scroll,
      spacer: spacer,
      canvas: canvas,
      selectionBox: selectionBox,
      boundaryOverlay: boundaryOverlay,
      boundaryHandle: boundaryHandle,
      emptyState: emptyState,
      emptyTitle: emptyTitle,
      emptyText: emptyText,
      emptyAction: emptyAction,
    }
  }

  function defaultClasses() {
    return {
      toolbar: 'aiditor-ui-timeline-toolbar',
      body: 'aiditor-ui-timeline-body',
      footer: 'aiditor-ui-timeline-footer',
      header: 'aiditor-ui-timeline-header',
      headerLeft: 'aiditor-ui-timeline-header-left',
      headerRight: 'aiditor-ui-timeline-header-right',
      scroll: 'aiditor-ui-timeline-scroll',
      spacer: 'aiditor-ui-timeline-spacer',
      canvas: 'aiditor-ui-timeline-canvas',
      selectionBox: 'aiditor-ui-timeline-selection-box',
      boundaryOverlay: 'aiditor-ui-timeline-boundary-overlay',
      boundaryHandle: 'aiditor-ui-timeline-boundary-handle',
      emptyState: 'aiditor-ui-timeline-empty',
      emptyTitle: 'aiditor-ui-timeline-empty-title',
      emptyText: 'aiditor-ui-timeline-empty-text',
      emptyAction: 'aiditor-ui-timeline-empty-action',
    }
  }

  function syncDataset(canvas, frame) {
    canvas.dataset.logicalWidth = String(frame.width)
    canvas.dataset.logicalHeight = String(frame.height)
    canvas.dataset.scrollLeft = String(frame.scrollLeft)
    canvas.dataset.scrollTop = String(frame.scrollTop)
    canvas.dataset.timelineContentSize = String(frame.contentSize)
    canvas.dataset.timelineScale = String(frame.scale)
    canvas.dataset.timelineLabelSize = String(frame.labelSize)
  }

  function classList(value) {
    return String(value || '').split(/\s+/).filter(Boolean)
  }

  function element(ownerDocument, tag, className) {
    const node = ownerDocument.createElement(tag)
    node.className = className || ''
    return node
  }

  function enabled(input) {
    return typeof input.enabled !== 'function' || input.enabled()
  }

  function hasTransientInput(input) {
    return typeof input.hasTransientInput === 'function' ? !!input.hasTransientInput() : true
  }

  function focusRoot(root) {
    if (!root || typeof root.focus !== 'function') return
    try { root.focus({ preventScroll: true }) } catch (_) { root.focus() }
  }

  function dominantWheelDelta(event, pageSize) {
    const delta = wheelDelta(event, pageSize)
    return Math.abs(delta.x) > Math.abs(delta.y) ? delta.x : delta.y
  }

  function wheelDelta(event, pageSize) {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, pageSize || 1) : 1
    return { x: numberValue(event.deltaX, 0) * unit, y: numberValue(event.deltaY, 0) * unit }
  }

  function requestFrame(ownerWindow, fn) {
    return typeof ownerWindow.requestAnimationFrame === 'function'
      ? ownerWindow.requestAnimationFrame(fn)
      : ownerWindow.setTimeout(fn, 16)
  }

  function cancelFrame(ownerWindow, id) {
    if (typeof ownerWindow.cancelAnimationFrame === 'function') ownerWindow.cancelAnimationFrame(id)
    else ownerWindow.clearTimeout(id)
  }

  function numberValue(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function call(handler, value) {
    if (typeof handler === 'function') return handler(value)
  }

  timeline.createSurface = createTimelineSurface
})(window.aiditor = window.aiditor || {})

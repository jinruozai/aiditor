import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class EventTarget {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag || 'div').toUpperCase()
    this.ownerDocument = ownerDocument || null
    this.children = []
    this.parentNode = null
    this.className = ''
    this.dataset = {}
    this.attributes = {}
    this.events = new Map()
    this.hidden = false
    this.clientWidth = 500
    this.clientHeight = 180
    this.scrollLeft = 0
    this.scrollTop = 0
    this.style = {
      setProperty(name, value) { this[name] = String(value) },
    }
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean))
        names.forEach((name) => classes.add(name))
        this.className = Array.from(classes).join(' ')
      },
      remove: (...names) => {
        const remove = new Set(names)
        this.className = this.className.split(/\s+/).filter((name) => name && !remove.has(name)).join(' ')
      },
      contains: (name) => this.className.split(/\s+/).indexOf(name) >= 0,
      toggle: (name, force) => {
        const present = this.className.split(/\s+/).indexOf(name) >= 0
        const next = force == null ? !present : !!force
        if (next && !present) this.classList.add(name)
        if (!next && present) this.classList.remove(name)
        return next
      },
    }
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    this.children.push(child)
    child.parentNode = this
    return child
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, new Set())
    this.events.get(type).add(listener)
  }
  removeEventListener(type, listener) {
    const listeners = this.events.get(type)
    if (listeners) listeners.delete(listener)
  }
  emit(type, event) {
    const value = event || {}
    const listeners = this.events.get(type)
    if (listeners) Array.from(listeners).forEach((listener) => listener(value))
    return value
  }
  focus() { this.focused = true }
  getBoundingClientRect() { return { left: 10, top: 20, width: 500, height: 180 } }
}

const scheduledFrames = []
const ownerWindow = new EventTarget('window')
ownerWindow.devicePixelRatio = 2
ownerWindow.requestAnimationFrame = function (callback) {
  scheduledFrames.push(callback)
  return scheduledFrames.length
}
ownerWindow.cancelAnimationFrame = function (id) { scheduledFrames[id - 1] = null }
ownerWindow.setTimeout = setTimeout
ownerWindow.clearTimeout = clearTimeout

const ownerDocument = new EventTarget('document')
ownerDocument.defaultView = ownerWindow
ownerDocument.hidden = false
ownerDocument.createElement = function (tag) { return new EventTarget(tag, ownerDocument) }

global.HTMLElement = EventTarget
global.document = ownerDocument
global.window = { aiditor: {}, HTMLElement: EventTarget }

for (const file of [
  'src/core/signal.js',
  'src/ui/_internal/_signal.js',
  'src/ui/container/scrollArea.js',
  'src/ui/timeline/layout.js',
  'src/ui/timeline/surface.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const ui = window.aiditor.ui
const timeline = ui.timeline
assert.equal(typeof timeline.createLayout, 'function')
assert.equal(typeof timeline.createSurface, 'function')
assert.equal(Object.isFrozen(timeline.defaults), true)

const layout = timeline.createLayout({ minContentSize: 1 })
const model = {
  rangeEnd: 2,
  authoredEnd: 2.5,
  boundary: 2,
  rowHeight: 30,
  markers: [{ id: 'marker-a', value: 0.5 }],
  rows: [
    { id: 'row-a', items: [{ id: 'item-a', value: 0.25 }, { id: 'item-b', value: 1 }] },
    { id: 'row-b', items: [{ id: 'item-c', value: 1.5 }] },
  ],
}
const frame = layout.frame({ model, width: 500, height: 180, labelSize: 120, scale: 100 })
assert.equal(frame.extent, 2.5)
assert.equal(frame.rowCount, 2)
assert.equal(layout.xToValue(layout.valueToX(1.25, frame), frame), 1.25)
assert.deepEqual(layout.orderedItemIdsInRange(model, 'item-a', 'item-c'), ['item-a', 'item-b', 'item-c'])
assert.deepEqual(layout.itemIdsInBox(model, {
  startValue: 0.9,
  endValue: 1.1,
  rowStart: 0,
  rowEnd: 0,
}), ['item-b'])
assert.equal(layout.hitTest(model, frame, { x: layout.valueToX(0.5, frame), y: 5 }).zone, 'marker')
assert.equal(layout.hitTest(model, frame, { x: layout.valueToX(1, frame), y: 41 }).item.id, 'item-b')

const alternate = {
  lanes: [{ points: [{ key: 'point-a', at: 3 }] }],
  pins: [{ at: 2 }],
  end: 4,
}
const accessors = {
  rows: (value) => value.lanes,
  items: (row) => row.points,
  itemId: (item) => item.key,
  itemValue: (item) => item.at,
  markers: (value) => value.pins,
  markerValue: (marker) => marker.at,
  rangeEnd: (value) => value.end,
  authoredEnd: (value) => value.end,
  boundary: (value) => value.end,
}
assert.equal(layout.extent(alternate, accessors), 4)
assert.deepEqual(layout.orderedItemIdsInRange(alternate, 'point-a', 'point-a', accessors), ['point-a'])

const root = new EventTarget('div', ownerDocument)
const surface = timeline.createSurface(root, { layout })
assert.equal(root.classList.contains('aiditor-ui-timeline'), true)
assert.equal(root.style['--aiditor-timeline-ruler-size'], '26px')
assert.equal(surface.elements.canvas.className, 'aiditor-ui-timeline-canvas')
surface.elements.scroll.clientWidth = 500
surface.elements.scroll.clientHeight = 180
surface.elements.scroll.scrollLeft = 20
surface.elements.scroll.scrollTop = 12
const resized = surface.resize({ model, width: 500, height: 180, labelSize: 120, scale: 100 })
assert.equal(resized.contentSize, 380)
assert.equal(surface.elements.canvas.width, 1000)
assert.equal(surface.elements.canvas.height, 360)

surface.setSelectionBox({ startX: 20, startY: 30, currentX: 70, currentY: 80 })
assert.equal(surface.elements.selectionBox.hidden, false)
assert.equal(surface.elements.selectionBox.style.width, '50px')
surface.setSelectionBox(null)
assert.equal(surface.elements.selectionBox.hidden, true)
surface.elements.boundaryOverlay.clientWidth = 500
assert.equal(surface.updateBoundaryHandle(2, { halfSize: 7, valueText: '2 units' }), true)
assert.equal(surface.elements.boundaryHandle.attributes['aria-valuetext'], '2 units')

let paintCount = 0
assert.equal(surface.requestPaint(() => { paintCount++ }), true)
assert.equal(surface.requestPaint(() => { paintCount++ }), false)
scheduledFrames.shift()()
assert.equal(paintCount, 1)

let pointerDown = 0
let cancelled = 0
let interrupted = 0
let transient = false
const scrollEvents = []
const zoomEvents = []
surface.bindInput({
  enabled: () => true,
  hasTransientInput: () => transient,
  onPointerDown: () => { pointerDown++ },
  onCancel: () => { cancelled++ },
  onInterrupt: () => { interrupted++ },
  onScroll: (event) => { scrollEvents.push(event) },
  onZoom: (event) => { zoomEvents.push(event) },
})

surface.elements.canvas.emit('pointerdown', pointerEvent())
assert.equal(root.focused, true)
assert.equal(pointerDown, 1)
const zoomWheel = pointerEvent({ clientX: 90, ctrlKey: true, deltaY: -1 })
surface.elements.scroll.emit('wheel', zoomWheel)
assert.equal(zoomWheel.defaultPrevented, true)
assert.equal(zoomEvents[0].anchorX, 80)
assert.equal(zoomEvents[0].factor, 1.14)
const shiftWheel = pointerEvent({ deltaY: 3, deltaMode: 1, shiftKey: true })
surface.elements.scroll.emit('wheel', shiftWheel)
assert.equal(surface.elements.scroll.scrollLeft, 68)
assert.equal(scrollEvents.at(-1).source, 'shift-wheel')

const escape = pointerEvent({ key: 'Escape' })
root.emit('keydown', escape)
assert.equal(cancelled, 0)
transient = true
root.emit('keydown', escape)
assert.equal(cancelled, 1)
surface.elements.canvas.emit('pointercancel', pointerEvent())
assert.equal(cancelled, 2)
ownerWindow.emit('blur', {})
ownerDocument.hidden = true
ownerDocument.emit('visibilitychange', {})
assert.equal(interrupted, 2)

ui.dispose(root)
surface.elements.canvas.emit('pointerdown', pointerEvent())
surface.elements.scroll.emit('wheel', pointerEvent({ clientX: 90, ctrlKey: true, deltaY: -1 }))
assert.equal(pointerDown, 1)
assert.equal(zoomEvents.length, 1)
assert.equal(surface.requestPaint(() => {}), false)

const css = readFileSync('src/style/ui-timeline.css', 'utf8')
assert.match(css, /\.aiditor-ui-timeline-body\s*\{/)
assert.match(css, /\.aiditor-ui-timeline-scroll\s*\{/)
assert.match(css, /\.aiditor-ui-timeline-selection-box\[hidden\]/)

console.log('timeline tests passed')

function pointerEvent(values) {
  return Object.assign({
    clientX: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }, values || {})
}

;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui = aiditor.ui || {}
  const timeline = ui.timeline = ui.timeline || {}

  const DEFAULTS = Object.freeze({
    rulerSize: 26,
    labelSize: 176,
    minLabelSize: 120,
    maxLabelSize: 420,
    minContentSize: 480,
    contentEndPadding: 80,
    defaultScale: 160,
    minScale: 24,
    maxScale: 800,
    itemHitRadius: 8,
    markerHitRadius: 8,
    boundaryHitRadius: 10,
    groupToggleSize: 20,
  })

  function createTimelineLayout(options) {
    const config = Object.assign({}, DEFAULTS, options || {})

    return Object.freeze({
      config: Object.freeze(Object.assign({}, config)),
      clamp: clamp,
      layout: layout,
      extent: extent,
      frame: frame,
      fitScale: fitScale,
      valueToContentX: valueToContentX,
      valueToX: valueToX,
      xToValue: xToValue,
      visibleValueRange: visibleValueRange,
      visibleRowRange: visibleRowRange,
      rowsWithCentersInBox: rowsWithCentersInBox,
      boxRange: boxRange,
      orderedItemIdsInRange: orderedItemIdsInRange,
      itemIdsInBox: itemIdsInBox,
      pointFromEvent: pointFromEvent,
      hitTest: hitTest,
      tickStep: tickStep,
      logicalSize: logicalSize,
    })

    function layout(width, labelSize) {
      const actual = Math.max(1, numberValue(width, 1))
      const maximum = Math.max(config.minLabelSize, Math.min(actual * 0.48, actual - 96))
      const preferred = labelSize == null
        ? actual < 560 ? Math.min(config.labelSize, 168) : config.labelSize
        : numberValue(labelSize, config.labelSize)
      const nameLimit = Math.floor(clamp(preferred, config.minLabelSize, maximum))
      const timelineStart = Math.max(1, Math.min(nameLimit, actual - 32))
      return {
        labelSize: timelineStart,
        timelineStart: timelineStart,
        timelineEnd: actual,
        timelineSize: Math.max(1, actual - timelineStart),
      }
    }

    function extent(model, accessors) {
      const a = normalizedAccessors(accessors)
      return Math.max(0, a.rangeEnd(model), a.authoredEnd(model))
    }

    function frame(input) {
      const source = input || {}
      const model = source.model || null
      const accessors = normalizedAccessors(source.accessors)
      const width = Math.max(1, numberValue(source.width, 1))
      const height = Math.max(1, numberValue(source.height, 1))
      const scale = clamp(numberValue(source.scale, config.defaultScale), config.minScale, config.maxScale)
      const timelineLayout = layout(width, source.labelSize)
      const modelExtent = Math.max(0, source.extent == null ? extent(model, accessors) : numberValue(source.extent, 0))
      const rangeEnd = Math.max(0, source.rangeEnd == null ? accessors.rangeEnd(model) : numberValue(source.rangeEnd, 0))
      const rowHeight = Math.max(1, numberValue(source.rowHeight, accessors.rowHeight(model)))
      const rows = accessors.rows(model)
      const rowCount = Math.max(0, source.rowCount == null ? rows.length : Math.floor(numberValue(source.rowCount, rows.length)))
      const contentSize = Math.max(
        timelineLayout.timelineSize,
        config.minContentSize,
        Math.ceil(modelExtent * scale) + config.contentEndPadding
      )
      return {
        width: width,
        height: height,
        scale: scale,
        labelSize: timelineLayout.labelSize,
        layout: timelineLayout,
        extent: modelExtent,
        rangeEnd: rangeEnd,
        rowHeight: rowHeight,
        rowCount: rowCount,
        contentSize: contentSize,
        contentHeight: config.rulerSize + Math.max(rowHeight, rowHeight * rowCount),
        scrollLeft: Math.max(0, numberValue(source.scrollLeft, 0)),
        scrollTop: Math.max(0, numberValue(source.scrollTop, 0)),
      }
    }

    function fitScale(valueExtent, viewportWidth, labelSize, reservedSize) {
      const timelineLayout = layout(viewportWidth, labelSize)
      const available = Math.max(1, timelineLayout.timelineSize - Math.max(0, numberValue(reservedSize, 0)))
      return clamp(available / Math.max(0.0001, numberValue(valueExtent, 0.0001)), config.minScale, config.defaultScale)
    }

    function valueToContentX(value, scale) {
      return Math.max(0, numberValue(value, 0)) * clamp(numberValue(scale, config.defaultScale), config.minScale, config.maxScale)
    }

    function valueToX(value, currentFrame) {
      const f = currentFrame || frame({})
      return f.layout.timelineStart + valueToContentX(value, f.scale) - Math.max(0, numberValue(f.scrollLeft, 0))
    }

    function xToValue(x, currentFrame, clampToRange) {
      const f = currentFrame || frame({})
      const contentX = Math.max(0, numberValue(f.scrollLeft, 0)) + numberValue(x, 0) - f.layout.timelineStart
      const value = Math.max(0, contentX / clamp(numberValue(f.scale, config.defaultScale), config.minScale, config.maxScale))
      return clampToRange === false ? value : Math.min(Math.max(0, f.rangeEnd), value)
    }

    function visibleValueRange(currentFrame, overscan) {
      const f = currentFrame || frame({})
      const extra = Math.max(0, numberValue(overscan, 0))
      return {
        start: Math.max(0, xToValue(f.layout.timelineStart, f, false) - extra),
        end: xToValue(f.layout.timelineEnd, f, false) + extra,
      }
    }

    function visibleRowRange(currentFrame) {
      const f = currentFrame || frame({})
      const visibleHeight = Math.max(0, f.height - config.rulerSize)
      return {
        start: Math.max(0, Math.floor(f.scrollTop / f.rowHeight) - 1),
        end: Math.min(f.rowCount, Math.ceil((f.scrollTop + visibleHeight) / f.rowHeight) + 1),
        scrollTop: f.scrollTop,
      }
    }

    function rowsWithCentersInBox(startY, endY, scrollTop, rowHeight, rowCount) {
      const count = Math.max(0, Math.floor(numberValue(rowCount, 0)))
      const height = Math.max(1, numberValue(rowHeight, 1))
      if (!count) return { empty: true, rowStart: 0, rowEnd: -1 }
      const top = Math.min(numberValue(startY, 0), numberValue(endY, 0)) + Math.max(0, numberValue(scrollTop, 0)) - config.rulerSize
      const bottom = Math.max(numberValue(startY, 0), numberValue(endY, 0)) + Math.max(0, numberValue(scrollTop, 0)) - config.rulerSize
      const epsilon = 0.000001
      const rowStart = Math.max(0, Math.ceil((top - height / 2) / height - epsilon))
      const rowEnd = Math.min(count - 1, Math.floor((bottom - height / 2) / height + epsilon))
      return { empty: rowStart > rowEnd, rowStart: rowStart, rowEnd: rowEnd }
    }

    function boxRange(box, currentFrame) {
      const source = box || {}
      const f = currentFrame || frame({})
      const originX = numberValue(source.startX, 0)
      const originY = numberValue(source.startY, 0)
      const currentX = source.endX == null
        ? numberValue(source.currentX, originX)
        : numberValue(source.endX, originX)
      const currentY = source.endY == null
        ? numberValue(source.currentY, originY)
        : numberValue(source.endY, originY)
      const startX = Math.min(originX, currentX)
      const endX = Math.max(originX, currentX)
      const startY = Math.min(originY, currentY)
      const endY = Math.max(originY, currentY)
      const rows = rowsWithCentersInBox(startY, endY, f.scrollTop, f.rowHeight, f.rowCount)
      return {
        empty: rows.empty,
        startValue: xToValue(startX, f, false),
        endValue: xToValue(endX, f, false),
        rowStart: rows.rowStart,
        rowEnd: rows.rowEnd,
      }
    }

    function orderedItemIdsInRange(model, anchorId, targetId, accessors) {
      const a = normalizedAccessors(accessors)
      const entries = orderedItems(model, a)
      if (!entries.length) return []
      const targetIndex = entries.findIndex(function (entry) { return a.itemId(entry.item) === String(targetId || '') })
      if (targetIndex < 0) return []
      const anchorIndex = entries.findIndex(function (entry) { return a.itemId(entry.item) === String(anchorId || '') })
      if (anchorIndex < 0) return [a.itemId(entries[targetIndex].item)]
      const start = Math.min(anchorIndex, targetIndex)
      const end = Math.max(anchorIndex, targetIndex)
      return unique(entries.slice(start, end + 1).map(function (entry) { return a.itemId(entry.item) }))
    }

    function itemIdsInBox(model, range, accessors, options) {
      const a = normalizedAccessors(accessors)
      const source = range || {}
      const input = options || {}
      if (!model || source.empty) return []
      const rows = a.rows(model)
      const startRow = Math.max(0, Math.min(numberValue(source.rowStart, 0), numberValue(source.rowEnd, 0)))
      const endRow = Math.min(rows.length - 1, Math.max(numberValue(source.rowStart, 0), numberValue(source.rowEnd, 0)))
      const startValue = Math.max(0, Math.min(numberValue(source.startValue, 0), numberValue(source.endValue, 0)))
      const endValue = Math.max(startValue, Math.max(numberValue(source.startValue, 0), numberValue(source.endValue, 0)))
      const ids = []
      for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
        const row = rows[rowIndex]
        const items = typeof input.itemCandidates === 'function'
          ? safeArray(input.itemCandidates(row, startValue, endValue))
          : a.items(row)
        items.forEach(function (item) {
          const value = a.itemValue(item)
          if (value >= startValue && value <= endValue) ids.push(a.itemId(item))
        })
      }
      return unique(ids)
    }

    function pointFromEvent(event, canvas, size) {
      const rect = canvas.getBoundingClientRect()
      const logical = size || logicalSize(canvas)
      return {
        x: (numberValue(event && event.clientX, rect.left) - rect.left) * logical.width / Math.max(1, rect.width),
        y: (numberValue(event && event.clientY, rect.top) - rect.top) * logical.height / Math.max(1, rect.height),
      }
    }

    function hitTest(model, currentFrame, point, options) {
      const f = currentFrame || frame({ model: model })
      const a = normalizedAccessors(options && options.accessors)
      const opts = options || {}
      const rows = a.rows(model)
      const x = numberValue(point && point.x, 0)
      const y = numberValue(point && point.y, 0)
      if (!model) return hit('empty', x, y)
      const zone = x < f.layout.timelineStart ? 'label' : x > f.layout.timelineEnd ? 'actions' : 'timeline'
      if (y < config.rulerSize) {
        if (zone !== 'timeline') return hit(zone, x, y)
        const markers = a.markers(model)
        for (let index = 0; index < markers.length; index++) {
          const marker = markers[index]
          if (Math.abs(x - valueToX(a.markerValue(marker), f)) <= config.markerHitRadius) {
            return Object.assign(hit('marker', x, y), { marker: marker })
          }
        }
        const boundary = opts.boundary == null ? a.boundary(model) : numberValue(opts.boundary, 0)
        if (Number.isFinite(boundary) && Math.abs(x - valueToX(boundary, f)) <= config.boundaryHitRadius) {
          return hit('boundary', x, y)
        }
        return hit('ruler', x, y)
      }
      if (!rows.length) return hit(zone, x, y)
      const rowIndex = Math.floor((f.scrollTop + y - config.rulerSize) / f.rowHeight)
      const row = rows[rowIndex] || null
      if (!row) return hit(zone, x, y)
      if (a.rowKind(row) === 'group') {
        const groupZone = zone === 'label' && x <= config.groupToggleSize ? 'group-toggle' : zone
        return Object.assign(hit(groupZone, x, y), { row: row, rowIndex: rowIndex })
      }
      if (zone !== 'timeline') return Object.assign(hit(zone, x, y), { row: row, rowIndex: rowIndex })
      const value = xToValue(x, f, false)
      const threshold = config.itemHitRadius / Math.max(1, f.scale)
      const candidates = typeof opts.itemCandidates === 'function'
        ? safeArray(opts.itemCandidates(row, value, threshold))
        : a.items(row)
      const centerY = config.rulerSize + rowIndex * f.rowHeight - f.scrollTop + f.rowHeight / 2
      for (let index = 0; index < candidates.length; index++) {
        const item = candidates[index]
        if (Math.abs(valueToX(a.itemValue(item), f) - x) <= config.itemHitRadius &&
            Math.abs(centerY - y) <= config.itemHitRadius) {
          return Object.assign(hit('item', x, y), { row: row, rowIndex: rowIndex, item: item, value: value })
        }
      }
      return Object.assign(hit('timeline', x, y), { row: row, rowIndex: rowIndex, value: value })
    }

    function tickStep(scale) {
      const value = numberValue(scale, config.defaultScale)
      if (value >= 360) return 0.1
      if (value >= 180) return 0.25
      if (value >= 90) return 0.5
      if (value >= 45) return 1
      return 2
    }
  }

  function normalizedAccessors(input) {
    const source = input || {}
    return {
      rows: source.rows || function (model) { return safeArray(model && model.rows) },
      rowHeight: source.rowHeight || function (model) { return Math.max(1, numberValue(model && model.rowHeight, 26)) },
      rowKind: source.rowKind || function (row) { return String(row && row.kind || 'row') },
      items: source.items || function (row) { return safeArray(row && (row.items || row.keys)) },
      itemId: source.itemId || function (item) { return String(item && item.id || '') },
      itemValue: source.itemValue || function (item) { return Math.max(0, numberValue(item && (item.value != null ? item.value : item.time), 0)) },
      markers: source.markers || function (model) { return safeArray(model && model.markers) },
      markerValue: source.markerValue || function (marker) { return Math.max(0, numberValue(marker && (marker.value != null ? marker.value : marker.time), 0)) },
      rangeEnd: source.rangeEnd || function (model) { return Math.max(0, numberValue(model && (model.rangeEnd != null ? model.rangeEnd : model.duration), 0)) },
      authoredEnd: source.authoredEnd || function (model) { return Math.max(0, numberValue(model && (model.authoredEnd != null ? model.authoredEnd : model.authoredEndTime), 0)) },
      boundary: source.boundary || function (model) { return Math.max(0, numberValue(model && (model.boundary != null ? model.boundary : model.duration), 0)) },
    }
  }

  function orderedItems(model, accessors) {
    const entries = []
    accessors.rows(model).forEach(function (row, rowIndex) {
      accessors.items(row).forEach(function (item, itemIndex) {
        entries.push({ row: row, rowIndex: rowIndex, item: item, itemIndex: itemIndex })
      })
    })
    return entries.sort(function (left, right) {
      if (left.rowIndex !== right.rowIndex) return left.rowIndex - right.rowIndex
      return accessors.itemValue(left.item) - accessors.itemValue(right.item)
    })
  }

  function logicalSize(canvas) {
    return {
      width: Math.max(1, numberValue(canvas && canvas.dataset && canvas.dataset.logicalWidth, canvas && canvas.clientWidth || 1)),
      height: Math.max(1, numberValue(canvas && canvas.dataset && canvas.dataset.logicalHeight, canvas && canvas.clientHeight || 1)),
    }
  }

  function hit(zone, x, y) {
    return { zone: zone, x: x, y: y, row: null, rowIndex: -1, item: null, marker: null }
  }

  function unique(values) {
    const seen = Object.create(null)
    return safeArray(values).filter(function (value) {
      const key = String(value || '')
      if (!key || seen[key]) return false
      seen[key] = true
      return true
    })
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : []
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, numberValue(value, min)))
  }

  function numberValue(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  timeline.defaults = DEFAULTS
  timeline.createLayout = createTimelineLayout
})(window.aiditor = window.aiditor || {})


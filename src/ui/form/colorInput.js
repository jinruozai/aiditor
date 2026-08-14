// aiditor.ui.colorInput - compact swatch + rich ARGB color picker.
//
// opts:
//   value:     string|int|array|signal   "#rrggbb", "#aarrggbb", 24-bit int, vec3, or vec4
//   onChange?: (v, meta) => void
//   onCommit?: (v, meta) => void
//   onCancel?: (initial, meta) => void
//   valueKind?: 'hex' | 'int' | 'vec3' | 'vec4'      (default 'hex')
//   valueScale?: 1 | 255           vec component scale; default 1
//   disabled?: bool|signal
//
// The picker works internally as #AARRGGBB so alpha editing is lossless. The
// public value preserves the existing contract: valueKind:'int' remains 24-bit
// RGB, vec3/vec4 stay RGB/RGBA arrays, while hex values stay #RRGGBB unless
// alpha is edited or the input already carried alpha.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui = aiditor.ui || {}
  const FAVORITES_KEY = 'aiditor-color-picker-favorites'

  ui.colorInput = function (opts) {
    const o = opts || {}
    const valueKind = normalizeValueKind(o.valueKind)
    const valueScale = o.valueScale === 255 ? 255 : 1
    const sig = ui.asSig(o.value != null ? o.value : defaultValue(valueKind, valueScale))
    const disabled = ui.asSig(o.disabled != null ? o.disabled : false)
    const rawWrite = ui.writer(sig, o.onChange, 'ui.colorInput')
    let lastExternal = sig.peek()
    let currentValue = lastExternal
    let edit = null
    let pop = null

    function editValue(value) {
      return Array.isArray(value) ? value.slice() : value
    }

    function editMeta(phase, value) {
      return {
        edit: {
          phase: phase,
          source: edit.source,
          initialValue: editValue(edit.initialValue),
          value: editValue(value),
        },
      }
    }

    function beginEdit(source) {
      if (edit) return
      edit = { source: source, initialValue: editValue(currentValue), updated: false }
    }

    function updateArgb(argb, preferAlpha, source) {
      beginEdit(source)
      const next = formatForValue(argb, lastExternal, valueKind, preferAlpha, valueScale)
      currentValue = next
      edit.updated = true
      rawWrite(next, editMeta('update', next))
    }

    function commitEdit() {
      if (!edit) return
      const session = edit
      const value = editValue(currentValue)
      const meta = editMeta('commit', value)
      edit = null
      if (session.updated && typeof o.onCommit === 'function') {
        aiditor.untracked(function () { o.onCommit(value, meta) })
      }
    }

    function cancelEdit() {
      if (!edit) return
      const session = edit
      const initial = editValue(session.initialValue)
      const meta = editMeta('cancel', initial)
      edit = null
      currentValue = initial
      if (session.updated) rawWrite(initial, meta)
      if (typeof o.onCancel === 'function') {
        aiditor.untracked(function () { o.onCancel(initial, meta) })
      }
    }

    function applyDiscrete(argb, preferAlpha, source) {
      beginEdit(source)
      updateArgb(argb, preferAlpha, source)
      commitEdit()
    }

    const el = ui.h('div', 'aiditor-ui-color')
    const swatch = ui.h('button', 'aiditor-ui-color-swatch', { type: 'button', title: 'Pick color', 'aria-label': 'Pick color' })
    const swatchFill = ui.h('span', 'aiditor-ui-color-swatch-fill')
    const text = ui.input({
      value: '',
      disabled: disabled,
      onChange: function (raw) {
        const parsed = parseColor(raw)
        if (parsed) updateArgb(parsed, hasAlpha(raw) || alphaOf(parsed) < 255, 'text')
      },
      onCommit: commitEdit,
      onCancel: cancelEdit,
    })
    text.classList.add('aiditor-ui-color-text')
    swatch.appendChild(swatchFill)
    el.appendChild(swatch)
    el.appendChild(text)

    ui.bindAttr(swatch, disabled, 'disabled')
    ui.bind(el, disabled, function (v) { el.classList.toggle('aiditor-ui-color-disabled', !!v) })
    ui.bind(el, sig, function (v) {
      lastExternal = v
      currentValue = v
      const argb = normalizeColor(v, valueKind, valueScale)
      swatchFill.style.background = argbToRgba(argb)
      const shown = formatForDisplay(argb, v, valueKind, alphaOf(argb) < 255 || hasAlpha(v), valueScale)
      const input = text.querySelector('input')
      if (input && document.activeElement !== input) input.value = shown
      if (pop && pop.sync) pop.sync(argb)
    })

    swatch.addEventListener('click', function () {
      if (disabled.peek()) return
      if (pop) { pop.close(); pop = null; return }
      pop = openPicker(el, normalizeColor(sig.peek(), valueKind, valueScale), {
        begin: beginEdit,
        update: updateArgb,
        commit: commitEdit,
        cancel: cancelEdit,
        apply: applyDiscrete,
      }, function () { pop = null })
    })
    ui.collect(el, function () {
      cancelEdit()
      if (pop) { pop.close(); pop = null }
    })
    return el
  }

  function openPicker(anchor, initialArgb, edit, onClose) {
    const state = {
      argb: normalizeColor(initialArgb, 'hex'),
      mode: aiditor.signal('hex'),
      favorites: readFavorites(),
      valueInputs: [],
      valueFills: [],
    }
    const wrap = ui.h('div', 'aiditor-ui-color-picker')
    const main = ui.h('div', 'aiditor-ui-color-picker-main')
    const sv = ui.h('div', 'aiditor-ui-color-sv')
    const svDot = ui.h('div', 'aiditor-ui-color-sv-dot')
    const hue = ui.h('div', 'aiditor-ui-color-hue')
    const hueInput = ui.h('input', 'aiditor-ui-color-range', { type: 'range', min: '0', max: '360' })
    const alpha = ui.h('div', 'aiditor-ui-color-alpha')
    const alphaInput = ui.h('input', 'aiditor-ui-color-range', { type: 'range', min: '0', max: '1', step: '0.01' })
    const values = ui.h('div', 'aiditor-ui-color-values')
    const mode = ui.segmented({
      value: state.mode,
      options: [
        { value: 'hex', label: 'HEX' },
        { value: 'rgb', label: 'RGB' },
        { value: 'hsl', label: 'HSL' },
      ],
    })
    const valueRow = ui.h('div', 'aiditor-ui-color-value-row')
    const favorites = ui.h('div', 'aiditor-ui-color-favorites')

    sv.appendChild(svDot)
    hue.appendChild(hueInput)
    alpha.appendChild(alphaInput)
    main.appendChild(sv)
    main.appendChild(hue)
    main.appendChild(alpha)
    values.appendChild(mode)
    values.appendChild(valueRow)
    wrap.appendChild(main)
    wrap.appendChild(values)
    wrap.appendChild(favorites)

    function setArgb(argb, preferAlpha, source) {
      state.argb = normalizeColor(argb, 'hex')
      render()
      edit.update(state.argb, preferAlpha, source)
    }

    function sync(argb) {
      state.argb = normalizeColor(argb, 'hex')
      render()
    }

    function render() {
      const hsl = argbToHsl(state.argb)
      const rgb = argbToRgb(state.argb)
      const hueColor = 'hsl(' + hsl.h + ', 100%, 50%)'
      const brightness = hsl.l / (50 + (100 - hsl.s) / 2)
      sv.style.background = 'linear-gradient(to bottom, transparent 0%, black 100%), linear-gradient(to right, white 0%, ' + hueColor + ' 100%)'
      svDot.style.left = hsl.s + '%'
      svDot.style.top = (100 - clamp01(brightness) * 100) + '%'
      hueInput.value = String(hsl.h)
      alphaInput.value = String(rgb.a)
      alphaInput.style.background = 'linear-gradient(to right, transparent, ' + argbToRgba(setAlpha(state.argb, 255)) + ')'
      updateValueControls()
      renderFavorites()
    }

    function renderValueRow() {
      ui.disposeChildren(valueRow)
      state.valueInputs = []
      state.valueFills = []
      const currentMode = state.mode.peek()
      const rgb = argbToRgb(state.argb)
      const hsl = argbToHsl(state.argb)
      if (currentMode === 'hex') {
        const preview = colorPreview(state.argb, 'aiditor-ui-color-current')
        const hex = ui.input({
          value: state.argb,
          onChange: function (v) {
            const parsed = parseColor(v)
            if (parsed) setArgb(parsed, hasAlpha(v), 'picker.hex')
          },
          onCommit: edit.commit,
          onCancel: edit.cancel,
        })
        hex.classList.add('aiditor-ui-color-hex-field')
        state.valueFills.push(preview.querySelector('.aiditor-ui-color-preview-fill'))
        state.valueInputs.push({ kind: 'hex', el: hex.querySelector('input') })
        valueRow.appendChild(preview)
        valueRow.appendChild(hex)
        if ('EyeDropper' in window) {
          valueRow.appendChild(ui.iconButton({
            icon: 'pipette',
            title: 'Pick color from screen',
            size: 'sm',
            onClick: function () { pickFromScreen(edit.apply) },
          }))
        }
        valueRow.appendChild(ui.iconButton({
          icon: 'plus',
          title: 'Add to favorites',
          size: 'sm',
          onClick: function () {
            addFavorite(state)
            renderFavorites()
          },
        }))
        updateValueControls()
        return
      }
      const channels = currentMode === 'rgb'
        ? [
            ['r', rgb.r, 0, 255, 1],
            ['g', rgb.g, 0, 255, 1],
            ['b', rgb.b, 0, 255, 1],
            ['a', rgb.a, 0, 1, 0.01],
          ]
        : [
            ['h', hsl.h, 0, 360, 1],
            ['s', hsl.s, 0, 100, 1],
            ['l', hsl.l, 0, 100, 1],
            ['a', hsl.a, 0, 1, 0.01],
          ]
      for (let i = 0; i < channels.length; i++) {
        const ch = channels[i]
        const source = 'picker.' + currentMode + '.' + ch[0]
        valueRow.appendChild(channelInput(ch[0], ch[1], ch[2], ch[3], ch[4], function (next) {
          if (currentMode === 'rgb') {
            const nextRgb = argbToRgb(state.argb)
            nextRgb[ch[0]] = next
            setArgb(rgbToArgb(nextRgb.r, nextRgb.g, nextRgb.b, nextRgb.a), true, source)
          } else {
            const nextHsl = argbToHsl(state.argb)
            nextHsl[ch[0]] = next
            setArgb(hslToArgb(nextHsl.h, nextHsl.s, nextHsl.l, nextHsl.a), true, source)
          }
        }, state, currentMode, edit, source))
      }
      updateValueControls()
    }

    function updateValueControls() {
      const rgb = argbToRgb(state.argb)
      const hsl = argbToHsl(state.argb)
      for (let i = 0; i < state.valueFills.length; i++) {
        if (state.valueFills[i]) state.valueFills[i].style.background = argbToRgba(state.argb)
      }
      for (let i = 0; i < state.valueInputs.length; i++) {
        const item = state.valueInputs[i]
        if (!item.el || document.activeElement === item.el) continue
        if (item.kind === 'hex') item.el.value = state.argb
        else {
          const source = item.kind === 'rgb' ? rgb : hsl
          const value = source[item.channel]
          if (item.sig) item.sig.set(item.step < 1 ? round2(value) : Math.round(value))
        }
      }
    }

    function renderFavorites() {
      ui.disposeChildren(favorites)
      if (!state.favorites.length) {
        favorites.style.display = 'none'
        return
      }
      favorites.style.display = ''
      favorites.appendChild(ui.h('div', 'aiditor-ui-color-favorites-title', { text: 'FAVORITES' }))
      const grid = ui.h('div', 'aiditor-ui-color-favorites-grid')
      for (let i = 0; i < state.favorites.length; i++) {
        const fav = state.favorites[i]
        const btn = ui.h('button', 'aiditor-ui-color-favorite', {
          type: 'button',
          title: 'Left click to use, right click to remove',
          'aria-label': fav,
        })
        btn.appendChild(colorPreview(fav, 'aiditor-ui-color-favorite-fill'))
        btn.classList.toggle('aiditor-ui-color-favorite-active', fav.toUpperCase() === state.argb.toUpperCase())
        btn.addEventListener('click', function () { edit.apply(fav, alphaOf(fav) < 255, 'picker.favorite') })
        btn.addEventListener('contextmenu', function (e) {
          e.preventDefault()
          removeFavorite(state, fav)
          renderFavorites()
        })
        grid.appendChild(btn)
      }
      favorites.appendChild(grid)
    }

    ui.bind(wrap, state.mode, renderValueRow)
    ui.collect(wrap, ui.attachDrag(sv, {
      onStart: function (event) {
        edit.begin('picker.sv')
        scrubSv(event)
      },
      onMove: scrubSv,
      onEnd: edit.commit,
      onCancel: edit.cancel,
    }))
    function scrubSv(e) {
      const r = sv.getBoundingClientRect()
      const x = clamp01((e.clientX - r.left) / r.width)
      const y = clamp01((e.clientY - r.top) / r.height)
      const hsl = argbToHsl(state.argb)
      const s = Math.round(x * 100)
      const brightness = 1 - y
      const l = Math.round(brightness * (50 + (100 - s) / 2))
      setArgb(hslToArgb(hsl.h, s, l, hsl.a), alphaOf(state.argb) < 255, 'picker.sv')
    }
    bindRangeEdit(hueInput, 'picker.hue', edit)
    hueInput.addEventListener('input', function () {
      const hsl = argbToHsl(state.argb)
      setArgb(hslToArgb(Number(hueInput.value), hsl.s, hsl.l, hsl.a), alphaOf(state.argb) < 255, 'picker.hue')
    })
    bindRangeEdit(alphaInput, 'picker.alpha', edit)
    alphaInput.addEventListener('input', function () {
      const hsl = argbToHsl(state.argb)
      setArgb(hslToArgb(hsl.h, hsl.s, hsl.l, Number(alphaInput.value)), true, 'picker.alpha')
    })
    render()

    const pop = ui.popover({
      anchor: anchor,
      content: wrap,
      side: 'bottom',
      align: 'start',
      onDismiss: function (cause) {
        if (cause === 'escape' || cause === 'dispose') edit.cancel()
        else edit.commit()
        onClose(cause)
      },
    })
    pop.sync = sync
    return pop
  }

  function bindRangeEdit(input, source, edit) {
    input.addEventListener('pointerdown', function (event) {
      if (event.button === 0) edit.begin(source)
    })
    input.addEventListener('change', edit.commit)
    input.addEventListener('pointercancel', edit.cancel)
    input.addEventListener('blur', edit.commit)
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      edit.cancel()
    })
  }

  function colorPreview(argb, cls) {
    const el = ui.h('span', cls || 'aiditor-ui-color-preview')
    const fill = ui.h('span', 'aiditor-ui-color-preview-fill')
    fill.style.background = argbToRgba(normalizeColor(argb, 'hex'))
    el.appendChild(fill)
    return el
  }

  function channelInput(label, value, min, max, step, onChange, state, mode, edit, source) {
    const sig = aiditor.signal(value)
    const wrap = ui.h('div', 'aiditor-ui-color-channel')
    const input = ui.numberInput({
      value: sig,
      onChange: function (next) {
        onChange(Math.max(min, Math.min(max, Number(next))))
      },
      min: min,
      max: max,
      step: step,
      precision: step < 1 ? 2 : 0,
      label: label,
    })
    const field = input.querySelector('input')
    input.addEventListener('pointerdown', function (event) {
      if (event.button === 0) edit.begin(source)
    })
    input.addEventListener('pointerup', edit.commit)
    input.addEventListener('pointercancel', edit.cancel)
    input.addEventListener('click', edit.commit)
    field.addEventListener('focus', function () { edit.begin(source) })
    field.addEventListener('blur', edit.commit)
    field.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      edit.cancel()
    }, true)
    wrap.appendChild(input)
    state.valueInputs.push({ kind: mode, channel: label, step: step, sig: sig, el: field })
    return wrap
  }

  async function pickFromScreen(apply) {
    try {
      const eyeDropper = new window.EyeDropper()
      const result = await eyeDropper.open()
      if (!result || !result.sRGBHex) return
      apply(normalizeColor(result.sRGBHex, 'hex'), false, 'picker.eyedropper')
    } catch (_) {}
  }

  function readFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(function (v) { return normalizeColor(v, 'hex') }).slice(0, 16) : []
    } catch (_) {
      return []
    }
  }
  function saveFavorites(list) {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(list.slice(0, 16))) } catch (_) {}
  }
  function addFavorite(state) {
    const color = state.argb.toUpperCase()
    const next = [color]
    for (let i = 0; i < state.favorites.length; i++) {
      if (state.favorites[i].toUpperCase() !== color) next.push(state.favorites[i])
    }
    state.favorites = next.slice(0, 16)
    saveFavorites(state.favorites)
  }
  function removeFavorite(state, color) {
    const key = color.toUpperCase()
    state.favorites = state.favorites.filter(function (v) { return v.toUpperCase() !== key })
    saveFavorites(state.favorites)
  }

  function parseColor(v) {
    if (v == null) return null
    const s = String(v).trim()
    if (/^#[0-9a-f]{3}$/i.test(s)) return '#FF' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3]
    if (/^#[0-9a-f]{4}$/i.test(s)) return expandArgb(s)
    if (/^#[0-9a-f]{6}$/i.test(s)) return '#FF' + s.slice(1).toUpperCase()
    if (/^#[0-9a-f]{8}$/i.test(s)) return s.toUpperCase()
    if (/^[0-9a-f]{6}$/i.test(s)) return '#FF' + s.toUpperCase()
    if (/^[0-9a-f]{8}$/i.test(s)) return '#' + s.toUpperCase()
    if (/^\d+$/.test(s)) {
      const n = Math.max(0, Math.min(0xffffffff, Math.trunc(Number(s))))
      let hex = n.toString(16).toUpperCase()
      if (hex.length <= 6) return '#FF' + pad(hex, 6)
      return '#' + pad(hex, 8)
    }
    return null
  }
  function normalizeValueKind(kind) {
    return kind === 'int' || kind === 'vec3' || kind === 'vec4' ? kind : 'hex'
  }
  function defaultValue(valueKind, scale) {
    if (valueKind === 'int') return 0x7b6ef6
    if (valueKind === 'vec3') return scale === 255 ? [123, 110, 246] : [round6(123 / 255), round6(110 / 255), round6(246 / 255)]
    if (valueKind === 'vec4') return scale === 255 ? [123, 110, 246, 255] : [round6(123 / 255), round6(110 / 255), round6(246 / 255), 1]
    return '#7b6ef6'
  }
  function normalizeColor(v, valueKind, scale) {
    if (valueKind === 'int' && typeof v === 'number') return '#FF' + pad(Math.max(0, Math.min(0xffffff, Math.trunc(v || 0))).toString(16).toUpperCase(), 6)
    if (valueKind === 'vec3' || valueKind === 'vec4') return vecToArgb(v, valueKind, scale)
    return parseColor(v) || '#FF000000'
  }
  function formatForValue(argb, original, valueKind, preferAlpha, scale) {
    const normalized = normalizeColor(argb, 'hex')
    if (valueKind === 'int') return parseInt(normalized.slice(3), 16)
    if (valueKind === 'vec3' || valueKind === 'vec4') return argbToVec(normalized, original, valueKind, preferAlpha, scale)
    if (!preferAlpha && !hasAlpha(original) && normalized.slice(1, 3).toUpperCase() === 'FF') return '#' + normalized.slice(3)
    return normalized
  }
  function formatForDisplay(argb, original, valueKind, preferAlpha, scale) {
    if (valueKind === 'vec3' || valueKind === 'vec4') {
      const normalized = normalizeColor(argb, 'hex', scale)
      if (!preferAlpha && valueKind !== 'vec4' && normalized.slice(1, 3).toUpperCase() === 'FF') return '#' + normalized.slice(3)
      if (valueKind === 'vec4' || preferAlpha || hasAlpha(original)) return normalized
      return '#' + normalized.slice(3)
    }
    return formatForValue(argb, original, valueKind, preferAlpha, scale)
  }
  function hasAlpha(v) {
    if (Array.isArray(v)) return v.length >= 4
    if (typeof v !== 'string') return false
    const s = v.trim()
    return /^#[0-9a-f]{8}$/i.test(s) || /^[0-9a-f]{8}$/i.test(s) || /^#[0-9a-f]{4}$/i.test(s)
  }
  function alphaOf(argb) { return parseInt(normalizeColor(argb, 'hex').slice(1, 3), 16) }
  function setAlpha(argb, a) { return '#' + hex2(a) + normalizeColor(argb, 'hex').slice(3) }
  function argbToRgb(argb) {
    const s = normalizeColor(argb, 'hex')
    return {
      a: round2(parseInt(s.slice(1, 3), 16) / 255),
      r: parseInt(s.slice(3, 5), 16),
      g: parseInt(s.slice(5, 7), 16),
      b: parseInt(s.slice(7, 9), 16),
    }
  }
  function vecToArgb(v, valueKind, scale) {
    const arr = Array.isArray(v) ? v : []
    return '#'
      + hex2(vecComponent(arr[3], scale, scale))
      + hex2(vecComponent(arr[0], 0, scale))
      + hex2(vecComponent(arr[1], 0, scale))
      + hex2(vecComponent(arr[2], 0, scale))
  }
  function argbToVec(argb, original, valueKind, preferAlpha, scale) {
    const rgb = argbToRgb(argb)
    const out = [
      fromByte(rgb.r, scale),
      fromByte(rgb.g, scale),
      fromByte(rgb.b, scale),
    ]
    if (valueKind === 'vec4') {
      const nextAlpha = fromByte(parseInt(normalizeColor(argb, 'hex').slice(1, 3), 16), scale)
      const originalAlpha = Array.isArray(original) && original.length > 3 ? original[3] : null
      if (!preferAlpha && originalAlpha != null) {
        out.push(originalAlpha)
        return out
      }
      const originalByte = originalAlpha == null ? null : vecComponent(originalAlpha, scale, scale)
      const nextByte = vecComponent(nextAlpha, scale, scale)
      out.push(originalByte != null && originalByte === nextByte ? originalAlpha : nextAlpha)
    }
    return out
  }
  function vecComponent(value, fallback, scale) {
    const n = Number(value)
    const v = Number.isFinite(n) ? n : fallback
    return scale === 255
      ? Math.max(0, Math.min(255, Math.round(v)))
      : Math.max(0, Math.min(255, Math.round(v * 255)))
  }
  function fromByte(value, scale) {
    return scale === 255 ? Math.max(0, Math.min(255, Math.round(value))) : round6(Math.max(0, Math.min(255, value)) / 255)
  }
  function rgbToArgb(r, g, b, a) {
    return '#' + hex2((Number(a) || 0) * 255) + hex2(r) + hex2(g) + hex2(b)
  }
  function argbToRgba(argb) {
    const s = normalizeColor(argb, 'hex')
    return '#' + s.slice(3) + s.slice(1, 3)
  }
  function argbToHsl(argb) {
    const rgb = argbToRgb(argb)
    const r = rgb.r / 255
    const g = rgb.g / 255
    const b = rgb.b / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0
    let s = 0
    const l = (max + min) / 2
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h = h / 6
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100), a: rgb.a }
  }
  function hslToArgb(h, s, l, a) {
    h = ((Number(h) % 360) + 360) % 360 / 360
    s = clamp01(Number(s) / 100)
    l = clamp01(Number(l) / 100)
    let r, g, b
    if (s === 0) {
      r = g = b = l
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1 / 3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1 / 3)
    }
    return rgbToArgb(r * 255, g * 255, b * 255, a)
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  function expandArgb(s) { return '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3] + s[4]+s[4] }
  function pad(s, n) { while (s.length < n) s = '0' + s; return s }
  function hex2(v) { return pad(Math.max(0, Math.min(255, Math.round(Number(v) || 0))).toString(16).toUpperCase(), 2) }
  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)) }
  function round2(v) { return Math.round((Number(v) || 0) * 100) / 100 }
  function round6(v) { return Math.round((Number(v) || 0) * 1000000) / 1000000 }
})(window.aiditor = window.aiditor || {})

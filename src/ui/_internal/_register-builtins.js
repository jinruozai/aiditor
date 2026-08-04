// Component-registry sidecar — registers the built-in ui.* widgets as
// palette-able components so aiditor.ui.renderUITree (and editors / palettes
// built on top of it) can instantiate them by name.
//
// Visual chrome (background / border / radius / padding / font / color /
// text-align / etc) is described here as palette metadata and applied by the
// shared runtime style helpers. Empty / null defaults mean "no inline style",
// so the framework theme cascade remains authoritative until a user edits it.
;(function (aiditor) {
  'use strict'
  const ui = aiditor.ui
  const reg = aiditor.registerComponent
  const lift = ui.liftProps
  const BOX = {
    background:   { type: 'color', type_agv: { valueKind: 'hex' }, group: 'background', desc: 'Fill color of the box. Empty falls back to the theme.' },
    borderColor:  { type: 'color', type_agv: { valueKind: 'hex' }, group: 'border', desc: 'Border line color. Empty disables the border.' },
    borderWidth:  { type: 'int', group: 'border', desc: 'Border thickness in pixels. 0 = no border.' },
    borderStyle:  { type: 'enum_string', type_agv: { options: ['solid','dashed','dotted'] }, group: 'border', desc: 'Border line pattern: solid · dashed · dotted.' },
    borderRadius: { type: 'int', group: 'border', desc: 'Corner radius in pixels. 0 = sharp corners.' },
    padding:      { type: 'int', group: 'spacing', desc: 'Inner space between border and content (px).' },
    opacity:      { type: 'float', group: 'effects', desc: 'Transparency: 0 = invisible, 1 = fully opaque.' },
    shadowX:      { type: 'int', group: 'shadow', desc: 'Drop-shadow horizontal offset in pixels (positive = right).' },
    shadowY:      { type: 'int', group: 'shadow', desc: 'Drop-shadow vertical offset in pixels (positive = down).' },
    shadowBlur:   { type: 'int', group: 'shadow', desc: 'Drop-shadow blur radius in pixels.' },
    shadowColor:  { type: 'color', type_agv: { valueKind: 'hex' }, group: 'shadow', desc: 'Drop-shadow color. Empty disables the shadow.' },
  }
  const BOX_D = {
    background: '', borderColor: '', borderWidth: null, borderStyle: 'solid',
    borderRadius: null, padding: null, opacity: null, shadowX: null,
    shadowY: null, shadowBlur: null, shadowColor: '',
  }
  const TEXT = ui.TEXT_STYLE_SCHEMA
  const TEXT_D = ui.TEXT_STYLE_DEFAULTS
  function box(el, p)  { ui.applyBoxStyle(el, p) }
  function text(el, p) { ui.applyTextStyle(el, p) }
  // liftProps returns derived-only signals (no .set). Form components call
  // ui.writer(sig, onChange) which throws if neither is writable. Inside
  // a renderUITree (cardStyle preview, table grid) the rendering is
  // read-only — the user edits through the inspector, not by typing into
  // a card. So every writable form component gets a noop onChange to
  // satisfy ui.writer without enabling write-back.
  function ro(opts) { opts.onChange = function () {}; return opts }

  function appendFlexChild(parent, child, layout) {
    if (layout) {
      if (layout.flex != null) child.style.flex = String(layout.flex)
      if (layout.basis != null) child.style.flexBasis = typeof layout.basis === 'number' ? layout.basis + 'px' : layout.basis
    }
    parent.appendChild(child)
  }

  // ── form ──────────────────────────────────────────────────────────
  reg('input', {
    label: 'Text Input', icon: 'type', category: 'form',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, { value: '', placeholder: '' }),
    schema: Object.assign({}, BOX, {
      value:       { type: 'string', desc: 'Current text value of the input.' },
      placeholder: { type: 'string', desc: 'Hint shown when the input is empty.' },
      disabled:    { type: 'bool',   desc: 'Disable interaction (greyed out, not focusable).' },
      readOnly:    { type: 'bool',   desc: 'Allow focus and selection but block edits.' },
    }),
    factory: function (p) {
      const el = ui.input(ro(lift(p, ['value','placeholder','disabled','readOnly'])))
      box(el, p)
      return el
    },
  })

  reg('textarea', {
    label: 'Textarea', icon: 'type', category: 'form',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, { value: '', placeholder: '', rows: 4, submitMode: 'modifier' }),
    schema: Object.assign({}, BOX, TEXT, {
      value:       { type: 'string', desc: 'Current text value of the textarea.' },
      placeholder: { type: 'string', desc: 'Hint shown when the textarea is empty.' },
      rows:        { type: 'int',    desc: 'Visible height in rows of text.' },
      submitMode:  { type: 'enum_string', type_agv: { options: ['none','modifier','enter'] },
                     desc: 'Commit behavior: none, Ctrl/Cmd+Enter, Enter (Shift+Enter newline).' },
      disabled:    { type: 'bool',   desc: 'Disable interaction (greyed out, not focusable).' },
    }),
    factory: function (p) {
      const el = ui.textarea(ro(lift(p, ['value','placeholder','rows','disabled','submitMode'])))
      box(el, p); text(el, p)
      return el
    },
  })

  reg('numberInput', {
    label: 'Number Input', icon: 'hash', category: 'form',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, { value: 0, step: 1, precision: 0 }),
    schema: Object.assign({}, BOX, {
      value:     { type: 'float', desc: 'Current numeric value.' },
      min:       { type: 'float', desc: 'Minimum allowed value (empty = no lower bound).' },
      max:       { type: 'float', desc: 'Maximum allowed value (empty = no upper bound).' },
      step:      { type: 'float', desc: 'Increment per arrow / scrub.' },
      precision: { type: 'int',   desc: 'Decimal places shown.' },
      disabled:  { type: 'bool',  desc: 'Disable interaction (greyed out, not focusable).' },
    }),
    factory: function (p) {
      const el = ui.numberInput(ro(lift(p, ['value','min','max','step','precision','disabled'])))
      box(el, p)
      return el
    },
  })

  reg('checkbox', {
    label: 'Checkbox', icon: 'check', category: 'form',
    bindable: ['value'],
    defaultProps: { value: false, label: '' },
    schema: {
      value:    { type: 'bool',   desc: 'Checked / unchecked.' },
      label:    { type: 'string', desc: 'Text shown next to the box.' },
      disabled: { type: 'bool',   desc: 'Disable interaction (greyed out, not focusable).' },
    },
    factory: function (p) { return ui.checkbox(ro(lift(p, ['value','label','disabled']))) },
  })

  reg('switch', {
    label: 'Switch', icon: 'toggle-right', category: 'form',
    bindable: ['value'],
    defaultProps: { value: false },
    schema: {
      value:    { type: 'bool', desc: 'On / off.' },
      disabled: { type: 'bool', desc: 'Disable interaction (greyed out, not focusable).' },
    },
    factory: function (p) { return ui.switch(ro(lift(p, ['value','disabled']))) },
  })

  reg('slider', {
    label: 'Slider', icon: 'sliders', category: 'form',
    bindable: ['value'],
    defaultProps: { value: 0, min: 0, max: 100, step: 1, showValue: true },
    schema: {
      value:     { type: 'float', desc: 'Current value along the track.' },
      min:       { type: 'float', desc: 'Minimum value at the left end of the track.' },
      max:       { type: 'float', desc: 'Maximum value at the right end of the track.' },
      step:      { type: 'float', desc: 'Snap increment.' },
      showValue: { type: 'bool',  desc: 'Show the current value next to the slider.' },
      disabled:  { type: 'bool',  desc: 'Disable interaction (greyed out, not focusable).' },
    },
    factory: function (p) { return ui.slider(ro(lift(p, ['value','min','max','step','showValue','disabled']))) },
  })

  reg('select', {
    label: 'Select', icon: 'list', category: 'form',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, { value: '', options: [] }),
    schema: Object.assign({}, BOX, {
      value:    { type: 'string', desc: 'Currently selected option value.' },
      options:  { type: 'array',  desc: 'List of options as [{ value, label }] objects.' },
      disabled: { type: 'bool',   desc: 'Disable interaction (greyed out, not focusable).' },
    }),
    factory: function (p) {
      const el = ui.select(ro(lift(p, ['value','options','disabled'])))
      box(el, p)
      return el
    },
  })

  reg('colorInput', {
    label: 'Color', icon: 'palette', category: 'form',
    bindable: ['value'],
    defaultProps: { value: '#000000' },
    schema: {
      value:    { type: 'string', desc: 'Hex color value, e.g. "#ff8800".' },
      disabled: { type: 'bool',   desc: 'Disable interaction (greyed out, not focusable).' },
    },
    factory: function (p) { return ui.colorInput(ro(lift(p, ['value','disabled']))) },
  })

  reg('dateInput', {
    label: 'Date', icon: 'calendar', category: 'form',
    bindable: ['value'],
    defaultProps: { value: '' },
    schema: {
      value:    { type: 'string', desc: 'Date as ISO string (YYYY-MM-DD).' },
      disabled: { type: 'bool',   desc: 'Disable interaction (greyed out, not focusable).' },
    },
    factory: function (p) { return ui.dateInput(ro(lift(p, ['value','disabled']))) },
  })

  // ── base / display ─────────────────────────────────────────────────
  reg('button', {
    label: 'Button', icon: 'plus', category: 'base',
    bindable: ['text'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, { text: 'Button', kind: 'default', size: 'md' }),
    schema: Object.assign({}, BOX, TEXT, {
      text:     { type: 'string', desc: 'Button label.' },
      kind:     { type: 'enum_string', type_agv: { options: ['default','primary','ghost','danger'] },
                  desc: 'Visual variant: default · primary · ghost · danger.' },
      size:     { type: 'enum_string', type_agv: { options: ['sm','md','lg'] },
                  desc: 'Button size: sm · md · lg.' },
      disabled: { type: 'bool', desc: 'Disable interaction (greyed out, not focusable).' },
    }),
    factory: function (p) {
      const el = ui.button(lift(p, ['text','kind','size','disabled']))
      box(el, p); text(el, p)
      return el
    },
  })

  reg('text', {
    label: 'Text', icon: 'type', category: 'display',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, {
      value: 'Text', variant: 'body', size: 'md', clamp: null,
    }),
    schema: Object.assign({}, BOX, TEXT, {
      value:   { type: 'string', desc: 'The text to display.' },
      variant: { type: 'enum_string', type_agv: { options: ['body','h1','h2','caption'] },
                 desc: 'Typographic role: body · h1 · h2 · caption.' },
      size:    { type: 'enum_string', type_agv: { options: ['sm','md','lg'] },
                 desc: 'Size scale: sm · md · lg.' },
      clamp:   { type: 'int', desc: 'Maximum visible lines before truncating with "…". 0 = no clamp.' },
    }),
    factory: function (p) {
      const el = ui.text(lift(p, ['value','variant','size','clamp']))
      box(el, p); text(el, p)
      return el
    },
  })

  reg('iconButton', {
    label: 'Icon Button', icon: 'plus', category: 'base',
    bindable: ['icon'],
    defaultProps: Object.assign({}, BOX_D, { icon: 'plus', size: 'md', kind: 'default' }),
    schema: Object.assign({}, BOX, {
      icon:     { type: 'string', desc: 'Registered icon name (see aiditor.ui.registerIcon).' },
      title:    { type: 'string', desc: 'Tooltip / accessibility label shown on hover.' },
      size:     { type: 'enum_string', type_agv: { options: ['sm','md','lg'] },
                  desc: 'Button size: sm · md · lg.' },
      kind:     { type: 'enum_string', type_agv: { options: ['default','primary','ghost','danger'] },
                  desc: 'Visual variant: default · primary · ghost · danger.' },
      disabled: { type: 'bool', desc: 'Disable interaction (greyed out, not focusable).' },
    }),
    factory: function (p) {
      const opts = lift(p, ['icon','size','kind','disabled'])
      opts.title = aiditor.derived(function () {
        const cur = p() || {}
        return cur.title || cur.icon || 'Icon button'
      })
      const el = ui.iconButton(opts)
      ui.collect(el, opts.title.dispose)
      box(el, p)
      return el
    },
  })

  reg('stateButton', {
    label: 'State Button', icon: 'toggle-right', category: 'base',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, {
      value: false,
      size: 'md',
      kind: 'ghost',
      offIcon: 'eye-off',
      offText: 'Hidden',
      onIcon: 'eye',
      onText: 'Visible',
    }),
    schema: Object.assign({}, BOX, {
      value:   { type: 'bool', desc: 'Current button state.' },
      offIcon: { type: 'string', desc: 'Registered icon name for the off state.' },
      offText: { type: 'string', desc: 'Text shown for the off state.' },
      onIcon:  { type: 'string', desc: 'Registered icon name for the on state.' },
      onText:  { type: 'string', desc: 'Text shown for the on state.' },
      size:    { type: 'enum_string', type_agv: { options: ['sm','md','lg'] },
                 desc: 'Button size: sm · md · lg.' },
      kind:    { type: 'enum_string', type_agv: { options: ['default','primary','ghost','danger'] },
                 desc: 'Visual variant: default · primary · ghost · danger.' },
      disabled: { type: 'bool', desc: 'Disable interaction (greyed out, not focusable).' },
    }),
    factory: function (p) {
      const value = aiditor.signal(!!((p.peek ? p.peek() : p()) || {}).value)
      const opts = lift(p, ['size','kind','disabled','offIcon','offText','onIcon','onText'])
      const el = ui.stateButton({
        value: value,
        off: { icon: opts.offIcon, text: opts.offText, title: opts.offText },
        on: { icon: opts.onIcon, text: opts.onText, title: opts.onText },
        size: opts.size,
        kind: opts.kind,
        disabled: opts.disabled,
        onChange: function (next) { value.set(!!next) },
      })
      ui.collect(el, aiditor.effect(function () { value.set(!!((p() || {}).value)) }))
      ui.collect(el, opts.size.dispose)
      ui.collect(el, opts.kind.dispose)
      ui.collect(el, opts.disabled.dispose)
      ui.collect(el, opts.offIcon.dispose)
      ui.collect(el, opts.offText.dispose)
      ui.collect(el, opts.onIcon.dispose)
      ui.collect(el, opts.onText.dispose)
      box(el, p)
      return el
    },
  })

  reg('image', {
    label: 'Image', icon: 'image', category: 'display',
    bindable: ['src'],
    defaultProps: Object.assign({}, BOX_D, { src: '', alt: '', objectFit: 'cover' }),
    schema: Object.assign({}, BOX, {
      src:       { type: 'img', desc: 'Image URL, data URI, or asset:// image.' },
      alt:       { type: 'string', desc: 'Accessibility text shown when the image fails to load.' },
      objectFit: { type: 'enum_string', type_agv: { options: ['cover','contain','fill','none'] },
                   desc: 'How the image fills its box: cover crops · contain letterboxes · fill stretches · none keeps native size.' },
    }),
    factory: function (p) {
      const el = ui.image(lift(p, ['src','alt','objectFit']))
      box(el, p)
      return el
    },
  })

  reg('icon', {
    label: 'Icon', icon: 'image', category: 'base',
    bindable: ['name'],
    defaultProps: { name: 'image', size: 'md', color: '' },
    schema: {
      name:  { type: 'string', desc: 'Registered icon name (see aiditor.ui.registerIcon). Falls back to literal text.' },
      size:  { type: 'enum_string', type_agv: { options: ['sm','md','lg'] },
               desc: 'Icon size: sm · md · lg.' },
      color: { type: 'string', desc: 'CSS color override. Empty inherits from text color.' },
    },
    factory: function (p) {
      const el = ui.icon(lift(p, ['name','size']))
      // Single-prop "color" maps to el.style.color directly — no need for
      // the full TEXT_STYLE fragment for an icon.
      aiditor.effect(function () {
        const c = (p() || {}).color
        el.style.color = (c == null || c === '') ? '' : c
      })
      return el
    },
  })

  reg('badge', {
    label: 'Badge', icon: 'tag', category: 'display',
    bindable: ['text'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, { text: 'NEW', kind: 'accent' }),
    schema: Object.assign({}, BOX, TEXT, {
      text: { type: 'string', desc: 'Badge text (a short label or count).' },
      kind: { type: 'enum_string', type_agv: { options: ['default','accent','success','warn','error'] },
              desc: 'Visual tone: default · accent · success · warn · error.' },
      dot:  { type: 'bool', desc: 'Render as a tiny status dot instead of a text pill.' },
    }),
    factory: function (p) {
      const el = ui.badge(lift(p, ['text','kind','dot']))
      box(el, p); text(el, p)
      return el
    },
  })

  reg('tag', {
    label: 'Tag', icon: 'tag', category: 'display',
    bindable: ['text'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, { text: 'tag', color: 'gray' }),
    schema: Object.assign({}, BOX, TEXT, {
      text:  { type: 'string', desc: 'Tag label.' },
      color: { type: 'enum_string', type_agv: { options: ['gray','accent','green','red','blue','yellow'] },
               desc: 'Tag color: gray · accent · green · red · blue · yellow.' },
    }),
    factory: function (p) {
      const el = ui.tag(lift(p, ['text','color']))
      box(el, p); text(el, p)
      return el
    },
  })

  reg('banner', {
    label: 'Banner', icon: 'alert-triangle', category: 'display',
    bindable: ['title', 'message'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, { kind: 'info', title: '', message: '' }),
    schema: Object.assign({}, BOX, TEXT, {
      kind:    { type: 'enum_string', type_agv: { options: ['info','success','warn','error'] },
                 desc: 'Banner tone: info · success · warn · error.' },
      title:   { type: 'string', desc: 'Banner heading.' },
      message: { type: 'string', desc: 'Banner body text.' },
    }),
    factory: function (p) {
      const el = ui.banner(lift(p, ['kind','title','message']))
      box(el, p); text(el, p)
      return el
    },
  })

  reg('divider', {
    label: 'Divider', icon: 'minus', category: 'display',
    bindable: ['label'],
    defaultProps: Object.assign({}, BOX_D, { label: '', vertical: false }),
    schema: Object.assign({}, BOX, {
      label:    { type: 'string', desc: 'Optional caption on the line.' },
      vertical: { type: 'bool',   desc: 'Render the divider vertically instead of horizontally.' },
    }),
    factory: function (p) {
      const el = ui.divider(lift(p, ['label','vertical']))
      box(el, p)
      return el
    },
  })

  reg('progressBar', {
    label: 'Progress', icon: 'spinner', category: 'display',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, { value: 0, max: 100, showLabel: true }),
    schema: Object.assign({}, BOX, {
      value:     { type: 'float', desc: 'Current progress value.' },
      max:       { type: 'float', desc: 'Maximum value (the bar fills when value reaches this).' },
      showLabel: { type: 'bool',  desc: 'Show the percentage label inside the bar.' },
    }),
    factory: function (p) {
      const el = ui.progressBar(lift(p, ['value','max','showLabel']))
      box(el, p)
      return el
    },
  })

  reg('spinner', {
    label: 'Spinner', icon: 'spinner', category: 'display',
    bindable: [],
    defaultProps: { size: 'md' },
    schema: {
      size: { type: 'enum_string', type_agv: { options: ['sm','md','lg'] },
              desc: 'Spinner size: sm · md · lg.' },
    },
    factory: function (p) { return ui.spinner(lift(p, ['size'])) },
  })

  reg('kbd', {
    label: 'Keyboard', icon: 'type', category: 'display',
    bindable: ['text'],
    defaultProps: Object.assign({}, BOX_D, TEXT_D, { text: 'Ctrl+K' }),
    schema: Object.assign({}, BOX, TEXT, {
      text: { type: 'string', desc: 'Keyboard shortcut to display, e.g. "Ctrl+K".' },
    }),
    factory: function (p) {
      const el = ui.kbd(lift(p, ['text']))
      box(el, p); text(el, p)
      return el
    },
  })

  // ── layout ────────────────────────────────────────────────────────
  const FLEX_SCHEMA = {
    gap:     { type: 'int', desc: 'Pixel gap between children.' },
    align:   { type: 'enum_string', type_agv: { options: ['stretch','flex-start','center','flex-end'] },
               desc: 'Cross-axis alignment of children: stretch, flex-start, center, flex-end.' },
    justify: { type: 'enum_string', type_agv: { options: ['flex-start','center','flex-end','space-between','space-around'] },
               desc: 'Main-axis distribution of children.' },
    width:   { type: 'int', desc: 'Fixed width in pixels (empty = auto).' },
    height:  { type: 'int', desc: 'Fixed height in pixels (empty = auto).' },
  }
  const FLEX_DEFAULTS = Object.assign({}, BOX_D, { gap: 4 })
  const FLEX_FIELDS = Object.assign({}, BOX, FLEX_SCHEMA)

  reg('vbox', {
    label: 'V Box', icon: 'columns', category: 'layout',
    bindable: [],
    defaultProps: FLEX_DEFAULTS,
    schema: FLEX_FIELDS,
    factory: function (p) { return ui.vbox({ value: p }) },
    appendChild: appendFlexChild,
  })

  reg('hbox', {
    label: 'H Box', icon: 'columns', category: 'layout',
    bindable: [],
    defaultProps: FLEX_DEFAULTS,
    schema: FLEX_FIELDS,
    factory: function (p) { return ui.hbox({ value: p }) },
    appendChild: appendFlexChild,
  })

  reg('absolute', {
    label: 'Absolute', icon: 'maximize', category: 'layout',
    bindable: [],
    defaultProps: Object.assign({}, BOX_D, { width: 120, height: 120 }),
    schema: Object.assign({}, BOX, {
      width:  { type: 'int', desc: 'Container width in pixels.' },
      height: { type: 'int', desc: 'Container height in pixels.' },
    }),
    factory: function (p) { return ui.absolute({ value: p }) },
    appendChild: function (parent, child, layout) {
      const slot = ui.h('div', 'aiditor-ui-abs-slot')
      ui.layoutRect.applyToSlot(slot, layout)
      slot.appendChild(child)
      parent.appendChild(slot)
    },
  })

  // ── editor / file path ────────────────────────────────────────────
  reg('filePathInput', {
    label: 'File Path', icon: 'file', category: 'editor',
    bindable: ['value'],
    defaultProps: Object.assign({}, BOX_D, { value: '', kind: 'file', placeholder: '' }),
    schema: Object.assign({}, BOX, {
      value:       { type: 'string', desc: 'File path or URL.' },
      kind:        { type: 'enum_string', type_agv: { options: ['image','audio','text','file'] },
                     desc: 'File path kind: image · audio · text · file. Drives the leading preview/control.' },
      placeholder: { type: 'string', desc: 'Hint shown when no path is set.' },
      accept:      { type: 'string', desc: 'MIME pattern passed to the file picker (e.g. "image/png").' },
    }),
    factory: function (p) {
      const el = ui.filePathInput(ro(lift(p, ['value','kind','placeholder','accept'])))
      box(el, p)
      return el
    },
  })
})(window.aiditor = window.aiditor || {})

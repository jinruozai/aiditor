import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function makeClassList(el) {
  return {
    add: function () {
      for (let i = 0; i < arguments.length; i++) {
        if (arguments[i] && !el._classes.includes(arguments[i])) el._classes.push(arguments[i])
      }
      el.className = el._classes.join(' ')
    },
    remove: function () {
      for (let i = 0; i < arguments.length; i++) {
        const at = el._classes.indexOf(arguments[i])
        if (at >= 0) el._classes.splice(at, 1)
      }
      el.className = el._classes.join(' ')
    },
    toggle: function (name, force) {
      const has = el._classes.includes(name)
      const next = force == null ? !has : !!force
      if (next && !has) this.add(name)
      if (!next && has) this.remove(name)
    },
    contains: function (name) { return el._classes.includes(name) },
  }
}

function node(tag, cls, attrs) {
  const el = {
    tagName: tag,
    className: cls || '',
    _classes: cls ? String(cls).split(/\s+/).filter(Boolean) : [],
    children: [],
    events: {},
    dataset: {},
    disabled: false,
    hidden: false,
    parentNode: null,
    style: {
      values: {},
      cssText: '',
      setProperty: function (name, value) { this.values[name] = String(value) },
      removeProperty: function (name) { delete this.values[name] },
      getPropertyValue: function (name) { return this.values[name] || '' },
    },
    appendChild: function (child) { child.parentNode = this; this.children.push(child); return child },
    removeChild: function (child) {
      const at = this.children.indexOf(child)
      if (at >= 0) this.children.splice(at, 1)
      child.parentNode = null
      return child
    },
    addEventListener: function (type, fn) {
      if (!this.events[type]) this.events[type] = []
      this.events[type].push(fn)
    },
    setAttribute: function (name, value) { this[name] = String(value) },
    removeAttribute: function (name) { delete this[name] },
  }
  Object.defineProperty(el, 'firstChild', { get: function () { return this.children[0] || null } })
  el.classList = makeClassList(el)
  if (attrs) for (const k in attrs) {
    if (k === 'text') el.textContent = attrs[k]
    else el[k] = attrs[k]
  }
  return el
}

const listCalls = []
const stored = {}
const rootStyle = node('html').style

global.localStorage = {
  getItem: function (key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null },
  setItem: function (key, value) { stored[key] = String(value) },
  removeItem: function (key) { delete stored[key] },
}
global.getComputedStyle = function (el) {
  return {
    getPropertyValue: function (name) {
      return el.style.getPropertyValue(name) || (name.indexOf('font') >= 0 ? 'system-ui' : name.indexOf('dur') >= 0 ? '120ms' : name.indexOf('brand') >= 0 || name.indexOf('surface') >= 0 || name.indexOf('text') >= 0 || name.indexOf('stroke') >= 0 || name.indexOf('state') >= 0 ? '#111111' : '12px')
    },
  }
}
global.requestAnimationFrame = function (fn) { fn() }
global.document = {
  documentElement: { style: rootStyle },
}
global.window = {
  aiditor: {
    ui: {
      h: node,
      view: function (opts) {
        const el = node('div', 'aiditor-ui-view' + (opts && opts.className ? ' ' + opts.className : ''))
        const children = opts && opts.children ? (Array.isArray(opts.children) ? opts.children : [opts.children]) : []
        for (let i = 0; i < children.length; i++) el.appendChild(children[i])
        return el
      },
      searchInput: function () { return node('input', 'aiditor-ui-search-field aiditor-ui-field') },
      list: function (opts) { listCalls.push(opts); return node('div', 'aiditor-ui-list') },
      icon: function () { return node('span', 'aiditor-ui-icon') },
      segmented: function () { return node('div', 'aiditor-ui-segmented') },
      select: function () { return node('select', 'aiditor-ui-select') },
      button: function (opts) {
        const el = node('button', 'aiditor-ui-btn')
        if (opts && opts.onClick) el.addEventListener('click', opts.onClick)
        return el
      },
      propRow: function (opts) {
        const el = node('div', 'aiditor-ui-prop-row')
        if (opts && opts.control) el.appendChild(opts.control)
        return el
      },
      colorInput: function () { return node('input', 'aiditor-ui-color') },
      numberInput: function () { return node('input', 'aiditor-ui-num') },
      input: function () { return node('input', 'aiditor-ui-input') },
      copyText: function () {},
      toast: function () {},
      collect: function (el, fn) {
        if (!el.__aiditorCleanups) el.__aiditorCleanups = []
        el.__aiditorCleanups.push(fn)
      },
      dispose: function (el) {
        if (el && el.parentNode) el.parentNode.removeChild(el)
      },
    },
    settings: {
      values: {},
      registerSection: function () {},
      registerSchema: function () {},
      registerPage: function () {},
      get: function (key) { return this.values[key] },
      set: function (key, value) { this.values[key] = value },
    },
    theme: {
      modeOptions: function () { return [{ value: 'dark', label: 'Dark' }, { value: 'pop', label: 'Pop' }] },
      set: function (mode) { this.mode = mode },
      setDensity: function (density) { this.density = density },
      exportCss: function () { return ':root{}' },
    },
  },
}

delete global.Demo

for (const file of [
  'src/core/signal.js',
  'src/core/names.js',
  'src/core/registry.js',
  'src/style/theme-settings.js',
  'src/ui/panel/panel-list.js',
]) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file })
}

const aiditor = window.aiditor
assert.equal(aiditor.resolveComponent('theme-config').label, 'Theme')
assert.equal(aiditor.resolveComponent('panel-list').label, 'Panels')

aiditor.registerComponent('case.alphaPanel', {
  category: 'panel',
  label: 'Alpha',
  icon: 'box',
  defaults: function () { return { title: 'Alpha', icon: 'box', props: { count: 1 } } },
  factory: function () { return node('div') },
})
aiditor.registerComponent('case.hiddenPanel', {
  category: 'panel',
  palette: false,
  defaults: function () { return { title: 'Hidden' } },
  factory: function () { return node('div') },
})
aiditor.registerComponent('case.input', {
  category: 'form',
  label: 'Input',
  factory: function () { return node('div') },
})

const tree = {
  type: 'split',
  children: [
    { type: 'dock', id: 'dock-side', name: 'side', panels: [] },
    { type: 'dock', id: 'dock-main', name: 'main', panels: [] },
  ],
}
const added = []
const layout = {
  treeSig: { peek: function () { return tree } },
  addPanel: function (dockId, partial) {
    added.push({ dockId: dockId, partial: partial })
    return 'new-panel'
  },
}
const panelList = aiditor.resolveComponent('panel-list')
const root = panelList.factory({ peek: function () { return { targetDock: 'main' } } }, {
  _layout: layout,
  dock: {
    addPanel: function (partial) {
      added.push({ dockId: 'current', partial: partial })
      return { panelId: 'fallback-panel' }
    },
  },
})
assert.ok(root.className.includes('aiditor-panel-list'))

const listOpts = listCalls.at(-1)
const alpha = listOpts.items.peek().find(function (item) { return item.name === 'case.alphaPanel' })
assert.ok(alpha)
assert.equal(listOpts.items.peek().some(function (item) { return item.name === 'case.hiddenPanel' }), false)
assert.equal(listOpts.items.peek().some(function (item) { return item.name === 'case.input' }), false)

listOpts.onActivate(alpha)
assert.equal(added[0].dockId, 'dock-main')
assert.deepEqual(added[0].partial, {
  component: 'case.alphaPanel',
  title: 'Alpha',
  icon: 'box',
  props: { count: 1 },
})

let dragPayload = null
aiditor._dock = {
  beginExternalPanelDrag: function (ev, partial, dragLayout, meta) {
    dragPayload = { ev: ev, partial: partial, dragLayout: dragLayout, meta: meta }
  },
}
const row = listOpts.render(alpha)
row.events.pointerdown[0]({ type: 'pointerdown' })
assert.equal(dragPayload.partial.component, 'case.alphaPanel')
assert.equal(dragPayload.dragLayout, layout)
assert.equal(dragPayload.meta.label, 'Alpha')

const theme = aiditor.resolveComponent('theme-config')
const themeRoot = theme.factory({ peek: function () { return {} } }, {})
assert.ok(themeRoot.className.includes('aiditor-theme-config'))

console.log('builtin panel tests ok')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.style = {}
    this.attributes = {}
    this.events = {}
    this.classList = { add() {} }
  }
  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
    return child
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] || null }
  addEventListener(type, listener) { this.events[type] = listener }
  click() { if (this.events.click) this.events.click() }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 24, width: 100, height: 24 } }
}

const document = {
  createElement(tag) { return new FakeEl(tag) },
}
const aiditor = {
  ui: {
    h(tag, className, attrs) {
      const el = new FakeEl(tag)
      el.className = className || ''
      if (attrs && attrs.text) el.textContent = attrs.text
      return el
    },
    icon() { return new FakeEl('span') },
    popover(options) {
      return {
        content: options.content,
        closed: false,
        close() {
          this.closed = true
          if (options.onDismiss) options.onDismiss()
        },
      }
    },
  },
}
const context = vm.createContext({ window: { aiditor }, document, console })
vm.runInContext(readFileSync('src/ui/overlay/menu.js', 'utf8'), context, { filename: 'src/ui/overlay/menu.js' })

let checked = true
const checkboxMenu = aiditor.ui.menu({
  anchor: new FakeEl('button'),
  items: [{
    type: 'checkbox',
    label: 'Grid',
    checked,
    closeOnSelect: false,
    onChange(next) { checked = next },
  }],
})
const checkboxRow = checkboxMenu.content.children[0]
assert.equal(checkboxRow.getAttribute('role'), 'menuitemcheckbox')
assert.equal(checkboxRow.getAttribute('aria-checked'), 'true')
checkboxRow.click()
assert.equal(checked, false)
assert.equal(checkboxRow.getAttribute('aria-checked'), 'false')
assert.equal(checkboxMenu.closed, false)

const closingCheckboxMenu = aiditor.ui.menu({
  anchor: new FakeEl('button'),
  items: [{ type: 'checkbox', label: 'Grid', checked: true }],
})
closingCheckboxMenu.content.children[0].click()
assert.equal(closingCheckboxMenu.closed, true)

let persistentSelected = false
const persistentActionMenu = aiditor.ui.menu({
  anchor: new FakeEl('button'),
  items: [{ label: 'Preview', closeOnSelect: false, onSelect() { persistentSelected = true } }],
})
persistentActionMenu.content.children[0].click()
assert.equal(persistentSelected, true)
assert.equal(persistentActionMenu.closed, false)

let selected = false
const actionMenu = aiditor.ui.menu({
  anchor: new FakeEl('button'),
  items: [{ label: 'Apply', onSelect() { selected = true } }],
})
actionMenu.content.children[0].click()
assert.equal(selected, true)
assert.equal(actionMenu.closed, true)

console.log('menu tests ok')

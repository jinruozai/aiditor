// aiditor.ui.richPromptInput - AI prompt input with inline reference atoms.
;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui = aiditor.ui || {}
  const CLIPBOARD_MIME = 'application/x-aiditor-rich-prompt'

  function read(v) {
    return ui.isSignal && ui.isSignal(v) ? v() : v
  }

  function disposeTree(el) {
    if (!el) return
    if (el.nodeType !== 1) {
      el.remove()
      return
    }
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function clear(el) {
    while (el.firstChild) disposeTree(el.firstChild)
  }

  function draftKey(draft) {
    const d = aiditor.ai.richPrompt.normalize(draft)
    return d.text + '\n' + JSON.stringify(d.tokens)
  }

  function labelOf(token) {
    return token.label || token.title || token.refId || 'Reference'
  }

  function tokenEl(tokenChar, token, renderToken) {
    if (renderToken) {
      const custom = renderToken(token, tokenChar)
      if (custom) return custom
    }
    const kind = token.type || 'ref'
    const el = ui.h('span', 'aiditor-richprompt-token aiditor-richprompt-token-' + kind, {
      contenteditable: 'false',
      role: 'button',
      title: token.uri || token.refId || token.skillId || labelOf(token),
    })
    el.dataset.efToken = tokenChar
    el.dataset.efRefId = token.refId || ''
    el.dataset.efSkillId = token.skillId || ''
    el.dataset.efTokenType = kind
    el.setAttribute('aria-label', (kind === 'skill' ? 'Skill ' : 'Reference ') + labelOf(token))
    if (token.kind && String(token.kind).indexOf('image') >= 0 && token.meta && token.meta.dataUrl) {
      el.appendChild(ui.h('img', 'aiditor-richprompt-token-thumb', { src: token.meta.dataUrl, alt: '' }))
    }
    el.appendChild(ui.h('span', 'aiditor-richprompt-token-label', { text: labelOf(token) }))
    el.appendChild(ui.h('span', 'aiditor-richprompt-token-remove', { text: 'x' }))
    return el
  }

  function appendText(parent, text) {
    if (!text) return
    parent.appendChild(document.createTextNode(text))
  }

  function appendNewline(parent) {
    parent.appendChild(ui.h('br', '', { 'data-aiditor-newline': '1' }))
    parent.appendChild(ui.h('span', 'aiditor-richprompt-caret', {
      'data-aiditor-caret': '1',
      contenteditable: 'false',
      'aria-hidden': 'true',
      text: '\u200b',
    }))
  }

  function renderDraft(editor, draft, renderToken) {
    const d = aiditor.ai.richPrompt.normalize(draft)
    clear(editor)
    let buf = ''
    for (let i = 0; i < d.text.length; i++) {
      const ch = d.text[i]
      const token = d.tokens[ch]
      if (token) {
        appendText(editor, buf)
        buf = ''
        editor.appendChild(tokenEl(ch, token, renderToken))
      } else if (ch === '\n') {
        appendText(editor, buf)
        buf = ''
        appendNewline(editor)
      } else {
        buf += ch
      }
    }
    appendText(editor, buf)
  }

  function serializeNode(node, tokens) {
    if (node.nodeType === 3) return node.nodeValue || ''
    if (node.nodeType !== 1) return ''
    const el = node
    const token = el.dataset && el.dataset.efToken
    if (token) return tokens[token] ? token : ''
    if (el.dataset && el.dataset.efCaret) return ''
    if (el.tagName === 'BR') return el.dataset && el.dataset.efNewline ? '\n' : ''
    let out = ''
    for (let child = el.firstChild; child; child = child.nextSibling) out += serializeNode(child, tokens)
    return out
  }

  function hasDomNoise(el) {
    return !!el.querySelector('div,p,br:not([data-aiditor-newline])')
  }

  function serialize(editor, oldDraft) {
    const tokens = (oldDraft && oldDraft.tokens) || {}
    let text = ''
    for (let child = editor.firstChild; child; child = child.nextSibling) text += serializeNode(child, tokens)
    return aiditor.ai.richPrompt.normalize({ text: text, tokens: tokens })
  }

  function isBlankDraft(draft) {
    const d = aiditor.ai.richPrompt.normalize(draft)
    return !aiditor.ai.richPrompt.refs(d).length && !d.text.trim()
  }

  function singleLineDraft(draft) {
    const d = aiditor.ai.richPrompt.normalize(draft)
    if (d.text.indexOf('\n') < 0) return d
    return aiditor.ai.richPrompt.normalize({
      text: d.text.replace(/\n/g, ' '),
      tokens: d.tokens,
    })
  }

  function indexOfNode(editor, targetNode, targetOffset) {
    let index = 0
    let found = false
    function walk(node) {
      if (found) return
      if (node === targetNode) {
        if (node.nodeType === 3) index += Math.min(targetOffset, (node.nodeValue || '').length)
        else if (node.nodeType === 1) {
          for (let i = 0; i < Math.min(targetOffset, node.childNodes.length); i++) {
            index += nodeLength(node.childNodes[i])
          }
        }
        found = true
        return
      }
      if (node.nodeType === 3) {
        index += (node.nodeValue || '').length
        return
      }
      if (node.nodeType !== 1) return
      if (node.dataset && node.dataset.efCaret) return
      const token = node.dataset && node.dataset.efToken
      if (token) {
        index += 1
        return
      }
      if (node.tagName === 'BR' && node.dataset && node.dataset.efNewline) {
        index += 1
        return
      }
      for (let child = node.firstChild; child; child = child.nextSibling) walk(child)
    }
    for (let child = editor.firstChild; child; child = child.nextSibling) walk(child)
    return index
  }

  function nodeLength(node) {
    if (!node) return 0
    if (node.nodeType === 3) return (node.nodeValue || '').length
    if (node.nodeType !== 1) return 0
    if (node.dataset && node.dataset.efCaret) return 0
    if (node.dataset && node.dataset.efToken) return 1
    if (node.tagName === 'BR' && node.dataset && node.dataset.efNewline) return 1
    let n = 0
    for (let child = node.firstChild; child; child = child.nextSibling) n += nodeLength(child)
    return n
  }

  function selectionIndex(editor, fallbackDraft) {
    const sel = window.getSelection && window.getSelection()
    if (!sel || !sel.rangeCount) return aiditor.ai.richPrompt.normalize(fallbackDraft).text.length
    const range = sel.getRangeAt(0)
    if (!editor.contains(range.startContainer)) return aiditor.ai.richPrompt.normalize(fallbackDraft).text.length
    return indexOfNode(editor, range.startContainer, range.startOffset)
  }

  function selectionRange(editor, fallbackDraft) {
    const d = aiditor.ai.richPrompt.normalize(fallbackDraft)
    const sel = window.getSelection && window.getSelection()
    if (!sel || !sel.rangeCount) return { start: d.text.length, end: d.text.length, collapsed: true }
    const range = sel.getRangeAt(0)
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return { start: d.text.length, end: d.text.length, collapsed: true }
    }
    const a = indexOfNode(editor, range.startContainer, range.startOffset)
    const b = indexOfNode(editor, range.endContainer, range.endOffset)
    return {
      start: Math.min(a, b),
      end: Math.max(a, b),
      collapsed: a === b,
    }
  }

  function selectedDraft(editor, fallbackDraft) {
    const r = selectionRange(editor, fallbackDraft)
    if (r.collapsed) return null
    return aiditor.ai.richPrompt.slice(fallbackDraft, r.start, r.end)
  }

  function setCaret(editor, index) {
    if (!window.getSelection || !document.createRange) return
    let remaining = Math.max(0, index)
    let hitNode = editor
    let hitOffset = editor.childNodes.length
    function offsetBefore(node) {
      return Array.prototype.indexOf.call(node.parentNode.childNodes, node)
    }
    function offsetAfterAtom(node) {
      let offset = offsetBefore(node) + 1
      if (node.tagName === 'BR') {
        const next = node.nextSibling
        if (next && next.nodeType === 1 && next.dataset && next.dataset.efCaret) offset++
      }
      return offset
    }
    function walk(node) {
      if (node.nodeType === 3) {
        const len = (node.nodeValue || '').length
        if (remaining <= len) {
          hitNode = node
          hitOffset = remaining
          return true
        }
        remaining -= len
        return false
      }
      if (node.nodeType !== 1) return false
      if (node.dataset && node.dataset.efCaret) return false
      const token = node.dataset && node.dataset.efToken
      if (token) {
        if (remaining === 0) {
          hitNode = node.parentNode
          hitOffset = offsetBefore(node)
          return true
        }
        if (remaining === 1) {
          hitNode = node.parentNode
          hitOffset = offsetAfterAtom(node)
          return true
        }
        remaining -= 1
        return false
      }
      if (node.tagName === 'BR' && node.dataset && node.dataset.efNewline) {
        if (remaining === 0) {
          hitNode = node.parentNode
          hitOffset = offsetBefore(node)
          return true
        }
        if (remaining === 1) {
          hitNode = node.parentNode
          hitOffset = offsetAfterAtom(node)
          return true
        }
        remaining -= 1
        return false
      }
      for (let child = node.firstChild; child; child = child.nextSibling) if (walk(child)) return true
      return false
    }
    for (let child = editor.firstChild; child; child = child.nextSibling) if (walk(child)) break
    const range = document.createRange()
    range.setStart(hitNode, hitOffset)
    range.collapse(true)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }

  function tokenAncestor(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentNode)
    while (el && el.nodeType === 1) {
      if (el.dataset && el.dataset.efToken) return el
      el = el.parentNode
    }
    return null
  }

  function normalizePointRange(editor, range, x) {
    const token = tokenAncestor(range.startContainer)
    if (!token || !editor.contains(token)) return range
    const rect = token.getBoundingClientRect()
    const parent = token.parentNode
    const offset = Array.prototype.indexOf.call(parent.childNodes, token) + (x > rect.left + rect.width / 2 ? 1 : 0)
    const out = document.createRange()
    out.setStart(parent, offset)
    out.collapse(true)
    return out
  }

  function rangeFromPoint(editor, x, y) {
    let range = null
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y)
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y)
      if (pos) {
        range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
      }
    }
    if (!range || !editor.contains(range.startContainer)) return null
    return normalizePointRange(editor, range, x)
  }

  function caretRect() {
    const sel = window.getSelection && window.getSelection()
    if (!sel || !sel.rangeCount) return null
    const range = sel.getRangeAt(0).cloneRange()
    const rects = range.getClientRects()
    if (rects && rects.length) return rects[0]
    const marker = document.createElement('span')
    marker.textContent = '\u200b'
    range.insertNode(marker)
    const rect = marker.getBoundingClientRect()
    marker.remove()
    return rect
  }

  function moveCaretVertical(editor, dir) {
    if (!editor.querySelector('.aiditor-richprompt-token')) return false
    const rect = caretRect()
    if (!rect) return false
    const line = Math.max(18, rect.height || 18)
    const range = rangeFromPoint(editor, rect.left, rect.top + rect.height / 2 + dir * line * 1.25)
    if (!range) return false
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  }

  function deleteAdjacentAtom(editor, dir, value, renderToken) {
    const sel = window.getSelection && window.getSelection()
    if (!sel || !sel.rangeCount) return false
    if (!sel.isCollapsed) {
      const r = selectionRange(editor, value.peek ? value.peek() : value())
      if (r.collapsed) return false
      const next = aiditor.ai.richPrompt.deleteRange(value.peek(), r.start, r.end)
      value.set(next)
      renderDraft(editor, next, renderToken)
      setCaret(editor, r.start)
      return true
    }
    const range = sel.getRangeAt(0)
    const at = indexOfNode(editor, range.startContainer, range.startOffset)
    const draft = aiditor.ai.richPrompt.normalize(value.peek ? value.peek() : value())
    const idx = dir < 0 ? at - 1 : at
    const ch = draft.text[idx]
    const isToken = aiditor.ai.richPrompt.isTokenChar(ch) && draft.tokens[ch]
    const isNewline = ch === '\n'
    if (!isToken && !isNewline) return false
    value.set(aiditor.ai.richPrompt.deleteRange(draft, idx, idx + 1))
    renderDraft(editor, value.peek(), renderToken)
    setCaret(editor, idx)
    return true
  }

  function setClipboardDraft(ev, draft) {
    if (!ev.clipboardData) return false
    const d = aiditor.ai.richPrompt.normalize(draft)
    ev.clipboardData.setData(CLIPBOARD_MIME, JSON.stringify(d))
    ev.clipboardData.setData('text/plain', aiditor.ai.richPrompt.toPlainText(d))
    return true
  }

  function clipboardDraft(ev) {
    if (!ev.clipboardData) return null
    const rich = ev.clipboardData.getData(CLIPBOARD_MIME)
    if (!rich) return null
    try {
      return aiditor.ai.richPrompt.normalize(JSON.parse(rich))
    } catch (err) {
      return null
    }
  }

  ui.richPromptInput = function (opts) {
    opts = opts || {}
    const value = ui.asSig(opts.value || aiditor.ai.richPrompt.empty())
    const disabled = ui.asSig(opts.disabled || false)
    const singleLine = ui.asSig(opts.singleLine == null ? false : opts.singleLine)
    const root = ui.h('div', 'aiditor-richprompt')
    const editor = ui.h('div', 'aiditor-richprompt-editor', {
      contenteditable: disabled() ? 'false' : 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      spellcheck: 'false',
    })
    if (opts.placeholder) editor.dataset.placeholder = opts.placeholder
    root.appendChild(editor)

    let lastKey = ''
    let composing = false

    function commitFromDom() {
      if (composing) return
      const at = selectionIndex(editor, value.peek())
      const serialized = serialize(editor, value.peek())
      const next = singleLine.peek() ? singleLineDraft(serialized) : serialized
      const shouldFlatten = hasDomNoise(editor) || serialized.text !== next.text
      const clean = isBlankDraft(next) ? aiditor.ai.richPrompt.empty() : next
      lastKey = draftKey(clean)
      value.set(clean)
      if (shouldFlatten) {
        renderDraft(editor, clean, opts.renderToken)
        setCaret(editor, Math.min(at, clean.text.length))
      }
    }

    function renderExternal() {
      const source = aiditor.ai.richPrompt.normalize(read(value))
      const d = singleLine() ? singleLineDraft(source) : source
      const key = draftKey(d)
      if (key === lastKey) return
      lastKey = key
      renderDraft(editor, d, opts.renderToken)
    }

    ui.collect(root, aiditor.effect(renderExternal))
    ui.collect(root, aiditor.effect(function () {
      editor.contentEditable = disabled() ? 'false' : 'true'
      root.classList.toggle('aiditor-richprompt-disabled', !!disabled())
    }))
    ui.collect(root, aiditor.effect(function () {
      const active = !!singleLine()
      root.classList.toggle('aiditor-richprompt-single-line', active)
      editor.classList.toggle('aiditor-richprompt-editor-single-line', active)
      editor.setAttribute('aria-multiline', active ? 'false' : 'true')
    }))

    editor.addEventListener('compositionstart', function () { composing = true })
    editor.addEventListener('compositionend', function () { composing = false; commitFromDom() })
    editor.addEventListener('input', commitFromDom)
    editor.addEventListener('click', function (ev) {
      const remove = ev.target && ev.target.closest && ev.target.closest('.aiditor-richprompt-token-remove')
      if (!remove) return
      const chip = remove.closest('.aiditor-richprompt-token')
      const token = chip && chip.dataset.efToken
      const d = value.peek()
      const idx = d.text.indexOf(token)
      if (idx >= 0) {
        value.set(aiditor.ai.richPrompt.deleteRange(d, idx, idx + 1))
        renderDraft(editor, value.peek(), opts.renderToken)
        setCaret(editor, idx)
      }
    })
    editor.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (composing || ev.isComposing)) return
      if (!composing && !ev.isComposing && opts.onKeyDown && opts.onKeyDown(ev)) return
      if (ev.key === 'Enter' && singleLine.peek()) {
        ev.preventDefault()
        if (opts.onSubmit) opts.onSubmit(ev)
        return
      }
      if (ev.key === 'Enter' && !ev.shiftKey && opts.onSubmit) {
        ev.preventDefault()
        opts.onSubmit(ev)
        return
      }
      if (ev.key === 'Enter' && ev.shiftKey) {
        ev.preventDefault()
        insertDraftText('\n')
        return
      }
      if (!singleLine.peek() && ev.key === 'ArrowUp' && moveCaretVertical(editor, -1)) {
        ev.preventDefault()
        return
      }
      if (!singleLine.peek() && ev.key === 'ArrowDown' && moveCaretVertical(editor, 1)) {
        ev.preventDefault()
        return
      }
      if (ev.key === 'Backspace' && deleteAdjacentAtom(editor, -1, value, opts.renderToken)) {
        ev.preventDefault()
        return
      }
      if (ev.key === 'Delete' && deleteAdjacentAtom(editor, 1, value, opts.renderToken)) {
        ev.preventDefault()
      }
    })
    editor.addEventListener('copy', function (ev) {
      const fragment = selectedDraft(editor, value.peek())
      if (!fragment) return
      if (setClipboardDraft(ev, fragment)) ev.preventDefault()
    })
    editor.addEventListener('cut', function (ev) {
      if (disabled()) return
      const fragment = selectedDraft(editor, value.peek())
      if (!fragment) return
      if (!setClipboardDraft(ev, fragment)) return
      ev.preventDefault()
      replaceSelectionWithDraft(aiditor.ai.richPrompt.empty())
    })
    editor.addEventListener('paste', function (ev) {
      ev.preventDefault()
      const rich = clipboardDraft(ev)
      if (rich) {
        replaceSelectionWithDraft(rich)
        return
      }
      const text = ev.clipboardData && ev.clipboardData.getData('text/plain')
      if (text != null) replaceSelectionWithText(text)
    })

    root.__aiditorRichPromptEditor = editor
    root.__aiditorRichPromptInsertRefs = function (references) {
      const current = singleLine.peek() ? singleLineDraft(value.peek()) : value.peek()
      const d = isBlankDraft(current) ? aiditor.ai.richPrompt.empty() : current
      const list = references || []
      const r = selectionRange(editor, d)
      const base = r.collapsed ? d : aiditor.ai.richPrompt.deleteRange(d, r.start, r.end)
      const next = aiditor.ai.richPrompt.insertRefs(base, r.start, list)
      value.set(next)
      renderDraft(editor, next, opts.renderToken)
      setCaret(editor, r.start + Math.max(0, list.length * 2 - 1))
    }
    root.__aiditorRichPromptFocus = function () { editor.focus() }
    root.__aiditorRichPromptApi = {
      editor: editor,
      draft: function () { return value.peek() },
      selectionRange: function () { return selectionRange(editor, value.peek()) },
      replaceRange: replaceRangeWithDraft,
      focus: function () { editor.focus() },
    }
    return root

    function insertDraftText(text) {
      replaceSelectionWithText(text)
    }

    function replaceSelectionWithText(text) {
      const d = singleLine.peek() ? singleLineDraft(value.peek()) : value.peek()
      const r = selectionRange(editor, d)
      const base = r.collapsed ? d : aiditor.ai.richPrompt.deleteRange(d, r.start, r.end)
      const inserted = singleLine.peek() ? String(text || '').replace(/\r\n?|\n/g, ' ') : text
      const next = aiditor.ai.richPrompt.insertText(base, r.start, inserted)
      value.set(next)
      renderDraft(editor, next, opts.renderToken)
      setCaret(editor, r.start + aiditor.ai.richPrompt.normalize({ text: inserted, tokens: {} }).text.length)
    }

    function replaceSelectionWithDraft(fragment) {
      const d = singleLine.peek() ? singleLineDraft(value.peek()) : value.peek()
      const r = selectionRange(editor, d)
      replaceRangeWithDraft(r.start, r.end, fragment)
    }

    function replaceRangeWithDraft(start, end, fragment) {
      const d = singleLine.peek() ? singleLineDraft(value.peek()) : value.peek()
      const r = {
        start: Math.max(0, Math.min(d.text.length, Math.min(start, end))),
        end: Math.max(0, Math.min(d.text.length, Math.max(start, end))),
      }
      const base = aiditor.ai.richPrompt.deleteRange(d, r.start, r.end)
      const normalized = aiditor.ai.richPrompt.normalize(fragment)
      const f = singleLine.peek() ? singleLineDraft(normalized) : normalized
      const next = aiditor.ai.richPrompt.insertDraft(base, r.start, f)
      value.set(next)
      renderDraft(editor, next, opts.renderToken)
      setCaret(editor, r.start + f.text.length)
      return next
    }
  }
})(window.aiditor = window.aiditor || {})

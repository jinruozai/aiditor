// aiditor.ai message markdown - safe zero-dependency rendering for model text.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const ui = aiditor.ui

  function appendText(parent, value) {
    parent.appendChild(document.createTextNode(String(value == null ? '' : value)))
  }

  function disposeTree(el) {
    while (el.firstChild) disposeTree(el.firstChild)
    if (ui.dispose) ui.dispose(el)
    if (el.parentNode) el.parentNode.removeChild(el)
  }

  function clear(parent) {
    while (parent.firstChild) disposeTree(parent.firstChild)
  }

  function safeUrl(value, media) {
    const url = String(value || '').trim()
    if (!url || /[\u0000-\u001f\u007f]/.test(url)) return ''
    const compact = url.replace(/[\u0000-\u0020]+/g, '')
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
    if (!scheme) return url
    const protocol = scheme[1].toLowerCase()
    if (media) {
      if (protocol === 'http' || protocol === 'https' || protocol === 'blob' || protocol === 'file') return url
      if (protocol === 'data' && /^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(compact)) return url
      return ''
    }
    return protocol === 'http' || protocol === 'https' || protocol === 'mailto' || protocol === 'tel' || protocol === 'file' || protocol === 'blob'
      ? url
      : ''
  }

  function parseDestination(value) {
    const source = String(value || '').trim()
    const match = /^(\S+?)(?:\s+["']([^"']*)["'])?$/.exec(source)
    return match ? { url: match[1], title: match[2] || '' } : { url: source, title: '' }
  }

  const INLINE_PATTERN = /(?<escape>\\(?<escaped>[\\`*_[\]{}()#+.!|>~-]))|(?<hardBreak>(?: {2,}|\\)\n)|(?<code>(?<ticks>`+)(?<codeText>[^\n]*?)\k<ticks>)|(?<image>!\[(?<imageAlt>[^\]]*)\]\((?<imageDest>[^\n)]+)\))|(?<link>\[(?<linkLabel>[^\]]+)\]\((?<linkDest>[^\n)]+)\))|(?<strong>(?<strongMark>\*\*|__)(?=\S)(?<strongText>[\s\S]*?\S)\k<strongMark>)|(?<strike>~~(?=\S)(?<strikeText>[\s\S]*?\S)~~)|(?<em>\*(?=\S)(?<emText>[^*\n]*?\S)\*)|(?<autolink><(?<autolinkUrl>https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>)|(?<url>https?:\/\/[^\s<>]+)/gi

  function appendPlain(parent, value) {
    appendText(parent, String(value || '').replace(/[ \t]*\n[ \t]*/g, ' '))
  }

  function renderInlineImage(alt, destination) {
    const parsed = parseDestination(destination)
    const src = safeUrl(parsed.url, true)
    if (!src) return null
    const img = ui.h('img', 'aiditor-ai-markdown-image')
    img.src = src
    img.alt = alt || 'image'
    img.loading = 'lazy'
    if (parsed.title) img.title = parsed.title
    img.addEventListener('click', function () {
      if (!ui.modal) return
      const viewer = ui.h('div', 'aiditor-ai-message-image-viewer')
      const large = ui.h('img', 'aiditor-ai-message-image-viewer-img')
      large.src = src
      large.alt = img.alt
      viewer.appendChild(large)
      ui.modal({ title: parsed.title || alt || 'Image', content: viewer })
    })
    return img
  }

  function renderInline(parent, source, depth) {
    source = String(source == null ? '' : source)
    depth = depth || 0
    if (depth > 8) {
      appendPlain(parent, source)
      return
    }
    const matcher = new RegExp(INLINE_PATTERN.source, INLINE_PATTERN.flags)
    let offset = 0
    let match
    while ((match = matcher.exec(source))) {
      const token = match.groups
      if (match.index > offset) appendPlain(parent, source.slice(offset, match.index))
      if (token.escape) {
        appendText(parent, token.escaped)
      } else if (token.hardBreak) {
        parent.appendChild(ui.h('br'))
      } else if (token.code) {
        const code = ui.h('code', 'aiditor-ai-markdown-inline-code')
        appendText(code, token.codeText)
        parent.appendChild(code)
      } else if (token.image) {
        const image = renderInlineImage(token.imageAlt, token.imageDest)
        if (image) parent.appendChild(image)
        else appendText(parent, match[0])
      } else if (token.link) {
        const parsed = parseDestination(token.linkDest)
        const href = safeUrl(parsed.url, false)
        if (!href) {
          renderInline(parent, token.linkLabel, depth + 1)
        } else {
          const link = ui.h('a', 'aiditor-ai-markdown-link')
          link.href = href
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          if (parsed.title) link.title = parsed.title
          renderInline(link, token.linkLabel, depth + 1)
          parent.appendChild(link)
        }
      } else if (token.strong) {
        const strong = ui.h('strong')
        renderInline(strong, token.strongText, depth + 1)
        parent.appendChild(strong)
      } else if (token.strike) {
        const del = ui.h('del')
        renderInline(del, token.strikeText, depth + 1)
        parent.appendChild(del)
      } else if (token.em) {
        const em = ui.h('em')
        renderInline(em, token.emText, depth + 1)
        parent.appendChild(em)
      } else {
        let label = token.autolinkUrl || token.url || match[0]
        let tail = ''
        if (token.url) {
          const trimmed = label.replace(/[.,;:!?]+$/, '')
          tail = label.slice(trimmed.length)
          label = trimmed
        }
        const href = safeUrl(label, false)
        if (href) {
          const link = ui.h('a', 'aiditor-ai-markdown-link')
          link.href = href
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          appendText(link, label)
          parent.appendChild(link)
        } else appendText(parent, label)
        if (tail) appendText(parent, tail)
      }
      offset = matcher.lastIndex
    }
    if (offset < source.length) appendPlain(parent, source.slice(offset))
  }

  function setCodeText(pre, value) {
    const code = ui.h('code')
    appendText(code, value)
    pre.appendChild(code)
  }

  function renderCode(lang, value) {
    const text = String(value == null ? '' : value)
    const wrap = ui.h('div', 'aiditor-ai-message-code-wrap')
    const head = ui.h('div', 'aiditor-ai-message-code-head')
    head.appendChild(ui.h('span', 'aiditor-ai-message-code-lang', { text: lang || 'code' }))
    if (ui.copyButton) head.appendChild(ui.copyButton({ text: text, title: 'Copy code', size: 'sm' }))
    const pre = ui.h('pre', 'aiditor-ai-message-code aiditor-ui-scrollarea')
    setCodeText(pre, text)
    wrap.appendChild(head)
    wrap.appendChild(pre)
    return wrap
  }

  function fenceAt(line) {
    const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/.exec(line)
    return match ? { mark: match[1], lang: match[2] || '' } : null
  }

  function headingAt(line) {
    return /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
  }

  function listAt(line) {
    const match = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line)
    if (!match) return null
    return {
      indent: match[1].replace(/\t/g, '    ').length,
      ordered: /^\d/.test(match[2]),
      start: /^\d/.test(match[2]) ? parseInt(match[2], 10) : 1,
      text: match[3],
    }
  }

  function isRule(line) {
    const source = line.trim()
    return /^(?:\*\s*){3,}$/.test(source) || /^(?:-\s*){3,}$/.test(source) || /^(?:_\s*){3,}$/.test(source)
  }

  function splitTableRow(line) {
    let source = String(line || '').trim()
    if (source.charAt(0) === '|') source = source.slice(1)
    if (source.charAt(source.length - 1) === '|') source = source.slice(0, -1)
    const cells = []
    let cell = ''
    let escaped = false
    for (let i = 0; i < source.length; i++) {
      const ch = source.charAt(i)
      if (escaped) {
        cell += ch
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '|') {
        cells.push(cell.trim())
        cell = ''
      } else cell += ch
    }
    cells.push(cell.trim())
    return cells
  }

  function tableAlignments(line) {
    const cells = splitTableRow(line)
    if (!cells.length) return null
    const align = []
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i].replace(/\s/g, '')
      if (!/^:?-{3,}:?$/.test(cell)) return null
      align.push(cell.charAt(0) === ':' && cell.charAt(cell.length - 1) === ':' ? 'center' : (cell.charAt(cell.length - 1) === ':' ? 'right' : 'left'))
    }
    return align
  }

  function tableAt(lines, index) {
    return index + 1 < lines.length && lines[index].indexOf('|') >= 0 ? tableAlignments(lines[index + 1]) : null
  }

  function isBlockStart(lines, index) {
    const line = lines[index]
    return !line.trim() || !!fenceAt(line) || !!headingAt(line) || /^ {0,3}>/.test(line) || !!listAt(line) || isRule(line) || !!tableAt(lines, index)
  }

  function renderTable(lines, index, align) {
    const wrap = ui.h('div', 'aiditor-ai-markdown-table-wrap aiditor-ui-scrollarea')
    const table = ui.h('table', 'aiditor-ai-markdown-table')
    const thead = ui.h('thead')
    const headRow = ui.h('tr')
    const headers = splitTableRow(lines[index])
    for (let i = 0; i < headers.length; i++) {
      const th = ui.h('th')
      th.style.textAlign = align[i] || 'left'
      renderInline(th, headers[i])
      headRow.appendChild(th)
    }
    thead.appendChild(headRow)
    table.appendChild(thead)
    const tbody = ui.h('tbody')
    index += 2
    while (index < lines.length && lines[index].trim() && lines[index].indexOf('|') >= 0 && !isBlockStart(lines, index)) {
      const row = ui.h('tr')
      const cells = splitTableRow(lines[index])
      for (let i = 0; i < headers.length; i++) {
        const td = ui.h('td')
        td.style.textAlign = align[i] || 'left'
        renderInline(td, cells[i] || '')
        row.appendChild(td)
      }
      tbody.appendChild(row)
      index++
    }
    table.appendChild(tbody)
    wrap.appendChild(table)
    return { el: wrap, index: index }
  }

  function renderList(lines, index, indent, ordered, depth) {
    depth = depth || 0
    const list = ui.h(ordered ? 'ol' : 'ul', 'aiditor-ai-markdown-list')
    const first = listAt(lines[index])
    if (ordered && first.start !== 1) list.start = first.start
    let lastItem = null
    while (index < lines.length) {
      const item = listAt(lines[index])
      if (!item || item.indent < indent) break
      if (item.indent > indent) {
        if (!lastItem) break
        if (depth >= 12) {
          lastItem.appendChild(ui.h('br'))
          renderInline(lastItem, item.text)
          index++
        } else {
          const nested = renderList(lines, index, item.indent, item.ordered, depth + 1)
          lastItem.appendChild(nested.el)
          index = nested.index
        }
        continue
      }
      if (item.ordered !== ordered) break
      const li = ui.h('li', 'aiditor-ai-markdown-list-item')
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item.text)
      if (task) {
        li.className += ' is-task'
        li.setAttribute('role', 'listitem')
        const checkbox = ui.h('input', 'aiditor-ai-markdown-task')
        checkbox.type = 'checkbox'
        checkbox.checked = task[1].toLowerCase() === 'x'
        checkbox.disabled = true
        checkbox.tabIndex = -1
        li.appendChild(checkbox)
        const label = ui.h('span')
        renderInline(label, task[2])
        li.appendChild(label)
      } else renderInline(li, item.text)
      list.appendChild(li)
      lastItem = li
      index++
      while (index < lines.length) {
        const nestedItem = listAt(lines[index])
        if (nestedItem && nestedItem.indent > indent) {
          if (depth >= 12) {
            li.appendChild(ui.h('br'))
            renderInline(li, nestedItem.text)
            index++
          } else {
            const nested = renderList(lines, index, nestedItem.indent, nestedItem.ordered, depth + 1)
            li.appendChild(nested.el)
            index = nested.index
          }
          continue
        }
        const continuation = /^(\s+)(\S.*)$/.exec(lines[index])
        if (continuation && continuation[1].replace(/\t/g, '    ').length > indent) {
          li.appendChild(ui.h('br'))
          renderInline(li, continuation[2])
          index++
          continue
        }
        break
      }
    }
    return { el: list, index: index }
  }

  function renderBlocks(parent, lines, depth) {
    depth = depth || 0
    if (depth > 12) {
      const paragraph = ui.h('p', 'aiditor-ai-markdown-paragraph')
      renderInline(paragraph, lines.join('\n'))
      parent.appendChild(paragraph)
      return
    }
    let index = 0
    while (index < lines.length) {
      const line = lines[index]
      if (!line.trim()) {
        index++
        continue
      }
      const fence = fenceAt(line)
      if (fence) {
        const body = []
        const marker = fence.mark.charAt(0)
        const length = fence.mark.length
        index++
        while (index < lines.length && !new RegExp('^ {0,3}' + (marker === '`' ? '`' : '~') + '{' + length + ',}\\s*$').test(lines[index])) {
          body.push(lines[index])
          index++
        }
        if (index < lines.length) index++
        parent.appendChild(renderCode(fence.lang, body.join('\n')))
        continue
      }
      const heading = headingAt(line)
      if (heading) {
        const level = heading[1].length
        const el = ui.h('h' + level, 'aiditor-ai-markdown-heading aiditor-ai-markdown-h' + level)
        renderInline(el, heading[2])
        parent.appendChild(el)
        index++
        continue
      }
      if (isRule(line)) {
        parent.appendChild(ui.h('hr', 'aiditor-ai-markdown-rule'))
        index++
        continue
      }
      if (/^ {0,3}>/.test(line)) {
        const quoted = []
        while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
          quoted.push(lines[index].replace(/^ {0,3}> ?/, ''))
          index++
        }
        const quote = ui.h('blockquote', 'aiditor-ai-markdown-quote')
        renderBlocks(quote, quoted, depth + 1)
        parent.appendChild(quote)
        continue
      }
      const align = tableAt(lines, index)
      if (align) {
        const rendered = renderTable(lines, index, align)
        parent.appendChild(rendered.el)
        index = rendered.index
        continue
      }
      const item = listAt(line)
      if (item) {
        const rendered = renderList(lines, index, item.indent, item.ordered, 0)
        parent.appendChild(rendered.el)
        index = rendered.index
        continue
      }
      const paragraph = []
      while (index < lines.length && lines[index].trim() && (!paragraph.length || !isBlockStart(lines, index))) {
        paragraph.push(lines[index])
        index++
      }
      const p = ui.h('p', 'aiditor-ai-markdown-paragraph')
      renderInline(p, paragraph.join('\n'))
      parent.appendChild(p)
    }
  }

  function hasMarkdown(source) {
    return /(^|\n) {0,3}(?:#{1,6}\s|>|`{3,}|~{3,}|[-+*]\s+|\d+[.)]\s+)/.test(source) ||
      /(^|\n) {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})\s*(?:\n|$)/.test(source) ||
      /(?:\*\*|__|~~|`|!\[|\[[^\]]+\]\(|https?:\/\/)/.test(source) ||
      /\n[^\n|]*\|[^\n]*\n\s*\|?\s*:?-{3,}/.test('\n' + source)
  }

  function patch(root, value) {
    const source = String(value == null ? '' : value).replace(/\r\n?/g, '\n')
    if (root.__aiditorMarkdownSource === source) return root
    root.__aiditorMarkdownSource = source
    const rich = hasMarkdown(source)
    if (!rich && root.dataset.markdownMode === 'plain' && root.childNodes.length === 1 && root.firstChild.nodeType === 3) {
      root.firstChild.nodeValue = source
      return root
    }
    clear(root)
    if (!rich) {
      root.dataset.markdownMode = 'plain'
      appendText(root, source)
      return root
    }
    root.dataset.markdownMode = 'rich'
    renderBlocks(root, source.split('\n'))
    return root
  }

  function render(value) {
    const root = ui.h('div', 'aiditor-ai-message-text aiditor-ai-markdown')
    return patch(root, value)
  }

  ai.messageMarkdown = {
    render: render,
    patch: patch,
    renderCode: renderCode,
  }
})(window.aiditor = window.aiditor || {})

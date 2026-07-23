// aiditor.ai combined chat panel - transcript + composer with an internal splitter.
;(function (aiditor) {
  'use strict'

  const ui = aiditor.ui

  function disposeTree(el) {
    if (!el) return
    while (el.firstChild) disposeTree(el.firstChild)
    ui.dispose(el)
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function factory(propsSig, ctx) {
    const props = propsSig.peek() || {}
    const inputProps = props.input || {}
    const inline = inputProps.layout === 'inline'
    const root = ui.h('div', 'aiditor-ai-panel aiditor-ai-chat-combined' + (inline ? ' aiditor-ai-chat-combined-inline' : ''))
    const messagesPane = ui.h('div', 'aiditor-ai-chat-combined-messages')
    const inputPane = ui.h('div', 'aiditor-ai-chat-combined-input')
    const messageSpec = aiditor.resolveComponent('ai-messages')
    const inputSpec = aiditor.resolveComponent('ai-chatinput')

    messagesPane.appendChild(messageSpec.factory(aiditor.signal(props.messages || {}), ctx))
    inputPane.appendChild(inputSpec.factory(aiditor.signal(inputProps), ctx))
    root.appendChild(messagesPane)
    if (!inline) root.appendChild(createSplitter())
    root.appendChild(inputPane)

    if (!inline) root.style.setProperty('--aiditor-ai-chat-input-size', Number(props.inputSize || 230) + 'px')

    return root

    function createSplitter() {
      const splitter = ui.h('div', 'aiditor-ai-chat-combined-splitter', {
        role: 'separator',
        'aria-orientation': 'horizontal',
        tabindex: '0',
      })
      splitter.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return
        ev.preventDefault()
        splitter.setPointerCapture(ev.pointerId)
        root.classList.add('aiditor-ai-chat-combined-resizing')
        const startY = ev.clientY
        const startInput = inputPane.getBoundingClientRect().height
        const move = function (moveEv) {
          const total = root.getBoundingClientRect().height
          const minInput = Number(props.minInputSize || 140)
          const minMessages = Number(props.minMessagesSize || 160)
          const next = clamp(startInput - (moveEv.clientY - startY), minInput, Math.max(minInput, total - minMessages))
          root.style.setProperty('--aiditor-ai-chat-input-size', Math.round(next) + 'px')
        }
        const up = function (upEv) {
          if (splitter.releasePointerCapture) splitter.releasePointerCapture(upEv.pointerId)
          root.classList.remove('aiditor-ai-chat-combined-resizing')
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      })

      splitter.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return
        ev.preventDefault()
        const current = inputPane.getBoundingClientRect().height
        const total = root.getBoundingClientRect().height
        const minInput = Number(props.minInputSize || 140)
        const minMessages = Number(props.minMessagesSize || 160)
        const dir = ev.key === 'ArrowUp' ? 1 : -1
        const next = clamp(current + dir * 24, minInput, Math.max(minInput, total - minMessages))
        root.style.setProperty('--aiditor-ai-chat-input-size', Math.round(next) + 'px')
      })
      return splitter
    }
  }

  aiditor.registerComponent('ai-chat', {
    category: 'panel',
    label: 'AI Chat',
    icon: 'message-circle',
    defaults: function () { return { title: 'Chat', icon: 'message-circle', props: { inputSize: 230 } } },
    factory: factory,
    dispose: disposeTree,
  })
})(window.aiditor = window.aiditor || {})

// Shared compact formatting for AI message and live-run metrics.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const UNITS = ['', 'K', 'M', 'B', 'T']

  function fixed(value, digits) {
    const text = Number(value).toFixed(digits)
    return digits ? text.replace(/\.?0+$/, '') : text
  }

  function compact(value) {
    let n = Number(value)
    if (!Number.isFinite(n)) return ''
    let unit = 0
    while (Math.abs(n) >= 1000 && unit < UNITS.length - 1) {
      n /= 1000
      unit++
    }
    const digits = unit ? (Math.abs(n) < 10 ? 2 : (Math.abs(n) < 100 ? 1 : 0)) : 0
    return fixed(n, digits) + UNITS[unit]
  }

  function duration(ms) {
    const value = Number(ms)
    if (!(value > 0)) return ''
    if (value < 1000) return String(Math.max(1, Math.round(value))) + ' ms'
    if (value < 10000) return fixed(value / 1000, 1) + ' s'
    if (value < 60000) return String(Math.round(value / 1000)) + ' s'

    const totalSeconds = Math.round(value / 1000)
    if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return String(minutes) + 'm' + (seconds ? ' ' + String(seconds) + 's' : '')
    }
    if (totalSeconds < 86400) {
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor(totalSeconds % 3600 / 60)
      return String(hours) + 'h' + (minutes ? ' ' + String(minutes) + 'm' : '')
    }
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor(totalSeconds % 86400 / 3600)
    return String(days) + 'd' + (hours ? ' ' + String(hours) + 'h' : '')
  }

  function tokens(value) {
    const n = Number(value)
    return n > 0 ? compact(Math.round(n)) : ''
  }

  function rate(value) {
    const n = Number(value)
    if (!(n > 0)) return ''
    return n < 1000 ? fixed(n, 1) : compact(n)
  }

  function cost(value) {
    const n = Number(value && value.amount || value || 0)
    if (!(n > 0)) return ''
    if (n >= 1000) return '$' + compact(n)
    const digits = n < 0.0001 ? 6 : (n < 0.01 ? 5 : 4)
    return '$' + fixed(n, digits)
  }

  ai.metricFormat = Object.freeze({
    duration: duration,
    tokens: tokens,
    rate: rate,
    cost: cost,
  })
})(window.aiditor = window.aiditor || {})

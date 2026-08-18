// Local-storage access owner. All raw localStorage reads and writes go through
// here so availability probing and quota/error tolerance live in one place.
;(function (aiditor) {
  'use strict'

  function available() {
    try { return !!window.localStorage } catch (_) { return false }
  }

  function text(key) {
    try { return window.localStorage.getItem(key) } catch (_) { return null }
  }

  function setText(key, value) {
    try { window.localStorage.setItem(key, value); return true } catch (_) { return false }
  }

  function remove(key) {
    try { window.localStorage.removeItem(key) } catch (_) {}
  }

  function json(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch (_) { return fallback }
  }

  function setJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true } catch (_) { return false }
  }

  aiditor.storage = {
    available: available,
    text: text,
    setText: setText,
    remove: remove,
    json: json,
    setJson: setJson,
  }
})(window.aiditor = window.aiditor || {})

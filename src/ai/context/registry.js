// AI Host factual Context provider registry.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const registry = ai._contributionRegistry.create('ai.context', { cleanupKey: 'context' })

  function collect(request, ctx) {
    const out = []
    const names = registry.list()
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const provider = registry.get(name)
      const matched = !provider.match || provider.match(request.target || request.agent, request.event || null, ctx)
      if (!matched) continue
      const value = aiditor.safeCall
        ? aiditor.safeCall({ scope: 'ai.context', provider: name }, function () {
          return provider.capture ? provider.capture(request.target || request.agent, request.event || null, ctx) : provider(request, ctx)
        })
        : (provider.capture ? provider.capture(request.target || request.agent, request.event || null, ctx) : provider(request, ctx))
      out.push({ id: name, value: value })
    }
    return out
  }

  ai.context = registry
  ai.collectContext = collect
})(window.aiditor = window.aiditor || {})

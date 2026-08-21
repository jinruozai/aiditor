// Model-facing deterministic Skill discovery and reading.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const META = { owner: 'aiditor.ai.skills', layer: 'builtin', source: 'builtin' }

  function toolCounts(skill, ctx) {
    const tools = skill && skill.tools || []
    let available = 0
    for (let i = 0; i < tools.length; i++) {
      if (ai.tools.available(tools[i], ctx || {})) available++
    }
    return { available: available, total: tools.length }
  }

  function summary(skill, ctx) {
    const description = String(skill.description || '').trim().replace(/\s+/g, ' ')
    return {
      id: skill.id,
      description: description.length > 160 ? description.slice(0, 159).trim() + '…' : description,
      tools: toolCounts(skill, ctx),
    }
  }

  ai.tools.register('skill.list', {
    title: 'List Skills',
    description: 'List registered Skills deterministically. Follow nextCursor to enumerate every page without repeating earlier pages.',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: { type: 'string', pattern: '^skill:[0-9]+$' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
    },
    run: function (args, ctx) {
      const page = ai.skills.page(args && args.cursor, args && args.limit)
      return {
        total: page.total,
        nextCursor: page.nextCursor,
        skills: page.items.map(function (skill) { return summary(skill, ctx) }),
      }
    },
  }, META)

  ai.tools.register('skill.read', {
    title: 'Read Skill',
    description: 'Read the complete instructions for one registered Skill, or one readable resource from that Skill.',
    schema: {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        resource: { type: 'string', minLength: 1 },
      },
    },
    run: function (args, ctx) {
      const id = String(args.id)
      const resource = args.resource == null ? '' : String(args.resource)
      const result = ai.skills.read(id, resource)
      if (resource || result && typeof result.then === 'function') return result
      return Object.assign({}, result, { tools: toolCounts(ai.skills.get(id), ctx) })
    },
  }, META)
})(window.aiditor = window.aiditor || {})

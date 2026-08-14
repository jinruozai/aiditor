// Model-facing Skill discovery and run-scoped activation controls.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}
  const META = { owner: 'aiditor.ai.skills', layer: 'builtin', source: 'builtin' }

  ai.tools.register('skill.list', {
    title: 'List Skills',
    description: 'Discover focused capabilities available in the current AIditor runtime. Use this when the task needs a capability that is not already active.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional intent or capability query.' },
        limit: { type: 'number', minimum: 1, maximum: 100 },
      },
    },
    run: function (input, ctx) {
      const catalogCtx = ai._runSkillContext ? ai._runSkillContext(ctx && ctx.runId, ctx || {}) : (ctx || {})
      return { skills: ai.skills.catalog(catalogCtx, input || {}) }
    },
  }, META)

  ai.tools.register('skill.activate', {
    title: 'Activate Skill',
    description: 'Activate one available Skill for the current run. Its instructions and Tools become available on the next continuation.',
    schema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    run: function (input, ctx) {
      if (!ai.activateRunSkill) throw new Error('Skill activation requires an active Agent run.')
      return ai.activateRunSkill(ctx && ctx.runId, input.id, ctx || {})
    },
  }, META)

  ai.skillControlTools = Object.freeze(['skill.list', 'skill.activate'])
})(window.aiditor = window.aiditor || {})

// aiditor.ai agent name generator.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  const AGENT_NAMES = [
    'Aria', 'Atlas', 'Aster', 'Astra', 'Aurora', 'Blake', 'Briar', 'Calder', 'Calla', 'Cedar',
    'Celeste', 'Cleo', 'Corin', 'Daphne', 'Darcy', 'Eden', 'Elara', 'Ember', 'Esme', 'Felix',
    'Flora', 'Galen', 'Harper', 'Hazel', 'Iris', 'Jasper', 'Juniper', 'Kai', 'Keira', 'Lena',
    'Leo', 'Liora', 'Luna', 'Lyra', 'Maren', 'Mira', 'Nico', 'Nova', 'Opal', 'Orion',
    'Phoebe', 'Piper', 'Quinn', 'Rhea', 'River', 'Rowan', 'Sage', 'Selene', 'Silas', 'Skye',
    'Sol', 'Stella', 'Talia', 'Theo', 'Vale', 'Vega', 'Vera', 'Wren', 'Yara', 'Zora',
  ]

  const AGENT_ROLES = [
    'Anchor', 'Archivist', 'Beacon', 'Binder', 'Builder', 'Canvas', 'Cartographer', 'Cipher', 'Compass', 'Conductor',
    'Crafter', 'Curator', 'Drift', 'Editor', 'Envoy', 'Finder', 'Forge', 'Gardener', 'Guide', 'Harbor',
    'Indexer', 'Keeper', 'Lantern', 'Lattice', 'Lens', 'Mapper', 'Marker', 'Mentor', 'Muse', 'Navigator',
    'Notary', 'Oracle', 'Pathfinder', 'Pilot', 'Planner', 'Pulse', 'Quill', 'Ranger', 'Relay', 'Scout',
    'Scribe', 'Seeker', 'Sentinel', 'Signal', 'Sketch', 'Solver', 'Spark', 'Studio', 'Surveyor', 'Tailor',
    'Thread', 'Tracker', 'Vector', 'Vessel', 'Voyager', 'Warden', 'Weaver', 'Whisper', 'Wit', 'Writer',
  ]

  function normalizeName(name) {
    return String(name || '').trim().toLowerCase()
  }

  function takenSet(existingNames) {
    const set = {}
    for (let i = 0; i < existingNames.length; i++) set[normalizeName(existingNames[i])] = true
    return set
  }

  function comboAt(index) {
    const roleCount = AGENT_ROLES.length
    return AGENT_NAMES[Math.floor(index / roleCount)] + ' ' + AGENT_ROLES[index % roleCount]
  }

  function pickIndex(length, rng) {
    return Math.floor((rng || Math.random)() * length)
  }

  function nextNumberedName(base, taken) {
    let n = 2
    while (taken[normalizeName(base + ' ' + n)]) n++
    return base + ' ' + n
  }

  function generateAgentName(existingNames, rng) {
    const names = existingNames || []
    const taken = takenSet(names)
    const total = AGENT_NAMES.length * AGENT_ROLES.length
    const available = []
    for (let i = 0; i < total; i++) {
      const name = comboAt(i)
      if (!taken[normalizeName(name)]) available.push(name)
    }
    if (available.length) return available[pickIndex(available.length, rng)]
    return nextNumberedName(comboAt(pickIndex(total, rng)), taken)
  }

  ai.generateAgentName = generateAgentName
})(window.aiditor = window.aiditor || {})

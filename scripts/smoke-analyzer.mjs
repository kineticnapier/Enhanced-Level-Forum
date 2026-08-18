import { analyzeFingering, estimateFingeringForKeyCount, FINGERING_MODEL_VERSION } from './analyzer/fingering-dp.mjs'
import { extractAdofaiPressEvents, extractAdofaiPressEventsFromText, ADOFAI_TIMING_VERSION } from './analyzer/adofai-timing.mjs'

const stream = { hitTimesMs: Array.from({ length: 24 }, (_, i) => i * 55), keyCounts: [2, 4, 6, 8, 10, 12] }
const result = analyzeFingering(stream, { beamWidth: 96 })
if (result.modelVersion !== FINGERING_MODEL_VERSION) throw new Error('fingering model version missing')
if (result.canonicalRatingMutation !== false) throw new Error('analyzer must never mutate canonical rating')
if (result.keyCountCurve.length !== 6) throw new Error('key-count curve missing points')
for (let i = 1; i < result.keyCountCurve.length; i++) {
  const prev = result.keyCountCurve[i - 1]
  const next = result.keyCountCurve[i]
  if (prev.feasible && next.feasible && next.totalCost > prev.totalCost + 1e-9) {
    throw new Error(`more keys unexpectedly increased optimum cost: ${prev.keyCount}K -> ${next.keyCount}K`)
  }
}

const chord = { events: [{ timeMs: 0, presses: 3 }, { timeMs: 100, presses: 1 }] }
const two = estimateFingeringForKeyCount(chord, 2)
const four = estimateFingeringForKeyCount(chord, 4)
if (two.feasible) throw new Error('3 simultaneous presses must not fit 2K')
if (!four.feasible) throw new Error('3 simultaneous presses should fit 4K')

const duplicateTimes = analyzeFingering({ hitTimesMs: [0, 0, 0, 100], keyCounts: [2, 4] })
if (duplicateTimes.input.maxSimultaneousPresses !== 3) throw new Error('duplicate hit times must group into simultaneous presses')
if (duplicateTimes.keyCountCurve[0].feasible) throw new Error('grouped 3-press chord must reject 2K path')
if (!duplicateTimes.keyCountCurve[1].feasible) throw new Error('grouped 3-press chord must allow 4K path')

const straight = extractAdofaiPressEvents({
  angleData: [0, 0, 0],
  settings: { bpm: 120, pitch: 100, offset: 123 },
  actions: [],
})
if (straight.timing.extractorVersion !== ADOFAI_TIMING_VERSION) throw new Error('ADOFAI timing extractor version missing')
if (straight.events.length !== 3) throw new Error('three straight tiles should create three presses')
for (const [index, expected] of [500, 1000, 1500].entries()) {
  if (Math.abs(straight.events[index].timeMs - expected) > 1e-9) throw new Error(`straight timing mismatch at ${index}`)
}
if (straight.events[0].timeMs === 623) throw new Error('level offset must not alter relative fingering intervals')

const speedChange = extractAdofaiPressEvents({
  angleData: [0, 0, 0],
  settings: { bpm: 120, pitch: 100 },
  actions: [{ floor: 1, eventType: 'SetSpeed', speedType: 'Multiplier', bpmMultiplier: 2 }],
})
for (const [index, expected] of [500, 750, 1000].entries()) {
  if (Math.abs(speedChange.events[index].timeMs - expected) > 1e-9) throw new Error(`SetSpeed timing mismatch at ${index}`)
}

const pathData = extractAdofaiPressEventsFromText(`\ufeff{
  "pathData": "RRR",
  "settings": { "bpm": 120, "pitch": 100, },
  "actions": [],
}`)
if (pathData.timing.angleSource !== 'pathData') throw new Error('pathData source not detected')
if (pathData.events.length !== 3) throw new Error('pathData should create three presses')

const midspin = extractAdofaiPressEvents({
  angleData: [0, 999, 180],
  settings: { bpm: 120, pitch: 100 },
  actions: [],
})
if (midspin.events.length !== 2) throw new Error('midspin marker must not create a player press')

const special = extractAdofaiPressEvents({
  angleData: [0],
  settings: { bpm: 120, pitch: 100 },
  actions: [
    { floor: 0, eventType: 'Hold', duration: 1 },
    { floor: 0, eventType: 'MultiPlanet', planets: 'ThreePlanets' },
  ],
})
if (!special.timing.warnings.includes('HOLD_INPUT_SEMANTICS_APPROXIMATE')) throw new Error('Hold approximation warning missing')
if (!special.timing.warnings.includes('MULTIPLANET_PRESS_COUNT_NOT_MODELED')) throw new Error('MultiPlanet warning missing')

const direct = analyzeFingering(straight)
if (direct.input.eventCount !== 3) throw new Error('ADOFAI extractor output must feed fingering DP directly')

console.log('DP FINGERING ANALYZER STATIC SMOKE PASSED')
console.log('.adofai angle/path timing -> Twirl/SetSpeed/pitch -> beam-DP fingering -> key-count curve')

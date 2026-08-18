import { analyzeFingering, estimateFingeringForKeyCount, FINGERING_MODEL_VERSION } from './analyzer/fingering-dp.mjs'

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

console.log('DP FINGERING ANALYZER STATIC SMOKE PASSED')
console.log('input timings -> beam-DP fingering -> key-count cost curve; canonical rating remains human-controlled')

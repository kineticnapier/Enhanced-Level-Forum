import { readFile } from 'node:fs/promises'
import { analyzeFingering, estimateFingeringForKeyCount, FINGERING_MODEL_VERSION } from './analyzer/fingering-dp.mjs'
import { extractAdofaiPressEvents, extractAdofaiPressEventsFromText, ADOFAI_TIMING_VERSION } from './analyzer/adofai-timing.mjs'

const stream = { hitTimesMs: Array.from({ length: 24 }, (_, i) => i * 55), keyCounts: [2, 4, 6, 8, 10, 12] }
const result = analyzeFingering(stream, { beamWidth: 96 })
if (result.modelVersion !== FINGERING_MODEL_VERSION) throw new Error('fingering model version missing')
if (result.canonicalRatingMutation !== false) throw new Error('analyzer must never mutate canonical rating')
if (result.keyCountCurve.length !== 6) throw new Error('explicit key-count curve must keep all requested points')
if (!Array.isArray(result.fingeringTrace) || result.fingeringTrace.length !== 24) throw new Error('best fingering trace missing')
if (!Number.isInteger(result.traceKeyCount)) throw new Error('trace key count missing')
if (!result.fingeringTrace.every((x) => typeof x.fingerLabel === 'string' && (x.hand === 'L' || x.hand === 'R'))) throw new Error('hand-aware trace labels missing')
if (!result.keyCountCurve.every((x) => Number.isFinite(x.peakLocalCostPerPress))) throw new Error('local peak load metric missing')
for (let i = 1; i < result.keyCountCurve.length; i++) {
  const prev = result.keyCountCurve[i - 1]
  const next = result.keyCountCurve[i]
  if (prev.feasible && next.feasible && next.totalCost > prev.totalCost + 0.5) throw new Error(`more keys unexpectedly increased approximate optimum cost: ${prev.keyCount}K -> ${next.keyCount}K`)
}

const adaptive = analyzeFingering({ hitTimesMs: Array.from({ length: 16 }, (_, i) => i * 200) }, { beamWidth: 64 })
if (!adaptive.config.adaptiveStop) throw new Error('default search should be adaptive')
if (adaptive.keyCountCurve.length >= adaptive.config.requestedKeyCounts.length) throw new Error('easy chart should stop before full default curve')
if (!adaptive.fingeringTrace?.length) throw new Error('adaptive search must rerun selected key count with trace')
const expectedDefaultKeys = [2, 3, 4, 6, 8, 10, 12, 16, 24, 32, 36]
if (JSON.stringify(adaptive.config.requestedKeyCounts) !== JSON.stringify(expectedDefaultKeys)) throw new Error('default key-count curve must extend through 36K')
if (adaptive.config.requestedKeyCounts.includes(5) || adaptive.config.requestedKeyCounts.includes(7)) throw new Error('5K/7K must not be automatic bridge points')

const thirtySix = estimateFingeringForKeyCount({ hitTimesMs: [0, 100] }, 36, { collectTrace: true, beamWidth: 32 })
if (!thirtySix.feasible || thirtySix.fingerProfile.length !== 36) throw new Error('36K profile must be supported')
if (thirtySix.fingerProfile[0].label !== 'L18' || thirtySix.fingerProfile[17].label !== 'L1' || thirtySix.fingerProfile[18].label !== 'R1' || thirtySix.fingerProfile[35].label !== 'R18') throw new Error('36K split profile labels must be L18..L1 / R1..R18')

const naturalAlternation = estimateFingeringForKeyCount(
  { hitTimesMs: Array.from({ length: 20 }, (_, i) => i * 90) },
  4,
  { collectTrace: true, beamWidth: 128 },
)
const naturalLabels = new Set(naturalAlternation.fingeringTrace?.map((x) => x.fingerLabel) ?? [])
if ([...naturalLabels].some((label) => !['LI', 'RI'].includes(label))) throw new Error(`moderate 2-key alternation should prefer LI/RI, got ${[...naturalLabels].join('/')}`)

const tripletRoll = estimateFingeringForKeyCount(
  { hitTimesMs: Array.from({ length: 24 }, (_, i) => i * 65) },
  3,
  { collectTrace: true, beamWidth: 160 },
)
if (!tripletRoll.feasible) throw new Error('3K triplet roll should be feasible')
if (tripletRoll.fingerProfile.map((x) => x.label).join('/') !== 'LI/RI/RM') throw new Error('3K profile should prioritize LI/RI/RM')
if (new Set(tripletRoll.fingeringTrace?.map((x) => x.finger) ?? []).size < 3) throw new Error('fast triplet stream should actually use the 3K roll')

const localBurstInput = {
  hitTimesMs: [
    ...Array.from({ length: 18 }, (_, i) => i * 220),
    ...Array.from({ length: 18 }, (_, i) => 4500 + i * 25),
    ...Array.from({ length: 18 }, (_, i) => 5500 + i * 220),
  ],
  keyCounts: [4, 6, 8],
}
const localBurst = analyzeFingering(localBurstInput, { beamWidth: 128 })
const burst4 = localBurst.keyCountCurve.find((x) => x.keyCount === 4)
const burst6 = localBurst.keyCountCurve.find((x) => x.keyCount === 6)
if (!Number.isFinite(burst4?.peakLocalCostPerPress) || !Number.isFinite(burst6?.peakLocalCostPerPress)) throw new Error('burst peak metrics missing')
if (!(burst6.peakLocalCostPerPress < burst4.peakLocalCostPerPress)) throw new Error('6K should reduce the local burst bottleneck versus 4K')

const chord = { events: [{ timeMs: 0, presses: 3 }, { timeMs: 100, presses: 1 }] }
const two = estimateFingeringForKeyCount(chord, 2)
const four = estimateFingeringForKeyCount(chord, 4, { collectTrace: true })
if (two.feasible) throw new Error('3 simultaneous presses must not fit 2K')
if (!four.feasible) throw new Error('3 simultaneous presses should fit 4K')
if (four.fingeringTrace?.length !== 4) throw new Error('chord trace must contain every press')
if (new Set(four.fingeringTrace.slice(0, 3).map((x) => x.finger)).size !== 3) throw new Error('simultaneous chord must use distinct fingers')

const duplicateTimes = analyzeFingering({ hitTimesMs: [0, 0, 0, 100], keyCounts: [2, 4] })
if (duplicateTimes.input.maxSimultaneousPresses !== 3) throw new Error('duplicate hit times must group into simultaneous presses')
if (duplicateTimes.keyCountCurve[0].feasible) throw new Error('grouped 3-press chord must reject 2K path')
if (!duplicateTimes.keyCountCurve[1].feasible) throw new Error('grouped 3-press chord must allow 4K path')

const straight = extractAdofaiPressEvents({ angleData: [0, 0, 0], settings: { bpm: 120, pitch: 100, offset: 123 }, actions: [] })
if (straight.timing.extractorVersion !== ADOFAI_TIMING_VERSION) throw new Error('ADOFAI timing extractor version missing')
if (straight.events.length !== 3) throw new Error('three straight tiles should create three presses')
if (!Array.isArray(straight.timing.track) || straight.timing.track.length !== 4) throw new Error('track geometry missing')
if (Math.abs(straight.timing.track[3].x - 3) > 1e-9 || Math.abs(straight.timing.track[3].y) > 1e-9) throw new Error('straight track geometry mismatch')
for (const [index, expected] of [500, 1000, 1500].entries()) if (Math.abs(straight.events[index].timeMs - expected) > 1e-9) throw new Error(`straight timing mismatch at ${index}`)
if (straight.events[0].timeMs === 623) throw new Error('level offset must not alter relative fingering intervals')
if (!straight.timing.segments.every((s) => Number.isFinite(s.segmentStartMs) && Number.isFinite(s.travelStartMs))) throw new Error('playback segment timestamps missing')

const speedChange = extractAdofaiPressEvents({
  angleData: [0, 0, 0], settings: { bpm: 120, pitch: 100 },
  actions: [
    { floor: 1, eventType: 'SetSpeed', speedType: 'Multiplier', bpmMultiplier: 2 },
    { floor: 2, eventType: 'Twirl' },
  ],
})
for (const [index, expected] of [500, 750, 1000].entries()) if (Math.abs(speedChange.events[index].timeMs - expected) > 1e-9) throw new Error(`SetSpeed timing mismatch at ${index}`)
if (!speedChange.timing.visualEvents.some((x) => x.eventType === 'SetSpeed' && x.bpmAfter === 240)) throw new Error('SetSpeed visual marker missing')
if (!speedChange.timing.visualEvents.some((x) => x.eventType === 'Twirl')) throw new Error('Twirl visual marker missing')

const pathData = extractAdofaiPressEventsFromText(`\ufeff{\n  "pathData": "RRR",\n  "settings": { "bpm": 120, "pitch": 100, },\n  "actions": [],\n}`)
if (pathData.timing.angleSource !== 'pathData') throw new Error('pathData source not detected')
if (pathData.events.length !== 3) throw new Error('pathData should create three presses')

const midspin = extractAdofaiPressEvents({ angleData: [0, 999, 180], settings: { bpm: 120, pitch: 100 }, actions: [] })
if (midspin.events.length !== 2) throw new Error('midspin marker must not create a player press')
if (!midspin.timing.track.some((floor) => floor.midspin)) throw new Error('midspin geometry marker missing')

const special = extractAdofaiPressEvents({ angleData: [0], settings: { bpm: 120, pitch: 100 }, actions: [{ floor: 0, eventType: 'Hold', duration: 1 }, { floor: 0, eventType: 'MultiPlanet', planets: 'ThreePlanets' }] })
if (!special.timing.warnings.includes('HOLD_INPUT_SEMANTICS_APPROXIMATE')) throw new Error('Hold approximation warning missing')
if (!special.timing.warnings.includes('MULTIPLANET_PRESS_COUNT_NOT_MODELED')) throw new Error('MultiPlanet warning missing')

const direct = analyzeFingering(straight)
if (direct.input.eventCount !== 3) throw new Error('ADOFAI extractor output must feed fingering DP directly')

const viewer = await readFile(new URL('./visualize-fingering.mjs', import.meta.url), 'utf8')
for (const invariant of ['fingeringTrace', 'fingerProfile', '<canvas id="stage">', 'ELF ADOFAI Fingering Replay', 'class="keys"', 'leftKeys', 'rightKeys', 'leftKeys2', 'rightKeys2', 'extraKeys', 'buildKeyViewer', 'keys.compact', 'genericJrp', "'L'+(index+1)", "'R'+(index+1)", "'K'+(17+index)", 'id="kps"', 'id="total"', 'kpsAt', 'traceCountAt', 'key-count', 'segmentAt', 'orbitState', 'visualEvents', 'REPLAY_ASSET_FILES', 'tile_unlit.png', 'planet-red.png', 'swirl_red.png', 'speedAsset', 'drawPlanetSheet', 'pressWindowMs=85*rate']) {
  if (!viewer.includes(invariant)) throw new Error(`fingering visualizer missing: ${invariant}`)
}
const assetReadme = await readFile(new URL('./analyzer/replay-assets/README.md', import.meta.url), 'utf8')
for (const filename of ['tile_unlit.png', 'planet-red.png', 'planet-blue.png', 'swirl_red.png', 'swirl_blue.png', 'SetSpeed.png', 'SpeedDown.png', 'tile_samespeed.png']) {
  if (!assetReadme.includes(filename)) throw new Error(`replay asset documentation missing: ${filename}`)
}

const analyzerCli = await readFile(new URL('./analyze-fingering.mjs', import.meta.url), 'utf8')
for (const invariant of ['-result.json', '-replay.html', 'visualize-fingering.mjs', '--assets', '--output-dir', '--no-view']) {
  if (!analyzerCli.includes(invariant)) throw new Error(`one-command analyzer workflow missing: ${invariant}`)
}

console.log('DP FINGERING ANALYZER STATIC SMOKE PASSED')
console.log('.adofai -> JSON + replay HTML; local-peak-aware hand DP -> JRP-style high-K viewer with KPS')

import { analyzeFingering, estimateFingeringForKeyCount, FINGERING_MODEL_VERSION } from './analyzer/fingering-dp.mjs'

if (FINGERING_MODEL_VERSION !== 'fingering-dp-v0.8') throw new Error('lane/finger model version mismatch')

const laneFingerMap = [
  'LP', 'LR', 'LM', 'LI', 'LP', 'LP', 'LT', 'LT',
  'RI', 'RM', 'RR', 'RP', 'RT', 'RT', 'RP', 'RP',
]
const laneLabels = Array.from({ length: 16 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`)

const fixed16 = estimateFingeringForKeyCount(
  { hitTimesMs: Array.from({ length: 24 }, (_, i) => i * 60), laneFingerMap, laneLabels },
  16,
  { collectTrace: true, beamWidth: 96 },
)
if (!fixed16.feasible) throw new Error('fixed 16-lane layout should be feasible for a sequential stream')
if (fixed16.physicalFingerCount !== 10) throw new Error(`16 lanes must collapse to 10 physical fingers, got ${fixed16.physicalFingerCount}`)
if (fixed16.fingerProfile.length !== 16 || fixed16.physicalFingerProfile.length !== 10) throw new Error('lane and physical-finger profiles must stay separate')
if (fixed16.laneProfile[0].physicalFingerLabel !== 'LP' || fixed16.laneProfile[4].physicalFingerLabel !== 'LP') throw new Error('multiple lanes must be allowed to share one physical finger')
if (!fixed16.fingeringTrace?.every((x) => Number.isInteger(x.lane) && Number.isInteger(x.physicalFinger) && typeof x.physicalFingerLabel === 'string')) throw new Error('trace must expose both lane and physical finger')
if (!Number.isFinite(fixed16.laneSwitchRate) || !Number.isFinite(fixed16.maxLaneSwitchPenalty)) throw new Error('lane-switch metrics missing')

const impossible11 = estimateFingeringForKeyCount(
  { events: [{ timeMs: 0, presses: 11 }], laneFingerMap, laneLabels },
  16,
)
if (impossible11.feasible) throw new Error('16 lanes mapped to 10 fingers must not fake an 11-finger chord')
if (impossible11.reason !== 'SIMULTANEOUS_PRESS_COUNT_EXCEEDS_PHYSICAL_FINGERS') throw new Error('physical-finger chord rejection reason missing')

const mappedAnalysis = analyzeFingering({
  hitTimesMs: Array.from({ length: 20 }, (_, i) => i * 70),
  keyCounts: [16],
  traceKeyCount: 16,
  laneFingerMap,
  laneLabels,
}, { beamWidth: 96 })
if (mappedAnalysis.physicalFingerCount !== 10) throw new Error('top-level analysis must preserve physical finger count')
if (!mappedAnalysis.warnings.includes('CUSTOM_LANE_FINGER_MAP')) throw new Error('custom lane/finger mapping warning missing')
if (mappedAnalysis.config.customLaneFingerMapKeyCounts.join(',') !== '16') throw new Error('custom mapping key-count metadata missing')

console.log('DP LANE/FINGER MODEL SMOKE PASSED')

import { analyzeFingering, estimateFingeringForKeyCount, FINGERING_MODEL_VERSION } from './analyzer/fingering-dp.mjs'

if (FINGERING_MODEL_VERSION !== 'fingering-dp-v0.9') throw new Error('lane/finger model version mismatch')

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
if (fixed16.simultaneousCapacity !== 10) throw new Error('without explicit groups, each physical finger should contribute one simultaneous lane')
if (fixed16.fingerProfile.length !== 16 || fixed16.physicalFingerProfile.length !== 10) throw new Error('lane and physical-finger profiles must stay separate')
if (fixed16.laneProfile[0].physicalFingerLabel !== 'LP' || fixed16.laneProfile[4].physicalFingerLabel !== 'LP') throw new Error('multiple lanes must be allowed to share one physical finger')
if (!fixed16.fingeringTrace?.every((x) => Number.isInteger(x.lane) && Number.isInteger(x.physicalFinger) && typeof x.physicalFingerLabel === 'string')) throw new Error('trace must expose both lane and physical finger')
if (!Number.isFinite(fixed16.laneSwitchRate) || !Number.isFinite(fixed16.maxLaneSwitchPenalty)) throw new Error('lane-switch metrics missing')

const noGroups11 = estimateFingeringForKeyCount(
  { events: [{ timeMs: 0, presses: 11 }], laneFingerMap, laneLabels },
  16,
)
if (noGroups11.feasible) throw new Error('11-press chord should exceed a 10-finger layout when no same-finger chord is declared')
if (noGroups11.reason !== 'SIMULTANEOUS_PRESS_COUNT_EXCEEDS_LAYOUT_CAPACITY') throw new Error('layout-capacity rejection reason missing')

const simultaneousLaneGroups = [['K05', 'K06']]
const grouped11 = estimateFingeringForKeyCount(
  { events: [{ timeMs: 0, presses: 11 }], laneFingerMap, laneLabels, simultaneousLaneGroups },
  16,
  { collectTrace: true, beamWidth: 512 },
)
if (!grouped11.feasible) throw new Error(`declared same-finger chord should make 11 presses feasible: ${grouped11.reason}`)
if (grouped11.simultaneousCapacity !== 11) throw new Error(`one two-lane same-finger group should raise capacity to 11, got ${grouped11.simultaneousCapacity}`)
const lpUses = grouped11.fingeringTrace.filter((x) => x.physicalFingerLabel === 'LP')
if (lpUses.length !== 2 || new Set(lpUses.map((x) => x.laneLabel)).size !== 2) throw new Error('same LP must be allowed to cover two declared compatible lanes in one chord')
const lpIndex = grouped11.physicalFingerProfile.find((x) => x.label === 'LP')?.index
if (grouped11.minGapMsPerFinger[lpIndex] === 0) throw new Error('simultaneous same-finger chord must not become a zero-ms sequential reuse gap')

const grouped12 = estimateFingeringForKeyCount(
  { events: [{ timeMs: 0, presses: 12 }], laneFingerMap, laneLabels, simultaneousLaneGroups },
  16,
)
if (grouped12.feasible) throw new Error('12 presses must still exceed the declared capacity 11')
if (grouped12.reason !== 'SIMULTANEOUS_PRESS_COUNT_EXCEEDS_LAYOUT_CAPACITY') throw new Error('declared layout capacity must remain the hard chord limit')

const tripleGroup12 = estimateFingeringForKeyCount(
  { events: [{ timeMs: 0, presses: 12 }], laneFingerMap, laneLabels, simultaneousLaneGroups: [['K01', 'K05', 'K06']] },
  16,
  { collectTrace: true, beamWidth: 512 },
)
if (!tripleGroup12.feasible || tripleGroup12.simultaneousCapacity !== 12) throw new Error('three-lane same-finger group should support all of its declared subset/superset chord capacity')

let rejectedCrossFingerGroup = false
try {
  estimateFingeringForKeyCount(
    { hitTimesMs: [0], laneFingerMap, laneLabels, simultaneousLaneGroups: [['K01', 'K02']] },
    16,
  )
} catch {
  rejectedCrossFingerGroup = true
}
if (!rejectedCrossFingerGroup) throw new Error('simultaneous same-finger group must not mix different physical fingers')

const mappedAnalysis = analyzeFingering({
  hitTimesMs: Array.from({ length: 20 }, (_, i) => i * 70),
  keyCounts: [16],
  traceKeyCount: 16,
  laneFingerMap,
  laneLabels,
  simultaneousLaneGroups,
}, { beamWidth: 96 })
if (mappedAnalysis.physicalFingerCount !== 10) throw new Error('top-level analysis must preserve physical finger count')
if (mappedAnalysis.simultaneousCapacity !== 11) throw new Error('top-level analysis must expose declared simultaneous capacity')
if (!mappedAnalysis.warnings.includes('CUSTOM_LANE_FINGER_MAP')) throw new Error('custom lane/finger mapping warning missing')
if (!mappedAnalysis.warnings.includes('CUSTOM_SIMULTANEOUS_LANE_GROUPS')) throw new Error('custom simultaneous-lane warning missing')
if (mappedAnalysis.config.customLaneFingerMapKeyCounts.join(',') !== '16') throw new Error('custom mapping key-count metadata missing')
if (mappedAnalysis.config.customSimultaneousLaneGroupKeyCounts.join(',') !== '16') throw new Error('custom simultaneous-group key-count metadata missing')

console.log('DP LANE/FINGER MODEL SMOKE PASSED')

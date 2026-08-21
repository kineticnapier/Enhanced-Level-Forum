import { FINGERING_MODEL_VERSION, DEFAULT_KEY_COUNTS, DEFAULT_OPTIONS, finiteNumber, normalizeEvents } from './fingering-dp-profile.mjs'
import { inputForKeyCount } from './fingering-dp-state.mjs'
import { estimateFingeringForKeyCount } from './fingering-dp-estimate.mjs'

function qualifies(point, averageThreshold, peakThreshold) {
  return Boolean(point?.feasible && point.costPerPress <= averageThreshold && point.peakLocalCostPerPress <= peakThreshold)
}

function relativeImprovement(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 1e-9) return 0
  return Math.max(0, (from - to) / from)
}

function isSaturated(curve, index, options, requireLookahead) {
  const point = curve[index]
  const lookahead = Math.max(1, Math.trunc(options.saturationLookahead))
  const later = curve.slice(index + 1, index + 1 + lookahead).filter((x) => x.feasible)
  if (requireLookahead && later.length < lookahead) return false
  if (!later.length) return true
  for (const next of later) {
    const averageGain = relativeImprovement(point.costPerPress, next.costPerPress)
    const peakGain = relativeImprovement(point.peakLocalCostPerPress, next.peakLocalCostPerPress)
    if (averageGain >= options.saturationAverageImprovement || peakGain >= options.saturationPeakImprovement) return false
  }
  return true
}

function selectThresholdPoint(curve, options, kind, requireLookahead = false) {
  const averageThreshold = kind === 'comfortable' ? options.comfortableCostPerPress : options.practicalCostPerPress
  const peakThreshold = kind === 'comfortable' ? options.comfortablePeakCostPerPress : options.practicalPeakCostPerPress
  for (let i = 0; i < curve.length; i++) {
    if (!qualifies(curve[i], averageThreshold, peakThreshold)) continue
    if (isSaturated(curve, i, options, requireLookahead)) return curve[i]
  }
  return null
}

export function analyzeFingering(rawInput, rawOptions = {}) {
  const events = normalizeEvents(rawInput)
  const options = { ...DEFAULT_OPTIONS, ...rawOptions }
  const explicitKeyCounts = Array.isArray(rawInput?.keyCounts)
  const keyCounts = (rawInput?.keyCounts ?? DEFAULT_KEY_COUNTS)
    .map((value, index) => Math.trunc(finiteNumber(value, `keyCounts[${index}]`)))
    .filter((value, index, values) => value >= 1 && value <= 64 && values.indexOf(value) === index)
    .sort((a, b) => a - b)
  if (!keyCounts.length) throw new Error('At least one keyCount is required')

  const curve = []
  for (const keyCount of keyCounts) {
    const mapping = inputForKeyCount(rawInput, keyCount)
    const point = estimateFingeringForKeyCount({ events, ...mapping }, keyCount, { ...options, collectTrace: false })
    curve.push(point)
    if (!explicitKeyCounts && options.fullCurve !== true) {
      const stableComfortable = selectThresholdPoint(curve, options, 'comfortable', true)
      if (stableComfortable) break
    }
  }

  const practical = selectThresholdPoint(curve, options, 'practical', false)
  const comfortable = selectThresholdPoint(curve, options, 'comfortable', false)
  const traceKeyCount = Number.isFinite(Number(rawInput?.traceKeyCount))
    ? Math.trunc(Number(rawInput.traceKeyCount))
    : (comfortable?.keyCount ?? practical?.keyCount ?? curve.find((point) => point.feasible)?.keyCount ?? null)
  const traceMapping = traceKeyCount ? inputForKeyCount(rawInput, traceKeyCount) : {}
  const traced = traceKeyCount
    ? estimateFingeringForKeyCount({ events, ...traceMapping }, traceKeyCount, { ...options, collectTrace: true })
    : null
  const standard10 = curve.find((point) =>
    point.keyCount <= 10 && qualifies(point, options.practicalCostPerPress, options.practicalPeakCostPerPress)) ?? null

  const warnings = []
  if (!standard10 && curve.some((point) => point.keyCount >= 10)) warnings.push('STANDARD_FINGERING_MODEL_OUT_OF_RANGE')
  if (practical && practical.keyCount > 10) warnings.push('MULTI_KEYBOARD_LIKELY')
  if (!practical && curve[curve.length - 1]?.keyCount === keyCounts[keyCounts.length - 1]) warnings.push('EXTREME_KEY_COUNT')
  if (events.some((event) => event.presses > 10)) warnings.push('HIGH_SIMULTANEOUS_PRESS_COUNT')
  if (curve.some((point) => point.customLaneFingerMap) || traced?.customLaneFingerMap) warnings.push('CUSTOM_LANE_FINGER_MAP')
  if (curve.some((point) => point.customSimultaneousLaneGroups) || traced?.customSimultaneousLaneGroups) warnings.push('CUSTOM_SIMULTANEOUS_LANE_GROUPS')
  if ((traced?.footPresses ?? 0) > 0) warnings.push('FOOT_INPUT_USED')
  if (curve.some((point) => point.prunedStates > 0) || (traced?.prunedStates ?? 0) > 0) warnings.push('BEAM_PRUNED')

  return {
    analyzer: 'ELF Fingering Analyzer',
    modelVersion: FINGERING_MODEL_VERSION,
    deterministic: true,
    approximate: true,
    input: {
      levelVersionId: rawInput?.levelVersionId ?? null,
      sha256: rawInput?.sha256 ?? null,
      eventCount: events.length,
      totalPresses: events.reduce((sum, event) => sum + event.presses, 0),
      firstTimeMs: events.length ? events[0].timeMs : null,
      lastTimeMs: events.length ? events[events.length - 1].timeMs : null,
      maxSimultaneousPresses: events.reduce((max, event) => Math.max(max, event.presses), 0),
    },
    config: {
      requestedKeyCounts: keyCounts,
      analyzedKeyCounts: curve.map((point) => point.keyCount),
      adaptiveStop: !explicitKeyCounts && options.fullCurve !== true,
      customLaneFingerMapKeyCounts: curve.filter((point) => point.customLaneFingerMap).map((point) => point.keyCount),
      customSimultaneousLaneGroupKeyCounts: curve.filter((point) => point.customSimultaneousLaneGroups).map((point) => point.keyCount),
      beamWidth: options.beamWidth,
      reuseWindowMs: options.reuseWindowMs,
      reuseWeight: options.reuseWeight,
      sameFingerWeight: options.sameFingerWeight,
      sameHandWeight: options.sameHandWeight,
      handJumpWeight: options.handJumpWeight,
      crossHandMismatchWeight: options.crossHandMismatchWeight,
      crossHandChordWeight: options.crossHandChordWeight,
      footUseWeight: options.footUseWeight,
      fingerPreferenceWeight: options.fingerPreferenceWeight,
      reversalWeight: options.reversalWeight,
      longRunWeight: options.longRunWeight,
      laneSwitchWeight: options.laneSwitchWeight,
      laneJumpWeight: options.laneJumpWeight,
      localWindowPresses: options.localWindowPresses,
      practicalCostPerPress: options.practicalCostPerPress,
      practicalPeakCostPerPress: options.practicalPeakCostPerPress,
      comfortableCostPerPress: options.comfortableCostPerPress,
      comfortablePeakCostPerPress: options.comfortablePeakCostPerPress,
      saturationAverageImprovement: options.saturationAverageImprovement,
      saturationPeakImprovement: options.saturationPeakImprovement,
      saturationLookahead: options.saturationLookahead,
    },
    keyCountCurve: curve,
    estimatedMinKeys: practical?.keyCount ?? null,
    comfortableKeys: comfortable?.keyCount ?? null,
    traceKeyCount: traced?.keyCount ?? null,
    physicalFingerCount: traced?.physicalFingerCount ?? null,
    simultaneousCapacity: traced?.simultaneousCapacity ?? null,
    simultaneousLaneGroups: traced?.simultaneousLaneGroups ?? null,
    footLaneCount: traced?.footLaneCount ?? null,
    laneProfile: traced?.laneProfile ?? null,
    fingerProfile: traced?.fingerProfile ?? null,
    physicalFingerProfile: traced?.physicalFingerProfile ?? null,
    fingeringTrace: traced?.fingeringTrace ?? null,
    traceStats: traced ? {
      totalCost: traced.totalCost,
      costPerPress: traced.costPerPress,
      peakLocalCostPerPress: traced.peakLocalCostPerPress,
      maxTransitionCost: traced.maxTransitionCost,
      localWindowPresses: traced.localWindowPresses,
      laneCounts: traced.laneCounts,
      fingerCounts: traced.fingerCounts,
      minGapMsPerFinger: traced.minGapMsPerFinger,
      laneSwitchRate: traced.laneSwitchRate,
      handSwitchRate: traced.handSwitchRate,
      crossHandChordCount: traced.crossHandChordCount,
      footPresses: traced.footPresses,
      footUseRate: traced.footUseRate,
      maxLaneSwitchPenalty: traced.maxLaneSwitchPenalty,
      maxCrossHandChordPenalty: traced.maxCrossHandChordPenalty,
      maxFootPenalty: traced.maxFootPenalty,
      beamWidth: traced.beamWidth,
      prunedStates: traced.prunedStates,
    } : null,
    warnings,
    canonicalRatingMutation: false,
  }
}

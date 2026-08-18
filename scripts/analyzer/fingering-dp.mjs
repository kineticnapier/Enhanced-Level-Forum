export const FINGERING_MODEL_VERSION = 'fingering-dp-v0.3'

const DEFAULT_KEY_COUNTS = [2, 4, 6, 8, 10, 12, 16, 24]
const DEFAULT_OPTIONS = {
  beamWidth: 160,
  reuseWindowMs: 150,
  reuseWeight: 4,
  sameFingerWeight: 0.14,
  sameHandWeight: 0.035,
  handJumpWeight: 0.16,
  reversalWeight: 0.12,
  longRunWeight: 0.025,
  practicalCostPerPress: 0.75,
  comfortableCostPerPress: 0.25,
  fullCurve: false,
  collectTrace: false,
}

function finiteNumber(value, name) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`)
  return n
}

function normalizeEvents(input) {
  let events
  if (Array.isArray(input?.events)) {
    events = input.events.map((event, index) => ({
      timeMs: finiteNumber(event?.timeMs, `events[${index}].timeMs`),
      presses: Math.max(1, Math.trunc(finiteNumber(event?.presses ?? 1, `events[${index}].presses`))),
    }))
  } else if (Array.isArray(input?.hitTimesMs)) {
    const grouped = new Map()
    for (let i = 0; i < input.hitTimesMs.length; i++) {
      const timeMs = finiteNumber(input.hitTimesMs[i], `hitTimesMs[${i}]`)
      grouped.set(timeMs, (grouped.get(timeMs) ?? 0) + 1)
    }
    events = [...grouped.entries()].map(([timeMs, presses]) => ({ timeMs, presses }))
  } else {
    throw new Error('Provide events[] or hitTimesMs[]')
  }
  events.sort((a, b) => a.timeMs - b.timeMs)
  return events
}

function effectiveBeamWidth(requested, keyCount) {
  const base = Math.max(1, Math.min(2048, Math.trunc(finiteNumber(requested, 'beamWidth'))))
  if (keyCount <= 8) return base
  return Math.max(32, Math.min(base, Math.floor((base * 8) / keyCount)))
}

function handProfile(keyCount) {
  const named = {
    1: ['RI'],
    2: ['LI', 'RI'],
    3: ['LM', 'LI', 'RI'],
    4: ['LM', 'LI', 'RI', 'RM'],
    5: ['LR', 'LM', 'LI', 'RI', 'RM'],
    6: ['LR', 'LM', 'LI', 'RI', 'RM', 'RR'],
    7: ['LP', 'LR', 'LM', 'LI', 'RI', 'RM', 'RR'],
    8: ['LP', 'LR', 'LM', 'LI', 'RI', 'RM', 'RR', 'RP'],
    9: ['LP', 'LR', 'LM', 'LI', 'LT', 'RI', 'RM', 'RR', 'RP'],
    10: ['LP', 'LR', 'LM', 'LI', 'LT', 'RT', 'RI', 'RM', 'RR', 'RP'],
  }
  const labels = named[keyCount] ?? Array.from({ length: keyCount }, (_, i) => {
    const leftCount = Math.ceil(keyCount / 2)
    return i < leftCount ? `L${leftCount - i}` : `R${i - leftCount + 1}`
  })
  const leftCount = labels.filter((label) => label.startsWith('L')).length
  return labels.map((label, index) => {
    const hand = label.startsWith('L') ? 'L' : 'R'
    const order = hand === 'L' ? index : index - leftCount
    return { index, label, hand, order }
  })
}

function stateKey(state) {
  return `${state.prevFinger}|${state.lastFinger}|${state.sameHandRun}|${state.lastUse.join(',')}`
}

function keepBest(states, beamWidth) {
  const best = new Map()
  for (const state of states) {
    const key = stateKey(state)
    const current = best.get(key)
    if (!current || state.cost < current.cost) best.set(key, state)
  }
  const sorted = [...best.values()].sort((a, b) => a.cost - b.cost)
  return { states: sorted.slice(0, beamWidth), pruned: Math.max(0, sorted.length - beamWidth) }
}

function transitionCost(state, finger, timeMs, profile, options) {
  const previousUse = state.lastUse[finger]
  let reusePenalty = 0
  let gap = null
  if (previousUse >= 0) {
    gap = Math.max(0, timeMs - previousUse)
    if (gap <= 0) reusePenalty = options.reuseWeight * 1_000
    else {
      const ratio = Math.max(0, options.reuseWindowMs / gap - 1)
      reusePenalty = ratio * ratio * options.reuseWeight
    }
  }

  const current = profile[finger]
  const last = state.lastFinger >= 0 ? profile[state.lastFinger] : null
  const prev = state.prevFinger >= 0 ? profile[state.prevFinger] : null
  const lastGap = state.lastEventTime >= 0 ? Math.max(0, timeMs - state.lastEventTime) : Infinity
  const fast = Math.max(0, 1 - lastGap / 180)

  let ergonomicPenalty = 0
  if (last) {
    if (last.index === current.index) ergonomicPenalty += options.sameFingerWeight
    if (last.hand === current.hand) {
      const distance = Math.abs(current.order - last.order)
      ergonomicPenalty += options.sameHandWeight * fast
      if (distance > 1) ergonomicPenalty += (distance - 1) * options.handJumpWeight * fast

      if (prev && prev.hand === current.hand && prev.hand === last.hand) {
        const a = Math.sign(last.order - prev.order)
        const b = Math.sign(current.order - last.order)
        if (a !== 0 && b !== 0 && a !== b) ergonomicPenalty += options.reversalWeight * fast
      }
      if (state.sameHandRun >= 4) ergonomicPenalty += (state.sameHandRun - 3) * options.longRunWeight * fast
    }
  }

  return { total: reusePenalty + ergonomicPenalty, reusePenalty, ergonomicPenalty, gap }
}

function initialState(keyCount) {
  return {
    cost: 0,
    prevFinger: -1,
    lastFinger: -1,
    lastEventTime: -1,
    sameHandRun: 0,
    lastUse: Array(keyCount).fill(-1),
    counts: Array(keyCount).fill(0),
    minGap: Array(keyCount).fill(null),
    sameFingerTransitions: 0,
    switches: 0,
    handSwitches: 0,
    maxReusePenalty: 0,
    trace: null,
  }
}

function recoverTrace(node, profile) {
  const out = []
  while (node) {
    const finger = profile[node.finger]
    out.push({ timeMs: node.timeMs, finger: node.finger, fingerLabel: finger.label, hand: finger.hand, eventIndex: node.eventIndex, pressIndex: node.pressIndex })
    node = node.parent
  }
  out.reverse()
  return out
}

export function estimateFingeringForKeyCount(rawInput, keyCount, rawOptions = {}) {
  const events = normalizeEvents(rawInput)
  keyCount = Math.trunc(finiteNumber(keyCount, 'keyCount'))
  if (keyCount < 1 || keyCount > 64) throw new Error('keyCount must be between 1 and 64')
  const options = { ...DEFAULT_OPTIONS, ...rawOptions }
  const beamWidth = effectiveBeamWidth(options.beamWidth, keyCount)
  const collectTrace = options.collectTrace === true
  const profile = handProfile(keyCount)

  const totalPresses = events.reduce((sum, event) => sum + event.presses, 0)
  const maxSimultaneousPresses = events.reduce((max, event) => Math.max(max, event.presses), 0)
  if (maxSimultaneousPresses > keyCount) {
    return { keyCount, feasible: false, reason: 'SIMULTANEOUS_PRESS_COUNT_EXCEEDS_KEYS', totalCost: null, costPerPress: null, totalPresses, maxSimultaneousPresses, sameFingerRate: null, switchRate: null, handSwitchRate: null, maxReusePenalty: null, fingerCounts: null, minGapMsPerFinger: null, prunedStates: 0, beamWidth, fingeringTrace: null, fingerProfile: profile }
  }

  let beam = [initialState(keyCount)]
  let prunedStates = 0

  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]
    let chordBeam = beam.map((state) => ({ state, used: [] }))
    for (let pressIndex = 0; pressIndex < event.presses; pressIndex++) {
      const candidates = []
      for (const wrapper of chordBeam) {
        for (let finger = 0; finger < keyCount; finger++) {
          if (wrapper.used.includes(finger)) continue
          const tc = transitionCost(wrapper.state, finger, event.timeMs, profile, options)
          const lastProfile = wrapper.state.lastFinger >= 0 ? profile[wrapper.state.lastFinger] : null
          const currentProfile = profile[finger]
          const handChanged = lastProfile && lastProfile.hand !== currentProfile.hand
          const next = {
            cost: wrapper.state.cost + tc.total,
            prevFinger: wrapper.state.lastFinger,
            lastFinger: finger,
            lastEventTime: event.timeMs,
            sameHandRun: lastProfile ? (handChanged ? 1 : wrapper.state.sameHandRun + 1) : 1,
            lastUse: wrapper.state.lastUse.slice(),
            counts: wrapper.state.counts.slice(),
            minGap: wrapper.state.minGap.slice(),
            sameFingerTransitions: wrapper.state.sameFingerTransitions + (wrapper.state.lastFinger === finger ? 1 : 0),
            switches: wrapper.state.switches + (wrapper.state.lastFinger >= 0 && wrapper.state.lastFinger !== finger ? 1 : 0),
            handSwitches: wrapper.state.handSwitches + (handChanged ? 1 : 0),
            maxReusePenalty: Math.max(wrapper.state.maxReusePenalty, tc.reusePenalty),
            trace: collectTrace ? { timeMs: event.timeMs, finger, eventIndex, pressIndex, parent: wrapper.state.trace } : null,
          }
          next.lastUse[finger] = event.timeMs
          next.counts[finger]++
          if (tc.gap !== null) next.minGap[finger] = next.minGap[finger] === null ? tc.gap : Math.min(next.minGap[finger], tc.gap)
          candidates.push({ state: next, used: [...wrapper.used, finger] })
        }
      }
      candidates.sort((a, b) => a.state.cost - b.state.cost)
      if (candidates.length > beamWidth) prunedStates += candidates.length - beamWidth
      chordBeam = candidates.slice(0, beamWidth)
      if (!chordBeam.length) break
    }
    const compact = keepBest(chordBeam.map((wrapper) => wrapper.state), beamWidth)
    prunedStates += compact.pruned
    beam = compact.states
    if (!beam.length) break
  }

  if (!beam.length) {
    return { keyCount, feasible: false, reason: 'NO_FINGERING_PATH', totalCost: null, costPerPress: null, totalPresses, maxSimultaneousPresses, sameFingerRate: null, switchRate: null, handSwitchRate: null, maxReusePenalty: null, fingerCounts: null, minGapMsPerFinger: null, prunedStates, beamWidth, fingeringTrace: null, fingerProfile: profile }
  }

  const best = beam[0]
  const transitions = Math.max(1, totalPresses - 1)
  return {
    keyCount,
    feasible: true,
    totalCost: best.cost,
    costPerPress: totalPresses ? best.cost / totalPresses : 0,
    totalPresses,
    maxSimultaneousPresses,
    sameFingerRate: best.sameFingerTransitions / transitions,
    switchRate: best.switches / transitions,
    handSwitchRate: best.handSwitches / transitions,
    maxReusePenalty: best.maxReusePenalty,
    fingerCounts: best.counts,
    minGapMsPerFinger: best.minGap,
    prunedStates,
    beamWidth,
    fingerProfile: profile,
    fingeringTrace: collectTrace ? recoverTrace(best.trace, profile) : null,
  }
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
    const point = estimateFingeringForKeyCount({ events }, keyCount, { ...options, collectTrace: false })
    curve.push(point)
    if (!explicitKeyCounts && options.fullCurve !== true && point.feasible && point.costPerPress <= options.comfortableCostPerPress) break
  }

  const practical = curve.find((point) => point.feasible && point.costPerPress <= options.practicalCostPerPress) ?? null
  const comfortable = curve.find((point) => point.feasible && point.costPerPress <= options.comfortableCostPerPress) ?? null
  const traceKeyCount = Number.isFinite(Number(rawInput?.traceKeyCount)) ? Math.trunc(Number(rawInput.traceKeyCount)) : (comfortable?.keyCount ?? practical?.keyCount ?? curve.find((point) => point.feasible)?.keyCount ?? null)
  const traced = traceKeyCount ? estimateFingeringForKeyCount({ events }, traceKeyCount, { ...options, collectTrace: true }) : null
  const standard10 = curve.find((point) => point.keyCount <= 10 && point.feasible && point.costPerPress <= options.practicalCostPerPress) ?? null
  const warnings = []
  if (!standard10 && curve.some((point) => point.keyCount >= 10)) warnings.push('STANDARD_FINGERING_MODEL_OUT_OF_RANGE')
  if (practical && practical.keyCount > 10) warnings.push('MULTI_KEYBOARD_LIKELY')
  if (!practical && curve[curve.length - 1]?.keyCount === keyCounts[keyCounts.length - 1]) warnings.push('EXTREME_KEY_COUNT')
  if (events.some((event) => event.presses > 10)) warnings.push('HIGH_SIMULTANEOUS_PRESS_COUNT')
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
      beamWidth: options.beamWidth,
      reuseWindowMs: options.reuseWindowMs,
      reuseWeight: options.reuseWeight,
      sameFingerWeight: options.sameFingerWeight,
      sameHandWeight: options.sameHandWeight,
      handJumpWeight: options.handJumpWeight,
      reversalWeight: options.reversalWeight,
      longRunWeight: options.longRunWeight,
      practicalCostPerPress: options.practicalCostPerPress,
      comfortableCostPerPress: options.comfortableCostPerPress,
    },
    keyCountCurve: curve,
    estimatedMinKeys: practical?.keyCount ?? null,
    comfortableKeys: comfortable?.keyCount ?? null,
    traceKeyCount: traced?.keyCount ?? null,
    fingerProfile: traced?.fingerProfile ?? null,
    fingeringTrace: traced?.fingeringTrace ?? null,
    traceStats: traced ? { totalCost: traced.totalCost, costPerPress: traced.costPerPress, fingerCounts: traced.fingerCounts, minGapMsPerFinger: traced.minGapMsPerFinger, handSwitchRate: traced.handSwitchRate, beamWidth: traced.beamWidth, prunedStates: traced.prunedStates } : null,
    warnings,
    canonicalRatingMutation: false,
  }
}

export const FINGERING_MODEL_VERSION = 'fingering-dp-v0.9'

const DEFAULT_KEY_COUNTS = [2, 3, 4, 6, 8, 10, 12, 16, 24, 32, 36]
const DEFAULT_OPTIONS = {
  beamWidth: 160,
  reuseWindowMs: 170,
  reuseWeight: 4,
  sameFingerWeight: 0.14,
  sameHandWeight: 0.015,
  handJumpWeight: 0.16,
  crossHandMismatchWeight: 0.18,
  fingerPreferenceWeight: 0.08,
  reversalWeight: 0.12,
  longRunWeight: 0.025,
  laneSwitchWeight: 0.03,
  laneJumpWeight: 0.015,
  localWindowPresses: 12,
  practicalCostPerPress: 0.75,
  practicalPeakCostPerPress: 1.15,
  comfortableCostPerPress: 0.22,
  comfortablePeakCostPerPress: 0.48,
  saturationAverageImprovement: 0.34,
  saturationPeakImprovement: 0.28,
  saturationLookahead: 2,
  fullCurve: false,
  collectTrace: false,
}

const NAMED_KEY_PROFILES = {
  1: ['RI'],
  2: ['LI', 'RI'],
  3: ['LI', 'RI', 'RM'],
  4: ['LM', 'LI', 'RI', 'RM'],
  5: ['LR', 'LM', 'LI', 'RI', 'RM'],
  6: ['LR', 'LM', 'LI', 'RI', 'RM', 'RR'],
  7: ['LP', 'LR', 'LM', 'LI', 'RI', 'RM', 'RR'],
  8: ['LP', 'LR', 'LM', 'LI', 'RI', 'RM', 'RR', 'RP'],
  9: ['LP', 'LR', 'LM', 'LI', 'LT', 'RI', 'RM', 'RR', 'RP'],
  10: ['LP', 'LR', 'LM', 'LI', 'LT', 'RT', 'RI', 'RM', 'RR', 'RP'],
}

const NAMED_FINGER_META = {
  LP: { hand: 'L', order: 0, digitRank: 3, preference: 0.9 },
  LR: { hand: 'L', order: 1, digitRank: 2, preference: 0.52 },
  LM: { hand: 'L', order: 2, digitRank: 1, preference: 0.22 },
  LI: { hand: 'L', order: 3, digitRank: 0, preference: 0 },
  LT: { hand: 'L', order: 4, digitRank: 0.6, preference: 0.62 },
  RT: { hand: 'R', order: 0, digitRank: 0.6, preference: 0.62 },
  RI: { hand: 'R', order: 1, digitRank: 0, preference: 0 },
  RM: { hand: 'R', order: 2, digitRank: 1, preference: 0.22 },
  RR: { hand: 'R', order: 3, digitRank: 2, preference: 0.52 },
  RP: { hand: 'R', order: 4, digitRank: 3, preference: 0.9 },
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

function digitInfo(label, fallbackOrder) {
  const named = NAMED_FINGER_META[label]
  if (named) return { digitRank: named.digitRank, preference: named.preference }
  const digit = label.slice(-1)
  if (digit === 'I') return { digitRank: 0, preference: 0 }
  if (digit === 'M') return { digitRank: 1, preference: 0.22 }
  if (digit === 'R') return { digitRank: 2, preference: 0.52 }
  if (digit === 'P') return { digitRank: 3, preference: 0.9 }
  if (digit === 'T') return { digitRank: 0.6, preference: 0.62 }
  return { digitRank: fallbackOrder, preference: Math.min(1, fallbackOrder * 0.18) }
}

function inferHand(label, fallbackIndex, keyCount) {
  if (label.startsWith('L')) return 'L'
  if (label.startsWith('R')) return 'R'
  return fallbackIndex < keyCount / 2 ? 'L' : 'R'
}

function defaultLaneLabels(keyCount) {
  const named = NAMED_KEY_PROFILES[keyCount]
  if (named) return named.slice()
  const leftCount = Math.ceil(keyCount / 2)
  return Array.from({ length: keyCount }, (_, i) => i < leftCount ? `L${leftCount - i}` : `R${i - leftCount + 1}`)
}

function normalizeLaneFingerMap(rawInput, keyCount) {
  const map = rawInput?.laneFingerMap
  if (!Array.isArray(map)) return null
  if (map.length !== keyCount) throw new Error(`laneFingerMap must contain exactly ${keyCount} entries`)
  const labels = Array.isArray(rawInput?.laneLabels) ? rawInput.laneLabels : null
  if (labels && labels.length !== keyCount) throw new Error(`laneLabels must contain exactly ${keyCount} entries`)

  return map.map((entry, index) => {
    const object = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null
    const fingerLabel = String(object?.fingerLabel ?? object?.finger ?? object?.physicalFinger ?? entry ?? '').trim()
    if (!fingerLabel) throw new Error(`laneFingerMap[${index}] must name a physical finger/resource`)
    const laneLabel = String(object?.laneLabel ?? object?.lane ?? labels?.[index] ?? `K${String(index + 1).padStart(2, '0')}`).trim()
    if (!laneLabel) throw new Error(`laneFingerMap[${index}] lane label must not be empty`)
    return {
      laneLabel,
      fingerLabel,
      hand: object?.hand === 'L' || object?.hand === 'R' ? object.hand : null,
      fingerOrder: Number.isFinite(Number(object?.fingerOrder)) ? Number(object.fingerOrder) : null,
      digitRank: Number.isFinite(Number(object?.digitRank)) ? Number(object.digitRank) : null,
      preference: Number.isFinite(Number(object?.preference)) ? Number(object.preference) : null,
    }
  })
}

function buildProfiles(rawInput, keyCount) {
  const customMap = normalizeLaneFingerMap(rawInput, keyCount)
  const defaultLabels = defaultLaneLabels(keyCount)
  const entries = customMap ?? defaultLabels.map((label) => ({
    laneLabel: label, fingerLabel: label, hand: null, fingerOrder: null, digitRank: null, preference: null,
  }))

  const fingerProfile = []
  const fingerIndexByLabel = new Map()
  const fallbackOrderByHand = { L: 0, R: 0 }
  const laneOrderByHand = { L: 0, R: 0 }
  const laneProfile = []

  for (let laneIndex = 0; laneIndex < entries.length; laneIndex++) {
    const entry = entries[laneIndex]
    let fingerIndex = fingerIndexByLabel.get(entry.fingerLabel)
    if (fingerIndex === undefined) {
      const named = NAMED_FINGER_META[entry.fingerLabel]
      const hand = entry.hand ?? named?.hand ?? inferHand(entry.fingerLabel, laneIndex, keyCount)
      const fallbackOrder = fallbackOrderByHand[hand]++
      const info = digitInfo(entry.fingerLabel, fallbackOrder)
      fingerIndex = fingerProfile.length
      fingerIndexByLabel.set(entry.fingerLabel, fingerIndex)
      fingerProfile.push({
        index: fingerIndex,
        label: entry.fingerLabel,
        hand,
        order: entry.fingerOrder ?? named?.order ?? fallbackOrder,
        digitRank: entry.digitRank ?? info.digitRank,
        preference: entry.preference ?? info.preference,
      })
    }

    const finger = fingerProfile[fingerIndex]
    laneProfile.push({
      index: laneIndex,
      label: entry.laneLabel,
      hand: finger.hand,
      order: laneOrderByHand[finger.hand]++,
      physicalFinger: fingerIndex,
      physicalFingerLabel: finger.label,
    })
  }

  return { laneProfile, fingerProfile, customLaneFingerMap: customMap !== null }
}

function laneIndexFromReference(ref, laneProfile, groupIndex) {
  if (Number.isInteger(ref)) {
    if (ref < 0 || ref >= laneProfile.length) throw new Error(`simultaneousLaneGroups[${groupIndex}] lane index ${ref} is out of range`)
    return ref
  }
  const label = String(ref ?? '').trim()
  const matches = laneProfile.filter((lane) => lane.label === label)
  if (matches.length !== 1) throw new Error(`simultaneousLaneGroups[${groupIndex}] must reference a unique lane label or zero-based index: ${label}`)
  return matches[0].index
}

function normalizeSimultaneousLaneGroups(rawInput, laneProfile, fingerProfile) {
  const source = rawInput?.simultaneousLaneGroups ?? rawInput?.simultaneousGroups
  if (!Array.isArray(source)) return { groups: [], groupsByFinger: new Map(), custom: false }

  const groups = []
  const groupsByFinger = new Map()
  const seen = new Set()
  for (let groupIndex = 0; groupIndex < source.length; groupIndex++) {
    const entry = source[groupIndex]
    const laneRefs = Array.isArray(entry) ? entry : entry?.lanes
    if (!Array.isArray(laneRefs) || laneRefs.length < 2) {
      throw new Error(`simultaneousLaneGroups[${groupIndex}] must contain at least two lanes`)
    }
    const lanes = [...new Set(laneRefs.map((ref) => laneIndexFromReference(ref, laneProfile, groupIndex)))].sort((a, b) => a - b)
    if (lanes.length < 2) throw new Error(`simultaneousLaneGroups[${groupIndex}] must contain at least two distinct lanes`)
    const fingers = new Set(lanes.map((laneIndex) => laneProfile[laneIndex].physicalFinger))
    if (fingers.size !== 1) {
      throw new Error(`simultaneousLaneGroups[${groupIndex}] lanes must share one physical finger/resource`)
    }
    const finger = [...fingers][0]
    const key = `${finger}:${lanes.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    const group = {
      lanes,
      laneLabels: lanes.map((laneIndex) => laneProfile[laneIndex].label),
      physicalFinger: finger,
      physicalFingerLabel: fingerProfile[finger].label,
    }
    groups.push(group)
    const list = groupsByFinger.get(finger) ?? []
    list.push(new Set(lanes))
    groupsByFinger.set(finger, list)
  }
  return { groups, groupsByFinger, custom: true }
}

function simultaneousCapacity(fingerProfile, groupsByFinger) {
  let capacity = 0
  for (const finger of fingerProfile) {
    const groups = groupsByFinger.get(finger.index) ?? []
    let fingerCapacity = 1
    for (const group of groups) fingerCapacity = Math.max(fingerCapacity, group.size)
    capacity += fingerCapacity
  }
  return capacity
}

function canAddLaneToChord(usedLanes, laneIndex, laneProfile, groupsByFinger) {
  if (usedLanes.includes(laneIndex)) return false
  const finger = laneProfile[laneIndex].physicalFinger
  const sameFingerLanes = usedLanes.filter((usedLane) => laneProfile[usedLane].physicalFinger === finger)
  if (!sameFingerLanes.length) return true
  const required = [...sameFingerLanes, laneIndex]
  return (groupsByFinger.get(finger) ?? []).some((group) => required.every((lane) => group.has(lane)))
}

function stateKey(state) {
  return `${state.prevFinger}|${state.lastFinger}|${state.lastLane}|${state.sameHandRun}|${state.lastUse.join(',')}|${state.lastLaneByFinger.join(',')}`
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

function transitionCost(state, laneIndex, timeMs, laneProfile, fingerProfile, options) {
  const lane = laneProfile[laneIndex]
  const finger = lane.physicalFinger
  const previousUse = state.lastUse[finger]
  let reusePenalty = 0
  let gap = null
  let simultaneousSameFinger = false
  if (previousUse >= 0) {
    gap = Math.max(0, timeMs - previousUse)
    simultaneousSameFinger = gap === 0 && state.lastEventTime === timeMs
    if (!simultaneousSameFinger) {
      if (gap <= 0) reusePenalty = options.reuseWeight * 1_000
      else {
        const ratio = Math.max(0, options.reuseWindowMs / gap - 1)
        reusePenalty = ratio * ratio * options.reuseWeight
      }
    }
  }

  const current = fingerProfile[finger]
  const last = state.lastFinger >= 0 ? fingerProfile[state.lastFinger] : null
  const prev = state.prevFinger >= 0 ? fingerProfile[state.prevFinger] : null
  const lastGap = state.lastEventTime >= 0 ? Math.max(0, timeMs - state.lastEventTime) : Infinity
  const fast = Math.max(0, 1 - lastGap / 190)

  let ergonomicPenalty = current.preference * options.fingerPreferenceWeight
  if (last && !simultaneousSameFinger) {
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
    } else {
      ergonomicPenalty += Math.abs(current.digitRank - last.digitRank) * options.crossHandMismatchWeight * fast
    }
  }

  let laneSwitchPenalty = 0
  const previousLane = state.lastLaneByFinger[finger]
  if (!simultaneousSameFinger && previousLane >= 0 && previousLane !== laneIndex && gap !== null) {
    const laneFast = Math.max(0, 1 - gap / 260)
    const previousLaneInfo = laneProfile[previousLane]
    const laneDistance = previousLaneInfo?.hand === lane.hand ? Math.abs(lane.order - previousLaneInfo.order) : 1
    laneSwitchPenalty = (options.laneSwitchWeight + Math.max(0, laneDistance - 1) * options.laneJumpWeight) * laneFast
  }

  return {
    total: reusePenalty + ergonomicPenalty + laneSwitchPenalty,
    reusePenalty,
    ergonomicPenalty,
    laneSwitchPenalty,
    gap,
    physicalFinger: finger,
    simultaneousSameFinger,
  }
}

function initialState(laneCount, fingerCount) {
  return {
    cost: 0,
    prevFinger: -1,
    lastFinger: -1,
    lastLane: -1,
    lastEventTime: -1,
    sameHandRun: 0,
    lastUse: Array(fingerCount).fill(-1),
    lastLaneByFinger: Array(fingerCount).fill(-1),
    laneCounts: Array(laneCount).fill(0),
    fingerCounts: Array(fingerCount).fill(0),
    minGap: Array(fingerCount).fill(null),
    sameFingerTransitions: 0,
    fingerSwitches: 0,
    laneSwitches: 0,
    handSwitches: 0,
    maxReusePenalty: 0,
    maxLaneSwitchPenalty: 0,
    maxTransitionCost: 0,
    recentCosts: [],
    recentCostSum: 0,
    peakLocalCostPerPress: 0,
    trace: null,
  }
}

function pushLocalCost(state, transitionCostValue, windowSize) {
  const recentCosts = [...state.recentCosts, transitionCostValue]
  let recentCostSum = state.recentCostSum + transitionCostValue
  while (recentCosts.length > windowSize) recentCostSum -= recentCosts.shift()
  return {
    recentCosts,
    recentCostSum,
    peakLocalCostPerPress: Math.max(state.peakLocalCostPerPress, recentCostSum / Math.max(1, recentCosts.length)),
  }
}

function recoverTrace(node, laneProfile, fingerProfile) {
  const out = []
  while (node) {
    const lane = laneProfile[node.lane]
    const finger = fingerProfile[node.finger]
    out.push({
      timeMs: node.timeMs,
      lane: node.lane,
      laneLabel: lane.label,
      finger: node.lane,
      fingerLabel: finger.label,
      physicalFinger: node.finger,
      physicalFingerLabel: finger.label,
      hand: finger.hand,
      eventIndex: node.eventIndex,
      pressIndex: node.pressIndex,
    })
    node = node.parent
  }
  out.reverse()
  return out
}

function inputForKeyCount(rawInput, keyCount) {
  let laneFingerMap = null
  let laneLabels = null
  let simultaneousLaneGroups = null

  if (Array.isArray(rawInput?.laneFingerMap) && rawInput.laneFingerMap.length === keyCount) {
    laneFingerMap = rawInput.laneFingerMap
    laneLabels = Array.isArray(rawInput?.laneLabels) && rawInput.laneLabels.length === keyCount ? rawInput.laneLabels : null
    simultaneousLaneGroups = rawInput?.simultaneousLaneGroups ?? rawInput?.simultaneousGroups ?? null
  }

  const keyedMap = rawInput?.laneFingerMaps?.[keyCount] ?? rawInput?.laneFingerMaps?.[String(keyCount)]
  if (Array.isArray(keyedMap)) laneFingerMap = keyedMap
  const keyedLabels = rawInput?.laneLabelsByKeyCount?.[keyCount] ?? rawInput?.laneLabelsByKeyCount?.[String(keyCount)]
  if (Array.isArray(keyedLabels)) laneLabels = keyedLabels
  const keyedGroups =
    rawInput?.simultaneousLaneGroupsByKeyCount?.[keyCount] ??
    rawInput?.simultaneousLaneGroupsByKeyCount?.[String(keyCount)] ??
    rawInput?.simultaneousGroupsByKeyCount?.[keyCount] ??
    rawInput?.simultaneousGroupsByKeyCount?.[String(keyCount)]
  if (Array.isArray(keyedGroups)) simultaneousLaneGroups = keyedGroups

  return { laneFingerMap, laneLabels, simultaneousLaneGroups }
}

export function estimateFingeringForKeyCount(rawInput, keyCount, rawOptions = {}) {
  const events = normalizeEvents(rawInput)
  keyCount = Math.trunc(finiteNumber(keyCount, 'keyCount'))
  if (keyCount < 1 || keyCount > 64) throw new Error('keyCount must be between 1 and 64')
  const options = { ...DEFAULT_OPTIONS, ...rawOptions }
  const beamWidth = effectiveBeamWidth(options.beamWidth, keyCount)
  const collectTrace = options.collectTrace === true
  const { laneProfile, fingerProfile, customLaneFingerMap } = buildProfiles(rawInput, keyCount)
  const simultaneous = normalizeSimultaneousLaneGroups(rawInput, laneProfile, fingerProfile)
  const physicalFingerCount = fingerProfile.length
  const layoutCapacity = simultaneousCapacity(fingerProfile, simultaneous.groupsByFinger)
  const localWindowPresses = Math.max(2, Math.trunc(finiteNumber(options.localWindowPresses, 'localWindowPresses')))

  const totalPresses = events.reduce((sum, event) => sum + event.presses, 0)
  const maxSimultaneousPresses = events.reduce((max, event) => Math.max(max, event.presses), 0)
  if (maxSimultaneousPresses > layoutCapacity) {
    return {
      keyCount,
      physicalFingerCount,
      simultaneousCapacity: layoutCapacity,
      customLaneFingerMap,
      customSimultaneousLaneGroups: simultaneous.custom,
      simultaneousLaneGroups: simultaneous.groups,
      feasible: false,
      reason: 'SIMULTANEOUS_PRESS_COUNT_EXCEEDS_LAYOUT_CAPACITY',
      totalCost: null,
      costPerPress: null,
      peakLocalCostPerPress: null,
      maxTransitionCost: null,
      totalPresses,
      maxSimultaneousPresses,
      sameFingerRate: null,
      switchRate: null,
      laneSwitchRate: null,
      handSwitchRate: null,
      maxReusePenalty: null,
      maxLaneSwitchPenalty: null,
      laneCounts: null,
      fingerCounts: null,
      minGapMsPerFinger: null,
      prunedStates: 0,
      beamWidth,
      fingeringTrace: null,
      laneProfile,
      fingerProfile: laneProfile,
      physicalFingerProfile: fingerProfile,
    }
  }

  let beam = [initialState(keyCount, physicalFingerCount)]
  let prunedStates = 0

  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]
    let chordBeam = beam.map((state) => ({ state, usedLanes: [] }))

    for (let pressIndex = 0; pressIndex < event.presses; pressIndex++) {
      const candidates = []
      for (const wrapper of chordBeam) {
        for (let laneIndex = 0; laneIndex < keyCount; laneIndex++) {
          if (!canAddLaneToChord(wrapper.usedLanes, laneIndex, laneProfile, simultaneous.groupsByFinger)) continue
          const physicalFinger = laneProfile[laneIndex].physicalFinger
          const tc = transitionCost(wrapper.state, laneIndex, event.timeMs, laneProfile, fingerProfile, options)
          const lastProfile = wrapper.state.lastFinger >= 0 ? fingerProfile[wrapper.state.lastFinger] : null
          const currentProfile = fingerProfile[physicalFinger]
          const handChanged = Boolean(lastProfile && lastProfile.hand !== currentProfile.hand)
          const local = pushLocalCost(wrapper.state, tc.total, localWindowPresses)
          const next = {
            cost: wrapper.state.cost + tc.total,
            prevFinger: tc.simultaneousSameFinger ? wrapper.state.prevFinger : wrapper.state.lastFinger,
            lastFinger: physicalFinger,
            lastLane: laneIndex,
            lastEventTime: event.timeMs,
            sameHandRun: tc.simultaneousSameFinger
              ? wrapper.state.sameHandRun
              : (lastProfile ? (handChanged ? 1 : wrapper.state.sameHandRun + 1) : 1),
            lastUse: wrapper.state.lastUse.slice(),
            lastLaneByFinger: wrapper.state.lastLaneByFinger.slice(),
            laneCounts: wrapper.state.laneCounts.slice(),
            fingerCounts: wrapper.state.fingerCounts.slice(),
            minGap: wrapper.state.minGap.slice(),
            sameFingerTransitions: wrapper.state.sameFingerTransitions +
              (!tc.simultaneousSameFinger && wrapper.state.lastFinger === physicalFinger ? 1 : 0),
            fingerSwitches: wrapper.state.fingerSwitches +
              (wrapper.state.lastFinger >= 0 && wrapper.state.lastFinger !== physicalFinger ? 1 : 0),
            laneSwitches: wrapper.state.laneSwitches +
              (wrapper.state.lastLane >= 0 && wrapper.state.lastLane !== laneIndex ? 1 : 0),
            handSwitches: wrapper.state.handSwitches + (handChanged ? 1 : 0),
            maxReusePenalty: Math.max(wrapper.state.maxReusePenalty, tc.reusePenalty),
            maxLaneSwitchPenalty: Math.max(wrapper.state.maxLaneSwitchPenalty, tc.laneSwitchPenalty),
            maxTransitionCost: Math.max(wrapper.state.maxTransitionCost, tc.total),
            ...local,
            trace: collectTrace ? {
              timeMs: event.timeMs, lane: laneIndex, finger: physicalFinger, eventIndex, pressIndex, parent: wrapper.state.trace,
            } : null,
          }
          next.lastUse[physicalFinger] = event.timeMs
          next.lastLaneByFinger[physicalFinger] = laneIndex
          next.laneCounts[laneIndex]++
          next.fingerCounts[physicalFinger]++
          if (tc.gap !== null && !tc.simultaneousSameFinger) {
            next.minGap[physicalFinger] = next.minGap[physicalFinger] === null
              ? tc.gap
              : Math.min(next.minGap[physicalFinger], tc.gap)
          }
          candidates.push({ state: next, usedLanes: [...wrapper.usedLanes, laneIndex] })
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
    return {
      keyCount,
      physicalFingerCount,
      simultaneousCapacity: layoutCapacity,
      customLaneFingerMap,
      customSimultaneousLaneGroups: simultaneous.custom,
      simultaneousLaneGroups: simultaneous.groups,
      feasible: false,
      reason: 'NO_FINGERING_PATH',
      totalCost: null,
      costPerPress: null,
      peakLocalCostPerPress: null,
      maxTransitionCost: null,
      totalPresses,
      maxSimultaneousPresses,
      sameFingerRate: null,
      switchRate: null,
      laneSwitchRate: null,
      handSwitchRate: null,
      maxReusePenalty: null,
      maxLaneSwitchPenalty: null,
      laneCounts: null,
      fingerCounts: null,
      minGapMsPerFinger: null,
      prunedStates,
      beamWidth,
      fingeringTrace: null,
      laneProfile,
      fingerProfile: laneProfile,
      physicalFingerProfile: fingerProfile,
    }
  }

  const best = beam[0]
  const transitions = Math.max(1, totalPresses - 1)
  return {
    keyCount,
    physicalFingerCount,
    simultaneousCapacity: layoutCapacity,
    customLaneFingerMap,
    customSimultaneousLaneGroups: simultaneous.custom,
    simultaneousLaneGroups: simultaneous.groups,
    feasible: true,
    totalCost: best.cost,
    costPerPress: totalPresses ? best.cost / totalPresses : 0,
    peakLocalCostPerPress: best.peakLocalCostPerPress,
    maxTransitionCost: best.maxTransitionCost,
    localWindowPresses,
    totalPresses,
    maxSimultaneousPresses,
    sameFingerRate: best.sameFingerTransitions / transitions,
    switchRate: best.fingerSwitches / transitions,
    laneSwitchRate: best.laneSwitches / transitions,
    handSwitchRate: best.handSwitches / transitions,
    maxReusePenalty: best.maxReusePenalty,
    maxLaneSwitchPenalty: best.maxLaneSwitchPenalty,
    laneCounts: best.laneCounts,
    fingerCounts: best.fingerCounts,
    minGapMsPerFinger: best.minGap,
    prunedStates,
    beamWidth,
    laneProfile,
    fingerProfile: laneProfile,
    physicalFingerProfile: fingerProfile,
    fingeringTrace: collectTrace ? recoverTrace(best.trace, laneProfile, fingerProfile) : null,
  }
}

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
  if (curve.some((point) => point.customSimultaneousLaneGroups) || traced?.customSimultaneousLaneGroups) {
    warnings.push('CUSTOM_SIMULTANEOUS_LANE_GROUPS')
  }
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
      maxLaneSwitchPenalty: traced.maxLaneSwitchPenalty,
      beamWidth: traced.beamWidth,
      prunedStates: traced.prunedStates,
    } : null,
    warnings,
    canonicalRatingMutation: false,
  }
}

function stateKey(state) {
  return `${state.prevFinger}|${state.lastFinger}|${state.lastLane}|${state.sameHandRun}|${state.lastUse.join(',')}|${state.lastLaneByFinger.join(',')}`
}

export function keepBest(states, beamWidth) {
  const best = new Map()
  for (const state of states) {
    const key = stateKey(state)
    const current = best.get(key)
    if (!current || state.cost < current.cost) best.set(key, state)
  }
  const sorted = [...best.values()].sort((a, b) => a.cost - b.cost)
  return { states: sorted.slice(0, beamWidth), pruned: Math.max(0, sorted.length - beamWidth) }
}

export function transitionCost(state, laneIndex, timeMs, laneProfile, fingerProfile, options) {
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
  const lastLaneInfo = state.lastLane >= 0 ? laneProfile[state.lastLane] : null
  const currentIsHand = lane.resourceKind !== 'FOOT'
  const lastWasHand = Boolean(lastLaneInfo && lastLaneInfo.resourceKind !== 'FOOT')
  const lastGap = state.lastEventTime >= 0 ? Math.max(0, timeMs - state.lastEventTime) : Infinity
  const fast = Math.max(0, 1 - lastGap / 190)

  let ergonomicPenalty = currentIsHand ? current.preference * options.fingerPreferenceWeight : 0
  if (last && !simultaneousSameFinger && currentIsHand && lastWasHand) {
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

export function initialState(laneCount, fingerCount) {
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
    crossHandChordCount: 0,
    footPresses: 0,
    maxReusePenalty: 0,
    maxLaneSwitchPenalty: 0,
    maxCrossHandChordPenalty: 0,
    maxFootPenalty: 0,
    maxTransitionCost: 0,
    recentCosts: [],
    recentCostSum: 0,
    peakLocalCostPerPress: 0,
    trace: null,
  }
}

export function pushLocalCost(state, transitionCostValue, windowSize) {
  const recentCosts = [...state.recentCosts, transitionCostValue]
  let recentCostSum = state.recentCostSum + transitionCostValue
  while (recentCosts.length > windowSize) recentCostSum -= recentCosts.shift()
  return {
    recentCosts,
    recentCostSum,
    peakLocalCostPerPress: Math.max(state.peakLocalCostPerPress, recentCostSum / Math.max(1, recentCosts.length)),
  }
}

export function recoverTrace(node, laneProfile, fingerProfile) {
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
      resourceKind: lane.resourceKind,
      eventIndex: node.eventIndex,
      pressIndex: node.pressIndex,
    })
    node = node.parent
  }
  out.reverse()
  return out
}

export function inputForKeyCount(rawInput, keyCount) {
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

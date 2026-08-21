import { DEFAULT_OPTIONS, finiteNumber, normalizeEvents, effectiveBeamWidth, buildProfiles, normalizeSimultaneousLaneGroups, simultaneousCapacity, canAddLaneToChord } from './fingering-dp-profile.mjs'
import { keepBest, transitionCost, initialState, pushLocalCost, recoverTrace } from './fingering-dp-state.mjs'

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
  const footLaneCount = laneProfile.filter((lane) => lane.resourceKind === 'FOOT').length
  const localWindowPresses = Math.max(2, Math.trunc(finiteNumber(options.localWindowPresses, 'localWindowPresses')))

  const totalPresses = events.reduce((sum, event) => sum + event.presses, 0)
  const maxSimultaneousPresses = events.reduce((max, event) => Math.max(max, event.presses), 0)
  if (maxSimultaneousPresses > layoutCapacity) {
    return {
      keyCount,
      physicalFingerCount,
      simultaneousCapacity: layoutCapacity,
      footLaneCount,
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
      crossHandChordCount: null,
      footPresses: null,
      footUseRate: null,
      maxReusePenalty: null,
      maxLaneSwitchPenalty: null,
      maxCrossHandChordPenalty: null,
      maxFootPenalty: null,
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
          const laneInfo = laneProfile[laneIndex]
          const physicalFinger = laneInfo.physicalFinger
          const tc = transitionCost(wrapper.state, laneIndex, event.timeMs, laneProfile, fingerProfile, options)
          const lastProfile = wrapper.state.lastFinger >= 0 ? fingerProfile[wrapper.state.lastFinger] : null
          const currentProfile = fingerProfile[physicalFinger]
          const lastLaneInfo = wrapper.state.lastLane >= 0 ? laneProfile[wrapper.state.lastLane] : null
          const handChanged = Boolean(
            lastProfile && lastLaneInfo?.resourceKind !== 'FOOT' && laneInfo.resourceKind !== 'FOOT' && lastProfile.hand !== currentProfile.hand,
          )
          const usedHands = new Set(wrapper.usedLanes
            .map((usedLane) => laneProfile[usedLane])
            .filter((usedLane) => usedLane.resourceKind !== 'FOOT')
            .map((usedLane) => usedLane.hand))
          const crossHandChordPenalty =
            laneInfo.resourceKind !== 'FOOT' && usedHands.size === 1 && !usedHands.has(laneInfo.hand)
              ? options.crossHandChordWeight
              : 0
          const footPenalty = laneInfo.resourceKind === 'FOOT' ? options.footUseWeight : 0
          const stepCost = tc.total + crossHandChordPenalty + footPenalty
          const local = pushLocalCost(wrapper.state, stepCost, localWindowPresses)
          const nextSameHandRun = tc.simultaneousSameFinger
            ? wrapper.state.sameHandRun
            : laneInfo.resourceKind === 'FOOT'
              ? 0
              : lastLaneInfo?.resourceKind === 'FOOT' || !lastProfile
                ? 1
                : (handChanged ? 1 : wrapper.state.sameHandRun + 1)
          const next = {
            cost: wrapper.state.cost + stepCost,
            prevFinger: tc.simultaneousSameFinger ? wrapper.state.prevFinger : wrapper.state.lastFinger,
            lastFinger: physicalFinger,
            lastLane: laneIndex,
            lastEventTime: event.timeMs,
            sameHandRun: nextSameHandRun,
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
            crossHandChordCount: wrapper.state.crossHandChordCount + (crossHandChordPenalty > 0 ? 1 : 0),
            footPresses: wrapper.state.footPresses + (laneInfo.resourceKind === 'FOOT' ? 1 : 0),
            maxReusePenalty: Math.max(wrapper.state.maxReusePenalty, tc.reusePenalty),
            maxLaneSwitchPenalty: Math.max(wrapper.state.maxLaneSwitchPenalty, tc.laneSwitchPenalty),
            maxCrossHandChordPenalty: Math.max(wrapper.state.maxCrossHandChordPenalty, crossHandChordPenalty),
            maxFootPenalty: Math.max(wrapper.state.maxFootPenalty, footPenalty),
            maxTransitionCost: Math.max(wrapper.state.maxTransitionCost, stepCost),
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
            next.minGap[physicalFinger] = next.minGap[physicalFinger] === null ? tc.gap : Math.min(next.minGap[physicalFinger], tc.gap)
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
      footLaneCount,
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
      crossHandChordCount: null,
      footPresses: null,
      footUseRate: null,
      maxReusePenalty: null,
      maxLaneSwitchPenalty: null,
      maxCrossHandChordPenalty: null,
      maxFootPenalty: null,
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
    footLaneCount,
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
    crossHandChordCount: best.crossHandChordCount,
    footPresses: best.footPresses,
    footUseRate: totalPresses ? best.footPresses / totalPresses : 0,
    maxReusePenalty: best.maxReusePenalty,
    maxLaneSwitchPenalty: best.maxLaneSwitchPenalty,
    maxCrossHandChordPenalty: best.maxCrossHandChordPenalty,
    maxFootPenalty: best.maxFootPenalty,
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

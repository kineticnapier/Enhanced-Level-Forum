export const FINGERING_MODEL_VERSION = 'fingering-dp-v0.10'

export const DEFAULT_KEY_COUNTS = [2, 3, 4, 6, 8, 10, 12, 16, 24, 32, 36]
export const DEFAULT_OPTIONS = {
  beamWidth: 160,
  reuseWindowMs: 170,
  reuseWeight: 4,
  sameFingerWeight: 0.14,
  sameHandWeight: 0.015,
  handJumpWeight: 0.16,
  crossHandMismatchWeight: 0.18,
  crossHandChordWeight: 0.45,
  footUseWeight: 0.85,
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

export function finiteNumber(value, name) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`)
  return n
}

export function normalizeEvents(input) {
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

export function effectiveBeamWidth(requested, keyCount) {
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

function normalizeResourceKind(object) {
  if (object?.foot === true) return 'FOOT'
  const value = String(object?.resourceKind ?? object?.resource ?? '').trim().toUpperCase()
  return value === 'FOOT' ? 'FOOT' : value === 'HAND' ? 'HAND' : null
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
      resourceKind: normalizeResourceKind(object),
    }
  })
}

export function buildProfiles(rawInput, keyCount) {
  const customMap = normalizeLaneFingerMap(rawInput, keyCount)
  const defaultLabels = defaultLaneLabels(keyCount)
  const entries = customMap ?? defaultLabels.map((label) => ({
    laneLabel: label, fingerLabel: label, hand: null, fingerOrder: null, digitRank: null, preference: null, resourceKind: null,
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
    const order = laneOrderByHand[finger.hand]++
    const resourceKind = entry.resourceKind ?? (!customMap && keyCount > 16 && order >= 8 ? 'FOOT' : 'HAND')
    laneProfile.push({
      index: laneIndex,
      label: entry.laneLabel,
      hand: finger.hand,
      order,
      resourceKind,
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

export function normalizeSimultaneousLaneGroups(rawInput, laneProfile, fingerProfile) {
  const source = rawInput?.simultaneousLaneGroups ?? rawInput?.simultaneousGroups
  if (!Array.isArray(source)) return { groups: [], groupsByFinger: new Map(), custom: false }

  const groups = []
  const groupsByFinger = new Map()
  const seen = new Set()
  for (let groupIndex = 0; groupIndex < source.length; groupIndex++) {
    const entry = source[groupIndex]
    const laneRefs = Array.isArray(entry) ? entry : entry?.lanes
    if (!Array.isArray(laneRefs) || laneRefs.length < 2) throw new Error(`simultaneousLaneGroups[${groupIndex}] must contain at least two lanes`)
    const lanes = [...new Set(laneRefs.map((ref) => laneIndexFromReference(ref, laneProfile, groupIndex)))].sort((a, b) => a - b)
    if (lanes.length < 2) throw new Error(`simultaneousLaneGroups[${groupIndex}] must contain at least two distinct lanes`)
    const fingers = new Set(lanes.map((laneIndex) => laneProfile[laneIndex].physicalFinger))
    if (fingers.size !== 1) throw new Error(`simultaneousLaneGroups[${groupIndex}] lanes must share one physical finger/resource`)
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

export function simultaneousCapacity(fingerProfile, groupsByFinger) {
  let capacity = 0
  for (const finger of fingerProfile) {
    const groups = groupsByFinger.get(finger.index) ?? []
    let fingerCapacity = 1
    for (const group of groups) fingerCapacity = Math.max(fingerCapacity, group.size)
    capacity += fingerCapacity
  }
  return capacity
}

export function canAddLaneToChord(usedLanes, laneIndex, laneProfile, groupsByFinger) {
  if (usedLanes.includes(laneIndex)) return false
  const finger = laneProfile[laneIndex].physicalFinger
  const sameFingerLanes = usedLanes.filter((usedLane) => laneProfile[usedLane].physicalFinger === finger)
  if (!sameFingerLanes.length) return true
  const required = [...sameFingerLanes, laneIndex]
  return (groupsByFinger.get(finger) ?? []).some((group) => required.every((lane) => group.has(lane)))
}

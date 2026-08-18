export const ADOFAI_TIMING_VERSION = 'adofai-timing-v0.4'

const PATH_ANGLES = {
  R: 0, p: 15, J: 30, E: 45, T: 60, o: 75, U: 90, q: 105,
  G: 120, Q: 135, H: 150, W: 165, L: 180, x: 195, N: 210,
  Z: 225, F: 240, V: 255, D: 270, Y: 285, B: 300, C: 315,
  M: 330, A: 345, '!': 999,
}

const TIMING_ACTIONS = new Set(['Twirl', 'SetSpeed', 'Pause', 'Hold'])
const INPUT_SEMANTIC_ACTIONS = new Set(['MultiPlanet', 'AutoPlayTiles'])

function finite(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeDegrees(value) {
  const n = ((value % 360) + 360) % 360
  return n === 0 ? 360 : n
}

function stripTrailingCommas(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === ']' || text[j] === '}') continue
    }
    out += ch
  }
  return out
}

export function parseAdofaiText(rawText) {
  const text = String(rawText ?? '').replace(/^\uFEFF/, '')
  try {
    return JSON.parse(text)
  } catch (firstError) {
    try {
      return JSON.parse(stripTrailingCommas(text))
    } catch {
      throw new Error(`Invalid .adofai JSON: ${firstError instanceof Error ? firstError.message : String(firstError)}`)
    }
  }
}

export function getAdofaiAngles(level) {
  if (Array.isArray(level?.angleData)) {
    return {
      source: 'angleData',
      angles: level.angleData.map((value, index) => {
        const angle = finite(value)
        if (angle === null) throw new Error(`angleData[${index}] must be numeric`)
        return angle
      }),
    }
  }

  if (typeof level?.pathData === 'string') {
    const angles = [...level.pathData].map((char, index) => {
      if (!(char in PATH_ANGLES)) throw new Error(`Unsupported pathData character ${JSON.stringify(char)} at index ${index}`)
      return PATH_ANGLES[char]
    })
    return { source: 'pathData', angles }
  }

  throw new Error('.adofai must contain angleData[] or pathData')
}

function buildTrackGeometry(path) {
  const floors = [{ floor: 0, x: 0, y: 0, angle: path[0], midspin: false }]
  let x = 0
  let y = 0
  for (let floor = 1; floor < path.length; floor++) {
    const angle = path[floor]
    if (angle === 999) {
      floors.push({ floor, x, y, angle, midspin: true })
      continue
    }
    const rad = angle * Math.PI / 180
    x += Math.cos(rad)
    y += Math.sin(rad)
    floors.push({ floor, x, y, angle, midspin: false })
  }
  return floors
}

function groupActions(actions) {
  const byFloor = new Map()
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]
    if (!action || typeof action !== 'object') continue
    const floor = Math.max(0, Math.trunc(finite(action.floor, 0)))
    const list = byFloor.get(floor) ?? []
    list.push({ ...action, __index: index })
    byFloor.set(floor, list)
  }
  return byFloor
}

function beatDurationMs(bpm, pitch) {
  return 60_000 / bpm * (100 / pitch)
}

function applySetSpeed(action, bpm, warnings) {
  const speedType = String(action.speedType ?? '')
  if (speedType === 'Multiplier') {
    const multiplier = finite(action.bpmMultiplier)
    if (multiplier !== null && multiplier > 0) return bpm * multiplier
    warnings.push('INVALID_SET_SPEED_MULTIPLIER')
    return bpm
  }
  const absolute = finite(action.beatsPerMinute)
  if (absolute !== null && absolute > 0) return absolute
  warnings.push('INVALID_SET_SPEED_BPM')
  return bpm
}

export function extractAdofaiPressEvents(level, options = {}) {
  if (!level || typeof level !== 'object') throw new Error('ADOFAI level must be an object')
  const { source: angleSource, angles } = getAdofaiAngles(level)
  const settings = level.settings && typeof level.settings === 'object' ? level.settings : {}
  const baseBpm = finite(settings.bpm)
  if (baseBpm === null || baseBpm <= 0) throw new Error('settings.bpm must be a positive number')
  const pitch = finite(settings.pitch, 100)
  if (pitch === null || pitch <= 0) throw new Error('settings.pitch must be a positive number')

  const actions = Array.isArray(level.actions) ? level.actions : []
  const actionsByFloor = groupActions(actions)
  const warnings = []
  const unsupportedEvents = [...new Set(actions
    .map((action) => String(action?.eventType ?? ''))
    .filter((eventType) => eventType && !TIMING_ACTIONS.has(eventType) && INPUT_SEMANTIC_ACTIONS.has(eventType)))]

  if (actions.some((action) => action?.eventType === 'Hold')) warnings.push('HOLD_INPUT_SEMANTICS_APPROXIMATE')
  if (unsupportedEvents.includes('MultiPlanet')) warnings.push('MULTIPLANET_PRESS_COUNT_NOT_MODELED')
  if (unsupportedEvents.includes('AutoPlayTiles')) warnings.push('AUTOPLAY_TILE_INPUT_NOT_MODELED')

  const path = [0, ...angles]
  const track = buildTrackGeometry(path)
  let direction = -1
  let bpm = baseBpm
  let elapsedMs = 0
  let floorTile = null
  const events = []
  const segments = []
  const visualEvents = []

  for (let sourceFloor = 0; sourceFloor < path.length - 1; sourceFloor++) {
    const segmentStartMs = elapsedMs
    const floorActions = actionsByFloor.get(sourceFloor) ?? []
    let extraBeats = 0
    for (const action of floorActions) {
      if (action.eventType === 'Twirl') {
        direction *= -1
        visualEvents.push({ floor: sourceFloor, eventType: 'Twirl', timeMs: segmentStartMs, directionAfter: direction })
      } else if (action.eventType === 'SetSpeed') {
        const bpmBefore = bpm
        bpm = applySetSpeed(action, bpm, warnings)
        visualEvents.push({
          floor: sourceFloor,
          eventType: 'SetSpeed',
          timeMs: segmentStartMs,
          speedType: String(action.speedType ?? ''),
          bpmMultiplier: finite(action.bpmMultiplier, null),
          beatsPerMinute: finite(action.beatsPerMinute, null),
          bpmBefore,
          bpmAfter: bpm,
        })
      } else if (action.eventType === 'Pause' || action.eventType === 'Hold') {
        const duration = finite(action.duration, 0)
        if (duration !== null && duration > 0) extraBeats += duration
      }
    }

    if (!(bpm > 0)) throw new Error(`Computed BPM is invalid at floor ${sourceFloor}`)
    const extraMs = extraBeats * beatDurationMs(bpm, pitch)
    elapsedMs += extraMs
    const travelStartMs = elapsedMs

    const current = path[sourceFloor]
    const next = path[sourceFloor + 1]

    if (next === 999) {
      floorTile = current
      segments.push({ sourceFloor, targetFloor: sourceFloor + 1, midspin: true, bpm, direction, extraBeats, extraMs, segmentStartMs, travelStartMs, hitTimeMs: elapsedMs })
      continue
    }

    if (current !== 999) floorTile = current + 180
    if (floorTile === null) floorTile = 180

    const travelDegrees = normalizeDegrees(direction * (next - floorTile))
    const travelBeats = travelDegrees / 180
    const travelMs = travelBeats * beatDurationMs(bpm, pitch)
    elapsedMs += travelMs

    events.push({ timeMs: elapsedMs, presses: 1, floor: sourceFloor + 1, travelDegrees, travelBeats, bpm })
    segments.push({
      sourceFloor,
      targetFloor: sourceFloor + 1,
      midspin: false,
      bpm,
      direction,
      extraBeats,
      extraMs,
      segmentStartMs,
      travelStartMs,
      travelDegrees,
      travelBeats,
      travelMs,
      hitTimeMs: elapsedMs,
    })
  }

  const uniqueWarnings = [...new Set(warnings)]
  if (angles.length === 0) uniqueWarnings.push('EMPTY_PATH')

  return {
    levelVersionId: options.levelVersionId ?? null,
    sha256: options.sha256 ?? null,
    events,
    timing: {
      extractorVersion: ADOFAI_TIMING_VERSION,
      angleSource,
      pathEntryCount: angles.length,
      pressEventCount: events.length,
      baseBpm,
      pitch,
      offsetMs: finite(settings.offset, 0) ?? 0,
      countdownTicks: finite(settings.countdownTicks, null),
      warnings: [...new Set(uniqueWarnings)],
      unsupportedEvents,
      track,
      visualEvents,
      segments: options.includeSegments === false ? undefined : segments,
      note: 'track/segment/action data is exposed for ELF playback visualization; offset/countdown are not added to relative fingering intervals',
    },
  }
}

export function extractAdofaiPressEventsFromText(text, options = {}) {
  return extractAdofaiPressEvents(parseAdofaiText(text), options)
}

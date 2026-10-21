type WallClockParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function parseWallClock(value: string): WallClockParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour, minute] = match
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  }
  if (
    parts.month < 1 || parts.month > 12 ||
    parts.day < 1 || parts.day > 31 ||
    parts.hour < 0 || parts.hour > 23 ||
    parts.minute < 0 || parts.minute > 59
  ) return null
  return parts
}

function zonedParts(epochMs: number, timeZone: string): WallClockParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(epochMs))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  )
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  }
}

function sameWallClock(a: WallClockParts, b: WallClockParts) {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute
}

function offsetAt(epochMs: number, timeZone: string) {
  const parts = zonedParts(epochMs, timeZone)
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  return representedAsUtc - Math.floor(epochMs / 60000) * 60000
}

/** Convert a datetime-local wall clock in an explicit IANA timezone to UTC. */
export function zonedDateTimeToUtc(value: string, timeZone: string): string | null {
  const wall = parseWallClock(value)
  if (!wall || !timeZone.trim()) return null
  try {
    const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
    let candidate = wallAsUtc
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = wallAsUtc - offsetAt(candidate, timeZone)
      if (next === candidate) break
      candidate = next
    }
    // Reject nonexistent local times during DST spring-forward transitions.
    if (!sameWallClock(zonedParts(candidate, timeZone), wall)) return null
    return new Date(candidate).toISOString()
  } catch {
    return null
  }
}

/** Format a persisted UTC instant for a datetime-local input in an explicit IANA timezone. */
export function formatDateTimeInZone(value: string | null | undefined, timeZone: string): string {
  if (!value || !timeZone.trim()) return ''
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) return ''
  try {
    const parts = zonedParts(instant, timeZone)
    const pad = (number: number) => String(number).padStart(2, '0')
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
  } catch {
    return ''
  }
}

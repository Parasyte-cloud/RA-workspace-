// Calendar days in Lagos (Africa/Lagos, UTC+1, no daylight saving).
//
// new Date().toISOString().slice(0, 10) is the UTC day. Between 00:00 and
// 01:00 in Lagos that is still "yesterday", so "today" defaults, minimum dates
// and "contract ended" checks were a day behind for the first hour of every day.
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now)
}

// The Lagos calendar day that is `days` days from today (negative for the past).
export function lagosDayOffset(days: number, now: Date = new Date()): string {
  const [y, m, d] = lagosToday(now).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10)
}

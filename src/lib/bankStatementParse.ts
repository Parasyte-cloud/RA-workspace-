// Cell parsing for bank statement imports (CSV and Excel).
//
// Nigerian bank statements write dates day first: 05/10/2026 is 5 October.
// The old code handed every text date to new Date(), and V8 reads 05/10/2026 as
// 10 May (month first). It then converted with toISOString(), which moves local
// midnight back into UTC, so "05 Oct 2026" became 2026-10-04 on a Lagos
// computer. Both silently put transactions on the wrong day, and the date is
// part of each row's duplicate-detection hash.

export const textOf = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value && 'text' in value) return String((value as { text?: unknown }).text ?? '')
  if (typeof value === 'object' && value && 'result' in value) return String((value as { result?: unknown }).result ?? '')
  return String(value)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const pad2 = (n: number) => String(n).padStart(2, '0')

// Returns YYYY-MM-DD only for a real calendar day (31 February is not one).
function isoOrEmpty(year: number, month: number, day: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return ''
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return ''
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return ''
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function toDate(value: unknown): string {
  // Excel cells arrive as Date objects at UTC midnight, so UTC parts are the calendar day.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return isoOrEmpty(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }
  const raw = textOf(value).trim()
  if (!raw) return ''

  // 2026-10-05, 2026/10/05, optionally followed by a time
  let m = raw.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[T\s].*)?$/)
  if (m) return isoOrEmpty(Number(m[1]), Number(m[2]), Number(m[3])) || raw

  // 05/10/2026, 05-10-2026, 5.10.26: day first. If the first number cannot be a
  // day-of-month-first reading (second number above 12), it can only be month first.
  m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[T\s].*)?$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return (b > 12 ? isoOrEmpty(year, a, b) : isoOrEmpty(year, b, a)) || raw
  }

  // 05 Oct 2026, 5 October 2026, Oct 5, 2026, 05-Oct-2026
  m = raw.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})(?:[T\s].*)?$/)
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return (month ? isoOrEmpty(year, month, Number(m[1])) : '') || raw
  }
  m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[T\s].*)?$/)
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1
    return (month ? isoOrEmpty(Number(m[3]), month, Number(m[2])) : '') || raw
  }

  // Unrecognised: keep the text so the row shows what the file said instead of a guess.
  return raw
}

// Debits and credits are magnitudes: the column says which side they are on.
export const toAmount = (value: unknown): number => {
  const n = toSignedAmount(value)
  return Math.abs(n)
}

// A running balance keeps its sign: an overdrawn account is negative.
export const toSignedAmount = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = textOf(value)
  const trailingMinus = /-\s*$/.test(raw) || /\bDR\b/i.test(raw)
  const cleaned = raw.replace(/[₦NGN,\s]/gi, '').replace(/\(([^)]+)\)/, '-$1').replace(/-$/, '').replace(/DR$/i, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return 0
  return trailingMinus && n > 0 ? -n : n
}

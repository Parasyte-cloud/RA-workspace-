// Finance Sheets: the data model and every pure helper that does not need the
// formula engine. Nothing in here touches React or Supabase, so it can be
// tested on its own.
//
// Rows and columns are 1-based everywhere, like Excel: A1 is row 1, column 1.

export type NumberFormat = 'gen' | 'num' | 'ngn' | 'pct' | 'date'

/** One cell. `v` is exactly what the user typed: text, a number, or a formula starting with "=". */
export type Cell = {
  v: string
  b?: 1
  al?: 'l' | 'c' | 'r'
  nf?: NumberFormat
}

export type Sheet = {
  name: string
  cells: Record<string, Cell>
  /** Column widths in pixels, keyed by 1-based column number. */
  widths?: Record<string, number>
}

export type WorkbookData = { sheets: Sheet[] }

export const MAX_ROWS = 2000
export const MAX_COLS = 52
export const DEFAULT_COL_WIDTH = 104
export const MIN_COL_WIDTH = 44
export const MAX_COL_WIDTH = 480

// ---------------------------------------------------------------- references

export function colName(col: number): string {
  let n = col
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function colIndex(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

export const refKey = (row: number, col: number) => `${colName(col)}${row}`

export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim())
  if (!m) return null
  const col = colIndex(m[1])
  const row = Number(m[2])
  if (!col || !row) return null
  return { row, col }
}

export type Rect = { r1: number; c1: number; r2: number; c2: number }

export const normRect = (a: { row: number; col: number }, b: { row: number; col: number }): Rect => ({
  r1: Math.min(a.row, b.row),
  c1: Math.min(a.col, b.col),
  r2: Math.max(a.row, b.row),
  c2: Math.max(a.col, b.col),
})

export function rectLabel(rect: Rect): string {
  const a = refKey(rect.r1, rect.c1)
  const b = refKey(rect.r2, rect.c2)
  return a === b ? a : `${a}:${b}`
}

// -------------------------------------------------------------- date serials
// Excel counts days from 1899-12-30, so a date is just a number that is
// displayed as a date. That is what lets =B2-A2 give "days between".

const EPOCH = Date.UTC(1899, 11, 30)
const DAY = 86400000

export const dateToSerial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY)

export function serialToParts(serial: number): { y: number; m: number; d: number } {
  const dt = new Date(EPOCH + Math.floor(serial) * DAY)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

export const todaySerial = () => {
  const n = new Date()
  return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function serialToIso(serial: number): string {
  const { y, m, d } = serialToParts(serial)
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

/** Understands 2026-10-11 and 11/10/2026 (day first, as in Nigeria). Returns a serial or null. */
export function parseDateText(text: string): number | null {
  const t = text.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  let y: number, mo: number, d: number
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3])
  } else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
    if (!m) return null
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3])
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 9999) return null
  const serial = dateToSerial(y, mo, d)
  const back = serialToParts(serial)
  return back.y === y && back.m === mo && back.d === d ? serial : null
}

// ------------------------------------------------------------- reading input

/** What a typed value means before any formula runs. */
export type Parsed =
  | { kind: 'empty' }
  | { kind: 'formula'; formula: string }
  | { kind: 'number'; n: number }
  | { kind: 'bool'; b: boolean }
  | { kind: 'text'; s: string }

const NUM_RE = /^\(?[-+]?[₦$]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)?\)?%?$/

export function parseInput(raw: string): Parsed {
  if (raw === '' || raw == null) return { kind: 'empty' }
  if (raw.startsWith("'")) return { kind: 'text', s: raw.slice(1) }
  if (raw.startsWith('=') && raw.length > 1) return { kind: 'formula', formula: raw.slice(1) }
  const t = raw.trim()
  if (t === '') return { kind: 'text', s: raw }
  const up = t.toUpperCase()
  if (up === 'TRUE') return { kind: 'bool', b: true }
  if (up === 'FALSE') return { kind: 'bool', b: false }
  if (NUM_RE.test(t) && /\d/.test(t)) {
    let s = t
    let negative = false
    if (s.startsWith('(') && s.endsWith(')')) {
      negative = true
      s = s.slice(1, -1)
    }
    const pct = s.endsWith('%')
    if (pct) s = s.slice(0, -1)
    s = s.replace(/[₦$,\s]/g, '')
    let n = Number(s)
    if (Number.isFinite(n)) {
      if (negative) n = -n
      if (pct) n /= 100
      return { kind: 'number', n }
    }
  }
  const date = parseDateText(t)
  if (date !== null) return { kind: 'number', n: date }
  return { kind: 'text', s: raw }
}

/** The number format a freshly typed value should get, so a date looks like a date. */
export function inferFormat(raw: string): NumberFormat | undefined {
  const t = raw.trim()
  if (!t || t.startsWith('=') || t.startsWith("'")) return undefined
  if (parseDateText(t) !== null) return 'date'
  if (/^\(?[-+]?\s*[\d,.]+%$/.test(t)) return 'pct'
  if (/^\(?[-+]?₦/.test(t)) return 'ngn'
  return undefined
}

// --------------------------------------------------------------- formatting

const fixed = (n: number, dp: number) => {
  const neg = n < 0
  const s = Math.abs(n).toFixed(dp)
  const [int, frac] = s.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg && Number(s) !== 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

export function plainNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const s = String(Number(n.toPrecision(12)))
  return s
}

export function formatNumber(n: number, nf: NumberFormat | undefined): string {
  switch (nf) {
    case 'num': return fixed(n, 2)
    case 'ngn': return `${n < 0 ? '-' : ''}₦${fixed(Math.abs(n), 2)}`
    case 'pct': return `${fixed(n * 100, 2)}%`
    case 'date': return n >= 1 && n < 2958466 ? serialToIso(n) : plainNumber(n)
    default: return plainNumber(n)
  }
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A practical subset of Excel TEXT() patterns, enough for finance reports. */
export function formatWithPattern(n: number, pattern: string): string {
  const p = pattern.trim()
  const lower = p.toLowerCase()
  if (/[ymd]/.test(lower) && !/[#0]/.test(p)) {
    const { y, m, d } = serialToParts(n)
    return p
      .replace(/yyyy/gi, pad(y, 4))
      .replace(/yy/gi, pad(y % 100))
      .replace(/mmmm/gi, MONTHS[m - 1])
      .replace(/mmm/gi, MONTHS[m - 1].slice(0, 3))
      .replace(/mm/gi, pad(m))
      .replace(/dd/gi, pad(d))
      .replace(/\bm\b/gi, String(m))
      .replace(/\bd\b/gi, String(d))
  }
  const percent = p.includes('%')
  const value = percent ? n * 100 : n
  const body = p.replace(/[₦$%"\\]/g, '')
  const dp = (/\.([0#]+)/.exec(body)?.[1] ?? '').length
  const grouped = body.includes(',')
  const minInt = (/^[^.]*?(0+)/.exec(body.replace(/,/g, ''))?.[1] ?? '').length
  let out = grouped ? fixed(value, dp) : Math.abs(value).toFixed(dp)
  if (!grouped && value < 0) out = `-${out}`
  if (minInt > 1) {
    const neg = out.startsWith('-')
    const digits = neg ? out.slice(1) : out
    const [int, frac] = digits.split('.')
    const padded = int.replace(/,/g, '').padStart(minInt, '0')
    out = `${neg ? '-' : ''}${grouped ? padded.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : padded}${frac ? `.${frac}` : ''}`
  }
  if (p.includes('₦')) out = out.startsWith('-') ? `-₦${out.slice(1)}` : `₦${out}`
  else if (p.includes('$')) out = out.startsWith('-') ? `-$${out.slice(1)}` : `$${out}`
  if (percent) out += '%'
  return out
}

// ------------------------------------------------- relative formula shifting

const A1_RE = /(?<![A-Za-z0-9_.!'])(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/g
const SHEET_A1_RE = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/g

/**
 * Moves the relative references in a formula, the way Excel does when you copy a
 * cell or fill down. $A$1 stays put, A1 moves, text inside quotes is left alone.
 * A reference pushed off the sheet becomes #REF!.
 */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (!dRow && !dCol) return formula
  const parts = formula.split(/("(?:[^"]|"")*")/)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      const move = (colAbs: string, col: string, rowAbs: string, row: string) => {
        const c = colAbs ? colIndex(col) : colIndex(col) + dCol
        const r = rowAbs ? Number(row) : Number(row) + dRow
        if (c < 1 || r < 1 || c > MAX_COLS || r > MAX_ROWS) return null
        return `${colAbs}${colName(c)}${rowAbs}${r}`
      }
      let out = part.replace(SHEET_A1_RE, (_m, sheet: string, ca: string, c: string, ra: string, r: string) => {
        const moved = move(ca, c, ra, r)
        return moved ? `${sheet}${moved}` : '#REF!'
      })
      out = out.replace(A1_RE, (_m, ca: string, c: string, ra: string, r: string) => move(ca, c, ra, r) ?? '#REF!')
      return out
    })
    .join('')
}

// ------------------------------------------------------------------ clipboard

/** Tab and newline separated text, with quoting for cells that contain tabs, quotes or newlines. */
export function toTsv(rows: string[][]): string {
  return rows
    .map(row => row.map(v => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t'))
    .join('\n')
}

/** Reads what Excel, Google Sheets or a CSV-ish clipboard gives us. Handles quoted multi-line cells. */
export function parseTsv(text: string): string[][] {
  const delimiter = '\t'
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  // A trailing newline from a copy produces one empty row; drop it.
  if (rows.length > 1 && rows[rows.length - 1].every(v => v === '')) rows.pop()
  return rows
}

/** Reads a CSV file (commas, quoted fields) into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = [] }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim() !== ''))
}

// ------------------------------------------------------------- sheet helpers

export const emptySheet = (name: string): Sheet => ({ name, cells: {} })
export const emptyWorkbook = (): WorkbookData => ({ sheets: [emptySheet('Sheet1')] })

export function uniqueSheetName(wb: WorkbookData, wanted: string): string {
  const base = wanted.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet'
  const taken = new Set(wb.sheets.map(s => s.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base.slice(0, 28)} ${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base.slice(0, 20)} ${Date.now() % 10000}`
}

/** Builds a sheet from a table of values. Numbers and dates get sensible formats, a header row is bold. */
export function sheetFromRows(name: string, rows: (string | number | null | undefined)[][], opts: { header?: boolean } = {}): Sheet {
  const cells: Record<string, Cell> = {}
  rows.slice(0, MAX_ROWS).forEach((row, r) => {
    row.slice(0, MAX_COLS).forEach((value, c) => {
      if (value === null || value === undefined || value === '') return
      const v = typeof value === 'number' ? plainNumber(value) : String(value)
      const cell: Cell = { v }
      if (opts.header && r === 0) cell.b = 1
      else {
        const nf = typeof value === 'number' ? undefined : inferFormat(v)
        if (nf) cell.nf = nf
      }
      cells[refKey(r + 1, c + 1)] = cell
    })
  })
  return { name, cells }
}

export function usedExtent(sheet: Sheet): { rows: number; cols: number } {
  let rows = 0
  let cols = 0
  for (const key of Object.keys(sheet.cells)) {
    const ref = parseRef(key)
    if (!ref) continue
    if (ref.row > rows) rows = ref.row
    if (ref.col > cols) cols = ref.col
  }
  return { rows, cols }
}

/** Cheap sanity check on data loaded from the database, so a damaged row cannot crash the editor. */
export function sanitizeWorkbook(input: unknown): WorkbookData {
  const sheetsIn = (input as { sheets?: unknown } | null)?.sheets
  if (!Array.isArray(sheetsIn) || sheetsIn.length === 0) return emptyWorkbook()
  const sheets: Sheet[] = []
  for (const raw of sheetsIn.slice(0, 30)) {
    const s = raw as Partial<Sheet> | null
    const cells: Record<string, Cell> = {}
    if (s && typeof s.cells === 'object' && s.cells) {
      for (const [key, cell] of Object.entries(s.cells)) {
        const ref = parseRef(key)
        if (!ref || ref.row > MAX_ROWS || ref.col > MAX_COLS) continue
        const c = cell as Partial<Cell> | null
        if (!c || typeof c.v !== 'string') continue
        const clean: Cell = { v: c.v }
        if (c.b) clean.b = 1
        if (c.al === 'l' || c.al === 'c' || c.al === 'r') clean.al = c.al
        if (c.nf === 'num' || c.nf === 'ngn' || c.nf === 'pct' || c.nf === 'date') clean.nf = c.nf
        cells[refKey(ref.row, ref.col)] = clean
      }
    }
    const widths: Record<string, number> = {}
    if (s && typeof s.widths === 'object' && s.widths) {
      for (const [k, w] of Object.entries(s.widths)) {
        if (Number(k) >= 1 && Number(k) <= MAX_COLS && Number.isFinite(w)) widths[k] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Number(w)))
      }
    }
    sheets.push({
      name: typeof s?.name === 'string' && s.name.trim() ? s.name.slice(0, 31) : `Sheet${sheets.length + 1}`,
      cells,
      ...(Object.keys(widths).length ? { widths } : {}),
    })
  }
  return { sheets }
}

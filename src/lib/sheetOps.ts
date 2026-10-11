// Finance Sheets: structural edits (insert and delete rows and columns).
//
// The hard part is not moving the cells, it is keeping every formula honest.
// If you insert a row above a total, =SUM(B2:B10) must become =SUM(B3:B11),
// and a formula on another sheet that points here has to follow too. If a row
// that a formula pointed at is deleted, the formula must say #REF! rather than
// quietly add up the wrong thing. This file does that.

import { MAX_COLS, MAX_ROWS, colIndex, colName, parseRef, refKey } from './sheetModel'
import type { Cell, Sheet, WorkbookData } from './sheetModel'

export type Axis = 'row' | 'col'

const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!`
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`
const COLS = String.raw`\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}`
const ROWS = String.raw`\$?\d{1,7}:\$?\d{1,7}`
// Order matters: try a cell range, then a bare column or row range, then a single cell.
const REF_RE = new RegExp(String.raw`(?<![A-Za-z0-9_.!'])(${SHEET})?(${CELL}:${CELL}|${COLS}(?![A-Za-z0-9_(])|${ROWS}(?![\d.])|${CELL}(?![A-Za-z0-9_(]))`, 'g')

const sheetNameOf = (prefix: string) => {
  const raw = prefix.slice(0, -1)
  return (raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw).toLowerCase()
}

type Part = { abs: boolean; n: number }

function adjustEnd(n: number, at: number, count: number, kind: 'insert' | 'delete', end: 'start' | 'end'): number | null {
  if (kind === 'insert') return n >= at ? n + count : n
  const last = at + count - 1
  if (n < at) return n
  if (n > last) return n - count
  // The reference sits on a deleted line. A range edge slides to the survivor, a lone cell is gone.
  return end === 'start' ? at : at - 1
}

function adjustSpan(a: number, b: number, at: number, count: number, kind: 'insert' | 'delete'): [number, number] | null {
  const lo = adjustEnd(Math.min(a, b), at, count, kind, 'start')
  const hi = adjustEnd(Math.max(a, b), at, count, kind, 'end')
  if (lo === null || hi === null || hi < lo || hi < 1 || lo < 1) return null
  return [lo, hi]
}

/**
 * Rewrites one formula after rows or columns are inserted or deleted on `target`.
 * `owner` is the sheet the formula lives on, because a reference with no sheet name means "my own sheet".
 */
export function adjustFormula(
  formula: string,
  owner: string,
  target: string,
  axis: Axis,
  at: number,
  count: number,
  kind: 'insert' | 'delete',
): string {
  const parts = formula.split(/("(?:[^"]|"")*")/)
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      return part.replace(REF_RE, (match: string, prefix: string | undefined, ref: string) => {
        const refSheet = prefix ? sheetNameOf(prefix) : owner.toLowerCase()
        if (refSheet !== target.toLowerCase()) return match
        const head = prefix ?? ''
        const split = ref.split(':')

        // Whole-column or whole-row references.
        if (COLS_ONLY.test(ref)) {
          if (axis === 'row') return match
          const a = colIndex(split[0].replace('$', ''))
          const b = colIndex(split[1].replace('$', ''))
          const span = adjustSpan(a, b, at, count, kind)
          if (!span) return `${head}#REF!`
          const abs0 = split[0].startsWith('$') ? '$' : ''
          const abs1 = split[1].startsWith('$') ? '$' : ''
          return `${head}${abs0}${colName(span[0])}:${abs1}${colName(span[1])}`
        }
        if (ROWS_ONLY.test(ref)) {
          if (axis === 'col') return match
          const a = Number(split[0].replace('$', ''))
          const b = Number(split[1].replace('$', ''))
          const span = adjustSpan(a, b, at, count, kind)
          if (!span) return `${head}#REF!`
          const abs0 = split[0].startsWith('$') ? '$' : ''
          const abs1 = split[1].startsWith('$') ? '$' : ''
          return `${head}${abs0}${span[0]}:${abs1}${span[1]}`
        }

        const cells = split.map(s => {
          const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(s)!
          return { colAbs: m[1], col: colIndex(m[2]), rowAbs: m[3], row: Number(m[4]) }
        })
        const [first, second] = cells
        if (!second) {
          const v = axis === 'row' ? first.row : first.col
          const moved = adjustEnd(v, at, count, kind, 'start')
          if (kind === 'delete' && v >= at && v <= at + count - 1) return `${head}#REF!`
          if (moved === null) return `${head}#REF!`
          const row = axis === 'row' ? moved : first.row
          const col = axis === 'col' ? moved : first.col
          return `${head}${first.colAbs}${colName(col)}${first.rowAbs}${row}`
        }
        const aV = axis === 'row' ? first.row : first.col
        const bV = axis === 'row' ? second.row : second.col
        const span = adjustSpan(aV, bV, at, count, kind)
        if (!span) return `${head}#REF!`
        const lowFirst = aV <= bV
        const loCell = lowFirst ? first : second
        const hiCell = lowFirst ? second : first
        const build = (c: typeof first, v: number) => `${c.colAbs}${colName(axis === 'col' ? v : c.col)}${c.rowAbs}${axis === 'row' ? v : c.row}`
        return `${head}${build(loCell, span[0])}:${build(hiCell, span[1])}`
      })
    })
    .join('')
}

const COLS_ONLY = /^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}$/
const ROWS_ONLY = /^\$?\d+:\$?\d+$/

/** Inserts `count` blank rows or columns before `at` on sheet `si`, fixing every formula in the workbook. */
export function insertLines(wb: WorkbookData, si: number, axis: Axis, at: number, count = 1): WorkbookData {
  return restructure(wb, si, axis, at, count, 'insert')
}

/** Deletes `count` rows or columns starting at `at` on sheet `si`, fixing every formula in the workbook. */
export function deleteLines(wb: WorkbookData, si: number, axis: Axis, at: number, count = 1): WorkbookData {
  return restructure(wb, si, axis, at, count, 'delete')
}

function restructure(wb: WorkbookData, si: number, axis: Axis, at: number, count: number, kind: 'insert' | 'delete'): WorkbookData {
  const target = wb.sheets[si]
  const limit = axis === 'row' ? MAX_ROWS : MAX_COLS
  if (!target || at < 1 || count < 1 || at > limit) return wb

  const sheets = wb.sheets.map((sheet, idx): Sheet => {
    const cells: Record<string, Cell> = {}
    for (const [key, cell] of Object.entries(sheet.cells)) {
      let next: Cell = cell
      if (cell.v.startsWith('=')) {
        const f = adjustFormula(cell.v.slice(1), sheet.name, target.name, axis, at, count, kind)
        if (f !== cell.v.slice(1)) next = { ...cell, v: `=${f}` }
      }
      if (idx !== si) { cells[key] = next; continue }
      const ref = parseRef(key)
      if (!ref) continue
      const v = axis === 'row' ? ref.row : ref.col
      let moved: number
      if (kind === 'insert') moved = v >= at ? v + count : v
      else if (v < at) moved = v
      else if (v >= at + count) moved = v - count
      else continue
      if (moved > limit) continue
      const row = axis === 'row' ? moved : ref.row
      const col = axis === 'col' ? moved : ref.col
      cells[refKey(row, col)] = next
    }
    let widths = sheet.widths
    if (idx === si && axis === 'col' && widths) {
      const w: Record<string, number> = {}
      for (const [k, val] of Object.entries(widths)) {
        const c = Number(k)
        if (kind === 'insert') w[String(c >= at ? c + count : c)] = val
        else if (c < at) w[k] = val
        else if (c >= at + count) w[String(c - count)] = val
      }
      widths = w
    }
    return { ...sheet, cells, ...(widths ? { widths } : {}) }
  })
  return { sheets }
}

/** Renaming a sheet must rewrite the formulas that point to it, or they all turn into #REF!. */
export function renameSheet(wb: WorkbookData, si: number, newName: string): WorkbookData {
  const old = wb.sheets[si]?.name
  if (old === undefined || old === newName) return wb
  const quote = (n: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`)
  const prefixRe = new RegExp(String.raw`(?<![A-Za-z0-9_.])(?:'${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''")}'|${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})!`, 'gi')
  const sheets = wb.sheets.map((sheet, idx) => {
    const cells: Record<string, Cell> = {}
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (!cell.v.startsWith('=')) { cells[key] = cell; continue }
      const text = cell.v
        .split(/("(?:[^"]|"")*")/)
        .map((p, i) => (i % 2 === 1 ? p : p.replace(prefixRe, `${quote(newName)}!`)))
        .join('')
      cells[key] = text === cell.v ? cell : { ...cell, v: text }
    }
    return idx === si ? { ...sheet, name: newName, cells } : { ...sheet, cells }
  })
  return { sheets }
}

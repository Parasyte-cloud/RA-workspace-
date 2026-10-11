// Finance Sheets: reading and writing real .xlsx files.
//
// Export keeps formulas as formulas (and stores the computed answer beside them, so
// the file also opens correctly in viewers that do not recalculate). Import turns
// an Excel file back into our sheet format, keeping formulas, bold, alignment and
// the common number formats. ExcelJS is large, so it is loaded only when needed.

import { Calc } from './sheetFormula'
import { isErr } from './sheetFormula'
import {
  DEFAULT_COL_WIDTH,
  MAX_COLS,
  MAX_ROWS,
  dateToSerial,
  parseInput,
  parseRef,
  plainNumber,
  refKey,
  uniqueSheetName,
} from './sheetModel'
import type { Cell, NumberFormat, Sheet, WorkbookData } from './sheetModel'

const EXCEL_FORMATS: Record<NumberFormat, string> = {
  gen: 'General',
  num: '#,##0.00',
  ngn: '"₦"#,##0.00;-"₦"#,##0.00',
  pct: '0.00%',
  date: 'yyyy-mm-dd',
}

export async function workbookToXlsx(wb: WorkbookData): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'RideArrivo Workspace'
  book.created = new Date()
  const calc = new Calc(wb)

  wb.sheets.forEach((sheet, si) => {
    const ws = book.addWorksheet(sheet.name.slice(0, 31))
    for (const [key, cell] of Object.entries(sheet.cells)) {
      const ref = parseRef(key)
      if (!ref) continue
      const target = ws.getCell(ref.row, ref.col)
      const parsed = parseInput(cell.v)
      if (parsed.kind === 'formula') {
        const result = calc.value(si, ref.row, ref.col)
        target.value = isErr(result)
          ? { formula: parsed.formula, result: { error: result.code as '#N/A' } }
          : { formula: parsed.formula, result: result === null ? '' : result }
      } else if (parsed.kind === 'number') target.value = parsed.n
      else if (parsed.kind === 'bool') target.value = parsed.b
      else if (parsed.kind === 'text') target.value = parsed.s
      if (cell.nf && cell.nf !== 'gen') target.numFmt = EXCEL_FORMATS[cell.nf]
      if (cell.b) target.font = { bold: true }
      if (cell.al) target.alignment = { horizontal: cell.al === 'l' ? 'left' : cell.al === 'c' ? 'center' : 'right' }
    }
    for (const [col, px] of Object.entries(sheet.widths ?? {})) ws.getColumn(Number(col)).width = Math.max(4, px / 7)
    if (!sheet.widths) ws.columns.forEach(c => { c.width = DEFAULT_COL_WIDTH / 7 })
  })
  const buffer = await book.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function formatFromExcel(numFmt: string | undefined): NumberFormat | undefined {
  if (!numFmt || numFmt === 'General') return undefined
  const f = numFmt.toLowerCase()
  if (f.includes('%')) return 'pct'
  if (/[ymd]{2,}/.test(f.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))) return 'date'
  if (f.includes('₦') || f.includes('ngn') || f.includes('$') || f.includes('£') || f.includes('€')) return 'ngn'
  if (f.includes('#,##0') || /0\.0+/.test(f)) return 'num'
  return undefined
}

export type ImportResult = { data: WorkbookData; notes: string[] }

export async function xlsxToWorkbook(buffer: ArrayBuffer): Promise<ImportResult> {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  const notes: string[] = []
  const out: WorkbookData = { sheets: [] }
  let sharedFallbacks = 0
  let clipped = false

  for (const ws of book.worksheets.slice(0, 30)) {
    const cells: Record<string, Cell> = {}
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) { clipped = true; return }
      row.eachCell({ includeEmpty: false }, (c, colNumber) => {
        if (colNumber > MAX_COLS) { clipped = true; return }
        const value = c.value as unknown
        let raw = ''
        let nf = formatFromExcel(c.numFmt)
        if (value === null || value === undefined) return
        if (value instanceof Date) {
          const frac = (value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds()) / 86400
          raw = plainNumber(dateToSerial(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) + frac)
          nf = nf ?? 'date'
        } else if (typeof value === 'number') raw = plainNumber(value)
        else if (typeof value === 'boolean') raw = value ? 'TRUE' : 'FALSE'
        else if (typeof value === 'string') raw = /^[=+\-@']/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value
        else if (typeof value === 'object') {
          const o = value as { formula?: string; sharedFormula?: string; result?: unknown; richText?: { text: string }[]; text?: string; error?: string }
          if (typeof o.formula === 'string') raw = `=${o.formula}`
          else if (typeof o.sharedFormula === 'string') {
            sharedFallbacks += 1
            raw = o.result === undefined || o.result === null ? '' : String(o.result)
          } else if (o.richText) raw = o.richText.map(t => t.text).join('')
          else if (typeof o.text === 'string') raw = o.text
          else if (typeof o.error === 'string') raw = `'${o.error}`
        }
        if (raw === '') return
        const cell: Cell = { v: raw }
        if (nf) cell.nf = nf
        if (c.font?.bold) cell.b = 1
        const h = c.alignment?.horizontal
        if (h === 'left') cell.al = 'l'
        else if (h === 'center') cell.al = 'c'
        else if (h === 'right') cell.al = 'r'
        cells[refKey(rowNumber, colNumber)] = cell
      })
    })
    const widths: Record<string, number> = {}
    for (let col = 1; col <= Math.min(MAX_COLS, ws.columnCount); col += 1) {
      const w = ws.getColumn(col).width
      if (w) widths[String(col)] = Math.round(Math.min(480, Math.max(44, w * 7)))
    }
    const sheet: Sheet = { name: uniqueSheetName(out, ws.name), cells, ...(Object.keys(widths).length ? { widths } : {}) }
    out.sheets.push(sheet)
  }
  if (!out.sheets.length) throw new Error('That file has no worksheets.')
  if (clipped) notes.push(`Only the first ${MAX_ROWS} rows and ${MAX_COLS} columns of each sheet were imported.`)
  if (sharedFallbacks) notes.push(`${sharedFallbacks} cells used Excel's shared-formula shortcut, so their current values were imported instead of the formulas.`)
  return { data: out, notes }
}

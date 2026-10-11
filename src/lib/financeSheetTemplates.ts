// Finance Sheets: starting points. Each template is ordinary sheet data with
// real formulas, so people can see how it works and change it.

import { emptyWorkbook, refKey } from './sheetModel'
import type { Cell, NumberFormat, Sheet, WorkbookData } from './sheetModel'

const put = (cells: Record<string, Cell>, row: number, col: number, v: string | number, extra: Partial<Cell> = {}) => {
  cells[refKey(row, col)] = { v: String(v), ...extra }
}

export type TemplateId = 'blank' | 'budget' | 'loan'

export const TEMPLATES: { id: TemplateId; title: string; blurb: string }[] = [
  { id: 'blank', title: 'Blank workbook', blurb: 'An empty grid.' },
  { id: 'budget', title: 'Budget vs actual', blurb: 'Variance and percent used, with totals.' },
  { id: 'loan', title: 'Loan repayment schedule', blurb: 'Monthly payment, interest and balance using PMT.' },
]

function budget(): Sheet {
  const cells: Record<string, Cell> = {}
  const heads = ['Category', 'Budget', 'Actual', 'Variance', '% used']
  heads.forEach((h, i) => put(cells, 1, i + 1, h, { b: 1, ...(i > 0 ? { al: 'r' as const } : {}) }))
  const rows: [string, number, number][] = [
    ['Fuel', 1200000, 1015000],
    ['Salaries', 4500000, 4500000],
    ['Insurance', 600000, 480000],
    ['Marketing', 900000, 1100000],
    ['Maintenance', 750000, 620000],
  ]
  rows.forEach(([name, b, a], i) => {
    const r = i + 2
    put(cells, r, 1, name)
    put(cells, r, 2, b, { nf: 'ngn' })
    put(cells, r, 3, a, { nf: 'ngn' })
    put(cells, r, 4, `=B${r}-C${r}`, { nf: 'ngn' })
    put(cells, r, 5, `=IF(B${r}=0,0,C${r}/B${r})`, { nf: 'pct' })
  })
  const t = rows.length + 2
  put(cells, t, 1, 'Total', { b: 1 })
  ;(['B', 'C', 'D'] as const).forEach((c, i) => put(cells, t, i + 2, `=SUM(${c}2:${c}${t - 1})`, { b: 1, nf: 'ngn' }))
  put(cells, t, 5, `=IF(B${t}=0,0,C${t}/B${t})`, { b: 1, nf: 'pct' })
  return { name: 'Budget', cells, widths: { '1': 160, '2': 130, '3': 130, '4': 130, '5': 100 } }
}

function loan(): Sheet {
  const cells: Record<string, Cell> = {}
  put(cells, 1, 1, 'Loan amount', { b: 1 }); put(cells, 1, 2, 5000000, { nf: 'ngn' })
  put(cells, 2, 1, 'Annual interest rate', { b: 1 }); put(cells, 2, 2, 0.24, { nf: 'pct' })
  put(cells, 3, 1, 'Term (months)', { b: 1 }); put(cells, 3, 2, 24)
  put(cells, 4, 1, 'Monthly payment', { b: 1 }); put(cells, 4, 2, '=-PMT(B2/12,B3,B1)', { nf: 'ngn', b: 1 })
  put(cells, 5, 1, 'Total interest', { b: 1 }); put(cells, 5, 2, '=B4*B3-B1', { nf: 'ngn' })
  ;['Month', 'Opening balance', 'Interest', 'Principal', 'Closing balance'].forEach((h, i) => put(cells, 7, i + 1, h, { b: 1, ...(i > 0 ? { al: 'r' as const } : {}) }))
  const money: NumberFormat = 'ngn'
  for (let r = 8; r < 8 + 60; r += 1) {
    put(cells, r, 1, `=IF(ROW()-7<=$B$3,ROW()-7,"")`)
    put(cells, r, 2, r === 8 ? `=IF(A8="","",$B$1)` : `=IF(A${r}="","",E${r - 1})`, { nf: money })
    put(cells, r, 3, `=IF(A${r}="","",B${r}*$B$2/12)`, { nf: money })
    put(cells, r, 4, `=IF(A${r}="","",$B$4-C${r})`, { nf: money })
    put(cells, r, 5, `=IF(A${r}="","",B${r}-D${r})`, { nf: money })
  }
  return { name: 'Schedule', cells, widths: { '1': 170, '2': 140, '3': 120, '4': 120, '5': 140 } }
}

export function buildTemplate(id: TemplateId): WorkbookData {
  if (id === 'budget') return { sheets: [budget()] }
  if (id === 'loan') return { sheets: [loan()] }
  return emptyWorkbook()
}

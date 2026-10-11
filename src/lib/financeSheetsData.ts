// Finance Sheets: pulls live Finance records into a sheet as a snapshot.
// It is a snapshot on purpose: the sheet is a place to analyse, so numbers do
// not shift under a formula while someone is working. Pull again for fresh data.

import { supabase } from './supabase'
import { MAX_ROWS, sheetFromRows } from './sheetModel'
import type { NumberFormat, Sheet } from './sheetModel'

type Source = {
  key: string
  label: string
  sheetName: string
  table: string
  select: string
  order: string
  columns: { head: string; get: (r: Record<string, unknown>) => unknown; nf?: NumberFormat }[]
}

const f = (key: string) => (r: Record<string, unknown>) => r[key]
const nested = (outer: string, inner: string) => (r: Record<string, unknown>) => {
  const o = r[outer] as Record<string, unknown> | Record<string, unknown>[] | null | undefined
  const one = Array.isArray(o) ? o[0] : o
  return one ? one[inner] : ''
}

export const FINANCE_SOURCES: Source[] = [
  {
    key: 'invoices', label: 'Customer invoices', sheetName: 'Invoices', table: 'finance_invoices', order: 'issue_date',
    select: 'invoice_number,customer_name,issue_date,due_date,total_amount,amount_paid,balance_due,status',
    columns: [
      { head: 'Invoice', get: f('invoice_number') }, { head: 'Customer', get: f('customer_name') },
      { head: 'Issued', get: f('issue_date'), nf: 'date' }, { head: 'Due', get: f('due_date'), nf: 'date' },
      { head: 'Total', get: f('total_amount'), nf: 'ngn' }, { head: 'Paid', get: f('amount_paid'), nf: 'ngn' },
      { head: 'Balance', get: f('balance_due'), nf: 'ngn' }, { head: 'Status', get: f('status') },
    ],
  },
  {
    key: 'bills', label: 'Vendor bills', sheetName: 'Bills', table: 'finance_bills', order: 'bill_date',
    select: 'bill_number,vendor_name,bill_date,due_date,total_amount,amount_paid,balance_due,status',
    columns: [
      { head: 'Bill', get: f('bill_number') }, { head: 'Vendor', get: f('vendor_name') },
      { head: 'Billed', get: f('bill_date'), nf: 'date' }, { head: 'Due', get: f('due_date'), nf: 'date' },
      { head: 'Total', get: f('total_amount'), nf: 'ngn' }, { head: 'Paid', get: f('amount_paid'), nf: 'ngn' },
      { head: 'Balance', get: f('balance_due'), nf: 'ngn' }, { head: 'Status', get: f('status') },
    ],
  },
  {
    key: 'expenses', label: 'Expenses', sheetName: 'Expenses', table: 'finance_expenses', order: 'expense_date',
    select: 'description,category,expense_date,amount,payment_method,status',
    columns: [
      { head: 'Description', get: f('description') }, { head: 'Category', get: f('category') },
      { head: 'Date', get: f('expense_date'), nf: 'date' }, { head: 'Amount', get: f('amount'), nf: 'ngn' },
      { head: 'Paid by', get: f('payment_method') }, { head: 'Status', get: f('status') },
    ],
  },
  {
    key: 'budgets', label: 'Budgets', sheetName: 'Budgets', table: 'finance_budgets', order: 'fiscal_year',
    select: 'name,fiscal_year,department,category,amount,status',
    columns: [
      { head: 'Budget', get: f('name') }, { head: 'Year', get: f('fiscal_year') }, { head: 'Department', get: f('department') },
      { head: 'Category', get: f('category') }, { head: 'Amount', get: f('amount'), nf: 'ngn' }, { head: 'Status', get: f('status') },
    ],
  },
  {
    key: 'assets', label: 'Fixed assets', sheetName: 'Assets', table: 'finance_assets', order: 'asset_code',
    select: 'asset_code,name,category,purchase_date,cost,useful_life_months,status',
    columns: [
      { head: 'Code', get: f('asset_code') }, { head: 'Asset', get: f('name') }, { head: 'Category', get: f('category') },
      { head: 'Purchased', get: f('purchase_date'), nf: 'date' }, { head: 'Cost', get: f('cost'), nf: 'ngn' },
      { head: 'Life (months)', get: f('useful_life_months') }, { head: 'Status', get: f('status') },
    ],
  },
  {
    key: 'bank', label: 'Bank transactions', sheetName: 'Bank', table: 'finance_bank_transactions', order: 'transaction_date',
    select: 'transaction_date,description,reference,debit,credit,balance,category,department,transaction_type,reconciliation_status',
    columns: [
      { head: 'Date', get: f('transaction_date'), nf: 'date' }, { head: 'Description', get: f('description') }, { head: 'Reference', get: f('reference') },
      { head: 'Debit', get: f('debit'), nf: 'ngn' }, { head: 'Credit', get: f('credit'), nf: 'ngn' }, { head: 'Balance', get: f('balance'), nf: 'ngn' },
      { head: 'Category', get: f('category') }, { head: 'Department', get: f('department') }, { head: 'Type', get: f('transaction_type') },
      { head: 'Reconciliation', get: f('reconciliation_status') },
    ],
  },
  {
    key: 'journals', label: 'Journal lines', sheetName: 'Journals', table: 'finance_journal_lines', order: 'created_at',
    select: 'description,debit,credit,finance_journals(journal_number,journal_date,status),finance_accounts(code,name)',
    columns: [
      { head: 'Journal', get: nested('finance_journals', 'journal_number') }, { head: 'Date', get: nested('finance_journals', 'journal_date'), nf: 'date' },
      { head: 'Status', get: nested('finance_journals', 'status') }, { head: 'Account', get: nested('finance_accounts', 'code') },
      { head: 'Account name', get: nested('finance_accounts', 'name') }, { head: 'Narration', get: f('description') },
      { head: 'Debit', get: f('debit'), nf: 'ngn' }, { head: 'Credit', get: f('credit'), nf: 'ngn' },
    ],
  },
]

export async function loadFinanceSheet(key: string): Promise<{ sheet: Sheet; rows: number; truncated: boolean }> {
  const source = FINANCE_SOURCES.find(s => s.key === key)
  if (!source) throw new Error('Unknown finance table.')
  if (!supabase) throw new Error('Supabase is not configured.')
  const limit = MAX_ROWS - 1
  const { data, error } = await supabase
    .from(source.table)
    .select(source.select)
    .order(source.order, { ascending: false })
    .limit(limit + 1)
  if (error) throw new Error(error.message)
  const list = ((data ?? []) as unknown as Record<string, unknown>[])
  const truncated = list.length > limit
  const rows = list.slice(0, limit)
  const table: (string | number | null)[][] = [source.columns.map(c => c.head)]
  for (const r of rows) {
    table.push(source.columns.map(c => {
      const v = c.get(r)
      return v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v)
    }))
  }
  const sheet = sheetFromRows(source.sheetName, table, { header: true })
  // Money and date columns get their format on every data row, even when a value is blank.
  source.columns.forEach((c, i) => {
    if (!c.nf) return
    for (let r = 2; r <= rows.length + 1; r += 1) {
      const key2 = `${String.fromCharCode(65 + i)}${r}`
      const cell = sheet.cells[key2]
      if (cell && typeof cell === 'object') cell.nf = c.nf
    }
  })
  return { sheet, rows: rows.length, truncated }
}

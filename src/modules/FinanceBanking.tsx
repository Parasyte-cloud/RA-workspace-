import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Download, ExternalLink, FileSpreadsheet, FileText, Landmark, RefreshCw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import ControlledDownloadButton from '../components/ControlledDownloadButton'

type BankTransaction = {
  id?: string
  transaction_date: string
  value_date?: string | null
  description: string
  reference?: string | null
  debit: number
  credit: number
  balance?: number | null
  category: string
  department?: string | null
  vendor?: string | null
  transaction_type: 'expense' | 'income' | 'transfer' | 'refund' | 'bank_charge' | 'payroll' | 'other'
  reconciliation_status: 'unreconciled' | 'review' | 'reconciled'
  source_hash: string
  created_at?: string
}

const PROVIDUS_URL = 'https://ibank.providusbank.com/provipay#/login'
const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
const money = (value: number) => NGN.format(value || 0)

const textOf = (value: unknown) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && value && 'text' in value) return String((value as { text?: unknown }).text ?? '')
  if (typeof value === 'object' && value && 'result' in value) return String((value as { result?: unknown }).result ?? '')
  return String(value)
}

const toAmount = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = textOf(value).replace(/[₦NGN,\s]/gi, '').replace(/\(([^)]+)\)/, '-$1')
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.abs(n) : 0
}

const toDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const raw = textOf(value).trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (match) {
    const [, d, m, y] = match
    const year = y.length === 2 ? `20${y}` : y
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return raw
}

const normaliseHeader = (value: unknown) => textOf(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const pickIndex = (headers: string[], aliases: string[]) => {
  for (const alias of aliases) {
    const exact = headers.findIndex(h => h === alias)
    if (exact >= 0) return exact
  }
  for (const alias of aliases) {
    const partial = headers.findIndex(h => h.includes(alias))
    if (partial >= 0) return partial
  }
  return -1
}

const categorise = (description: string, debit: number, credit: number) => {
  const d = description.toLowerCase()
  if (credit > 0 && debit === 0) return { category: 'Revenue / Inflow', type: 'income' as const }
  if (/providus|transfer fee|stamp duty|vat on fee|charge|commission/.test(d)) return { category: 'Bank Charges', type: 'bank_charge' as const }
  if (/salary|payroll|wage|staff/.test(d)) return { category: 'Payroll', type: 'payroll' as const }
  if (/aws|amazon web|vercel|cloudflare|github|zoho|google workspace|microsoft|software|hosting/.test(d)) return { category: 'Technology & Software', type: 'expense' as const }
  if (/meta|facebook|instagram|google ads|advert|marketing|promotion/.test(d)) return { category: 'Marketing', type: 'expense' as const }
  if (/fuel|petrol|diesel|vehicle|mechanic|maintenance|tyre|tire|car wash/.test(d)) return { category: 'Fleet & Operations', type: 'expense' as const }
  if (/tax|vat|wht|firs|lirs/.test(d)) return { category: 'Tax & Statutory', type: 'expense' as const }
  if (/refund/.test(d)) return { category: 'Refunds', type: 'refund' as const }
  if (/transfer/.test(d) && debit > 0) return { category: 'Transfers', type: 'transfer' as const }
  return { category: debit > 0 ? 'Uncategorised Expense' : 'Other Income', type: debit > 0 ? 'expense' as const : 'income' as const }
}

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const csvRows = (text: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else cell += char
  }
  row.push(cell)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  return rows
}

async function parseStatement(file: File): Promise<BankTransaction[]> {
  let rows: unknown[][] = []
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.csv')) {
    rows = csvRows(await file.text())
  } else if (lower.endsWith('.xlsx')) {
    const {
      default: ExcelJS
    } = await import('exceljs')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('The Excel file does not contain a worksheet.')
    sheet.eachRow({ includeEmpty: false }, row => {
      rows.push((row.values as unknown[]).slice(1))
    })
  } else {
    throw new Error('Upload a Providus CSV or XLSX statement. PDF import is not enabled yet.')
  }

  if (rows.length < 2) throw new Error('No transaction rows were found in this statement.')

  let headerRow = -1
  let indexes: Record<string, number> = {}
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const h = rows[i].map(normaliseHeader)
    const date = pickIndex(h, ['transaction date', 'date', 'tran date', 'posting date'])
    const description = pickIndex(h, ['description', 'narration', 'transaction details', 'details', 'remarks'])
    const debit = pickIndex(h, ['debit', 'debit amount', 'withdrawal', 'withdrawals'])
    const credit = pickIndex(h, ['credit', 'credit amount', 'deposit', 'deposits'])
    const amount = pickIndex(h, ['amount', 'transaction amount'])
    if (date >= 0 && description >= 0 && (debit >= 0 || credit >= 0 || amount >= 0)) {
      headerRow = i
      indexes = {
        date,
        valueDate: pickIndex(h, ['value date']),
        description,
        reference: pickIndex(h, ['reference', 'transaction reference', 'ref', 'session id']),
        debit,
        credit,
        amount,
        type: pickIndex(h, ['type', 'transaction type', 'dr cr', 'debit credit']),
        balance: pickIndex(h, ['balance', 'running balance', 'closing balance']),
      }
      break
    }
  }

  if (headerRow < 0) throw new Error('Could not recognise the statement columns. Export the Providus statement as CSV or XLSX with date, narration/description and amount columns.')

  const output: BankTransaction[] = []
  for (const row of rows.slice(headerRow + 1)) {
    const transactionDate = indexes.date >= 0 ? toDate(row[indexes.date]) : ''
    const description = indexes.description >= 0 ? textOf(row[indexes.description]).trim() : ''
    if (!transactionDate || !description) continue

    let debit = indexes.debit >= 0 ? toAmount(row[indexes.debit]) : 0
    let credit = indexes.credit >= 0 ? toAmount(row[indexes.credit]) : 0
    if (!debit && !credit && indexes.amount >= 0) {
      const raw = textOf(row[indexes.amount]).replace(/[₦NGN,\s]/gi, '')
      const amount = Number(raw)
      const typeValue = indexes.type >= 0 ? textOf(row[indexes.type]).toLowerCase() : ''
      if (Number.isFinite(amount)) {
        if (amount < 0 || /debit|dr|withdraw/.test(typeValue)) debit = Math.abs(amount)
        else credit = Math.abs(amount)
      }
    }
    if (!debit && !credit) continue

    const reference = indexes.reference >= 0 ? textOf(row[indexes.reference]).trim() : ''
    const balance = indexes.balance >= 0 ? toAmount(row[indexes.balance]) : 0
    const auto = categorise(description, debit, credit)
    const sourceHash = await sha256([transactionDate, reference, description, debit, credit, balance].join('|').toLowerCase())

    output.push({
      transaction_date: transactionDate,
      value_date: indexes.valueDate >= 0 ? toDate(row[indexes.valueDate]) || null : null,
      description,
      reference: reference || null,
      debit,
      credit,
      balance: balance || null,
      category: auto.category,
      transaction_type: auto.type,
      reconciliation_status: 'unreconciled',
      source_hash: sourceHash,
    })
  }
  return output
}

export function FinanceBanking() {
  const [rows, setRows] = useState<BankTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<'all' | 'expense' | 'income' | 'unreconciled'>('all')
  const [query, setQuery] = useState('')

  const load = async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('finance_bank_transactions')
      .select('*')
      .eq('bank_name', 'Providus Bank')
      .order('transaction_date', { ascending: false })
      .limit(2000)
    if (loadError) setError(loadError.message)
    else setRows((data || []) as BankTransaction[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(row => {
      if (filter === 'expense' && row.debit <= 0) return false
      if (filter === 'income' && row.credit <= 0) return false
      if (filter === 'unreconciled' && row.reconciliation_status === 'reconciled') return false
      if (!q) return true
      return [row.description, row.reference, row.category, row.department, row.vendor]
        .some(value => String(value ?? '').toLowerCase().includes(q))
    })
  }, [rows, filter, query])

  const totals = useMemo(() => ({
    debit: visible.reduce((sum, row) => sum + Number(row.debit || 0), 0),
    credit: visible.reduce((sum, row) => sum + Number(row.credit || 0), 0),
    unreconciled: visible.filter(row => row.reconciliation_status !== 'reconciled').length,
  }), [visible])

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !supabase) return
    setImporting(true)
    setError('')
    setNotice('')
    try {
      const parsed = await parseStatement(file)
      if (!parsed.length) throw new Error('No valid transactions were found.')
      const { data: userData } = await supabase.auth.getUser()
      const { data: batch, error: batchError } = await supabase
        .from('finance_bank_imports')
        .insert({
          bank_name: 'Providus Bank',
          file_name: file.name,
          imported_by: userData.user?.id ?? null,
          transaction_count: parsed.length,
          debit_total: parsed.reduce((sum, row) => sum + row.debit, 0),
          credit_total: parsed.reduce((sum, row) => sum + row.credit, 0),
        })
        .select('id')
        .single()
      if (batchError) throw batchError

      const payload = parsed.map(row => ({ ...row, bank_name: 'Providus Bank', import_id: batch.id }))
      const { error: insertError } = await supabase
        .from('finance_bank_transactions')
        .upsert(payload, { onConflict: 'source_hash', ignoreDuplicates: true })
      if (insertError) throw insertError
      setNotice(`Imported ${parsed.length} transaction${parsed.length === 1 ? '' : 's'} from ${file.name}. Existing duplicates were skipped.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Statement import failed.')
    } finally {
      setImporting(false)
    }
  }

  const updateRow = async (id: string | undefined, patch: Partial<BankTransaction>) => {
    if (!supabase || !id) return
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row))
    const { error: updateError } = await supabase.from('finance_bank_transactions').update(patch).eq('id', id)
    if (updateError) { setError(updateError.message); await load() }
  }

  const exportExcel = async () => {
    const {
      default: ExcelJS
    } = await import('exceljs')

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'RideArrivo Limited'
    workbook.created = new Date()

    const summary = workbook.addWorksheet('Executive Summary')
    summary.views = [{ showGridLines: false }]
    summary.mergeCells('A1:D1')
    summary.getCell('A1').value = 'RIDEARRIVO LIMITED - PROVIDUS BANK REPORT'
    summary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
    summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12123B' } }
    summary.getCell('A1').alignment = { horizontal: 'left' }
    summary.addRow([])
    summary.addRow(['Generated', new Date().toLocaleString('en-NG')])
    summary.addRow(['Transactions', visible.length])
    summary.addRow(['Total Expenses / Debits', totals.debit])
    summary.addRow(['Total Income / Credits', totals.credit])
    summary.addRow(['Net Cash Movement', totals.credit - totals.debit])
    summary.addRow(['Unreconciled', totals.unreconciled])
    for (const row of [5, 6, 7]) summary.getCell(`B${row}`).numFmt = '₦#,##0.00;[Red](₦#,##0.00);-'
    summary.columns = [{ width: 28 }, { width: 24 }, { width: 16 }, { width: 16 }]

    const addTransactionSheet = (name: string, data: BankTransaction[]) => {
      const sheet = workbook.addWorksheet(name)
      sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }]
      sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Description', key: 'description', width: 45 },
        { header: 'Reference', key: 'reference', width: 24 },
        { header: 'Debit (NGN)', key: 'debit', width: 16 },
        { header: 'Credit (NGN)', key: 'credit', width: 16 },
        { header: 'Balance (NGN)', key: 'balance', width: 16 },
        { header: 'Category', key: 'category', width: 24 },
        { header: 'Department', key: 'department', width: 20 },
        { header: 'Vendor', key: 'vendor', width: 24 },
        { header: 'Type', key: 'type', width: 16 },
        { header: 'Reconciliation', key: 'status', width: 18 },
      ]
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12123B' } }
      for (const row of data) {
        sheet.addRow({
          date: row.transaction_date,
          description: row.description,
          reference: row.reference || '',
          debit: row.debit || 0,
          credit: row.credit || 0,
          balance: row.balance || 0,
          category: row.category,
          department: row.department || '',
          vendor: row.vendor || '',
          type: row.transaction_type,
          status: row.reconciliation_status,
        })
      }
      for (const col of ['D', 'E', 'F']) {
        sheet.getColumn(col).numFmt = '₦#,##0.00;[Red](₦#,##0.00);-'
      }
      sheet.autoFilter = { from: 'A1', to: 'K1' }
    }

    addTransactionSheet('All Transactions', visible)
    addTransactionSheet('Expenses', visible.filter(row => row.debit > 0))
    addTransactionSheet('Income', visible.filter(row => row.credit > 0))

    const byCategory = new Map<string, number>()
    visible.filter(row => row.debit > 0).forEach(row => byCategory.set(row.category, (byCategory.get(row.category) || 0) + row.debit))
    const categorySheet = workbook.addWorksheet('Category Summary')
    categorySheet.columns = [{ header: 'Category', key: 'category', width: 32 }, { header: 'Expense (NGN)', key: 'amount', width: 20 }]
    categorySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    categorySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12123B' } }
    Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).forEach(([category, amount]) => categorySheet.addRow({ category, amount }))
    categorySheet.getColumn('B').numFmt = '₦#,##0.00;[Red](₦#,##0.00);-'

    const buffer = await workbook.xlsx.writeBuffer()
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `RideArrivo_Providus_Report_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const exportWord = async () => {
    const {
      AlignmentType,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    } = await import('docx')

    const rowsForDoc = visible.slice(0, 500)
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: ['Date', 'Description', 'Debit', 'Credit', 'Category', 'Status'].map(v => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, bold: true })] })] })) }),
        ...rowsForDoc.map(row => new TableRow({ children: [
          row.transaction_date,
          row.description,
          row.debit ? money(row.debit) : '-',
          row.credit ? money(row.credit) : '-',
          row.category,
          row.reconciliation_status,
        ].map(v => new TableCell({ children: [new Paragraph(String(v))] })) })),
      ],
    })

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'RIDEARRIVO LIMITED', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
          new Paragraph({ text: 'Providus Bank Transaction & Expense Report', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
          new Paragraph(`Generated: ${new Date().toLocaleString('en-NG')}`),
          new Paragraph(''),
          new Paragraph({ children: [new TextRun({ text: `Total Expenses / Debits: ${money(totals.debit)}`, bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: `Total Income / Credits: ${money(totals.credit)}`, bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: `Net Cash Movement: ${money(totals.credit - totals.debit)}`, bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: `Unreconciled Transactions: ${totals.unreconciled}`, bold: true })] }),
          new Paragraph(''),
          new Paragraph({ text: 'Transaction Register', heading: HeadingLevel.HEADING_2 }),
          table,
          ...(visible.length > 500 ? [new Paragraph(`Note: the Word report includes the first 500 filtered transactions. The Excel export contains the full filtered dataset.`)] : []),
        ],
      }],
    })
    downloadBlob(await Packer.toBlob(doc), `RideArrivo_Providus_Report_${new Date().toISOString().slice(0, 10)}.docx`)
  }

  return <div className="bankingModule">
    <div className="bankingHero glassCard">
      <div>
        <span className="eyebrow">PROVIDUS BANKING</span>
        <h3>Bank Transactions & Reconciliation</h3>
        <p>Import Providus statements now. When API access is approved, the same ledger can be fed automatically without changing the Finance workflow.</p>
      </div>
      <div className="bankingHeroActions">
        <button className="glassButton" onClick={() => { window.location.href = PROVIDUS_URL }}><ExternalLink size={16}/>Providus Login</button>
        <label className="primaryButton fileButton"><Upload size={16}/>{importing ? 'Importing...' : 'Upload Statement'}<input type="file" accept=".csv,.xlsx" disabled={importing} onChange={importFile}/></label>
      </div>
    </div>

    <div className="stats">
      <div className="metric glassCard"><div className="metricIcon"><Landmark/></div><div><span>Transactions</span><strong>{visible.length}</strong><small>Current filtered view</small></div></div>
      <div className="metric glassCard"><div className="metricIcon"><FileText/></div><div><span>Expenses</span><strong>{money(totals.debit)}</strong><small>Providus debits</small></div></div>
      <div className="metric glassCard"><div className="metricIcon"><Download/></div><div><span>Income</span><strong>{money(totals.credit)}</strong><small>Providus credits</small></div></div>
      <div className="metric glassCard"><div className="metricIcon"><RefreshCw/></div><div><span>Unreconciled</span><strong>{totals.unreconciled}</strong><small>Needs Finance review</small></div></div>
    </div>

    {error && <div className="moduleError">{error}</div>}
    {notice && <div className="mailNotice">{notice}</div>}

    <div className="bankingToolbar glassCard">
      <div className="bankingFilters">
        {(['all', 'expense', 'income', 'unreconciled'] as const).map(v => <button key={v} className={filter === v ? 'active' : ''} onClick={() => setFilter(v)}>{v === 'all' ? 'All' : v === 'expense' ? 'Expenses' : v === 'income' ? 'Income' : 'Unreconciled'}</button>)}
      </div>
      <input className="bankingSearch" placeholder="Search description, reference, category..." value={query} onChange={e => setQuery(e.target.value)}/>
      <div className="buttonRow">
        <button className="glassButton" onClick={() => void load()}><RefreshCw size={15}/>Refresh</button>
        {visible.length>0&&<>
          <ControlledDownloadButton compact resource={{resourceType:'finance_export',resourceKey:'providus-excel',resourceName:'Providus transaction report (Excel)'}} onGranted={exportExcel} label="Excel"/>
          <ControlledDownloadButton compact resource={{resourceType:'finance_export',resourceKey:'providus-word',resourceName:'Providus transaction report (Word)'}} onGranted={exportWord} label="Word"/>
        </>}
      </div>
    </div>

    <div className="glassCard moduleTableWrap bankingTableWrap">
      <table className="moduleTable bankingTable">
        <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Category</th><th>Department</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={8}>Loading Providus transactions...</td></tr> : visible.length === 0 ? <tr><td colSpan={8}>No Providus transactions yet. Upload a CSV or XLSX statement to begin.</td></tr> : visible.map(row => <tr key={row.id || row.source_hash}>
            <td>{row.transaction_date}</td>
            <td><strong>{row.description}</strong>{row.vendor && <small className="bankingSub">{row.vendor}</small>}</td>
            <td>{row.reference || '—'}</td>
            <td>{row.debit ? money(row.debit) : '—'}</td>
            <td>{row.credit ? money(row.credit) : '—'}</td>
            <td><input className="bankingCellInput" value={row.category} onChange={e => setRows(current => current.map(r => r.id === row.id ? { ...r, category: e.target.value } : r))} onBlur={e => void updateRow(row.id, { category: e.target.value })}/></td>
            <td><input className="bankingCellInput" value={row.department || ''} placeholder="Assign" onChange={e => setRows(current => current.map(r => r.id === row.id ? { ...r, department: e.target.value } : r))} onBlur={e => void updateRow(row.id, { department: e.target.value || null })}/></td>
            <td><select className="bankingCellInput" value={row.reconciliation_status} onChange={e => void updateRow(row.id, { reconciliation_status: e.target.value as BankTransaction['reconciliation_status'] })}><option value="unreconciled">Unreconciled</option><option value="review">Review</option><option value="reconciled">Reconciled</option></select></td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <div className="bankingApiNote glassCard">
      <Landmark size={20}/><div><strong>Providus API sync</strong><p>Manual statement import is active. Automatic balance, statement and transaction sync can be connected to this same ledger when Providus issues your corporate API credentials.</p></div>
    </div>
  </div>
}

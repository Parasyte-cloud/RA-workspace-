import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Archive, ArchiveRestore, FileSpreadsheet, Loader2, Plus, RefreshCw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TEMPLATES, buildTemplate } from '../lib/financeSheetTemplates'
import type { TemplateId } from '../lib/financeSheetTemplates'
import { parseCsv, sanitizeWorkbook, sheetFromRows, uniqueSheetName } from '../lib/sheetModel'
import type { WorkbookData } from '../lib/sheetModel'
import '../finance-sheets.css'

// The editor and the formula engine are only needed once a workbook is opened.
const SheetEditor = lazy(() => import('./SheetEditor'))

type Row = { id: string; title: string; updated_at: string; archived: boolean; updated_by: string | null }
type Open = { id: string; title: string; version: number; data: WorkbookData }

const when = (iso: string) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

export function FinanceSheets() {
  const [rows, setRows] = useState<Row[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Open | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState('')
  const [creating, setCreating] = useState(false)
  const file = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return }
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('finance_sheets')
      .select('id,title,updated_at,archived,updated_by')
      .order('updated_at', { ascending: false })
      .limit(300)
    if (err) { setError(err.message); setLoading(false); return }
    const list = (data ?? []) as Row[]
    setRows(list)
    setLoading(false)
    const ids = [...new Set(list.map(r => r.updated_by).filter((v): v is string => !!v))]
    if (ids.length) {
      const { data: people } = await supabase.from('employee_profiles').select('id,full_name').in('id', ids)
      if (people) setNames(Object.fromEntries((people as { id: string; full_name: string }[]).map(p => [p.id, p.full_name])))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openById = useCallback(async (id: string) => {
    if (!supabase) return
    setBusy('Opening workbook...')
    setOpen(null)
    const { data, error: err } = await supabase.from('finance_sheets').select('id,title,version,data').eq('id', id).maybeSingle()
    setBusy('')
    if (err || !data) { setError(err?.message ?? 'That workbook could not be opened.'); return }
    const r = data as { id: string; title: string; version: number; data: unknown }
    setOpen({ id: r.id, title: r.title, version: r.version, data: sanitizeWorkbook(r.data) })
  }, [])

  const create = async (title: string, data: WorkbookData) => {
    if (!supabase) return
    setBusy('Creating workbook...')
    const { data: made, error: err } = await supabase.from('finance_sheets').insert({ title, data }).select('id').single()
    setBusy('')
    setCreating(false)
    if (err || !made) {
      setError(err?.code === '42501' ? 'Only Finance and Admin can create workbooks.' : `Could not create the workbook: ${err?.message ?? 'unknown error'}`)
      return
    }
    await load()
    await openById((made as { id: string }).id)
  }

  const setArchived = async (row: Row, archived: boolean) => {
    if (!supabase) return
    if (archived && !window.confirm(`Archive "${row.title}"? It leaves this list but is not deleted, and Finance or Admin can restore it.`)) return
    const { error: err } = await supabase.from('finance_sheets').update({ archived }).eq('id', row.id)
    if (err) { setError(`Could not update the workbook: ${err.message}`); return }
    await load()
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(`Reading ${f.name}...`)
    try {
      if (f.size > 12 * 1024 * 1024) throw new Error('That file is larger than 12 MB.')
      const lower = f.name.toLowerCase()
      const base = f.name.replace(/\.(xlsx|csv)$/i, '').slice(0, 100) || 'Imported workbook'
      let data: WorkbookData
      if (lower.endsWith('.xlsx')) {
        const { xlsxToWorkbook } = await import('../lib/sheetExcel')
        data = (await xlsxToWorkbook(await f.arrayBuffer())).data
      } else if (lower.endsWith('.csv')) {
        data = { sheets: [sheetFromRows(uniqueSheetName({ sheets: [] }, base), parseCsv(await f.text()), { header: true })] }
      } else throw new Error('Choose an .xlsx or .csv file.')
      setBusy('')
      await create(base, data)
    } catch (err) {
      setBusy('')
      setError(`Could not import: ${(err as Error).message}`)
    }
  }

  if (open) {
    return (
      <Suspense fallback={<div className="glassCard fs-loading"><Loader2 size={18} className="fs-spin" />Loading the spreadsheet...</div>}>
        <SheetEditor
          key={`${open.id}:${open.version}`}
          id={open.id}
          initialTitle={open.title}
          initialVersion={open.version}
          initialData={open.data}
          onBack={() => { setOpen(null); void load() }}
          onTitle={() => undefined}
          onOpen={id => { void openById(id) }}
        />
      </Suspense>
    )
  }

  const shown = rows.filter(r => r.archived === showArchived)

  return (
    <div className="fs-list">
      <div className="fs-listhead">
        <div>
          <h3>Sheets</h3>
          <p>Excel-style workbooks for Finance. Formulas, several sheets per workbook, live Finance data, and Excel import and export. Visible to Finance and Admin only.</p>
        </div>
        <div className="fs-listactions">
          <button className="glassButton" onClick={() => void load()}><RefreshCw size={15} />Refresh</button>
          <button className="glassButton" onClick={() => file.current?.click()}><Upload size={15} />Import Excel or CSV</button>
          <input ref={file} type="file" accept=".xlsx,.csv" hidden onChange={e => void importFile(e)} />
          <button className="primaryButton" onClick={() => setCreating(v => !v)}><Plus size={15} />New workbook</button>
        </div>
      </div>

      {error && <div className="moduleError" role="alert">{error}</div>}

      {creating && (
        <div className="fs-templates">
          {TEMPLATES.map(t => (
            <button key={t.id} className="glassCard fs-template" onClick={() => void create(t.id === 'blank' ? 'Untitled workbook' : t.title, buildTemplate(t.id as TemplateId))}>
              <FileSpreadsheet size={20} />
              <strong>{t.title}</strong>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>
      )}

      <div className="fs-listtabs">
        <button className={!showArchived ? 'on' : ''} onClick={() => setShowArchived(false)}>Active</button>
        <button className={showArchived ? 'on' : ''} onClick={() => setShowArchived(true)}>Archived</button>
      </div>

      <div className="glassCard moduleTableWrap">
        <table className="moduleTable">
          <thead><tr><th>Workbook</th><th>Last saved</th><th>By</th><th /></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4}>Loading...</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={4}>{showArchived ? 'Nothing archived.' : 'No workbooks yet. Start with New workbook or import an Excel file.'}</td></tr>}
            {shown.map(r => (
              <tr key={r.id}>
                <td><button className="fs-link" onClick={() => void openById(r.id)}><FileSpreadsheet size={15} />{r.title}</button></td>
                <td>{when(r.updated_at)}</td>
                <td>{r.updated_by ? names[r.updated_by] ?? '' : ''}</td>
                <td className="fs-rowaction">
                  <button className="workbenchEditButton" onClick={() => void setArchived(r, !r.archived)}>
                    {r.archived ? <><ArchiveRestore size={13} />Restore</> : <><Archive size={13} />Archive</>}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {busy && <div className="fs-busy" role="status"><Loader2 size={18} className="fs-spin" />{busy}</div>}
    </div>
  )
}

export default FinanceSheets

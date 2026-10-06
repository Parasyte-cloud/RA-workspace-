import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'

import {
  downloadExport,
  exportHistory,
  listExports,
} from '../lib/operationsExports'
import type { ExportDataset, ExportHistoryRow } from '../lib/operationsExports'
import '../operations-exports.css'

// Calendar days in Lagos, as YYYY-MM-DD. The backend reads the dates the same
// way, so "today" here and "today" in the file always agree.
function lagosToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date())
}
function shiftDays(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
function monthStart(day: string, back = 0) {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - back, 1, 12)).toISOString().slice(0, 10)
}
function monthEnd(day: string, back = 0) {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - back, 0, 12)).toISOString().slice(0, 10)
}

const PRESETS: { label: string; range: (today: string) => { from: string; to: string } }[] = [
  { label: 'All time', range: () => ({ from: '', to: '' }) },
  { label: 'Last 7 days', range: (t) => ({ from: shiftDays(t, -6), to: t }) },
  { label: 'Last 30 days', range: (t) => ({ from: shiftDays(t, -29), to: t }) },
  { label: 'This month', range: (t) => ({ from: monthStart(t), to: t }) },
  { label: 'Last month', range: (t) => ({ from: monthStart(t, 1), to: monthEnd(t, 1) }) },
]

type Status = { busy?: boolean; message?: string; error?: boolean }

export default function OperationsExportsCard() {
  const [datasets, setDatasets] = useState<ExportDataset[]>([])
  const [maxRows, setMaxRows] = useState(100000)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [history, setHistory] = useState<ExportHistoryRow[] | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await exportHistory())
    } catch {
      // Only administrators can read the history; everyone else just does not see it.
      setHistory(null)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await listExports()
      setDatasets(result.datasets)
      setMaxRows(result.maxRows)
      // The list only includes admin-only files for administrators, so it
      // tells us whether to ask for the history.
      if (result.datasets.some((d) => d.adminOnly)) void loadHistory()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load the exports.')
    } finally {
      setLoading(false)
    }
  }, [loadHistory])

  useEffect(() => {
    void load()
  }, [load])

  async function run(dataset: ExportDataset) {
    if (from && to && from > to) {
      setStatus((s) => ({ ...s, [dataset.key]: { error: true, message: 'The start date is after the end date.' } }))
      return
    }
    setStatus((s) => ({ ...s, [dataset.key]: { busy: true } }))
    try {
      const { filename, rows } = await downloadExport(dataset.key, { from, to })
      setStatus((s) => ({
        ...s,
        [dataset.key]: {
          message: `Downloaded ${rows === null ? '' : `${rows.toLocaleString()} ${rows === 1 ? 'row' : 'rows'} to `}${filename}`,
        },
      }))
      if (datasets.some((d) => d.adminOnly)) void loadHistory()
    } catch (error) {
      setStatus((s) => ({
        ...s,
        [dataset.key]: { error: true, message: error instanceof Error ? error.message : 'The download failed.' },
      }))
    }
  }

  const today = lagosToday()

  return (
    <section className="opsExports glassCard" aria-labelledby="opsExportsTitle">
      <div className="opsExportsHead">
        <div>
          <span className="eyebrow">PROOF OF OPERATIONS</span>
          <h3 id="opsExportsTitle">Download operations records (CSV)</h3>
          <p>
            Riders, drivers, vehicles, rides, ArrivoExpress, cancellations, safety incidents and
            flight issues as files that open in Excel or Google Sheets. Times are Lagos time. The
            files contain personal details, so keep them somewhere secure and share them only with
            people who need them. <strong>Every download is recorded</strong> with who took it, what
            it was and when.
          </p>
        </div>
        <button type="button" className="ghostButton" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {loadError && <div className="opsExportsNotice error" role="alert">{loadError}</div>}

      <div className="opsExportsRange">
        <strong>Date range</strong>
        <div className="opsExportsPresets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="ghostButton"
              onClick={() => {
                const r = preset.range(today)
                setFrom(r.from)
                setTo(r.to)
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="opsExportsDates">
          <label>
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="opsExportsMuted">{from || to ? `${from || 'start'} to ${to || 'now'}` : 'All records'}</span>
        </div>
        <small className="opsExportsMuted">
          One file holds up to {maxRows.toLocaleString()} rows. If a download is too large, choose a shorter range.
        </small>
      </div>

      {loading && !datasets.length ? (
        <p className="opsExportsMuted">Loading...</p>
      ) : (
        <div className="opsExportsGrid">
          {datasets.map((dataset) => {
            const st = status[dataset.key] || {}
            return (
              <article key={dataset.key} className="opsExportsItem">
                <h4>{dataset.label}</h4>
                <p>{dataset.description}</p>
                <button
                  type="button"
                  className="primaryButton"
                  onClick={() => void run(dataset)}
                  disabled={st.busy}
                >
                  <Download size={15} /> {st.busy ? 'Preparing...' : 'Download CSV'}
                </button>
                {st.message && (
                  <small className={st.error ? 'opsExportsStatus error' : 'opsExportsStatus'} role={st.error ? 'alert' : 'status'}>
                    {st.message}
                  </small>
                )}
              </article>
            )
          })}
        </div>
      )}

      {history && history.length > 0 && (
        <div className="opsExportsHistory">
          <h4>Download history</h4>
          <div className="opsExportsTableWrap">
            <table>
              <thead>
                <tr>
                  <th>When (Lagos)</th>
                  <th>Who</th>
                  <th>Export</th>
                  <th>Rows</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.time_wat}</td>
                    <td>
                      {h.user_email}
                      <small>
                        {h.user_role}
                        {h.source === 'workspace' ? ' · Workspace' : ' · Console'}
                      </small>
                    </td>
                    <td>{h.dataset}</td>
                    <td>{h.row_count ?? '-'}</td>
                    <td>{h.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileSearch, ShieldCheck } from 'lucide-react'
import {
  csvEscape, decideLocation, endLocation, label, loadLiveLocationSessions, loadReport, loadSafetySettings, logExport, saveSafetySettings, searchAudit, shortAge, timeAgo,
  type AuditRow, type PendingLocation, type SafetySettings, type SupportAgentPresence, type SupportReport,
} from '../lib/supportCommandCentre'

// Supervisor-only: reports, audit log, and the safety settings with location approvals.
type Part = 'reports' | 'audit' | 'safety'

const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const pct = (n: number | null | undefined) => (n == null ? '-' : `${n}%`)
const mins = (n: number | null | undefined) => (n == null ? '-' : n >= 120 ? `${(n / 60).toFixed(1)} h` : `${n} min`)

function Reports({ agents }: { agents: SupportAgentPresence[] }) {
  const [from, setFrom] = useState(() => isoLocal(new Date(Date.now() - 7 * 86400000)))
  const [to, setTo] = useState(() => isoLocal(new Date()))
  const [agent, setAgent] = useState('')
  const [category, setCategory] = useState('')
  const [report, setReport] = useState<SupportReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    setBusy(true); setError('')
    try { setReport(await loadReport({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), agent, category: category.trim() })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to build the report.') }
    finally { setBusy(false) }
  }, [from, to, agent, category])
  useEffect(() => { void run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    if (!report) return
    const rows: unknown[][] = [
      ['Section', 'Name', 'Total', 'Open', 'Resolved', 'Avg resolution (min)'],
      ...report.by_category.map((c) => ['Category', c.category, c.total, c.open, c.resolved, '']),
      ...report.by_agent.map((a) => ['Officer', a.name, a.handled, '', a.resolved, a.avg_resolution_minutes ?? '']),
    ]
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
    try { await logExport('report_csv', rows.length - 1) } catch (e) { setError(e instanceof Error ? e.message : 'Export was not recorded, so it was not downloaded.'); return }
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `support-report-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const c = report?.cases
  return <div className="sccTower">
    <form className="sccFilters" onSubmit={(e) => { e.preventDefault(); void run() }}>
      <label>From<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label>Officer<select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Everyone</option>{agents.map((a) => <option key={a.employee_id} value={a.employee_id}>{a.display_name}</option>)}</select></label>
      <label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="any" /></label>
      <button type="submit" disabled={busy}>{busy ? 'Working' : 'Run'}</button>
      <button type="button" disabled={!report} onClick={() => void exportCsv()}><Download size={14} /> CSV</button>
    </form>
    {error ? <div className="sccNotice" role="alert">{error}</div> : null}
    {report && c ? <>
      <p className="sccMuted">Cases created in this range. These numbers help run the service; they are not a verdict on any one person.</p>
      <div className="sccMetrics six">
        <article><BarChart3 /><span>Cases</span><strong>{c.total}</strong><small>{c.open} open, {c.resolved} resolved</small></article>
        <article><BarChart3 /><span>First response</span><strong>{mins(c.avg_first_response_minutes)}</strong><small>SLA met {pct(c.first_response_sla_pct)}</small></article>
        <article><BarChart3 /><span>Resolution</span><strong>{mins(c.avg_resolution_minutes)}</strong><small>SLA met {pct(c.resolution_sla_pct)}</small></article>
        <article><BarChart3 /><span>Active vs waiting</span><strong>{mins(c.avg_active_minutes)}</strong><small>waiting on customer {mins(c.avg_waiting_minutes)}</small></article>
        <article className={c.escalated ? 'bad' : ''}><BarChart3 /><span>Escalated</span><strong>{c.escalated}</strong><small>{c.reopened} reopened</small></article>
        <article><BarChart3 /><span>Waiting for an officer now</span><strong>{report.queue_aging_now.unassigned}</strong><small>oldest {mins(report.queue_aging_now.oldest_minutes)}</small></article>
      </div>
      <div className="sccMetrics six">
        <article className={report.emergencies.unresolved ? 'bad' : ''}><BarChart3 /><span>Emergencies</span><strong>{report.emergencies.total}</strong><small>{report.emergencies.unresolved} unresolved, {report.emergencies.escalated} escalated</small></article>
        <article><BarChart3 /><span>Time to acknowledge</span><strong>{shortAge(report.emergencies.avg_seconds_to_acknowledge)}</strong><small>slowest {shortAge(report.emergencies.max_seconds_to_acknowledge)}</small></article>
        <article><BarChart3 /><span>Time to resolve</span><strong>{mins(report.emergencies.avg_minutes_to_resolve)}</strong><small>average</small></article>
        <article><BarChart3 /><span>Location sessions</span><strong>{report.location.sessions}</strong><small>{report.location.fetches} reads</small></article>
        <article><BarChart3 /><span>Location service</span><strong>{pct(report.location.availability_pct)}</strong><small>{report.location.stale} stale, {report.location.unavailable} unavailable</small></article>
        <article><BarChart3 /><span>Push delivery</span><strong>-</strong><small>not tracked yet</small></article>
      </div>
      <div className="sccTowerGrid">
        <div className="sccPanel"><div className="sccPanelTitle"><strong>By category</strong></div>
          {report.by_category.length ? report.by_category.map((x) => <article className="sccAgent" key={x.category}><span /><span><b>{label(x.category)}</b><small>{x.open} open, {x.resolved} resolved</small></span><span className="sccCapacity">{x.total}</span></article>) : <div className="sccEmpty">No cases in this range.</div>}</div>
        <div className="sccPanel"><div className="sccPanelTitle"><strong>By officer (cases they hold)</strong></div>
          {report.by_agent.length ? report.by_agent.map((x) => <article className="sccAgent" key={x.employee_id}><span /><span><b>{x.name}</b><small>{x.resolved} resolved · avg {mins(x.avg_resolution_minutes)}</small></span><span className="sccCapacity">{x.handled}</span></article>) : <div className="sccEmpty">No assigned cases.</div>}</div>
        <div className="sccPanel"><div className="sccPanelTitle"><strong>By priority</strong></div>
          {report.by_priority.map((x) => <article className="sccAgent" key={x.priority}><span /><span><b>{x.priority}</b></span><span className="sccCapacity">{x.total}</span></article>)}</div>
      </div>
    </> : null}
  </div>
}

function Audit({ agents }: { agents: SupportAgentPresence[] }) {
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<AuditRow[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    setBusy(true); setError('')
    try { setRows(await searchAudit({ action: action.trim(), actor, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined, limit: 200 })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to search.') }
    finally { setBusy(false) }
  }, [action, actor, from, to])
  useEffect(() => { void run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="sccTower">
    <form className="sccFilters" onSubmit={(e) => { e.preventDefault(); void run() }}>
      <label>Action contains<input value={action} onChange={(e) => setAction(e.target.value)} placeholder="sos_, location_, identity_, role_, export" /></label>
      <label>Who<select value={actor} onChange={(e) => setActor(e.target.value)}><option value="">Anyone</option>{agents.map((a) => <option key={a.employee_id} value={a.employee_id}>{a.display_name}</option>)}</select></label>
      <label>From<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <button type="submit" disabled={busy}><FileSearch size={14} /> {busy ? 'Searching' : 'Search'}</button>
    </form>
    {error ? <div className="sccNotice" role="alert">{error}</div> : null}
    <div className="sccPanel sccAuditTable">
      <div className="sccPanelTitle"><strong>{rows.length} record{rows.length === 1 ? '' : 's'}</strong><small className="sccMuted">newest first, up to 200</small></div>
      {rows.length ? rows.map((r) => <article key={r.id} className="sccAuditRow">
        <span><b>{label(r.action)}</b><small>{r.actor_name || 'System'} · {new Date(r.created_at).toLocaleString()}</small></span>
        <span className="sccMuted">{r.entity_type ? `${label(r.entity_type)} ${r.entity_id ?? ''}` : ''}</span>
        <code>{Object.keys(r.payload || {}).length ? JSON.stringify(r.payload).slice(0, 220) : ''}</code>
      </article>) : <div className="sccEmpty">Nothing matches.</div>}
    </div>
  </div>
}

const NUM_FIELDS: Array<[keyof SafetySettings, string, number, number]> = [
  ['incident_ack_seconds', 'Seconds before an unacknowledged SOS escalates', 10, 3600],
  ['incident_escalate_seconds', 'Seconds between escalation levels', 10, 3600],
  ['incident_followup_seconds', 'Seconds before an acknowledged SOS is flagged as still open', 60, 86400],
  ['incident_max_level', 'Highest escalation level', 1, 5],
  ['location_session_minutes', 'Minutes a location session lasts', 1, 120],
  ['location_max_active_per_officer', 'Open location sessions per officer', 1, 20],
  ['location_fresh_seconds', 'Seconds a position stays "live"', 5, 3600],
  ['location_log_retention_days', 'Days to keep location access logs', 1, 3650],
  ['identity_lookups_per_10min', 'Identity lookups per officer per 10 minutes', 1, 500],
  ['identity_failed_per_10min', 'Failed lookups before blocking, per 10 minutes', 1, 100],
]

function Safety({ names }: { names: Map<string, string> }) {
  const [settings, setSettings] = useState<SafetySettings | null>(null)
  const [sessions, setSessions] = useState<PendingLocation[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { const [s, l] = await Promise.all([loadSafetySettings(), loadLiveLocationSessions()]); setSettings(s); setSessions(l) }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to load.') }
  }, [])
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15000); return () => clearInterval(t) }, [load])

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setNotice('')
    try { await work(); await load(); setNotice(done) } catch (e) { setNotice(e instanceof Error ? e.message : 'That did not work.') } finally { setBusy(false) }
  }
  const patch = (p: Partial<SafetySettings>) => setSettings((cur) => (cur ? { ...cur, ...p } : cur))
  const pending = useMemo(() => sessions.filter((s) => s.status === 'pending_approval'), [sessions])
  const active = useMemo(() => sessions.filter((s) => s.status === 'active'), [sessions])

  return <div className="sccTower">
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}
    <div className="sccTowerGrid two">
      <div className="sccPanel">
        <div className="sccPanelTitle"><ShieldCheck size={17} /><strong>Location sessions</strong></div>
        <h4 className="sccSub">Waiting for approval ({pending.length})</h4>
        {pending.length ? pending.map((s) => <article className="sccAgent" key={s.id}>
          <span /><span><b>{names.get(s.requested_by) || 'Officer'}</b><small>{s.reason}</small></span>
          <span className="sccInline"><button type="button" className="sccIconBtn" disabled={busy} onClick={() => void act(() => decideLocation(s.id, true), 'Approved.')}>Approve</button><button type="button" className="sccIconBtn" disabled={busy} onClick={() => void act(() => decideLocation(s.id, false, 'denied'), 'Denied.')}>Deny</button></span>
        </article>) : <div className="sccEmpty">Nothing waiting.</div>}
        <h4 className="sccSub">Open now ({active.length})</h4>
        {active.length ? active.map((s) => <article className="sccAgent" key={s.id}>
          <span /><span><b>{names.get(s.requested_by) || 'Officer'} · {s.incident_id ? 'emergency' : 'case'}</b><small>{s.reason} · ends {timeAgo(s.expires_at).replace(' ago', '')}</small></span>
          <button type="button" className="sccIconBtn" disabled={busy} onClick={() => void act(() => endLocation(s.id, 'revoked by supervisor'), 'Session ended.')}>End now</button>
        </article>) : <div className="sccEmpty">No one is viewing a location.</div>}
      </div>

      <div className="sccPanel">
        <div className="sccPanelTitle"><strong>Safety settings</strong></div>
        {settings ? <form className="sccNoteForm sccPad" onSubmit={(e) => { e.preventDefault(); void act(() => saveSafetySettings(settings).then(setSettings), 'Saved. New values apply to new alerts and sessions.') }}>
          <label className="sccCheck"><input type="checkbox" checked={settings.location_requires_approval} onChange={(e) => patch({ location_requires_approval: e.target.checked })} /> A supervisor must approve location sessions on ordinary cases (emergencies are never held up)</label>
          {NUM_FIELDS.map(([key, text, min, max]) => <label key={key} className="sccField"><span>{text}</span>
            <input type="number" min={min} max={max} value={Number(settings[key])} onChange={(e) => patch({ [key]: Number(e.target.value) } as Partial<SafetySettings>)} /></label>)}
          <button type="submit" disabled={busy}>Save settings</button>
        </form> : <div className="sccEmpty">Loading</div>}
      </div>
    </div>
  </div>
}

export default function SupportInsights({ agents }: { agents: SupportAgentPresence[] }) {
  const [part, setPart] = useState<Part>('reports')
  const names = useMemo(() => new Map(agents.map((a) => [a.employee_id, a.display_name])), [agents])
  return <section aria-label="Insights">
    <nav className="sccTabs sub">{([['reports', 'Reports'], ['audit', 'Audit log'], ['safety', 'Safety and approvals']] as Array<[Part, string]>).map(([id, text]) => <button key={id} type="button" className={part === id ? 'active' : ''} onClick={() => setPart(id)}>{text}</button>)}</nav>
    {part === 'reports' ? <Reports agents={agents} /> : null}
    {part === 'audit' ? <Audit agents={agents} /> : null}
    {part === 'safety' ? <Safety names={names} /> : null}
  </section>
}

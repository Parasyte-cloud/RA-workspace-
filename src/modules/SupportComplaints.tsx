import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FilePlus2, Gavel } from 'lucide-react'
import {
  APPROVAL_LABEL, COMPLAINT_TYPES, PARTIES, SEVERITIES, cancelApproval, csvEscape, decideApproval, label, listApprovals, listComplaints, loadComplaintReport, logExport,
  naira, raiseComplaint, timeAgo, type ApprovalRow, type ComplaintReport, type ComplaintRow, type SupportParty,
} from '../lib/supportCommandCentre'

// Complaints list and intake, the approvals inbox, and complaint reports.
// Every rule (who may approve what) is enforced in the database; this only presents it.

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export function RaiseComplaint({ ticketId, defaults, onDone, onCancel }: {
  ticketId?: string | null; defaults?: { name?: string; phone?: string; email?: string; party?: SupportParty }
  onDone: (r: { ticket_id: string; public_id: string }) => void; onCancel: () => void
}) {
  const [party, setParty] = useState<SupportParty>(defaults?.party || 'rider')
  const [name, setName] = useState(defaults?.name || '')
  const [phone, setPhone] = useState(defaults?.phone || '')
  const [email, setEmail] = useState(defaults?.email || '')
  const [type, setType] = useState('service_quality')
  const [severity, setSeverity] = useState('medium')
  const [rideRef, setRideRef] = useState('')
  const [bookingRef, setBookingRef] = useState('')
  const [against, setAgainst] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setBusy(true); setError('')
    try { onDone(await raiseComplaint({ party, description, ticketId, customerName: name, phone, email, subject, complaintType: type, severity, rideRef, bookingRef, againstName: against, channel: ticketId ? undefined : 'form' })) }
    catch (e) { setError(msg(e, 'Could not raise the complaint')) } finally { setBusy(false) }
  }

  return <form className="sccComplaintForm" onSubmit={submit} aria-label="Raise a complaint">
    <h4>{ticketId ? 'Turn this ticket into a complaint' : 'Raise a complaint'}</h4>
    {error ? <div className="sccNotice" role="alert">{error}</div> : null}
    <div className="sccFormGrid">
      <label>Complaint from<select value={party} onChange={(e) => setParty(e.target.value as SupportParty)}>{PARTIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
      <label>Type<select value={type} onChange={(e) => setType(e.target.value)}>{COMPLAINT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={(e) => setSeverity(e.target.value)}>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
      {!ticketId ? <>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" /></label>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} /></label>
        <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} /></label>
      </> : null}
      <label>Ride reference<input value={rideRef} onChange={(e) => setRideRef(e.target.value)} maxLength={80} /></label>
      <label>Booking reference<input value={bookingRef} onChange={(e) => setBookingRef(e.target.value)} maxLength={80} /></label>
      <label>Complaint is about (driver or rider)<input value={against} onChange={(e) => setAgainst(e.target.value)} maxLength={120} /></label>
    </div>
    <label className="sccWide">What happened<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} required minLength={10} /></label>
    <div className="sccFormActions">
      <button type="submit" className="sccVoicePrimary" disabled={busy || description.trim().length < 10}>{busy ? 'Saving' : 'Raise complaint'}</button>
      <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  </form>
}

export function ComplaintsTab({ onOpenTicket }: { onOpenTicket: (id: string) => void }) {
  const [rows, setRows] = useState<ComplaintRow[]>([])
  const [party, setParty] = useState('')
  const [status, setStatus] = useState('open')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [raising, setRaising] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await listComplaints({ party, status })) } catch (e) { setError(msg(e, 'Unable to load complaints')) } finally { setLoading(false) }
  }, [party, status])
  useEffect(() => { void load() }, [load])

  return <section className="sccPanel" aria-label="Complaints">
    <div className="sccFilters">
      <label>From<select value={party} onChange={(e) => setParty(e.target.value)}><option value="">Riders and drivers</option>{PARTIES.map((p) => <option key={p} value={p}>{label(p)}s</option>)}</select></label>
      <label>Show<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="done">Resolved</option><option value="">All</option></select></label>
      <button type="button" onClick={() => setRaising((v) => !v)}><FilePlus2 size={14} />Raise complaint</button>
    </div>
    {raising ? <RaiseComplaint onCancel={() => setRaising(false)} onDone={(r) => { setRaising(false); void load(); onOpenTicket(r.ticket_id) }} /> : null}
    {error ? <div className="sccNotice" role="alert">{error}</div> : null}
    {loading ? <div className="sccEmpty">Loading</div> : rows.length ? <div className="sccTableWrap"><table className="sccTable">
      <thead><tr><th>Ticket</th><th>From</th><th>Customer</th><th>Type</th><th>Severity</th><th>Status</th><th>Handled by</th><th>Money</th><th>Opened</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.ticket_id}>
        <td><button type="button" className="sccLinkBtn" onClick={() => onOpenTicket(r.ticket_id)}>{r.public_id}</button></td>
        <td>{label(r.party_type) || '-'}</td><td>{r.customer_name || '-'}</td><td>{label(r.complaint_type)}</td>
        <td><b className={`sccSev ${r.severity}`}>{label(r.severity)}</b></td><td>{label(r.status)}</td><td>{r.agent_name || 'Unassigned'}</td>
        <td>{r.compensation_status !== 'none' ? `${naira(r.compensation_minor)} (${label(r.compensation_status)})` : '-'}</td><td>{timeAgo(r.created_at)}</td>
      </tr>)}</tbody></table></div> : <div className="sccEmpty">No complaints match. Raise one here, or from a call ticket.</div>}
  </section>
}

const STATUS_TABS: Array<['pending' | 'approved' | 'denied' | 'all', string]> = [['pending', 'Waiting'], ['approved', 'Approved'], ['denied', 'Declined'], ['all', 'All']]

function describe(a: ApprovalRow) {
  if (a.action === 'merge_customers') return `Merge ${a.customer_name || 'customer'} into another record`
  if (a.action === 'edit_customer') return `Change ${a.customer_name || 'customer'}: ${Object.entries(a.payload || {}).map(([k, v]) => `${label(k)} to "${String(v)}"`).join(', ')}`
  if (a.amount_minor != null) return `${APPROVAL_LABEL[a.action] || label(a.action)} of ${naira(a.amount_minor)}`
  return APPROVAL_LABEL[a.action] || label(a.action)
}

export function ApprovalsTab({ onOpenTicket, onCount }: { onOpenTicket: (id: string) => void; onCount?: (n: number) => void }) {
  const [view, setView] = useState<'pending' | 'approved' | 'denied' | 'all'>('pending')
  const [rows, setRows] = useState<ApprovalRow[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { const r = await listApprovals(view); setRows(r); if (view === 'pending') onCount?.(r.filter((x) => x.can_decide).length) } catch (e) { setNotice(msg(e, 'Unable to load approvals')) }
  }, [view, onCount])
  useEffect(() => { void load() }, [load])

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setNotice('')
    try { await work(); await load(); setNotice(done) } catch (e) { setNotice(msg(e, 'That did not work.')) } finally { setBusy(false) }
  }

  return <section className="sccPanel" aria-label="Approvals">
    <nav className="sccTabs sub">{STATUS_TABS.map(([id, text]) => <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{text}</button>)}</nav>
    <p className="sccMuted">Supervisors approve closing critical tickets, reopening, and changes or merges of customer records. Managers approve refunds and compensation. Nobody approves their own request.</p>
    {notice ? <div className="sccNotice" role="status">{notice}</div> : null}
    {rows.length ? rows.map((a) => <article className="sccApproval" key={a.id}>
      <header><b><Gavel size={14} /> {describe(a)}</b><span className={`sccBadge ${a.status}`}>{a.status === 'pending' ? `Waiting for ${a.level}` : label(a.status)}</span></header>
      <p>{a.reason}</p>
      <small>{a.public_id ? <button type="button" className="sccLinkBtn" onClick={() => a.ticket_id && onOpenTicket(a.ticket_id)}>{a.public_id}</button> : null} Asked by {a.requested_by_name || 'an officer'} · {timeAgo(a.created_at)}{a.decided_by_name ? ` · ${label(a.status)} by ${a.decided_by_name}` : ''}{a.decision_note ? ` · "${a.decision_note}"` : ''}</small>
      {a.status === 'pending' && a.can_decide ? <div className="sccFormActions">
        <input value={notes[a.id] || ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} placeholder="Note (needed to decline)" aria-label="Decision note" maxLength={500} />
        <button type="button" className="sccVoicePrimary" disabled={busy} onClick={() => void act(() => decideApproval(a.id, true, notes[a.id]), 'Approved and applied.')}>Approve</button>
        <button type="button" disabled={busy || !(notes[a.id] || '').trim()} onClick={() => void act(() => decideApproval(a.id, false, notes[a.id]), 'Declined.')}>Decline</button>
      </div> : null}
      {a.status === 'pending' && a.mine ? <div className="sccFormActions"><button type="button" disabled={busy} onClick={() => void act(() => cancelApproval(a.id), 'Request withdrawn.')}>Withdraw request</button></div> : null}
    </article>) : <div className="sccEmpty">{view === 'pending' ? 'Nothing is waiting for a decision.' : 'Nothing here yet.'}</div>}
  </section>
}

const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const mins = (n: number | null | undefined) => (n == null ? '-' : n >= 120 ? `${(n / 60).toFixed(1)} h` : `${n} min`)
const rate = (a: number, b: number) => (a + b ? `${Math.round((a / (a + b)) * 100)}%` : '-')

function Bars({ rows, title }: { rows: Array<{ name: string; value: number }>; title: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return <div className="sccPanel"><div className="sccPanelTitle"><strong>{title}</strong></div>
    {rows.length ? rows.map((r) => <div className="sccBarRow" key={r.name}><span>{r.name}</span><i style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /><b>{r.value}</b></div>) : <div className="sccEmpty">No data in this range.</div>}</div>
}

export function ComplaintReports() {
  const [from, setFrom] = useState(() => isoLocal(new Date(Date.now() - 30 * 86400000)))
  const [to, setTo] = useState(() => isoLocal(new Date()))
  const [party, setParty] = useState('')
  const [report, setReport] = useState<ComplaintReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = useCallback(async () => {
    setBusy(true); setError('')
    try { setReport(await loadComplaintReport({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), party })) } catch (e) { setError(msg(e, 'Unable to build the report.')) } finally { setBusy(false) }
  }, [from, to, party])
  useEffect(() => { void run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    if (!report) return
    const lines: unknown[][] = [['Section', 'Item', 'Count', 'Extra']]
    report.by_party.forEach((r) => lines.push(['Party', r.party, r.tickets, `complaints ${r.complaints}; open ${r.open}`]))
    report.complaints_by_type.forEach((r) => lines.push(['Complaint type', r.type, r.count, '']))
    report.complaints_by_severity.forEach((r) => lines.push(['Severity', r.severity, r.count, '']))
    report.by_category.forEach((r) => lines.push(['Category', r.category || 'uncategorised', r.tickets, `open ${r.open}`]))
    report.by_channel.forEach((r) => lines.push(['Channel', r.channel, r.tickets, '']))
    report.by_agent.forEach((r) => lines.push(['Agent', r.name, r.handled, `resolved ${r.resolved}; avg resolution min ${r.avg_resolution_minutes ?? ''}`]))
    report.by_day.forEach((r) => lines.push(['Day', r.day, r.tickets, `complaints ${r.complaints}`]))
    report.repeat_complainants.forEach((r) => lines.push(['Repeat complainant', r.name || r.customer_id, r.complaints, r.party || '']))
    report.most_complained_about.forEach((r) => lines.push(['Most complained about', r.name, r.complaints, '']))
    const csv = lines.map((l) => l.map(csvEscape).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `complaints-report-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    void logExport('complaint_report', lines.length - 1).catch(() => undefined)
  }

  const r = report
  const resolvedPct = useMemo(() => (r ? rate(r.totals.resolved, r.totals.open) : '-'), [r])
  return <div className="sccTower">
    <div className="sccFilters">
      <label>From<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label>Customer type<select value={party} onChange={(e) => setParty(e.target.value)}><option value="">Riders and drivers</option>{PARTIES.map((p) => <option key={p} value={p}>{label(p)}s</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => void run()}>{busy ? 'Building' : 'Build report'}</button>
      <button type="button" disabled={!r} onClick={exportCsv}><Download size={14} />Download CSV</button>
    </div>
    {error ? <div className="sccNotice" role="alert">{error}</div> : null}
    {r ? <>
      <div className="sccMetrics six">
        <article><span>Tickets</span><strong>{r.totals.tickets}</strong></article>
        <article><span>Complaints</span><strong>{r.totals.complaints}</strong></article>
        <article><span>Still open</span><strong>{r.totals.open}</strong></article>
        <article><span>Resolved</span><strong>{resolvedPct}</strong></article>
        <article><span>Reopened</span><strong>{r.totals.reopened}</strong></article>
        <article><span>Avg resolution</span><strong>{mins(r.sla.avg_resolution_minutes)}</strong></article>
      </div>
      <div className="sccTowerGrid two">
        <div className="sccPanel"><div className="sccPanelTitle"><strong>Service levels</strong></div>
          <p>First response on time: <b>{rate(r.sla.first_response_met, r.sla.first_response_missed)}</b> ({r.sla.first_response_met} met, {r.sla.first_response_missed} missed) · average {mins(r.sla.avg_first_response_minutes)}</p>
          <p>Resolution on time: <b>{rate(r.sla.resolution_met, r.sla.resolution_missed)}</b> ({r.sla.resolution_met} met, {r.sla.resolution_missed} missed)</p></div>
        <div className="sccPanel"><div className="sccPanelTitle"><strong>Calls</strong></div>
          <p>{r.calls.total} calls · {r.calls.inbound} in, {r.calls.outbound} out · {r.calls.answered} answered, {r.calls.abandoned} abandoned · {r.calls.with_ticket} raised as tickets</p>
          <p>Average talk time {r.calls.avg_duration_seconds ?? '-'} s · average wait {r.calls.avg_wait_seconds ?? '-'} s</p></div>
        <div className="sccPanel"><div className="sccPanelTitle"><strong>Money and approvals</strong></div>
          <p>Compensation requested {naira(r.compensation.requested_minor)} · approved {naira(r.compensation.approved_minor)} · paid {naira(r.compensation.paid_minor)}</p>
          <p>{r.approvals.requested} approval requests: {r.approvals.approved} approved, {r.approvals.denied} declined, {r.approvals.pending} waiting · average decision {mins(r.approvals.avg_decision_minutes)}</p></div>
        <Bars title="By customer type" rows={r.by_party.map((x) => ({ name: label(x.party), value: x.tickets }))} />
        <Bars title="Complaint types" rows={r.complaints_by_type.map((x) => ({ name: label(x.type), value: x.count }))} />
        <Bars title="Severity" rows={r.complaints_by_severity.map((x) => ({ name: label(x.severity), value: x.count }))} />
        <Bars title="Channels" rows={r.by_channel.map((x) => ({ name: label(x.channel), value: x.tickets }))} />
        <Bars title="Categories" rows={r.by_category.map((x) => ({ name: label(x.category) || 'uncategorised', value: x.tickets }))} />
        <Bars title="Tickets per day" rows={r.by_day.map((x) => ({ name: x.day, value: x.tickets }))} />
        <div className="sccPanel"><div className="sccPanelTitle"><strong>By officer</strong></div>
          {r.by_agent.length ? <table className="sccTable"><thead><tr><th>Officer</th><th>Handled</th><th>Resolved</th><th>Avg resolution</th></tr></thead><tbody>{r.by_agent.map((x) => <tr key={x.name}><td>{x.name}</td><td>{x.handled}</td><td>{x.resolved}</td><td>{mins(x.avg_resolution_minutes)}</td></tr>)}</tbody></table> : <div className="sccEmpty">No data in this range.</div>}</div>
        <div className="sccPanel"><div className="sccPanelTitle"><strong>Repeat complainants</strong></div>
          {r.repeat_complainants.length ? r.repeat_complainants.map((x) => <div className="sccBarRow" key={x.customer_id}><span>{x.name || 'Unknown'} ({label(x.party) || '-'})</span><b>{x.complaints}</b></div>) : <div className="sccEmpty">Nobody complained more than once.</div>}</div>
        <div className="sccPanel"><div className="sccPanelTitle"><strong>Most complained about</strong></div>
          {r.most_complained_about.length ? r.most_complained_about.map((x) => <div className="sccBarRow" key={x.name}><span>{x.name}</span><b>{x.complaints}</b></div>) : <div className="sccEmpty">No driver or rider has two or more complaints.</div>}</div>
      </div>
    </> : busy ? <div className="sccEmpty">Building</div> : null}
  </div>
}

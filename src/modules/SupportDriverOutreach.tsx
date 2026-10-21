import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock3, Filter, PhoneCall, Plus, RefreshCw, Search, Settings2, UserPlus, X } from 'lucide-react'
import {
  addDriverFollowup,
  completeDriverFollowup,
  createDriverOutreach,
  loadDriverOutreach,
  setDriverStatus,
  upsertDriverStatus,
  watchDriverOutreach,
  type DriverOutreachCase,
  type DriverPipeline,
  type DriverStatus,
  type DriverTeamActivity,
} from '../lib/supportDriverOutreach'
import { dueLabel } from '../lib/supportCommandCentre'
import '../support-driver-outreach.css'

type Props = {
  isSupervisor: boolean
  onOpenTicket: (ticketId: string) => void
  onCall: (to: string, ticketId: string) => void
}

type CreateForm = {
  name: string
  phone: string
  area: string
  vehicle: string
  statusId: string
  note: string
  followUpAction: string
  followUpDueAt: string
}

const EMPTY_FORM: CreateForm = {
  name: '', phone: '', area: '', vehicle: '', statusId: '', note: '', followUpAction: '', followUpDueAt: '',
}

function shortDate(value: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function pipelineTotal(rows: DriverPipeline[]) {
  return rows.reduce((sum, row) => sum + Number(row.driver_count || 0), 0)
}

export default function SupportDriverOutreach({ isSupervisor, onOpenTicket, onCall }: Props) {
  const [cases, setCases] = useState<DriverOutreachCase[]>([])
  const [statuses, setStatuses] = useState<DriverStatus[]>([])
  const [pipeline, setPipeline] = useState<DriverPipeline[]>([])
  const [activity, setActivity] = useState<DriverTeamActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [dueOnly, setDueOnly] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showStatuses, setShowStatuses] = useState(false)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [followupFor, setFollowupFor] = useState<string | null>(null)
  const [followAction, setFollowAction] = useState('')
  const [followDue, setFollowDue] = useState('')
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState({ code: '', label: '', description: '', terminal: false, success: false, active: true, sortOrder: 100 })

  const reload = useCallback(async () => {
    try {
      const data = await loadDriverOutreach()
      setCases(data.cases)
      setStatuses(data.statuses)
      setPipeline(data.pipeline)
      setActivity(data.activity)
      setNotice('')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Unable to load Driver Outreach CRM.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return watchDriverOutreach(() => void reload())
  }, [reload])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cases.filter((row) => {
      if (statusFilter !== 'all' && row.driver_status_id !== statusFilter) return false
      if (ownerFilter !== 'all' && row.assigned_agent_id !== ownerFilter) return false
      if (dueOnly && !row.next_followup_due_at) return false
      if (!q) return true
      return [row.driver_name, row.driver_phone, row.area, row.public_id, row.assigned_agent_name, row.driver_status_label]
        .some((v) => String(v || '').toLowerCase().includes(q))
    }).sort((a, b) => {
      const ao = a.followup_overdue ? 0 : a.next_followup_due_at ? 1 : 2
      const bo = b.followup_overdue ? 0 : b.next_followup_due_at ? 1 : 2
      if (ao !== bo) return ao - bo
      if (a.next_followup_due_at && b.next_followup_due_at) return Date.parse(a.next_followup_due_at) - Date.parse(b.next_followup_due_at)
      return Date.parse(b.updated_at) - Date.parse(a.updated_at)
    })
  }, [cases, query, statusFilter, ownerFilter, dueOnly])

  const act = async (work: () => Promise<unknown>, success?: string) => {
    setBusy(true); setNotice('')
    try {
      await work()
      if (success) setNotice(success)
      await reload()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!form.phone.trim()) { setNotice('Driver phone number is required.'); return }
    if (form.followUpAction.trim() && !form.followUpDueAt) { setNotice('Choose a due date for the follow-up.'); return }
    await act(async () => {
      const ticketId = await createDriverOutreach({
        name: form.name,
        phone: form.phone,
        area: form.area,
        vehicleDetails: form.vehicle.trim() ? { summary: form.vehicle.trim() } : {},
        statusId: form.statusId || null,
        note: form.note,
        followUpAction: form.followUpAction,
        followUpDueAt: form.followUpDueAt ? new Date(form.followUpDueAt).toISOString() : null,
      })
      setForm(EMPTY_FORM)
      setShowCreate(false)
      onOpenTicket(ticketId)
    }, 'Driver outreach ticket created.')
  }

  const addFollowup = async (ticketId: string) => {
    if (!followAction.trim() || !followDue) { setNotice('Follow-up action and due date are required.'); return }
    await act(async () => {
      await addDriverFollowup(ticketId, followAction, new Date(followDue).toISOString())
      setFollowupFor(null); setFollowAction(''); setFollowDue('')
    }, 'Follow-up added.')
  }

  const createStatus = async () => {
    if (!newStatus.code.trim() || !newStatus.label.trim()) { setNotice('Status code and label are required.'); return }
    await act(async () => {
      await upsertDriverStatus({ id: editingStatusId, ...newStatus, code: newStatus.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') })
      setEditingStatusId(null)
      setNewStatus({ code: '', label: '', description: '', terminal: false, success: false, active: true, sortOrder: 100 })
    }, 'Driver status saved.')
  }

  const owners = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of cases) if (row.assigned_agent_id && row.assigned_agent_name) seen.set(row.assigned_agent_id, row.assigned_agent_name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [cases])

  const total = pipelineTotal(pipeline)
  const dueCount = cases.filter((c) => c.next_followup_due_at && !c.followup_overdue).length
  const overdueCount = cases.filter((c) => c.followup_overdue).length
  const successCount = pipeline.filter((p) => p.is_success).reduce((sum, p) => sum + Number(p.driver_count || 0), 0)

  return <section className="sdoShell" aria-label="Driver Outreach CRM">
    <header className="sdoHeader">
      <div>
        <span className="sccEyebrow">Support CRM</span>
        <h3>Driver Outreach</h3>
        <p>Every recruitment call becomes an owned ticket with an outcome, notes and a next action.</p>
      </div>
      <div className="sdoActions">
        {isSupervisor ? <button type="button" onClick={() => setShowStatuses((v) => !v)}><Settings2 size={15}/>Statuses</button> : null}
        <button type="button" onClick={() => void reload()} disabled={loading || busy}><RefreshCw size={15}/>Refresh</button>
        <button type="button" className="sdoPrimary" onClick={() => setShowCreate(true)}><UserPlus size={15}/>New driver</button>
      </div>
    </header>

    {notice ? <div className="sccNotice">{notice}</div> : null}

    <div className="sdoMetrics">
      <article><span>Drivers</span><strong>{total}</strong></article>
      <article><span>Follow-ups due</span><strong>{dueCount}</strong></article>
      <article className={overdueCount ? 'bad' : ''}><span>Overdue</span><strong>{overdueCount}</strong></article>
      <article><span>Positive pipeline</span><strong>{successCount}</strong></article>
    </div>

    <div className="sdoPipeline" aria-label="Driver pipeline">
      {pipeline.map((p) => <button type="button" key={p.status_id} className={statusFilter === p.status_id ? 'active' : ''} onClick={() => setStatusFilter(statusFilter === p.status_id ? 'all' : p.status_id)}>
        <span>{p.label}</span><strong>{p.driver_count}</strong>
      </button>)}
    </div>

    <div className="sdoFilters">
      <label className="sdoSearch"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search driver, phone, area, ticket or officer"/></label>
      <label><Filter size={14}/><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{statuses.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      {isSupervisor ? <label>Owner<select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}><option value="all">All officers</option>{owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
      <label className="sdoCheck"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)}/> Has follow-up</label>
    </div>

    <div className="sdoTableWrap">
      <table className="sdoTable">
        <thead><tr><th>Driver</th><th>Status</th><th>Next action</th><th>Owner</th><th>Updated</th><th aria-label="Actions"/></tr></thead>
        <tbody>
          {filtered.map((row) => <tr key={row.ticket_id} className={row.followup_overdue ? 'overdue' : ''}>
            <td><button className="sdoTicketLink" type="button" onClick={() => onOpenTicket(row.ticket_id)}><strong>{row.driver_name || row.driver_phone || 'Unnamed driver'}</strong><small>{row.public_id} · {row.driver_phone || 'No phone'}{row.area ? ` · ${row.area}` : ''}</small></button></td>
            <td><select value={row.driver_status_id || ''} disabled={busy} onChange={(e) => e.target.value && void act(() => setDriverStatus(row.ticket_id, e.target.value))}>
              <option value="">No status</option>{statuses.filter((s) => s.active || s.id === row.driver_status_id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></td>
            <td>{row.next_followup_id ? <div className="sdoDue"><span className={row.followup_overdue ? 'late' : ''}><Clock3 size={13}/>{row.next_followup_action}</span><small>{dueLabel(row.next_followup_due_at)} · {shortDate(row.next_followup_due_at)}</small><button type="button" disabled={busy} onClick={() => void act(() => completeDriverFollowup(row.next_followup_id!), 'Follow-up completed.')}><Check size={13}/>Done</button></div> : <button type="button" className="sdoTextButton" onClick={() => setFollowupFor(row.ticket_id)}><Plus size={13}/>Add follow-up</button>}</td>
            <td>{row.assigned_agent_name || 'Unassigned'}</td>
            <td>{shortDate(row.updated_at)}</td>
            <td><div className="sdoRowActions">{row.driver_phone ? <button type="button" title="Call driver" onClick={() => onCall(row.driver_phone!, row.ticket_id)}><PhoneCall size={15}/></button> : null}<button type="button" onClick={() => onOpenTicket(row.ticket_id)}>Open</button></div></td>
          </tr>)}
          {!loading && !filtered.length ? <tr><td colSpan={6}><div className="sccEmpty">No driver outreach tickets match this view.</div></td></tr> : null}
        </tbody>
      </table>
    </div>

    {isSupervisor && activity.length ? <section className="sdoActivity" aria-label="Driver outreach team activity">
      <header><strong>Team activity</strong><span>Today and rolling 7 days</span></header>
      <div className="sdoActivityGrid">{activity.map((row) => <article key={row.employee_id}>
        <b>{row.officer_name}</b>
        <span><strong>{row.calls_today}</strong> calls today · {row.calls_7d} / 7d</span>
        <span><strong>{row.tickets_today}</strong> tickets today · {row.tickets_7d} / 7d</span>
        <span><strong>{row.followups_today}</strong> follow-ups done today · {row.followups_7d} / 7d</span>
      </article>)}</div>
    </section> : null}

    {showStatuses && isSupervisor ? <div className="sdoStatusAdmin">
      <div><strong>Driver statuses</strong><span>Business outcomes are separate from ticket lifecycle states.</span></div>
      <div className="sdoStatusGrid">{statuses.map((s) => <article key={s.id}><b>{s.label}</b><small>{s.code}{s.is_terminal ? ' · terminal' : ''}{s.is_success ? ' · positive' : ''}{!s.active ? ' · inactive' : ''}</small><p>{s.description || 'No description'}</p><button type="button" onClick={() => { setEditingStatusId(s.id); setNewStatus({ code: s.code, label: s.label, description: s.description || '', terminal: s.is_terminal, success: s.is_success, active: s.active, sortOrder: s.sort_order }) }}>Edit</button></article>)}</div>
      <div className="sdoStatusForm">
        <input placeholder="code" value={newStatus.code} onChange={(e) => setNewStatus({ ...newStatus, code: e.target.value })}/>
        <input placeholder="Label" value={newStatus.label} onChange={(e) => setNewStatus({ ...newStatus, label: e.target.value })}/>
        <input placeholder="Description" value={newStatus.description} onChange={(e) => setNewStatus({ ...newStatus, description: e.target.value })}/>
        <label><input type="checkbox" checked={newStatus.success} onChange={(e) => setNewStatus({ ...newStatus, success: e.target.checked })}/> Positive</label>
        <label><input type="checkbox" checked={newStatus.terminal} onChange={(e) => setNewStatus({ ...newStatus, terminal: e.target.checked })}/> Terminal</label>
        <label><input type="checkbox" checked={newStatus.active} onChange={(e) => setNewStatus({ ...newStatus, active: e.target.checked })}/> Active</label>
        <input type="number" min={0} max={10000} value={newStatus.sortOrder} onChange={(e) => setNewStatus({ ...newStatus, sortOrder: Number(e.target.value) || 0 })} aria-label="Sort order"/>
        <button type="button" disabled={busy} onClick={() => void createStatus()}>{editingStatusId ? 'Save changes' : 'Add status'}</button>
        {editingStatusId ? <button type="button" onClick={() => { setEditingStatusId(null); setNewStatus({ code: '', label: '', description: '', terminal: false, success: false, active: true, sortOrder: 100 }) }}>Cancel edit</button> : null}
      </div>
    </div> : null}

    {showCreate ? <div className="sdoModalBack" onClick={() => setShowCreate(false)}><section className="sdoModal" role="dialog" aria-modal="true" aria-label="New driver outreach" onClick={(e) => e.stopPropagation()}>
      <header><div><span className="sccEyebrow">New outreach ticket</span><h3>Add driver</h3></div><button type="button" onClick={() => setShowCreate(false)} aria-label="Close"><X size={18}/></button></header>
      <div className="sdoFormGrid">
        <label>Driver name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name"/></label>
        <label>Phone number *<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0801 234 5678" inputMode="tel"/></label>
        <label>Area<input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="Ikeja, Yaba, Lekki..."/></label>
        <label>Vehicle<input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="Toyota Camry 2018, blue"/></label>
        <label>Status<select value={form.statusId} onChange={(e) => setForm({ ...form, statusId: e.target.value })}><option value="">Default</option>{statuses.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="wide">Internal note<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} placeholder="What happened on the call?"/></label>
        <label className="wide">Follow-up action<input value={form.followUpAction} onChange={(e) => setForm({ ...form, followUpAction: e.target.value })} placeholder="Send onboarding link / call again / verify documents"/></label>
        <label>Due date/time<input type="datetime-local" value={form.followUpDueAt} onChange={(e) => setForm({ ...form, followUpDueAt: e.target.value })}/></label>
      </div>
      <footer><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button type="button" className="sdoPrimary" disabled={busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Create ticket'}</button></footer>
    </section></div> : null}

    {followupFor ? <div className="sdoModalBack" onClick={() => setFollowupFor(null)}><section className="sdoModal small" role="dialog" aria-modal="true" aria-label="Add follow-up" onClick={(e) => e.stopPropagation()}>
      <header><h3>Add follow-up</h3><button type="button" onClick={() => setFollowupFor(null)} aria-label="Close"><X size={18}/></button></header>
      <div className="sdoFormGrid"><label className="wide">Action<input value={followAction} onChange={(e) => setFollowAction(e.target.value)} placeholder="What needs to happen?"/></label><label>Due date/time<input type="datetime-local" value={followDue} onChange={(e) => setFollowDue(e.target.value)}/></label></div>
      <footer><button type="button" onClick={() => setFollowupFor(null)}>Cancel</button><button type="button" className="sdoPrimary" disabled={busy} onClick={() => void addFollowup(followupFor)}>Save follow-up</button></footer>
    </section></div> : null}
  </section>
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Save, Search, Trash2, UserMinus, UserRound, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { invokeWorkspaceAdmin } from '../lib/workspaceAdmin'
import '../people-directory.css'

type Person = {
  id: string
  full_name: string | null
  email: string
  department: string | null
  job_title: string | null
  role: string | null
  active: boolean
  manager_id: string | null
  start_date?: string | null
}

type Offboarding = {
  open_work: { id: string; title: string; status: string; due_at: string | null }[]
  devices: { id: string; asset_tag: string; device_type: string | null; model: string | null; status: string | null }[]
  direct_reports: { id: string; full_name: string | null; email: string }[]
}

type EditForm = {
  full_name: string
  department: string
  job_title: string
  manager_id: string
  role: string
  start_date: string
}

const ROLES = [
  'employee', 'support', 'engineer', 'cto', 'manager', 'hr', 'legal',
  'operations', 'finance', 'marketing', 'partnerships', 'admin',
]

const nameOf = (p: Pick<Person, 'full_name' | 'email'>) => p.full_name || p.email

const formFor = (p: Person): EditForm => ({
  full_name: p.full_name || '',
  department: p.department || '',
  job_title: p.job_title || '',
  manager_id: p.manager_id || '',
  role: (p.role || 'employee').toLowerCase(),
  start_date: p.start_date || '',
})

export default function PeopleDirectory({
  canManage,
  viewerId,
  viewerRole,
}: {
  canManage: boolean
  viewerId: string
  viewerRole: string
}) {
  const isAdmin = viewerRole === 'admin'
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'former'>('active')
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [role, setRole] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState<EditForm | null>(null)
  const [offboarding, setOffboarding] = useState<Offboarding | null>(null)
  const [successor, setSuccessor] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('employee_profiles')
      .select('id,full_name,email,department,job_title,role,active,manager_id,start_date')
      .order('full_name')
    if (loadError) setError(loadError.message)
    setPeople(((data || []) as Person[]).map(p => ({ ...p, active: p.active !== false })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activePeople = useMemo(() => people.filter(p => p.active), [people])
  const formerPeople = useMemo(() => people.filter(p => !p.active), [people])
  const departments = useMemo(
    () => Array.from(new Set(people.map(p => p.department || 'Unassigned'))).sort(),
    [people]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (tab === 'active' ? activePeople : formerPeople)
      .filter(p => !department || (p.department || 'Unassigned') === department)
      .filter(p => !role || (p.role || 'employee').toLowerCase() === role)
      .filter(
        p =>
          !q ||
          [p.full_name, p.email, p.job_title, p.department].some(v =>
            String(v || '').toLowerCase().includes(q)
          )
      )
  }, [tab, activePeople, formerPeople, search, department, role])

  const selected = people.find(p => p.id === selectedId) || null
  const managerName = (id: string | null) => {
    const m = people.find(p => p.id === id)
    return m ? nameOf(m) : 'None'
  }

  const select = (p: Person) => {
    setSelectedId(p.id)
    setForm(formFor(p))
    setOffboarding(null)
    setSuccessor('')
    setConfirmText('')
    setMessage('')
    setError('')
  }

  const targetIsAdmin = (selected?.role || '').toLowerCase() === 'admin'
  const canEditSelected = canManage && !!selected && (isAdmin || !targetIsAdmin)
  const isSelf = !!selected && selected.id === viewerId

  const save = async () => {
    if (!supabase || !selected || !form) return
    setBusy(true)
    setError('')
    setMessage('')
    const { error: rpcError } = await supabase.rpc('update_employee_record', {
      target: selected.id,
      new_full_name: form.full_name,
      new_department: form.department,
      new_job_title: form.job_title,
      new_manager: form.manager_id || null,
      new_role: isAdmin ? form.role : null,
      new_start_date: form.start_date || null,
    })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setMessage('Saved.')
    await load()
  }

  const startOffboarding = async () => {
    if (!supabase || !selected) return
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_offboarding_summary', {
      target: selected.id,
    })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setOffboarding(data as Offboarding)
  }

  const offboard = async () => {
    if (!supabase || !selected) return
    setBusy(true)
    setError('')
    setMessage('')
    const { data, error: rpcError } = await supabase.rpc('offboard_employee', {
      target: selected.id,
      successor: successor || null,
    })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const result = (data || {}) as { work_items_moved?: number; reports_moved?: number }
    setMessage(
      `${nameOf(selected)} is now a former employee. ${result.work_items_moved || 0} open task(s) and ${result.reports_moved || 0} report(s) were handed over.`
    )
    setOffboarding(null)
    setTab('former')
    await load()
  }

  const deleteForever = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await invokeWorkspaceAdmin({ action: 'delete-former', userId: selected.id })
      setMessage(`${nameOf(selected)} was permanently deleted.`)
      setSelectedId('')
      setForm(null)
      setConfirmText('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed.')
    }
    setBusy(false)
  }

  const successors = activePeople.filter(p => p.id !== selectedId)
  const managers = people.filter(p => p.active && p.id !== selectedId)

  return (
    <div className="glassCard workbench pdir">
      <div className="workbenchHead">
        <div>
          <h3>Employee directory</h3>
          <p>
            {canManage
              ? 'Search, edit and offboard people. Every change is recorded in the audit trail.'
              : 'Live company directory. Private employee headshots are not exposed here.'}
          </p>
        </div>
        <button type="button" className="glassButton" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="pdirMetrics">
        <div><Users size={16} /><span>Active</span><strong>{activePeople.length}</strong></div>
        {canManage && <div><UserMinus size={16} /><span>Former</span><strong>{formerPeople.length}</strong></div>}
        <div><UserRound size={16} /><span>Departments</span><strong>{departments.length}</strong></div>
      </div>

      <div className="pdirBar">
        {canManage && (
          <div className="pdirTabs">
            <button type="button" className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>
              Active ({activePeople.length})
            </button>
            <button type="button" className={tab === 'former' ? 'active' : ''} onClick={() => setTab('former')}>
              Former ({formerPeople.length})
            </button>
          </div>
        )}
        <label className="pdirSearch">
          <Search size={15} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, title or department"
            aria-label="Search employees"
          />
        </label>
        <select value={department} onChange={e => setDepartment(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {departments.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={role} onChange={e => setRole(e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>

      {message && <div className="moduleNotice">{message}</div>}
      {error && <div className="moduleNotice pdirError">{error}</div>}

      <div className="pdirSplit">
        <div className="moduleTableWrap">
          {loading ? (
            <div className="moduleNotice">Loading people...</div>
          ) : (
            <table className="moduleTable pdirTable">
              <thead>
                <tr><th>Name</th><th>Department</th><th>Job title</th><th>Role</th></tr>
              </thead>
              <tbody>
                {visible.map(p => (
                  <tr key={p.id} className={p.id === selectedId ? 'selected' : ''} onClick={() => select(p)}>
                    <td>
                      <strong>{nameOf(p)}</strong>
                      <small>{p.email}</small>
                    </td>
                    <td>{p.department || '-'}</td>
                    <td>{p.job_title || '-'}</td>
                    <td>{p.role || 'employee'}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr><td colSpan={4}>{tab === 'former' ? 'No former employees.' : 'No one matches.'}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <aside className="pdirPanel" aria-live="polite">
          {!selected || !form ? (
            <p className="pdirHint">Choose a person to see their record.</p>
          ) : (
            <>
              <span className="eyebrow">{selected.active ? 'EMPLOYEE' : 'FORMER EMPLOYEE'}</span>
              <h4>{nameOf(selected)}</h4>
              <p className="pdirHint">{selected.email}</p>

              {!canManage && (
                <dl className="pdirFacts">
                  <dt>Department</dt><dd>{selected.department || '-'}</dd>
                  <dt>Job title</dt><dd>{selected.job_title || '-'}</dd>
                  <dt>Reports to</dt><dd>{managerName(selected.manager_id)}</dd>
                </dl>
              )}

              {canManage && !canEditSelected && (
                <p className="pdirHint">Only an administrator can edit an administrator.</p>
              )}

              {canEditSelected && (
                <form
                  className="pdirForm"
                  onSubmit={e => {
                    e.preventDefault()
                    void save()
                  }}
                >
                  <label>Full name
                    <input value={form.full_name} required onChange={e => setForm({ ...form, full_name: e.target.value })} />
                  </label>
                  <label>Department
                    <input
                      list="pdir-departments"
                      value={form.department}
                      onChange={e => setForm({ ...form, department: e.target.value })}
                    />
                    <datalist id="pdir-departments">
                      {departments.map(d => <option key={d} value={d} />)}
                    </datalist>
                  </label>
                  <label>Job title
                    <input value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} />
                  </label>
                  <label>Start date (work anniversary on the calendar)
                    <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
                  </label>
                  <label>Reports to
                    <select value={form.manager_id} onChange={e => setForm({ ...form, manager_id: e.target.value })}>
                      <option value="">No manager</option>
                      {managers.map(m => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
                    </select>
                  </label>
                  {isAdmin ? (
                    <label>Role
                      <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                        {ROLES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </label>
                  ) : (
                    <p className="pdirHint">Role: {selected.role || 'employee'} (only an administrator can change it)</p>
                  )}
                  <button className="primaryButton" disabled={busy}>
                    <Save size={15} /> Save changes
                  </button>
                </form>
              )}

              {canEditSelected && selected.active && !isSelf && !targetIsAdmin && (
                <section className="pdirDanger">
                  <h5><UserMinus size={15} /> Offboard</h5>
                  {!offboarding ? (
                    <>
                      <p className="pdirHint">
                        Hands over their open work and direct reports, then moves them to Former employees.
                        Sign-in access stops.
                      </p>
                      <button type="button" className="glassButton" disabled={busy} onClick={() => void startOffboarding()}>
                        Review and offboard
                      </button>
                    </>
                  ) : (
                    <>
                      <ul className="pdirChecklist">
                        <li>
                          <strong>{offboarding.open_work.length}</strong> open task(s)
                          {offboarding.open_work.slice(0, 5).map(w => <small key={w.id}>{w.title}</small>)}
                        </li>
                        <li>
                          <strong>{offboarding.direct_reports.length}</strong> direct report(s)
                          {offboarding.direct_reports.slice(0, 5).map(r => <small key={r.id}>{r.full_name || r.email}</small>)}
                        </li>
                        <li>
                          <strong>{offboarding.devices.length}</strong> device(s) to collect
                          {offboarding.devices.map(d => (
                            <small key={d.id}>{d.asset_tag}{d.model ? ` · ${d.model}` : ''}</small>
                          ))}
                        </li>
                      </ul>
                      <label className="pdirLabel">Hand over to
                        <select value={successor} onChange={e => setSuccessor(e.target.value)}>
                          <option value="">No one (reports move up a level, tasks stay with them)</option>
                          {successors.map(m => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
                        </select>
                      </label>
                      <div className="buttonRow">
                        <button type="button" className="glassButton" disabled={busy} onClick={() => setOffboarding(null)}>
                          Cancel
                        </button>
                        <button type="button" className="primaryButton" disabled={busy} onClick={() => void offboard()}>
                          Offboard {nameOf(selected)}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}

              {canEditSelected && !selected.active && !isSelf && !targetIsAdmin && (
                <section className="pdirDanger">
                  <h5><AlertTriangle size={15} /> Delete permanently</h5>
                  <p className="pdirHint">
                    Erases the sign-in account and the profile. This cannot be undone. A person whose work
                    history is still linked elsewhere cannot be erased and stays under Former.
                  </p>
                  <label className="pdirLabel">Type {selected.email} to confirm
                    <input value={confirmText} onChange={e => setConfirmText(e.target.value)} autoComplete="off" />
                  </label>
                  <button
                    type="button"
                    className="pdirDeleteButton"
                    disabled={busy || confirmText.trim().toLowerCase() !== selected.email.toLowerCase()}
                    onClick={() => void deleteForever()}
                  >
                    <Trash2 size={15} /> Delete {nameOf(selected)} permanently
                  </button>
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

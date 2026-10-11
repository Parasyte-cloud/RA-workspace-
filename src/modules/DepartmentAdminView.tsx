import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  Laptop,
  RefreshCw,
  UserRound,
  Users,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../department-admin.css'

type TeamRow = {
  workstation: string
  employee_id: string
  full_name: string | null
  email: string
  job_title: string | null
  active: boolean
  last_seen_at: string | null
  rolling_score: number | null
  rolling_status: string | null
  current_badge: string | null
  device_count: number
  open_work: number
  overdue_work: number
  completed_30d: number
}

type Detail = {
  devices: {
    id: string
    asset_tag: string
    device_type: string | null
    manufacturer: string | null
    model: string | null
    operating_system: string | null
    status: string | null
  }[]
  open_work: {
    id: string
    title: string
    status: string
    priority: string
    due_at: string | null
  }[]
}

const DEPARTMENTS: Record<string, string> = {
  support: 'Support',
  operations: 'Operations',
  people: 'People & HR',
  engineering: 'Engineering',
  finance: 'Finance',
  marketing: 'Marketing',
  partnerships: 'Partnerships',
  legal: 'Legal & Compliance',
}

const when = (value: string | null | undefined) => {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const isOnline = (lastSeen: string | null | undefined) =>
  !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 10 * 60 * 1000

const num = (value: number | string | null | undefined) => Number(value || 0)

const label = (value: string | null | undefined) =>
  (value || '').replace(/_/g, ' ')

export default function DepartmentAdminView({
  onNavigate,
}: {
  onNavigate?: (section: string) => void
}) {
  const [rows, setRows] = useState<TeamRow[]>([])
  const [department, setDepartment] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [message, setMessage] = useState('')
  const detailRequestRef = useRef(0)

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }
    setLoading(true)
    setMessage('')
    const { data, error } = await supabase.rpc('get_department_team_overview')
    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }
    const next = ((data || []) as TeamRow[]).map(row => ({
      ...row,
      device_count: num(row.device_count),
      open_work: num(row.open_work),
      overdue_work: num(row.overdue_work),
      completed_30d: num(row.completed_30d),
    }))
    setRows(next)
    setDepartment(current =>
      current && next.some(row => row.workstation === current)
        ? current
        : next[0]?.workstation || ''
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const departments = useMemo(
    () => Array.from(new Set(rows.map(row => row.workstation))),
    [rows]
  )

  const team = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter(row => row.workstation === department)
      .filter(
        row =>
          !q ||
          [row.full_name, row.email, row.job_title].some(value =>
            String(value || '').toLowerCase().includes(q)
          )
      )
  }, [rows, department, search])

  const everyone = useMemo(
    () => rows.filter(row => row.workstation === department),
    [rows, department]
  )

  const selected = everyone.find(row => row.employee_id === selectedId) || null

  const openPerson = useCallback(async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    setMessage('')
    if (!supabase) return
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    const { data, error } = await supabase.rpc('get_department_member_detail', {
      target_user: id,
    })
    if (requestId !== detailRequestRef.current) return
    if (error) setMessage(error.message)
    else setDetail(data as Detail)
    setDetailLoading(false)
  }, [])

  const onlineCount = everyone.filter(row => isOnline(row.last_seen_at)).length
  const openCount = everyone.reduce((sum, row) => sum + row.open_work, 0)
  const overdueCount = everyone.reduce((sum, row) => sum + row.overdue_work, 0)
  const title = DEPARTMENTS[department] || department

  if (!loading && !rows.length && !message) {
    return (
      <section className="glassCard dahEmpty">
        <h3>Department Admin</h3>
        <p>You are not head of a department yet. An administrator can name you in Workstation Control.</p>
      </section>
    )
  }

  return (
    <section className="dah">
      <div className="glassCard dahHeader">
        <div>
          <span className="eyebrow">DEPARTMENT ADMIN</span>
          <h2>{title ? `${title} team` : 'Your team'}</h2>
          <p>
            You can see the people in your department and manage their work. This view does not
            show home addresses, sign-in locations, IP addresses or equipment serial numbers, and
            every time you open a person it is recorded in the audit trail.
          </p>
        </div>
        <div className="buttonRow">
          {onNavigate && (
            <button type="button" className="glassButton" onClick={() => onNavigate('tasks')}>
              <BriefcaseBusiness size={16} />
              Open Work Desk
            </button>
          )}
          <button type="button" className="glassButton" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {departments.length > 1 && (
        <div className="dahTabs">
          {departments.map(key => (
            <button
              key={key}
              type="button"
              className={key === department ? 'active' : ''}
              onClick={() => {
                setDepartment(key)
                setSelectedId('')
                setDetail(null)
              }}
            >
              {DEPARTMENTS[key] || key}
            </button>
          ))}
        </div>
      )}

      {message && <div className="moduleNotice">{message}</div>}

      <div className="dahMetrics">
        <div className="glassCard dahMetric"><Users size={18} /><span>People</span><strong>{everyone.length}</strong></div>
        <div className="glassCard dahMetric"><Activity size={18} /><span>Online now</span><strong>{onlineCount}</strong></div>
        <div className="glassCard dahMetric"><BriefcaseBusiness size={18} /><span>Open work</span><strong>{openCount}</strong></div>
        <div className="glassCard dahMetric"><AlertTriangle size={18} /><span>Overdue</span><strong>{overdueCount}</strong></div>
      </div>

      <div className="dahSplit">
        <div className="glassCard dahTableWrap">
          <div className="dahToolbar">
            <input
              className="dahSearch"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search your team"
              aria-label="Search your team"
            />
          </div>

          {loading ? (
            <div className="dahNote">Loading your team...</div>
          ) : (
            <table className="dahTable">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Status</th>
                  <th>Performance</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th>Done (30d)</th>
                </tr>
              </thead>
              <tbody>
                {team.map(row => (
                  <tr
                    key={row.employee_id}
                    className={row.employee_id === selectedId ? 'selected' : ''}
                    onClick={() => void openPerson(row.employee_id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="dahPerson"
                        onClick={event => {
                          event.stopPropagation()
                          void openPerson(row.employee_id)
                        }}
                      >
                        <UserRound size={15} />
                        <span>
                          <strong>{row.full_name || row.email}</strong>
                          <small>{row.job_title || row.email}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className={isOnline(row.last_seen_at) ? 'dahDot on' : 'dahDot'} />
                      {isOnline(row.last_seen_at) ? 'Online' : 'Offline'}
                    </td>
                    <td>
                      {row.rolling_score === null || row.rolling_score === undefined
                        ? 'Not scored'
                        : `${Number(row.rolling_score).toFixed(1)}%`}
                      {row.rolling_status ? <small>{label(row.rolling_status)}</small> : null}
                    </td>
                    <td>{row.open_work}</td>
                    <td className={row.overdue_work > 0 ? 'dahWarn' : ''}>{row.overdue_work}</td>
                    <td>{row.completed_30d}</td>
                  </tr>
                ))}
                {!team.length && (
                  <tr>
                    <td colSpan={6} className="dahNote">No one matches.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <aside className="glassCard dahDetail" aria-live="polite">
          {!selected ? (
            <div className="dahNote">Choose a person to see their equipment and open work.</div>
          ) : (
            <>
              <span className="eyebrow">TEAM MEMBER</span>
              <h3>{selected.full_name || selected.email}</h3>
              <p>{selected.job_title || 'No job title'} · {selected.email}</p>
              <p>
                Last seen: {when(selected.last_seen_at)}
                {selected.current_badge ? ` · Badge: ${selected.current_badge}` : ''}
              </p>

              {detailLoading && <div className="dahNote">Loading...</div>}

              {detail && (
                <>
                  <h4><Laptop size={15} /> Equipment ({detail.devices.length})</h4>
                  {detail.devices.length ? (
                    <ul className="dahList">
                      {detail.devices.map(device => (
                        <li key={device.id}>
                          <strong>{device.asset_tag}</strong>
                          <span>
                            {[device.manufacturer, device.model].filter(Boolean).join(' ') ||
                              label(device.device_type) ||
                              'Device'}
                            {device.status ? ` · ${label(device.status)}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dahNote">No equipment assigned.</p>
                  )}

                  <h4><BriefcaseBusiness size={15} /> Open work ({detail.open_work.length})</h4>
                  {detail.open_work.length ? (
                    <ul className="dahList">
                      {detail.open_work.map(work => (
                        <li key={work.id}>
                          <strong>{work.title}</strong>
                          <span>
                            {label(work.status)} · {work.priority}
                            {work.due_at ? ` · due ${new Date(work.due_at).toLocaleDateString()}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dahNote">Nothing open.</p>
                  )}
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

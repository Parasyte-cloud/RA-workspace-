import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { lagosToday } from '../lib/lagosDate'
import '../my-leave.css'

type Leave = {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'declined' | 'cancelled'
  created_at: string
}

const TYPES = ['Annual', 'Sick', 'Casual', 'Maternity', 'Paternity', 'Compassionate', 'Unpaid']
const STATUS_LABEL: Record<Leave['status'], string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

const fmt = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

const dayCount = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000) + 1

// Request leave and follow it afterwards. Lives on My Profile so a person can
// always find their own requests and see the decision.
export default function MyLeave() {
  const todayKey = lagosToday()
  const [rows, setRows] = useState<Leave[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ leave_type: 'Annual', start_date: '', end_date: '', reason: '' })

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setLoading(false); return }
    const { data, error } = await client
      .from('leave_requests')
      .select('id,leave_type,start_date,end_date,reason,status,created_at')
      .eq('employee_id', auth.user.id)
      .order('start_date', { ascending: false })
      .limit(50)
    if (error) setMessage(error.message)
    else setRows((data || []) as Leave[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel('my-leave')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => { void load() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const client = supabase
    if (!client || busy) return
    if (form.end_date < form.start_date) { setMessage('The last day cannot be before the first day.'); return }
    setBusy(true)
    setMessage('')
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setBusy(false); setMessage('Your session expired. Sign in again.'); return }
    const { error } = await client.from('leave_requests').insert({
      employee_id: auth.user.id,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason.trim() || null,
    })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setMessage('Request sent. Your manager and HR have been told.')
    setForm({ leave_type: 'Annual', start_date: '', end_date: '', reason: '' })
    setOpen(false)
    await load()
  }

  const cancel = async (row: Leave) => {
    const client = supabase
    if (!client || !window.confirm(`Cancel your ${row.leave_type.toLowerCase()} leave from ${fmt(row.start_date)}?`)) return
    const { error } = await client.rpc('cancel_leave_request', { p_id: row.id })
    if (error) { setMessage(error.message); return }
    setMessage('Request cancelled.')
    await load()
  }

  return (
    <div className="glassCard myLeave" id="my-leave">
      <div className="myLeaveHead">
        <div>
          <span className="eyebrow">TIME OFF</span>
          <h3>My leave</h3>
          <p>Ask for time off and follow the answer. Approved leave shows on the team calendar as dates only.</p>
        </div>
        <button type="button" className={open ? 'glassButton' : 'primaryButton'} onClick={() => setOpen(current => !current)}>
          <CalendarDays size={15} />{open ? 'Close' : 'Request leave'}
        </button>
      </div>

      {message && <div className="moduleNotice">{message}</div>}

      {open && (
        <form className="myLeaveForm" onSubmit={submit}>
          <label>Type
            <select value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>First day
            <input type="date" required min={todayKey} value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value, end_date: form.end_date && form.end_date < e.target.value ? e.target.value : form.end_date })} />
          </label>
          <label>Last day
            <input type="date" required min={form.start_date || todayKey} value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
          </label>
          <label className="wide">Reason (optional)
            <textarea rows={2} maxLength={500} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
          </label>
          <button type="submit" className="primaryButton" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</button>
        </form>
      )}

      {loading ? (
        <p className="myLeaveNone"><Loader2 size={14} /> Loading...</p>
      ) : rows.length === 0 ? (
        <p className="myLeaveNone">You have not asked for any leave yet.</p>
      ) : (
        <ul className="myLeaveList">
          {rows.map(row => (
            <li key={row.id}>
              <div>
                <strong>{row.leave_type}</strong>
                <small>
                  {fmt(row.start_date)}{row.end_date !== row.start_date ? ` to ${fmt(row.end_date)}` : ''}
                  {' · '}{dayCount(row.start_date, row.end_date)} day{dayCount(row.start_date, row.end_date) === 1 ? '' : 's'}
                </small>
              </div>
              <span className={`myLeaveBadge ${row.status}`}>{STATUS_LABEL[row.status]}</span>
              {row.status === 'pending' && (
                <button type="button" className="glassButton" onClick={() => void cancel(row)}>Cancel</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

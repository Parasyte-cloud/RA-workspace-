import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Cake,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flag,
  Medal,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../calendar.css'

type Kind = 'event' | 'birthday' | 'anniversary' | 'holiday' | 'festival'

type Item = {
  id: string
  kind: Kind
  title: string
  date: string
  time?: string
  sub?: string
  url?: string | null
  eventId?: string
}

type EventRow = {
  id: string
  title: string
  description: string | null
  event_type: string | null
  location: string | null
  meeting_url: string | null
  starts_at: string
  all_day: boolean
}

type Occasion = {
  kind: 'birthday' | 'anniversary' | 'holiday' | 'festival'
  title: string
  occurs_on: string
  employee_id: string | null
  years: number | null
  approximate: boolean
  note: string | null
}

type Festival = {
  id: string
  name: string
  kind: 'holiday' | 'festival'
  month: number
  day: number
  year: number | null
  approximate: boolean
  note: string | null
}

const KIND_LABEL: Record<Kind, string> = {
  event: 'Events',
  birthday: 'Birthdays',
  anniversary: 'Anniversaries',
  holiday: 'Public holidays',
  festival: 'Festivals',
}

const ALL_KINDS: Kind[] = ['event', 'birthday', 'anniversary', 'holiday', 'festival']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const EVENT_TYPES = ['Meeting', 'Deadline', 'Company event', 'Training', 'Other']

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

function KindIcon({ kind, size = 13 }: { kind: Kind; size?: number }) {
  if (kind === 'birthday') return <Cake size={size} />
  if (kind === 'anniversary') return <Medal size={size} />
  if (kind === 'holiday' || kind === 'festival') return <Flag size={size} />
  return <CalendarDays size={size} />
}

export default function WorkspaceCalendar() {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(keyOf(today))
  const [events, setEvents] = useState<EventRow[]>([])
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [show, setShow] = useState<Set<Kind>>(new Set(ALL_KINDS))
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [festivalsOpen, setFestivalsOpen] = useState(false)
  const [festivals, setFestivals] = useState<Festival[]>([])

  const canEvents = ['hr', 'admin', 'manager'].includes(role)
  const canFestivals = ['hr', 'admin'].includes(role)

  const offset = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7
  const gridStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1 - offset), [cursor, offset])
  const gridEnd = useMemo(() => addDays(gridStart, 41), [gridStart])

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    setLoading(true)
    const [eventResult, occasionResult] = await Promise.all([
      client
        .from('workspace_events')
        .select('id,title,description,event_type,location,meeting_url,starts_at,all_day')
        .gte('starts_at', gridStart.toISOString())
        .lt('starts_at', addDays(gridEnd, 1).toISOString())
        .order('starts_at', { ascending: true }),
      client.rpc('get_calendar_occasions', { p_from: keyOf(gridStart), p_to: keyOf(gridEnd) }),
    ])
    if (eventResult.error) setNotice(eventResult.error.message)
    else setEvents((eventResult.data || []) as EventRow[])
    if (occasionResult.error) {
      setNotice(
        /get_calendar_occasions/.test(occasionResult.error.message)
          ? 'Birthdays, anniversaries and festivals need the calendar migration 20261012130000_calendar_occasions.sql.'
          : occasionResult.error.message,
      )
      setOccasions([])
    } else {
      setOccasions((occasionResult.data || []) as Occasion[])
    }
    setLoading(false)
  }, [gridStart, gridEnd])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const client = supabase
    if (!client) return
    void (async () => {
      const { data: auth } = await client.auth.getUser()
      if (!auth.user) return
      const { data } = await client.from('employee_profiles').select('role').eq('id', auth.user.id).maybeSingle()
      setRole(String(data?.role || 'employee').toLowerCase())
    })()
  }, [])

  const items = useMemo(() => {
    const out: Item[] = []
    for (const e of events) {
      const start = new Date(e.starts_at)
      out.push({
        id: `e-${e.id}`,
        eventId: e.id,
        kind: 'event',
        title: e.title,
        date: keyOf(start),
        time: e.all_day ? 'All day' : start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        sub: [e.event_type, e.location].filter(Boolean).join(' · ') || undefined,
        url: e.meeting_url,
      })
    }
    for (const o of occasions) {
      const name = o.title
      out.push({
        id: `o-${o.kind}-${o.occurs_on}-${o.employee_id || name}`,
        kind: o.kind,
        title:
          o.kind === 'birthday' ? `${name}'s birthday`
          : o.kind === 'anniversary' ? `${name}: ${o.years} year${o.years === 1 ? '' : 's'} at RideArrivo`
          : name,
        date: o.occurs_on,
        time: 'All day',
        sub: o.approximate ? 'Date to be confirmed' : undefined,
      })
    }
    return out.filter(item => show.has(item.kind))
  }, [events, occasions, show])

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const item of items) {
      const list = map.get(item.date) || []
      list.push(item)
      map.set(item.date, list)
    }
    return map
  }, [items])

  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart])
  const todayKey = keyOf(today)
  const dayItems = byDay.get(selected) || []
  const coming = useMemo(
    () => items.filter(i => i.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8),
    [items, todayKey],
  )

  const toggle = (kind: Kind) =>
    setShow(current => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  const move = (months: number) => setCursor(current => new Date(current.getFullYear(), current.getMonth() + months, 1))
  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelected(todayKey)
  }

  // Add event
  const [form, setForm] = useState({ title: '', date: todayKey, allDay: false, start: '09:00', end: '', location: '', url: '', type: 'Meeting', description: '' })

  const saveEvent = async (event: FormEvent) => {
    event.preventDefault()
    const client = supabase
    if (!client || !form.title.trim()) return
    const { data: auth } = await client.auth.getUser()
    const [y, m, d] = form.date.split('-').map(Number)
    const startsAt = form.allDay ? new Date(y, m - 1, d, 0, 0) : new Date(`${form.date}T${form.start || '09:00'}`)
    const endsAt = !form.allDay && form.end ? new Date(`${form.date}T${form.end}`) : null
    if (endsAt && endsAt < startsAt) { setNotice('The end time must be after the start time.'); return }
    const { error } = await client.from('workspace_events').insert({
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_type: form.type,
      location: form.location.trim() || null,
      meeting_url: form.url.trim() || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      all_day: form.allDay,
      created_by: auth.user?.id || null,
    })
    if (error) { setNotice(error.message); return }
    setNotice('')
    setAdding(false)
    setForm({ ...form, title: '', description: '', location: '', url: '' })
    setSelected(form.date)
    setCursor(new Date(y, m - 1, 1))
    await load()
  }

  const removeEvent = async (item: Item) => {
    const client = supabase
    if (!client || !item.eventId) return
    if (!window.confirm(`Delete "${item.title}" from the calendar?`)) return
    const { error } = await client.from('workspace_events').delete().eq('id', item.eventId)
    if (error) { setNotice(error.message); return }
    await load()
  }

  // Festivals
  const loadFestivals = useCallback(async () => {
    const client = supabase
    if (!client) return
    const { data, error } = await client.from('workspace_festivals').select('*').order('month').order('day')
    if (error) { setNotice(error.message); return }
    setFestivals((data || []) as Festival[])
  }, [])

  useEffect(() => { if (festivalsOpen) void loadFestivals() }, [festivalsOpen, loadFestivals])

  const [fest, setFest] = useState({ name: '', date: todayKey, yearly: true, kind: 'holiday' as 'holiday' | 'festival' })

  const addFestival = async (event: FormEvent) => {
    event.preventDefault()
    const client = supabase
    if (!client || !fest.name.trim()) return
    const [y, m, d] = fest.date.split('-').map(Number)
    const { error } = await client.from('workspace_festivals').insert({
      name: fest.name.trim(), kind: fest.kind, month: m, day: d, year: fest.yearly ? null : y,
    })
    if (error) { setNotice(error.message); return }
    setNotice('')
    setFest({ ...fest, name: '' })
    await Promise.all([loadFestivals(), load()])
  }

  const removeFestival = async (f: Festival) => {
    const client = supabase
    if (!client) return
    if (!window.confirm(`Remove ${f.name}${f.year ? ` (${f.year})` : ''}?`)) return
    const { error } = await client.from('workspace_festivals').delete().eq('id', f.id)
    if (error) { setNotice(error.message); return }
    await Promise.all([loadFestivals(), load()])
  }

  const confirmFestival = async (f: Festival) => {
    const client = supabase
    if (!client) return
    const { error } = await client.from('workspace_festivals').update({ approximate: false, note: null }).eq('id', f.id)
    if (error) { setNotice(error.message); return }
    await Promise.all([loadFestivals(), load()])
  }

  const selectedDate = new Date(`${selected}T00:00:00`)

  return (
    <section className="wcal">
      <div className="wcalHead glassCard">
        <div>
          <span className="eyebrow">MY WORK</span>
          <h2>Calendar</h2>
          <p>Company events, birthdays, work anniversaries and festivals. Birthdays and anniversaries appear on their own once the date is saved.</p>
        </div>
        <div className="buttonRow">
          {canFestivals && (
            <button type="button" className="glassButton" onClick={() => setFestivalsOpen(open => !open)}>
              <Flag size={15} />Holidays and festivals
            </button>
          )}
          {canEvents && (
            <button type="button" className="primaryButton" onClick={() => setAdding(open => !open)}>
              {adding ? <X size={15} /> : <Plus size={15} />}{adding ? 'Close' : 'Add event'}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="moduleNotice">{notice}</div>}

      {adding && canEvents && (
        <form className="glassCard wcalForm" onSubmit={saveEvent}>
          <label>Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Type
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Date<input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
          <label className="wcalCheck"><input type="checkbox" checked={form.allDay} onChange={e => setForm({ ...form, allDay: e.target.checked })} />All day</label>
          {!form.allDay && (
            <>
              <label>Starts<input type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></label>
              <label>Ends<input type="time" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></label>
            </>
          )}
          <label>Location<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></label>
          <label>Meeting link<input type="url" placeholder="https://" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label>
          <label className="wide">Notes<textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <button className="primaryButton" type="submit">Save event</button>
        </form>
      )}

      {festivalsOpen && canFestivals && (
        <div className="glassCard wcalFest">
          <h3>Holidays and festivals</h3>
          <p>These show on everyone's calendar. Dates marked "to be confirmed" depend on the moon being sighted: correct them when the government announces the day.</p>
          <form className="wcalFestForm" onSubmit={addFestival}>
            <input required placeholder="Name, for example Eid-el-Kabir" value={fest.name} onChange={e => setFest({ ...fest, name: e.target.value })} />
            <input type="date" required value={fest.date} onChange={e => setFest({ ...fest, date: e.target.value })} />
            <select value={fest.kind} onChange={e => setFest({ ...fest, kind: e.target.value as 'holiday' | 'festival' })}>
              <option value="holiday">Public holiday</option>
              <option value="festival">Festival</option>
            </select>
            <label className="wcalCheck"><input type="checkbox" checked={fest.yearly} onChange={e => setFest({ ...fest, yearly: e.target.checked })} />Repeats every year</label>
            <button className="primaryButton" type="submit"><Plus size={15} />Add</button>
          </form>
          <ul className="wcalFestList">
            {festivals.map(f => (
              <li key={f.id}>
                <span><strong>{f.name}</strong> <small>{MONTHS[f.month - 1]} {f.day}{f.year ? `, ${f.year}` : ', every year'}{f.approximate ? ' · to be confirmed' : ''}</small></span>
                <span className="buttonRow">
                  {f.approximate && <button type="button" className="glassButton" onClick={() => void confirmFestival(f)}>Confirmed</button>}
                  <button type="button" className="glassButton danger" onClick={() => void removeFestival(f)} aria-label={`Remove ${f.name}`}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wcalLayout">
        <div className="glassCard wcalMain">
          <div className="wcalNav">
            <div className="buttonRow">
              <button type="button" className="wcalIcon" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <button type="button" className="wcalIcon" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={18} /></button>
              <button type="button" className="glassButton" onClick={goToday}>Today</button>
            </div>
            <h3>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h3>
          </div>

          <div className="wcalChips" role="group" aria-label="Show on calendar">
            {ALL_KINDS.map(kind => (
              <button key={kind} type="button" className={`wcalChip ${kind} ${show.has(kind) ? 'on' : ''}`} aria-pressed={show.has(kind)} onClick={() => toggle(kind)}>
                <KindIcon kind={kind} />{KIND_LABEL[kind]}
              </button>
            ))}
          </div>

          <div className="wcalGrid" role="grid" aria-busy={loading}>
            {WEEKDAYS.map(d => <div key={d} className="wcalDow" role="columnheader">{d}</div>)}
            {cells.map(cell => {
              const key = keyOf(cell)
              const list = byDay.get(key) || []
              const outside = cell.getMonth() !== cursor.getMonth()
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={`wcalCell${outside ? ' outside' : ''}${key === todayKey ? ' today' : ''}${key === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(key)}
                  aria-label={`${cell.toDateString()}, ${list.length} item${list.length === 1 ? '' : 's'}`}
                >
                  <span className="wcalNum">{cell.getDate()}</span>
                  <span className="wcalChipsCol">
                    {list.slice(0, 3).map(item => <span key={item.id} className={`wcalTag ${item.kind}`}>{item.title}</span>)}
                    {list.length > 3 && <span className="wcalMore">+{list.length - 3} more</span>}
                  </span>
                  <span className="wcalDots">{list.slice(0, 4).map(item => <i key={item.id} className={item.kind} />)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="wcalSide">
          <div className="glassCard">
            <span className="eyebrow">{selectedDate.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}</span>
            <h3>{selectedDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
            {dayItems.length === 0 && <p className="wcalNone">Nothing on this day.</p>}
            <ul className="wcalList">
              {dayItems.map(item => (
                <li key={item.id} className={item.kind}>
                  <span className="wcalIco"><KindIcon kind={item.kind} size={15} /></span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{[item.time, item.sub].filter(Boolean).join(' · ')}</small>
                    {item.url && <a href={item.url} target="_blank" rel="noreferrer">Join meeting <ExternalLink size={12} /></a>}
                  </div>
                  {item.eventId && canEvents && (
                    <button type="button" className="wcalIcon" onClick={() => void removeEvent(item)} aria-label={`Delete ${item.title}`}><Trash2 size={14} /></button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="glassCard">
            <span className="eyebrow">COMING UP</span>
            <ul className="wcalList">
              {coming.map(item => (
                <li key={item.id} className={item.kind}>
                  <span className="wcalIco"><KindIcon kind={item.kind} size={15} /></span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</small>
                  </div>
                </li>
              ))}
              {coming.length === 0 && <li className="wcalNone">Nothing coming up in this view.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  )
}

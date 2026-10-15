import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Cake,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Flag,
  MapPin,
  Medal,
  Pencil,
  Plane,
  Plus,
  Repeat,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  RECURRENCE_LABEL,
  addDays,
  buildIcs,
  expandEvent,
  keyOf,
  lastDayKey,
  layoutDay,
  occursOnDay,
  parseKey,
  startOfDay,
  startOfWeek,
} from '../lib/calendarLogic'
import type { Recurrence } from '../lib/calendarLogic'
import CalendarEventEditor from './CalendarEventEditor'
import type { EventForm, Person, Visibility } from './CalendarEventEditor'
import '../calendar.css'
import { safeHttpUrl } from '../lib/safeUrl'

type Kind = 'event' | 'birthday' | 'anniversary' | 'holiday' | 'festival' | 'leave'
type View = 'month' | 'week' | 'day' | 'agenda'
type Response = 'pending' | 'going' | 'maybe' | 'declined'

export type EventRow = {
  id: string
  title: string
  description: string | null
  event_type: string | null
  location: string | null
  meeting_url: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  recurrence: Recurrence
  recurrence_until: string | null
  visibility: Visibility
  reminder_minutes: number | null
  created_by: string | null
}

type Item = {
  id: string
  kind: Kind
  title: string
  start: Date
  end: Date
  allDay: boolean
  sub?: string
  event?: EventRow
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

type LeaveRow = { employee_id: string; full_name: string; start_date: string; end_date: string }
type AttendeeRow = { event_id: string; employee_id: string; response: Response }
type Festival = {
  id: string; name: string; kind: 'holiday' | 'festival'; month: number; day: number
  year: number | null; approximate: boolean; note: string | null
}

const KIND_LABEL: Record<Kind, string> = {
  event: 'Events',
  birthday: 'Birthdays',
  anniversary: 'Anniversaries',
  holiday: 'Public holidays',
  festival: 'Festivals',
  leave: 'On leave',
}
const ALL_KINDS: Kind[] = ['event', 'birthday', 'anniversary', 'holiday', 'festival', 'leave']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const VIEW_LABEL: Record<View, string> = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda' }
const HOUR_PX = 52
const AGENDA_DAYS = 60
const OPEN_EVENT_KEY = 'ra.calendar.event'

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const dayLabel = (key: string) => parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

function KindIcon({ kind, size = 13 }: { kind: Kind; size?: number }) {
  if (kind === 'birthday') return <Cake size={size} />
  if (kind === 'anniversary') return <Medal size={size} />
  if (kind === 'holiday' || kind === 'festival') return <Flag size={size} />
  if (kind === 'leave') return <Plane size={size} />
  return <CalendarDays size={size} />
}

function emptyForm(dateKey: string, startTime = '09:00', canPublish = true): EventForm {
  const [h, m] = startTime.split(':').map(Number)
  const end = `${pad(Math.min(23, h + 1))}:${pad(m)}`
  return {
    title: '', type: 'Meeting', startDate: dateKey, endDate: dateKey, allDay: false,
    start: startTime, end, recurrence: 'none', until: '', visibility: canPublish ? 'everyone' : 'invited',
    location: '', url: '', description: '', reminder: '10', invitees: [],
  }
}

function formFromEvent(ev: EventRow, invitees: string[]): EventForm {
  const start = new Date(ev.starts_at)
  const end = ev.ends_at ? new Date(ev.ends_at) : null
  return {
    title: ev.title,
    type: ev.event_type || 'Meeting',
    startDate: keyOf(start),
    endDate: end ? (ev.all_day ? lastDayKey(start, end) : keyOf(end)) : keyOf(start),
    allDay: ev.all_day,
    start: hhmm(start),
    end: end && !ev.all_day ? hhmm(end) : '',
    recurrence: ev.recurrence || 'none',
    until: ev.recurrence_until || '',
    visibility: ev.visibility || 'everyone',
    location: ev.location || '',
    url: ev.meeting_url || '',
    description: ev.description || '',
    reminder: ev.reminder_minutes == null ? '' : String(ev.reminder_minutes),
    invitees,
  }
}

export default function WorkspaceCalendar() {
  const today = useMemo(() => new Date(), [])
  const todayKey = keyOf(today)
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'agenda' : 'month'))
  const [anchor, setAnchor] = useState(() => startOfDay(today))
  const [events, setEvents] = useState<EventRow[]>([])
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [leave, setLeave] = useState<LeaveRow[]>([])
  const [attendees, setAttendees] = useState<AttendeeRow[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [show, setShow] = useState<Set<Kind>>(new Set(ALL_KINDS))
  const [mineOnly, setMineOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [meId, setMeId] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [picked, setPicked] = useState<Item | null>(null)
  const [editor, setEditor] = useState<{ form: EventForm; id: string | null; owner: string | null } | null>(null)
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)
  const [festivalsOpen, setFestivalsOpen] = useState(false)
  const [festivals, setFestivals] = useState<Festival[]>([])
  const gridRef = useRef<HTMLDivElement | null>(null)

  const canPublish = ['hr', 'admin', 'manager'].includes(role)
  const canFestivals = ['hr', 'admin'].includes(role)
  const anchorKey = keyOf(anchor)

  // The dates on screen for the current view.
  const range = useMemo(() => {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const from = startOfWeek(first)
      return { from, to: addDays(from, 42) }
    }
    if (view === 'week') {
      const from = startOfWeek(anchor)
      return { from, to: addDays(from, 7) }
    }
    if (view === 'day') return { from: anchor, to: addDays(anchor, 1) }
    return { from: anchor, to: addDays(anchor, AGENDA_DAYS) }
  }, [view, anchor])
  const fromKey = keyOf(range.from)
  const toKey = keyOf(range.to)

  const load = useCallback(async () => {
    const client = supabase
    if (!client) { setLoading(false); return }
    const from = parseKey(fromKey)
    const to = parseKey(toKey)
    const lastKey = keyOf(addDays(to, -1))
    const [eventResult, occasionResult, leaveResult] = await Promise.all([
      client
        .from('workspace_events')
        .select('id,title,description,event_type,location,meeting_url,starts_at,ends_at,all_day,recurrence,recurrence_until,visibility,reminder_minutes,created_by')
        .lt('starts_at', to.toISOString())
        .or(`recurrence.neq.none,starts_at.gte.${from.toISOString()},ends_at.gte.${from.toISOString()}`)
        .order('starts_at', { ascending: true })
        .limit(1000),
      client.rpc('get_calendar_occasions', { p_from: fromKey, p_to: lastKey }),
      client.rpc('get_calendar_leave', { p_from: fromKey, p_to: lastKey }),
    ])

    const problems: string[] = []
    if (eventResult.error) {
      problems.push(/recurrence|visibility|reminder/.test(eventResult.error.message)
        ? 'The full calendar needs the migration 20261012140000_calendar_full.sql.'
        : eventResult.error.message)
    } else {
      setEvents((eventResult.data || []) as EventRow[])
    }
    if (occasionResult.error) {
      problems.push(/get_calendar_occasions/.test(occasionResult.error.message)
        ? 'Birthdays, anniversaries and festivals need the migration 20261012130000_calendar_occasions.sql.'
        : occasionResult.error.message)
      setOccasions([])
    } else {
      setOccasions((occasionResult.data || []) as Occasion[])
    }
    if (leaveResult.error) setLeave([])
    else setLeave((leaveResult.data || []) as LeaveRow[])
    setNotice(problems[0] || '')

    const ids = ((eventResult.data || []) as EventRow[]).map(e => e.id)
    if (ids.length) {
      const { data } = await client.from('workspace_event_attendees').select('event_id,employee_id,response').in('event_id', ids)
      setAttendees((data || []) as AttendeeRow[])
    } else {
      setAttendees([])
    }
    setLoading(false)
  }, [fromKey, toKey])

  useEffect(() => { void load() }, [load])

  // Who I am, and the people I can invite.
  useEffect(() => {
    const client = supabase
    if (!client) return
    void (async () => {
      const { data: auth } = await client.auth.getUser()
      if (!auth.user) return
      setMeId(auth.user.id)
      const [{ data: me }, { data: list }] = await Promise.all([
        client.from('employee_profiles').select('role').eq('id', auth.user.id).maybeSingle(),
        client.from('employee_profiles').select('id,full_name,email').eq('active', true).order('full_name'),
      ])
      setRole(String(me?.role || 'employee').toLowerCase())
      setPeople(((list || []) as { id: string; full_name: string | null; email: string }[]).map(p => ({
        id: p.id,
        name: p.full_name?.trim() || p.email,
      })))
    })()
  }, [])

  // Stay current when someone else adds or changes an event.
  useEffect(() => {
    const client = supabase
    if (!client) return
    let timer: number | null = null
    const refresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(), 400)
    }
    const channel = client
      .channel('workspace-calendar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_events' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_event_attendees' }, refresh)
      .subscribe()
    return () => {
      if (timer) window.clearTimeout(timer)
      void client.removeChannel(channel)
    }
  }, [load])

  // Opened from an invitation: jump to that event.
  useEffect(() => {
    const client = supabase
    let id = ''
    try { id = sessionStorage.getItem(OPEN_EVENT_KEY) || ''; sessionStorage.removeItem(OPEN_EVENT_KEY) } catch { /* nothing remembered */ }
    if (!client || !id) return
    void (async () => {
      const { data } = await client.from('workspace_events').select('starts_at').eq('id', id).maybeSingle()
      if (data?.starts_at) setAnchor(startOfDay(new Date(data.starts_at as string)))
    })()
  }, [])

  const myResponse = useCallback(
    (eventId: string): Response | null => attendees.find(a => a.event_id === eventId && a.employee_id === meId)?.response || null,
    [attendees, meId],
  )

  const items = useMemo(() => {
    const out: Item[] = []
    for (const ev of events) {
      if (mineOnly && ev.created_by !== meId && !myResponse(ev.id)) continue
      for (const occ of expandEvent(ev, range.from, range.to)) {
        const allDay = ev.all_day
        out.push({
          id: `e-${ev.id}-${occ.start.getTime()}`,
          kind: 'event',
          title: ev.title,
          start: occ.start,
          end: occ.end,
          allDay,
          event: ev,
          sub: [ev.event_type, ev.location].filter(Boolean).join(' · ') || undefined,
        })
      }
    }
    for (const o of occasions) {
      const day = parseKey(o.occurs_on)
      out.push({
        id: `o-${o.kind}-${o.occurs_on}-${o.employee_id || o.title}`,
        kind: o.kind,
        title:
          o.kind === 'birthday' ? `${o.title}'s birthday`
          : o.kind === 'anniversary' ? `${o.title}: ${o.years} year${o.years === 1 ? '' : 's'} at RideArrivo`
          : o.title,
        start: day,
        end: addDays(day, 1),
        allDay: true,
        sub: o.approximate ? 'Date to be confirmed' : undefined,
      })
    }
    for (const l of leave) {
      out.push({
        id: `l-${l.employee_id}-${l.start_date}`,
        kind: 'leave',
        title: `${l.full_name} is on leave`,
        start: parseKey(l.start_date),
        end: addDays(parseKey(l.end_date), 1),
        allDay: true,
        sub: `${dayLabel(l.start_date)} to ${dayLabel(l.end_date)}`,
      })
    }
    const q = query.trim().toLowerCase()
    return out
      .filter(i => show.has(i.kind))
      .filter(i => !q || `${i.title} ${i.sub || ''} ${i.event?.description || ''}`.toLowerCase().includes(q))
  }, [events, occasions, leave, range, show, mineOnly, query, meId, myResponse])

  const itemsOn = useCallback(
    (key: string) =>
      items
        .filter(i => occursOnDay(i.start, i.end, key))
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime()),
    [items],
  )

  const toggle = (kind: Kind) =>
    setShow(current => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  const step = useCallback((dir: number) => {
    setAnchor(current => {
      if (view === 'month') {
        const month = new Date(current.getFullYear(), current.getMonth() + dir, 1)
        const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
        return new Date(month.getFullYear(), month.getMonth(), Math.min(current.getDate(), last))
      }
      if (view === 'week') return addDays(current, 7 * dir)
      if (view === 'day') return addDays(current, dir)
      return addDays(current, 30 * dir)
    })
  }, [view])

  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), [])

  const openNew = useCallback((dateKey: string, time = '09:00') => {
    setEditorError('')
    setEditor({ form: emptyForm(dateKey, time, canPublish), id: null, owner: meId })
  }, [canPublish, meId])

  const openEdit = (ev: EventRow) => {
    setEditorError('')
    const invitees = attendees.filter(a => a.event_id === ev.id && a.employee_id !== ev.created_by).map(a => a.employee_id)
    setEditor({ form: formFromEvent(ev, invitees), id: ev.id, owner: ev.created_by })
  }

  // Keyboard: arrows move, t = today, m/w/d/a = views, n = new event.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (editor || event.metaKey || event.ctrlKey || event.altKey) return
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return
      const k = event.key.toLowerCase()
      if (k === 'arrowleft') step(-1)
      else if (k === 'arrowright') step(1)
      else if (k === 't') goToday()
      else if (k === 'm') setView('month')
      else if (k === 'w') setView('week')
      else if (k === 'd') setView('day')
      else if (k === 'a') setView('agenda')
      else if (k === 'n') openNew(anchorKey)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, step, goToday, openNew, anchorKey])

  // Start the day and week views around 7am.
  useEffect(() => {
    if ((view === 'week' || view === 'day') && gridRef.current) gridRef.current.scrollTop = HOUR_PX * 7
  }, [view])

  const saveEvent = async () => {
    const client = supabase
    const form = editor?.form
    if (!client || !editor || !form || !meId) return
    const startsAt = form.allDay ? parseKey(form.startDate) : new Date(`${form.startDate}T${form.start || '09:00'}`)
    let endsAt: Date | null
    if (form.allDay) endsAt = addDays(parseKey(form.endDate || form.startDate), 1)
    else endsAt = form.end || form.endDate !== form.startDate ? new Date(`${form.endDate || form.startDate}T${form.end || form.start || '09:00'}`) : null
    if (Number.isNaN(startsAt.getTime())) { setEditorError('Choose a start date.'); return }
    if (endsAt && endsAt < startsAt) { setEditorError('The event cannot end before it starts.'); return }
    if (form.recurrence !== 'none' && form.until && form.until < form.startDate) { setEditorError('Repeat until must be on or after the start date.'); return }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      event_type: form.type,
      location: form.location.trim() || null,
      meeting_url: form.url.trim() || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      all_day: form.allDay,
      recurrence: form.recurrence,
      recurrence_until: form.recurrence !== 'none' && form.until ? form.until : null,
      visibility: form.visibility,
      reminder_minutes: form.reminder === '' ? null : Number(form.reminder),
    }

    setSaving(true)
    setEditorError('')
    let eventId = editor.id
    if (eventId) {
      const { error } = await client.from('workspace_events').update(payload).eq('id', eventId)
      if (error) { setSaving(false); setEditorError(error.message); return }
    } else {
      const { data, error } = await client.from('workspace_events').insert({ ...payload, created_by: meId }).select('id').single()
      if (error || !data) { setSaving(false); setEditorError(error?.message || 'Could not save the event.'); return }
      eventId = data.id as string
    }

    // Invitations are only the owner's to change.
    if (eventId && (!editor.id || editor.owner === meId)) {
      const wanted = form.visibility === 'private' ? [] : form.invitees
      const current = attendees.filter(a => a.event_id === eventId).map(a => a.employee_id)
      const add = wanted.filter(id => !current.includes(id))
      const drop = current.filter(id => !wanted.includes(id))
      if (add.length) {
        const { error } = await client.from('workspace_event_attendees').insert(add.map(id => ({ event_id: eventId, employee_id: id })))
        if (error) { setSaving(false); setEditorError(`Saved, but the invitations failed: ${error.message}`); await load(); return }
      }
      if (drop.length) {
        await client.from('workspace_event_attendees').delete().eq('event_id', eventId).in('employee_id', drop)
      }
    }

    setSaving(false)
    setEditor(null)
    setPicked(null)
    setAnchor(startOfDay(startsAt))
    await load()
  }

  const deleteEvent = async (ev: EventRow) => {
    const client = supabase
    if (!client) return
    const text = ev.recurrence !== 'none' ? `Delete "${ev.title}" and every repeat of it?` : `Delete "${ev.title}"?`
    if (!window.confirm(text)) return
    const { error } = await client.from('workspace_events').delete().eq('id', ev.id)
    if (error) { setEditorError(error.message); setNotice(error.message); return }
    setEditor(null)
    setPicked(null)
    await load()
  }

  const respond = async (ev: EventRow, response: Response) => {
    const client = supabase
    if (!client || !meId) return
    const { error } = await client
      .from('workspace_event_attendees')
      .update({ response, responded_at: new Date().toISOString() })
      .eq('event_id', ev.id)
      .eq('employee_id', meId)
    if (error) { setNotice(error.message); return }
    setAttendees(current => current.map(a => (a.event_id === ev.id && a.employee_id === meId ? { ...a, response } : a)))
  }

  const exportIcs = () => {
    const mine = events.filter(e => !mineOnly || e.created_by === meId || myResponse(e.id))
    const text = buildIcs(mine.map(e => ({
      id: e.id, title: e.title, description: e.description, location: e.location, url: e.meeting_url,
      starts_at: e.starts_at, ends_at: e.ends_at, all_day: e.all_day, recurrence: e.recurrence, recurrence_until: e.recurrence_until,
    })))
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ridearrivo-calendar.ics'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Festivals (HR and Admin).
  const loadFestivals = useCallback(async () => {
    const client = supabase
    if (!client) return
    const { data, error } = await client.from('workspace_festivals').select('*').order('month').order('day')
    if (error) { setNotice(error.message); return }
    setFestivals((data || []) as Festival[])
  }, [])
  useEffect(() => { if (festivalsOpen) void loadFestivals() }, [festivalsOpen, loadFestivals])
  const [fest, setFest] = useState({ name: '', date: todayKey, yearly: true, kind: 'holiday' as 'holiday' | 'festival' })

  const addFestival = async (event: React.FormEvent) => {
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
    if (!client || !window.confirm(`Remove ${f.name}${f.year ? ` (${f.year})` : ''}?`)) return
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

  const title = useMemo(() => {
    if (view === 'month') return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
    if (view === 'week') {
      const a = range.from
      const b = addDays(range.to, -1)
      const left = a.toLocaleDateString(undefined, { day: 'numeric', month: a.getMonth() === b.getMonth() ? undefined : 'short' })
      return `${left} to ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    if (view === 'day') return anchor.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return `Next ${AGENDA_DAYS} days from ${dayLabel(anchorKey)}`
  }, [view, anchor, anchorKey, range])

  const itemLine = (item: Item) =>
    item.allDay ? item.title : `${timeLabel(item.start)} ${item.title}`

  const ItemChip = ({ item, compact = false }: { item: Item; compact?: boolean }) => (
    <span
      role="button"
      tabIndex={0}
      className={`wcalTag ${item.kind}${item.event?.visibility === 'private' ? ' private' : ''}${compact ? ' compact' : ''}`}
      title={item.title}
      onClick={e => { e.stopPropagation(); setPicked(item) }}
      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setPicked(item) } }}
    >
      {item.event && item.event.recurrence !== 'none' && <Repeat size={10} />}{itemLine(item)}
    </span>
  )

  // ----- Views -----
  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(range.from, i)), [range])

  const monthView = (
    <div className="wcalGrid" role="grid" aria-busy={loading}>
      {WEEKDAYS.map(d => <div key={d} className="wcalDow" role="columnheader">{d}</div>)}
      {monthCells.map(cell => {
        const key = keyOf(cell)
        const list = itemsOn(key)
        const outside = cell.getMonth() !== anchor.getMonth()
        return (
          <div
            key={key}
            role="gridcell"
            tabIndex={0}
            className={`wcalCell${outside ? ' outside' : ''}${key === todayKey ? ' today' : ''}${key === anchorKey ? ' selected' : ''}`}
            onClick={() => setAnchor(startOfDay(cell))}
            onDoubleClick={() => openNew(key)}
            onKeyDown={e => { if (e.key === 'Enter') setAnchor(startOfDay(cell)) }}
            aria-label={`${cell.toDateString()}, ${list.length} item${list.length === 1 ? '' : 's'}`}
          >
            <span className="wcalNum">{cell.getDate()}</span>
            <span className="wcalChipsCol">
              {list.slice(0, 3).map(item => <ItemChip key={item.id} item={item} />)}
              {list.length > 3 && (
                <button type="button" className="wcalMore" onClick={e => { e.stopPropagation(); setAnchor(startOfDay(cell)); setView('day') }}>+{list.length - 3} more</button>
              )}
            </span>
            <span className="wcalDots">{list.slice(0, 4).map(item => <i key={item.id} className={item.kind} />)}</span>
          </div>
        )
      })}
    </div>
  )

  const columnDays = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : [anchor]
  const hours = Array.from({ length: 24 }, (_, h) => h)

  const timeView = (
    <div className="wcalTime">
      <div className="wcalTimeHead" style={{ gridTemplateColumns: `52px repeat(${columnDays.length}, minmax(0,1fr))` }}>
        <span />
        {columnDays.map(d => {
          const key = keyOf(d)
          return (
            <button type="button" key={key} className={`wcalColHead${key === todayKey ? ' today' : ''}`} onClick={() => { setAnchor(startOfDay(d)); if (view === 'week') setView('day') }}>
              <small>{WEEKDAYS[(d.getDay() + 6) % 7]}</small><strong>{d.getDate()}</strong>
            </button>
          )
        })}
      </div>
      <div className="wcalAllDay" style={{ gridTemplateColumns: `52px repeat(${columnDays.length}, minmax(0,1fr))` }}>
        <span className="wcalAllDayLabel">All day</span>
        {columnDays.map(d => (
          <div key={keyOf(d)} className="wcalAllDayCol">
            {itemsOn(keyOf(d)).filter(i => i.allDay).map(item => <ItemChip key={item.id} item={item} />)}
          </div>
        ))}
      </div>
      <div className="wcalScroll" ref={gridRef}>
        <div className="wcalHours" style={{ gridTemplateColumns: `52px repeat(${columnDays.length}, minmax(0,1fr))`, height: HOUR_PX * 24 }}>
          <div className="wcalGutter">
            {hours.map(h => <span key={h} style={{ top: h * HOUR_PX }}>{h === 0 ? '' : `${pad(h)}:00`}</span>)}
          </div>
          {columnDays.map(d => {
            const key = keyOf(d)
            const timed = itemsOn(key).filter(i => !i.allDay)
            const placed = layoutDay(timed, key)
            const nowMin = today.getHours() * 60 + today.getMinutes()
            return (
              <div
                key={key}
                className={`wcalDayCol${key === todayKey ? ' today' : ''}`}
                onClick={e => {
                  if (e.target !== e.currentTarget) return
                  const y = e.nativeEvent.offsetY
                  const mins = Math.floor((y / HOUR_PX) * 2) * 30
                  openNew(key, `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`)
                }}
              >
                {hours.map(h => <i key={h} className="wcalHourLine" style={{ top: h * HOUR_PX }} />)}
                {placed.map(p => (
                  <button
                    type="button"
                    key={p.item.id}
                    className={`wcalBlock ${p.item.kind}${p.item.event?.visibility === 'private' ? ' private' : ''}`}
                    style={{
                      top: (p.top / 60) * HOUR_PX,
                      height: (p.height / 60) * HOUR_PX - 2,
                      left: `${(p.column / p.columns) * 100}%`,
                      width: `calc(${100 / p.columns}% - 3px)`,
                    }}
                    onClick={e => { e.stopPropagation(); setPicked(p.item) }}
                  >
                    <strong>{p.item.title}</strong>
                    <small>{timeLabel(p.item.start)}{p.item.sub ? ` · ${p.item.sub}` : ''}</small>
                  </button>
                ))}
                {key === todayKey && <b className="wcalNow" style={{ top: (nowMin / 60) * HOUR_PX }} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  const agendaDays = useMemo(() => {
    const out: { key: string; list: Item[] }[] = []
    for (let i = 0; i < AGENDA_DAYS; i += 1) {
      const key = keyOf(addDays(range.from, i))
      const list = itemsOn(key)
      if (list.length) out.push({ key, list })
    }
    return out
  }, [range, itemsOn])

  const agendaView = (
    <div className="wcalAgenda">
      {agendaDays.length === 0 && <p className="wcalNone">Nothing scheduled in this period.</p>}
      {agendaDays.map(day => (
        <section key={day.key}>
          <h4 className={day.key === todayKey ? 'today' : ''}>{dayLabel(day.key)}{day.key === todayKey ? ' · Today' : ''}</h4>
          <ul className="wcalList">
            {day.list.map(item => (
              <li key={item.id} className={item.kind}>
                <span className="wcalIco"><KindIcon kind={item.kind} size={15} /></span>
                <button type="button" className="wcalLink" onClick={() => setPicked(item)}>
                  <strong>{item.title}</strong>
                  <small>{[item.allDay ? 'All day' : `${timeLabel(item.start)} to ${timeLabel(item.end)}`, item.sub].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )

  // ----- Detail panel -----
  const pickedEvent = picked?.event
  const pickedOwner = pickedEvent ? pickedEvent.created_by === meId : false
  const canChange = pickedEvent ? pickedOwner || (pickedEvent.visibility !== 'private' && canPublish) : false
  const pickedPeople = pickedEvent ? attendees.filter(a => a.event_id === pickedEvent.id && a.employee_id !== pickedEvent.created_by) : []
  const nameOf = (id: string) => people.find(p => p.id === id)?.name || 'Colleague'
  const mine = pickedEvent ? myResponse(pickedEvent.id) : null

  const detail = picked && (
    <div className="glassCard wcalDetail">
      <div className="wcalDetailHead">
        <span className={`wcalIco ${picked.kind}`}><KindIcon kind={picked.kind} size={15} /></span>
        <h3>{picked.title}</h3>
        <button type="button" className="wcalIcon" onClick={() => setPicked(null)} aria-label="Close details"><X size={14} /></button>
      </div>
      <p className="wcalWhen">
        {picked.allDay
          ? (lastDayKey(picked.start, picked.end) === keyOf(picked.start)
              ? dayLabel(keyOf(picked.start))
              : `${dayLabel(keyOf(picked.start))} to ${dayLabel(lastDayKey(picked.start, picked.end))}`)
          : `${dayLabel(keyOf(picked.start))}, ${timeLabel(picked.start)} to ${timeLabel(picked.end)}`}
      </p>
      {pickedEvent && (
        <>
          {pickedEvent.recurrence !== 'none' && (
            <p className="wcalMeta"><Repeat size={13} />{RECURRENCE_LABEL[pickedEvent.recurrence]}{pickedEvent.recurrence_until ? ` until ${dayLabel(pickedEvent.recurrence_until)}` : ''}</p>
          )}
          {pickedEvent.location && <p className="wcalMeta"><MapPin size={13} />{pickedEvent.location}</p>}
          {safeHttpUrl(pickedEvent.meeting_url) && <a className="wcalMeta" href={safeHttpUrl(pickedEvent.meeting_url)} target="_blank" rel="noreferrer">Join meeting <ExternalLink size={12} /></a>}
          {pickedEvent.description && <p className="wcalNotes">{pickedEvent.description}</p>}
          <p className="wcalMeta">
            {pickedEvent.visibility === 'everyone' ? 'Visible to everyone' : pickedEvent.visibility === 'invited' ? 'Only invited people' : 'Only you'}
            {pickedEvent.created_by && !pickedOwner ? ` · from ${nameOf(pickedEvent.created_by)}` : ''}
          </p>
          {mine && (
            <div className="wcalRsvp" role="group" aria-label="Your reply">
              {(['going', 'maybe', 'declined'] as Response[]).map(r => (
                <button key={r} type="button" className={`glassButton${mine === r ? ' on' : ''}`} aria-pressed={mine === r} onClick={() => void respond(pickedEvent, r)}>
                  {r === 'going' ? 'Going' : r === 'maybe' ? 'Maybe' : "Can't go"}
                </button>
              ))}
            </div>
          )}
          {pickedPeople.length > 0 && pickedOwner && (
            <ul className="wcalAttendees">
              {pickedPeople.map(a => <li key={a.employee_id}><span>{nameOf(a.employee_id)}</span><small>{a.response === 'pending' ? 'No reply' : a.response === 'going' ? 'Going' : a.response === 'maybe' ? 'Maybe' : "Can't go"}</small></li>)}
            </ul>
          )}
          {canChange && (
            <div className="buttonRow">
              <button type="button" className="glassButton" onClick={() => openEdit(pickedEvent)}><Pencil size={14} />Edit</button>
              <button type="button" className="glassButton danger" onClick={() => void deleteEvent(pickedEvent)}><Trash2 size={14} />Delete</button>
            </div>
          )}
        </>
      )}
      {picked.sub && !pickedEvent && <p className="wcalMeta">{picked.sub}</p>}
    </div>
  )

  const dayList = itemsOn(anchorKey)
  const coming = useMemo(() => {
    const now = Date.now()
    return items.filter(i => i.end.getTime() >= now).sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, 6)
  }, [items])

  return (
    <section className="wcal">
      <div className="wcalHead glassCard">
        <div>
          <span className="eyebrow">MY WORK</span>
          <h2>Calendar</h2>
          <p>Company events, your own events, invitations, birthdays, work anniversaries, festivals and who is on leave. Keys: arrows to move, T today, M W D A for views, N new event.</p>
        </div>
        <div className="buttonRow">
          <button type="button" className="glassButton" onClick={exportIcs}><Download size={15} />Export</button>
          {canFestivals && (
            <button type="button" className="glassButton" onClick={() => setFestivalsOpen(open => !open)}>
              <Flag size={15} />Holidays and festivals
            </button>
          )}
          <button type="button" className="primaryButton" onClick={() => openNew(anchorKey)}><Plus size={15} />New event</button>
        </div>
      </div>

      {notice && <div className="moduleNotice">{notice}</div>}

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
              <button type="button" className="wcalIcon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
              <button type="button" className="wcalIcon" onClick={() => step(1)} aria-label="Next"><ChevronRight size={18} /></button>
              <button type="button" className="glassButton" onClick={goToday}>Today</button>
            </div>
            <h3>{title}</h3>
            <div className="wcalViews" role="tablist" aria-label="Calendar view">
              {(Object.keys(VIEW_LABEL) as View[]).map(v => (
                <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>
              ))}
            </div>
          </div>

          <div className="wcalTools">
            <label className="wcalSearch">
              <Search size={14} />
              <input type="search" placeholder="Search this view" value={query} onChange={e => setQuery(e.target.value)} />
            </label>
            <label className="wcalCheck"><input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} />Only my events</label>
            {view === 'month' && (
              <span className="wcalJump">
                <select aria-label="Month" value={anchor.getMonth()} onChange={e => setAnchor(new Date(anchor.getFullYear(), Number(e.target.value), 1))}>
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
                <input aria-label="Year" type="number" min={2000} max={2100} value={anchor.getFullYear()} onChange={e => {
                  const y = Number(e.target.value)
                  if (y >= 2000 && y <= 2100) setAnchor(new Date(y, anchor.getMonth(), 1))
                }} />
              </span>
            )}
          </div>

          <div className="wcalChips" role="group" aria-label="Show on calendar">
            {ALL_KINDS.map(kind => (
              <button key={kind} type="button" className={`wcalChip ${kind} ${show.has(kind) ? 'on' : ''}`} aria-pressed={show.has(kind)} onClick={() => toggle(kind)}>
                <KindIcon kind={kind} />{KIND_LABEL[kind]}
              </button>
            ))}
          </div>

          {view === 'month' && monthView}
          {(view === 'week' || view === 'day') && timeView}
          {view === 'agenda' && agendaView}
        </div>

        <aside className="wcalSide">
          {detail}
          {view !== 'agenda' && (
            <div className="glassCard">
              <span className="eyebrow">{anchor.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}</span>
              <h3>{anchor.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
              {dayList.length === 0 && <p className="wcalNone">Nothing on this day.</p>}
              <ul className="wcalList">
                {dayList.map(item => (
                  <li key={item.id} className={item.kind}>
                    <span className="wcalIco"><KindIcon kind={item.kind} size={15} /></span>
                    <button type="button" className="wcalLink" onClick={() => setPicked(item)}>
                      <strong>{item.title}</strong>
                      <small>{[item.allDay ? 'All day' : timeLabel(item.start), item.sub].filter(Boolean).join(' · ')}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="glassButton" onClick={() => openNew(anchorKey)}><Plus size={14} />Add to this day</button>
            </div>
          )}
          <div className="glassCard">
            <span className="eyebrow">COMING UP</span>
            <ul className="wcalList">
              {coming.map(item => (
                <li key={item.id} className={item.kind}>
                  <span className="wcalIco"><KindIcon kind={item.kind} size={15} /></span>
                  <button type="button" className="wcalLink" onClick={() => setPicked(item)}>
                    <strong>{item.title}</strong>
                    <small>{dayLabel(keyOf(item.start))}</small>
                  </button>
                </li>
              ))}
              {coming.length === 0 && <li className="wcalNone">Nothing coming up in this view.</li>}
            </ul>
          </div>
        </aside>
      </div>

      {editor && (
        <CalendarEventEditor
          form={editor.form}
          editing={Boolean(editor.id)}
          canPublish={canPublish}
          canEditInvites={!editor.id || editor.owner === meId}
          people={people}
          meId={meId}
          error={editorError}
          saving={saving}
          onChange={form => setEditor({ ...editor, form })}
          onSave={() => void saveEvent()}
          onDelete={editor.id ? () => { const ev = events.find(e => e.id === editor.id); if (ev) void deleteEvent(ev) } : undefined}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  )
}

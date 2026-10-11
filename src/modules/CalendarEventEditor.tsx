import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Trash2, X } from 'lucide-react'
import { RECURRENCE_LABEL } from '../lib/calendarLogic'
import type { Recurrence } from '../lib/calendarLogic'

export type Visibility = 'everyone' | 'invited' | 'private'

export type EventForm = {
  title: string
  type: string
  startDate: string
  endDate: string
  allDay: boolean
  start: string
  end: string
  recurrence: Recurrence
  until: string
  visibility: Visibility
  location: string
  url: string
  description: string
  reminder: string
  invitees: string[]
}

export type Person = { id: string; name: string }

export const EVENT_TYPES = ['Meeting', 'Deadline', 'Company event', 'Training', 'Other']

export const REMINDER_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'No reminder' },
  { value: '0', label: 'When it starts' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' },
]

type Props = {
  form: EventForm
  editing: boolean
  canPublish: boolean
  canEditInvites: boolean
  people: Person[]
  meId: string
  error: string
  saving: boolean
  onChange: (next: EventForm) => void
  onSave: () => void
  onDelete?: () => void
  onClose: () => void
}

export default function CalendarEventEditor(props: Props) {
  const { form, editing, canPublish, canEditInvites, people, meId, error, saving, onChange, onSave, onDelete, onClose } = props
  const [find, setFind] = useState('')
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => onChange({ ...form, [key]: value })

  const byId = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people])
  const matches = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q) return []
    return people
      .filter(p => p.id !== meId && !form.invitees.includes(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [find, people, form.invitees, meId])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave()
  }

  return (
    <div className="wcalModalBack" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form className="wcalModal" role="dialog" aria-modal="true" aria-label={editing ? 'Edit event' : 'New event'} onSubmit={submit}>
        <div className="wcalModalHead">
          <h3>{editing ? 'Edit event' : 'New event'}</h3>
          <button type="button" className="wcalIcon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <label className="wide">Title
          <input required autoFocus maxLength={160} value={form.title} onChange={e => set('title', e.target.value)} />
        </label>

        <div className="wcalRow">
          <label>Type
            <select value={form.type} onChange={e => set('type', e.target.value)}>
              {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Who can see it
            <select value={form.visibility} onChange={e => set('visibility', e.target.value as Visibility)}>
              {canPublish && <option value="everyone">Everyone (company calendar)</option>}
              <option value="invited">Only people I invite</option>
              <option value="private">Only me</option>
            </select>
          </label>
        </div>

        <label className="wcalCheck"><input type="checkbox" checked={form.allDay} onChange={e => set('allDay', e.target.checked)} />All day</label>

        <div className="wcalRow">
          <label>Starts
            <input type="date" required value={form.startDate} onChange={e => {
              const startDate = e.target.value
              onChange({ ...form, startDate, endDate: form.endDate < startDate ? startDate : form.endDate })
            }} />
          </label>
          {!form.allDay && <label>At<input type="time" required value={form.start} onChange={e => set('start', e.target.value)} /></label>}
          <label>Ends
            <input type="date" required min={form.startDate} value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </label>
          {!form.allDay && <label>At<input type="time" value={form.end} onChange={e => set('end', e.target.value)} /></label>}
        </div>

        <div className="wcalRow">
          <label>Repeat
            <select value={form.recurrence} onChange={e => set('recurrence', e.target.value as Recurrence)}>
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map(r => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
            </select>
          </label>
          {form.recurrence !== 'none' && (
            <label>Repeat until (optional)
              <input type="date" min={form.startDate} value={form.until} onChange={e => set('until', e.target.value)} />
            </label>
          )}
          <label>Reminder
            <select value={form.reminder} onChange={e => set('reminder', e.target.value)}>
              {REMINDER_CHOICES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
        </div>
        {editing && form.recurrence !== 'none' && <p className="wcalHint">Changes apply to the whole series.</p>}

        <div className="wcalRow">
          <label>Location<input maxLength={160} value={form.location} onChange={e => set('location', e.target.value)} /></label>
          <label>Meeting link<input type="url" placeholder="https://" value={form.url} onChange={e => set('url', e.target.value)} /></label>
        </div>

        {canEditInvites && form.visibility !== 'private' && (
          <div className="wcalInvite">
            <label className="wide">Invite people
              <input placeholder="Type a name" value={find} onChange={e => setFind(e.target.value)} />
            </label>
            {matches.length > 0 && (
              <ul className="wcalPick">
                {matches.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => { set('invitees', [...form.invitees, p.id]); setFind('') }}>{p.name}</button>
                  </li>
                ))}
              </ul>
            )}
            {form.invitees.length > 0 && (
              <div className="wcalPeople">
                {form.invitees.map(id => (
                  <span key={id} className="wcalPerson">
                    {byId.get(id) || 'Colleague'}
                    <button type="button" aria-label={`Remove ${byId.get(id) || 'invitee'}`} onClick={() => set('invitees', form.invitees.filter(x => x !== id))}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="wide">Notes
          <textarea rows={3} maxLength={2000} value={form.description} onChange={e => set('description', e.target.value)} />
        </label>

        {error && <div className="moduleNotice">{error}</div>}

        <div className="wcalModalFoot">
          {onDelete ? (
            <button type="button" className="glassButton danger" onClick={onDelete}><Trash2 size={14} />Delete</button>
          ) : <span />}
          <span className="buttonRow">
            <button type="button" className="glassButton" onClick={onClose}>Cancel</button>
            <button type="submit" className="primaryButton" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </span>
        </div>
      </form>
    </div>
  )
}

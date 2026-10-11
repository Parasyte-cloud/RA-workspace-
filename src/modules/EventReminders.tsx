import { useEffect, useRef, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { expandEvent, keyOf } from '../lib/calendarLogic'
import type { Recurrence } from '../lib/calendarLogic'
import { showDesktopAlert } from '../lib/desktopAlerts'
import '../calendar.css'

type Row = {
  id: string
  title: string
  location: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  recurrence: Recurrence
  recurrence_until: string | null
  reminder_minutes: number
}

type Reminder = { key: string; title: string; when: string; where: string | null }

const CHECK_EVERY_MS = 30_000
const LOOKAHEAD_MS = 7 * 24 * 3_600_000 + 3_600_000
const SEEN_KEY = 'ra.reminders.seen'

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)))
  } catch {
    // Reminders may repeat after a reload if storage is blocked.
  }
}

// Mounted once for the whole workspace. Every half minute it looks for events
// whose reminder time has arrived, and tells the person once per occurrence.
// Only works while the workspace is open: it is not a closed-tab push.
export default function EventReminders() {
  const [cards, setCards] = useState<Reminder[]>([])
  const seen = useRef<Set<string>>(loadSeen())

  useEffect(() => {
    const client = supabase
    if (!client) return
    let stopped = false

    const check = async () => {
      const now = new Date()
      const horizon = new Date(now.getTime() + LOOKAHEAD_MS)
      const { data, error } = await client
        .from('workspace_events')
        .select('id,title,location,starts_at,ends_at,all_day,recurrence,recurrence_until,reminder_minutes')
        .not('reminder_minutes', 'is', null)
        .lt('starts_at', horizon.toISOString())
        .or(`recurrence.neq.none,starts_at.gte.${new Date(now.getTime() - 3_600_000).toISOString()}`)
        .limit(300)
      if (stopped || error || !data) return

      const fresh: Reminder[] = []
      for (const row of data as Row[]) {
        for (const occ of expandEvent(row, new Date(now.getTime() - 3_600_000), horizon)) {
          const fireAt = occ.start.getTime() - row.reminder_minutes * 60_000
          if (fireAt > now.getTime() || occ.start.getTime() < now.getTime() - 5 * 60_000) continue
          const key = `${row.id}@${occ.start.getTime()}`
          if (seen.current.has(key)) continue
          seen.current.add(key)
          const when = row.all_day
            ? `Today (${keyOf(occ.start)})`
            : occ.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          fresh.push({ key, title: row.title, when, where: row.location })
        }
      }
      if (!fresh.length) return
      saveSeen(seen.current)
      setCards(current => [...current, ...fresh].slice(-4))
      for (const reminder of fresh) {
        showDesktopAlert({
          title: reminder.title,
          body: `Starts ${reminder.when}${reminder.where ? ` · ${reminder.where}` : ''}`,
          tag: reminder.key,
          section: 'calendar',
        })
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  if (!cards.length) return null

  return (
    <div className="evRemind" role="status" aria-live="polite">
      {cards.map(card => (
        <div className="evRemindCard" key={card.key}>
          <Bell size={18} />
          <div>
            <strong>{card.title}</strong>
            <small>Starts {card.when}{card.where ? ` · ${card.where}` : ''}</small>
          </div>
          <button type="button" aria-label="Dismiss reminder" onClick={() => setCards(current => current.filter(c => c.key !== card.key))}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

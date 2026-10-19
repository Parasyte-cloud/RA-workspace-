// The notification centre feed: realtime for speed, polling for certainty (same rule as emergencies).
//
// PArAsYtE | RA-Workspace support module

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadNotifications, markNotificationsRead, type NotificationRow } from '../lib/supportCommandCentre'

const POLL_MS = 20_000

export function useSupportNotifications(enabled: boolean, onCritical?: (n: NotificationRow) => void) {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [error, setError] = useState('')
  const seen = useRef<Set<number> | null>(null)
  const alive = useRef(true)
  const cb = useRef(onCritical)
  cb.current = onCritical

  const reload = useCallback(async () => {
    if (!enabled) return
    try {
      const rows = await loadNotifications(40)
      if (!alive.current) return
      // The first load only sets the baseline; afterwards anything new and critical calls back once.
      if (seen.current) for (const r of rows) if (!seen.current.has(r.id) && !r.read_at && r.severity === 'critical') cb.current?.(r)
      seen.current = new Set(rows.map((r) => r.id))
      setItems(rows); setError('')
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Notifications unavailable') }
  }, [enabled])

  useEffect(() => {
    alive.current = true
    if (!enabled) return () => { alive.current = false }
    void reload()
    const poll = setInterval(() => void reload(), POLL_MS)
    const wake = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', wake)
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase?.channel('support-notifications').on('postgres_changes', { event: '*', schema: 'public', table: 'support_notifications' }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void reload(), 120)
    }).subscribe()
    return () => {
      alive.current = false
      clearInterval(poll); if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [enabled, reload])

  const unread = items.filter((i) => !i.read_at).length
  const markRead = useCallback(async (ids?: number[]) => {
    setItems((cur) => cur.map((i) => (!ids || ids.includes(i.id) ? { ...i, read_at: i.read_at || new Date().toISOString() } : i)))
    try { await markNotificationsRead(ids) } catch { void reload() }
  }, [reload])

  return { items, unread, error, reload, markRead }
}

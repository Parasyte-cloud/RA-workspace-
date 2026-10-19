// Keeps the emergency feed alive. Emergencies must not depend on one transport:
// the database row is the alert, realtime makes it fast, polling makes it certain.
// If neither succeeds for a while the screen says the feed is disconnected, so
// nobody assumes "no alerts" when the truth is "no connection".
//
// PArAsYtE | RA-Workspace support module

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { canSeeSensitive, loadIncidents, type IncidentRow } from '../lib/supportCommandCentre'

const POLL_MS = 10_000
const STALE_AFTER_MS = 35_000

export function useSupportIncidents(enabled: boolean) {
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [sensitive, setSensitive] = useState(false)
  const [error, setError] = useState('')
  const [lastOk, setLastOk] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const alive = useRef(true)
  const inFlight = useRef(false)

  const reload = useCallback(async () => {
    if (!enabled || inFlight.current) return
    inFlight.current = true
    try {
      const rows = await loadIncidents()
      if (!alive.current) return
      setIncidents(rows); setError(''); setLastOk(Date.now())
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Emergency feed unavailable.')
    } finally { inFlight.current = false }
  }, [enabled])

  useEffect(() => {
    alive.current = true
    if (!enabled) return () => { alive.current = false }
    void canSeeSensitive().then((v) => { if (alive.current) setSensitive(v) })
    void reload()
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    // Keep polling in the background tab too: a browser may slow it, but a hidden
    // tab should still catch up the moment it runs.
    const poll = setInterval(() => void reload(), POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 5000)
    const wake = () => { if (visible()) void reload() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    let timer: ReturnType<typeof setTimeout> | undefined
    const c = supabase
    const channel = c?.channel('support-incidents').on('postgres_changes', { event: '*', schema: 'public', table: 'support_incidents' }, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void reload(), 150)
    }).subscribe()
    return () => {
      alive.current = false
      clearInterval(poll); clearInterval(tick)
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      if (c && channel) void c.removeChannel(channel)
    }
  }, [enabled, reload])

  const disconnected = enabled && (lastOk === null ? Boolean(error) : now - lastOk > STALE_AFTER_MS)
  const open = incidents.filter((i) => i.status !== 'resolved')
  return { incidents, open, sensitive, error, disconnected, reload }
}

// Keeps the Support Command Centre live: heartbeat, snapshot, realtime.
//
// The heartbeat is not decoration. The routing engines treat an officer whose
// last heartbeat is older than 120 seconds as offline, so a tab that stops
// beating stops receiving calls and tickets. It runs while the tab is open and
// again the moment the tab becomes visible or the network returns.
//
// PArAsYtE | RA-Workspace support module

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  EMPTY_SNAPSHOT,
  heartbeat,
  loadSnapshot,
  setMyState,
  watchSupport,
  type SupportAgentState,
  type SupportHeartbeat,
  type SupportSnapshot,
} from '../lib/supportCommandCentre'

const HEARTBEAT_MS = 30_000
const POLL_MS = 20_000

export function useSupportCentre() {
  const [snapshot, setSnapshot] = useState<SupportSnapshot>(EMPTY_SNAPSHOT)
  const [me, setMe] = useState<SupportHeartbeat | null>(null)
  const [meId, setMeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const supervisorRef = useRef(false)
  const alive = useRef(true)
  const inFlight = useRef(false)

  const beat = useCallback(async () => {
    try {
      const next = await heartbeat()
      if (!alive.current) return
      supervisorRef.current = Boolean(next.supervisor)
      setMe(next)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Lost contact with the server.')
    }
  }, [])

  const reload = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = await loadSnapshot({ supervisor: supervisorRef.current })
      if (!alive.current) return
      setSnapshot(next)
      setError('')
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Unable to load the Support Command Centre.')
    } finally {
      inFlight.current = false
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void supabase?.auth.getUser().then(({ data }) => { if (alive.current) setMeId(data.user?.id ?? null) })
    void beat().then(() => reload())

    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const beatTimer = setInterval(() => { if (visible()) void beat() }, HEARTBEAT_MS)
    const pollTimer = setInterval(() => { if (visible()) void reload() }, POLL_MS)
    const wake = () => { if (visible()) { void beat(); void reload() } }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    const stopWatching = watchSupport(() => void reload())

    return () => {
      alive.current = false
      clearInterval(beatTimer)
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      stopWatching()
    }
  }, [beat, reload])

  const changeState = useCallback(async (state: SupportAgentState) => {
    await setMyState(state)
    await beat()
    await reload()
  }, [beat, reload])

  return { snapshot, me, meId, loading, error, reload, beat, changeState, setError }
}

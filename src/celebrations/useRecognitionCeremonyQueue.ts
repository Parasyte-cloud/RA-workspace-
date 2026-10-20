import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getActiveCallId, subscribeActiveCall } from '../lib/activeCall'
import { claimNextRecognitionCeremony, dismissRecognitionCeremony, markRecognitionCeremonyPresented } from './api'
import { useCelebrationIsBlocked } from './CelebrationBlockerContext'
import type { CeremonyPresentation } from './types'

const MAX_AUTOMATIC_CEREMONIES = 2
const SESSION_PREFIX = 'ra-recognition-ceremony-count:'

function readSessionCount(userId: string) {
  try { return Number(window.sessionStorage.getItem(`${SESSION_PREFIX}${userId}`) || 0) || 0 } catch { return 0 }
}

function writeSessionCount(userId: string, count: number) {
  try { window.sessionStorage.setItem(`${SESSION_PREFIX}${userId}`, String(count)) } catch { /* session storage may be unavailable */ }
}

export function useRecognitionCeremonyQueue() {
  const blockedBySurface = useCelebrationIsBlocked()
  const [activeCall, setActiveCall] = useState(() => Boolean(getActiveCallId()))
  const [userId, setUserId] = useState('')
  const [current, setCurrent] = useState<CeremonyPresentation | null>(null)
  const [pendingSessionCount, setPendingSessionCount] = useState(0)
  const [error, setError] = useState('')
  const claiming = useRef(false)
  const activeUser = useRef('')
  const presented = useRef(new Set<string>())
  const blocked = blockedBySurface || activeCall || (typeof document !== 'undefined' && document.visibilityState !== 'visible')

  useEffect(() => subscribeActiveCall(id => setActiveCall(Boolean(id))), [])

  useEffect(() => {
    if (!supabase) return
    let live = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!live) return
      const id = data.user?.id || ''
      activeUser.current = id
      setUserId(id)
      setPendingSessionCount(id ? readSessionCount(id) : 0)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id || ''
      const previousUser = activeUser.current
      if (previousUser && previousUser !== id) {
        setCurrent(null)
        presented.current.clear()
      }
      if (!id) {
        setCurrent(null)
        presented.current.clear()
        setPendingSessionCount(0)
        if (previousUser) {
          try { window.sessionStorage.removeItem(`${SESSION_PREFIX}${previousUser}`) } catch { /* ignore */ }
        }
      }
      activeUser.current = id
      setUserId(id)
      setPendingSessionCount(id ? readSessionCount(id) : 0)
    })
    return () => { live = false; listener.subscription.unsubscribe() }
  }, [])

  const claimNext = useCallback(async () => {
    if (!supabase || !userId || current || blocked || claiming.current || pendingSessionCount >= MAX_AUTOMATIC_CEREMONIES) return
    claiming.current = true
    setError('')
    try {
      const next = await claimNextRecognitionCeremony()
      if (next) setCurrent(next)
    } catch {
      setError('A recognition ceremony is waiting, but it could not be prepared yet.')
    } finally {
      claiming.current = false
    }
  }, [userId, current, blocked, pendingSessionCount])

  useEffect(() => { void claimNext() }, [claimNext])

  useEffect(() => {
    const client = supabase
    if (!client || !userId) return
    let timer: number | null = null
    const retry = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => { void claimNext() }, 300)
    }
    window.addEventListener('online', retry)
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', retry)
    const interval = window.setInterval(() => { void claimNext() }, 30_000)
    const channel = client
      .channel(`recognition-ceremony-deliveries-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'recognition_ceremony_deliveries', filter: `recipient_id=eq.${userId}`,
      }, retry)
      .subscribe()
    return () => {
      if (timer) window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('online', retry)
      window.removeEventListener('focus', retry)
      document.removeEventListener('visibilitychange', retry)
      void client.removeChannel(channel)
    }
  }, [userId, claimNext])

  const markPresented = useCallback(async () => {
    if (!current || presented.current.has(current.deliveryId)) return
    presented.current.add(current.deliveryId)
    const nextCount = Math.min(MAX_AUTOMATIC_CEREMONIES, pendingSessionCount + 1)
    setPendingSessionCount(nextCount)
    if (userId) writeSessionCount(userId, nextCount)
    try {
      await markRecognitionCeremonyPresented(current.deliveryId)
    } catch {
      // Claim remains the anti-replay boundary; a failed telemetry update never remounts it.
    }
  }, [current, pendingSessionCount, userId])

  const dismiss = useCallback(async () => {
    const delivery = current
    if (!delivery) return
    setCurrent(null)
    try { await dismissRecognitionCeremony(delivery.deliveryId) } catch { /* presentation remains consumed */ }
    window.setTimeout(() => { void claimNext() }, 250)
  }, [current, claimNext])

  return { current, claimNext, markPresented, dismiss, blocked, pendingSessionCount, error }
}

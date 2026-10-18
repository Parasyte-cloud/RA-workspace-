import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { prefetchWhenIdle } from '../lib/prefetch'
import {
  CALL_FINISHED_EVENT,
  JOIN_ROOM_EVENT,
  endCallRoom,
  type CallFinishedDetail,
  type JoinRoomDetail
} from '../lib/roomApi'
import type { RoomLeaveReason } from './RoomModule'
import '../call-screen.css'

type CallSession = {
  room: {
    id: string
    room_code: string
    title: string
    status: 'active' | 'ended'
    ai_notes_enabled: boolean
    created_by: string
    started_at: string
    ended_at: string | null
    created_at: string
    updated_at: string
  }
  auth_token: string
  participant_id: string
  role: 'host' | 'member'
  can_moderate?: boolean
  event?: { scheduled_end: string | null; event_state: string | null } | null
}

const loadRoomMeeting = () => import('./RoomMeeting')
const RoomMeeting = lazy(loadRoomMeeting)

async function invokeJoin(roomCode: string): Promise<CallSession> {
  const client = supabase
  if (!client) throw new Error('Workspace authentication is not configured.')
  const { data, error } = await client.functions.invoke('room-session', {
    body: { action: 'join', room_code: roomCode }
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    if (response instanceof Response) {
      const body = await response.clone().json().catch(() => null)
      if (body && typeof body.error === 'string') throw new Error(body.error)
    }
    throw error
  }
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') throw new Error(data.error)
  if (!data?.room || !data?.auth_token) throw new Error('The call service returned an incomplete session.')
  return data as CallSession
}

// One-to-one voice and video calls started from Chat. They have their own
// screen and never open, list or end anything in ROOM 7.
export default function CallModule() {
  const [session, setSession] = useState<CallSession | null>(null)
  const [audioOnly, setAudioOnly] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [notice, setNotice] = useState('')
  const callIdRef = useRef('')
  const sessionRef = useRef<CallSession | null>(null)
  sessionRef.current = session

  useEffect(() => { prefetchWhenIdle(loadRoomMeeting) }, [])

  const finish = useCallback((message = '') => {
    const callId = callIdRef.current
    callIdRef.current = ''
    if (callId) void supabase?.rpc('respond_chat_call', { p_call: callId, p_status: 'ended' })
    setSession(null)
    setMinimized(false)
    setNotice(message)
  }, [])

  useEffect(() => {
    const onJoin = (event: Event) => {
      const detail = (event as CustomEvent<JoinRoomDetail>).detail
      // Only chat calls. Plain ROOM 7 joins are handled by the ROOM 7 page.
      if (!detail?.code || !detail.callId) return
      callIdRef.current = detail.callId
      setNotice('')
      setMinimized(false)
      setAudioOnly(detail.audioOnly)
      void invokeJoin(detail.code)
        .then(setSession)
        .catch(error => {
          callIdRef.current = ''
          setNotice(error instanceof Error ? error.message : 'Unable to join the call.')
        })
    }
    window.addEventListener(JOIN_ROOM_EVENT, onJoin)
    return () => window.removeEventListener(JOIN_ROOM_EVENT, onJoin)
  }, [])

  // The other person declined, did not answer or hung up: close this screen.
  useEffect(() => {
    const onFinished = (event: Event) => {
      const detail = (event as CustomEvent<CallFinishedDetail>).detail
      const current = sessionRef.current
      if (!detail?.callId || !current || detail.callId !== callIdRef.current) return
      callIdRef.current = ''
      if (current.role === 'host') void endCallRoom(current.room.id).catch(() => {})
      setSession(null)
      setMinimized(false)
      setNotice(detail.status === 'declined' ? 'Call declined.' : detail.status === 'missed' ? 'No answer.' : 'Call ended.')
    }
    window.addEventListener(CALL_FINISHED_EVENT, onFinished)
    return () => window.removeEventListener(CALL_FINISHED_EVENT, onFinished)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Keeps the call alive on the server. If the app is swiped away or the phone
  // loses signal for good, the beat stops and the database ends the call after
  // a minute, so nobody stays "on another call". The answer also tells this
  // screen when the call was ended from the other side.
  const inCallRoomId = session?.room.id || ''
  useEffect(() => {
    if (!inCallRoomId) return
    const beat = async () => {
      const callId = callIdRef.current
      const client = supabase
      if (!callId || !client) return
      const { data, error } = await client.rpc('chat_call_heartbeat', { p_call: callId })
      // Before the SQL migration is run the function does not exist: carry on.
      if (error || typeof data !== 'string') return
      if (['ended', 'declined', 'missed', 'cancelled'].includes(data) && callIdRef.current === callId) {
        const current = sessionRef.current
        callIdRef.current = ''
        if (current?.role === 'host') void endCallRoom(current.room.id).catch(() => {})
        setSession(null)
        setMinimized(false)
        setNotice('Call ended.')
      }
    }
    void beat()
    const timer = window.setInterval(() => void beat(), 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [inCallRoomId])

  // Closing the tab or the app: hang up as the page goes, with a request the
  // browser is allowed to finish after the page is gone. (A swipe-away on some
  // phones skips this, which is what the heartbeat above is for.)
  const tokenRef = useRef('')
  useEffect(() => {
    const client = supabase
    if (!client) return
    void client.auth.getSession().then(({ data }) => { tokenRef.current = data.session?.access_token || '' })
    const { data } = client.auth.onAuthStateChange((_event, next) => { tokenRef.current = next?.access_token || '' })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    const leaveNow = (event: PageTransitionEvent) => {
      if (event.persisted) return
      const callId = callIdRef.current
      if (!callId || !sessionRef.current || !tokenRef.current || !url || !anon) return
      try {
        void fetch(`${url}/rest/v1/rpc/respond_chat_call`, {
          method: 'POST',
          keepalive: true,
          headers: { apikey: anon, Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_call: callId, p_status: 'ended' })
        }).catch(() => {})
      } catch { /* nothing more can be done as the page closes */ }
    }
    window.addEventListener('pagehide', leaveNow)
    return () => window.removeEventListener('pagehide', leaveNow)
  }, [])

  const rejoin = useCallback(async () => {
    const code = sessionRef.current?.room.room_code
    if (!code) return false
    setSession(await invokeJoin(code))
    return true
  }, [])

  const onLeft = useCallback((reason: RoomLeaveReason) => {
    finish(reason === 'lost' ? 'The call connection was lost.' : reason === 'kicked' ? 'You joined this call from another device.' : '')
  }, [finish])

  const onEnded = useCallback(async () => {
    const current = sessionRef.current
    if (current) await endCallRoom(current.room.id).catch(() => {})
    finish('')
  }, [finish])

  return (
    <>
      {notice && <div className="callToast" role="status">{notice}</div>}
      {session && (
        <Suspense fallback={null}>
          <RoomMeeting
            session={session}
            minimized={minimized}
            anchor={null}
            onMinimize={() => setMinimized(true)}
            onShowList={() => {}}
            onRestore={() => setMinimized(false)}
            onLeft={onLeft}
            onEnded={onEnded}
            onRejoin={rejoin}
            audioOnly={audioOnly}
            chatCall
          />
        </Suspense>
      )}
    </>
  )
}

import { setActiveCallId } from '../lib/activeCall'
import { hangUpCall, hangUpStatuses, type CallRole } from '../lib/callHangup'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { prefetchWhenIdle } from '../lib/prefetch'
import {
  CALL_ACCEPTED_EVENT,
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

function serverHangUp(callId: string, role: CallRole) {
  const client = supabase
  if (!client) return
  void hangUpCall((fn, args) => client.rpc(fn, args), callId, role)
}

// One-to-one voice and video calls started from Chat. They have their own
// screen and never open, list or end anything in ROOM 7.
export default function CallModule() {
  const [session, setSession] = useState<CallSession | null>(null)
  const [audioOnly, setAudioOnly] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [notice, setNotice] = useState('')
  const [acceptedAt, setAcceptedAt] = useState(0)
  const callIdRef = useRef('')
  const sessionRef = useRef<CallSession | null>(null)
  sessionRef.current = session

  useEffect(() => { prefetchWhenIdle(loadRoomMeeting) }, [])

  // Tell the rest of the app which call this screen is really in.
  const liveRoomId = session?.room.id || ''
  useEffect(() => {
    setActiveCallId(liveRoomId ? callIdRef.current : '')
    return () => setActiveCallId('')
  }, [liveRoomId])

  const finish = useCallback((message = '', hangUp = true) => {
    const callId = callIdRef.current
    callIdRef.current = ''
    // The caller pressing End while it still rings must cancel the call, not
    // only try to end it, or the other phone keeps ringing. A device that was
    // kicked because the same person joined from another device only closes
    // its own screen: the call is still alive on the new device.
    if (callId && hangUp) serverHangUp(callId, sessionRef.current?.role ?? 'unknown')
    setSession(null)
    setMinimized(false)
    setAcceptedAt(0)
    setNotice(message)
  }, [])

  useEffect(() => {
    const onJoin = (event: Event) => {
      const detail = (event as CustomEvent<JoinRoomDetail>).detail
      // Only chat calls. Plain ROOM 7 joins are handled by the ROOM 7 page.
      if (!detail?.code || !detail.callId) return
      // One call at a time. A second join used to take over this screen and
      // leave the first call running on the server with nobody on it.
      if (callIdRef.current && callIdRef.current !== detail.callId) {
        serverHangUp(detail.callId, 'unknown')
        setNotice('You are already on a call. End it before starting another.')
        return
      }
      callIdRef.current = detail.callId
      setAcceptedAt(0)
      // Counted as in a call from the moment it is accepted, not once the room opens.
      setActiveCallId(detail.callId)
      setNotice('')
      setMinimized(false)
      setAudioOnly(detail.audioOnly)
      void invokeJoin(detail.code)
        .then(setSession)
        .catch(error => {
          // The call row is still live on the server: close it, and stop
          // counting this phone as "in a call".
          const failed = callIdRef.current
          callIdRef.current = ''
          setActiveCallId('')
          if (failed) serverHangUp(failed, 'unknown')
          setNotice(error instanceof Error ? error.message : 'Unable to join the call.')
        })
    }
    window.addEventListener(JOIN_ROOM_EVENT, onJoin)
    return () => window.removeEventListener(JOIN_ROOM_EVENT, onJoin)
  }, [])

  // The other person answered: start the clock on how long to wait for them to arrive.
  useEffect(() => {
    const onAccepted = (event: Event) => {
      const detail = (event as CustomEvent<{ callId: string }>).detail
      if (detail?.callId && detail.callId === callIdRef.current) setAcceptedAt(Date.now())
    }
    window.addEventListener(CALL_ACCEPTED_EVENT, onAccepted)
    return () => window.removeEventListener(CALL_ACCEPTED_EVENT, onAccepted)
  }, [])

  // Whatever way a call ends, the next one starts without a stale "answered" time.
  useEffect(() => { if (!session) setAcceptedAt(0) }, [session])

  // Answered but never arrived (app closed or no signal right after Accept).
  const onNoShow = useCallback(() => {
    finish('They could not connect. Try calling again.')
  }, [finish])

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
      // Backup for a missed "answered" event: the heartbeat also says so.
      if (data === 'accepted') setAcceptedAt(current => current || Date.now())
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
        for (const status of hangUpStatuses(sessionRef.current.role)) {
          void fetch(`${url}/rest/v1/rpc/respond_chat_call`, {
            method: 'POST',
            keepalive: true,
            headers: { apikey: anon, Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_call: callId, p_status: status })
          }).catch(() => {})
        }
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
    finish(
      reason === 'lost' ? 'The call connection was lost.' : reason === 'kicked' ? 'You joined this call from another device.' : '',
      reason !== 'kicked'
    )
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
            acceptedAt={acceptedAt}
            onNoShow={onNoShow}
          />
        </Suspense>
      )}
    </>
  )
}

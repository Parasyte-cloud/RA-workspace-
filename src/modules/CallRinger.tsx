import { useCallback, useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, Video } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { announceCallFinished, requestJoinRoom } from '../lib/roomApi'
import { startTone, wireAudioUnlock } from '../lib/ringtone'
import {
  alertPermission,
  alertsPromptDismissed,
  dismissAlertsPrompt,
  flashTitle,
  requestAlertPermission,
  showDesktopAlert
} from '../lib/desktopAlerts'
import '../call-ringer.css'

type CallRow = {
  id: string
  conversation_id: string
  caller_id: string
  callee_id: string
  room_code: string
  kind: 'voice' | 'video'
  status: 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled' | 'ended'
  created_at: string
}

const RING_WINDOW_MS = 60_000
const CALLER_TIMEOUT_MS = 45_000

// Lives at the top of the workspace shell. Shows incoming calls with Accept
// and Decline, and the state of a call you started (ringing, declined).
export default function CallRinger() {
  const [me, setMe] = useState('')
  const [incoming, setIncoming] = useState<CallRow[]>([])
  const [outgoing, setOutgoing] = useState<CallRow | null>(null)
  const [outcome, setOutcome] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)
  const namesRef = useRef<Record<string, string>>({})
  const timerRef = useRef<number | null>(null)
  const meRef = useRef('')
  const [permission, setPermission] = useState(alertPermission())
  const [promptHidden, setPromptHidden] = useState(alertsPromptDismissed())

  const nameOf = (id: string) => names[id] || 'A colleague'

  const loadName = useCallback(async (id: string) => {
    const client = supabase
    if (!client || namesRef.current[id]) return
    namesRef.current[id] = '...'
    const { data } = await client.from('employee_profiles').select('full_name,email').eq('id', id).maybeSingle()
    const label = (data?.full_name as string | undefined)?.trim() || (data?.email as string | undefined) || 'A colleague'
    namesRef.current[id] = label
    setNames(current => ({ ...current, [id]: label }))
  }, [])

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handle = useCallback((row: CallRow) => {
    const mine = meRef.current
    const client = supabase
    if (!mine || !client) return

    // Tell the call window the other side is done (declined, no answer,
    // cancelled, hung up) so it can close by itself.
    if (
      (row.caller_id === mine || row.callee_id === mine) &&
      ['declined', 'missed', 'cancelled', 'ended'].includes(row.status)
    ) {
      announceCallFinished({ callId: row.id, status: row.status })
    }

    if (row.callee_id === mine) {
      void loadName(row.caller_id)
      const fresh = Date.now() - new Date(row.created_at).getTime() < RING_WINDOW_MS
      setIncoming(current => {
        const rest = current.filter(item => item.id !== row.id)
        return row.status === 'ringing' && fresh ? [...rest, row] : rest
      })
    }

    if (row.caller_id === mine) {
      void loadName(row.callee_id)
      if (row.status === 'ringing') {
        setOutcome('')
        setOutgoing(row)
        clearTimer()
        timerRef.current = window.setTimeout(() => {
          void client.rpc('respond_chat_call', { p_call: row.id, p_status: 'missed' })
        }, CALLER_TIMEOUT_MS)
      } else {
        clearTimer()
        setOutgoing(current => (current && current.id === row.id ? null : current))
        if (row.status === 'declined') setOutcome('declined')
        if (row.status === 'missed') setOutcome('no answer')
      }
    }
  }, [loadName])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let cancelled = false
    let channel: ReturnType<typeof client.channel> | null = null

    void (async () => {
      const { data } = await client.auth.getSession()
      const id = data.session?.user?.id
      if (!id || cancelled) return
      meRef.current = id
      setMe(id)

      const since = new Date(Date.now() - RING_WINDOW_MS).toISOString()
      const { data: pending } = await client
        .from('chat_calls')
        .select('id,conversation_id,caller_id,callee_id,room_code,kind,status,created_at')
        .eq('status', 'ringing')
        .gte('created_at', since)
      if (cancelled) return
      for (const row of (pending || []) as CallRow[]) handle(row)

      channel = client
        .channel(`chat-calls-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_calls' }, payload => {
          const row = payload.new as CallRow
          if (row && row.id) handle(row)
        })
        .subscribe()
    })()

    return () => {
      cancelled = true
      clearTimer()
      if (channel) void client.removeChannel(channel)
    }
  }, [handle])

  // Drop banners that rang out.
  useEffect(() => {
    if (!incoming.length) return
    const timer = window.setInterval(() => {
      setIncoming(current => current.filter(item => Date.now() - new Date(item.created_at).getTime() < RING_WINDOW_MS))
      // The database closes calls that rang out, so they show as missed in Chat.
      void supabase?.rpc('expire_chat_calls')
    }, 5000)
    return () => window.clearInterval(timer)
  }, [incoming.length])

  useEffect(() => {
    if (!outcome) return
    const timer = window.setTimeout(() => setOutcome(''), 5000)
    return () => window.clearTimeout(timer)
  }, [outcome])

  // Sound: a phone ring for an incoming call, and the ringback tone the caller
  // hears while the other phone rings. Browsers keep sound off until the
  // person has touched the page once; the card says so when that is the case.
  useEffect(() => {
    wireAudioUnlock()
  }, [])

  useEffect(() => {
    if (!incoming.length) return
    return startTone('incoming', setSoundBlocked)
  }, [incoming.length])

  const outgoingId = outgoing?.id || ''
  useEffect(() => {
    if (!outgoingId) return
    return startTone('ringback')
  }, [outgoingId])

  // Someone calling while this tab is in the background: a system alert that
  // stays until it is answered or rings out.
  const notifiedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const call of incoming) {
      if (notifiedRef.current.has(call.id)) continue
      notifiedRef.current.add(call.id)
      showDesktopAlert({
        title: `${names[call.caller_id] || 'A colleague'} is calling`,
        body: call.kind === 'video' ? 'Incoming video call' : 'Incoming voice call',
        tag: `call-${call.id}`,
        urgent: true,
        section: 'chat',
        conversationId: call.conversation_id
      })
    }
  }, [incoming, names])

  // Flash the tab title so a call is noticed from another tab.
  const firstCaller = incoming.length ? names[incoming[0].caller_id] || 'a colleague' : ''
  useEffect(() => {
    if (!firstCaller) return
    return flashTitle(`Incoming call: ${firstCaller}`)
  }, [firstCaller])

  const showPrompt = Boolean(me) && permission === 'default' && !promptHidden

  const turnOnAlerts = async () => {
    setPermission(await requestAlertPermission())
    dismissAlertsPrompt()
    setPromptHidden(true)
  }

  const laterAlerts = () => {
    dismissAlertsPrompt()
    setPromptHidden(true)
  }

  const respond = async (call: CallRow, status: 'accepted' | 'declined') => {
    const client = supabase
    if (!client || busy) return
    setBusy(true)
    const { data, error } = await client.rpc('respond_chat_call', { p_call: call.id, p_status: status })
    setBusy(false)
    setIncoming(current => current.filter(item => item.id !== call.id))
    if (error) {
      setOutcome(error.message)
      return
    }
    if (status === 'accepted') {
      if (data === 'accepted') requestJoinRoom({ code: call.room_code, audioOnly: call.kind === 'voice', callId: call.id, inPlace: true })
      else setOutcome('That call has already ended')
    }
  }

  const cancel = async (call: CallRow) => {
    const client = supabase
    if (!client) return
    clearTimer()
    setOutgoing(null)
    await client.rpc('respond_chat_call', { p_call: call.id, p_status: 'cancelled' })
  }

  if (!me || (!incoming.length && !outgoing && !outcome && !showPrompt)) return null

  return (
    <div className="callRinger responsiveModule" role="alert" aria-live="assertive">
      {incoming.map(call => (
        <div className="callCard incoming" key={call.id}>
          <span className="callPulse">{call.kind === 'video' ? <Video size={20} /> : <Phone size={20} />}</span>
          <div className="callCopy">
            <strong>{nameOf(call.caller_id)}</strong>
            <small>{soundBlocked ? 'Incoming ' + call.kind + ' call. Click anywhere to hear the ring.' : 'Incoming ' + call.kind + ' call'}</small>
          </div>
          <button type="button" className="callBtn decline" disabled={busy} onClick={() => void respond(call, 'declined')} aria-label="Decline call">
            <PhoneOff size={18} />
          </button>
          <button type="button" className="callBtn accept" disabled={busy} onClick={() => void respond(call, 'accepted')} aria-label="Accept call">
            <Phone size={18} />
          </button>
        </div>
      ))}
      {outgoing && (
        <div className="callCard outgoing">
          <span className="callPulse">{outgoing.kind === 'video' ? <Video size={20} /> : <Phone size={20} />}</span>
          <div className="callCopy">
            <strong>Calling {nameOf(outgoing.callee_id)}</strong>
            <small>Ringing...</small>
          </div>
          <button type="button" className="callBtn decline" onClick={() => void cancel(outgoing)} aria-label="Cancel call">
            <PhoneOff size={18} />
          </button>
        </div>
      )}
      {showPrompt && (
        <div className="callCard alerts">
          <div className="callCopy">
            <strong>Get alerts for calls and messages</strong>
            <small>Shown when this tab is in the background</small>
          </div>
          <button type="button" className="callBtn later" onClick={laterAlerts}>Later</button>
          <button type="button" className="callBtn accept" onClick={() => void turnOnAlerts()}>On</button>
        </div>
      )}
      {outcome && !outgoing && (
        <div className="callCard note">
          <div className="callCopy">
            <strong>{outcome === 'declined' || outcome === 'no answer' ? `Call ${outcome}` : outcome}</strong>
          </div>
        </div>
      )}
    </div>
  )
}

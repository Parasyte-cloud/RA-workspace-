import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Clock3,
  Hand,
  SmilePlus,
  X,
} from 'lucide-react'
import type { useRealtimeKitClient } from '@cloudflare/realtimekit-react'
import './room7-meeting-extras.css'

/*
 * ROOM 7 meeting extras: raise hand, reactions and scheduled-end control.
 *
 * RealtimeKit's stock UI has no hand raise or reactions, so these ride on
 * RealtimeKit broadcast messages. Every client in the meeting (staff and
 * guests) runs this hook, so they all see the same hands and reactions.
 * Nothing here grants power: lowering someone else's hand is honoured only
 * when it comes from a host, and ending the meeting still goes through the
 * server with the host's own session.
 */

type Meeting = NonNullable<
  ReturnType<typeof useRealtimeKitClient>[0]
>

export type Room7ExtrasRole =
  | 'host'
  | 'member'
  | 'guest'

type RaisedHand = {
  peer: string
  name: string
  at: number
}

type Reaction = {
  key: number
  emoji: string
  name: string
  left: number
}

type Toast = {
  key: number
  text: string
}

const REACTIONS = ['👍', '👏', '❤️', '😂', '🎉', '😮', '🙏']

const MSG_HAND = 'r7:hand'
const MSG_LOWER = 'r7:hand-lower'
const MSG_REACT = 'r7:react'
const MSG_SYNC = 'r7:sync'
const MSG_SCHEDULE = 'r7:schedule'

const HOST_END_PROMPT_SECONDS = 60
const NON_HOST_GRACE_MS = 2 * 60 * 1000
// An end time this far in the past is stale (for example yesterday's event
// on a reused room). Ignore it rather than ending a meeting that is unrelated.
const STALE_SCHEDULE_MS = 6 * 60 * 60 * 1000
const EXTEND_MINUTES = 15

function parseEnd(
  value: string | null | undefined,
) {
  if (!value) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  if (Date.now() - time > STALE_SCHEDULE_MS) return null
  return time
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(hours ? 2 : 1, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

export type Room7MeetingExtras = ReturnType<
  typeof useRoom7MeetingExtras
>

export function useRoom7MeetingExtras({
  meeting,
  role,
  scheduledEnd,
  onAutoEnd,
  onExtend,
  onScheduleLeave,
}: {
  meeting: Meeting | null | undefined
  role: Room7ExtrasRole
  scheduledEnd?: string | null
  onAutoEnd?: () => Promise<void>
  onExtend?: (endIso: string) => Promise<void>
  onScheduleLeave?: () => void
}) {
  const isHost = role === 'host'
  const [hands, setHands] = useState<RaisedHand[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [endAt, setEndAt] = useState<number | null>(() =>
    parseEnd(scheduledEnd),
  )
  const [now, setNow] = useState(() => Date.now())
  const [endPromptOpen, setEndPromptOpen] = useState(false)
  const [endPromptStartedAt, setEndPromptStartedAt] = useState<number | null>(null)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [scheduleError, setScheduleError] = useState('')

  const keyRef = useRef(0)
  const lastReactionRef = useRef(0)
  const warnedRef = useRef<Set<number>>(new Set())
  const scheduleLeftRef = useRef(false)
  const autoEndedRef = useRef(false)
  const handsRef = useRef(hands)
  handsRef.current = hands

  const selfPeer = meeting?.self?.id || ''
  const selfName = meeting?.self?.name || 'Participant'
  const myHandRaised = hands.some(hand => hand.peer === selfPeer)

  useEffect(() => {
    setEndAt(parseEnd(scheduledEnd))
  }, [scheduledEnd])

  const pushToast = useCallback((text: string) => {
    const key = ++keyRef.current
    setToasts(current => [...current.slice(-3), { key, text }])
    window.setTimeout(() => {
      setToasts(current => current.filter(toast => toast.key !== key))
    }, 4500)
  }, [])

  const showReaction = useCallback((emoji: string, name: string) => {
    const key = ++keyRef.current
    const left = 8 + Math.random() * 70
    setReactions(current => [...current.slice(-19), { key, emoji, name, left }])
    window.setTimeout(() => {
      setReactions(current => current.filter(item => item.key !== key))
    }, 3200)
  }, [])

  const broadcast = useCallback(
    async (type: string, payload: Record<string, string | number | boolean>) => {
      if (!meeting) return
      try {
        await meeting.participants.broadcastMessage(
          type,
          payload as Parameters<Meeting['participants']['broadcastMessage']>[1],
        )
      } catch (error) {
        console.warn('ROOM 7 broadcast failed:', type, error)
      }
    },
    [meeting],
  )

  const upsertHand = useCallback((hand: RaisedHand) => {
    setHands(current =>
      [...current.filter(item => item.peer !== hand.peer), hand]
        .sort((a, b) => a.at - b.at),
    )
  }, [])

  const removeHand = useCallback((peer: string) => {
    setHands(current => current.filter(item => item.peer !== peer))
  }, [])

  // Incoming broadcasts.
  useEffect(() => {
    if (!meeting) return

    const participants = meeting.participants
    const handler = ({
      type,
      payload,
    }: {
      type: string
      payload: Record<string, unknown>
    }) => {
      const peer = typeof payload?.peer === 'string' ? payload.peer : ''
      const name = typeof payload?.name === 'string' && payload.name.trim()
        ? payload.name.trim().slice(0, 60)
        : 'Someone'

      if (type === MSG_HAND && peer && peer !== meeting.self.id) {
        if (payload.raised === true) {
          const isNew = !handsRef.current.some(item => item.peer === peer)
          upsertHand({
            peer,
            name,
            at: typeof payload.at === 'number' ? payload.at : Date.now(),
          })
          if (isNew) pushToast(`${name} raised their hand`)
        } else {
          removeHand(peer)
        }
        return
      }

      if (type === MSG_LOWER) {
        // Hosts send this to lower hands. RealtimeKit does not tell us who
        // sent a broadcast, so a determined participant could forge it; the
        // worst it can do is lower a hand, which is harmless.
        if (payload.fromHost !== true) return
        if (payload.all === true) {
          setHands([])
          pushToast('The host lowered all hands')
          return
        }
        if (peer) {
          removeHand(peer)
          if (peer === meeting.self.id) pushToast('The host lowered your hand')
        }
        return
      }

      if (type === MSG_REACT && typeof payload.emoji === 'string') {
        if (!REACTIONS.includes(payload.emoji)) return
        if (peer === meeting.self.id) return
        showReaction(payload.emoji, name)
        return
      }

      if (type === MSG_SYNC && peer !== meeting.self.id) {
        const mine = handsRef.current.find(item => item.peer === meeting.self.id)
        if (mine) {
          void broadcast(MSG_HAND, {
            raised: true,
            peer: mine.peer,
            name: mine.name,
            at: mine.at,
          })
        }
        return
      }

      if (type === MSG_SCHEDULE && typeof payload.end === 'string') {
        const next = parseEnd(payload.end)
        setEndAt(next)
        warnedRef.current.clear()
        scheduleLeftRef.current = false
        autoEndedRef.current = false
        setEndPromptOpen(false)
        if (next) {
          pushToast(`Meeting extended to ${new Date(next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
        }
      }
    }

    participants.on('broadcastedMessage', handler as never)

    const handleLeft = (participant: { id: string }) => removeHand(participant.id)
    participants.joined.on('participantLeft', handleLeft as never)

    // Ask whoever is already here to re-announce raised hands.
    const syncTimer = window.setTimeout(() => {
      void broadcast(MSG_SYNC, { peer: meeting.self.id })
    }, 1500)

    return () => {
      window.clearTimeout(syncTimer)
      participants.removeListener('broadcastedMessage', handler as never)
      participants.joined.removeListener('participantLeft', handleLeft as never)
    }
  }, [meeting, broadcast, pushToast, removeHand, showReaction, upsertHand])

  const toggleHand = useCallback(() => {
    if (!meeting) return
    const peer = meeting.self.id
    if (handsRef.current.some(item => item.peer === peer)) {
      removeHand(peer)
      void broadcast(MSG_HAND, { raised: false, peer, name: selfName })
    } else {
      const hand = { peer, name: selfName, at: Date.now() }
      upsertHand(hand)
      void broadcast(MSG_HAND, { raised: true, ...hand })
    }
  }, [meeting, broadcast, removeHand, selfName, upsertHand])

  const lowerHand = useCallback((peer: string) => {
    if (!isHost) return
    if (meeting && peer === meeting.self.id) {
      removeHand(peer)
      void broadcast(MSG_HAND, { raised: false, peer, name: selfName })
      return
    }
    removeHand(peer)
    void broadcast(MSG_LOWER, { peer, all: false, fromHost: true })
  }, [broadcast, isHost, meeting, removeHand, selfName])

  const lowerAllHands = useCallback(() => {
    if (!isHost) return
    setHands([])
    void broadcast(MSG_LOWER, { peer: '', all: true, fromHost: true })
  }, [broadcast, isHost])

  const react = useCallback((emoji: string) => {
    if (!meeting || !REACTIONS.includes(emoji)) return
    const time = Date.now()
    if (time - lastReactionRef.current < 600) return
    lastReactionRef.current = time
    setPickerOpen(false)
    showReaction(emoji, 'You')
    void broadcast(MSG_REACT, { emoji, peer: meeting.self.id, name: selfName })
  }, [meeting, broadcast, selfName, showReaction])

  // Scheduled end: tick once a second while a schedule is set.
  useEffect(() => {
    if (!endAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [endAt])

  const remainingMs = endAt ? endAt - now : null

  useEffect(() => {
    if (remainingMs === null || !meeting) return

    for (const minutes of [10, 5, 1]) {
      const threshold = minutes * 60 * 1000
      if (
        remainingMs <= threshold &&
        remainingMs > threshold - 5000 &&
        !warnedRef.current.has(minutes)
      ) {
        warnedRef.current.add(minutes)
        pushToast(`This meeting is scheduled to end in ${minutes} minute${minutes === 1 ? '' : 's'}`)
      }
    }

    if (remainingMs > 0) return

    if (isHost && onAutoEnd) {
      if (!endPromptOpen && !autoEndedRef.current) {
        setEndPromptOpen(true)
        setEndPromptStartedAt(Date.now())
      }
      return
    }

    if (
      !isHost &&
      remainingMs <= -NON_HOST_GRACE_MS &&
      !scheduleLeftRef.current
    ) {
      scheduleLeftRef.current = true
      if (onScheduleLeave) {
        onScheduleLeave()
      } else {
        void meeting.leave().catch(() => {})
      }
    }
  }, [remainingMs, meeting, isHost, onAutoEnd, onScheduleLeave, endPromptOpen, pushToast])

  const endNow = useCallback(async () => {
    if (!onAutoEnd || autoEndedRef.current) return
    autoEndedRef.current = true
    setScheduleBusy(true)
    setScheduleError('')
    try {
      await onAutoEnd()
      setEndPromptOpen(false)
    } catch (error) {
      autoEndedRef.current = false
      setScheduleError(error instanceof Error ? error.message : 'Unable to end ROOM 7.')
    } finally {
      setScheduleBusy(false)
    }
  }, [onAutoEnd])

  const extend = useCallback(async () => {
    if (!onExtend) return
    setScheduleBusy(true)
    setScheduleError('')
    try {
      const base = Math.max(Date.now(), endAt || Date.now())
      const next = new Date(base + EXTEND_MINUTES * 60 * 1000).toISOString()
      await onExtend(next)
      setEndAt(Date.parse(next))
      warnedRef.current.clear()
      setEndPromptOpen(false)
      void broadcast(MSG_SCHEDULE, { end: next })
      pushToast(`Extended by ${EXTEND_MINUTES} minutes`)
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'Unable to extend ROOM 7.')
    } finally {
      setScheduleBusy(false)
    }
  }, [broadcast, endAt, onExtend, pushToast])

  // Host prompt auto-ends when its countdown runs out.
  const promptRemaining = endPromptOpen && endPromptStartedAt
    ? Math.min(
        HOST_END_PROMPT_SECONDS,
        Math.max(0, HOST_END_PROMPT_SECONDS - Math.floor((now - endPromptStartedAt) / 1000)),
      )
    : null

  useEffect(() => {
    if (promptRemaining === 0 && !autoEndedRef.current && !scheduleBusy) {
      void endNow()
    }
  }, [promptRemaining, endNow, scheduleBusy])

  return useMemo(() => ({
    ready: Boolean(meeting),
    isHost,
    hands,
    myHandRaised,
    reactions,
    toasts,
    pickerOpen,
    setPickerOpen,
    toggleHand,
    lowerHand,
    lowerAllHands,
    react,
    endAt,
    remainingMs,
    endPromptOpen,
    promptRemaining,
    scheduleBusy,
    scheduleError,
    canExtend: Boolean(onExtend),
    endNow,
    extend,
  }), [
    meeting, isHost, hands, myHandRaised, reactions, toasts, pickerOpen,
    toggleHand, lowerHand, lowerAllHands, react, endAt, remainingMs,
    endPromptOpen, promptRemaining, scheduleBusy, scheduleError, onExtend,
    endNow, extend,
  ])
}

export function Room7ExtrasControls({
  extras,
  compact = false,
}: {
  extras: Room7MeetingExtras
  compact?: boolean
}) {
  if (!extras.ready) return null

  return (
    <div className={`r7xControls ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className={`r7xButton ${extras.myHandRaised ? 'active' : ''}`}
        aria-pressed={extras.myHandRaised}
        onClick={extras.toggleHand}
        title={extras.myHandRaised ? 'Lower your hand' : 'Raise your hand'}
      >
        <Hand size={16} />
        <span>{extras.myHandRaised ? 'Lower hand' : 'Raise hand'}</span>
      </button>

      <div className="r7xReactWrap">
        <button
          type="button"
          className={`r7xButton ${extras.pickerOpen ? 'active' : ''}`}
          aria-haspopup="true"
          aria-expanded={extras.pickerOpen}
          onClick={() => extras.setPickerOpen(!extras.pickerOpen)}
          title="Send a reaction"
        >
          <SmilePlus size={16} />
          <span>React</span>
        </button>

        {extras.pickerOpen && (
          <div className="r7xPicker" role="menu">
            {REACTIONS.map(emoji => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                onClick={() => extras.react(emoji)}
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {extras.remainingMs !== null && extras.remainingMs <= 15 * 60 * 1000 && (
        <span
          className={`r7xTimer ${extras.remainingMs <= 60 * 1000 ? 'urgent' : ''}`}
          role="timer"
          title="Time left before the scheduled end"
        >
          <Clock3 size={14} />
          {extras.remainingMs > 0 ? formatRemaining(extras.remainingMs) : 'Time up'}
        </span>
      )}
    </div>
  )
}

export function Room7ExtrasOverlay({
  extras,
}: {
  extras: Room7MeetingExtras
}) {
  if (!extras.ready) return null

  return (
    <div className="r7xOverlay" aria-live="polite">
      {extras.hands.length > 0 && (
        <section className="r7xHands" aria-label="Raised hands">
          <header>
            <Hand size={14} />
            <strong>{extras.hands.length} hand{extras.hands.length === 1 ? '' : 's'} raised</strong>
            {extras.isHost && extras.hands.length > 1 && (
              <button type="button" onClick={extras.lowerAllHands}>Lower all</button>
            )}
          </header>
          <ol>
            {extras.hands.map(hand => (
              <li key={hand.peer}>
                <span>{hand.name}</span>
                {extras.isHost && (
                  <button
                    type="button"
                    onClick={() => extras.lowerHand(hand.peer)}
                    aria-label={`Lower ${hand.name}'s hand`}
                    title="Lower hand"
                  >
                    <X size={13} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="r7xReactions" aria-hidden="true">
        {extras.reactions.map(item => (
          <span key={item.key} className="r7xReaction" style={{ left: `${item.left}%` }}>
            <b>{item.emoji}</b>
            <small>{item.name}</small>
          </span>
        ))}
      </div>

      <div className="r7xToasts">
        {extras.toasts.map(toast => (
          <div key={toast.key} className="r7xToast">{toast.text}</div>
        ))}
      </div>

      {extras.endPromptOpen && (
        <div className="r7xEndPrompt" role="alertdialog" aria-labelledby="r7x-end-title">
          <div>
            <Clock3 size={22} />
            <h3 id="r7x-end-title">Scheduled time is up</h3>
            <p>
              ROOM 7 will end for everyone in{' '}
              <strong>{extras.promptRemaining ?? 0}s</strong> unless you extend it.
            </p>
            {extras.scheduleError && <p className="r7xError">{extras.scheduleError}</p>}
            <div className="r7xEndActions">
              {extras.canExtend && (
                <button type="button" className="r7xPrimary" disabled={extras.scheduleBusy} onClick={() => void extras.extend()}>
                  Extend {EXTEND_MINUTES} minutes
                </button>
              )}
              <button type="button" className="r7xDanger" disabled={extras.scheduleBusy} onClick={() => void extras.endNow()}>
                End now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

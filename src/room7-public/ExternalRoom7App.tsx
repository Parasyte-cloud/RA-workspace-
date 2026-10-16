import {
  FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import Room7GuestDocuments from './Room7GuestDocuments'
import Room7Install, { registerRoom7Worker } from './Room7Install'
import Room7PublicExperienceSections, {
  Room7PublicExperienceNavigation,
} from './Room7PublicExperienceSections'
import {
  admissionAction,
  makeRequestKey,
  POLL_WAITING_MS,
} from '../lib/room7Admission'
import './room7-public.css'
import './room7-theme-generated.css'
import './room7-theme.css'
import './room7-island.css'
import './room7-top-island.css'
import Room7TopIsland from './Room7TopIsland'
import '../room7-shared/room7-lobby-chat.css'
import { useRoom7Appearance } from './room7Theme'
import Room7LobbyChat from '../room7-shared/Room7LobbyChat'
import { prefetchWhenIdle } from '../lib/prefetch'
import { googleCalendarUrl, icsFile, outlookCalendarUrl } from '../lib/room7Share'
import type { CalendarEvent } from '../lib/room7Share'

const loadExternalMeeting = () => import('./ExternalRoom7Meeting')
const ExternalRoom7Meeting = lazy(loadExternalMeeting)

type RoomState =
  | 'draft'
  | 'pre_event'
  | 'doors_open'
  | 'live'
  | 'intermission'
  | 'ended'
  | 'replay'

type AccessMode =
  | 'invitation'
  | 'passcode'
  | 'open'

type RoomKind =
  | 'standard'
  | 'executive'
  | 'investor'
  | 'webinar'
  | 'launch'
  | 'town_hall'

type PublicRoom = {
  title: string
  slug: string | null
  room_kind: RoomKind
  access_mode: AccessMode
  event_state: RoomState
  public_summary: string | null
  timezone: string
  scheduled_start: string | null
  scheduled_end: string | null
  join_available: boolean
  past_scheduled_end?: boolean
  requires_invitation: boolean
  requires_passcode: boolean
  requires_email: boolean
  // 'host' means the host lets each guest in. Older servers omit it.
  admission?: 'auto' | 'host'
}

type Locator = {
  slug?: string
  room_code?: string
}

type JoinResponse = {
  room: PublicRoom
  guest: {
    display_name: string
    role: string
  }
  auth_token: string
  // The host has not let this guest in yet. Keep asking.
  waiting?: boolean
}

const stateLabels: Record<RoomState, string> = {
  draft: 'Preparing',
  pre_event: 'Pre-event',
  doors_open: 'Doors open',
  live: 'Live now',
  intermission: 'Intermission',
  ended: 'Event ended',
  replay: 'Replay',
}

function cleanCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 8)
}

function parseLocator(): Locator | null {
  const url =
    new URL(window.location.href)

  const params =
    url.searchParams

  if (
    import.meta.env.DEV &&
    params.get('surface') === 'room7-public'
  ) {
    const devRoom =
      (
        params.get('room') ||
        params.get('slug') ||
        ''
      ).trim()

    if (!devRoom) {
      return null
    }

    const devCode =
      devRoom.toUpperCase()

    if (
      /^[A-Z2-9]{8}$/.test(
        devCode,
      )
    ) {
      return {
        room_code: devCode,
      }
    }

    const devSlug =
      devRoom.toLowerCase()

    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
        devSlug,
      )
    ) {
      return null
    }

    return {
      slug: devSlug,
    }
  }

  const parts =
    window.location.pathname
      .split('/')
      .filter(Boolean)
      .map(part => decodeURIComponent(part))

  if (
    parts[0] === 'r' &&
    parts[1]
  ) {
    const code =
      cleanCode(parts[1])

    if (
      code.length !== 8
    ) {
      return null
    }

    return {
      room_code: code,
    }
  }

  if (
    parts.length === 1 &&
    parts[0]
  ) {
    return {
      slug:
        parts[0].toLowerCase(),
    }
  }

  return null
}

function locatorKey(
  locator: Locator | null,
) {
  if (!locator) {
    return 'unknown'
  }

  return locator.slug
    ? `slug:${locator.slug}`
    : `code:${locator.room_code}`
}

function captureInvitation(
  locator: Locator | null,
) {
  const url =
    new URL(window.location.href)

  const hashParams =
    new URLSearchParams(
      url.hash.startsWith('#')
        ? url.hash.slice(1)
        : url.hash,
    )

  const fragmentInvite =
    (
      hashParams.get('invite') ||
      ''
    ).trim()

  const queryInvite =
    (
      url.searchParams.get(
        'invite',
      ) || ''
    ).trim()

  const invite =
    fragmentInvite ||
    queryInvite

  const key =
    `ridearrivo:room7:invite:${locatorKey(locator)}`

  if (invite) {
    sessionStorage.setItem(
      key,
      invite,
    )

    // Backward compatibility:
    // remove legacy ?invite= links too.
    url.searchParams.delete(
      'invite',
    )

    // Preferred form:
    // #invite= never reaches the HTTP server.
    hashParams.delete(
      'invite',
    )

    const remainingHash =
      hashParams.toString()

    url.hash =
      remainingHash
        ? `#${remainingHash}`
        : ''

    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
  }

  return (
    invite ||
    sessionStorage.getItem(key) ||
    ''
  )
}

async function room7Request<T>(
  body: Record<string, unknown>,
): Promise<T> {
  const supabaseUrl =
    import.meta.env.VITE_SUPABASE_URL as
      | string
      | undefined

  const anonKey =
    import.meta.env.VITE_SUPABASE_ANON_KEY as
      | string
      | undefined

  if (
    !supabaseUrl ||
    !anonKey
  ) {
    throw new Error(
      'ROOM 7 is not configured for this environment.',
    )
  }

  const response =
    await fetch(
      `${supabaseUrl}/functions/v1/room-guest-session`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization:
            `Bearer ${anonKey}`,
          'Content-Type':
            'application/json',
        },
        body:
          JSON.stringify(body),
      },
    )

  const payload =
    await response
      .json()
      .catch(() => null)

  if (
    !response.ok
  ) {
    throw new Error(
      payload?.error ||
      'ROOM 7 is temporarily unavailable.',
    )
  }

  return payload as T
}

// The countdown ticks once a second, so it lives in its own component: only
// these four numbers re-render, not the whole page. Screen readers get one
// calm sentence instead of numbers changing every second.
function Room7Countdown({ target }: { target: string | null }) {
  const countdown = useCountdown(target)
  if (!countdown) return null
  const spoken = `Starts in ${countdown.days} days, ${countdown.hours} hours and ${countdown.minutes} minutes`
  const two = (value: number) => String(value).padStart(2, '0')
  return (
    <div className="room7PublicCountdown" role="timer" aria-label={spoken}>
      <div aria-hidden="true"><strong>{countdown.days}</strong><span>Days</span></div>
      <div aria-hidden="true"><strong>{two(countdown.hours)}</strong><span>Hours</span></div>
      <div aria-hidden="true"><strong>{two(countdown.minutes)}</strong><span>Minutes</span></div>
      <div aria-hidden="true"><strong>{two(countdown.seconds)}</strong><span>Seconds</span></div>
    </div>
  )
}

// Guests plan around invitations: let them put the event in their calendar.
// The link carries no token, only the public event address.
function Room7AddToCalendar({ room }: { room: PublicRoom }) {
  const start = new Date(room.scheduled_start || '')
  if (Number.isNaN(start.getTime())) return null
  const end = room.scheduled_end ? new Date(room.scheduled_end) : null
  const minutes = end && !Number.isNaN(end.getTime()) && end > start
    ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000))
    : 60
  const here = new URL(window.location.href)
  here.search = ''
  here.hash = ''
  const event: CalendarEvent = {
    title: room.title,
    start,
    minutes,
    location: here.toString(),
    details: `${room.public_summary ? `${room.public_summary}\n\n` : ''}Join the event: ${here.toString()}`,
  }
  const download = () => {
    const blob = new Blob([icsFile(event, `${room.slug || room.title}@room7.ridearrivo.com`)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'room7-event.ics'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="room7PublicCalendar" aria-label="Add this event to your calendar">
      <span>Add to calendar</span>
      <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">Google</a>
      <a href={outlookCalendarUrl(event)} target="_blank" rel="noopener noreferrer">Outlook</a>
      <button type="button" onClick={download}>Apple / other</button>
    </div>
  )
}

function formatEventDate(
  value: string | null,
  timezone: string,
) {
  if (!value) {
    return 'Schedule to be announced'
  }

  const date =
    new Date(value)

  return new Intl.DateTimeFormat(
    'en-NG',
    {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    },
  ).format(date)
}

function useCountdown(
  target: string | null,
) {
  const [now, setNow] =
    useState(() => Date.now())

  useEffect(() => {
    const timer =
      window.setInterval(
        () => setNow(Date.now()),
        1000,
      )

    return () =>
      window.clearInterval(timer)
  }, [])

  if (!target) {
    return null
  }

  const distance =
    Math.max(
      0,
      new Date(target).getTime() -
        now,
    )

  const seconds =
    Math.floor(distance / 1000)

  return {
    days:
      Math.floor(
        seconds / 86400,
      ),
    hours:
      Math.floor(
        (seconds % 86400) / 3600,
      ),
    minutes:
      Math.floor(
        (seconds % 3600) / 60,
      ),
    seconds:
      seconds % 60,
    complete:
      distance === 0,
  }
}

const GUEST_MEMORY_KEY = 'ridearrivo:room7:guest'

// Returning guests should not retype their name and email on every visit.
function readGuestMemory(): { name: string; email: string } {
  try {
    const raw = window.localStorage.getItem(GUEST_MEMORY_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return {
      name: typeof parsed?.name === 'string' ? parsed.name.slice(0, 180) : '',
      email: typeof parsed?.email === 'string' ? parsed.email.slice(0, 320) : '',
    }
  } catch {
    return { name: '', email: '' }
  }
}

function writeGuestMemory(name: string, email: string) {
  try {
    window.localStorage.setItem(GUEST_MEMORY_KEY, JSON.stringify({ name, email }))
  } catch {
    /* storage blocked: the form simply starts empty next time */
  }
}

const INCORRECT_PASSCODE = /passcode is incorrect/i

// One random key per browser tab and event. The server ties the host's
// approval to it. sessionStorage keeps a refresh from losing the place in
// the queue; if storage is blocked the key just lives for this page load.
const memoryKeys = new Map<string, string>()

function requestKeyFor(locator: Locator | null) {
  const key = `ridearrivo:room7:reqkey:${locatorKey(locator)}`

  try {
    const stored = window.sessionStorage.getItem(key)
    if (stored && stored.length >= 16) return stored
    const fresh = makeRequestKey()
    window.sessionStorage.setItem(key, fresh)
    return fresh
  } catch {
    const existing = memoryKeys.get(key)
    if (existing) return existing
    const fresh = makeRequestKey()
    memoryKeys.set(key, fresh)
    return fresh
  }
}

export default function ExternalRoom7App() {
  const appearance = useRoom7Appearance()
  useEffect(() => {
    registerRoom7Worker()
    prefetchWhenIdle(loadExternalMeeting)
  }, [])

  const locator =
    useMemo(
      () => parseLocator(),
      [],
    )

  const inviteToken =
    useMemo(
      () =>
        captureInvitation(
          locator,
        ),
      [locator],
    )

  const [room, setRoom] =
    useState<PublicRoom | null>(
      null,
    )

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState('')

  const [joining, setJoining] =
    useState(false)

  const [authToken, setAuthToken] =
    useState('')

  const [remembered] =
    useState(readGuestMemory)

  const [name, setName] =
    useState(remembered.name)

  const [email, setEmail] =
    useState(remembered.email)

  const [passcode, setPasscode] =
    useState('')

  // The passcode that actually worked, so a reconnect can reuse it.
  const [usedPasscode, setUsedPasscode] =
    useState('')

  // The event code in the link opens the room by itself. The separate
  // passcode box only appears when the host also set one.
  const [showPasscode, setShowPasscode] =
    useState(false)

  // True while the host has not yet let this guest in.
  const [waiting, setWaiting] =
    useState(false)

  const requestKey =
    useMemo(
      () => requestKeyFor(locator),
      [locator],
    )

  const [consent, setConsent] =
    useState(false)

  const [rejoinCount, setRejoinCount] =
    useState(0)

  // Front door for room7.ridearrivo.com with no event in the address
  // (for example the installed app's start page).
  const [entryValue, setEntryValue] =
    useState('')

  const [entryError, setEntryError] =
    useState('')

  const [entryBusy, setEntryBusy] =
    useState(false)

  const openEntry =
    async (
      event: FormEvent,
    ) => {
      event.preventDefault()
      setEntryError('')

      let value =
        entryValue.trim()

      // Accept a pasted link as well as a bare code or event name.
      if (/^https?:\/\//i.test(value)) {
        try {
          value = new URL(value).pathname
        } catch {
          // Fall through with the raw text.
        }
      }

      value = value
        // Links pasted without https:// still carry the domain.
        .replace(/^(?:https?:\/\/)?(?:www\.)?room7\.ridearrivo\.com/i, '')
        .replace(/[?#].*$/, '')
        .replace(/^\/+|\/+$/g, '')
        .replace(/^r\//i, '')

      const code =
        value.toUpperCase()

      const looksLikeCode =
        /^[A-Z2-9]{8}$/.test(code)

      const looksLikeSlug =
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value)

      if (!looksLikeCode && !looksLikeSlug) {
        setEntryError(
          'Enter the 8-character ROOM 7 code or the event link from your invitation.',
        )
        return
      }

      setEntryBusy(true)

      // A short event name can look like a code, so try the code first
      // and fall back to the event name.
      const attempts: Array<[string, Locator]> = []

      if (looksLikeCode) {
        attempts.push([`/r/${code}`, { room_code: code }])
      }

      if (looksLikeSlug) {
        attempts.push([`/${value.toLowerCase()}`, { slug: value.toLowerCase() }])
      }

      for (const [path, candidate] of attempts) {
        try {
          await room7Request<{ room: PublicRoom }>({
            action: 'resolve',
            ...candidate,
          })
          window.location.assign(path)
          return
        } catch {
          // Try the next reading of what was typed.
        }
      }

      setEntryBusy(false)
      setEntryError(
        'No ROOM 7 event matches that. Check the code or link in your invitation.',
      )
    }

  useEffect(() => {
    document.title =
      room?.title
        ? `${room.title} | ROOM 7`
        : 'RideArrivo ROOM 7'
  }, [room?.title])

  // Event pages are for invited guests: keep them out of search results.
  useEffect(() => {
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex, nofollow'
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [])

  useEffect(() => {
    if (!locator) {
      setLoading(false)
      return
    }

    let cancelled = false

    const resolve = async () => {
      setLoading(true)
      setError('')

      try {
        const response =
          await room7Request<{
            room: PublicRoom
          }>({
            action: 'resolve',
            ...locator,
          })

        if (!cancelled) {
          setRoom(response.room)
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to open ROOM 7.',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void resolve()

    return () => {
      cancelled = true
    }
  }, [locator])

  // Waiting for the host. Ask every few seconds; the moment the host admits
  // this guest, join for real. A refusal ends the wait with a clear message.
  useEffect(() => {
    if (!waiting || !locator || authToken) return

    let cancelled = false
    let busy = false

    const check = async () => {
      if (busy || cancelled) return
      busy = true

      try {
        const answer =
          await room7Request<{ request_status: string }>({
            action: 'status',
            ...locator,
            request_key: requestKey,
          })

        const next = admissionAction(answer.request_status)

        if (cancelled) return

        if (next === 'refused') {
          setWaiting(false)
          setError('The host did not let you in to this ROOM 7 event.')
        } else if (next === 'enter') {
          const { response, used } = await joinRequest()

          if (cancelled) return

          if (response.auth_token) {
            setUsedPasscode(used)
            setWaiting(false)
            setAuthToken(response.auth_token)
          }
        }
      } catch (cause) {
        if (cancelled) return

        const message =
          cause instanceof Error ? cause.message : ''

        // Real refusals (removed, event ended) stop the wait. A passing
        // network error just tries again on the next tick.
        if (/removed|ended|not open|did not let you/i.test(message)) {
          setWaiting(false)
          setError(message)
        }
      } finally {
        busy = false
      }
    }

    const timer = window.setInterval(() => void check(), POLL_WAITING_MS)
    void check()

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // joinRequest is rebuilt each render; the values it reads are listed.
  }, [waiting, locator, authToken, requestKey, name, email, passcode, usedPasscode])

  // Guests who arrive early wait here and are let in by themselves: the page
  // checks every few seconds and shows the join form the moment the host opens
  // the room. Nobody has to refresh or ask for a new link.
  useEffect(() => {
    if (
      !locator ||
      !room ||
      authToken ||
      room.join_available ||
      room.past_scheduled_end ||
      room.event_state === 'ended' ||
      room.event_state === 'replay'
    ) {
      return
    }

    let cancelled = false

    const check = async () => {
      if (document.visibilityState === 'hidden') return

      try {
        const response =
          await room7Request<{ room: PublicRoom }>({
            action: 'resolve',
            ...locator,
          })

        if (!cancelled) setRoom(response.room)
      } catch {
        // Keep waiting; the next check tries again.
      }
    }

    const timer = window.setInterval(() => void check(), 5000)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [
    locator,
    room,
    authToken,
  ])

  // Passcodes are case sensitive on the server, and phones love capital letters
  // or none at all. The event code from the link is tried as the passcode too:
  // that is how "just the code" events work, with nothing extra to type. Only
  // if every candidate is refused does the guest see the passcode box.
  const lobbyTransport = useCallback(
    (action: 'lobby_chat_list' | 'lobby_chat_send', text?: string) =>
      room7Request<{ messages?: import('../room7-shared/Room7LobbyChat').LobbyMessage[] }>({
        action,
        ...locator,
        request_key: requestKey,
        ...(text ? { body: text } : {}),
      }),
    [locator, requestKey],
  )

  const joinRequest =
    async (): Promise<{ response: JoinResponse; used: string }> => {
      const send =
        (code: string | undefined) =>
          room7Request<JoinResponse>({
            action: 'join',
            ...locator,
            display_name:
              name.trim(),
            email:
              email.trim(),
            passcode:
              room?.requires_passcode
                ? code
                : undefined,
            invite_token:
              room?.requires_invitation
                ? inviteToken
                : undefined,
            request_key:
              requestKey,
          })

      if (!room?.requires_passcode) {
        return { response: await send(undefined), used: '' }
      }

      const typed = passcode.trim()
      const eventCode = locator?.room_code ?? ''

      const candidates = [
        usedPasscode,
        typed,
        typed.toUpperCase(),
        eventCode,
      ].filter(
        (value, index, all) => value && all.indexOf(value) === index,
      )

      if (!candidates.length) candidates.push('')

      let last: unknown = null

      for (const candidate of candidates) {
        try {
          return { response: await send(candidate), used: candidate }
        } catch (cause) {
          last = cause

          if (
            !(cause instanceof Error) ||
            !INCORRECT_PASSCODE.test(cause.message)
          ) {
            throw cause
          }
        }
      }

      throw last
    }

  // Used by the meeting after a dropped connection: same guest details,
  // fresh token. The server replaces the dead connection, so the guest does
  // not appear twice.
  const rejoin =
    async () => {
      if (
        !room ||
        !locator
      ) {
        return false
      }

      const { response, used } =
        await joinRequest()

      if (!response.auth_token) {
        return false
      }

      setUsedPasscode(used)

      if (response.room) {
        setRoom(response.room)
      }

      setRejoinCount(count => count + 1)
      setAuthToken(response.auth_token)
      return true
    }

  const submitJoin =
    async (
      event: FormEvent,
    ) => {
      event.preventDefault()

      if (
        !room ||
        !locator
      ) {
        return
      }

      if (!consent) {
        setError(
          'Please acknowledge the ROOM 7 participation notice before joining.',
        )
        return
      }

      if (
        room.access_mode ===
          'invitation' &&
        !inviteToken
      ) {
        setError(
          'A valid invitation link is required to join this ROOM 7 event.',
        )
        return
      }

      setJoining(true)
      setError('')

      try {
        const { response, used } =
          await joinRequest()

        if (response.waiting) {
          // Not an error: the host decides. Show the waiting screen.
          setUsedPasscode(used)
          writeGuestMemory(name.trim(), email.trim())
          setWaiting(true)
          return
        }

        if (
          !response.auth_token
        ) {
          throw new Error(
            'ROOM 7 did not return a meeting session.',
          )
        }

        setUsedPasscode(used)
        writeGuestMemory(name.trim(), email.trim())
        setAuthToken(
          response.auth_token,
        )
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : 'Unable to join ROOM 7.'

        if (INCORRECT_PASSCODE.test(message)) {
          // The event code alone was not enough: this host added a passcode.
          setShowPasscode(true)
          setError(
            passcode.trim()
              ? message
              : 'This event also needs a passcode. Enter the one from your invitation.',
          )
        } else {
          setError(message)
        }
      } finally {
        setJoining(false)
      }
    }

  if (
    authToken &&
    room
  ) {
    return (
      <Suspense
        fallback={
          <div className="room7PublicMeetingLoading">
            <div className="room7PublicSpinner" />
            <strong>Preparing ROOM 7</strong>
            <span>
              Connecting your secure meeting session.
            </span>
          </div>
        }
      >
        <ExternalRoom7Meeting
          authToken={authToken}
          title={room.title}
          locator={locator}
          accessMode={room.access_mode}
          inviteToken={inviteToken}
          passcode={
            room.requires_passcode
              ? usedPasscode || passcode
              : ''
          }
          email={email.trim()}
          displayName={name.trim()}
          eventState={room.event_state}
          scheduledEnd={room.scheduled_end}
          onRejoin={rejoin}
          rejoined={rejoinCount > 0}
        />
      </Suspense>
    )
  }

  return (
    <main className="room7Public responsiveModule" data-theme={appearance.theme}>
      <div className="room7PublicGlow room7PublicGlowOne" />
      <div className="room7PublicGlow room7PublicGlowTwo" />

      <Room7TopIsland pref={appearance.pref} theme={appearance.theme} onCycleTheme={appearance.cycle} />

      {loading && (
        <section className="room7PublicLoading">
          <div className="room7PublicSpinner" />
          <strong>Opening ROOM 7</strong>
          <span>
            Preparing your event experience.
          </span>
        </section>
      )}

      {!loading && !locator && (
        <section className="room7Landing">
          <div className="room7LandingHero">
            <span className="room7PublicEyebrow">
              RIDEARRIVO ROOM 7
            </span>

            <h1>
              Your event,<br />one tap away.
            </h1>

            <p>
              Join live meetings and events from any phone or laptop.
              No app to download and no account to create.
            </p>

            <form
              className="room7LandingForm"
              onSubmit={event => void openEntry(event)}
            >
              <label htmlFor="room7-entry-code">
                Event code or invitation link
              </label>

              <div className="room7LandingField">
                <input
                  id="room7-entry-code"
                  value={entryValue}
                  onChange={event => setEntryValue(event.target.value)}
                  placeholder="e.g. 4YXZTE4K"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="go"
                />

                <button
                  type="submit"
                  disabled={entryBusy || !entryValue.trim()}
                >
                  {entryBusy ? 'Checking...' : 'Join'}
                </button>
              </div>

              {entryError && (
                <p className="room7PublicEntryError" role="alert">
                  {entryError}
                </p>
              )}
            </form>

            <a
              className="room7PublicEntryStaff"
              href="https://intranet.ridearrivo.com/?section=room"
            >
              RideArrivo staff? Open ROOM 7 in the workspace
            </a>
          </div>

          <ol className="room7LandingSteps" aria-label="How it works">
            <li>
              <b>1</b>
              <span>
                <strong>Enter your code</strong>
                It is in your invitation email or message.
              </span>
            </li>
            <li>
              <b>2</b>
              <span>
                <strong>Add your name</strong>
                Check your camera and microphone before you go in.
              </span>
            </li>
            <li>
              <b>3</b>
              <span>
                <strong>Join the room</strong>
                Chat, ask questions and view shared documents.
              </span>
            </li>
          </ol>
        </section>
      )}

      {!loading && locator && error && !room && (
        <section className="room7PublicErrorCard">
          <span className="room7PublicEyebrow">
            RIDEARRIVO ROOM 7
          </span>
          <h1>
            This event is not available
          </h1>
          <p>{error}</p>
        </section>
      )}

      {!loading && room && (
        <>
          <Room7PublicExperienceNavigation
              eventState={room.event_state}
            />

            <section
              id="room7-live"
              className="room7PublicHero"
            >
            <div className="room7PublicHeroCopy">
              <div className="room7PublicMetaLine">
                <span
                  className={
                    `room7PublicState room7PublicState-${room.event_state}`
                  }
                >
                  {stateLabels[room.event_state]}
                </span>

                <span>
                  {room.room_kind
                    .replace(/_/g, ' ')}
                </span>
              </div>

              <span className="room7PublicEyebrow">
                RIDEARRIVO · ROOM 7
              </span>

              <h1>
                {room.title}
              </h1>

              <p className="room7PublicSummary">
                {room.public_summary ||
                  'A professionally hosted RideArrivo event experience for invited guests, partners and stakeholders.'}
              </p>

              <div className="room7PublicSchedule">
                <span>
                  Event schedule
                </span>
                <strong>
                  {formatEventDate(
                    room.scheduled_start,
                    room.timezone,
                  )}
                </strong>
              </div>

              {room.join_available &&
                !waiting &&
                !authToken && (
                  <a
                    className="room7PublicJumpJoin"
                    href="#room7-guest-access"
                  >
                    Enter ROOM 7
                  </a>
                )}

              {room.event_state === 'pre_event' && (
                <Room7Countdown target={room.scheduled_start} />
              )}

              {room.scheduled_start &&
                !room.past_scheduled_end &&
                ['draft', 'pre_event', 'doors_open'].includes(room.event_state) && (
                  <Room7AddToCalendar room={room} />
                )}
            </div>

            <aside id="room7-guest-access" className="room7PublicJoinCard responsiveFormSurface">
              <div>
                <span className="room7PublicEyebrow">
                  GUEST ACCESS
                </span>

                <h2>
                  {waiting
                    ? 'You are in the queue'
                    : room.join_available
                      ? 'Enter ROOM 7'
                      : 'Event lobby'}
                </h2>

                <p>
                  {waiting
                    ? 'The host has been told you are here.'
                    : room.join_available
                    ? 'Type your name and email, then enter. No account needed.'
                    : room.past_scheduled_end
                      ? 'The scheduled time for this event has ended.'
                    : room.event_state === 'pre_event' || room.event_state === 'draft'
                      ? 'You are early. Keep this page open: you will be let in as soon as the host opens the room.'
                      : room.event_state === 'ended'
                        ? 'This live event has ended.'
                        : room.event_state === 'replay'
                          ? 'Replay access is being prepared.'
                          : 'ROOM 7 is not accepting guest joins right now.'}
                </p>
              </div>

              <Room7GuestDocuments
                context="lobby"
                locator={locator}
                accessMode={room.access_mode}
                inviteToken={inviteToken}
                passcode={
                  room.requires_passcode
                    ? passcode || locator?.room_code || ''
                    : ''
                }
                email={email}
                onEmailChange={setEmail}
                onPasscodeChange={
                  room.requires_passcode
                    ? setPasscode
                    : undefined
                }
                eventState={room.event_state}
                title={room.title}
              />

              {room.access_mode ===
                'invitation' &&
                !inviteToken && (
                  <div className="room7PublicNotice">
                    This event requires a valid RideArrivo invitation link.
                  </div>
                )}

              {waiting && (
                <div
                  className="room7PublicWaiting"
                  role="status"
                  aria-live="polite"
                >
                  <div className="room7PublicSpinner" />
                  <strong>
                    Waiting for the host to let you in
                  </strong>
                  <span>
                    {name.trim()
                      ? `${name.trim()}, keep this page open. `
                      : 'Keep this page open. '}
                    You will enter automatically as soon as you are admitted.
                  </span>
                  <button
                    type="button"
                    className="room7PublicLinkButton"
                    onClick={() => setWaiting(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {waiting && locator && (
                <Room7LobbyChat
                  transport={lobbyTransport}
                />
              )}

              {room.join_available &&
                !waiting &&
                !(
                  room.access_mode ===
                    'invitation' &&
                  !inviteToken
                ) && (
                  <form
                    className="room7PublicForm"
                    onSubmit={submitJoin}
                  >
                    <label>
                      <span>Your name</span>
                      <input
                        value={name}
                        onChange={event =>
                          setName(
                            event.target.value,
                          )
                        }
                        minLength={2}
                        maxLength={180}
                        autoComplete="name"
                        required
                      />
                    </label>

                    <label>
                      <span>Email address</span>
                      <input
                        type="email"
                        value={email}
                        onChange={event =>
                          setEmail(
                            event.target.value,
                          )
                        }
                        maxLength={320}
                        autoComplete="email"
                        required
                      />
                    </label>

                    {room.requires_passcode &&
                      !(showPasscode || passcode || !locator?.room_code) && (
                        <button
                          type="button"
                          className="room7PublicLinkButton"
                          onClick={() => setShowPasscode(true)}
                        >
                          Have a separate passcode?
                        </button>
                      )}

                    {room.requires_passcode &&
                      (showPasscode || passcode || !locator?.room_code) && (
                      <label>
                        <span>
                          Event passcode
                        </span>
                        <input
                          type="text"
                          value={passcode}
                          onChange={event =>
                            setPasscode(
                              event.target.value,
                            )
                          }
                          minLength={6}
                          maxLength={128}
                          autoComplete="off"
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder="From your invitation"
                          required={!locator?.room_code}
                        />
                      </label>
                    )}

                    <label className="room7PublicConsent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={event =>
                          setConsent(
                            event.target.checked,
                          )
                        }
                        required
                      />
                      <span>
                        I understand that ROOM 7 records attendance and that audio, video or meeting content may be recorded when enabled by the event host.
                      </span>
                    </label>

                    {error && (
                      <div
                        className="room7PublicFormError"
                        role="alert"
                      >
                        {error}
                      </div>
                    )}

                    <button
                      className="room7PublicJoinButton"
                      type="submit"
                      disabled={joining}
                    >
                      {joining
                        ? 'Preparing your session...'
                        : 'Enter ROOM 7'}
                    </button>
                  </form>
                )}

              <div className="room7PublicTrust">
                <span>
                  Guest identity is validated by the RideArrivo event service.
                </span>
                <span>
                  Your meeting access token is temporary.
                </span>
              </div>
            </aside>
          </section>

          {locator && (
            <Room7PublicExperienceSections
                title={room.title}
                roomKind={room.room_kind}
                eventState={room.event_state}
                summary={room.public_summary}
                scheduledStart={room.scheduled_start}
                scheduledEnd={room.scheduled_end}
                joinAvailable={room.join_available}
                locator={locator}
                accessMode={room.access_mode}
                inviteToken={inviteToken}
                passcode={
                  room.requires_passcode
                    ? passcode || locator?.room_code || ''
                    : ''
                }
                email={email}
                onEmailChange={setEmail}
              />
          )}

          <Room7Install />

          <footer className="room7PublicFooter">
            <span>
              RideArrivo Limited
            </span>
            <span>
              ROOM 7 · Secure external event access
            </span>
          </footer>
        </>
      )}
    </main>
  )
}

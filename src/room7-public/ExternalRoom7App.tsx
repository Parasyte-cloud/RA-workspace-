import {
  FormEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react'
import Room7GuestDocuments from './Room7GuestDocuments'
import Room7PublicExperienceSections, {
  Room7PublicExperienceNavigation,
} from './Room7PublicExperienceSections'
import './room7-public.css'

const ExternalRoom7Meeting = lazy(
  () => import('./ExternalRoom7Meeting'),
)

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
  requires_invitation: boolean
  requires_passcode: boolean
  requires_email: boolean
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

export default function ExternalRoom7App() {
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

  const [name, setName] =
    useState('')

  const [email, setEmail] =
    useState('')

  const [passcode, setPasscode] =
    useState('')

  const [consent, setConsent] =
    useState(false)

  useEffect(() => {
    document.title =
      room?.title
        ? `${room.title} | ROOM 7`
        : 'RideArrivo ROOM 7'
  }, [room?.title])

  useEffect(() => {
    if (!locator) {
      setError(
        'This ROOM 7 link is incomplete.',
      )
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

  const countdown =
    useCountdown(
      room?.scheduled_start ||
      null,
    )

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
        const response =
          await room7Request<JoinResponse>({
            action: 'join',
            ...locator,
            display_name:
              name.trim(),
            email:
              email.trim(),
            passcode:
              room.requires_passcode
                ? passcode
                : undefined,
            invite_token:
              room.requires_invitation
                ? inviteToken
                : undefined,
          })

        if (
          !response.auth_token
        ) {
          throw new Error(
            'ROOM 7 did not return a meeting session.',
          )
        }

        setAuthToken(
          response.auth_token,
        )
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to join ROOM 7.',
        )
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
              ? passcode
              : ''
          }
          email={email.trim()}
          eventState={room.event_state}
        />
      </Suspense>
    )
  }

  return (
    <main className="room7Public">
      <div className="room7PublicGlow room7PublicGlowOne" />
      <div className="room7PublicGlow room7PublicGlowTwo" />

      <header className="room7PublicHeader">
        <img
          className="room7PublicLogo"
          src="/ridearrivo-wordmark-workspace.png"
          alt="RideArrivo"
        />

        <div className="room7PublicHeaderRight">
          <span className="room7PublicSecure">
            Secure guest access
          </span>
          <span className="room7PublicRoomMark">
            ROOM 7
          </span>
        </div>
      </header>

      {loading && (
        <section className="room7PublicLoading">
          <div className="room7PublicSpinner" />
          <strong>Opening ROOM 7</strong>
          <span>
            Preparing your event experience.
          </span>
        </section>
      )}

      {!loading && error && !room && (
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

              {countdown &&
                room.event_state ===
                  'pre_event' && (
                  <div className="room7PublicCountdown">
                    <div>
                      <strong>{countdown.days}</strong>
                      <span>Days</span>
                    </div>
                    <div>
                      <strong>
                        {String(
                          countdown.hours,
                        ).padStart(2, '0')}
                      </strong>
                      <span>Hours</span>
                    </div>
                    <div>
                      <strong>
                        {String(
                          countdown.minutes,
                        ).padStart(2, '0')}
                      </strong>
                      <span>Minutes</span>
                    </div>
                    <div>
                      <strong>
                        {String(
                          countdown.seconds,
                        ).padStart(2, '0')}
                      </strong>
                      <span>Seconds</span>
                    </div>
                  </div>
                )}
            </div>

            <aside id="room7-guest-access" className="room7PublicJoinCard">
              <div>
                <span className="room7PublicEyebrow">
                  GUEST ACCESS
                </span>

                <h2>
                  {room.join_available
                    ? 'Enter ROOM 7'
                    : 'Event lobby'}
                </h2>

                <p>
                  {room.join_available
                    ? 'Confirm your details before entering the live room.'
                    : room.event_state === 'pre_event'
                      ? 'Your event link is active. The host will open the room when it is time to join.'
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
                    ? passcode
                    : ''
                }
                email={email}
                onEmailChange={setEmail}
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

              {room.join_available &&
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

                    {room.requires_passcode && (
                      <label>
                        <span>
                          Event passcode
                        </span>
                        <input
                          type="password"
                          value={passcode}
                          onChange={event =>
                            setPasscode(
                              event.target.value,
                            )
                          }
                          minLength={6}
                          maxLength={128}
                          autoComplete="off"
                          required
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
                    ? passcode
                    : ''
                }
                email={email}
                onEmailChange={setEmail}
              />
          )}

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

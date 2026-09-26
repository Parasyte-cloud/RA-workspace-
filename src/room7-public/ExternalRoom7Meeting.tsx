import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Settings2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import {
  useRealtimeKitClient,
} from '@cloudflare/realtimekit-react'
import {
  RtkMeeting,
  provideRtkDesignSystem,
} from '@cloudflare/realtimekit-react-ui'
import Room7GuestDocuments, {
  type Room7GuestAccessMode,
  type Room7GuestEventState,
  type Room7GuestLocator,
} from './Room7GuestDocuments'
import Room7GuestMeetingQna from './Room7GuestMeetingQna'
import {
  Room7ExtrasControls,
  Room7ExtrasOverlay,
  useRoom7MeetingExtras,
} from '../room7-shared/useRoom7MeetingExtras'

const MAX_REJOIN_ATTEMPTS = 6

type Appearance =
  | 'system'
  | 'light'
  | 'dark'

type Ambience =
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'auto'

type AmbientLevel =
  | 'off'
  | 'low'
  | 'medium'
  | 'high'

type ConnectionState =
  | 'online'
  | 'reconnecting'
  | 'offline'

type AmbientSensorLike =
  EventTarget & {
    illuminance:
      number | null
    start: () => void
    stop: () => void
  }

type AmbientSensorConstructor =
  new (
    options?: {
      frequency?:
        number
    },
  ) =>
    AmbientSensorLike

type Props = {
  authToken: string
  title: string
  locator:
    Room7GuestLocator | null
  accessMode:
    Room7GuestAccessMode
  inviteToken: string
  passcode: string
  email: string
  eventState:
    Room7GuestEventState
  scheduledEnd: string | null
  // Re-runs the guest join for a fresh token after a dropped connection.
  onRejoin: () => Promise<boolean>
  // True after a rejoin: skip the setup screen and restore media state.
  rejoined: boolean
}

const APPEARANCE_KEY =
  'ridearrivo:room7:appearance'

const AMBIENCE_KEY =
  'ridearrivo:room7:ambience'

function storedAppearance():
  Appearance {
  try {
    const value =
      localStorage.getItem(
        APPEARANCE_KEY,
      )

    if (
      value === 'system' ||
      value === 'light' ||
      value === 'dark'
    ) {
      return value
    }
  } catch {
    // Storage is optional.
  }

  return 'system'
}

function storedAmbience():
  Ambience {
  try {
    const value =
      localStorage.getItem(
        AMBIENCE_KEY,
      )

    if (
      value === 'off' ||
      value === 'low' ||
      value === 'medium' ||
      value === 'high' ||
      value === 'auto'
    ) {
      return value
    }
  } catch {
    // Storage is optional.
  }

  return 'auto'
}

export default function ExternalRoom7Meeting({
  authToken,
  title,
  locator,
  accessMode,
  inviteToken,
  passcode,
  email,
  eventState,
  scheduledEnd,
  onRejoin,
  rejoined,
}: Props) {
  const [
    meeting,
    initMeeting,
  ] =
    useRealtimeKitClient()

  const shellRef =
    useRef<HTMLDivElement>(
      null,
    )

  const [
    error,
    setError,
  ] =
    useState('')

  const [
    settingsOpen,
    setSettingsOpen,
  ] =
    useState(false)

  const [
    appearance,
    setAppearance,
  ] =
    useState<Appearance>(
      storedAppearance,
    )

  const [
    ambience,
    setAmbience,
  ] =
    useState<Ambience>(
      storedAmbience,
    )

  const [
    systemDark,
    setSystemDark,
  ] =
    useState(
      () =>
        typeof window !==
          'undefined'
          ? window
              .matchMedia(
                '(prefers-color-scheme: dark)',
              )
              .matches
          : true,
    )

  const [
    automaticAmbience,
    setAutomaticAmbience,
  ] =
    useState<AmbientLevel>(
      systemDark
        ? 'medium'
        : 'low',
    )

  const [
    automaticSource,
    setAutomaticSource,
  ] =
    useState(
      'System appearance fallback',
    )

  const [
    documentsOpen,
    setDocumentsOpen,
  ] =
    useState(false)

  const [
    documentsMaximized,
    setDocumentsMaximized,
  ] =
    useState(false)

  const [
    connectionState,
    setConnectionState,
  ] =
    useState<ConnectionState>(
      () =>
        typeof navigator ===
          'undefined' ||
        navigator.onLine
          ? 'online'
          : 'offline',
    )

  const effectiveTheme =
    appearance === 'system'
      ? (
          systemDark
            ? 'dark'
            : 'light'
        )
      : appearance

  const effectiveAmbience =
    useMemo<
      AmbientLevel
    >(
      () =>
        ambience === 'auto'
          ? automaticAmbience
          : ambience,
      [
        ambience,
        automaticAmbience,
      ],
    )

  const mediaStateRef =
    useRef({
      audio: false,
      video: false,
    })

  const onRejoinRef =
    useRef(onRejoin)
  onRejoinRef.current = onRejoin

  const rejoinInFlightRef =
    useRef(false)

  const [
    connectionLost,
    setConnectionLost,
  ] =
    useState(false)

  const [
    endedBySchedule,
    setEndedBySchedule,
  ] =
    useState(false)

  const reconnect =
    useCallback(async () => {
      if (rejoinInFlightRef.current) {
        return
      }

      rejoinInFlightRef.current = true
      setConnectionLost(false)

      for (
        let attempt = 1;
        attempt <= MAX_REJOIN_ATTEMPTS;
        attempt++
      ) {
        if (!navigator.onLine) {
          await new Promise<void>(resolve => {
            const done = () => {
              window.removeEventListener('online', done)
              resolve()
            }
            window.addEventListener('online', done)
            window.setTimeout(done, 15000)
          })
        }

        try {
          // The server removes the dead connection before issuing a new
          // token, so a rejoin never shows this guest twice.
          if (await onRejoinRef.current()) {
            // Cleared by roomJoined on the new meeting; if that never
            // arrives, offer a manual reconnect instead of waiting forever.
            window.setTimeout(() => {
              if (rejoinInFlightRef.current) {
                rejoinInFlightRef.current = false
                setConnectionLost(true)
              }
            }, 25000)
            return
          }
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : ''

          if (/scheduled end|not open|ended/i.test(message)) {
            break
          }
        }

        await new Promise(resolve =>
          window.setTimeout(resolve, Math.min(2000 * attempt, 10000)),
        )
      }

      rejoinInFlightRef.current = false
      setConnectionLost(true)
    }, [])

  // A dropped connection is recovered in place instead of leaving the
  // guest on RealtimeKit's "you left" screen.
  useEffect(() => {
    if (!meeting) {
      return
    }

    const self = meeting.self

    const handleJoined = () => {
      rejoinInFlightRef.current = false
      setConnectionLost(false)
    }

    const handleLeft = ({ state }: { state: string }) => {
      mediaStateRef.current = {
        audio: Boolean(self.audioEnabled),
        video: Boolean(self.videoEnabled),
      }

      if (state === 'disconnected' || state === 'failed') {
        void reconnect()
      }
    }

    self.on('roomJoined', handleJoined as never)
    self.on('roomLeft', handleLeft as never)

    return () => {
      self.removeListener('roomJoined', handleJoined as never)
      self.removeListener('roomLeft', handleLeft as never)
    }
  }, [
    meeting,
    reconnect,
  ])

  const scheduleLeave =
    useCallback(() => {
      setEndedBySchedule(true)
      void meeting?.leave().catch(() => {})
    }, [meeting])

  const extras =
    useRoom7MeetingExtras({
      meeting,
      role: 'guest',
      scheduledEnd,
      onScheduleLeave: scheduleLeave,
    })

  useEffect(() => {
    let cancelled = false

    const initialise =
      async () => {
        setError('')

        try {
          /*
           * External ROOM 7 guests fail safe.
           * Presenter/host capability comes from
           * the server-selected RealtimeKit preset,
           * never from browser defaults.
           */
          await initMeeting({
            authToken,

            defaults: rejoined
              ? mediaStateRef.current
              : {
                  audio: false,
                  video: false,
                },
          })
        } catch (cause) {
          if (cancelled) {
            return
          }

          console.error(
            'External ROOM 7 media initialisation failed:',
            cause,
          )

          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to initialise the ROOM 7 meeting.',
          )
        }
      }

    void initialise()

    return () => {
      cancelled = true
    }
  }, [
    authToken,
    initMeeting,
  ])

  useEffect(() => {
    const mediaQuery =
      window.matchMedia(
        '(prefers-color-scheme: dark)',
      )

    const update =
      () =>
        setSystemDark(
          mediaQuery.matches,
        )

    update()

    mediaQuery.addEventListener(
      'change',
      update,
    )

    return () => {
      mediaQuery.removeEventListener(
        'change',
        update,
      )
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        APPEARANCE_KEY,
        appearance,
      )
    } catch {
      // Preference persistence is optional.
    }
  }, [
    appearance,
  ])

  useEffect(() => {
    try {
      localStorage.setItem(
        AMBIENCE_KEY,
        ambience,
      )
    } catch {
      // Preference persistence is optional.
    }
  }, [
    ambience,
  ])

  useEffect(() => {
    if (
      ambience !==
      'auto'
    ) {
      return
    }

    const fallback =
      () => {
        setAutomaticAmbience(
          systemDark
            ? 'medium'
            : 'low',
        )

        setAutomaticSource(
          'System appearance fallback',
        )
      }

    const Sensor =
      (
        window as
          Window & {
            AmbientLightSensor?:
              AmbientSensorConstructor
          }
      ).AmbientLightSensor

    if (!Sensor) {
      fallback()
      return
    }

    let sensor:
      AmbientSensorLike |
      null = null

    try {
      sensor =
        new Sensor({
          frequency: 1,
        })

      const onReading =
        () => {
          const lux =
            Number(
              sensor
                ?.illuminance,
            )

          if (
            !Number.isFinite(
              lux,
            )
          ) {
            fallback()
            return
          }

          if (lux < 20) {
            setAutomaticAmbience(
              'high',
            )
          } else if (
            lux < 80
          ) {
            setAutomaticAmbience(
              'medium',
            )
          } else {
            setAutomaticAmbience(
              'low',
            )
          }

          setAutomaticSource(
            'Ambient light sensor',
          )
        }

      const onError =
        () => {
          fallback()
        }

      sensor.addEventListener(
        'reading',
        onReading,
      )

      sensor.addEventListener(
        'error',
        onError,
      )

      sensor.start()

      return () => {
        sensor?.removeEventListener(
          'reading',
          onReading,
        )

        sensor?.removeEventListener(
          'error',
          onError,
        )

        sensor?.stop()
      }
    } catch {
      fallback()
    }
  }, [
    ambience,
    systemDark,
  ])

  useEffect(() => {
    const online =
      () =>
        setConnectionState(
          'online',
        )

    const offline =
      () =>
        setConnectionState(
          'offline',
        )

    window.addEventListener(
      'online',
      online,
    )

    window.addEventListener(
      'offline',
      offline,
    )

    return () => {
      window.removeEventListener(
        'online',
        online,
      )

      window.removeEventListener(
        'offline',
        offline,
      )
    }
  }, [])

  useEffect(() => {
    if (!meeting) {
      return
    }

    const candidate =
      meeting as unknown as {
        meta?: {
          on?: (
            event:
              string,
            listener:
              (
                payload:
                  unknown,
              ) => void,
          ) => void

          off?: (
            event:
              string,
            listener:
              (
                payload:
                  unknown,
              ) => void,
          ) => void
        }
      }

    const meta =
      candidate.meta

    if (!meta?.on) {
      return
    }

    const onMediaConnection =
      (
        payload:
          unknown,
      ) => {
        if (
          !payload ||
          typeof payload !==
            'object' ||
          !(
            'state' in payload
          )
        ) {
          return
        }

        const state =
          String(
            (
              payload as {
                state:
                  unknown
              }
            ).state,
          )

        if (
          state ===
            'connected'
        ) {
          setConnectionState(
            'online',
          )
        } else if (
          state ===
            'reconnecting' ||
          state ===
            'connecting' ||
          state ===
            'disconnected'
        ) {
          setConnectionState(
            'reconnecting',
          )
        } else if (
          state ===
            'failed'
        ) {
          setConnectionState(
            'offline',
          )
        }
      }

    meta.on(
      'mediaConnectionUpdate',
      onMediaConnection,
    )

    return () => {
      meta.off?.(
        'mediaConnectionUpdate',
        onMediaConnection,
      )
    }
  }, [
    meeting,
  ])

  useEffect(() => {
    if (
      !meeting ||
      !shellRef.current
    ) {
      return
    }

    provideRtkDesignSystem(
      shellRef.current,
      {
        theme:
          effectiveTheme ===
            'light'
            ? 'light'
            : 'darkest',

        colors: {
          danger:
            '#ef4444',

          brand: {
            300:
              '#ffd18a',
            400:
              '#fbb54b',
            500:
              '#f6a11a',
            600:
              '#df8610',
            700:
              '#a85f08',
          },

          text:
            effectiveTheme ===
              'light'
              ? '#111827'
              : '#f5f7fa',

          'text-on-brand':
            '#160e03',

          'video-bg':
            effectiveTheme ===
              'light'
              ? '#e8edf3'
              : '#050a12',
        },

        borderRadius:
          'extra-rounded',
      },
    )
  }, [
    effectiveTheme,
    meeting,
  ])

  useEffect(() => {
    if (!settingsOpen) {
      return
    }

    const onKeyDown =
      (
        event:
          KeyboardEvent,
      ) => {
        if (
          event.key ===
          'Escape'
        ) {
          setSettingsOpen(
            false,
          )
        }
      }

    window.addEventListener(
      'keydown',
      onKeyDown,
    )

    return () => {
      window.removeEventListener(
        'keydown',
        onKeyDown,
      )
    }
  }, [
    settingsOpen,
  ])

  const onDocumentPanelState =
    useCallback(
      (
        state: {
          open: boolean
          maximized:
            boolean
        },
      ) => {
        setDocumentsOpen(
          state.open,
        )

        setDocumentsMaximized(
          state.maximized,
        )
      },
      [],
    )

  if (error) {
    return (
      <div className="room7PublicMeetingError">
        <img
          src="/ridearrivo-wordmark-workspace.png"
          alt="RideArrivo"
        />

        <h2>
          ROOM 7 could not start
        </h2>

        <p>{error}</p>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="room7PublicMeetingLoading">
        <div className="room7PublicSpinner" />

        <strong>
          Preparing ROOM 7
        </strong>

        <span>
          {title}
        </span>
      </div>
    )
  }

  const shellClass =
    [
      'room7ExperienceShell',
      `room7ExperienceAmbience-${effectiveAmbience}`,

      documentsOpen
        ? 'room7ExperienceDocumentsOpen'
        : '',

      documentsMaximized
        ? 'room7ExperienceDocumentsMaximized'
        : '',
    ]
      .filter(Boolean)
      .join(' ')

  return (
    <div
      ref={shellRef}
      className={
        shellClass
      }
      data-room7-theme={
        effectiveTheme
      }
    >
      <header className="room7ExperienceChrome">
        <div className="room7ExperienceIdentity">
          <img
            src="/ridearrivo-wordmark-workspace.png"
            alt="RideArrivo"
          />

          <div>
            <span>
              ROOM 7
            </span>

            <strong>
              {title}
            </strong>
          </div>
        </div>

        <div className="room7ExperienceControls">
          <span
            className={
              `room7ExperienceConnection ${connectionState}`
            }
            role="status"
          >
            {connectionState ===
              'offline' ? (
              <WifiOff
                size={14}
              />
            ) : (
              <Wifi
                size={14}
              />
            )}

            {connectionState ===
              'online'
              ? 'Network online'
              : connectionState ===
                  'reconnecting'
                ? 'Reconnecting'
                : 'Offline'}
          </span>

          <Room7GuestDocuments
            context="meeting"
            locator={
              locator
            }
            accessMode={
              accessMode
            }
            inviteToken={
              inviteToken
            }
            passcode={
              passcode
            }
            email={email}
            eventState={
              eventState
            }
            title={title}
            onPanelStateChange={
              onDocumentPanelState
            }
          />

          {locator && (
            <Room7GuestMeetingQna
              locator={
                locator
              }
              accessMode={
                accessMode
              }
              inviteToken={
                inviteToken
              }
              passcode={
                passcode
              }
              email={
                email
              }
              eventState={
                eventState
              }
              title={
                title
              }
            />
          )}

          <Room7ExtrasControls
            extras={extras}
            compact
          />

          <button
            type="button"
            className="room7ExperienceSettingsButton"
            aria-haspopup="dialog"
            aria-expanded={
              settingsOpen
            }
            onClick={() =>
              setSettingsOpen(
                value =>
                  !value,
              )
            }
          >
            <Settings2
              size={16}
            />

            Settings
          </button>
        </div>
      </header>

      <main className="room7ExperienceStage">
        <div className="room7ExperienceMeetingFrame">
          <RtkMeeting
            key={authToken}
            meeting={meeting}
            // "fill" keeps the call inside ROOM 7's frame. Without it,
            // RealtimeKit goes position:fixed full screen on phones and
            // covers ROOM 7's top bar (Documents, Q&A, hand, reactions).
            mode="fill"
            showSetupScreen={!rejoined}
            applyDesignSystem={false}
          />

          <Room7ExtrasOverlay
            extras={extras}
          />

          {connectionLost && (
            <div className="room7ExperienceLost" role="alert">
              <WifiOff size={18} />
              <span>Your connection to ROOM 7 was lost.</span>
              <button type="button" onClick={() => void reconnect()}>
                Reconnect
              </button>
            </div>
          )}

          {endedBySchedule && (
            <div className="room7ExperienceLost" role="status">
              <span>The scheduled time for this event has ended. Thank you for joining.</span>
            </div>
          )}
        </div>
      </main>

      {settingsOpen && (
        <aside
          className="room7ExperienceSettings"
          role="dialog"
          aria-label="ROOM 7 appearance settings"
        >
          <header>
            <div>
              <span>
                ROOM 7 SETTINGS
              </span>

              <strong>
                Experience
              </strong>
            </div>

            <button
              type="button"
              onClick={() =>
                setSettingsOpen(
                  false,
                )
              }
              aria-label="Close ROOM 7 settings"
            >
              <X size={17} />
            </button>
          </header>

          <section>
            <span className="room7ExperienceSettingLabel">
              Appearance
            </span>

            <div
              className="room7ExperienceSegments"
              role="group"
              aria-label="Appearance"
            >
              {(
                [
                  'system',
                  'light',
                  'dark',
                ] as
                  Appearance[]
              ).map(
                option => (
                  <button
                    key={
                      option
                    }
                    type="button"
                    aria-pressed={
                      appearance ===
                      option
                    }
                    className={
                      appearance ===
                      option
                        ? 'active'
                        : ''
                    }
                    onClick={() =>
                      setAppearance(
                        option,
                      )
                    }
                  >
                    {
                      option
                        .charAt(0)
                        .toUpperCase() +
                      option.slice(1)
                    }
                  </button>
                ),
              )}
            </div>
          </section>

          <section>
            <span className="room7ExperienceSettingLabel">
              Ambient edge light
            </span>

            <div
              className="room7ExperienceSegments room7ExperienceAmbienceSegments"
              role="group"
              aria-label="Ambient edge lighting"
            >
              {(
                [
                  'off',
                  'low',
                  'medium',
                  'high',
                  'auto',
                ] as
                  Ambience[]
              ).map(
                option => (
                  <button
                    key={
                      option
                    }
                    type="button"
                    aria-pressed={
                      ambience ===
                      option
                    }
                    className={
                      ambience ===
                      option
                        ? 'active'
                        : ''
                    }
                    onClick={() =>
                      setAmbience(
                        option,
                      )
                    }
                  >
                    {
                      option
                        .charAt(0)
                        .toUpperCase() +
                      option.slice(1)
                    }
                  </button>
                ),
              )}
            </div>

            <small>
              {ambience ===
                'auto'
                ? `Auto: ${automaticSource}. Current level: ${automaticAmbience}.`
                : `Ambient level: ${ambience}.`}
            </small>
          </section>

          <footer>
            Auto uses the device ambient-light sensor when the browser exposes it.
            Otherwise ROOM 7 follows the system appearance safely. Camera access is
            never used for ambient-light detection.
          </footer>
        </aside>
      )}
    </div>
  )
}

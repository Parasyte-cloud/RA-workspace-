import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  CalendarClock,
  Copy,
  FileText,
  Globe2,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import RoomEventDocumentsManager from './RoomEventDocumentsManager'
import Room7EventEngagementManager from './Room7EventEngagementManager'
import '../room7-event-control.css'

type EventKind =
  | 'standard'
  | 'executive'
  | 'investor'
  | 'webinar'
  | 'launch'
  | 'town_hall'

type AccessMode =
  | 'invitation'
  | 'passcode'
  | 'open'

type DefaultGuestRole =
  | 'attendee'
  | 'viewer'

type InvitationRole =
  | DefaultGuestRole
  | 'presenter'

type EventState =
  | 'draft'
  | 'pre_event'
  | 'doors_open'
  | 'live'
  | 'intermission'
  | 'ended'
  | 'replay'

type Tab =
  | 'overview'
  | 'configuration'
  | 'state'
  | 'invitations'
  | 'engagement'
  | 'documents'

type EventRecord = {
  slug: string | null
  room_kind: EventKind
  access_mode: AccessMode
  event_state: EventState
  default_guest_role: DefaultGuestRole
  public_enabled: boolean
  public_summary: string | null
  timezone: string
  scheduled_start: string | null
  scheduled_end: string | null
  has_passcode: boolean
  created_at: string
  updated_at: string
}

type RoomRecord = {
  id: string
  room_code: string
  title: string
  status: string
  started_at: string | null
  ended_at: string | null
}

type Permissions = {
  is_room_creator: boolean
  can_configure: boolean
  can_force_state: boolean
}

type ControlResponse = {
  room: RoomRecord
  event: EventRecord | null
  public_url: string
  permissions: Permissions
}

type Invitation = {
  id: string
  email: string | null
  display_name: string | null
  role: InvitationRole
  status: string
  expires_at: string | null
  first_used_at: string | null
  last_used_at: string | null
  use_count: number
  created_at: string
  updated_at: string
}

type InvitationListResponse =
  ControlResponse & {
    invitations: Invitation[]
  }

type CreateInvitationResponse =
  ControlResponse & {
    invitation: Invitation
    invitation_url: string
    invite_token?: string
  }

type ConfigForm = {
  roomKind: EventKind
  accessMode: AccessMode
  defaultGuestRole: DefaultGuestRole
  slug: string
  publicEnabled: boolean
  publicSummary: string
  timezone: string
  scheduledStart: string
  scheduledEnd: string
  passcode: string
}

type InviteForm = {
  displayName: string
  email: string
  role: InvitationRole
  expiresAt: string
}

type Props = {
  roomId: string
  roomTitle: string
}

const eventKinds: Array<{
  value: EventKind
  label: string
}> = [
  {
    value: 'standard',
    label: 'Standard',
  },
  {
    value: 'executive',
    label: 'Executive',
  },
  {
    value: 'investor',
    label: 'Investor',
  },
  {
    value: 'webinar',
    label: 'Webinar',
  },
  {
    value: 'launch',
    label: 'Launch Event',
  },
  {
    value: 'town_hall',
    label: 'Town Hall',
  },
]

const accessModes: Array<{
  value: AccessMode
  label: string
}> = [
  {
    value: 'invitation',
    label: 'Invitation',
  },
  {
    value: 'passcode',
    label: 'Passcode',
  },
  {
    value: 'open',
    label: 'Open',
  },
]

const eventStates: EventState[] = [
  'draft',
  'pre_event',
  'doors_open',
  'live',
  'intermission',
  'ended',
  'replay',
]

const normalTransitions:
  Record<EventState, EventState[]> = {
    draft: [
      'pre_event',
    ],
    pre_event: [
      'doors_open',
    ],
    doors_open: [
      'pre_event',
      'live',
    ],
    live: [
      'intermission',
      'ended',
    ],
    intermission: [
      'live',
      'ended',
    ],
    ended: [
      'replay',
    ],
    replay: [
      'ended',
    ],
  }

const tabs: Array<{
  value: Tab
  label: string
}> = [
  {
    value: 'overview',
    label: 'Overview',
  },
  {
    value: 'configuration',
    label: 'Configure',
  },
  {
    value: 'state',
    label: 'State',
  },
  {
    value: 'invitations',
    label: 'Invitations',
  },
  {
    value: 'engagement',
    label: 'Experience',
  },
  {
    value: 'documents',
    label: 'Documents',
  },
]

function emptyConfig():
  ConfigForm {
  return {
    roomKind:
      'standard',

    accessMode:
      'invitation',

    defaultGuestRole:
      'attendee',

    slug:
      '',

    publicEnabled:
      false,

    publicSummary:
      '',

    timezone:
      'Africa/Lagos',

    scheduledStart:
      '',

    scheduledEnd:
      '',

    passcode:
      '',
  }
}

function emptyInvite(
  role:
    InvitationRole =
      'viewer',
): InviteForm {
  return {
    displayName:
      '',

    email:
      '',

    role,

    expiresAt:
      '',
  }
}

function eventStateLabel(
  value: EventState,
) {
  return value
    .replace(
      /_/g,
      ' ',
    )
    .replace(
      /\b\w/g,
      (letter: string) =>
        letter.toUpperCase(),
    )
}

function eventKindLabel(
  value: EventKind,
) {
  return (
    eventKinds.find(
      item =>
        item.value ===
        value,
    )?.label ||
    value
  )
}

function accessModeLabel(
  value: AccessMode,
) {
  return (
    accessModes.find(
      item =>
        item.value ===
        value,
    )?.label ||
    value
  )
}

function toLocalInput(
  value:
    string | null,
) {
  if (!value) {
    return ''
  }

  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return ''
  }

  const shifted =
    new Date(
      date.getTime() -
        date.getTimezoneOffset() *
          60_000,
    )

  return shifted
    .toISOString()
    .slice(
      0,
      16,
    )
}

function fromLocalInput(
  value: string,
) {
  if (!value) {
    return null
  }

  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      'Enter a valid date and time.',
    )
  }

  return date.toISOString()
}

function formatWhen(
  value:
    string | null,
) {
  if (!value) {
    return 'Not scheduled'
  }

  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value
  }

  return new Intl
    .DateTimeFormat(
      undefined,
      {
        dateStyle:
          'medium',

        timeStyle:
          'short',
      },
    )
    .format(date)
}

function normalizeSlugInput(
  value: string,
) {
  return value
    .toLowerCase()
    .replace(
      /[^a-z0-9-]+/g,
      '-',
    )
    .replace(
      /-+/g,
      '-',
    )
    .replace(
      /^-+/,
      '',
    )
    .slice(
      0,
      80,
    )
}

function invitationState(
  invitation:
    Invitation,
) {
  if (
    invitation.status !==
      'active'
  ) {
    return invitation.status
  }

  if (
    invitation.expires_at &&
    new Date(
      invitation.expires_at,
    ).getTime() <=
      Date.now()
  ) {
    return 'expired'
  }

  return 'active'
}

async function invokeControl<T>(
  body:
    Record<
      string,
      unknown
    >,
): Promise<T> {
  const apiUrl =
    (
      import.meta.env
        .VITE_SUPABASE_URL ||
      ''
    )
      .replace(
        /\/+$/,
        '',
      )

  const anonKey =
    import.meta.env
      .VITE_SUPABASE_ANON_KEY ||
    ''

  if (
    !apiUrl ||
    !anonKey
  ) {
    throw new Error(
      'ROOM 7 event control is not configured in this application.',
    )
  }

  const client =
    supabase

  if (!client) {
    throw new Error(
      'Supabase is not configured in this application.',
    )
  }

  const {
    data: sessionData,
    error: sessionError,
  } =
    await client.auth
      .getSession()

  if (
    sessionError ||
    !sessionData.session
      ?.access_token
  ) {
    throw new Error(
      'Your RideArrivo session has expired. Sign in again.',
    )
  }

  const response =
    await fetch(
      `${apiUrl}/functions/v1/room-event-control`,
      {
        method:
          'POST',

        headers: {
          apikey:
            anonKey,

          Authorization:
            `Bearer ${sessionData.session.access_token}`,

          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify(
            body,
          ),
      },
    )

  const payload =
    await response
      .json()
      .catch(
        () => ({}),
      ) as {
        error?:
          unknown
      }

  if (!response.ok) {
    throw new Error(
      typeof payload.error ===
        'string'
        ? payload.error
        : `ROOM 7 request failed (${response.status}).`,
    )
  }

  return payload as T
}

export default function Room7EventControlCenter({
  roomId,
  roomTitle,
}: Props) {
  const [
    open,
    setOpen,
  ] =
    useState(false)

  const [
    tab,
    setTab,
  ] =
    useState<Tab>(
      'overview',
    )

  const [
    control,
    setControl,
  ] =
    useState<
      ControlResponse | null
    >(null)

  const [
    invitations,
    setInvitations,
  ] =
    useState<
      Invitation[]
    >([])

  const [
    config,
    setConfig,
  ] =
    useState<ConfigForm>(
      emptyConfig,
    )

  const [
    invite,
    setInvite,
  ] =
    useState<InviteForm>(
      () =>
        emptyInvite(),
    )

  const [
    latestInviteUrl,
    setLatestInviteUrl,
  ] =
    useState('')

  const [
    forceOverride,
    setForceOverride,
  ] =
    useState(false)

  const [
    busy,
    setBusy,
  ] =
    useState<
      string | null
    >(null)

  const [
    error,
    setError,
  ] =
    useState('')

  const [
    notice,
    setNotice,
  ] =
    useState('')

  const applyControl =
    useCallback(
      (
        response:
          ControlResponse,
      ) => {
        setControl(
          response,
        )

        const event =
          response.event

        if (!event) {
          setConfig(
            emptyConfig(),
          )

          setInvite(
            emptyInvite(),
          )

          return
        }

        setConfig({
          roomKind:
            event.room_kind,

          accessMode:
            event.access_mode,

          defaultGuestRole:
            event
              .default_guest_role,

          slug:
            event.slug ||
            '',

          publicEnabled:
            event.public_enabled,

          publicSummary:
            event.public_summary ||
            '',

          timezone:
            event.timezone ||
            'Africa/Lagos',

          scheduledStart:
            toLocalInput(
              event.scheduled_start,
            ),

          scheduledEnd:
            toLocalInput(
              event.scheduled_end,
            ),

          passcode:
            '',
        })

        setInvite(
          current => ({
            ...current,

            role:
              event
                .default_guest_role,
          }),
        )
      },
      [],
    )

  const loadInvitations =
    useCallback(
      async () => {
        const response =
          await invokeControl<
            InvitationListResponse
          >({
            action:
              'list_invitations',

            room_id:
              roomId,
          })

        setInvitations(
          response
            .invitations ||
          [],
        )

        setControl(
          response,
        )
      },
      [
        roomId,
      ],
    )

  const load =
    useCallback(
      async () => {
        setBusy(
          'load',
        )

        setError('')
        setNotice('')

        try {
          const response =
            await invokeControl<
              ControlResponse
            >({
              action:
                'get',

              room_id:
                roomId,
            })

          applyControl(
            response,
          )

          if (
            response.event
          ) {
            const invitationResponse =
              await invokeControl<
                InvitationListResponse
              >({
                action:
                  'list_invitations',

                room_id:
                  roomId,
              })

            setInvitations(
              invitationResponse
                .invitations ||
              [],
            )
          } else {
            setInvitations(
              [],
            )
          }
        } catch (cause) {
          setError(
            cause instanceof
              Error
              ? cause.message
              : 'Unable to load ROOM 7 event control.',
          )
        } finally {
          setBusy(
            null,
          )
        }
      },
      [
        applyControl,
        roomId,
      ],
    )

  useEffect(
    () => {
      if (!open) {
        return
      }

      void load()
    },
    [
      load,
      open,
    ],
  )

  useEffect(
    () => {
      if (!open) {
        return
      }

      const handleKey =
        (
          event:
            KeyboardEvent,
        ) => {
          if (
            event.key ===
            'Escape'
          ) {
            setLatestInviteUrl(
              '',
            )

            setOpen(
              false,
            )
          }
        }

      window.addEventListener(
        'keydown',
        handleKey,
      )

      return () => {
        window.removeEventListener(
          'keydown',
          handleKey,
        )
      }
    },
    [
      open,
    ],
  )

  const event =
    control?.event ||
    null

  const permissions =
    control?.permissions ||
    null

  const nextStates =
    useMemo(
      () => {
        if (!event) {
          return []
        }

        if (
          forceOverride &&
          permissions
            ?.can_force_state
        ) {
          return eventStates.filter(
            value =>
              value !==
              event.event_state,
          )
        }

        return (
          normalTransitions[
            event.event_state
          ] ||
          []
        )
      },
      [
        event,
        forceOverride,
        permissions,
      ],
    )

  const close =
    () => {
      setLatestInviteUrl(
        '',
      )

      setError('')
      setNotice('')
      setForceOverride(
        false,
      )

      setOpen(
        false,
      )
    }

  const saveConfig =
    async (
      formEvent:
        FormEvent,
    ) => {
      formEvent
        .preventDefault()

      if (
        busy ||
        !permissions
          ?.can_configure
      ) {
        return
      }

      setError('')
      setNotice('')

      if (
        config.accessMode ===
          'passcode'
      ) {
        const passcode =
          config
            .passcode
            .trim()

        if (
          !event
            ?.has_passcode &&
          !passcode
        ) {
          setError(
            'Set a passcode before enabling passcode-protected access.',
          )

          return
        }

        if (
          passcode &&
          (
            passcode.length <
              6 ||
            passcode.length >
              128
          )
        ) {
          setError(
            'ROOM 7 passcodes must contain between 6 and 128 characters.',
          )

          return
        }
      }

      try {
        const scheduledStart =
          fromLocalInput(
            config
              .scheduledStart,
          )

        const scheduledEnd =
          fromLocalInput(
            config
              .scheduledEnd,
          )

        if (
          scheduledStart &&
          scheduledEnd &&
          new Date(
            scheduledEnd,
          ).getTime() <=
            new Date(
              scheduledStart,
            ).getTime()
        ) {
          throw new Error(
            'Scheduled end must be after scheduled start.',
          )
        }

        setBusy(
          'save',
        )

        const payload:
          Record<
            string,
            unknown
          > = {
            action:
              'configure',

            room_id:
              roomId,

            room_kind:
              config.roomKind,

            access_mode:
              config.accessMode,

            default_guest_role:
              config
                .defaultGuestRole,

            slug:
              config.slug
                .trim() ||
              null,

            public_enabled:
              config
                .publicEnabled,

            public_summary:
              config
                .publicSummary
                .trim() ||
              null,

            timezone:
              config
                .timezone
                .trim(),

            scheduled_start:
              scheduledStart,

            scheduled_end:
              scheduledEnd,
          }

        if (
          config.accessMode ===
            'passcode' &&
          config
            .passcode
            .trim()
        ) {
          payload.passcode =
            config
              .passcode
              .trim()
        }

        const response =
          await invokeControl<
            ControlResponse
          >(
            payload,
          )

        applyControl(
          response,
        )

        setNotice(
          response.event
            ? 'External ROOM 7 event configuration saved.'
            : 'ROOM 7 event configuration saved.',
        )

        if (
          response.event
        ) {
          await loadInvitations()
        }
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to save ROOM 7 event configuration.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  const changeState =
    async (
      requested:
        EventState,
    ) => {
      if (
        !event ||
        busy
      ) {
        return
      }

      const force =
        forceOverride &&
        permissions
          ?.can_force_state ===
          true

      if (
        requested ===
          'ended' ||
        force
      ) {
        const confirmed =
          window.confirm(
            force
              ? `Force ROOM 7 from ${eventStateLabel(event.event_state)} to ${eventStateLabel(requested)}?`
              : 'Move this external ROOM 7 event to Ended?',
          )

        if (!confirmed) {
          return
        }
      }

      setBusy(
        `state:${requested}`,
      )

      setError('')
      setNotice('')

      try {
        const response =
          await invokeControl<
            ControlResponse & {
              previous_state?:
                EventState
            }
          >({
            action:
              'set_state',

            room_id:
              roomId,

            event_state:
              requested,

            force,
          })

        applyControl(
          response,
        )

        setForceOverride(
          false,
        )

        setNotice(
          `External event moved to ${eventStateLabel(requested)}.`,
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to change ROOM 7 event state.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  const createInvitation =
    async (
      formEvent:
        FormEvent,
    ) => {
      formEvent
        .preventDefault()

      if (
        !event ||
        busy
      ) {
        return
      }

      const email =
        invite.email
          .trim()
          .toLowerCase()

      if (
        invite.role ===
          'presenter' &&
        !email
      ) {
        setError(
          'Presenter invitations must be bound to an email address.',
        )

        return
      }

      setBusy(
        'create-invitation',
      )

      setError('')
      setNotice('')
      setLatestInviteUrl('')

      try {
        const payload:
          Record<
            string,
            unknown
          > = {
            action:
              'create_invitation',

            room_id:
              roomId,

            role:
              invite.role,

            email:
              email ||
              null,

            display_name:
              invite
                .displayName
                .trim() ||
              null,
          }

        if (
          invite.expiresAt
        ) {
          payload.expires_at =
            fromLocalInput(
              invite
                .expiresAt,
            )
        }

        const response =
          await invokeControl<
            CreateInvitationResponse
          >(
            payload,
          )

        if (
          !response
            .invitation_url
        ) {
          throw new Error(
            'ROOM 7 did not return a secure invitation link.',
          )
        }

        /*
         * The secure URL contains the raw invitation
         * bearer in the fragment. Keep it only in
         * React memory and never print or persist it.
         */
        setLatestInviteUrl(
          response
            .invitation_url,
        )

        setInvitations(
          current => [
            response
              .invitation,

            ...current.filter(
              item =>
                item.id !==
                response
                  .invitation
                  .id,
            ),
          ],
        )

        setInvite(
          emptyInvite(
            event
              .default_guest_role,
          ),
        )

        setNotice(
          'Secure invitation created. Copy it now; ROOM 7 does not store the raw invitation secret.',
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to create ROOM 7 invitation.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  const revokeInvitation =
    async (
      invitation:
        Invitation,
    ) => {
      if (busy) {
        return
      }

      const label =
        invitation.email ||
        invitation
          .display_name ||
        'this invitation'

      if (
        !window.confirm(
          `Revoke ${label}?`,
        )
      ) {
        return
      }

      setBusy(
        `revoke:${invitation.id}`,
      )

      setError('')
      setNotice('')
      setLatestInviteUrl('')

      try {
        const response =
          await invokeControl<
            ControlResponse & {
              invitation:
                Invitation
            }
          >({
            action:
              'revoke_invitation',

            room_id:
              roomId,

            invitation_id:
              invitation.id,
          })

        setInvitations(
          current =>
            current.map(
              item =>
                item.id ===
                  response
                    .invitation
                    .id
                  ? response
                      .invitation
                  : item,
            ),
        )

        setNotice(
          'ROOM 7 invitation revoked.',
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to revoke ROOM 7 invitation.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  const copyText =
    async (
      value: string,
      success:
        string,
    ) => {
      try {
        if (
          !navigator
            .clipboard
        ) {
          throw new Error(
            'Clipboard access is unavailable.',
          )
        }

        await navigator
          .clipboard
          .writeText(
            value,
          )

        setNotice(
          success,
        )

        setError('')
      } catch {
        setError(
          'Unable to copy to the clipboard. Check browser clipboard permission.',
        )
      }
    }

  return (
    <>
      <button
        type="button"
        className="secondaryButton room7EventControlTrigger"
        onClick={() => {
          setTab(
            'overview',
          )

          setOpen(
            true,
          )
        }}
      >
        <Settings2
          size={16}
        />
        Event
      </button>

      {open && (
        <div
          className="room7EventControlOverlay"
          role="presentation"
          onMouseDown={
            eventValue => {
              if (
                eventValue
                  .target ===
                eventValue
                  .currentTarget
              ) {
                close()
              }
            }
          }
        >
          <section
            className="room7EventControlDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`room7-event-control-${roomId}`}
          >
            <header className="room7EventControlHeader">
              <div>
                <span className="room7EventControlEyebrow">
                  ROOM 7 EVENT CONTROL
                </span>

                <h2
                  id={`room7-event-control-${roomId}`}
                >
                  {roomTitle}
                </h2>

                <p>
                  Configure the external event,
                  control guest access and manage
                  the event lifecycle.
                </p>
              </div>

              <div className="room7EventControlHeaderActions">
                <button
                  type="button"
                  className="iconButton"
                  title="Refresh event control"
                  aria-label="Refresh event control"
                  disabled={
                    busy !==
                    null
                  }
                  onClick={() =>
                    void load()
                  }
                >
                  <RefreshCw
                    size={16}
                    className={
                      busy ===
                      'load'
                        ? 'room7EventControlSpin'
                        : ''
                    }
                  />
                </button>

                <button
                  type="button"
                  className="iconButton"
                  title="Close event control"
                  aria-label="Close event control"
                  onClick={close}
                >
                  <X
                    size={17}
                  />
                </button>
              </div>
            </header>

            <nav
              className="room7EventControlTabs"
              aria-label="ROOM 7 event control sections"
            >
              {tabs.map(
                item => (
                  <button
                    type="button"
                    key={
                      item.value
                    }
                    className={
                      tab ===
                      item.value
                        ? 'active'
                        : ''
                    }
                    onClick={() => {
                      setTab(
                        item.value,
                      )

                      setError('')
                      setNotice('')
                    }}
                  >
                    {
                      item.label
                    }
                  </button>
                ),
              )}
            </nav>

            {(error ||
              notice) && (
              <div
                className={
                  error
                    ? 'room7EventControlMessage error'
                    : 'room7EventControlMessage success'
                }
                role={
                  error
                    ? 'alert'
                    : 'status'
                }
              >
                {
                  error ||
                  notice
                }
              </div>
            )}

            <div className="room7EventControlBody">
              {busy ===
                'load' &&
               !control ? (
                <div className="room7EventControlLoading">
                  <RefreshCw
                    size={20}
                    className="room7EventControlSpin"
                  />
                  Loading event control...
                </div>
              ) : null}

              {tab ===
                'overview' &&
               control && (
                <div className="room7EventControlSection">
                  <div className="room7EventControlSectionHead">
                    <div>
                      <span>
                        Event overview
                      </span>

                      <h3>
                        External ROOM 7
                      </h3>
                    </div>

                    {event && (
                      <span
                        className={`room7EventStateBadge state-${event.event_state}`}
                      >
                        {
                          eventStateLabel(
                            event
                              .event_state,
                          )
                        }
                      </span>
                    )}
                  </div>

                  {!event ? (
                    <div className="room7EventControlEmpty">
                      <Globe2
                        size={28}
                      />

                      <strong>
                        External event is not configured
                      </strong>

                      <p>
                        Configure this internal ROOM 7
                        before inviting external guests.
                      </p>

                      <button
                        type="button"
                        className="primaryButton"
                        onClick={() =>
                          setTab(
                            'configuration',
                          )
                        }
                      >
                        Configure external event
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="room7EventOverviewGrid">
                        <article>
                          <span>
                            Event type
                          </span>
                          <strong>
                            {
                              eventKindLabel(
                                event
                                  .room_kind,
                              )
                            }
                          </strong>
                        </article>

                        <article>
                          <span>
                            Guest access
                          </span>
                          <strong>
                            {
                              accessModeLabel(
                                event
                                  .access_mode,
                              )
                            }
                          </strong>
                        </article>

                        <article>
                          <span>
                            Default role
                          </span>
                          <strong>
                            {
                              event
                                .default_guest_role
                            }
                          </strong>
                        </article>

                        <article>
                          <span>
                            Public page
                          </span>
                          <strong>
                            {
                              event
                                .public_enabled
                                ? 'Enabled'
                                : 'Disabled'
                            }
                          </strong>
                        </article>

                        <article>
                          <span>
                            Start
                          </span>
                          <strong>
                            {
                              formatWhen(
                                event
                                  .scheduled_start,
                              )
                            }
                          </strong>
                        </article>

                        <article>
                          <span>
                            End
                          </span>
                          <strong>
                            {
                              formatWhen(
                                event
                                  .scheduled_end,
                              )
                            }
                          </strong>
                        </article>
                      </div>

                      <div className="room7EventPublicUrlCard">
                        <div>
                          <span>
                            Public event page
                          </span>

                          <strong>
                            {
                              control
                                .public_url
                            }
                          </strong>
                        </div>

                        <button
                          type="button"
                          className="secondaryButton"
                          onClick={() =>
                            void copyText(
                              control
                                .public_url,
                              'Public ROOM 7 page copied.',
                            )
                          }
                        >
                          <Copy
                            size={15}
                          />
                          Copy
                        </button>
                      </div>

                      <div className="room7EventSummaryCard">
                        <span>
                          Public summary
                        </span>

                        <p>
                          {
                            event
                              .public_summary ||
                            'No public event summary yet.'
                          }
                        </p>
                      </div>

                      <div className="room7EventPermissionRow">
                        <ShieldCheck
                          size={16}
                        />

                        <span>
                          {
                            permissions
                              ?.is_room_creator
                              ? 'ROOM 7 host'
                              : 'Authorized event controller'
                          }
                          {
                            permissions
                              ?.can_force_state
                              ? ' - manual state override available'
                              : ''
                          }
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab ===
                'configuration' && (
                <form
                  className="room7EventControlSection"
                  onSubmit={
                    saveConfig
                  }
                >
                  <div className="room7EventControlSectionHead">
                    <div>
                      <span>
                        Configuration
                      </span>

                      <h3>
                        Event settings
                      </h3>
                    </div>

                    <SlidersHorizontal
                      size={20}
                    />
                  </div>

                  <div className="room7EventFormGrid">
                    <label>
                      <span>
                        Event type
                      </span>

                      <select
                        value={
                          config
                            .roomKind
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                roomKind:
                                  eventValue
                                    .target
                                    .value as
                                    EventKind,
                              }),
                            )
                        }
                      >
                        {eventKinds.map(
                          item => (
                            <option
                              key={
                                item
                                  .value
                              }
                              value={
                                item
                                  .value
                              }
                            >
                              {
                                item
                                  .label
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <label>
                      <span>
                        Access mode
                      </span>

                      <select
                        value={
                          config
                            .accessMode
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                accessMode:
                                  eventValue
                                    .target
                                    .value as
                                    AccessMode,
                              }),
                            )
                        }
                      >
                        {accessModes.map(
                          item => (
                            <option
                              key={
                                item
                                  .value
                              }
                              value={
                                item
                                  .value
                              }
                            >
                              {
                                item
                                  .label
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <label>
                      <span>
                        Default guest role
                      </span>

                      <select
                        value={
                          config
                            .defaultGuestRole
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                defaultGuestRole:
                                  eventValue
                                    .target
                                    .value as
                                    DefaultGuestRole,
                              }),
                            )
                        }
                      >
                        <option value="attendee">
                          Attendee
                        </option>

                        <option value="viewer">
                          Viewer
                        </option>
                      </select>

                      <small>
                        Presenter is assigned only
                        through a dedicated invitation.
                      </small>
                    </label>

                    <label>
                      <span>
                        Public slug
                      </span>

                      <input
                        type="text"
                        value={
                          config.slug
                        }
                        placeholder="ridearrivo-launch"
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                slug:
                                  normalizeSlugInput(
                                    eventValue
                                      .target
                                      .value,
                                  ),
                              }),
                            )
                        }
                      />
                    </label>

                    <label>
                      <span>
                        Timezone
                      </span>

                      <input
                        type="text"
                        list="room7-event-timezones"
                        value={
                          config
                            .timezone
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                timezone:
                                  eventValue
                                    .target
                                    .value,
                              }),
                            )
                        }
                      />

                      <datalist id="room7-event-timezones">
                        <option value="Africa/Lagos" />
                        <option value="UTC" />
                        <option value="Europe/London" />
                        <option value="America/New_York" />
                        <option value="America/Los_Angeles" />
                      </datalist>
                    </label>

                    <label className="room7EventSwitchField">
                      <span>
                        External public page
                      </span>

                      <span className="room7EventSwitchRow">
                        <input
                          type="checkbox"
                          checked={
                            config
                              .publicEnabled
                          }
                          onChange={
                            eventValue =>
                              setConfig(
                                current => ({
                                  ...current,

                                  publicEnabled:
                                    eventValue
                                      .target
                                      .checked,
                                }),
                              )
                          }
                        />

                        <strong>
                          {
                            config
                              .publicEnabled
                              ? 'Enabled'
                              : 'Disabled'
                          }
                        </strong>
                      </span>
                    </label>

                    <label>
                      <span>
                        Scheduled start
                      </span>

                      <input
                        type="datetime-local"
                        value={
                          config
                            .scheduledStart
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                scheduledStart:
                                  eventValue
                                    .target
                                    .value,
                              }),
                            )
                        }
                      />

                      <small>
                        Entered in this browser's local
                        timezone; stored as an absolute
                        event timestamp.
                      </small>
                    </label>

                    <label>
                      <span>
                        Scheduled end
                      </span>

                      <input
                        type="datetime-local"
                        value={
                          config
                            .scheduledEnd
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                scheduledEnd:
                                  eventValue
                                    .target
                                    .value,
                              }),
                            )
                        }
                      />
                    </label>
                  </div>

                  {config.accessMode ===
                    'passcode' && (
                    <label className="room7EventWideField">
                      <span>
                        Event passcode
                      </span>

                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={6}
                        maxLength={128}
                        value={
                          config
                            .passcode
                        }
                        placeholder={
                          event
                            ?.has_passcode
                            ? 'Leave blank to keep the current passcode'
                            : 'Set a 6-128 character passcode'
                        }
                        onChange={
                          eventValue =>
                            setConfig(
                              current => ({
                                ...current,

                                passcode:
                                  eventValue
                                    .target
                                    .value,
                              }),
                            )
                        }
                      />

                      <small>
                        The raw passcode is never returned
                        by ROOM 7 after it is configured.
                      </small>
                    </label>
                  )}

                  {config.accessMode ===
                    'open' && (
                    <div className="room7EventControlWarning">
                      Open access remains fail-closed
                      unless the environment explicitly
                      enables ROOM7_ALLOW_OPEN_ACCESS.
                    </div>
                  )}

                  <label className="room7EventWideField">
                    <span>
                      Public event summary
                    </span>

                    <textarea
                      rows={5}
                      maxLength={2000}
                      value={
                        config
                          .publicSummary
                      }
                      placeholder="Describe this event for external guests."
                      onChange={
                        eventValue =>
                          setConfig(
                            current => ({
                              ...current,

                              publicSummary:
                                eventValue
                                  .target
                                  .value,
                            }),
                          )
                      }
                    />

                    <small>
                      {
                        config
                          .publicSummary
                          .length
                      } / 2000
                    </small>
                  </label>

                  <div className="room7EventFormActions">
                    <button
                      type="submit"
                      className="primaryButton"
                      disabled={
                        busy !==
                        null
                      }
                    >
                      <Save
                        size={16}
                      />

                      {
                        busy ===
                        'save'
                          ? 'Saving...'
                          : event
                            ? 'Save event configuration'
                            : 'Create external event'
                      }
                    </button>
                  </div>
                </form>
              )}

              {tab ===
                'state' && (
                <div className="room7EventControlSection">
                  <div className="room7EventControlSectionHead">
                    <div>
                      <span>
                        Event lifecycle
                      </span>

                      <h3>
                        State control
                      </h3>
                    </div>

                    <CalendarClock
                      size={20}
                    />
                  </div>

                  {!event ? (
                    <div className="room7EventControlEmpty">
                      Configure the external event before
                      changing its state.
                    </div>
                  ) : (
                    <>
                      <div className="room7CurrentState">
                        <span>
                          Current state
                        </span>

                        <strong>
                          {
                            eventStateLabel(
                              event
                                .event_state,
                            )
                          }
                        </strong>
                      </div>

                      {permissions
                        ?.can_force_state && (
                        <label className="room7EventOverride">
                          <input
                            type="checkbox"
                            checked={
                              forceOverride
                            }
                            onChange={
                              eventValue =>
                                setForceOverride(
                                  eventValue
                                    .target
                                    .checked,
                                )
                            }
                          />

                          <div>
                            <strong>
                              Manual Manager/Admin override
                            </strong>

                            <span>
                              Allows an intentional state
                              jump outside the normal event
                              sequence.
                            </span>
                          </div>
                        </label>
                      )}

                      <div className="room7EventStateGrid">
                        {eventStates.map(
                          state => {
                            const current =
                              state ===
                              event
                                .event_state

                            const available =
                              nextStates
                                .includes(
                                  state,
                                )

                            return (
                              <button
                                type="button"
                                key={state}
                                className={
                                  current
                                    ? 'current'
                                    : available
                                      ? 'available'
                                      : ''
                                }
                                disabled={
                                  current ||
                                  !available ||
                                  busy !==
                                    null
                                }
                                onClick={() =>
                                  void changeState(
                                    state,
                                  )
                                }
                              >
                                <span>
                                  {
                                    eventStateLabel(
                                      state,
                                    )
                                  }
                                </span>

                                <small>
                                  {
                                    current
                                      ? 'Current'
                                      : available
                                        ? forceOverride
                                          ? 'Override'
                                          : 'Available'
                                        : 'Unavailable'
                                  }
                                </small>
                              </button>
                            )
                          },
                        )}
                      </div>

                      <div className="room7EventControlNote">
                        External event state is separate
                        from the underlying RealtimeKit
                        meeting lifecycle. Ending the media
                        room remains an explicit host action.
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab ===
                'invitations' && (
                <div className="room7EventControlSection">
                  <div className="room7EventControlSectionHead">
                    <div>
                      <span>
                        Guest access
                      </span>

                      <h3>
                        Invitations
                      </h3>
                    </div>

                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={
                        !event ||
                        busy !==
                          null
                      }
                      onClick={() =>
                        void loadInvitations()
                          .catch(
                            cause =>
                              setError(
                                cause instanceof
                                  Error
                                  ? cause.message
                                  : 'Unable to refresh invitations.',
                              ),
                          )
                      }
                    >
                      <RefreshCw
                        size={15}
                      />
                      Refresh
                    </button>
                  </div>

                  {!event ? (
                    <div className="room7EventControlEmpty">
                      Configure the external event before
                      creating invitations.
                    </div>
                  ) : (
                    <>
                      <form
                        className="room7InviteComposer"
                        onSubmit={
                          createInvitation
                        }
                      >
                        <div className="room7EventFormGrid">
                          <label>
                            <span>
                              Guest name
                            </span>

                            <input
                              type="text"
                              maxLength={180}
                              value={
                                invite
                                  .displayName
                              }
                              placeholder="Optional"
                              onChange={
                                eventValue =>
                                  setInvite(
                                    current => ({
                                      ...current,

                                      displayName:
                                        eventValue
                                          .target
                                          .value,
                                    }),
                                  )
                              }
                            />
                          </label>

                          <label>
                            <span>
                              Email binding
                            </span>

                            <input
                              type="email"
                              maxLength={320}
                              value={
                                invite
                                  .email
                              }
                              placeholder="guest@example.com"
                              onChange={
                                eventValue =>
                                  setInvite(
                                    current => ({
                                      ...current,

                                      email:
                                        eventValue
                                          .target
                                          .value,
                                    }),
                                  )
                              }
                            />

                            <small>
                              Recommended for all guests;
                              mandatory for presenters.
                            </small>
                          </label>

                          <label>
                            <span>
                              Invitation role
                            </span>

                            <select
                              value={
                                invite
                                  .role
                              }
                              onChange={
                                eventValue =>
                                  setInvite(
                                    current => ({
                                      ...current,

                                      role:
                                        eventValue
                                          .target
                                          .value as
                                          InvitationRole,
                                    }),
                                  )
                              }
                            >
                              <option value="attendee">
                                Attendee
                              </option>

                              <option value="viewer">
                                Viewer
                              </option>

                              <option value="presenter">
                                Presenter
                              </option>
                            </select>
                          </label>

                          <label>
                            <span>
                              Expiry
                            </span>

                            <input
                              type="datetime-local"
                              value={
                                invite
                                  .expiresAt
                              }
                              onChange={
                                eventValue =>
                                  setInvite(
                                    current => ({
                                      ...current,

                                      expiresAt:
                                        eventValue
                                          .target
                                          .value,
                                    }),
                                  )
                              }
                            />

                            <small>
                              Leave blank for the secure
                              server default.
                            </small>
                          </label>
                        </div>

                        {invite.role ===
                          'presenter' && (
                          <div className="room7EventControlWarning">
                            Presenter access is privileged.
                            Use a named, email-bound
                            invitation only.
                          </div>
                        )}

                        <button
                          type="submit"
                          className="primaryButton"
                          disabled={
                            busy !==
                            null
                          }
                        >
                          <UserPlus
                            size={16}
                          />

                          {
                            busy ===
                            'create-invitation'
                              ? 'Creating...'
                              : 'Create secure invitation'
                          }
                        </button>
                      </form>

                      {latestInviteUrl && (
                        <div className="room7SecureInviteReady">
                          <div>
                            <ShieldCheck
                              size={18}
                            />

                            <span>
                              <strong>
                                Secure invitation ready
                              </strong>

                              <small>
                                The raw bearer exists only
                                in this temporary browser
                                state. Copy it before closing
                                Event Control.
                              </small>
                            </span>
                          </div>

                          <button
                            type="button"
                            className="primaryButton"
                            onClick={() =>
                              void copyText(
                                latestInviteUrl,
                                'Secure ROOM 7 invitation copied.',
                              )
                            }
                          >
                            <Copy
                              size={15}
                            />
                            Copy invitation
                          </button>
                        </div>
                      )}

                      <div className="room7InvitationList">
                        {invitations.length ===
                          0 ? (
                          <div className="room7EventControlEmpty compact">
                            No invitations have been created
                            for this external event.
                          </div>
                        ) : (
                          invitations.map(
                            invitation => {
                              const state =
                                invitationState(
                                  invitation,
                                )

                              return (
                                <article
                                  key={
                                    invitation.id
                                  }
                                  className="room7InvitationCard"
                                >
                                  <div className="room7InvitationIdentity">
                                    <strong>
                                      {
                                        invitation
                                          .display_name ||
                                        invitation
                                          .email ||
                                        'Unbound guest'
                                      }
                                    </strong>

                                    {invitation.email &&
                                     invitation.display_name && (
                                      <span>
                                        {
                                          invitation
                                            .email
                                        }
                                      </span>
                                    )}

                                    <small>
                                      {
                                        invitation
                                          .role
                                      }
                                      {' - '}
                                      {
                                        invitation
                                          .use_count
                                      }
                                      {' '}
                                      admission
                                      {
                                        invitation
                                          .use_count ===
                                        1
                                          ? ''
                                          : 's'
                                      }
                                    </small>
                                  </div>

                                  <div className="room7InvitationMeta">
                                    <span
                                      className={`room7InvitationStatus ${state}`}
                                    >
                                      {
                                        state
                                      }
                                    </span>

                                    <small>
                                      Expires {
                                        formatWhen(
                                          invitation
                                            .expires_at,
                                        )
                                      }
                                    </small>
                                  </div>

                                  <button
                                    type="button"
                                    className="iconButton"
                                    title="Revoke invitation"
                                    aria-label="Revoke invitation"
                                    disabled={
                                      invitation
                                        .status !==
                                        'active' ||
                                      busy !==
                                        null
                                    }
                                    onClick={() =>
                                      void revokeInvitation(
                                        invitation,
                                      )
                                    }
                                  >
                                    <Trash2
                                      size={15}
                                    />
                                  </button>
                                </article>
                              )
                            },
                          )
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab ===
                'engagement' && (
                <Room7EventEngagementManager
                  roomId={roomId}
                  roomTitle={roomTitle}
                />
              )}

              {tab ===
                'documents' && (
                <div className="room7EventControlSection">
                  <div className="room7EventControlSectionHead">
                    <div>
                      <span>
                        Event library
                      </span>

                      <h3>
                        Documents
                      </h3>
                    </div>

                    <FileText
                      size={20}
                    />
                  </div>

                  <div className="room7DocumentBridge">
                    <FileText
                      size={26}
                    />

                    <div>
                      <strong>
                        ROOM 7 Event Document Manager
                      </strong>

                      <p>
                        Upload and govern up to ten private
                        event documents, including their
                        before, during and after-event
                        availability.
                      </p>
                    </div>

                    <RoomEventDocumentsManager
                      roomId={
                        roomId
                      }
                      roomTitle={
                        roomTitle
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}

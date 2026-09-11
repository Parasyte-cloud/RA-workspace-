import {
  useEffect,
  useState,
} from 'react'

import {
  LoaderCircle,
  MessageSquareText,
  X,
} from 'lucide-react'

import {
  type Room7GuestAccessMode,
  type Room7GuestEventState,
  type Room7GuestLocator,
} from './Room7GuestDocuments'

import {
  Room7GuestQna,
  useRoom7PublicContent,
} from './Room7GuestEngagement'

import './room7-guest-engagement.css'

type Props = {
  locator: Room7GuestLocator
  accessMode: Room7GuestAccessMode
  inviteToken: string
  passcode: string
  email: string
  eventState: Room7GuestEventState
  title: string
}

export default function Room7GuestMeetingQna({
  locator,
  accessMode,
  inviteToken,
  passcode,
  email,
  eventState,
  title,
}: Props) {
  const [
    open,
    setOpen,
  ] =
    useState(false)

  const [
    displayName,
    setDisplayName,
  ] =
    useState('')

  const [
    guestEmail,
    setGuestEmail,
  ] =
    useState(
      email,
    )

  const {
    features,
    loading,
    error,
  } =
    useRoom7PublicContent(
      locator,
    )

  useEffect(
    () => {
      setGuestEmail(
        email,
      )
    },
    [
      email,
    ],
  )

  return (
    <div className="room7MeetingQnaControl">
      <button
        type="button"
        className="room7MeetingQnaButton"
        aria-haspopup="dialog"
        aria-expanded={
          open
        }
        onClick={() =>
          setOpen(
            true,
          )
        }
      >
        <MessageSquareText
          size={16}
        />

        Q&A
      </button>

      {open && (
        <aside
          className="room7MeetingQnaPanel"
          role="dialog"
          aria-modal="false"
          aria-label="ROOM 7 moderated Q&A"
        >
          <header className="room7MeetingQnaPanelHeader">
            <div>
              <span>
                LIVE ROOM 7
              </span>

              <strong>
                Moderated Q&A
              </strong>

              <small>
                {title}
              </small>
            </div>

            <button
              type="button"
              aria-label="Close ROOM 7 Q&A"
              onClick={() =>
                setOpen(
                  false,
                )
              }
            >
              <X
                size={17}
              />
            </button>
          </header>

          <div className="room7MeetingQnaPanelBody">
            {loading ? (
              <div className="room7GuestEngagementEmpty">
                <LoaderCircle
                  size={20}
                  className="room7GuestEngagementSpin"
                />

                <span>
                  Loading Q&A controls
                </span>
              </div>
            ) : error ? (
              <div
                className="room7GuestEngagementMessage error"
                role="alert"
              >
                Q&A controls could not be
                refreshed. Close the panel and
                try again.
              </div>
            ) : (
              <Room7GuestQna
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
                displayName={
                  displayName
                }
                email={
                  guestEmail
                }
                eventState={
                  eventState
                }
                enabled={
                  features
                    .qna_enabled
                }
                showIdentityFields
                onDisplayNameChange={
                  setDisplayName
                }
                onEmailChange={
                  setGuestEmail
                }
                compact
              />
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

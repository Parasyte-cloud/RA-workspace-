import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  BookOpen,
  CalendarDays,
  CircleHelp,
  FileText,
  Radio,
  Sparkles,
  TrendingUp,
} from 'lucide-react'

import Room7GuestDocuments, {
  type Room7GuestAccessMode,
  type Room7GuestEventState,
  type Room7GuestLocator,
} from './Room7GuestDocuments'

import {
  Room7GuestQna,
  Room7InvestorInterestForm,
  useRoom7PublicContent,
} from './Room7GuestEngagement'

import './room7-public-experience.css'
import './room7-guest-engagement.css'

type RoomKind =
  | 'standard'
  | 'executive'
  | 'investor'
  | 'webinar'
  | 'launch'
  | 'town_hall'

type ProgrammeItem = {
  timeLabel: string
  title: string
  description: string
}

type Props = {
  title: string
  roomKind: RoomKind
  eventState: Room7GuestEventState
  summary: string | null
  scheduledStart: string | null
  scheduledEnd: string | null
  joinAvailable: boolean
  locator: Room7GuestLocator
  accessMode: Room7GuestAccessMode
  inviteToken: string
  passcode: string
  email: string
  onEmailChange: (
    value: string,
  ) => void
}

const launchProgramme:
  ProgrammeItem[] = [
    {
      timeLabel:
        '01',

      title:
        'Arrival & ROOM 7 welcome',

      description:
        'Guests enter the RideArrivo launch environment and prepare for the programme.',
    },
    {
      timeLabel:
        '02',

      title:
        'RideArrivo story',

      description:
        'The company vision, mobility problem and the experience RideArrivo is building.',
    },
    {
      timeLabel:
        '03',

      title:
        'Product & operations experience',

      description:
        'How planned journeys, airport movement, corporate travel and operations connect.',
    },
    {
      timeLabel:
        '04',

      title:
        'Growth & investor conversation',

      description:
        'A structured look at the opportunity, partnerships and the next stage of RideArrivo.',
    },
    {
      timeLabel:
        '05',

      title:
        'Moderated ROOM 7 Q&A',

      description:
        'Approved audience questions are surfaced to the host and answered through the event.',
    },
  ]

const genericProgramme:
  Record<
    RoomKind,
    ProgrammeItem[]
  > = {
    standard: [
      {
        timeLabel:
          '01',
        title:
          'Welcome',
        description:
          'Opening and ROOM 7 orientation.',
      },
      {
        timeLabel:
          '02',
        title:
          'Main session',
        description:
          'The principal event discussion.',
      },
      {
        timeLabel:
          '03',
        title:
          'Questions',
        description:
          'Moderated guest questions.',
      },
    ],

    executive: [
      {
        timeLabel:
          '01',
        title:
          'Executive welcome',
        description:
          'Opening remarks and session context.',
      },
      {
        timeLabel:
          '02',
        title:
          'Executive session',
        description:
          'The core executive discussion.',
      },
      {
        timeLabel:
          '03',
        title:
          'Close',
        description:
          'Key decisions and follow-up.',
      },
    ],

    investor: [
      {
        timeLabel:
          '01',
        title:
          'Company overview',
        description:
          'RideArrivo and the opportunity.',
      },
      {
        timeLabel:
          '02',
        title:
          'Growth discussion',
        description:
          'Operations, scale and strategic direction.',
      },
      {
        timeLabel:
          '03',
        title:
          'Investor Q&A',
        description:
          'Moderated investor questions.',
      },
    ],

    webinar: [
      {
        timeLabel:
          '01',
        title:
          'Welcome',
        description:
          'Webinar introduction.',
      },
      {
        timeLabel:
          '02',
        title:
          'Presentation',
        description:
          'Main webinar presentation.',
      },
      {
        timeLabel:
          '03',
        title:
          'Audience Q&A',
        description:
          'Moderated questions and answers.',
      },
    ],

    launch:
      launchProgramme,

    town_hall: [
      {
        timeLabel:
          '01',
        title:
          'Town hall opening',
        description:
          'Opening context and announcements.',
      },
      {
        timeLabel:
          '02',
        title:
          'Main conversation',
        description:
          'Company-wide discussion.',
      },
      {
        timeLabel:
          '03',
        title:
          'Open questions',
        description:
          'Moderated participant questions.',
      },
    ],
  }

function scrollTo(
  id: string,
) {
  document
    .getElementById(
      id,
    )
    ?.scrollIntoView({
      behavior:
        'smooth',

      block:
        'start',
    })
}

function formatSchedule(
  start:
    string | null,

  end:
    string | null,
) {
  if (!start) {
    return 'Programme timing is managed by the ROOM 7 host.'
  }

  try {
    const formatter =
      new Intl
        .DateTimeFormat(
          undefined,
          {
            dateStyle:
              'medium',

            timeStyle:
              'short',
          },
        )

    const startText =
      formatter.format(
        new Date(start),
      )

    if (!end) {
      return startText
    }

    return `${startText} - ${formatter.format(
      new Date(end),
    )}`
  } catch {
    return start
  }
}

export function Room7PublicExperienceNavigation({
  eventState,
}: {
  eventState:
    Room7GuestEventState
}) {
  const live =
    eventState ===
      'live' ||
    eventState ===
      'intermission'

  const items = [
    {
      label:
        'LIVE',

      target:
        'room7-live',
    },
    {
      label:
        'STORY',

      target:
        'room7-story',
    },
    {
      label:
        'PROGRAMME',

      target:
        'room7-programme',
    },
    {
      label:
        'INVEST',

      target:
        'room7-invest',
    },
    {
      label:
        'LIBRARY',

      target:
        'room7-library',
    },
    {
      label:
        'Q&A',

      target:
        'room7-qna',
    },
  ]

  return (
    <nav
      className="room7PublicExperienceNav"
      aria-label="ROOM 7 event experience"
    >
      {items.map(
        item => (
          <button
            key={
              item.target
            }
            type="button"
            className={
              item.label ===
                'LIVE' &&
              live
                ? 'live'
                : ''
            }
            onClick={() =>
              scrollTo(
                item.target,
              )
            }
          >
            {item.label ===
              'LIVE' && (
              <Radio
                size={11}
              />
            )}

            {
              item.label
            }
          </button>
        ),
      )}
    </nav>
  )
}

export default function Room7PublicExperienceSections({
  title,
  roomKind,
  eventState,
  summary,
  scheduledStart,
  scheduledEnd,
  joinAvailable,
  locator,
  accessMode,
  inviteToken,
  passcode,
  email,
  onEmailChange,
}: Props) {
  const [
    guestName,
    setGuestName,
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
    content,
    features,
    loading:
      contentLoading,
    error:
      contentError,
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

  const updateEmail =
    (
      value:
        string,
    ) => {
      setGuestEmail(
        value,
      )

      onEmailChange(
        value,
      )
    }

  const programme =
    useMemo(
      () => {
        if (
          content
            ?.programme_items
            ?.length
        ) {
          return content
            .programme_items
            .map(
              (
                item,
                index,
              ) => ({
                timeLabel:
                  item
                    .time_label ||
                  String(
                    index + 1,
                  )
                    .padStart(
                      2,
                      '0',
                    ),

                title:
                  item.title,

                description:
                  item
                    .description ||
                  '',
              }),
            )
        }

        return genericProgramme[
          roomKind
        ]
      },
      [
        content,
        roomKind,
      ],
    )

  const storyHeadline =
    content
      ?.story_headline ||
    (
      roomKind ===
        'launch'
        ? 'Movement should feel planned, personal and dependable.'
        : 'A ROOM 7 experience built around the event, not around the meeting link.'
    )

  const storyBody =
    content
      ?.story_body ||
    summary ||
    (
      roomKind ===
        'launch'
        ? 'RideArrivo brings planned mobility, professional coordination and a more deliberate travel experience into one operating model.'
        : 'ROOM 7 gives RideArrivo a controlled environment for live events, executive conversations, documents and moderated audience participation.'
    )

  const storyPoints =
    content
      ?.story_points
      ?.length
      ? content
          .story_points
      : [
          {
            title:
              'Planned',

            description:
              'Journeys and event participation are coordinated before the moment of movement.',
          },
          {
            title:
              'Professional',

            description:
              'The experience is designed around dependable service and clear operating standards.',
          },
          {
            title:
              'Connected',

            description:
              'Guests, operations, documents and follow-up remain part of one managed experience.',
          },
        ]

  const investHeadline =
    content
      ?.invest_headline ||
    'Continue the RideArrivo conversation beyond ROOM 7.'

  const investBody =
    content
      ?.invest_body ||
    'Investors and strategic stakeholders can privately request follow-up with the RideArrivo team. Contact requests remain separate from event attendance and audience analytics.'

  const ctaLabel =
    content
      ?.invest_cta_label ||
    'Request investor follow-up'

  return (
    <div className="room7PublicExperienceSections">
      {contentLoading && (
        <div className="room7PublicContentStatus">
          Loading live event content...
        </div>
      )}

      {contentError && (
        <div
          className="room7PublicContentStatus warning"
          role="status"
        >
          Live host content could not be refreshed.
          The event experience remains available.
        </div>
      )}

      <section
        id="room7-story"
        className="room7PublicEditorialSection"
      >
        <span className="room7PublicSectionIndex">
          01
        </span>

        <div className="room7PublicSectionCopy">
          <span className="room7PublicSectionEyebrow">
            STORY
          </span>

          <h2>
            {storyHeadline}
          </h2>

          <p className="room7PublicSectionLead">
            {storyBody}
          </p>

          <div className="room7PublicStoryGrid">
            {storyPoints.map(
              (
                point,
                index,
              ) => (
                <article
                  key={
                    `${point.title}-${index}`
                  }
                >
                  <Sparkles
                    size={18}
                  />

                  <strong>
                    {
                      point.title
                    }
                  </strong>

                  {point
                    .description && (
                    <p>
                      {
                        point
                          .description
                      }
                    </p>
                  )}
                </article>
              ),
            )}
          </div>
        </div>
      </section>

      <section
        id="room7-programme"
        className="room7PublicEditorialSection"
      >
        <span className="room7PublicSectionIndex">
          02
        </span>

        <div className="room7PublicSectionCopy">
          <div className="room7PublicSectionTitleRow">
            <div>
              <span className="room7PublicSectionEyebrow">
                PROGRAMME
              </span>

              <h2>
                The ROOM 7 programme
              </h2>

              <p>
                The host can update this programme
                from Event Control without changing
                the public event URL.
              </p>
            </div>

            <div className="room7PublicProgrammeTiming">
              <CalendarDays
                size={14}
              />

              {
                formatSchedule(
                  scheduledStart,
                  scheduledEnd,
                )
              }
            </div>
          </div>

          <div className="room7PublicProgrammeList">
            {programme.map(
              (
                item,
                index,
              ) => (
                <article
                  key={
                    `${item.title}-${index}`
                  }
                >
                  <span>
                    {
                      item.timeLabel
                    }
                  </span>

                  <div>
                    <strong>
                      {
                        item.title
                      }
                    </strong>

                    {item
                      .description && (
                      <p>
                        {
                          item
                            .description
                        }
                      </p>
                    )}
                  </div>
                </article>
              ),
            )}
          </div>
        </div>
      </section>

      <section
        id="room7-invest"
        className="room7PublicEditorialSection"
      >
        <span className="room7PublicSectionIndex">
          03
        </span>

        <div className="room7PublicSectionCopy">
          <div className="room7PublicInvestGrid">
            <div>
              <span className="room7PublicSectionEyebrow">
                INVEST
              </span>

              <h2>
                {investHeadline}
              </h2>

              <p className="room7PublicSectionLead">
                {investBody}
              </p>
            </div>

            <div className="room7PublicInvestorCard">
              <TrendingUp
                size={22}
              />

              <span>
                PRIVATE FOLLOW-UP
              </span>

              <strong>
                Investor & stakeholder interest
              </strong>

              <p>
                Nothing submitted here is added
                automatically to ROOM 7 attendance
                or audience analytics.
              </p>
            </div>
          </div>

          <Room7InvestorInterestForm
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
              guestName
            }
            email={
              guestEmail
            }
            enabled={
              features
                .investor_interest_enabled
            }
            buttonLabel={
              ctaLabel
            }
            onDisplayNameChange={
              setGuestName
            }
            onEmailChange={
              updateEmail
            }
          />
        </div>
      </section>

      <section
        id="room7-library"
        className="room7PublicEditorialSection"
      >
        <span className="room7PublicSectionIndex">
          04
        </span>

        <div className="room7PublicSectionCopy">
          <div className="room7PublicLibraryGrid">
            <div>
              <span className="room7PublicSectionEyebrow">
                LIBRARY
              </span>

              <h2>
                Controlled event material,
                available in context.
              </h2>

              <p className="room7PublicSectionLead">
                ROOM 7 documents are served
                through the event access rules.
                Preview access does not consume
                an invitation admission.
              </p>

              <div className="room7PublicLibraryFacts">
                <span>
                  <FileText
                    size={13}
                  />
                  Secure preview
                </span>

                <span>
                  <BookOpen
                    size={13}
                  />
                  Phase-aware availability
                </span>
              </div>
            </div>

            <div className="room7PublicLibraryAccess">
              <span>
                EVENT LIBRARY
              </span>

              <strong>
                Open event documents
              </strong>

              <p>
                Available files are determined
                by the current ROOM 7 event phase
                and each document's host policy.
              </p>

              <Room7GuestDocuments
                context="lobby"
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
                  guestEmail
                }
                eventState={
                  eventState
                }
                title={
                  title
                }
                onEmailChange={
                  updateEmail
                }
              />
            </div>
          </div>
        </div>
      </section>

      <section
        id="room7-qna"
        className="room7PublicEditorialSection"
      >
        <span className="room7PublicSectionIndex">
          05
        </span>

        <div className="room7PublicSectionCopy">
          <div className="room7PublicQnaGrid">
            <div>
              <span className="room7PublicSectionEyebrow">
                Q&A
              </span>

              <h2>
                Ask. Moderate. Answer.
              </h2>

              <p className="room7PublicSectionLead">
                Questions are submitted privately
                to the ROOM 7 moderation queue.
                Only approved question text and
                published answers appear publicly.
              </p>
            </div>

            <div
              className={
                features
                  .qna_enabled
                  ? 'room7PublicQnaStatus open'
                  : 'room7PublicQnaStatus'
              }
            >
              <CircleHelp
                size={22}
              />

              <span>
                MODERATION STATUS
              </span>

              <strong>
                {
                  !features
                    .qna_enabled
                    ? 'Q&A disabled'
                    : eventState ===
                        'live' ||
                      eventState ===
                        'intermission'
                      ? 'Accepting questions'
                      : 'Viewing approved Q&A'
                }
              </strong>

              <p>
                Guest contact details are never
                included in the public question
                feed.
              </p>
            </div>
          </div>

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
              guestName
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
            onDisplayNameChange={
              setGuestName
            }
            onEmailChange={
              updateEmail
            }
          />
        </div>
      </section>

      <div className="room7PublicLiveSummary">
        <div>
          <Radio
            size={18}
          />

          <span>
            ROOM 7
          </span>

          <strong>
            {
              eventState ===
                'live'
                ? 'The event is live.'
                : eventState ===
                    'intermission'
                  ? 'ROOM 7 is in intermission.'
                  : joinAvailable
                    ? 'Guest access is open.'
                    : 'The event experience is available.'
            }
          </strong>

          <p>
            {
              summary ||
              'RideArrivo ROOM 7 combines the event stage, programme, documents, moderated participation and follow-up in one controlled experience.'
            }
          </p>
        </div>

        {joinAvailable && (
          <button
            type="button"
            onClick={() =>
              scrollTo(
                'room7-guest-access',
              )
            }
          >
            Enter guest access
          </button>
        )}
      </div>
    </div>
  )
}

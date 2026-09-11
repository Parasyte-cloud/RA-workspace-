import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react'

import {
  CheckCircle2,
  CircleHelp,
  LoaderCircle,
  RefreshCw,
  Send,
  TrendingUp,
} from 'lucide-react'

import {
  type Room7GuestAccessMode,
  type Room7GuestEventState,
  type Room7GuestLocator,
} from './Room7GuestDocuments'

export type Room7PublicStoryPoint = {
  title: string
  description: string | null
}

export type Room7PublicProgrammeItem = {
  title: string
  description: string | null
  time_label: string | null
}

export type Room7PublicEventContent = {
  story_headline: string | null
  story_body: string | null
  story_points: Room7PublicStoryPoint[]
  programme_items: Room7PublicProgrammeItem[]
  invest_headline: string | null
  invest_body: string | null
  invest_cta_label: string | null
  updated_at: string
}

export type Room7PublicQuestion = {
  id: string
  question: string
  status: 'approved' | 'answered'
  answer_text: string | null
  is_pinned: boolean
  submitted_at: string
  answered_at: string | null
}

export type Room7EngagementFeatures = {
  qna_enabled: boolean
  investor_interest_enabled: boolean
}

type ContentResponse = {
  content: Room7PublicEventContent | null
  features: Room7EngagementFeatures
}

type QuestionsResponse = {
  questions: Room7PublicQuestion[]
}

type QuestionSubmitResponse = {
  question: {
    id: string
    status: string
    submitted_at: string
  }
  message: string
}

type InterestSubmitResponse = {
  submission_id: string
  received_at: string
  message: string
}

type AccessContext = {
  locator: Room7GuestLocator
  accessMode: Room7GuestAccessMode
  inviteToken: string
  passcode: string
  displayName: string
  email: string
}

function locatorBody(
  locator: Room7GuestLocator,
) {
  if (
    locator.slug &&
    locator.slug.trim()
  ) {
    return {
      slug:
        locator.slug
          .trim()
          .toLowerCase(),
    }
  }

  if (
    locator.room_code &&
    locator.room_code.trim()
  ) {
    return {
      room_code:
        locator
          .room_code
          .trim()
          .toUpperCase(),
    }
  }

  throw new Error(
    'ROOM 7 event link is incomplete.',
  )
}

function validEmail(
  value: string,
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(value)
}

function guestAccessBody({
  locator,
  accessMode,
  inviteToken,
  passcode,
  displayName,
  email,
}: AccessContext) {
  const name =
    displayName
      .trim()
      .replace(
        /\s+/g,
        ' ',
      )

  const normalizedEmail =
    email
      .trim()
      .toLowerCase()

  if (!name) {
    throw new Error(
      'Enter your name before submitting.',
    )
  }

  if (
    !normalizedEmail ||
    !validEmail(
      normalizedEmail,
    )
  ) {
    throw new Error(
      'Enter a valid email address.',
    )
  }

  const body:
    Record<
      string,
      unknown
    > = {
      ...locatorBody(
        locator,
      ),

      display_name:
        name,

      email:
        normalizedEmail,
    }

  if (
    accessMode ===
      'invitation'
  ) {
    if (
      inviteToken
        .trim()
        .length <
      24
    ) {
      throw new Error(
        'A valid RideArrivo invitation is required.',
      )
    }

    body.invite_token =
      inviteToken.trim()
  }

  if (
    accessMode ===
      'passcode'
  ) {
    if (
      passcode
        .trim()
        .length <
      6
    ) {
      throw new Error(
        'Enter the ROOM 7 event passcode.',
      )
    }

    body.passcode =
      passcode.trim()
  }

  return body
}

async function room7EngagementRequest<T>(
  body:
    Record<
      string,
      unknown
    >,
): Promise<T> {
  const apiUrl =
    String(
      import.meta.env
        .VITE_SUPABASE_URL ||
      '',
    )
      .trim()
      .replace(
        /\/+$/,
        '',
      )

  const anonKey =
    String(
      import.meta.env
        .VITE_SUPABASE_ANON_KEY ||
      '',
    )
      .trim()

  if (
    !apiUrl ||
    !anonKey
  ) {
    throw new Error(
      'ROOM 7 engagement is not configured.',
    )
  }

  const response =
    await fetch(
      `${apiUrl}/functions/v1/room-event-engagement`,
      {
        method:
          'POST',

        credentials:
          'omit',

        referrerPolicy:
          'no-referrer',

        headers: {
          apikey:
            anonKey,

          Authorization:
            `Bearer ${anonKey}`,

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
        : `ROOM 7 engagement request failed (${response.status}).`,
    )
  }

  return payload as T
}

export function useRoom7PublicContent(
  locator:
    Room7GuestLocator,
) {
  const [
    content,
    setContent,
  ] =
    useState<
      Room7PublicEventContent | null
    >(null)

  const [
    features,
    setFeatures,
  ] =
    useState<
      Room7EngagementFeatures
    >({
      qna_enabled:
        true,

      investor_interest_enabled:
        true,
    })

  const [
    loading,
    setLoading,
  ] =
    useState(true)

  const [
    error,
    setError,
  ] =
    useState('')

  const refresh =
    useCallback(
      async () => {
        setLoading(true)
        setError('')

        try {
          const response =
            await room7EngagementRequest<
              ContentResponse
            >({
              action:
                'public_content',

              ...locatorBody(
                locator,
              ),
            })

          setContent(
            response.content,
          )

          if (
            response.features &&
            typeof response
              .features
              .qna_enabled ===
              'boolean' &&
            typeof response
              .features
              .investor_interest_enabled ===
              'boolean'
          ) {
            setFeatures(
              response.features,
            )
          }
        } catch (cause) {
          setError(
            cause instanceof
              Error
              ? cause.message
              : 'Unable to load ROOM 7 event content.',
          )
        } finally {
          setLoading(false)
        }
      },
      [
        locator.room_code,
        locator.slug,
      ],
    )

  useEffect(
    () => {
      void refresh()
    },
    [
      refresh,
    ],
  )

  return {
    content,
    features,
    loading,
    error,
    refresh,
  }
}

type QnaProps = AccessContext & {
  eventState: Room7GuestEventState
  enabled: boolean
  showIdentityFields?: boolean
  onDisplayNameChange?: (
    value: string,
  ) => void
  onEmailChange?: (
    value: string,
  ) => void
  compact?: boolean
}

export function Room7GuestQna({
  locator,
  accessMode,
  inviteToken,
  passcode,
  displayName,
  email,
  eventState,
  enabled,
  showIdentityFields = true,
  onDisplayNameChange,
  onEmailChange,
  compact = false,
}: QnaProps) {
  const [
    questions,
    setQuestions,
  ] =
    useState<
      Room7PublicQuestion[]
    >([])

  const [
    question,
    setQuestion,
  ] =
    useState('')

  const [
    loading,
    setLoading,
  ] =
    useState(false)

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false)

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

  const submissionOpen =
    enabled &&
    (
      eventState ===
        'live' ||
      eventState ===
        'intermission'
    )

  const loadQuestions =
    useCallback(
      async (
        quiet =
          false,
      ) => {
        if (!enabled) {
          setQuestions([])
          return
        }

        if (!quiet) {
          setLoading(true)
        }

        try {
          const response =
            await room7EngagementRequest<
              QuestionsResponse
            >({
              action:
                'public_questions',

              ...locatorBody(
                locator,
              ),
            })

          setQuestions(
            Array.isArray(
              response.questions,
            )
              ? response.questions
              : [],
          )

          if (!quiet) {
            setError('')
          }
        } catch (cause) {
          if (!quiet) {
            setError(
              cause instanceof
                Error
                ? cause.message
                : 'Unable to load moderated ROOM 7 questions.',
            )
          }
        } finally {
          if (!quiet) {
            setLoading(false)
          }
        }
      },
      [
        enabled,
        locator.room_code,
        locator.slug,
      ],
    )

  useEffect(
    () => {
      void loadQuestions()
    },
    [
      loadQuestions,
    ],
  )

  useEffect(
    () => {
      if (
        !enabled ||
        (
          eventState !==
            'live' &&
          eventState !==
            'intermission'
        )
      ) {
        return
      }

      const timer =
        window.setInterval(
          () => {
            if (
              document
                .visibilityState ===
              'visible'
            ) {
              void loadQuestions(
                true,
              )
            }
          },
          15000,
        )

      return () =>
        window.clearInterval(
          timer,
        )
    },
    [
      enabled,
      eventState,
      loadQuestions,
    ],
  )

  const submitQuestion =
    async (
      event:
        FormEvent,
    ) => {
      event.preventDefault()

      if (
        submitting ||
        !submissionOpen
      ) {
        return
      }

      const cleanedQuestion =
        question.trim()

      if (
        cleanedQuestion.length <
          3 ||
        cleanedQuestion.length >
          1200
      ) {
        setError(
          'Your question must contain between 3 and 1200 characters.',
        )

        return
      }

      setSubmitting(true)
      setError('')
      setNotice('')

      try {
        const access =
          guestAccessBody({
            locator,
            accessMode,
            inviteToken,
            passcode,
            displayName,
            email,
          })

        const response =
          await room7EngagementRequest<
            QuestionSubmitResponse
          >({
            action:
              'submit_question',

            ...access,

            question:
              cleanedQuestion,
          })

        setQuestion('')

        setNotice(
          response.message ||
          'Your question was submitted for moderator review.',
        )

        await loadQuestions(
          true,
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to submit your ROOM 7 question.',
        )
      } finally {
        setSubmitting(false)
      }
    }

  return (
    <div
      className={
        compact
          ? 'room7GuestQna room7GuestQnaCompact'
          : 'room7GuestQna'
      }
    >
      {!enabled ? (
        <div className="room7GuestEngagementUnavailable">
          <CircleHelp
            size={22}
          />

          <div>
            <strong>
              Moderated Q&A is not enabled
            </strong>

            <p>
              The ROOM 7 host has not enabled
              questions for this event.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="room7GuestQnaToolbar">
            <div>
              <span>
                MODERATED Q&A
              </span>

              <strong>
                Questions from the room
              </strong>
            </div>

            <button
              type="button"
              onClick={() =>
                void loadQuestions()
              }
              disabled={
                loading
              }
              aria-label="Refresh moderated questions"
            >
              <RefreshCw
                size={15}
                className={
                  loading
                    ? 'room7GuestEngagementSpin'
                    : ''
                }
              />
            </button>
          </div>

          <div className="room7GuestQuestionFeed">
            {loading &&
             questions.length ===
               0 && (
              <div className="room7GuestEngagementEmpty">
                <LoaderCircle
                  size={20}
                  className="room7GuestEngagementSpin"
                />

                <span>
                  Loading approved questions
                </span>
              </div>
            )}

            {!loading &&
             questions.length ===
               0 && (
              <div className="room7GuestEngagementEmpty">
                <CircleHelp
                  size={22}
                />

                <span>
                  Approved questions and answers
                  will appear here.
                </span>
              </div>
            )}

            {questions.map(
              item => (
                <article
                  key={
                    item.id
                  }
                  className={
                    item.is_pinned
                      ? 'pinned'
                      : ''
                  }
                >
                  <header>
                    <span>
                      {
                        item.is_pinned
                          ? 'PINNED QUESTION'
                          : 'QUESTION'
                      }
                    </span>

                    <span>
                      {
                        item.status ===
                          'answered'
                          ? 'Answered'
                          : 'Approved'
                      }
                    </span>
                  </header>

                  <p>
                    {
                      item.question
                    }
                  </p>

                  {item
                    .status ===
                      'answered' &&
                   item
                     .answer_text && (
                    <div className="room7GuestPublishedAnswer">
                      <CheckCircle2
                        size={16}
                      />

                      <div>
                        <span>
                          ROOM 7 ANSWER
                        </span>

                        <p>
                          {
                            item
                              .answer_text
                          }
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              ),
            )}
          </div>

          <form
            className="room7GuestQuestionForm"
            onSubmit={
              submitQuestion
            }
          >
            <div className="room7GuestQuestionFormHeading">
              <strong>
                Ask the ROOM 7 host
              </strong>

              <span>
                Questions are reviewed before
                they appear publicly.
              </span>
            </div>

            {showIdentityFields && (
              <div className="room7GuestIdentityGrid">
                <label>
                  <span>
                    Your name
                  </span>

                  <input
                    type="text"
                    maxLength={180}
                    autoComplete="name"
                    value={
                      displayName
                    }
                    onChange={
                      event =>
                        onDisplayNameChange?.(
                          event
                            .target
                            .value,
                        )
                    }
                    placeholder="Your name"
                  />
                </label>

                <label>
                  <span>
                    Email
                  </span>

                  <input
                    type="email"
                    maxLength={320}
                    autoComplete="email"
                    value={
                      email
                    }
                    onChange={
                      event =>
                        onEmailChange?.(
                          event
                            .target
                            .value,
                        )
                    }
                    placeholder="name@example.com"
                  />
                </label>
              </div>
            )}

            <label>
              <span>
                Question
              </span>

              <textarea
                rows={
                  compact
                    ? 3
                    : 4
                }
                maxLength={1200}
                value={
                  question
                }
                onChange={
                  event =>
                    setQuestion(
                      event
                        .target
                        .value,
                    )
                }
                disabled={
                  !submissionOpen ||
                  submitting
                }
                placeholder={
                  submissionOpen
                    ? 'Ask a question for moderator review'
                    : 'Questions open when ROOM 7 is live'
                }
              />

              <small>
                {question.length}/1200
              </small>
            </label>

            {error && (
              <div
                className="room7GuestEngagementMessage error"
                role="alert"
              >
                {error}
              </div>
            )}

            {notice && (
              <div
                className="room7GuestEngagementMessage success"
                role="status"
              >
                {notice}
              </div>
            )}

            <button
              type="submit"
              className="room7GuestEngagementPrimary"
              disabled={
                !submissionOpen ||
                submitting
              }
            >
              {submitting ? (
                <LoaderCircle
                  size={16}
                  className="room7GuestEngagementSpin"
                />
              ) : (
                <Send
                  size={16}
                />
              )}

              {
                submitting
                  ? 'Submitting...'
                  : submissionOpen
                    ? 'Submit question'
                    : 'Q&A opens when live'
              }
            </button>
          </form>
        </>
      )}
    </div>
  )
}

type InterestProps = AccessContext & {
  enabled: boolean
  buttonLabel: string
  onDisplayNameChange: (
    value: string,
  ) => void
  onEmailChange: (
    value: string,
  ) => void
}

export function Room7InvestorInterestForm({
  locator,
  accessMode,
  inviteToken,
  passcode,
  displayName,
  email,
  enabled,
  buttonLabel,
  onDisplayNameChange,
  onEmailChange,
}: InterestProps) {
  const [
    company,
    setCompany,
  ] =
    useState('')

  const [
    phone,
    setPhone,
  ] =
    useState('')

  const [
    interestType,
    setInterestType,
  ] =
    useState(
      'investment',
    )

  const [
    investmentRange,
    setInvestmentRange,
  ] =
    useState('')

  const [
    message,
    setMessage,
  ] =
    useState('')

  const [
    consent,
    setConsent,
  ] =
    useState(false)

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false)

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

  const submit =
    async (
      event:
        FormEvent,
    ) => {
      event.preventDefault()

      if (
        !enabled ||
        submitting
      ) {
        return
      }

      if (!consent) {
        setError(
          'Confirm that RideArrivo may contact you about this request.',
        )

        return
      }

      setSubmitting(true)
      setError('')
      setNotice('')

      try {
        const access =
          guestAccessBody({
            locator,
            accessMode,
            inviteToken,
            passcode,
            displayName,
            email,
          })

        const response =
          await room7EngagementRequest<
            InterestSubmitResponse
          >({
            action:
              'submit_interest',

            ...access,

            company:
              company
                .trim() ||
              null,

            phone:
              phone
                .trim() ||
              null,

            interest_type:
              interestType,

            investment_range:
              investmentRange
                .trim() ||
              null,

            message:
              message
                .trim() ||
              null,

            contact_consent:
              true,
          })

        setMessage('')
        setConsent(false)

        setNotice(
          response.message ||
          'Your ROOM 7 follow-up request has been received.',
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to submit your follow-up request.',
        )
      } finally {
        setSubmitting(false)
      }
    }

  if (!enabled) {
    return (
      <div className="room7GuestEngagementUnavailable">
        <TrendingUp
          size={22}
        />

        <div>
          <strong>
            Investor follow-up is not enabled
          </strong>

          <p>
            The ROOM 7 host has not enabled
            stakeholder contact requests for
            this event.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form
      className="room7InvestorInterestForm"
      onSubmit={
        submit
      }
    >
      <div className="room7InvestorInterestHeading">
        <span>
          PRIVATE FOLLOW-UP REQUEST
        </span>

        <strong>
          Continue the conversation with
          RideArrivo
        </strong>

        <p>
          This form is separate from ROOM 7
          attendance and event analytics.
        </p>
      </div>

      <div className="room7GuestIdentityGrid">
        <label>
          <span>
            Your name
          </span>

          <input
            type="text"
            maxLength={180}
            autoComplete="name"
            required
            value={
              displayName
            }
            onChange={
              event =>
                onDisplayNameChange(
                  event
                    .target
                    .value,
                )
            }
          />
        </label>

        <label>
          <span>
            Email
          </span>

          <input
            type="email"
            maxLength={320}
            autoComplete="email"
            required
            value={
              email
            }
            onChange={
              event =>
                onEmailChange(
                  event
                    .target
                    .value,
                )
            }
          />
        </label>
      </div>

      <div className="room7GuestIdentityGrid">
        <label>
          <span>
            Company / organisation
          </span>

          <input
            type="text"
            maxLength={180}
            autoComplete="organization"
            value={
              company
            }
            onChange={
              event =>
                setCompany(
                  event
                    .target
                    .value,
                )
            }
          />
        </label>

        <label>
          <span>
            Phone
          </span>

          <input
            type="tel"
            maxLength={40}
            autoComplete="tel"
            value={
              phone
            }
            onChange={
              event =>
                setPhone(
                  event
                    .target
                    .value,
                )
            }
          />
        </label>
      </div>

      <div className="room7GuestIdentityGrid">
        <label>
          <span>
            Area of interest
          </span>

          <select
            value={
              interestType
            }
            onChange={
              event =>
                setInterestType(
                  event
                    .target
                    .value,
                )
            }
          >
            <option value="investment">
              Investment
            </option>

            <option value="partnership">
              Partnership
            </option>

            <option value="information">
              More information
            </option>

            <option value="meeting">
              Request a meeting
            </option>
          </select>
        </label>

        <label>
          <span>
            Investment range
          </span>

          <input
            type="text"
            maxLength={120}
            value={
              investmentRange
            }
            onChange={
              event =>
                setInvestmentRange(
                  event
                    .target
                    .value,
                )
            }
            placeholder="Optional"
          />
        </label>
      </div>

      <label>
        <span>
          Message
        </span>

        <textarea
          rows={4}
          maxLength={2000}
          value={
            message
          }
          onChange={
            event =>
              setMessage(
                event
                  .target
                  .value,
              )
          }
          placeholder="Tell the RideArrivo team what you would like to discuss."
        />

        <small>
          {message.length}/2000
        </small>
      </label>

      <label className="room7InvestorConsent">
        <input
          type="checkbox"
          checked={
            consent
          }
          onChange={
            event =>
              setConsent(
                event
                  .target
                  .checked,
              )
          }
        />

        <span>
          I agree that RideArrivo Limited may
          contact me using the details above
          about this request.
        </span>
      </label>

      {error && (
        <div
          className="room7GuestEngagementMessage error"
          role="alert"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          className="room7GuestEngagementMessage success"
          role="status"
        >
          {notice}
        </div>
      )}

      <button
        type="submit"
        className="room7GuestEngagementPrimary"
        disabled={
          submitting
        }
      >
        {submitting ? (
          <LoaderCircle
            size={16}
            className="room7GuestEngagementSpin"
          />
        ) : (
          <TrendingUp
            size={16}
          />
        )}

        {
          submitting
            ? 'Submitting...'
            : buttonLabel ||
              'Request investor follow-up'
        }
      </button>
    </form>
  )
}

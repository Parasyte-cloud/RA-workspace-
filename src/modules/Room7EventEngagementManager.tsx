import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  Check,
  CircleHelp,
  Handshake,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react'

import {
  supabase,
} from '../lib/supabase'

import '../room7-event-engagement.css'

type StoryPoint = {
  title: string
  description: string | null
}

type ProgrammeItem = {
  title: string
  description: string | null
  time_label: string | null
}

type EventContent = {
  story_headline: string | null
  story_body: string | null
  story_points: StoryPoint[]
  programme_items: ProgrammeItem[]
  invest_headline: string | null
  invest_body: string | null
  invest_cta_label: string | null
  qna_enabled: boolean
  investor_interest_enabled: boolean
  updated_at: string
}

type QuestionStatus =
  | 'pending'
  | 'approved'
  | 'answered'
  | 'dismissed'

type Question = {
  id: string
  display_name: string
  email: string
  question: string
  status: QuestionStatus
  answer_text: string | null
  is_pinned: boolean
  submitted_at: string
  moderated_at: string | null
  answered_at: string | null
  updated_at: string
}

type InterestStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'closed'

type InvestorInterest = {
  id: string
  display_name: string
  email: string
  company: string | null
  phone: string | null
  interest_type: string
  investment_range: string | null
  message: string | null
  contact_consent: boolean
  consent_version: string
  consent_at: string
  status: InterestStatus
  internal_notes: string | null
  submitted_at: string
  last_submitted_at: string
  updated_at: string
}

type EngagementBundle = {
  content: EventContent | null
  questions: Question[]
  investor_interest: InvestorInterest[]
}

type EngagementResponse = {
  engagement: EngagementBundle
}

type ContentResponse = {
  content: EventContent
}

type QuestionResponse = {
  question: Question
}

type InterestResponse = {
  interest: InvestorInterest
}

type Props = {
  roomId: string
  roomTitle: string
}

type ManagerTab =
  | 'experience'
  | 'questions'
  | 'investors'

type DraftStoryPoint = {
  title: string
  description: string
}

type DraftProgrammeItem = {
  title: string
  description: string
  timeLabel: string
}

type ContentDraft = {
  storyHeadline: string
  storyBody: string
  storyPoints: DraftStoryPoint[]
  programmeItems: DraftProgrammeItem[]
  investHeadline: string
  investBody: string
  investCtaLabel: string
  qnaEnabled: boolean
  investorInterestEnabled: boolean
}

function emptyDraft():
  ContentDraft {
  return {
    storyHeadline:
      '',

    storyBody:
      '',

    storyPoints:
      [],

    programmeItems:
      [],

    investHeadline:
      '',

    investBody:
      '',

    investCtaLabel:
      'Request investor follow-up',

    qnaEnabled:
      true,

    investorInterestEnabled:
      true,
  }
}

function draftFromContent(
  content:
    EventContent | null,
): ContentDraft {
  if (!content) {
    return emptyDraft()
  }

  return {
    storyHeadline:
      content
        .story_headline ||
      '',

    storyBody:
      content
        .story_body ||
      '',

    storyPoints:
      (
        content
          .story_points ||
        []
      ).map(
        point => ({
          title:
            point.title,

          description:
            point.description ||
            '',
        }),
      ),

    programmeItems:
      (
        content
          .programme_items ||
        []
      ).map(
        item => ({
          title:
            item.title,

          description:
            item.description ||
            '',

          timeLabel:
            item.time_label ||
            '',
        }),
      ),

    investHeadline:
      content
        .invest_headline ||
      '',

    investBody:
      content
        .invest_body ||
      '',

    investCtaLabel:
      content
        .invest_cta_label ||
      'Request investor follow-up',

    qnaEnabled:
      content
        .qna_enabled,

    investorInterestEnabled:
      content
        .investor_interest_enabled,
  }
}

function formatWhen(
  value:
    string | null,
) {
  if (!value) {
    return 'Not yet'
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

async function invokeControl<T>(
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
      'ROOM 7 event control is not configured.',
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
    data:
      sessionData,

    error:
      sessionError,
  } =
    await client.auth
      .getSession()

  if (
    sessionError ||
    !sessionData
      .session
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

export default function Room7EventEngagementManager({
  roomId,
  roomTitle,
}: Props) {
  const [
    tab,
    setTab,
  ] =
    useState<ManagerTab>(
      'experience',
    )

  const [
    draft,
    setDraft,
  ] =
    useState<ContentDraft>(
      emptyDraft,
    )

  const [
    questions,
    setQuestions,
  ] =
    useState<Question[]>(
      [],
    )

  const [
    interests,
    setInterests,
  ] =
    useState<
      InvestorInterest[]
    >([])

  const [
    answers,
    setAnswers,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({})

  const [
    notes,
    setNotes,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({})

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
              EngagementResponse
            >({
              action:
                'engagement_get',

              room_id:
                roomId,
            })

          setDraft(
            draftFromContent(
              response
                .engagement
                .content,
            ),
          )

          const nextQuestions =
            response
              .engagement
              .questions ||
            []

          const nextInterests =
            response
              .engagement
              .investor_interest ||
            []

          setQuestions(
            nextQuestions,
          )

          setInterests(
            nextInterests,
          )

          setAnswers(
            Object.fromEntries(
              nextQuestions.map(
                question => [
                  question.id,
                  question
                    .answer_text ||
                    '',
                ],
              ),
            ),
          )

          setNotes(
            Object.fromEntries(
              nextInterests.map(
                interest => [
                  interest.id,
                  interest
                    .internal_notes ||
                    '',
                ],
              ),
            ),
          )
        } catch (cause) {
          setError(
            cause instanceof
              Error
              ? cause.message
              : 'Unable to load ROOM 7 engagement.',
          )
        } finally {
          setBusy(
            null,
          )
        }
      },
      [
        roomId,
      ],
    )

  useEffect(
    () => {
      void load()
    },
    [
      load,
    ],
  )

  const pendingCount =
    useMemo(
      () =>
        questions
          .filter(
            question =>
              question.status ===
              'pending',
          )
          .length,
      [
        questions,
      ],
    )

  const newInterestCount =
    useMemo(
      () =>
        interests
          .filter(
            interest =>
              interest.status ===
              'new',
          )
          .length,
      [
        interests,
      ],
    )

  const saveContent =
    async (
      event:
        FormEvent,
    ) => {
      event.preventDefault()

      if (busy) {
        return
      }

      const storyPoints =
        draft
          .storyPoints
          .filter(
            point =>
              point.title
                .trim(),
          )
          .map(
            point => ({
              title:
                point.title
                  .trim(),

              description:
                point
                  .description
                  .trim() ||
                null,
            }),
          )

      const programmeItems =
        draft
          .programmeItems
          .filter(
            item =>
              item.title
                .trim(),
          )
          .map(
            item => ({
              title:
                item.title
                  .trim(),

              description:
                item
                  .description
                  .trim() ||
                null,

              time_label:
                item
                  .timeLabel
                  .trim() ||
                null,
            }),
          )

      setBusy(
        'save-content',
      )

      setError('')
      setNotice('')

      try {
        const response =
          await invokeControl<
            ContentResponse
          >({
            action:
              'engagement_save_content',

            room_id:
              roomId,

            story_headline:
              draft
                .storyHeadline
                .trim() ||
              null,

            story_body:
              draft
                .storyBody
                .trim() ||
              null,

            story_points:
              storyPoints,

            programme_items:
              programmeItems,

            invest_headline:
              draft
                .investHeadline
                .trim() ||
              null,

            invest_body:
              draft
                .investBody
                .trim() ||
              null,

            invest_cta_label:
              draft
                .investCtaLabel
                .trim() ||
              null,

            qna_enabled:
              draft
                .qnaEnabled,

            investor_interest_enabled:
              draft
                .investorInterestEnabled,
          })

        setDraft(
          draftFromContent(
            response.content,
          ),
        )

        setNotice(
          'ROOM 7 public experience saved.',
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to save ROOM 7 public experience.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  const moderateQuestion =
    async (
      question:
        Question,

      status:
        QuestionStatus,

      pinned =
        question.is_pinned,
    ) => {
      if (busy) {
        return
      }

      if (
        status ===
          'dismissed' &&
        !window.confirm(
          'Dismiss this ROOM 7 question?',
        )
      ) {
        return
      }

      const answer =
        (
          answers[
            question.id
          ] ||
          ''
        )
          .trim()

      if (
        status ===
          'answered' &&
        !answer
      ) {
        setError(
          'Enter a moderator answer before publishing the answer.',
        )

        return
      }

      setBusy(
        `question:${question.id}`,
      )

      setError('')
      setNotice('')

      try {
        const response =
          await invokeControl<
            QuestionResponse
          >({
            action:
              'engagement_moderate_question',

            room_id:
              roomId,

            question_id:
              question.id,

            status,

            answer_text:
              status ===
                'answered'
                ? answer
                : null,

            is_pinned:
              pinned,
          })

        setQuestions(
          current =>
            current.map(
              item =>
                item.id ===
                  response
                    .question
                    .id
                  ? response
                      .question
                  : item,
            ),
        )

        setAnswers(
          current => ({
            ...current,

            [
              response
                .question
                .id
            ]:
              response
                .question
                .answer_text ||
              '',
          }),
        )

        setNotice(
          `Question marked ${response.question.status}.`,
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to moderate ROOM 7 question.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  const saveInterest =
    async (
      interest:
        InvestorInterest,

      status:
        InterestStatus,
    ) => {
      if (busy) {
        return
      }

      setBusy(
        `interest:${interest.id}`,
      )

      setError('')
      setNotice('')

      try {
        const response =
          await invokeControl<
            InterestResponse
          >({
            action:
              'engagement_update_interest',

            room_id:
              roomId,

            interest_id:
              interest.id,

            status,

            internal_notes:
              (
                notes[
                  interest.id
                ] ||
                ''
              )
                .trim() ||
              null,
          })

        setInterests(
          current =>
            current.map(
              item =>
                item.id ===
                  response
                    .interest
                    .id
                  ? response
                      .interest
                  : item,
            ),
        )

        setNotes(
          current => ({
            ...current,

            [
              response
                .interest
                .id
            ]:
              response
                .interest
                .internal_notes ||
              '',
          }),
        )

        setNotice(
          'Investor follow-up record saved.',
        )
      } catch (cause) {
        setError(
          cause instanceof
            Error
            ? cause.message
            : 'Unable to update investor follow-up.',
        )
      } finally {
        setBusy(
          null,
        )
      }
    }

  return (
    <div className="room7EngagementManager">
      <header className="room7EngagementManagerHeader">
        <div>
          <span className="room7EngagementEyebrow">
            ROOM 7 EXPERIENCE
          </span>

          <h3>
            {roomTitle}
          </h3>

          <p>
            Manage public event content,
            moderated questions and
            investor follow-up.
          </p>
        </div>

        <button
          type="button"
          className="secondaryButton"
          disabled={
            busy !==
            null
          }
          onClick={() =>
            void load()
          }
        >
          <RefreshCw
            size={15}
          />

          Refresh
        </button>
      </header>

      <nav
        className="room7EngagementManagerTabs"
        aria-label="ROOM 7 engagement controls"
      >
        <button
          type="button"
          className={
            tab ===
              'experience'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab(
              'experience',
            )
          }
        >
          Experience
        </button>

        <button
          type="button"
          className={
            tab ===
              'questions'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab(
              'questions',
            )
          }
        >
          Questions

          {pendingCount >
            0 && (
            <span>
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className={
            tab ===
              'investors'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab(
              'investors',
            )
          }
        >
          Investor follow-up

          {newInterestCount >
            0 && (
            <span>
              {newInterestCount}
            </span>
          )}
        </button>
      </nav>

      {(error ||
        notice) && (
        <div
          className={
            error
              ? 'room7EngagementMessage error'
              : 'room7EngagementMessage success'
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

      {busy ===
        'load' && (
        <div className="room7EngagementLoading">
          <RefreshCw
            size={18}
          />

          Loading ROOM 7 engagement...
        </div>
      )}

      {tab ===
        'experience' && (
        <form
          className="room7EngagementExperience"
          onSubmit={
            saveContent
          }
        >
          <section className="room7EngagementEditorCard">
            <div className="room7EngagementEditorHeading">
              <div>
                <span>
                  STORY
                </span>

                <strong>
                  Public event story
                </strong>
              </div>
            </div>

            <label>
              <span>
                Headline
              </span>

              <input
                type="text"
                maxLength={180}
                value={
                  draft
                    .storyHeadline
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        storyHeadline:
                          event
                            .target
                            .value,
                      }),
                    )
                }
                placeholder="Tell guests what RideArrivo is building."
              />
            </label>

            <label>
              <span>
                Story
              </span>

              <textarea
                rows={6}
                maxLength={5000}
                value={
                  draft
                    .storyBody
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        storyBody:
                          event
                            .target
                            .value,
                      }),
                    )
                }
                placeholder="Public narrative for this ROOM 7 event."
              />
            </label>

            <div className="room7EngagementRepeaterHeader">
              <strong>
                Story points
              </strong>

              <button
                type="button"
                className="secondaryButton"
                disabled={
                  draft
                    .storyPoints
                    .length >=
                  6
                }
                onClick={() =>
                  setDraft(
                    current => ({
                      ...current,

                      storyPoints: [
                        ...current
                          .storyPoints,

                        {
                          title:
                            '',

                          description:
                            '',
                        },
                      ],
                    }),
                  )
                }
              >
                <Plus
                  size={14}
                />

                Add point
              </button>
            </div>

            <div className="room7EngagementRepeater">
              {draft
                .storyPoints
                .map(
                  (
                    point,
                    index,
                  ) => (
                    <article
                      key={
                        `story-${index}`
                      }
                    >
                      <span className="room7EngagementItemNumber">
                        {index + 1}
                      </span>

                      <div>
                        <input
                          type="text"
                          maxLength={80}
                          value={
                            point.title
                          }
                          placeholder="Point title"
                          onChange={
                            event =>
                              setDraft(
                                current => ({
                                  ...current,

                                  storyPoints:
                                    current
                                      .storyPoints
                                      .map(
                                        (
                                          item,
                                          itemIndex,
                                        ) =>
                                          itemIndex ===
                                          index
                                            ? {
                                                ...item,

                                                title:
                                                  event
                                                    .target
                                                    .value,
                                              }
                                            : item,
                                      ),
                                }),
                              )
                          }
                        />

                        <textarea
                          rows={2}
                          maxLength={500}
                          value={
                            point
                              .description
                          }
                          placeholder="Short explanation"
                          onChange={
                            event =>
                              setDraft(
                                current => ({
                                  ...current,

                                  storyPoints:
                                    current
                                      .storyPoints
                                      .map(
                                        (
                                          item,
                                          itemIndex,
                                        ) =>
                                          itemIndex ===
                                          index
                                            ? {
                                                ...item,

                                                description:
                                                  event
                                                    .target
                                                    .value,
                                              }
                                            : item,
                                      ),
                                }),
                              )
                          }
                        />
                      </div>

                      <button
                        type="button"
                        className="iconButton"
                        aria-label="Remove Story point"
                        onClick={() =>
                          setDraft(
                            current => ({
                              ...current,

                              storyPoints:
                                current
                                  .storyPoints
                                  .filter(
                                    (
                                      _,
                                      itemIndex,
                                    ) =>
                                      itemIndex !==
                                      index,
                                  ),
                            }),
                          )
                        }
                      >
                        <Trash2
                          size={14}
                        />
                      </button>
                    </article>
                  ),
                )}
            </div>
          </section>

          <section className="room7EngagementEditorCard">
            <div className="room7EngagementEditorHeading">
              <div>
                <span>
                  PROGRAMME
                </span>

                <strong>
                  Event programme
                </strong>
              </div>

              <button
                type="button"
                className="secondaryButton"
                disabled={
                  draft
                    .programmeItems
                    .length >=
                  12
                }
                onClick={() =>
                  setDraft(
                    current => ({
                      ...current,

                      programmeItems: [
                        ...current
                          .programmeItems,

                        {
                          title:
                            '',

                          description:
                            '',

                          timeLabel:
                            '',
                        },
                      ],
                    }),
                  )
                }
              >
                <Plus
                  size={14}
                />

                Add item
              </button>
            </div>

            <div className="room7ProgrammeEditor">
              {draft
                .programmeItems
                .map(
                  (
                    item,
                    index,
                  ) => (
                    <article
                      key={
                        `programme-${index}`
                      }
                    >
                      <span className="room7EngagementItemNumber">
                        {index + 1}
                      </span>

                      <div>
                        <input
                          type="text"
                          maxLength={80}
                          value={
                            item
                              .timeLabel
                          }
                          placeholder="Time, e.g. 5:30 PM"
                          onChange={
                            event =>
                              setDraft(
                                current => ({
                                  ...current,

                                  programmeItems:
                                    current
                                      .programmeItems
                                      .map(
                                        (
                                          existing,
                                          itemIndex,
                                        ) =>
                                          itemIndex ===
                                          index
                                            ? {
                                                ...existing,

                                                timeLabel:
                                                  event
                                                    .target
                                                    .value,
                                              }
                                            : existing,
                                      ),
                                }),
                              )
                          }
                        />

                        <input
                          type="text"
                          maxLength={180}
                          value={
                            item.title
                          }
                          placeholder="Programme item"
                          onChange={
                            event =>
                              setDraft(
                                current => ({
                                  ...current,

                                  programmeItems:
                                    current
                                      .programmeItems
                                      .map(
                                        (
                                          existing,
                                          itemIndex,
                                        ) =>
                                          itemIndex ===
                                          index
                                            ? {
                                                ...existing,

                                                title:
                                                  event
                                                    .target
                                                    .value,
                                              }
                                            : existing,
                                      ),
                                }),
                              )
                          }
                        />

                        <textarea
                          rows={2}
                          maxLength={1000}
                          value={
                            item
                              .description
                          }
                          placeholder="Programme description"
                          onChange={
                            event =>
                              setDraft(
                                current => ({
                                  ...current,

                                  programmeItems:
                                    current
                                      .programmeItems
                                      .map(
                                        (
                                          existing,
                                          itemIndex,
                                        ) =>
                                          itemIndex ===
                                          index
                                            ? {
                                                ...existing,

                                                description:
                                                  event
                                                    .target
                                                    .value,
                                              }
                                            : existing,
                                      ),
                                }),
                              )
                          }
                        />
                      </div>

                      <button
                        type="button"
                        className="iconButton"
                        aria-label="Remove programme item"
                        onClick={() =>
                          setDraft(
                            current => ({
                              ...current,

                              programmeItems:
                                current
                                  .programmeItems
                                  .filter(
                                    (
                                      _,
                                      itemIndex,
                                    ) =>
                                      itemIndex !==
                                      index,
                                  ),
                            }),
                          )
                        }
                      >
                        <Trash2
                          size={14}
                        />
                      </button>
                    </article>
                  ),
                )}
            </div>
          </section>

          <section className="room7EngagementEditorCard">
            <div className="room7EngagementEditorHeading">
              <div>
                <span>
                  INVEST
                </span>

                <strong>
                  Investor experience
                </strong>
              </div>
            </div>

            <label>
              <span>
                Headline
              </span>

              <input
                type="text"
                maxLength={180}
                value={
                  draft
                    .investHeadline
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        investHeadline:
                          event
                            .target
                            .value,
                      }),
                    )
                }
              />
            </label>

            <label>
              <span>
                Investor message
              </span>

              <textarea
                rows={6}
                maxLength={5000}
                value={
                  draft
                    .investBody
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        investBody:
                          event
                            .target
                            .value,
                      }),
                    )
                }
              />
            </label>

            <label>
              <span>
                Follow-up button label
              </span>

              <input
                type="text"
                maxLength={80}
                value={
                  draft
                    .investCtaLabel
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        investCtaLabel:
                          event
                            .target
                            .value,
                      }),
                    )
                }
              />
            </label>
          </section>

          <section className="room7EngagementFeatureControls">
            <label>
              <input
                type="checkbox"
                checked={
                  draft
                    .qnaEnabled
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        qnaEnabled:
                          event
                            .target
                            .checked,
                      }),
                    )
                }
              />

              <span>
                <strong>
                  Moderated Q&A
                </strong>

                <small>
                  Guests can submit questions
                  only during Live and
                  Intermission.
                </small>
              </span>
            </label>

            <label>
              <input
                type="checkbox"
                checked={
                  draft
                    .investorInterestEnabled
                }
                onChange={
                  event =>
                    setDraft(
                      current => ({
                        ...current,

                        investorInterestEnabled:
                          event
                            .target
                            .checked,
                      }),
                    )
                }
              />

              <span>
                <strong>
                  Investor follow-up
                </strong>

                <small>
                  Accept explicit stakeholder
                  contact requests separately
                  from event analytics.
                </small>
              </span>
            </label>
          </section>

          <div className="room7EngagementSaveBar">
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
                  'save-content'
                  ? 'Saving...'
                  : 'Save public experience'
              }
            </button>
          </div>
        </form>
      )}

      {tab ===
        'questions' && (
        <section className="room7QuestionModeration">
          <div className="room7EngagementSectionIntro">
            <MessageSquareText
              size={22}
            />

            <div>
              <strong>
                Moderated Q&A
              </strong>

              <p>
                Guest identity is visible to
                moderators only. Public guests
                see approved question text and
                published answers, not contact
                details.
              </p>
            </div>
          </div>

          {questions.length ===
            0 ? (
            <div className="room7EngagementEmpty">
              <CircleHelp
                size={28}
              />

              <strong>
                No guest questions yet
              </strong>
            </div>
          ) : (
            <div className="room7QuestionList">
              {questions.map(
                question => (
                  <article
                    key={
                      question.id
                    }
                    className={
                      `room7QuestionCard status-${question.status}`
                    }
                  >
                    <header>
                      <div>
                        <strong>
                          {
                            question
                              .display_name
                          }
                        </strong>

                        <span>
                          {
                            question
                              .email
                          }
                        </span>
                      </div>

                      <div className="room7QuestionStatus">
                        {question
                          .is_pinned && (
                          <Star
                            size={14}
                          />
                        )}

                        <span>
                          {
                            question
                              .status
                          }
                        </span>
                      </div>
                    </header>

                    <p className="room7QuestionText">
                      {
                        question
                          .question
                      }
                    </p>

                    <small>
                      Submitted {
                        formatWhen(
                          question
                            .submitted_at,
                        )
                      }
                    </small>

                    <textarea
                      rows={3}
                      maxLength={2000}
                      placeholder="Moderator answer"
                      value={
                        answers[
                          question.id
                        ] ||
                        ''
                      }
                      onChange={
                        event =>
                          setAnswers(
                            current => ({
                              ...current,

                              [
                                question.id
                              ]:
                                event
                                  .target
                                  .value,
                            }),
                          )
                      }
                    />

                    <div className="room7QuestionActions">
                      <button
                        type="button"
                        className="secondaryButton"
                        disabled={
                          busy !==
                          null
                        }
                        onClick={() =>
                          void moderateQuestion(
                            question,
                            'approved',
                          )
                        }
                      >
                        <Check
                          size={14}
                        />

                        Approve
                      </button>

                      <button
                        type="button"
                        className="primaryButton"
                        disabled={
                          busy !==
                          null
                        }
                        onClick={() =>
                          void moderateQuestion(
                            question,
                            'answered',
                          )
                        }
                      >
                        <MessageSquareText
                          size={14}
                        />

                        Publish answer
                      </button>

                      {(question.status ===
                          'approved' ||
                        question.status ===
                          'answered') && (
                        <button
                          type="button"
                          className="secondaryButton"
                          disabled={
                            busy !==
                            null
                          }
                          onClick={() =>
                            void moderateQuestion(
                              question,
                              question.status,
                              !question
                                .is_pinned,
                            )
                          }
                        >
                          <Star
                            size={14}
                          />

                          {
                            question
                              .is_pinned
                              ? 'Unpin'
                              : 'Pin'
                          }
                        </button>
                      )}

                      <button
                        type="button"
                        className="secondaryButton room7DangerButton"
                        disabled={
                          busy !==
                          null
                        }
                        onClick={() =>
                          void moderateQuestion(
                            question,
                            'dismissed',
                            false,
                          )
                        }
                      >
                        <X
                          size={14}
                        />

                        Dismiss
                      </button>
                    </div>
                  </article>
                ),
              )}
            </div>
          )}
        </section>
      )}

      {tab ===
        'investors' && (
        <section className="room7InvestorManager">
          <div className="room7EngagementSectionIntro">
            <Handshake
              size={22}
            />

            <div>
              <strong>
                Investor & stakeholder
                follow-up
              </strong>

              <p>
                These explicit contact requests
                remain separate from ROOM 7
                attendance and event analytics.
              </p>
            </div>
          </div>

          {interests.length ===
            0 ? (
            <div className="room7EngagementEmpty">
              <Handshake
                size={28}
              />

              <strong>
                No follow-up requests yet
              </strong>
            </div>
          ) : (
            <div className="room7InvestorList">
              {interests.map(
                interest => (
                  <article
                    key={
                      interest.id
                    }
                    className="room7InvestorRecord"
                  >
                    <header>
                      <div>
                        <strong>
                          {
                            interest
                              .display_name
                          }
                        </strong>

                        <span>
                          {
                            interest
                              .company ||
                            'Independent stakeholder'
                          }
                        </span>
                      </div>

                      <span
                        className={
                          `room7InvestorStatus status-${interest.status}`
                        }
                      >
                        {
                          interest
                            .status
                        }
                      </span>
                    </header>

                    <div className="room7InvestorContactGrid">
                      <div>
                        <span>
                          Email
                        </span>

                        <strong>
                          {
                            interest
                              .email
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          Phone
                        </span>

                        <strong>
                          {
                            interest
                              .phone ||
                            'Not provided'
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          Interest
                        </span>

                        <strong>
                          {
                            interest
                              .interest_type
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          Investment range
                        </span>

                        <strong>
                          {
                            interest
                              .investment_range ||
                            'Not specified'
                          }
                        </strong>
                      </div>
                    </div>

                    {interest
                      .message && (
                      <p className="room7InvestorMessage">
                        {
                          interest
                            .message
                        }
                      </p>
                    )}

                    <small>
                      Contact consent recorded {
                        formatWhen(
                          interest
                            .consent_at,
                        )
                      }
                    </small>

                    <label>
                      <span>
                        Internal follow-up notes
                      </span>

                      <textarea
                        rows={3}
                        maxLength={5000}
                        value={
                          notes[
                            interest.id
                          ] ||
                          ''
                        }
                        onChange={
                          event =>
                            setNotes(
                              current => ({
                                ...current,

                                [
                                  interest.id
                                ]:
                                  event
                                    .target
                                    .value,
                              }),
                            )
                        }
                      />
                    </label>

                    <div className="room7InvestorActions">
                      <select
                        value={
                          interest
                            .status
                        }
                        disabled={
                          busy !==
                          null
                        }
                        aria-label="Investor follow-up status"
                        onChange={
                          event =>
                            void saveInterest(
                              interest,
                              event
                                .target
                                .value as
                                InterestStatus,
                            )
                        }
                      >
                        <option value="new">
                          New
                        </option>

                        <option value="contacted">
                          Contacted
                        </option>

                        <option value="qualified">
                          Qualified
                        </option>

                        <option value="closed">
                          Closed
                        </option>
                      </select>

                      <button
                        type="button"
                        className="primaryButton"
                        disabled={
                          busy !==
                          null
                        }
                        onClick={() =>
                          void saveInterest(
                            interest,
                            interest.status,
                          )
                        }
                      >
                        <Save
                          size={14}
                        />

                        Save notes
                      </button>
                    </div>
                  </article>
                ),
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

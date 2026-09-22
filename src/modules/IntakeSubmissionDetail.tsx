import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  RefreshCw,
  X,
} from 'lucide-react'
import {
  INTAKE_STATUS_LABELS,
  getIntakeSubmission,
  listIntakeSubmissionEvents,
  updateIntakeSubmissionStatus,
} from '../lib/intake'
import IntakeAssignmentControls from './IntakeAssignmentControls'
import type {
  IntakeStatus,
  IntakeSubmission,
  IntakeSubmissionEvent,
} from '../lib/intake'

type Props = {
  submissionId: string
  onClose: () => void
  onChanged?: () =>
    void | Promise<void>
}

function when(
  value:
    string | null | undefined,
) {
  if (!value) {
    return '—'
  }

  const date =
    new Date(value)

  return Number.isNaN(
    date.getTime(),
  )
    ? value
    : date.toLocaleString()
}

function humanize(
  value: string,
) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(
      /\b\w/g,
      letter =>
        letter.toUpperCase(),
    )
}

function statusLabel(
  value: unknown,
) {
  if (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(
      INTAKE_STATUS_LABELS,
      value,
    )
  ) {
    return INTAKE_STATUS_LABELS[
      value as IntakeStatus
    ]
  }

  return value
    ? humanize(String(value))
    : '—'
}

function shortId(
  value: unknown,
) {
  const text =
    String(value || '').trim()

  if (!text) {
    return '—'
  }

  return text.length > 12
    ? `${text.slice(0, 8)}…`
    : text
}

function formatValue(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '—'
  }

  if (
    typeof value === 'boolean'
  ) {
    return value ? 'Yes' : 'No'
  }

  if (
    Array.isArray(value)
  ) {
    return value.length
      ? value
          .map(item =>
            typeof item === 'object'
              ? JSON.stringify(item)
              : String(item),
          )
          .join(', ')
      : '—'
  }

  if (
    typeof value === 'object'
  ) {
    try {
      return (
        JSON.stringify(
          value,
          null,
          2,
        ) || '—'
      )
    } catch {
      return String(value)
    }
  }

  const text =
    String(value)

  return text || '—'
}

function eventTitle(
  event:
    IntakeSubmissionEvent,
) {
  switch (
    event.event_type
  ) {
    case 'created':
      return 'Submission created'
    case 'status_changed':
      return 'Status changed'
    case 'assigned':
      return 'Submission assigned'
    case 'reassigned':
      return 'Submission reassigned'
    default:
      return humanize(
        event.event_type,
      )
  }
}

function eventDetail(
  event:
    IntakeSubmissionEvent,
) {
  const metadata =
    event.metadata || {}

  if (
    event.event_type ===
    'status_changed'
  ) {
    return `${statusLabel(
      metadata.from,
    )} → ${statusLabel(
      metadata.to,
    )}`
  }

  if (
    event.event_type ===
      'assigned' ||
    event.event_type ===
      'reassigned'
  ) {
    return `${shortId(
      metadata.from,
    )} → ${shortId(
      metadata.to,
    )}`
  }

  if (
    event.event_type ===
    'created'
  ) {
    const parts = [
      metadata.status
        ? `Status: ${statusLabel(
            metadata.status,
          )}`
        : '',
      metadata.source
        ? `Source: ${humanize(
            String(
              metadata.source,
            ),
          )}`
        : '',
      metadata.workstation
        ? `Route: ${String(
            metadata.workstation,
          )}`
        : '',
    ].filter(Boolean)

    return parts.join(' · ')
  }

  return ''
}

export default function IntakeSubmissionDetail({
  submissionId,
  onClose,
  onChanged,
}: Props) {
  const [
    submission,
    setSubmission,
  ] =
    useState<
      IntakeSubmission | null
    >(null)

  const [
    events,
    setEvents,
  ] =
    useState<
      IntakeSubmissionEvent[]
    >([])

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    saving,
    setSaving,
  ] = useState(false)

  const [
    message,
    setMessage,
  ] = useState('')

  const load =
    useCallback(
      async () => {
        setLoading(true)
        setMessage('')

        try {
          const [
            nextSubmission,
            nextEvents,
          ] =
            await Promise.all([
              getIntakeSubmission(
                submissionId,
              ),
              listIntakeSubmissionEvents(
                submissionId,
              ),
            ])

          if (
            !nextSubmission
          ) {
            throw new Error(
              'This submission is no longer available to your workstation.',
            )
          }

          setSubmission(
            nextSubmission,
          )

          setEvents(
            nextEvents,
          )
        } catch (
          error: any
        ) {
          setMessage(
            error?.message ||
              'Unable to load this submission.',
          )
        } finally {
          setLoading(false)
        }
      },
      [submissionId],
    )

  useEffect(() => {
    void load()
  }, [load])

  const responses =
    useMemo(
      () =>
        Object.entries(
          submission?.payload ||
            {},
        ),
      [submission],
    )

  const changeStatus =
    async (
      nextStatus:
        IntakeStatus,
    ) => {
      if (
        !submission ||
        submission.status ===
          nextStatus
      ) {
        return
      }

      setSaving(true)
      setMessage('')

      try {
        const updated =
          await updateIntakeSubmissionStatus(
            submission.id,
            nextStatus,
          )

        setSubmission(
          updated,
        )

        const nextEvents =
          await listIntakeSubmissionEvents(
            submission.id,
          )

        setEvents(
          nextEvents,
        )

        await onChanged?.()
      } catch (
        error: any
      ) {
        setMessage(
          error?.message ||
            'Unable to update submission status.',
        )
      } finally {
        setSaving(false)
      }
    }

  return (
    <div
      className="intakeDetailBackdrop"
      onMouseDown={
        event => {
          if (
            event.target ===
            event.currentTarget
          ) {
            onClose()
          }
        }
      }
    >
      <section
        className="intakeDetailPanel"
        role="dialog"
        aria-modal="true"
        aria-label="Submission detail"
      >
        <div className="intakeDetailHeader">
          <div>
            <span className="eyebrow">
              SUBMISSION DETAIL
            </span>

            <h3>
              {submission
                ?.form_title_snapshot ||
                'Submission'}
            </h3>

            {submission && (
              <p>
                {
                  submission.category_title_snapshot
                }
              </p>
            )}
          </div>

          <div className="intakeDetailHeaderActions">
            <button
              type="button"
              className="glassButton"
              onClick={() =>
                void load()
              }
              disabled={
                loading ||
                saving
              }
            >
              <RefreshCw
                size={15}
              />
              Refresh
            </button>

            <button
              type="button"
              className="glassButton"
              onClick={
                onClose
              }
              aria-label="Close submission detail"
            >
              <X size={16} />
              Close
            </button>
          </div>
        </div>

        {message && (
          <div
            className="moduleNotice intakeDetailNotice"
            role="alert"
          >
            {message}
          </div>
        )}

        {loading ? (
          <div className="intakeInboxEmpty">
            Loading submission…
          </div>
        ) : submission ? (
          <>
            <div className="intakeDetailIdentity">
              <span
                className={`intakeStatusPill ${submission.status.replace(
                  /_/g,
                  '-',
                )}`}
              >
                {
                  INTAKE_STATUS_LABELS[
                    submission.status
                  ]
                }
              </span>

              <span>
                Ref:{' '}
                {
                  submission.source_reference ||
                  '—'
                }
              </span>
            </div>

            <section className="intakeDetailSection">
              <div className="intakeDetailSectionHeading">
                <div>
                  <span className="eyebrow">
                    WORKFLOW
                  </span>

                  <h4>
                    Status
                  </h4>
                </div>

                <span className="intakeDetailSaving">
                  {saving
                    ? 'Saving…'
                    : 'Changes are audited automatically'}
                </span>
              </div>

              <div className="intakeDetailWorkflow">
                {(
                  Object.entries(
                    INTAKE_STATUS_LABELS,
                  ) as Array<
                    [
                      IntakeStatus,
                      string,
                    ]
                  >
                ).map(
                  ([
                    value,
                    label,
                  ]) => (
                    <button
                      type="button"
                      key={
                        value
                      }
                      className={
                        submission.status ===
                        value
                          ? 'active'
                          : ''
                      }
                      disabled={
                        saving ||
                        submission.status ===
                          value
                      }
                      aria-current={
                        submission.status ===
                        value
                          ? 'step'
                          : undefined
                      }
                      onClick={() =>
                        void changeStatus(
                          value,
                        )
                      }
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </section>

            <section className="intakeDetailSection">
              <span className="eyebrow">
                SUBMISSION
              </span>

              <h4>
                Routing & timestamps
              </h4>

              {submission && (

                <IntakeAssignmentControls

                  submission={submission}

                  onChanged={async () => {

                    await load()

                    await onChanged?.()

                  }}

                />

              )}


              <div className="intakeDetailFacts">
                <div>
                  <span>
                    Source
                  </span>
                  <strong>
                    {humanize(
                      submission.source,
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    Workstation
                  </span>
                  <strong>
                    {
                      submission.destination_workstation
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    Assignment
                  </span>
                  <strong>
                    {submission.assigned_employee_id
                      ? `Assigned · ${shortId(
                          submission.assigned_employee_id,
                        )}`
                      : 'Unassigned'}
                  </strong>
                </div>

                <div>
                  <span>
                    WhatsApp
                  </span>
                  <strong>
                    {submission.whatsapp_conversation_id
                      ? `Linked · ${shortId(
                          submission.whatsapp_conversation_id,
                        )}`
                      : 'Not linked'}
                  </strong>
                </div>

                <div>
                  <span>
                    Submitted
                  </span>
                  <strong>
                    {when(
                      submission.submitted_at,
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    Updated
                  </span>
                  <strong>
                    {when(
                      submission.updated_at,
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    First followed up
                  </span>
                  <strong>
                    {when(
                      submission.followed_up_at,
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    First resolved
                  </span>
                  <strong>
                    {when(
                      submission.resolved_at,
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    First closed
                  </span>
                  <strong>
                    {when(
                      submission.closed_at,
                    )}
                  </strong>
                </div>
              </div>
            </section>

            <section className="intakeDetailSection">
              <span className="eyebrow">
                FORM RESPONSE
              </span>

              <h4>
                Submitted information
              </h4>

              {responses.length ? (
                <dl className="intakeDetailResponses">
                  {responses.map(
                    ([
                      key,
                      value,
                    ]) => (
                      <div
                        key={
                          key
                        }
                        className="intakeDetailResponse"
                      >
                        <dt>
                          {humanize(
                            key,
                          )}
                        </dt>

                        <dd>
                          {formatValue(
                            value,
                          )}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : (
                <p className="intakeDetailMuted">
                  No submitted fields are available.
                </p>
              )}
            </section>

            <section className="intakeDetailSection">
              <div className="intakeDetailSectionHeading">
                <div>
                  <span className="eyebrow">
                    AUDIT HISTORY
                  </span>

                  <h4>
                    Activity timeline
                  </h4>
                </div>

                <span className="intakeDetailSaving">
                  {events.length}{' '}
                  {events.length === 1
                    ? 'event'
                    : 'events'}
                </span>
              </div>

              {events.length ? (
                <div className="intakeDetailTimeline">
                  {events.map(
                    event => (
                      <article
                        key={
                          event.id
                        }
                        className="intakeDetailEvent"
                      >
                        <div>
                          <strong>
                            {eventTitle(
                              event,
                            )}
                          </strong>

                          {eventDetail(
                            event,
                          ) && (
                            <p>
                              {eventDetail(
                                event,
                              )}
                            </p>
                          )}
                        </div>

                        <div className="intakeDetailEventMeta">
                          <span>
                            {when(
                              event.created_at,
                            )}
                          </span>

                          <span>
                            {event.actor_user_id
                              ? `Actor ${shortId(
                                  event.actor_user_id,
                                )}`
                              : 'System/service'}
                          </span>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              ) : (
                <p className="intakeDetailMuted">
                  No audit events are available.
                </p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </div>
  )
}

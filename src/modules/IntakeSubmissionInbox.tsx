import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Inbox,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  INTAKE_STATUS_LABELS,
  listIntakeCategories,
  listIntakeSubmissions,
  subscribeToIntakeWorkstation,
} from '../lib/intake'
import type {
  IntakeCategory,
  IntakeStatus,
  IntakeSubmission,
} from '../lib/intake'
import IntakeSubmissionDetail from './IntakeSubmissionDetail'
import '../intake-workspace.css'

type Props = {
  workstation: string
  title?: string
  description?: string
}

type StatusFilter =
  | 'all'
  | IntakeStatus

function when(
  value: string | null | undefined,
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

function previewValue(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return ''
  }

  if (
    Array.isArray(value)
  ) {
    return value
      .map(item => String(item))
      .join(', ')
  }

  if (
    typeof value === 'boolean'
  ) {
    return value ? 'Yes' : 'No'
  }

  if (
    typeof value === 'object'
  ) {
    return JSON.stringify(value)
  }

  return String(value)
}

function payloadPreview(
  payload:
    Record<string, unknown>,
) {
  const entries =
    Object.entries(payload)
      .map(([key, value]) => [
        key,
        previewValue(value),
      ] as const)
      .filter(
        ([, value]) =>
          Boolean(value),
      )
      .slice(0, 3)

  if (!entries.length) {
    return 'No response preview available.'
  }

  return entries
    .map(
      ([key, value]) =>
        `${humanize(key)}: ${value}`,
    )
    .join(' · ')
}

export default function IntakeSubmissionInbox({
  workstation,
  title =
    'Submission Inbox',
  description =
    'New form submissions routed to this workstation appear here automatically.',
}: Props) {
  const [
    categories,
    setCategories,
  ] =
    useState<IntakeCategory[]>(
      [],
    )

  const [
    submissions,
    setSubmissions,
  ] =
    useState<
      IntakeSubmission[]
    >([])

  const [
    categoryId,
    setCategoryId,
  ] = useState('')

  const [
    status,
    setStatus,
  ] =
    useState<StatusFilter>(
      'all',
    )

  const [
    searchDraft,
    setSearchDraft,
  ] = useState('')

  const [
    search,
    setSearch,
  ] = useState('')

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    refreshing,
    setRefreshing,
  ] = useState(false)

  const [
    message,
    setMessage,
  ] = useState('')

  const [
    selectedSubmissionId,
    setSelectedSubmissionId,
  ] = useState<string | null>(
    null,
  )

  const load =
    useCallback(
      async (
        background = false,
      ) => {
        if (
          !workstation.trim()
        ) {
          setSubmissions([])
          setCategories([])
          setLoading(false)
          setRefreshing(false)
          return
        }

        if (background) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        setMessage('')

        try {
          const [
            nextCategories,
            nextSubmissions,
          ] =
            await Promise.all([
              listIntakeCategories(),
              listIntakeSubmissions({
                workstation:
                  workstation.trim(),
                categoryId:
                  categoryId ||
                  undefined,
                statuses:
                  status === 'all'
                    ? undefined
                    : [status],
                query:
                  search ||
                  undefined,
                limit: 250,
              }),
            ])

          setCategories(
            nextCategories,
          )

          setSubmissions(
            nextSubmissions,
          )
        } catch (
          error: any
        ) {
          setMessage(
            error?.message ||
              'Unable to load the submission inbox.',
          )
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      },
      [
        workstation,
        categoryId,
        status,
        search,
      ],
    )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (
      !workstation.trim()
    ) {
      return
    }

    return subscribeToIntakeWorkstation(
      workstation,
      () => load(true),
    )
  }, [
    workstation,
    load,
  ])

  const visibleCategories =
    useMemo(() => {
      const rowCategoryIds =
        new Set(
          submissions.map(
            submission =>
              submission.category_id,
          ),
        )

      return categories.filter(
        category =>
          category.default_workstation ===
            workstation ||
          rowCategoryIds.has(
            category.id,
          ) ||
          category.id ===
            categoryId,
      )
    }, [
      categories,
      submissions,
      workstation,
      categoryId,
    ])

  const statusCounts =
    useMemo(() => {
      const counts:
        Record<
          IntakeStatus,
          number
        > = {
          new: 0,
          in_progress: 0,
          followed_up: 0,
          resolved: 0,
          closed: 0,
        }

      submissions.forEach(
        submission => {
          counts[
            submission.status
          ] += 1
        },
      )

      return counts
    }, [submissions])

  const submitSearch = (
    event:
      React.FormEvent,
  ) => {
    event.preventDefault()

    const next =
      searchDraft.trim()

    if (next === search) {
      void load()
      return
    }

    setSearch(next)
  }

  const clearFilters = () => {
    setCategoryId('')
    setStatus('all')
    setSearchDraft('')
    setSearch('')
  }

  return (
    <section
      className="glassCard intakeInbox"
      aria-busy={
        loading ||
        refreshing
      }
    >
      <div className="intakeInboxHeader">
        <div>
          <span className="eyebrow">
            ROUTED INTAKE
          </span>

          <h3>
            {title}
          </h3>

          <p>
            {description}
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          onClick={() =>
            void load()
          }
          disabled={
            loading ||
            refreshing
          }
        >
          <RefreshCw
            size={15}
            className={
              refreshing
                ? 'intakeRefreshSpin'
                : ''
            }
          />
          Refresh
        </button>
      </div>

      <div className="intakeLiveState">
        <span
          className="intakeLiveDot"
          aria-hidden="true"
        />
        Live routing enabled
        <span>
          · {workstation}
        </span>
      </div>

      <form
        className="intakeInboxToolbar"
        onSubmit={
          submitSearch
        }
      >
        <label className="intakeSearch">
          <Search
            size={16}
            aria-hidden="true"
          />

          <input
            value={
              searchDraft
            }
            onChange={
              event =>
                setSearchDraft(
                  event.target.value,
                )
            }
            placeholder="Search submissions"
            aria-label="Search submissions"
          />
        </label>

        <select
          value={
            categoryId
          }
          onChange={
            event =>
              setCategoryId(
                event.target.value,
              )
          }
          aria-label="Filter by category"
        >
          <option value="">
            All categories
          </option>

          {visibleCategories.map(
            category => (
              <option
                key={
                  category.id
                }
                value={
                  category.id
                }
              >
                {
                  category.title
                }
              </option>
            ),
          )}
        </select>

        <select
          value={status}
          onChange={
            event =>
              setStatus(
                event.target
                  .value as
                  StatusFilter,
              )
          }
          aria-label="Filter by status"
        >
          <option value="all">
            All statuses
          </option>

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
              <option
                key={
                  value
                }
                value={
                  value
                }
              >
                {label}
              </option>
            ),
          )}
        </select>

        <button
          type="submit"
          className="glassButton"
        >
          Search
        </button>

        {(categoryId ||
          status !== 'all' ||
          search) && (
          <button
            type="button"
            className="glassButton"
            onClick={
              clearFilters
            }
          >
            Clear
          </button>
        )}
      </form>

      <div className="intakeStatusSummary">
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
              key={value}
              className={
                status === value
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setStatus(
                  current =>
                    current ===
                    value
                      ? 'all'
                      : value,
                )
              }
            >
              <span>
                {label}
              </span>
              <strong>
                {
                  statusCounts[
                    value
                  ]
                }
              </strong>
            </button>
          ),
        )}
      </div>

      {message && (
        <div
          className="moduleNotice intakeInboxNotice"
          role="alert"
        >
          {message}
        </div>
      )}

      {loading ? (
        <div className="intakeInboxEmpty">
          Loading submissions…
        </div>
      ) : submissions.length ===
        0 ? (
        <div className="intakeInboxEmpty">
          <Inbox
            size={28}
            aria-hidden="true"
          />
          <strong>
            No matching submissions
          </strong>
          <span>
            New routed submissions
            will appear here
            automatically.
          </span>
        </div>
      ) : (
        <div className="intakeSubmissionList">
          {submissions.map(
            submission => (
              <article
                key={
                  submission.id
                }
                className="intakeSubmissionCard"
              >
                <div className="intakeSubmissionTop">
                  <div>
                    <span className="intakeCategoryLabel">
                      {
                        submission.category_title_snapshot
                      }
                    </span>

                    <h4>
                      {
                        submission.form_title_snapshot
                      }
                    </h4>
                  </div>

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
                </div>

                <p className="intakeSubmissionPreview">
                  {payloadPreview(
                    submission.payload,
                  )}
                </p>

                <div className="intakeSubmissionMeta">
                  <span>
                    Submitted{' '}
                    {when(
                      submission.submitted_at,
                    )}
                  </span>

                  <span>
                    Updated{' '}
                    {when(
                      submission.updated_at,
                    )}
                  </span>

                  <span>
                    {submission.assigned_employee_id
                      ? 'Assigned'
                      : 'Unassigned'}
                  </span>

                  {submission.source_reference && (
                    <span>
                      Ref:{' '}
                      {
                        submission.source_reference
                      }
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="glassButton intakeSubmissionOpen"
                  onClick={() =>
                    setSelectedSubmissionId(
                      submission.id,
                    )
                  }
                >
                  Open submission
                </button>
              </article>
            ),
          )}
        </div>
      )}

      {!loading &&
        submissions.length >=
          250 && (
          <div className="intakeInboxLimit">
            Showing the 250
            most recent matching
            submissions.
          </div>
        )}
      {selectedSubmissionId && (
        <IntakeSubmissionDetail
          submissionId={
            selectedSubmissionId
          }
          onClose={() =>
            setSelectedSubmissionId(
              null,
            )
          }
          onChanged={() =>
            load(true)
          }
        />
      )}
    </section>
  )
}

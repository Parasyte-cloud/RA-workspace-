import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../investor-enquiries.css'

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
  status: InterestStatus
  internal_notes: string | null
  assigned_to: string | null
  consent_at: string
  submitted_at: string
  last_submitted_at: string
}

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL?.trim() || ''

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

async function callForms(
  payload: Record<string, unknown>,
) {
  const client =
    supabase

  if (!client) {
    throw new Error(
      'Workspace authentication is not configured.',
    )
  }

  const {
    data: sessionData,
  } =
    await client.auth.getSession()

  const token =
    sessionData.session
      ?.access_token

  if (!token) {
    throw new Error(
      'Your RideArrivo session has expired. Sign in again.',
    )
  }

  const response =
    await fetch(
      `${supabaseUrl}/functions/v1/ridearrivo-public-forms`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          Authorization:
            `Bearer ${token}`,
          apikey:
            supabaseAnonKey,
        },
        body:
          JSON.stringify(payload),
      },
    )

  const result =
    await response
      .json()
      .catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      result?.error ||
        'Unable to load investor enquiries.',
    )
  }

  return result
}

function when(
  value: string,
) {
  return new Date(
    value,
  ).toLocaleString(
    [],
    {
      dateStyle: 'medium',
      timeStyle: 'short',
    },
  )
}

export default function InvestorEnquiriesPanel() {
  const [records, setRecords] =
    useState<InvestorInterest[]>([])

  const [notes, setNotes] =
    useState<Record<string, string>>({})

  const [loading, setLoading] =
    useState(true)

  const [busy, setBusy] =
    useState<string | null>(null)

  const [error, setError] =
    useState('')

  const [message, setMessage] =
    useState('')

  const load =
    useCallback(async () => {
      setLoading(true)
      setError('')

      try {
        const result =
          await callForms({
            action:
              'staff_list_investor_interest',
          })

        const next =
          Array.isArray(
            result?.records,
          )
            ? result.records
            : []

        setRecords(next)

        setNotes(
          Object.fromEntries(
            next.map(
              (
                record:
                  InvestorInterest,
              ) => [
                record.id,
                record.internal_notes ||
                  '',
              ],
            ),
          ),
        )
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to load investor enquiries.',
        )
      } finally {
        setLoading(false)
      }
    }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(
    record: InvestorInterest,
    status: InterestStatus,
  ) {
    setBusy(record.id)
    setError('')
    setMessage('')

    try {
      await callForms({
        action:
          'staff_update_investor_interest',
        id:
          record.id,
        status,
        internal_notes:
          notes[record.id] ||
          '',
      })

      setMessage(
        `${record.display_name} updated.`,
      )

      await load()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update investor enquiry.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="investorSupport glassCard">
      <div className="investorSupportHeader">
        <div>
          <span className="eyebrow">
            INVESTOR RELATIONS
          </span>

          <h3>
            Investor enquiries
          </h3>

          <p>
            Secure enquiries from
            forms.ridearrivo.com and
            ROOM 7, ready for Support
            follow-up.
          </p>
        </div>

        <button
          type="button"
          className="glassButton"
          onClick={() =>
            void load()
          }
          disabled={loading}
        >
          <RefreshCw
            size={16}
          />
          {loading
            ? 'Refreshing'
            : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="investorSupportError">
          {error}
        </div>
      )}

      {message && (
        <div className="investorSupportSuccess">
          {message}
        </div>
      )}

      {!loading &&
        records.length === 0 && (
          <div className="investorSupportEmpty">
            <TrendingUp
              size={26}
            />
            <strong>
              No investor enquiries yet
            </strong>
            <span>
              New submissions will
              appear here automatically.
            </span>
          </div>
        )}

      <div className="investorSupportList">
        {records.map(
          record => (
            <article
              key={record.id}
              className="investorSupportRecord"
            >
              <header>
                <div>
                  <strong>
                    {record.display_name}
                  </strong>

                  <span>
                    {record.company ||
                      'Independent stakeholder'}
                  </span>
                </div>

                <span
                  className={`investorSupportStatus status-${record.status}`}
                >
                  {record.status}
                </span>
              </header>

              <div className="investorSupportContact">
                <div>
                  <span>
                    Email
                  </span>
                  <a
                    href={`mailto:${record.email}`}
                  >
                    {record.email}
                  </a>
                </div>

                <div>
                  <span>
                    Phone
                  </span>
                  {record.phone
                    ? (
                      <a
                        href={`tel:${record.phone}`}
                      >
                        {record.phone}
                      </a>
                    )
                    : (
                      <strong>
                        Not provided
                      </strong>
                    )}
                </div>

                <div>
                  <span>
                    Interest
                  </span>
                  <strong>
                    {record.interest_type}
                  </strong>
                </div>

                <div>
                  <span>
                    Investment range
                  </span>
                  <strong>
                    {record.investment_range ||
                      'Not specified'}
                  </strong>
                </div>
              </div>

              {record.message && (
                <p className="investorSupportMessage">
                  {record.message}
                </p>
              )}

              <small>
                Submitted{' '}
                {when(
                  record.last_submitted_at,
                )}
              </small>

              <label>
                <span>
                  Internal follow-up
                  notes
                </span>

                <textarea
                  rows={3}
                  maxLength={5000}
                  value={
                    notes[
                      record.id
                    ] || ''
                  }
                  onChange={event =>
                    setNotes(
                      current => ({
                        ...current,
                        [record.id]:
                          event.target.value,
                      }),
                    )
                  }
                />
              </label>

              <div className="investorSupportActions">
                <select
                  value={
                    record.status
                  }
                  disabled={
                    busy ===
                    record.id
                  }
                  onChange={event =>
                    void save(
                      record,
                      event.target
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
                    busy ===
                    record.id
                  }
                  onClick={() =>
                    void save(
                      record,
                      record.status,
                    )
                  }
                >
                  {busy === record.id
                    ? 'Saving...'
                    : 'Save notes'}
                </button>
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  )
}

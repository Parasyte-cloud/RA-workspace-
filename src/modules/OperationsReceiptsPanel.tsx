import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import type {
  FormEvent,
} from 'react'

import {
  CheckCircle,
  Clock,
  Download,
  Eye,
  FileText,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react'

import {
  createReceiptSignedUrl,
  loadOperationsReceipts,
  loadReceiptAudit,
  loadReceiptWorkspaceRole,
  receiptErrorMessage,
  transitionReceipt,
  updateReceiptMetadata,
  uploadOperationsReceipt,
} from '../lib/operationsReceipts'

import type {
  OperationsReceipt,
  ReceiptAuditEvent,
  ReceiptType,
  WorkspaceRole,
} from '../lib/operationsReceipts'

import { supabase } from '../lib/supabase'


type UploadDraft = {
  receipt_type: ReceiptType
  vendor_name: string
  receipt_date: string
  amount: string
  currency: string
  expense_category: string
  description: string
  booking_reference: string
  vehicle_reference: string
  trip_reference: string
}


const today = () =>
  new Date().toISOString().slice(0, 10)


const newDraft = (): UploadDraft => ({
  receipt_type: 'hardcopy_scan',
  vendor_name: '',
  receipt_date: today(),
  amount: '',
  currency: 'NGN',
  expense_category: 'Fuel',
  description: '',
  booking_reference: '',
  vehicle_reference: '',
  trip_reference: '',
})


const categories = [
  'Fuel',
  'Vehicle maintenance',
  'Tolls & parking',
  'Airport operations',
  'Driver expense',
  'Customer support',
  'Office / operations',
  'Vendor payment',
  'Travel',
  'Other',
]


function money(
  value: number,
  currency: string,
) {
  try {
    return new Intl.NumberFormat(
      'en-NG',
      {
        style: 'currency',
        currency: currency || 'NGN',
        maximumFractionDigits: 2,
      },
    ).format(value)
  } catch {
    return `${currency || 'NGN'} ${value.toLocaleString()}`
  }
}


function statusLabel(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, value => value.toUpperCase())
}


export default function OperationsReceiptsPanel() {
  const [receipts, setReceipts] =
    useState<OperationsReceipt[]>([])

  const [role, setRole] =
    useState<WorkspaceRole>('')

  const [userId, setUserId] =
    useState('')

  const [loading, setLoading] =
    useState(true)

  const [busy, setBusy] =
    useState(false)

  const [message, setMessage] =
    useState('')

  const [error, setError] =
    useState('')

  const [draft, setDraft] =
    useState<UploadDraft>(newDraft)

  const [file, setFile] =
    useState<File | null>(null)

  const [fileKey, setFileKey] =
    useState(0)

  const [search, setSearch] =
    useState('')

  const [statusFilter, setStatusFilter] =
    useState('all')

  const [reviewNotes, setReviewNotes] =
    useState<Record<string, string>>({})

  const [auditReceipt, setAuditReceipt] =
    useState<OperationsReceipt | null>(null)

  const [audit, setAudit] =
    useState<ReceiptAuditEvent[]>([])

  const [editReceipt, setEditReceipt] =
    useState<OperationsReceipt | null>(null)

  const [editDraft, setEditDraft] =
    useState<UploadDraft | null>(null)


  const canSubmit =
    ['operations', 'finance', 'admin']
      .includes(String(role))

  const canReview =
    ['finance', 'admin']
      .includes(String(role))

  const canAudit =
    ['finance', 'admin']
      .includes(String(role))


  const refresh = async () => {
    try {
      setError('')

      const data =
        await loadOperationsReceipts()

      setReceipts(data)
    } catch (err) {
      setError(receiptErrorMessage(err))
    }
  }


  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        setLoading(true)

        if (!supabase) {
          throw new Error(
            'Supabase is not configured.',
          )
        }

        const [
          workspaceRole,
          receiptData,
          authResult,
        ] = await Promise.all([
          loadReceiptWorkspaceRole(),
          loadOperationsReceipts(),
          supabase.auth.getUser(),
        ])

        if (authResult.error) {
          throw authResult.error
        }

        if (cancelled) return

        setRole(workspaceRole)
        setReceipts(receiptData)
        setUserId(
          authResult.data.user?.id || '',
        )
      } catch (err) {
        if (!cancelled) {
          setError(receiptErrorMessage(err))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])


  const stats = useMemo(() => ({
    total: receipts.length,

    awaiting: receipts.filter(
      item =>
        item.status === 'submitted' ||
        item.status === 'under_review',
    ).length,

    approved: receipts.filter(
      item => item.status === 'approved',
    ).length,

    rejected: receipts.filter(
      item => item.status === 'rejected',
    ).length,
  }), [receipts])


  const filtered = useMemo(() => {
    const query =
      search.trim().toLowerCase()

    return receipts.filter(receipt => {
      if (
        statusFilter !== 'all' &&
        receipt.status !== statusFilter
      ) {
        return false
      }

      if (!query) return true

      return [
        receipt.vendor_name,
        receipt.expense_category,
        receipt.booking_reference,
        receipt.vehicle_reference,
        receipt.trip_reference,
        receipt.original_filename,
      ]
        .filter(Boolean)
        .some(value =>
          String(value)
            .toLowerCase()
            .includes(query),
        )
    })
  }, [
    receipts,
    search,
    statusFilter,
  ])


  const submitReceipt =
    async (event: FormEvent) => {
      event.preventDefault()

      setMessage('')
      setError('')

      if (!file) {
        setError(
          'Select the hard-copy scan or soft-copy receipt file.',
        )
        return
      }

      const amount =
        Number(draft.amount)

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        setError(
          'Enter a valid receipt amount greater than zero.',
        )
        return
      }

      try {
        setBusy(true)

        await uploadOperationsReceipt({
          ...draft,
          amount,
          file,
        })

        setDraft(newDraft())
        setFile(null)
        setFileKey(value => value + 1)

        setMessage(
          'Receipt submitted securely for review.',
        )

        await refresh()
      } catch (err) {
        setError(receiptErrorMessage(err))
      } finally {
        setBusy(false)
      }
    }


  const openReceipt =
    async (
      receipt: OperationsReceipt,
      download = false,
    ) => {
      try {
        setError('')

        const url =
          await createReceiptSignedUrl(
            receipt,
          )

        if (download) {
          const anchor =
            document.createElement('a')

          anchor.href = url
          anchor.download =
            receipt.original_filename

          anchor.rel = 'noopener'
          anchor.click()
          return
        }

        window.open(
          url,
          '_blank',
          'noopener,noreferrer',
        )
      } catch (err) {
        setError(receiptErrorMessage(err))
      }
    }


  const moveReceipt =
    async (
      receipt: OperationsReceipt,
      status:
        | 'under_review'
        | 'approved'
        | 'rejected',
    ) => {
      setMessage('')
      setError('')

      const note =
        reviewNotes[receipt.id]?.trim() || ''

      if (
        status === 'rejected' &&
        !note
      ) {
        setError(
          'Add a review note explaining why the receipt is being rejected.',
        )
        return
      }

      try {
        setBusy(true)

        await transitionReceipt(
          receipt.id,
          status,
          {
            reviewNote: note,
          },
        )

        setMessage(
          status === 'under_review'
            ? 'Finance review started.'
            : status === 'approved'
              ? 'Receipt approved.'
              : 'Receipt rejected.',
        )

        await refresh()
      } catch (err) {
        setError(receiptErrorMessage(err))
      } finally {
        setBusy(false)
      }
    }


  const showAudit =
    async (receipt: OperationsReceipt) => {
      try {
        setError('')
        setAuditReceipt(receipt)

        const events =
          await loadReceiptAudit(receipt.id)

        setAudit(events)
      } catch (err) {
        setAuditReceipt(null)
        setAudit([])
        setError(receiptErrorMessage(err))
      }
    }


  const beginEdit =
    (receipt: OperationsReceipt) => {
      setEditReceipt(receipt)

      setEditDraft({
        receipt_type:
          receipt.receipt_type,

        vendor_name:
          receipt.vendor_name,

        receipt_date:
          receipt.receipt_date,

        amount:
          String(receipt.amount),

        currency:
          receipt.currency,

        expense_category:
          receipt.expense_category,

        description:
          receipt.description || '',

        booking_reference:
          receipt.booking_reference || '',

        vehicle_reference:
          receipt.vehicle_reference || '',

        trip_reference:
          receipt.trip_reference || '',
      })
    }


  const saveEdit =
    async (event: FormEvent) => {
      event.preventDefault()

      if (
        !editReceipt ||
        !editDraft
      ) return

      const amount =
        Number(editDraft.amount)

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        setError(
          'Enter a valid receipt amount greater than zero.',
        )
        return
      }

      try {
        setBusy(true)
        setError('')

        await updateReceiptMetadata(
          editReceipt.id,
          {
            ...editDraft,
            amount,
          },
        )

        setEditReceipt(null)
        setEditDraft(null)

        setMessage(
          'Receipt information updated.',
        )

        await refresh()
      } catch (err) {
        setError(receiptErrorMessage(err))
      } finally {
        setBusy(false)
      }
    }


  return (
    <div
      className="glassCard workbench"
      style={{ marginBottom: 18 }}
    >
      <div className="workbenchHead">
        <div>
          <h3>Receipts &amp; Expenses</h3>

          <p>
            Operations expense evidence with
            private storage, Finance review and
            immutable audit history.
          </p>
        </div>

        <FileText />
      </div>


      <div
        className="grid2"
        style={{ marginBottom: 18 }}
      >
        <div className="glassCard feature">
          <FileText />

          <h3>{stats.total}</h3>
          <p>Total receipts</p>
        </div>

        <div className="glassCard feature">
          <Clock />

          <h3>{stats.awaiting}</h3>
          <p>Awaiting review</p>
        </div>

        <div className="glassCard feature">
          <CheckCircle />

          <h3>{stats.approved}</h3>
          <p>Approved</p>
        </div>

        <div className="glassCard feature">
          <XCircle />

          <h3>{stats.rejected}</h3>
          <p>Rejected</p>
        </div>
      </div>


      {error && (
        <div className="moduleNotice">
          {error}
        </div>
      )}

      {message && (
        <div className="moduleNotice">
          {message}
        </div>
      )}


      {canSubmit && (
        <div
          className="glassCard"
          style={{ marginBottom: 18 }}
        >
          <div className="workbenchHead">
            <div>
              <h3>Upload receipt</h3>

              <p>
                Upload the original digital receipt
                or a clear scan/photo of a hard-copy
                receipt.
              </p>
            </div>

            <Upload />
          </div>

          <form
            className="quickForm"
            onSubmit={submitReceipt}
          >
            <div className="quickFormGrid">
              <label>
                Receipt type

                <select
                  value={draft.receipt_type}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      receipt_type:
                        event.target.value as ReceiptType,
                    })
                  }
                >
                  <option value="hardcopy_scan">
                    Hard-copy scan / photo
                  </option>

                  <option value="softcopy">
                    Soft-copy receipt
                  </option>
                </select>
              </label>


              <label>
                Vendor

                <input
                  required
                  value={draft.vendor_name}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      vendor_name:
                        event.target.value,
                    })
                  }
                />
              </label>


              <label>
                Receipt date

                <input
                  required
                  type="date"
                  value={draft.receipt_date}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      receipt_date:
                        event.target.value,
                    })
                  }
                />
              </label>


              <label>
                Amount

                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.amount}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      amount:
                        event.target.value,
                    })
                  }
                />
              </label>


              <label>
                Currency

                <select
                  value={draft.currency}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      currency:
                        event.target.value,
                    })
                  }
                >
                  <option value="NGN">NGN</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>


              <label>
                Expense category

                <select
                  value={draft.expense_category}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      expense_category:
                        event.target.value,
                    })
                  }
                >
                  {categories.map(category => (
                    <option
                      key={category}
                      value={category}
                    >
                      {category}
                    </option>
                  ))}
                </select>
              </label>


              <label>
                Booking reference

                <input
                  value={draft.booking_reference}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      booking_reference:
                        event.target.value,
                    })
                  }
                />
              </label>


              <label>
                Vehicle reference

                <input
                  value={draft.vehicle_reference}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      vehicle_reference:
                        event.target.value,
                    })
                  }
                />
              </label>


              <label>
                Trip reference

                <input
                  value={draft.trip_reference}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      trip_reference:
                        event.target.value,
                    })
                  }
                />
              </label>


              <label>
                Receipt file

                <input
                  key={fileKey}
                  required
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  onChange={event =>
                    setFile(
                      event.target.files?.[0] ||
                      null,
                    )
                  }
                />
              </label>


              <label>
                Description / purpose

                <textarea
                  value={draft.description}
                  onChange={event =>
                    setDraft({
                      ...draft,
                      description:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>


            {file && (
              <div className="moduleNotice">
                Selected: {file.name} ·{' '}
                {(file.size / 1024 / 1024)
                  .toFixed(2)} MB
              </div>
            )}


            <button
              className="primaryButton"
              disabled={busy}
            >
              <Upload size={16} />

              {busy
                ? 'Submitting...'
                : 'Submit receipt'}
            </button>
          </form>
        </div>
      )}


      <div
        className="buttonRow"
        style={{ marginBottom: 14 }}
      >
        <input
          placeholder="Search vendor, booking, vehicle, trip..."
          value={search}
          onChange={event =>
            setSearch(event.target.value)
          }
        />

        <select
          value={statusFilter}
          onChange={event =>
            setStatusFilter(
              event.target.value,
            )
          }
        >
          <option value="all">
            All statuses
          </option>

          <option value="submitted">
            Submitted
          </option>

          <option value="under_review">
            Under review
          </option>

          <option value="approved">
            Approved
          </option>

          <option value="rejected">
            Rejected
          </option>

          <option value="voided">
            Voided
          </option>
        </select>

        <button
          type="button"
          className="glassButton"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>


      <div className="moduleTableWrap">
        <table className="moduleTable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Reference</th>
              <th>Type</th>
              <th>Status</th>
              <th>Evidence</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              filtered.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    No receipts found.
                  </td>
                </tr>
              )}

            {filtered.map(receipt => {
              const ownReceipt =
                receipt.submitted_by === userId

              const reviewerAllowed =
                canReview && !ownReceipt

              const canEdit =
                role === 'operations' &&
                ownReceipt &&
                receipt.status === 'submitted'

              return (
                <tr key={receipt.id}>
                  <td>
                    {receipt.receipt_date}
                  </td>

                  <td>
                    {receipt.vendor_name}
                  </td>

                  <td>
                    {receipt.expense_category}
                  </td>

                  <td>
                    {money(
                      Number(receipt.amount),
                      receipt.currency,
                    )}
                  </td>

                  <td>
                    {receipt.booking_reference ||
                      receipt.trip_reference ||
                      receipt.vehicle_reference ||
                      '—'}
                  </td>

                  <td>
                    {receipt.receipt_type ===
                    'hardcopy_scan'
                      ? 'Hard copy'
                      : 'Soft copy'}
                  </td>

                  <td>
                    {statusLabel(
                      receipt.status,
                    )}
                  </td>

                  <td>
                    <div className="buttonRow">
                      <button
                        type="button"
                        className="glassButton"
                        onClick={() =>
                          void openReceipt(
                            receipt,
                          )
                        }
                      >
                        <Eye size={14} />
                        View
                      </button>

                      <button
                        type="button"
                        className="glassButton"
                        onClick={() =>
                          void openReceipt(
                            receipt,
                            true,
                          )
                        }
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </td>

                  <td>
                    <div className="buttonRow">
                      {canEdit && (
                        <button
                          type="button"
                          className="glassButton"
                          onClick={() =>
                            beginEdit(receipt)
                          }
                        >
                          Edit
                        </button>
                      )}

                      {reviewerAllowed &&
                        receipt.status ===
                          'submitted' && (
                          <button
                            type="button"
                            className="glassButton"
                            disabled={busy}
                            onClick={() =>
                              void moveReceipt(
                                receipt,
                                'under_review',
                              )
                            }
                          >
                            Start review
                          </button>
                        )}

                      {reviewerAllowed &&
                        receipt.status ===
                          'under_review' && (
                          <>
                            <button
                              type="button"
                              className="primaryButton"
                              disabled={busy}
                              onClick={() =>
                                void moveReceipt(
                                  receipt,
                                  'approved',
                                )
                              }
                            >
                              Approve
                            </button>

                            <button
                              type="button"
                              className="glassButton"
                              disabled={busy}
                              onClick={() =>
                                void moveReceipt(
                                  receipt,
                                  'rejected',
                                )
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}

                      {canAudit && (
                        <button
                          type="button"
                          className="glassButton"
                          onClick={() =>
                            void showAudit(
                              receipt,
                            )
                          }
                        >
                          Audit
                        </button>
                      )}
                    </div>

                    {reviewerAllowed &&
                      receipt.status ===
                        'under_review' && (
                        <textarea
                          placeholder="Finance review note"
                          value={
                            reviewNotes[
                              receipt.id
                            ] || ''
                          }
                          onChange={event =>
                            setReviewNotes({
                              ...reviewNotes,
                              [receipt.id]:
                                event.target.value,
                            })
                          }
                        />
                      )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>


      {editReceipt && editDraft && (
        <div
          className="glassCard"
          style={{ marginTop: 18 }}
        >
          <div className="workbenchHead">
            <div>
              <h3>Correct receipt information</h3>

              <p>
                The original uploaded file cannot
                be replaced. Only metadata may be
                corrected before Finance review.
              </p>
            </div>
          </div>

          <form
            className="quickForm"
            onSubmit={saveEdit}
          >
            <div className="quickFormGrid">
              <label>
                Vendor

                <input
                  required
                  value={editDraft.vendor_name}
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      vendor_name:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Receipt date

                <input
                  required
                  type="date"
                  value={editDraft.receipt_date}
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      receipt_date:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Amount

                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={editDraft.amount}
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      amount:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Category

                <select
                  value={
                    editDraft.expense_category
                  }
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      expense_category:
                        event.target.value,
                    })
                  }
                >
                  {categories.map(category => (
                    <option
                      key={category}
                      value={category}
                    >
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Booking reference

                <input
                  value={
                    editDraft.booking_reference
                  }
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      booking_reference:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Vehicle reference

                <input
                  value={
                    editDraft.vehicle_reference
                  }
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      vehicle_reference:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Trip reference

                <input
                  value={
                    editDraft.trip_reference
                  }
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      trip_reference:
                        event.target.value,
                    })
                  }
                />
              </label>

              <label>
                Description

                <textarea
                  value={
                    editDraft.description
                  }
                  onChange={event =>
                    setEditDraft({
                      ...editDraft,
                      description:
                        event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="buttonRow">
              <button
                className="primaryButton"
                disabled={busy}
              >
                Save correction
              </button>

              <button
                type="button"
                className="glassButton"
                onClick={() => {
                  setEditReceipt(null)
                  setEditDraft(null)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}


      {auditReceipt && (
        <div
          className="glassCard"
          style={{ marginTop: 18 }}
        >
          <div className="workbenchHead">
            <div>
              <h3>Receipt audit history</h3>

              <p>
                {auditReceipt.vendor_name} ·{' '}
                {auditReceipt.original_filename}
              </p>
            </div>

            <button
              type="button"
              className="glassButton"
              onClick={() => {
                setAuditReceipt(null)
                setAudit([])
              }}
            >
              Close
            </button>
          </div>

          <div className="moduleTableWrap">
            <table className="moduleTable">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {audit.map(event => (
                  <tr key={event.id}>
                    <td>
                      {new Date(
                        event.created_at,
                      ).toLocaleString()}
                    </td>

                    <td>
                      {event.action}
                    </td>

                    <td>
                      {event.actor_id || 'System'}
                    </td>

                    <td>
                      {String(
                        event.new_data?.status ||
                        '—',
                      )}
                    </td>
                  </tr>
                ))}

                {audit.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      No audit events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

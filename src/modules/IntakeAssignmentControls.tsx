import {
  useEffect,
  useState,
} from 'react'
import {
  listIntakeAssignmentCandidates,
  reassignIntakeSubmission,
} from '../lib/intake'
import type {
  IntakeAssignmentCandidate,
  IntakeSubmission,
} from '../lib/intake'
import { supabase } from '../lib/supabase'

type Props = {
  submission: IntakeSubmission
  onChanged: () =>
    void | Promise<void>
}

function candidateLabel(
  candidate:
    IntakeAssignmentCandidate,
) {
  const details = [
    candidate.job_title,
    candidate.department,
  ].filter(Boolean)

  return details.length
    ? `${candidate.full_name} — ${details.join(
        ' · ',
      )}`
    : candidate.full_name
}

export default function IntakeAssignmentControls({
  submission,
  onChanged,
}: Props) {
  const [
    currentUserId,
    setCurrentUserId,
  ] = useState('')

  const [
    candidates,
    setCandidates,
  ] =
    useState<
      IntakeAssignmentCandidate[]
    >([])

  const [
    canManageAssignments,
    setCanManageAssignments,
  ] = useState(false)

  const [
    checkingAccess,
    setCheckingAccess,
  ] = useState(true)

  const [
    saving,
    setSaving,
  ] = useState(false)

  const [
    selectedAssigneeId,
    setSelectedAssigneeId,
  ] = useState(
    submission.assigned_employee_id ||
      '',
  )

  const [
    message,
    setMessage,
  ] = useState('')

  useEffect(() => {
    setSelectedAssigneeId(
      submission.assigned_employee_id ||
        '',
    )
  }, [
    submission.assigned_employee_id,
  ])

  useEffect(() => {
    let cancelled = false

    const loadAccess =
      async () => {
        setCheckingAccess(true)
        setMessage('')

        try {
          if (!supabase) {
            throw new Error(
              'Workspace database is unavailable.',
            )
          }

          const {
            data: {
              user,
            },
            error,
          } =
            await supabase.auth.getUser()

          if (error) {
            throw error
          }

          if (
            !user ||
            cancelled
          ) {
            return
          }

          setCurrentUserId(
            user.id,
          )

          try {
            const nextCandidates =
              await listIntakeAssignmentCandidates(
                submission
                  .destination_workstation,
              )

            if (cancelled) {
              return
            }

            setCandidates(
              nextCandidates,
            )

            setCanManageAssignments(
              true,
            )
          } catch {
            if (cancelled) {
              return
            }

            // The candidate RPC is intentionally
            // Manager/Admin only. A denied call
            // means normal workstation ownership.
            setCandidates([])
            setCanManageAssignments(
              false,
            )
          }
        } catch (
          error: any
        ) {
          if (!cancelled) {
            setCurrentUserId('')
            setCandidates([])
            setCanManageAssignments(
              false,
            )

            setMessage(
              error?.message ||
                'Unable to verify assignment access.',
            )
          }
        } finally {
          if (!cancelled) {
            setCheckingAccess(
              false,
            )
          }
        }
      }

    void loadAccess()

    return () => {
      cancelled = true
    }
  }, [
    submission.id,
    submission.destination_workstation,
  ])

  const assignedToSelf =
    Boolean(currentUserId) &&
    submission
      .assigned_employee_id ===
      currentUserId

  const assignedCandidate =
    candidates.find(
      candidate =>
        candidate.employee_id ===
        submission
          .assigned_employee_id,
    )

  const assignmentSummary =
    !submission
      .assigned_employee_id
      ? 'Unassigned'
      : assignedToSelf
        ? 'Assigned to you'
        : assignedCandidate
          ? assignedCandidate
              .full_name
          : 'Assigned'

  const changeAssignment =
    async (
      employeeId:
        string | null,
    ) => {
      if (saving) {
        return
      }

      setSaving(true)
      setMessage('')

      try {
        await reassignIntakeSubmission(
          submission.id,
          employeeId,
        )

        await onChanged()
      } catch (
        error: any
      ) {
        setMessage(
          error?.message ||
            'Unable to update assignment.',
        )
      } finally {
        setSaving(false)
      }
    }

  return (
    <section
      className="intakeAssignmentCard"
      aria-label="Submission assignment"
    >
      <div className="intakeAssignmentSummary">
        <div>
          <span className="eyebrow">
            ASSIGNMENT
          </span>

          <strong>
            {assignmentSummary}
          </strong>
        </div>

        <span className="intakeAssignmentMode">
          {canManageAssignments
            ? 'Management controls'
            : 'Workstation ownership'}
        </span>
      </div>

      {message && (
        <div className="intakeAssignmentMessage">
          {message}
        </div>
      )}

      {checkingAccess ? (
        <p className="muted">
          Checking assignment access…
        </p>
      ) : canManageAssignments ? (
        <div className="intakeAssignmentActions">
          <select
            aria-label="Eligible employee"
            value={
              selectedAssigneeId
            }
            onChange={
              event =>
                setSelectedAssigneeId(
                  event.target.value,
                )
            }
            disabled={saving}
          >
            <option value="">
              {candidates.length
                ? 'Choose eligible employee'
                : 'No eligible employees'}
            </option>

            {candidates.map(
              candidate => (
                <option
                  key={
                    candidate.employee_id
                  }
                  value={
                    candidate.employee_id
                  }
                >
                  {candidateLabel(
                    candidate,
                  )}
                </option>
              ),
            )}
          </select>

          <button
            type="button"
            className="glassButton"
            disabled={
              saving ||
              !selectedAssigneeId ||
              selectedAssigneeId ===
                submission
                  .assigned_employee_id
            }
            onClick={() =>
              void changeAssignment(
                selectedAssigneeId,
              )
            }
          >
            {submission
              .assigned_employee_id
              ? 'Reassign'
              : 'Assign'}
          </button>

          {submission
            .assigned_employee_id && (
            <button
              type="button"
              className="glassButton"
              disabled={saving}
              onClick={() =>
                void changeAssignment(
                  null,
                )
              }
            >
              Unassign
            </button>
          )}
        </div>
      ) : !submission
          .assigned_employee_id &&
        currentUserId ? (
        <div className="intakeAssignmentActions">
          <button
            type="button"
            className="glassButton"
            disabled={saving}
            onClick={() =>
              void changeAssignment(
                currentUserId,
              )
            }
          >
            Claim
          </button>

          <span className="muted">
            Claim this submission for
            yourself.
          </span>
        </div>
      ) : (
        <p className="muted">
          {assignedToSelf
            ? 'This submission is assigned to you.'
            : submission
                .assigned_employee_id
              ? 'This submission is assigned to another employee.'
              : 'Assignment controls are unavailable.'}
        </p>
      )}
    </section>
  )
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const detail =
  readFileSync(
    new URL(
      '../src/modules/IntakeSubmissionDetail.tsx',
      import.meta.url,
    ),
    'utf8',
  )

const inbox =
  readFileSync(
    new URL(
      '../src/modules/IntakeSubmissionInbox.tsx',
      import.meta.url,
    ),
    'utf8',
  )

const assignment =
  readFileSync(
    new URL(
      '../src/modules/IntakeAssignmentControls.tsx',
      import.meta.url,
    ),
    'utf8',
  )

const css =
  readFileSync(
    new URL(
      '../src/intake-workspace.css',
      import.meta.url,
    ),
    'utf8',
  )

const migration =
  readFileSync(
    new URL(
      '../supabase/migrations/20260906171000_reusable_intake_platform.sql',
      import.meta.url,
    ),
    'utf8',
  )

test(
  'detail loads submission and immutable audit history through the centralized client',
  () => {
    assert.match(
      detail,
      /getIntakeSubmission/,
    )

    assert.match(
      detail,
      /listIntakeSubmissionEvents/,
    )

    assert.doesNotMatch(
      detail,
      /\.from\(\s*['"]intake_/,
    )
  },
)

test(
  'detail exposes the five audited workflow statuses',
  () => {
    assert.match(
      detail,
      /INTAKE_STATUS_LABELS/,
    )

    assert.match(
      detail,
      /updateIntakeSubmissionStatus/,
    )

    for (
      const marker of [
        'new',
        'in_progress',
        'followed_up',
        'resolved',
        'closed',
      ]
    ) {
      assert.ok(
        migration.includes(
          `'${marker}'`,
        ),
      )
    }
  },
)

test(
  'database owns milestone timestamps and status audit events',
  () => {
    assert.ok(
      migration.includes(
        'new.followed_up_at := now()',
      ),
    )

    assert.ok(
      migration.includes(
        'new.resolved_at := now()',
      ),
    )

    assert.ok(
      migration.includes(
        'new.closed_at := now()',
      ),
    )

    assert.ok(
      migration.includes(
        "'status_changed'",
      ),
    )

    assert.ok(
      migration.includes(
        'new.updated_at := now()',
      ),
    )
  },
)

test(
  'detail renders every submitted payload field and the routing snapshots',
  () => {
    assert.match(
      detail,
      /Object\.entries\([\s\S]*submission\?\.payload/,
    )

    assert.match(
      detail,
      /form_title_snapshot/,
    )

    assert.match(
      detail,
      /category_title_snapshot/,
    )

    assert.match(
      detail,
      /source_reference/,
    )

    assert.match(
      detail,
      /whatsapp_conversation_id/,
    )
  },
)

test(
  'detail mounts the reusable assignment controls',
  () => {
    assert.match(
      detail,
      /import IntakeAssignmentControls from '\.\/IntakeAssignmentControls'/,
    )

    assert.match(
      detail,
      /<IntakeAssignmentControls/,
    )

    assert.match(
      detail,
      /onChanged=\{async \(\) =>/,
    )
  },
)

test(
  'assignment controls use authenticated identity and guarded client APIs',
  () => {
    assert.match(
      assignment,
      /supabase\.auth\.getUser\(\)/,
    )

    assert.match(
      assignment,
      /listIntakeAssignmentCandidates/,
    )

    assert.match(
      assignment,
      /reassignIntakeSubmission/,
    )

    assert.doesNotMatch(
      assignment,
      /employee_profiles/,
    )

    assert.doesNotMatch(
      assignment,
      /\.from\(/,
    )
  },
)

test(
  'management can assign reassign and unassign while staff can claim',
  () => {
    for (
      const marker of [
        'Assign',
        'Reassign',
        'Unassign',
        'Claim',
      ]
    ) {
      assert.match(
        assignment,
        new RegExp(marker),
      )
    }

    assert.match(
      assignment,
      /canManageAssignments/,
    )

    assert.match(
      assignment,
      /!submission[\s\S]*?\.assigned_employee_id/,
    )

    assert.match(
      assignment,
      /currentUserId/,
    )
  },
)

test(
  'database remains authoritative for reassignment permissions',
  () => {
    assert.ok(
      migration.includes(
        'Only Management or Administration can reassign intake submissions',
      ),
    )
  },
)

test(
  'reusable inbox opens and mounts the detail workflow',
  () => {
    assert.match(
      inbox,
      /import IntakeSubmissionDetail from '\.\/IntakeSubmissionDetail'/,
    )

    assert.match(
      inbox,
      /Open submission/,
    )

    assert.match(
      inbox,
      /selectedSubmissionId/,
    )

    assert.match(
      inbox,
      /<IntakeSubmissionDetail/,
    )
  },
)

test(
  'detail workflow is responsive',
  () => {
    assert.match(
      css,
      /\.intakeDetailBackdrop/,
    )

    assert.match(
      css,
      /\.intakeDetailWorkflow/,
    )

    assert.match(
      css,
      /\.intakeDetailResponses/,
    )

    assert.match(
      css,
      /\.intakeDetailTimeline/,
    )

    assert.match(
      css,
      /@media \(max-width: 760px\)/,
    )
  },
)

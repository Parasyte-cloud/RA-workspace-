import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const component =
  readFileSync(
    new URL(
      '../src/modules/IntakeSubmissionInbox.tsx',
      import.meta.url,
    ),
    'utf8',
  )

const client =
  readFileSync(
    new URL(
      '../src/lib/intake.ts',
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

test(
  'inbox consumes the centralized intake client only',
  () => {
    assert.match(
      component,
      /listIntakeCategories/,
    )

    assert.match(
      component,
      /listIntakeSubmissions/,
    )

    assert.match(
      component,
      /subscribeToIntakeWorkstation/,
    )

    assert.doesNotMatch(
      component,
      /\.from\(\s*['"]intake_/,
    )
  },
)

test(
  'inbox is always scoped to its workstation',
  () => {
    assert.match(
      component,
      /listIntakeSubmissions\(\{[\s\S]*workstation:/,
    )

    assert.match(
      client,
      /destination_workstation=eq\.\$\{route\}/,
    )

    assert.match(
      client,
      /table:\s*['"]intake_submissions['"]/,
    )
  },
)

test(
  'inbox supports search category and status filters',
  () => {
    assert.match(
      component,
      /Search submissions/,
    )

    assert.match(
      component,
      /All categories/,
    )

    assert.match(
      component,
      /All statuses/,
    )

    assert.match(
      component,
      /INTAKE_STATUS_LABELS/,
    )
  },
)

test(
  'inbox retains immutable form and category snapshots',
  () => {
    assert.match(
      component,
      /form_title_snapshot/,
    )

    assert.match(
      component,
      /category_title_snapshot/,
    )

    assert.match(
      component,
      /submitted_at/,
    )

    assert.match(
      component,
      /updated_at/,
    )
  },
)

test(
  'Batch 3B remains read-only',
  () => {
    assert.doesNotMatch(
      component,
      /updateIntakeSubmissionStatus/,
    )

    assert.doesNotMatch(
      component,
      /reassignIntakeSubmission/,
    )

    assert.doesNotMatch(
      component,
      /\.update\(/,
    )

    assert.doesNotMatch(
      component,
      /\.insert\(/,
    )
  },
)

test(
  'inbox has responsive workstation styling',
  () => {
    assert.match(
      css,
      /\.intakeInbox/,
    )

    assert.match(
      css,
      /\.intakeInboxToolbar/,
    )

    assert.match(
      css,
      /\.intakeSubmissionCard/,
    )

    assert.match(
      css,
      /@media \(max-width: 640px\)/,
    )
  },
)

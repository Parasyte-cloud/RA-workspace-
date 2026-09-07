import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route =
  readFileSync(
    new URL(
      '../src/modules/SupportWorkspaceRoute.tsx',
      import.meta.url,
    ),
    'utf8',
  )

test(
  'Support workstation mounts the reusable intake inbox',
  () => {
    assert.match(
      route,
      /import IntakeSubmissionInbox from '\.\/IntakeSubmissionInbox'/,
    )

    assert.match(
      route,
      /<IntakeSubmissionInbox[\s\S]*workstation="support"/,
    )

    assert.match(
      route,
      /title="Support Form Submissions"/,
    )
  },
)

test(
  'existing Support systems remain mounted',
  () => {
    assert.match(
      route,
      /execution=\{<SupportModule\/>\}/,
    )

    assert.match(
      route,
      /<SupportWhatsAppPanel\/>/,
    )

    assert.match(
      route,
      /<SupportAssistedBookingPanel\/>/,
    )
  },
)

test(
  'intake inbox is additive and ordered before communication tools',
  () => {
    const inbox =
      route.indexOf(
        '<IntakeSubmissionInbox',
      )

    const whatsapp =
      route.indexOf(
        '<SupportWhatsAppPanel/>',
      )

    const booking =
      route.indexOf(
        '<SupportAssistedBookingPanel/>',
      )

    assert.ok(inbox >= 0)
    assert.ok(whatsapp > inbox)
    assert.ok(booking > whatsapp)
  },
)

test(
  'Support route does not bypass the centralized intake client',
  () => {
    assert.doesNotMatch(
      route,
      /\.from\(\s*['"]intake_/,
    )

    assert.doesNotMatch(
      route,
      /updateIntakeSubmissionStatus/,
    )

    assert.doesNotMatch(
      route,
      /reassignIntakeSubmission/,
    )
  },
)

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

const hub =
  readFileSync(
    new URL(
      '../src/modules/SupportWorkspaceHub.tsx',
      import.meta.url,
    ),
    'utf8',
  )

const supportSurface = `${route}\n${hub}`

test(
  'Support workstation mounts the reusable intake inbox',
  () => {
    assert.match(
      hub,
      /import IntakeSubmissionInbox from '\.\/IntakeSubmissionInbox'/,
    )

    assert.match(
      hub,
      /<IntakeSubmissionInbox[\s\S]*workstation="support"/,
    )

    assert.match(
      hub,
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
      hub,
      /<SupportWhatsAppPanel\s*\/>/,
    )

    assert.match(
      hub,
      /<SupportAssistedBookingPanel\s*\/>/,
    )
  },
)

test(
  'intake inbox is additive and ordered before communication tools',
  () => {
    const inbox =
      hub.indexOf(
        '<IntakeSubmissionInbox',
      )

    const whatsapp =
      hub.indexOf(
        '<SupportWhatsAppPanel />',
      )

    const booking =
      hub.indexOf(
        '<SupportAssistedBookingPanel />',
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
      supportSurface,
      /\.from\(\s*['"]intake_/,
    )

    assert.doesNotMatch(
      supportSurface,
      /updateIntakeSubmissionStatus/,
    )

    assert.doesNotMatch(
      supportSurface,
      /reassignIntakeSubmission/,
    )
  },
)

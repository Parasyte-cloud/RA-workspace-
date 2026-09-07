import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client =
  readFileSync(
    new URL(
      '../src/lib/intake.ts',
      import.meta.url,
    ),
    'utf8',
  )

const edge =
  readFileSync(
    new URL(
      '../supabase/functions/intake/index.ts',
      import.meta.url,
    ),
    'utf8',
  )

test(
  'intake client keeps the shared Supabase boundary',
  () => {
    assert.match(
      client,
      /import \{ supabase \} from '\.\/supabase'/,
    )

    assert.doesNotMatch(
      client,
      /SUPABASE_SERVICE_ROLE_KEY|service_role/i,
    )

    assert.match(
      client,
      /VITE_SUPABASE_URL/,
    )

    assert.match(
      client,
      /VITE_SUPABASE_ANON_KEY/,
    )
  },
)

test(
  'client and Edge Function agree on public/internal selectors',
  () => {
    assert.match(
      edge,
      /searchParams\.get\("scope"\)/,
    )

    assert.match(
      edge,
      /searchParams\.get\("slug"\)/,
    )

    assert.match(
      edge,
      /body\.slug/,
    )

    assert.match(
      client,
      /params\.set\(\s*'scope',\s*'internal'/,
    )

    assert.match(
      client,
      /params\.set\(\s*'slug',\s*normalizeIntakeSlug\(slug\)/,
    )

    assert.match(
      client,
      /slug:\s*normalizeIntakeSlug\(\s*input\.slug/,
    )
  },
)

test(
  'internal requests preserve explicit session authentication',
  () => {
    assert.match(
      client,
      /auth\.getSession\(\)/,
    )

    assert.match(
      client,
      /headers\.Authorization\s*=\s*`Bearer \$\{accessToken\}`/,
    )

    assert.match(
      client,
      /authenticated:\s*true/,
    )
  },
)

test(
  'submission creation stays behind the Edge Function',
  () => {
    assert.doesNotMatch(
      client,
      /from\(\s*'intake_submissions'\s*\)[\s\S]{0,180}\.insert\(/,
    )

    assert.match(
      client,
      /submitPublicIntakeForm/,
    )

    assert.match(
      client,
      /submitInternalIntakeForm/,
    )

    assert.match(
      client,
      /whatsappConversationId/,
    )
  },
)

test(
  'workflow statuses match the database contract',
  () => {
    for (
      const status of [
        'new',
        'in_progress',
        'followed_up',
        'resolved',
        'closed',
      ]
    ) {
      assert.match(
        client,
        new RegExp(`'${status}'`),
      )
    }

    for (
      const label of [
        'New',
        'In Progress',
        'Followed Up',
        'Resolved',
        'Closed',
      ]
    ) {
      assert.match(
        client,
        new RegExp(label),
      )
    }
  },
)

test(
  'administration publishing uses the guarded RPC',
  () => {
    assert.match(
      client,
      /rpc\(\s*'publish_intake_form_version'/,
    )

    assert.match(
      client,
      /p_form_id:\s*formId/,
    )

    assert.match(
      client,
      /p_version_id:\s*versionId/,
    )
  },
)

test(
  'assignment candidate type exposes only the approved directory fields',
  () => {
    assert.match(
      client,
      /export type IntakeAssignmentCandidate\s*=\s*\{[\s\S]*?employee_id:\s*string[\s\S]*?full_name:\s*string[\s\S]*?job_title:\s*string\s*\|\s*null[\s\S]*?department:\s*string\s*\|\s*null[\s\S]*?employee_role:\s*string[\s\S]*?\}/,
    )
  },
)

test(
  'assignment candidates use the guarded workstation RPC',
  () => {
    const match =
      client.match(
        /export async function listIntakeAssignmentCandidates\([\s\S]*?(?=export async function reassignIntakeSubmission)/,
      )

    assert.ok(
      match,
      'candidate listing function is missing',
    )

    const block = match[0]

    assert.match(
      block,
      /workstation[\s\S]*?\.trim\(\)[\s\S]*?\.toLowerCase\(\)/,
    )

    assert.match(
      block,
      /Destination workstation is required\./,
    )

    assert.match(
      block,
      /rpc\(\s*'list_intake_assignment_candidates'\s*,\s*\{[\s\S]*?p_workstation:\s*normalizedWorkstation[\s\S]*?\}\s*,?\s*\)/,
    )

    assert.match(
      block,
      /\(\s*data\s*\|\|\s*\[\]\s*\)\s*as\s*IntakeAssignmentCandidate\[\]/,
    )

    assert.doesNotMatch(
      block,
      /from\(\s*'employee_profiles'\s*\)/,
    )
  },
)

test(
  'submission reassignment stays on the protected submission update path',
  () => {
    const match =
      client.match(
        /export async function reassignIntakeSubmission\([\s\S]*?(?=export async function createIntakeCategory)/,
      )

    assert.ok(
      match,
      'reassignment function is missing',
    )

    const block = match[0]

    assert.match(
      block,
      /from\(\s*'intake_submissions'\s*,?\s*\)/,
    )

    assert.match(
      block,
      /\.update\(\s*\{[\s\S]*?assigned_employee_id:\s*employeeId[\s\S]*?\}\s*\)/,
    )

    assert.match(
      block,
      /\.eq\(\s*'id'\s*,\s*submissionId\s*,?\s*\)/,
    )

    assert.doesNotMatch(
      block,
      /from\(\s*'employee_profiles'\s*\)/,
    )
  },
)

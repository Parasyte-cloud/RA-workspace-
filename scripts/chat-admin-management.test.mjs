import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const opts = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

function localEnv() {
  const config = readFileSync(
    new URL('../supabase/config.toml', import.meta.url),
    'utf8',
  )

  assert.equal(
    config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1],
    'RA-workspace',
  )

  const out = execFileSync(
    'supabase',
    ['status', '-o', 'env'],
    { encoding: 'utf8' },
  )

  const env = {}

  for (const line of out.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
    if (match) env[match[1]] = match[2]
  }

  return {
    url:
      env.API_URL ||
      env.SUPABASE_URL ||
      'http://127.0.0.1:54321',
    anon:
      env.ANON_KEY ||
      env.SUPABASE_ANON_KEY,
    service:
      env.SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY,
  }
}

const env = localEnv()

assert.ok(env.anon, 'local anon key is required')
assert.ok(env.service, 'local service role key is required')

const service = createClient(
  env.url,
  env.service,
  opts,
)

function client() {
  return createClient(
    env.url,
    env.anon,
    opts,
  )
}

async function data(label, promise) {
  const { data, error } = await promise

  assert.ifError(
    error &&
      new Error(
        `${label}: ${error.message}`,
      ),
  )

  return data
}

async function createEmployee({
  role = 'employee',
  active = true,
  department = 'Administration',
} = {}) {
  const tag =
    crypto.randomBytes(6).toString('hex')

  const email =
    `chat-admin-${tag}@ridearrivo.com`

  const password =
    `Test-${tag}-Aa1!`

  const created =
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

  assert.ifError(created.error)

  const id = created.data.user.id

  const profile = await service
    .from('employee_profiles')
    .update({
      full_name:
        `Chat Admin ${tag}`,
      role,
      active,
      department,
    })
    .eq('id', id)
    .select()
    .single()

  assert.ifError(profile.error)

  return {
    id,
    email,
    password,
    role,
    active,
    department,
  }
}

async function signIn(user) {
  const c = client()

  const result =
    await c.auth.signInWithPassword({
      email:user.email,
      password:user.password,
    })

  assert.ifError(result.error)

  return c
}

async function expectDenied(
  label,
  promise,
) {
  const { error } = await promise

  assert.ok(
    error,
    `${label} should be denied`,
  )

  return error
}

const createdUsers = []

test.after(async()=>{
  for (const user of createdUsers) {
    await service.auth.admin.deleteUser(
      user.id,
    )
  }
})

test(
  'workspace admin can grant and revoke delegated Chat administrator access',
  async()=>{
    const admin =
      await createEmployee({
        role:'admin',
      })

    const target =
      await createEmployee({
        role:'employee',
      })

    createdUsers.push(
      admin,
      target,
    )

    const adminClient =
      await signIn(admin)

    const grantId =
      await data(
        'grant Chat admin',
        adminClient.rpc(
          'grant_workspace_chat_admin',
          {
            p_employee_id:
              target.id,
          },
        ),
      )

    assert.ok(grantId)

    const grant =
      await data(
        'active Chat admin grant',
        service
          .from(
            'workspace_chat_admin_grants',
          )
          .select(
            'employee_id,granted_by,revoked_at',
          )
          .eq(
            'employee_id',
            target.id,
          )
          .is(
            'revoked_at',
            null,
          )
          .single(),
      )

    assert.equal(
      grant.employee_id,
      target.id,
    )

    assert.equal(
      grant.granted_by,
      admin.id,
    )

    const revokeResult =
      await data(
        'revoke Chat admin',
        adminClient.rpc(
          'revoke_workspace_chat_admin',
          {
            p_employee_id:
              target.id,
          },
        ),
      )

    assert.equal(
      revokeResult,
      true,
    )

    const revoked =
      await data(
        'revoked Chat admin grant',
        service
          .from(
            'workspace_chat_admin_grants',
          )
          .select('revoked_at')
          .eq(
            'employee_id',
            target.id,
          )
          .not(
            'revoked_at',
            'is',
            null,
          )
          .order(
            'granted_at',
            {
              ascending:false,
            },
          )
          .limit(1)
          .single(),
      )

    assert.ok(
      revoked.revoked_at,
    )
  },
)

test(
  'ordinary employee cannot grant or revoke global Chat administrator access',
  async()=>{
    const ordinary =
      await createEmployee({
        role:'employee',
      })

    const target =
      await createEmployee({
        role:'employee',
      })

    createdUsers.push(
      ordinary,
      target,
    )

    const ordinaryClient =
      await signIn(ordinary)

    await expectDenied(
      'ordinary employee grant',
      ordinaryClient.rpc(
        'grant_workspace_chat_admin',
        {
          p_employee_id:
            target.id,
        },
      ),
    )

    await expectDenied(
      'ordinary employee revoke',
      ordinaryClient.rpc(
        'revoke_workspace_chat_admin',
        {
          p_employee_id:
            target.id,
        },
      ),
    )
  },
)

test(
  'delegated Chat admin cannot grant another global Chat admin',
  async()=>{
    const admin =
      await createEmployee({
        role:'admin',
      })

    const delegated =
      await createEmployee({
        role:'employee',
      })

    const target =
      await createEmployee({
        role:'employee',
      })

    createdUsers.push(
      admin,
      delegated,
      target,
    )

    const adminClient =
      await signIn(admin)

    await data(
      'seed delegated Chat admin',
      adminClient.rpc(
        'grant_workspace_chat_admin',
        {
          p_employee_id:
            delegated.id,
        },
      ),
    )

    const delegatedClient =
      await signIn(delegated)

    const isChatAdmin =
      await data(
        'delegated Chat authority',
        delegatedClient.rpc(
          'is_workspace_chat_admin',
        ),
      )

    assert.equal(
      isChatAdmin,
      true,
    )

    await expectDenied(
      'delegated Chat admin grant',
      delegatedClient.rpc(
        'grant_workspace_chat_admin',
        {
          p_employee_id:
            target.id,
        },
      ),
    )
  },
)

test(
  'inactive employee cannot receive delegated Chat administrator access',
  async()=>{
    const admin =
      await createEmployee({
        role:'admin',
      })

    const inactive =
      await createEmployee({
        role:'employee',
        active:false,
      })

    createdUsers.push(
      admin,
      inactive,
    )

    const adminClient =
      await signIn(admin)

    await expectDenied(
      'inactive employee grant',
      adminClient.rpc(
        'grant_workspace_chat_admin',
        {
          p_employee_id:
            inactive.id,
        },
      ),
    )
  },
)

test(
  'grant is idempotent for an already delegated Chat administrator',
  async()=>{
    const admin =
      await createEmployee({
        role:'admin',
      })

    const target =
      await createEmployee({
        role:'employee',
      })

    createdUsers.push(
      admin,
      target,
    )

    const adminClient =
      await signIn(admin)

    const first =
      await data(
        'first Chat admin grant',
        adminClient.rpc(
          'grant_workspace_chat_admin',
          {
            p_employee_id:
              target.id,
          },
        ),
      )

    const second =
      await data(
        'second Chat admin grant',
        adminClient.rpc(
          'grant_workspace_chat_admin',
          {
            p_employee_id:
              target.id,
          },
        ),
      )

    assert.equal(
      second,
      first,
    )

    const grants =
      await data(
        'active grants',
        service
          .from(
            'workspace_chat_admin_grants',
          )
          .select('id')
          .eq(
            'employee_id',
            target.id,
          )
          .is(
            'revoked_at',
            null,
          ),
      )

    assert.equal(
      grants.length,
      1,
    )
  },
)

test(
  'built-in HR and workspace admin authority is listed as non-revocable',
  async()=>{
    const admin =
      await createEmployee({
        role:'admin',
      })

    const hr =
      await createEmployee({
        role:'hr',
      })

    createdUsers.push(
      admin,
      hr,
    )

    const adminClient =
      await signIn(admin)

    const rows =
      await data(
        'list Chat admins',
        adminClient.rpc(
          'list_workspace_chat_admins',
        ),
      )

    const adminRow =
      rows.find(
        row =>
          row.employee_id ===
          admin.id,
      )

    const hrRow =
      rows.find(
        row =>
          row.employee_id ===
          hr.id,
      )

    assert.ok(adminRow)
    assert.ok(hrRow)

    assert.equal(
      adminRow.authority_source,
      'workspace_admin',
    )

    assert.equal(
      adminRow.revocable,
      false,
    )

    assert.equal(
      hrRow.authority_source,
      'hr',
    )

    assert.equal(
      hrRow.revocable,
      false,
    )

    await expectDenied(
      'revoke built-in HR authority',
      adminClient.rpc(
        'revoke_workspace_chat_admin',
        {
          p_employee_id:
            hr.id,
        },
      ),
    )
  },
)

test(
  'grant and revoke operations produce admin audit evidence',
  async()=>{
    const admin =
      await createEmployee({
        role:'admin',
      })

    const target =
      await createEmployee({
        role:'employee',
      })

    createdUsers.push(
      admin,
      target,
    )

    const adminClient =
      await signIn(admin)

    await data(
      'grant audited Chat admin',
      adminClient.rpc(
        'grant_workspace_chat_admin',
        {
          p_employee_id:
            target.id,
        },
      ),
    )

    await data(
      'revoke audited Chat admin',
      adminClient.rpc(
        'revoke_workspace_chat_admin',
        {
          p_employee_id:
            target.id,
        },
      ),
    )

    const events =
      await data(
        'Chat admin audit events',
        service
          .from(
            'admin_audit_log',
          )
          .select(
            'action,target_employee_id,source',
          )
          .eq(
            'target_employee_id',
            target.id,
          )
          .eq(
            'source',
            'chat-admin-management',
          ),
      )

    const actions =
      new Set(
        events.map(
          event=>event.action,
        ),
      )

    assert.ok(
      actions.has(
        'chat.admin.granted',
      ),
    )

    assert.ok(
      actions.has(
        'chat.admin.revoked',
      ),
    )
  },
)

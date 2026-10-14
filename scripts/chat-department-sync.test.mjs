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
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const env = {}

  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue

    let value = match[2].trim()

    if (value.startsWith('"') && value.endsWith('"')) {
      value = JSON.parse(value)
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }

    env[match[1]] = value
  }

  assert.ok(env.API_URL)
  assert.ok(env.ANON_KEY)
  assert.ok(env.SERVICE_ROLE_KEY)

  const host = new URL(env.API_URL).hostname

  assert.ok(
    host === '127.0.0.1' || host === 'localhost',
    `Refusing non-local API ${env.API_URL}`,
  )

  return {
    url: env.API_URL,
    anon: env.ANON_KEY,
    serviceKey: env.SERVICE_ROLE_KEY,
  }
}

async function data(label, promise) {
  const result = await promise

  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`)
  }

  return result.data
}

async function denied(label, promise, pattern) {
  const result = await promise

  assert.ok(
    result.error,
    `${label}: expected request to be denied`,
  )

  if (pattern) {
    assert.match(
      String(result.error.message || ''),
      pattern,
      `${label}: unexpected denial`,
    )
  }
}

async function withFixture(run) {
  const { url, anon, serviceKey } = localEnv()

  const service = createClient(url, serviceKey, opts)

  const tag = `chat-dept-${Date.now()}-${crypto.randomUUID()}`
  const users = []

  async function identity(
    key,
    {
      role = 'employee',
      department = `${tag}-General`,
      active = true,
    } = {},
  ) {
    const email = `${tag}-${key}@ridearrivo.com`
    const password = `LocalOnly!${crypto.randomUUID()}Aa1`

    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `Chat Department Test ${key}`,
      },
    })

    if (created.error || !created.data?.user) {
      throw new Error(
        `create ${key}: ${created.error?.message || 'missing user'}`,
      )
    }

    const user = {
      id: created.data.user.id,
      key,
      email,
      password,
    }

    users.push(user)

    await data(
      `profile ${key}`,
      service
        .from('employee_profiles')
        .upsert(
          {
            id: user.id,
            full_name: `Chat Department Test ${key}`,
            email,
            department,
            job_title: 'Local Department Chat test fixture',
            role,
            location: 'Lagos',
            active,
          },
          { onConflict: 'id' },
        ),
    )

    return user
  }

  async function login(user) {
    const client = createClient(url, anon, opts)

    const signed = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })

    if (signed.error) {
      throw new Error(
        `login ${user.key}: ${signed.error.message}`,
      )
    }

    return client
  }

  async function departmentRoom(department) {
    return data(
      `department room ${department}`,
      service
        .from('chat_rooms')
        .select(
          'conversation_id,room_type,department,status,history_policy',
        )
        .eq('room_type', 'department')
        .eq('department', department)
        .eq('status', 'active')
        .single(),
    )
  }

  async function membership(conversationId, userId) {
    return data(
      `membership ${userId}`,
      service
        .from('social_conversation_members')
        .select(
          'conversation_id,user_id,room_role,removed_at,history_from',
        )
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .single(),
    )
  }

  async function cleanup() {
    const rooms = await data(
      'fixture rooms',
      service
        .from('chat_rooms')
        .select('conversation_id,department')
        .like('department', `${tag}%`),
    )

    const conversationIds = rooms.map(
      room => room.conversation_id,
    )

    if (conversationIds.length) {
      await data(
        'cleanup conversations',
        service
          .from('social_conversations')
          .delete()
          .in('id', conversationIds),
      )
    }

    for (const user of [...users].reverse()) {
      const deleted = await service.auth.admin.deleteUser(user.id)

      if (deleted.error) {
        throw new Error(
          `cleanup ${user.key}: ${deleted.error.message}`,
        )
      }
    }

    const residual = await data(
      'residual profiles',
      service
        .from('employee_profiles')
        .select('id')
        .like('email', `${tag}%`),
    )

    assert.equal(
      residual.length,
      0,
      'test employee profiles must be cleaned up',
    )
  }

  let failure = null

  try {
    await run({
      service,
      identity,
      login,
      departmentRoom,
      membership,
      tag,
    })
  } catch (error) {
    failure = error
  }

  try {
    await cleanup()
  } catch (cleanupError) {
    if (!failure) failure = cleanupError
  }

  if (failure) throw failure
}

test(
  'active employee is auto-added to matching default department room with full history',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      identity,
      departmentRoom,
      membership,
      tag,
    }) => {
      const department = `${tag}-Engineering`

      const employee = await identity('member', {
        department,
      })

      const room = await departmentRoom(department)

      assert.equal(room.room_type, 'department')
      assert.equal(room.department, department)
      assert.equal(room.status, 'active')
      assert.equal(room.history_policy, 'full')

      const member = await membership(
        room.conversation_id,
        employee.id,
      )

      assert.equal(member.room_role, 'member')
      assert.equal(member.removed_at, null)
      assert.equal(
        member.history_from,
        null,
        'full-history membership must not have a lower history boundary',
      )
    })
  },
)

test(
  'department transfer atomically revokes old room and grants new room',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      service,
      identity,
      departmentRoom,
      membership,
      tag,
    }) => {
      const oldDepartment = `${tag}-Operations`
      const newDepartment = `${tag}-Finance`

      const employee = await identity('transfer', {
        department: oldDepartment,
      })

      const oldRoom = await departmentRoom(oldDepartment)

      await data(
        'transfer employee',
        service
          .from('employee_profiles')
          .update({
            department: newDepartment,
            updated_at: new Date().toISOString(),
          })
          .eq('id', employee.id)
          .select('id')
          .single(),
      )

      const newRoom = await departmentRoom(newDepartment)

      const oldMembership = await membership(
        oldRoom.conversation_id,
        employee.id,
      )

      const newMembership = await membership(
        newRoom.conversation_id,
        employee.id,
      )

      assert.ok(
        oldMembership.removed_at,
        'old department access must be revoked in the transfer transaction',
      )

      assert.equal(newMembership.removed_at, null)
      assert.equal(newMembership.room_role, 'member')

      const activeMemberships = await data(
        'active memberships',
        service
          .from('social_conversation_members')
          .select('conversation_id')
          .eq('user_id', employee.id)
          .is('removed_at', null),
      )

      const activeConversationIds = activeMemberships.map(
        row => row.conversation_id,
      )

      const activeDepartmentRooms = activeConversationIds.length
        ? await data(
            'active department rooms',
            service
              .from('chat_rooms')
              .select('conversation_id')
              .in('conversation_id', activeConversationIds)
              .eq('room_type', 'department'),
          )
        : []

      assert.equal(
        activeDepartmentRooms.length,
        1,
        'employee must have exactly one active default Department Room membership',
      )
    })
  },
)

test(
  'inactive employee loses all room access immediately',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      service,
      identity,
      login,
      departmentRoom,
      tag,
    }) => {
      const department = `${tag}-Support`

      const employee = await identity('inactive', {
        department,
      })

      const employeeClient = await login(employee)
      const room = await departmentRoom(department)

      const before = await data(
        'membership before deactivation',
        employeeClient.rpc(
          'is_conversation_member',
          { p_conversation_id: room.conversation_id },
        ),
      )

      assert.equal(before, true)

      await data(
        'deactivate employee',
        service
          .from('employee_profiles')
          .update({
            active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', employee.id)
          .select('id')
          .single(),
      )

      const after = await data(
        'membership after deactivation',
        employeeClient.rpc(
          'is_conversation_member',
          { p_conversation_id: room.conversation_id },
        ),
      )

      assert.equal(
        after,
        false,
        'existing authenticated session must fail closed immediately',
      )

      const remainingMemberships = await data(
        'remaining active memberships',
        service
          .from('social_conversation_members')
          .select('conversation_id')
          .eq('user_id', employee.id)
          .is('removed_at', null),
      )

      const remainingConversationIds = remainingMemberships.map(
        row => row.conversation_id,
      )

      const activeRoomMemberships = remainingConversationIds.length
        ? await data(
            'remaining governed rooms',
            service
              .from('chat_rooms')
              .select('conversation_id')
              .in('conversation_id', remainingConversationIds),
          )
        : []

      assert.equal(
        activeRoomMemberships.length,
        0,
        'inactive employee must retain no active governed-room membership',
      )
    })
  },
)

test(
  'department lead becomes owner and old lead loses owner role when assignment changes',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      identity,
      login,
      departmentRoom,
      membership,
      tag,
    }) => {
      const department = `${tag}-Marketing`

      const admin = await identity('admin', {
        role: 'admin',
        department: `${tag}-Administration`,
      })

      const firstLead = await identity('lead-one', {
        department,
      })

      const secondLead = await identity('lead-two', {
        department,
      })

      const adminClient = await login(admin)

      await data(
        'set first department lead',
        adminClient.rpc(
          'set_department_lead',
          {
            p_department: department,
            p_employee_id: firstLead.id,
          },
        ),
      )

      const room = await departmentRoom(department)

      const firstBefore = await membership(
        room.conversation_id,
        firstLead.id,
      )

      assert.equal(firstBefore.room_role, 'owner')

      await data(
        'replace department lead',
        adminClient.rpc(
          'set_department_lead',
          {
            p_department: department,
            p_employee_id: secondLead.id,
          },
        ),
      )

      const firstAfter = await membership(
        room.conversation_id,
        firstLead.id,
      )

      const secondAfter = await membership(
        room.conversation_id,
        secondLead.id,
      )

      assert.notEqual(
        firstAfter.room_role,
        'owner',
        'former department lead must lose owner authority',
      )

      assert.equal(secondAfter.room_role, 'owner')
      assert.equal(secondAfter.removed_at, null)
    })
  },
)

test(
  'ordinary employee cannot self-assign department lead or membership',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      identity,
      login,
      departmentRoom,
      tag,
    }) => {
      const ownDepartment = `${tag}-People`
      const foreignDepartment = `${tag}-Legal`

      const employee = await identity('ordinary', {
        department: ownDepartment,
      })

      await identity('foreign-member', {
        department: foreignDepartment,
      })

      const employeeClient = await login(employee)

      await denied(
        'ordinary employee set department lead',
        employeeClient.rpc(
          'set_department_lead',
          {
            p_department: ownDepartment,
            p_employee_id: employee.id,
          },
        ),
        /chat|admin|author|permission|access/i,
      )

      const foreignRoom = await departmentRoom(
        foreignDepartment,
      )

      await denied(
        'ordinary employee self-add membership',
        employeeClient
          .from('social_conversation_members')
          .insert({
            conversation_id: foreignRoom.conversation_id,
            user_id: employee.id,
            room_role: 'member',
          }),
        /permission|privilege|row-level|denied/i,
      )
    })
  },
)

test(
  'department lead source never infers from workstation head assignments',
  () => {
    const sql = readFileSync(
      new URL(
        '../supabase/migrations/20261013130200_chat_department_sync.sql',
        import.meta.url,
      ),
      'utf8',
    )

    assert.doesNotMatch(
      sql,
      /workspace_workstation_assignments/,
      'Chat department leads must come only from workspace_department_leads',
    )

    assert.doesNotMatch(
      sql,
      /\bis_head\b/,
      'Chat department lead authority must not be inferred from workstation heads',
    )
  },
)

test(
  'inactive employee has project room membership explicitly revoked',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      service,
      identity,
      membership,
      tag,
    }) => {
      const employee = await identity(
        'inactive-project-member',
        {
          department: `${tag}-Engineering`,
        },
      )

      const conversation = await data(
        'create project conversation',
        service
          .from('social_conversations')
          .insert({
            is_group: true,
            title: `${tag}-Project`,
            created_by: employee.id,
            conversation_kind: 'project',
          })
          .select('id')
          .single(),
      )

      await data(
        'create project room',
        service
          .from('chat_rooms')
          .insert({
            conversation_id: conversation.id,
            room_type: 'project',
            department: `${tag}-Engineering`,
            description:
              'Task 3 inactive governed-room regression fixture',
            status: 'active',
            history_policy: 'full',
            created_by: employee.id,
          }),
      )

      await data(
        'add project membership',
        service
          .from('social_conversation_members')
          .insert({
            conversation_id: conversation.id,
            user_id: employee.id,
            room_role: 'member',
            added_by: employee.id,
            removed_at: null,
            history_from: null,
          }),
      )

      const before = await membership(
        conversation.id,
        employee.id,
      )

      assert.equal(before.removed_at, null)

      await data(
        'deactivate project room employee',
        service
          .from('employee_profiles')
          .update({
            active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', employee.id)
          .select('id')
          .single(),
      )

      const after = await membership(
        conversation.id,
        employee.id,
      )

      assert.ok(
        after.removed_at,
        'inactive employee must have project room membership revoked, not merely hidden by active-user checks',
      )
    })
  },
)

test(
  'ordinary department sync preserves a manually appointed room admin',
  { timeout: 120000 },
  async () => {
    await withFixture(async ({
      service,
      identity,
      departmentRoom,
      membership,
      tag,
    }) => {
      const department =
        `${tag}-Operations`

      const employee = await identity(
        'appointed-room-admin',
        { department },
      )

      const room =
        await departmentRoom(department)

      await data(
        'appoint room admin',
        service
          .from('social_conversation_members')
          .update({
            room_role: 'admin',
          })
          .eq(
            'conversation_id',
            room.conversation_id,
          )
          .eq(
            'user_id',
            employee.id,
          )
          .select('user_id,room_role')
          .single(),
      )

      const before = await membership(
        room.conversation_id,
        employee.id,
      )

      assert.equal(
        before.room_role,
        'admin',
      )

      await data(
        'ordinary department resync',
        service.rpc(
          'sync_employee_department_room',
          {
            p_employee_id: employee.id,
          },
        ),
      )

      const after = await membership(
        room.conversation_id,
        employee.id,
      )

      assert.equal(
        after.room_role,
        'admin',
        'normal profile synchronization must not demote an appointed room admin',
      )
    })
  },
)

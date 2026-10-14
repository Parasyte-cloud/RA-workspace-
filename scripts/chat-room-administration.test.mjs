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
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const env = {}

  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue

    let value = match[2].trim()

    if (
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = JSON.parse(value)
    } else if (
      value.startsWith("'") &&
      value.endsWith("'")
    ) {
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
    throw new Error(
      `${label}: ${result.error.message}`,
    )
  }

  return result.data
}

async function fixture(run) {
  const {
    url,
    anon,
    serviceKey,
  } = localEnv()

  const service = createClient(
    url,
    serviceKey,
    opts,
  )

  const tag =
    `chat-room-admin-${Date.now()}-${crypto.randomUUID()}`

  const users = []
  const conversations = []

  async function identity(
    key,
    {
      role = 'employee',
      department = `${tag}-General`,
    } = {},
  ) {
    const email =
      `${tag}-${key}@ridearrivo.com`

    const password =
      `LocalOnly!${crypto.randomUUID()}Aa1`

    const created =
      await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name:
            `Chat Room Admin Test ${key}`,
        },
      })

    if (
      created.error ||
      !created.data?.user
    ) {
      throw new Error(
        `create ${key}: ${
          created.error?.message ||
          'missing user'
        }`,
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
            full_name:
              `Chat Room Admin Test ${key}`,
            email,
            department,
            job_title:
              'Local room administration fixture',
            role,
            location: 'Lagos',
            active: true,
          },
          {
            onConflict: 'id',
          },
        ),
    )

    return user
  }

  async function login(user) {
    const client = createClient(
      url,
      anon,
      opts,
    )

    const signed =
      await client.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      })

    if (signed.error) {
      throw new Error(
        `login ${user.key}: ${
          signed.error.message
        }`,
      )
    }

    return client
  }

  async function cleanup() {
    const structuralRooms = await data(
      'fixture department rooms',
      service
        .from('chat_rooms')
        .select('conversation_id')
        .like('department', `${tag}%`),
    )

    for (const room of structuralRooms) {
      conversations.push(room.conversation_id)
    }

    if (conversations.length) {
      await data(
        'cleanup conversations',
        service
          .from('social_conversations')
          .delete()
          .in('id', [...new Set(conversations)]),
      )
    }

    for (
      const user of [...users].reverse()
    ) {
      const deleted =
        await service.auth.admin.deleteUser(
          user.id,
        )

      if (deleted.error) {
        throw new Error(
          `cleanup ${user.key}: ${
            deleted.error.message
          }`,
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
      'room administration fixture must clean up',
    )
  }

  let failure = null

  try {
    await run({
      service,
      identity,
      login,
      conversations,
      tag,
    })
  } catch (error) {
    failure = error
  }

  try {
    await cleanup()
  } catch (cleanupError) {
    if (!failure) {
      failure = cleanupError
    }
  }

  if (failure) throw failure
}

test(
  'global Chat admin can create a governed project room',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      service,
      identity,
      login,
      conversations,
      tag,
    }) => {
      const admin =
        await identity(
          'admin',
          {
            role: 'admin',
          },
        )

      const client =
        await login(admin)

      const conversationId =
        await data(
          'create project room',
          client.rpc(
            'create_chat_room',
            {
              p_title:
                `${tag} Project`,
              p_room_type:
                'project',
              p_description:
                'Task 6 local integration test',
              p_history_policy:
                'full',
            },
          ),
        )

      assert.ok(
        conversationId,
        'create_chat_room must return a conversation id',
      )

      conversations.push(
        conversationId,
      )

      const room =
        await data(
          'created room',
          service
            .from('chat_rooms')
            .select(
              'conversation_id,room_type,status,history_policy,created_by',
            )
            .eq(
              'conversation_id',
              conversationId,
            )
            .single(),
        )

      assert.equal(
        room.room_type,
        'project',
      )

      assert.equal(
        room.status,
        'active',
      )

      assert.equal(
        room.history_policy,
        'full',
      )

      assert.equal(
        room.created_by,
        admin.id,
      )
    })
  },
)

test(
  'governed room creation rejects ordinary employees and makes the creator owner',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      service,
      identity,
      login,
      conversations,
      tag,
    }) => {
      const admin = await identity(
        'governance-admin',
        { role: 'admin' },
      )

      const ordinary = await identity(
        'governance-ordinary',
      )

      const adminClient = await login(admin)
      const ordinaryClient = await login(ordinary)

      for (const type of [
        'committee',
        'restricted',
      ]) {
        const created = await data(
          `create ${type}`,
          adminClient.rpc(
            'create_chat_room',
            {
              p_title: `${tag} ${type}`,
              p_room_type: type,
              p_description: null,
              p_history_policy:
                type === 'restricted'
                  ? 'from_join_date'
                  : 'full',
            },
          ),
        )

        assert.ok(created)
        conversations.push(created)

        const member = await data(
          `creator membership ${type}`,
          service
            .from('social_conversation_members')
            .select('room_role,removed_at')
            .eq('conversation_id', created)
            .eq('user_id', admin.id)
            .single(),
        )

        assert.equal(
          member.room_role,
          'owner',
        )

        assert.equal(
          member.removed_at,
          null,
        )
      }

      const deniedCreate =
        await ordinaryClient.rpc(
          'create_chat_room',
          {
            p_title:
              `${tag} forbidden`,
            p_room_type: 'project',
            p_description: null,
            p_history_policy: 'full',
          },
        )

      assert.ok(
        deniedCreate.error,
        'ordinary employee must not create governed rooms',
      )

      assert.match(
        String(
          deniedCreate.error.message || '',
        ),
        /Chat administrator access required/i,
      )
    })
  },
)

test(
  'room owner can administer own room but not another room',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      identity,
      login,
      conversations,
      tag,
    }) => {
      const globalAdmin = await identity(
        'scope-global-admin',
        { role: 'admin' },
      )

      const roomOwner = await identity(
        'scope-room-owner',
      )

      const target = await identity(
        'scope-target',
      )

      const globalClient = await login(
        globalAdmin,
      )

      const ownerClient = await login(
        roomOwner,
      )

      const roomA = await data(
        'create room A',
        globalClient.rpc(
          'create_chat_room',
          {
            p_title: `${tag} room A`,
            p_room_type: 'project',
            p_description: null,
            p_history_policy: 'full',
          },
        ),
      )

      const roomB = await data(
        'create room B',
        globalClient.rpc(
          'create_chat_room',
          {
            p_title: `${tag} room B`,
            p_room_type: 'committee',
            p_description: null,
            p_history_policy: 'full',
          },
        ),
      )

      conversations.push(roomA, roomB)

      await data(
        'add future owner',
        globalClient.rpc(
          'add_chat_room_member',
          {
            p_conversation_id: roomA,
            p_employee_id: roomOwner.id,
            p_room_role: 'member',
          },
        ),
      )

      await data(
        'promote future owner',
        globalClient.rpc(
          'set_chat_room_member_role',
          {
            p_conversation_id: roomA,
            p_employee_id: roomOwner.id,
            p_room_role: 'owner',
          },
        ),
      )

      await data(
        'owner adds target to own room',
        ownerClient.rpc(
          'add_chat_room_member',
          {
            p_conversation_id: roomA,
            p_employee_id: target.id,
            p_room_role: 'member',
          },
        ),
      )

      const ownRoomResult =
        await ownerClient.rpc(
          'remove_chat_room_member',
          {
            p_conversation_id: roomA,
            p_employee_id: target.id,
          },
        )

      assert.equal(
        ownRoomResult.error,
        null,
        'room owner must administer own room',
      )

      const crossRoomResult =
        await ownerClient.rpc(
          'add_chat_room_member',
          {
            p_conversation_id: roomB,
            p_employee_id: target.id,
            p_room_role: 'member',
          },
        )

      assert.ok(
        crossRoomResult.error,
        'room owner must not administer another room',
      )

      assert.match(
        String(
          crossRoomResult.error.message || '',
        ),
        /Room administrator access required/i,
      )
    })
  },
)

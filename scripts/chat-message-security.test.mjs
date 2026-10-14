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

    if (value.startsWith('"') && value.endsWith('"')) {
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
    throw new Error(`${label}: ${result.error.message}`)
  }

  return result.data
}

async function denied(label, promise) {
  const result = await promise

  assert.ok(
    result.error,
    `${label}: expected request to be denied`,
  )

  return result.error
}

function rpcRow(value) {
  return Array.isArray(value) ? value[0] : value
}

async function fixture(run) {
  const { url, anon, serviceKey } = localEnv()

  const service = createClient(
    url,
    serviceKey,
    opts,
  )

  const tag =
    `chat-message-${Date.now()}-${crypto.randomUUID()}`

  const users = []
  const conversations = []

  async function identity(
    key,
    department,
    active = true,
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
          full_name: `Chat Message Test ${key}`,
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
      email,
      password,
      key,
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
              `Chat Message Test ${key}`,
            email,
            department,
            job_title:
              'Local Chat message fixture',
            role: 'employee',
            location: 'Lagos',
            active,
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

    const result =
      await client.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      })

    if (result.error) {
      throw new Error(
        `login ${user.key}: ${
          result.error.message
        }`,
      )
    }

    return client
  }

  async function createRoom(
    owner,
    {
      kind = 'project',
      historyPolicy = 'full',
    } = {},
  ) {
    const conversation = await data(
      'create conversation',
      service
        .from('social_conversations')
        .insert({
          is_group: true,
          title: `${tag} ${kind}`,
          created_by: owner.id,
          conversation_kind: kind,
        })
        .select('id')
        .single(),
    )

    conversations.push(
      conversation.id,
    )

    await data(
      'create room',
      service
        .from('chat_rooms')
        .insert({
          conversation_id:
            conversation.id,
          room_type: kind,
          description:
            'Local message security fixture',
          status: 'active',
          history_policy:
            historyPolicy,
          created_by: owner.id,
        }),
    )

    await data(
      'owner membership',
      service
        .from(
          'social_conversation_members',
        )
        .insert({
          conversation_id:
            conversation.id,
          user_id: owner.id,
          room_role: 'owner',
          added_by: owner.id,
          history_from: null,
          removed_at: null,
        }),
    )

    return conversation.id
  }

  async function addMember(
    conversationId,
    user,
    {
      historyFrom = null,
      removedAt = null,
    } = {},
  ) {
    await data(
      `membership ${user.key}`,
      service
        .from(
          'social_conversation_members',
        )
        .insert({
          conversation_id:
            conversationId,
          user_id: user.id,
          room_role: 'member',
          added_by: user.id,
          history_from: historyFrom,
          removed_at: removedAt,
        }),
    )
  }

  async function cleanup() {
    const departmentRooms = await data(
      'tagged department rooms',
      service
        .from('chat_rooms')
        .select('conversation_id')
        .like(
          'department',
          `${tag}%`,
        ),
    )

    const allConversationIds = [
      ...new Set([
        ...conversations,
        ...departmentRooms.map(
          row => row.conversation_id,
        ),
      ]),
    ]

    if (allConversationIds.length) {
      await data(
        'cleanup conversations',
        service
          .from('social_conversations')
          .delete()
          .in(
            'id',
            allConversationIds,
          ),
      )
    }

    for (
      const user of [...users].reverse()
    ) {
      const result =
        await service.auth.admin.deleteUser(
          user.id,
        )

      if (result.error) {
        throw new Error(
          `cleanup ${user.key}: ${
            result.error.message
          }`,
        )
      }
    }

    const residual = await data(
      'residual test profiles',
      service
        .from('employee_profiles')
        .select('id')
        .like(
          'email',
          `${tag}%`,
        ),
    )

    assert.equal(
      residual.length,
      0,
      'message security fixtures must clean up',
    )
  }

  function trackConversation(conversationId) {
    conversations.push(conversationId)
  }

  let failure = null

  try {
    await run({
      service,
      identity,
      login,
      createRoom,
      addMember,
      trackConversation,
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
  'current room member may send and read messages',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      identity,
      login,
      createRoom,
      addMember,
    }) => {
      const owner =
        await identity(
          'owner',
          'Engineering',
        )

      const member =
        await identity(
          'member',
          'Engineering',
        )

      const conversationId =
        await createRoom(owner)

      await addMember(
        conversationId,
        member,
      )

      const memberClient =
        await login(member)

      const rawSent = await data(
        'send member message',
        memberClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              conversationId,
            p_body:
              'Hello governed room',
            p_reply_to_id: null,
            p_client_message_id:
              crypto.randomUUID(),
          },
        ),
      )

      const sent = rpcRow(rawSent)

      assert.ok(sent?.id)

      assert.equal(
        sent.conversation_id,
        conversationId,
      )

      const visible = await data(
        'read member messages',
        memberClient
          .from('social_messages')
          .select(
            'id,conversation_id,body',
          )
          .eq(
            'conversation_id',
            conversationId,
          ),
      )

      assert.equal(
        visible.length,
        1,
      )

      assert.equal(
        visible[0].body,
        'Hello governed room',
      )
    })
  },
)

test(
  'removed inactive and foreign employees cannot send or read room messages',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      service,
      identity,
      login,
      createRoom,
      addMember,
    }) => {
      const owner =
        await identity(
          'owner',
          'Operations',
        )

      const removed =
        await identity(
          'removed',
          'Operations',
        )

      const inactive =
        await identity(
          'inactive',
          'Operations',
        )

      const foreign =
        await identity(
          'foreign',
          'Legal',
        )

      const conversationId =
        await createRoom(owner)

      await addMember(
        conversationId,
        removed,
      )

      await addMember(
        conversationId,
        inactive,
      )

      const ownerClient =
        await login(owner)

      const removedClient =
        await login(removed)

      const inactiveClient =
        await login(inactive)

      const foreignClient =
        await login(foreign)

      await data(
        'seed message',
        ownerClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              conversationId,
            p_body:
              'Restricted history',
            p_reply_to_id: null,
            p_client_message_id:
              crypto.randomUUID(),
          },
        ),
      )

      await data(
        'remove member',
        service
          .from(
            'social_conversation_members',
          )
          .update({
            removed_at:
              new Date().toISOString(),
          })
          .eq(
            'conversation_id',
            conversationId,
          )
          .eq(
            'user_id',
            removed.id,
          )
          .select('user_id')
          .single(),
      )

      await data(
        'deactivate member',
        service
          .from('employee_profiles')
          .update({
            active: false,
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', inactive.id)
          .select('id')
          .single(),
      )

      for (
        const [label, client]
        of [
          ['removed', removedClient],
          ['inactive', inactiveClient],
          ['foreign', foreignClient],
        ]
      ) {
        await denied(
          `${label} send`,
          client.rpc(
            'send_chat_message',
            {
              p_conversation_id:
                conversationId,
              p_body:
                'Must not persist',
              p_reply_to_id: null,
              p_client_message_id:
                crypto.randomUUID(),
            },
          ),
        )

        const visible = await data(
          `${label} read`,
          client
            .from('social_messages')
            .select('id')
            .eq(
              'conversation_id',
              conversationId,
            ),
        )

        assert.equal(
          visible.length,
          0,
          `${label} employee must not see room history`,
        )
      }
    })
  },
)

test(
  'from_join_date hides older messages and permits messages at or after history_from',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      service,
      identity,
      login,
      createRoom,
      addMember,
    }) => {
      const owner =
        await identity(
          'owner',
          'Finance',
        )

      const member =
        await identity(
          'member',
          'Finance',
        )

      const conversationId =
        await createRoom(
          owner,
          {
            historyPolicy:
              'from_join_date',
          },
        )

      const boundary =
        new Date(
          Date.now() - 60_000,
        )

      const before =
        new Date(
          boundary.getTime() -
            60_000,
        ).toISOString()

      const after =
        new Date(
          boundary.getTime() +
            60_000,
        ).toISOString()

      await data(
        'seed deterministic history',
        service
          .from('social_messages')
          .insert([
            {
              conversation_id:
                conversationId,
              sender_id: owner.id,
              body:
                'Before membership',
              created_at: before,
            },
            {
              conversation_id:
                conversationId,
              sender_id: owner.id,
              body:
                'After membership',
              created_at: after,
            },
          ]),
      )

      await addMember(
        conversationId,
        member,
        {
          historyFrom:
            boundary.toISOString(),
        },
      )

      const memberClient =
        await login(member)

      const rows = await data(
        'history-aware read',
        memberClient
          .from('social_messages')
          .select(
            'body,created_at',
          )
          .eq(
            'conversation_id',
            conversationId,
          )
          .order('created_at'),
      )

      assert.deepEqual(
        rows.map(
          row => row.body,
        ),
        ['After membership'],
      )

      assert.ok(
        new Date(
          rows[0].created_at,
        ) >= boundary,
      )
    })
  },
)

test(
  'duplicate client message id returns the same persisted message',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      service,
      identity,
      login,
      createRoom,
    }) => {
      const owner =
        await identity(
          'owner',
          'Marketing',
        )

      const conversationId =
        await createRoom(owner)

      const ownerClient =
        await login(owner)

      const clientMessageId =
        crypto.randomUUID()

      const rawFirst = await data(
        'first send',
        ownerClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              conversationId,
            p_body:
              'Retry-safe message',
            p_reply_to_id: null,
            p_client_message_id:
              clientMessageId,
          },
        ),
      )

      const first =
        rpcRow(rawFirst)

      const rawSecond = await data(
        'retry send',
        ownerClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              conversationId,
            p_body:
              'Retry-safe message',
            p_reply_to_id: null,
            p_client_message_id:
              clientMessageId,
          },
        ),
      )

      const second =
        rpcRow(rawSecond)

      assert.equal(
        second.id,
        first.id,
      )

      const persisted = await data(
        'persisted retry-safe messages',
        service
          .from('social_messages')
          .select('id')
          .eq(
            'conversation_id',
            conversationId,
          )
          .eq(
            'client_message_id',
            clientMessageId,
          ),
      )

      assert.equal(
        persisted.length,
        1,
        'retry must not create a duplicate message',
      )
    })
  },
)


test(
  'direct messages preserve existing send and read semantics',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      identity,
      login,
      trackConversation,
    }) => {
      const first =
        await identity(
          'direct-first',
          'Engineering',
        )

      const second =
        await identity(
          'direct-second',
          'Finance',
        )

      const firstClient =
        await login(first)

      const secondClient =
        await login(second)

      const conversationId =
        await data(
          'start direct conversation',
          firstClient.rpc(
            'start_or_get_social_direct_conversation',
            {
              p_other_user: second.id,
            },
          ),
        )

      assert.ok(conversationId)

      trackConversation(conversationId)

      const rawSent = await data(
        'send direct message',
        firstClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              conversationId,
            p_body:
              'Private direct message',
            p_reply_to_id: null,
            p_client_message_id:
              crypto.randomUUID(),
          },
        ),
      )

      const sent = rpcRow(rawSent)

      assert.ok(sent?.id)

      assert.equal(
        sent.conversation_id,
        conversationId,
      )

      assert.equal(
        sent.sender_id,
        first.id,
      )

      const visible = await data(
        'read direct message',
        secondClient
          .from('social_messages')
          .select(
            'id,conversation_id,sender_id,body',
          )
          .eq(
            'conversation_id',
            conversationId,
          )
          .eq(
            'id',
            sent.id,
          ),
      )

      assert.equal(
        visible.length,
        1,
      )

      assert.equal(
        visible[0].body,
        'Private direct message',
      )

      assert.equal(
        visible[0].sender_id,
        first.id,
      )
    })
  },
)

test(
  'a message cannot reply to a message from another conversation',
  { timeout: 120000 },
  async () => {
    await fixture(async ({
      identity,
      login,
      createRoom,
    }) => {
      const owner =
        await identity(
          'reply-owner',
          'Legal',
        )

      const firstConversationId =
        await createRoom(owner)

      const secondConversationId =
        await createRoom(owner)

      const ownerClient =
        await login(owner)

      const rawOriginal = await data(
        'send original reply target',
        ownerClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              firstConversationId,
            p_body:
              'Original message',
            p_reply_to_id: null,
            p_client_message_id:
              crypto.randomUUID(),
          },
        ),
      )

      const original =
        rpcRow(rawOriginal)

      assert.ok(original?.id)

      const error = await denied(
        'cross-conversation reply',
        ownerClient.rpc(
          'send_chat_message',
          {
            p_conversation_id:
              secondConversationId,
            p_body:
              'Invalid cross-room reply',
            p_reply_to_id:
              original.id,
            p_client_message_id:
              crypto.randomUUID(),
          },
        ),
      )

      assert.match(
        error.message,
        /Reply message not found or not accessible|same chat/i,
      )

      const persisted = await data(
        'verify rejected reply absent',
        ownerClient
          .from('social_messages')
          .select('id')
          .eq(
            'conversation_id',
            secondConversationId,
          )
          .eq(
            'body',
            'Invalid cross-room reply',
          ),
      )

      assert.equal(
        persisted.length,
        0,
      )
    })
  },
)

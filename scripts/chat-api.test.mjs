import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

let loadSerial = 0

async function loadApi(fakeClient) {
  assert.ok(
    existsSync('src/chat/api/chatApi.ts'),
    'src/chat/api/chatApi.ts must exist',
  )

  let source = readFileSync(
    'src/chat/api/chatApi.ts',
    'utf8',
  )

  const original = source

  source = source.replace(
    /import\s*\{\s*supabase\s*\}\s*from\s*['"][^'"]+['"];?\s*/,
    'const supabase = globalThis.__CHAT_API_TEST_SUPABASE__;\n',
  )

  assert.notEqual(
    source,
    original,
    'chatApi.ts must import the shared supabase client',
  )

  globalThis.__CHAT_API_TEST_SUPABASE__ = fakeClient

  const js =
    transformSync(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
    }).code +
    `\n// test-load-${++loadSerial}\n`

  return import(
    `data:text/javascript;base64,${Buffer
      .from(js)
      .toString('base64')}`
  )
}

function successfulClient(row) {
  const calls = []

  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args })

        return {
          data: row,
          error: null,
        }
      },
    },
  }
}

test(
  'sendMessage maps a successful RPC response',
  async () => {
    const persisted = {
      id: 'message-1',
      conversation_id: 'conversation-1',
      sender_id: 'employee-1',
      body: 'Hello',
      reply_to_id: null,
      client_message_id: 'client-1',
      edited_at: null,
      deleted_at: null,
      created_at: '2026-10-14T08:00:00.000Z',
    }

    const fake = successfulClient(persisted)
    const api = await loadApi(fake.client)

    const result = await api.sendMessage({
      conversationId: 'conversation-1',
      body: 'Hello',
      replyToId: null,
      clientMessageId: 'client-1',
    })

    assert.deepEqual(result, persisted)

    assert.deepEqual(fake.calls, [
      {
        name: 'send_chat_message',
        args: {
          p_conversation_id: 'conversation-1',
          p_body: 'Hello',
          p_reply_to_id: null,
          p_client_message_id: 'client-1',
        },
      },
    ])
  },
)

test(
  'sendMessage surfaces an RPC failure',
  async () => {
    const fakeClient = {
      async rpc() {
        return {
          data: null,
          error: {
            message:
              'Conversation write access required',
          },
        }
      },
    }

    const api = await loadApi(fakeClient)

    await assert.rejects(
      () =>
        api.sendMessage({
          conversationId: 'conversation-1',
          body: 'Must not appear sent',
          replyToId: null,
          clientMessageId: 'client-denied',
        }),
      /Conversation write access required/,
    )
  },
)

test(
  'sendMessage reuses the caller supplied client id on retry',
  async () => {
    const persisted = {
      id: 'message-2',
      conversation_id: 'conversation-2',
      sender_id: 'employee-2',
      body: 'Retry me',
      reply_to_id: null,
      client_message_id: 'stable-client-id',
      edited_at: null,
      deleted_at: null,
      created_at: '2026-10-14T08:01:00.000Z',
    }

    const fake = successfulClient(persisted)
    const api = await loadApi(fake.client)

    const input = {
      conversationId: 'conversation-2',
      body: 'Retry me',
      replyToId: null,
      clientMessageId: 'stable-client-id',
    }

    const first = await api.sendMessage(input)
    const retry = await api.sendMessage(input)

    assert.equal(first.id, retry.id)
    assert.equal(fake.calls.length, 2)

    assert.equal(
      fake.calls[0].args.p_client_message_id,
      'stable-client-id',
    )

    assert.equal(
      fake.calls[1].args.p_client_message_id,
      'stable-client-id',
    )
  },
)

test(
  'chat types expose a database-aligned conversation summary',
  () => {
    const source = readFileSync(
      'src/chat/types.ts',
      'utf8',
    )

    const kindMatch = source.match(
      /export type ConversationKind\s*=\s*([\s\S]*?)(?=\n\nexport type)/,
    )

    assert.ok(
      kindMatch,
      'ConversationKind must be exported',
    )

    for (const kind of [
      'direct',
      'department',
      'project',
      'committee',
      'restricted',
    ]) {
      assert.match(
        kindMatch[1],
        new RegExp(`['"]${kind}['"]`),
        `ConversationKind must include ${kind}`,
      )
    }

    const summaryMatch = source.match(
      /export type ConversationSummary\s*=\s*\{([\s\S]*?)\n\}/,
    )

    assert.ok(
      summaryMatch,
      'ConversationSummary must be exported',
    )

    const body = summaryMatch[1]

    for (const field of [
      'id',
      'is_group',
      'title',
      'created_by',
      'created_at',
      'conversation_kind',
    ]) {
      assert.match(
        body,
        new RegExp(`\\b${field}\\s*:`),
        `ConversationSummary must expose ${field}`,
      )
    }

    assert.match(
      body,
      /conversation_kind\s*:\s*ConversationKind/,
    )
  },
)

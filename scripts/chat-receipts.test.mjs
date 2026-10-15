import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
} from 'node:fs'
import { transformSync } from 'esbuild'

const migration =
  'supabase/migrations/20261015113000_chat_message_receipts.sql'

const api =
  'src/chat/api/chatReceipts.ts'

const shell =
  'src/chat/ChatShell.tsx'

test(
  'message receipts have an authoritative database model',
  () => {
    assert.ok(
      existsSync(migration),
      'chat message receipt migration must exist',
    )

    const sql =
      readFileSync(migration, 'utf8')

    assert.match(
      sql,
      /create table if not exists public\.chat_message_receipts/i,
    )

    assert.match(
      sql,
      /primary key\s*\(\s*message_id\s*,\s*user_id\s*\)/i,
    )

    assert.match(
      sql,
      /seed_chat_message_receipts/i,
    )

    assert.match(
      sql,
      /after insert on public\.social_messages/i,
    )

    assert.match(
      sql,
      /ack_chat_delivered/i,
    )

    assert.match(
      sql,
      /ack_chat_delivered\s*\(\s*p_message_ids\s+uuid\[\]/i,
      'delivery acknowledgement must receive explicit message ids',
    )

    assert.match(
      sql,
      /receipt\.message_id\s*=\s*any\s*\(\s*p_message_ids\s*\)/i,
      'delivery must update only messages actually received by this client',
    )

    assert.match(
      sql,
      /ack_chat_read/i,
    )

    assert.match(
      sql,
      /chat_receipt_summary/i,
    )

    assert.match(
      sql,
      /enable row level security/i,
    )

    assert.match(
      sql,
      /m\.user_id\s*<>\s*new\.sender_id/i,
      'sender must never receive a receipt row for their own message',
    )
  },
)

test(
  'receipt state distinguishes sent delivered and seen',
  async () => {
    assert.ok(
      existsSync(api),
      'chat receipt client must exist',
    )

    const source =
      readFileSync(api, 'utf8')

    const isolatedSource =
      source.replace(
        "import { supabase } from '../../lib/supabase'",
        'const supabase = null',
      )

    assert.notEqual(
      isolatedSource,
      source,
      'test harness must isolate the Supabase dependency',
    )

    const js =
      transformSync(
        isolatedSource,
        {
          loader: 'ts',
          format: 'esm',
        },
      ).code

    const module =
      await import(
        `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
      )

    assert.equal(
      module.receiptState(undefined, false),
      'sent',
    )

    assert.equal(
      module.receiptState(
        {
          message_id: 'm',
          recipient_count: 1,
          delivered_count: 1,
          read_count: 0,
          delivered_by: ['A'],
          read_by: [],
        },
        false,
      ),
      'delivered',
    )

    assert.equal(
      module.receiptState(
        {
          message_id: 'm',
          recipient_count: 1,
          delivered_count: 1,
          read_count: 1,
          delivered_by: ['A'],
          read_by: ['A'],
        },
        false,
      ),
      'read',
    )

    assert.equal(
      module.receiptState(undefined, true),
      'read',
      'legacy DM read state remains a safe fallback',
    )
  },
)

test(
  'chat UI acknowledges and renders delivery and seen feedback',
  () => {
    const ui =
      readFileSync(shell, 'utf8')

    assert.match(
      ui,
      /ackChatDelivered/,
    )

    assert.doesNotMatch(
      ui,
      /ackAllChatDelivered/,
      'sign-in alone must not mark every unread message delivered',
    )

    assert.match(
      ui,
      /ackChatRead/,
    )

    assert.match(
      ui,
      /listReceiptSummaries/,
    )

    assert.match(
      ui,
      /receiptSummaries/,
    )

    assert.match(
      ui,
      /Delivered/,
    )

    assert.match(
      ui,
      /Seen/,
    )

    assert.match(
      ui,
      /cmReceiptLabel/,
    )

    assert.match(
      ui,
      /chat_message_receipts/,
      'receipt changes must update ticks in realtime',
    )
  },
)

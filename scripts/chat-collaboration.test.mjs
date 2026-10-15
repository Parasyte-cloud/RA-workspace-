import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
} from 'node:fs'

const read = path =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
    : ''

const shell = read(
  'src/chat/ChatShell.tsx',
)

const roomList = read(
  'src/chat/conversations/RoomList.tsx',
)

const api = read(
  'src/chat/api/chatApi.ts',
)

const types = read(
  'src/chat/types.ts',
)

const css = read(
  'src/chat.css',
)

const mentionUi = read(
  'src/chat/messages/MentionSuggestions.tsx',
)

const migration = read(
  'supabase/migrations/20261015003000_chat_mentions_notifications.sql',
)

test(
  'typing @ in a governed room exposes active room-member suggestions',
  () => {
    assert.match(
      shell,
      /MentionSuggestions/,
      'ChatShell must render the mention suggestion surface',
    )

    assert.match(
      shell,
      /roomMembers/,
      'mention suggestions must come from active room membership',
    )

    assert.match(
      mentionUi,
      /role="listbox"/,
      'mention suggestions must be keyboard-accessible',
    )

    assert.match(
      mentionUi,
      /onSelect/,
      'selecting a person must return the selected room member',
    )
  },
)

test(
  'message send carries authoritative mentioned employee ids',
  () => {
    assert.match(
      types,
      /mentionedUserIds\??:\s*string\[\]/,
      'send input must carry mention ids separately from display text',
    )

    assert.match(
      api,
      /send_chat_message_with_mentions/,
      'mentions must use a secured database RPC',
    )

    assert.match(
      api,
      /p_mentioned_user_ids/,
      'the secured RPC must receive explicit employee ids',
    )
  },
)

test(
  'database accepts mentions only for active members of that conversation',
  () => {
    assert.ok(
      migration,
      'chat mention migration must exist',
    )

    assert.match(
      migration,
      /chat_message_mentions/,
    )

    assert.match(
      migration,
      /send_chat_message_with_mentions/,
    )

    assert.match(
      migration,
      /social_conversation_members/,
    )

    assert.match(
      migration,
      /removed_at\s+is\s+null/i,
      'removed room members must not be mentionable',
    )

    assert.match(
      migration,
      /employee_profiles/,
    )

    assert.match(
      migration,
      /active\s*=\s*true/i,
      'inactive employees must not be mentionable',
    )

    assert.match(
      migration,
      /security definer/i,
    )

    assert.match(
      migration,
      /set search_path\s*=\s*public,\s*pg_temp/i,
    )
  },
)

test(
  'mentions upgrade the conversation notification without creating a second conversation alert',
  () => {
    assert.match(
      migration,
      /chat_mention/,
    )

    assert.match(
      migration,
      /type\s*=\s*'chat_mention'/,
    )

    assert.match(
      migration,
      /entity_type\s*=\s*'social_conversation'/,
    )
  },
)

test(
  'rooms expose WhatsApp-style unread and mention indicators',
  () => {
    assert.match(
      types,
      /unread\??:\s*number/,
      'room summaries need an unread count',
    )

    assert.match(
      types,
      /mentioned\??:\s*boolean/,
      'room summaries need unread mention state',
    )

    assert.match(
      roomList,
      /room\.unread/,
      'room navigation must show unread activity',
    )

    assert.match(
      roomList,
      /room\.mentioned/,
      'room navigation must distinguish unread mentions',
    )

    assert.match(
      css,
      /\.cmRoomUnread/,
    )

    assert.match(
      css,
      /\.cmRoomMention/,
    )
  },
)

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

function source(relativePath) {
  const fullPath = path.join(
    repoRoot,
    relativePath,
  )

  assert.ok(
    fs.existsSync(fullPath),
    `${relativePath} must exist`,
  )

  return fs.readFileSync(fullPath, 'utf8')
}

test('Task 6 room UI surface exists', () => {
  for (const relativePath of [
    'src/chat/api/roomApi.ts',
    'src/chat/rooms/RoomCreator.tsx',
    'src/chat/rooms/RoomDetails.tsx',
    'src/chat/rooms/RoomMembers.tsx',
    'src/chat/rooms/RoomSettings.tsx',
    'src/chat/rooms/RoomAdminPanel.tsx',
    'src/chat/conversations/ConversationSearch.tsx',
  ]) {
    source(relativePath)
  }
})

test('room API exposes typed secured room mutations', () => {
  const api = source(
    'src/chat/api/roomApi.ts',
  )

  for (const exportedName of [
    'createRoom',
    'addRoomMember',
    'removeRoomMember',
    'setRoomMemberRole',
    'archiveRoom',
  ]) {
    assert.match(
      api,
      new RegExp(
        `export\\s+async\\s+function\\s+${exportedName}\\b`,
      ),
    )
  }

  for (const rpc of [
    'create_chat_room',
    'add_chat_room_member',
    'remove_chat_room_member',
    'set_chat_room_member_role',
    'archive_chat_room',
  ]) {
    assert.match(
      api,
      new RegExp(`['"]${rpc}['"]`),
    )
  }
})

test('room creation is capability driven rather than role or job-title inferred', () => {
  const creator = source(
    'src/chat/rooms/RoomCreator.tsx',
  )

  assert.match(
    creator,
    /canCreateRoom/,
  )

  assert.doesNotMatch(
    creator,
    /job_title|jobTitle/,
  )

  assert.doesNotMatch(
    creator,
    /role\s*===\s*['"](hr|admin|manager|director)['"]/i,
  )
})

test('room administration separates same-room authority from global authority', () => {
  const panel = source(
    'src/chat/rooms/RoomAdminPanel.tsx',
  )

  assert.match(
    panel,
    /canAdministerRoom/,
  )

  assert.match(
    panel,
    /isGlobalChatAdmin/,
  )

  assert.match(
    panel,
    /department/i,
  )
})

test('ChatShell loads conversation_kind instead of filtering rooms out with is_group=false', () => {
  const shell = source(
    'src/chat/ChatShell.tsx',
  )

  assert.match(
    shell,
    /conversation_kind/,
  )

  assert.doesNotMatch(
    shell,
    /\.eq\(\s*['"]is_group['"]\s*,\s*false\s*\)/,
  )

  assert.match(
    shell,
    /department|project|committee|restricted/,
  )
})

test('ChatShell wires room and direct-message collections into the conversation navigation', () => {
  const shell = source(
    'src/chat/ChatShell.tsx',
  )

  assert.match(
    shell,
    /rooms=/,
  )

  assert.match(
    shell,
    /directMessages=/,
  )

  assert.match(
    shell,
    /RoomDetails/,
  )
})

test('responsive room navigation has an explicit details state and does not require hover', () => {
  const shell = source(
    'src/chat/ChatShell.tsx',
  )

  const details = source(
    'src/chat/rooms/RoomDetails.tsx',
  )

  const css = source(
    'src/chat.css',
  )

  assert.match(
    shell,
    /mobile.*details|details.*mobile/i,
  )

  assert.match(
    details,
    /button/i,
  )

  assert.match(
    css,
    /\.cmDetails/,
  )

  assert.match(
    css,
    /@media\s*\(max-width:\s*860px\)/,
  )
})

test('ChatShell actually mounts room creation and shared conversation search', () => {
  const shell = source(
    'src/chat/ChatShell.tsx',
  )

  assert.match(
    shell,
    /import\s+\{\s*RoomCreator\s*\}/,
    'ChatShell must import RoomCreator',
  )

  assert.match(
    shell,
    /<RoomCreator\b/,
    'ChatShell must render the governed room creator',
  )

  assert.match(
    shell,
    /canCreateRoom=\{isGlobalChatAdmin\}/,
    'room creation visibility must be capability driven',
  )

  assert.match(
    shell,
    /import\s+\{\s*ConversationSearch\s*\}/,
    'ChatShell must import ConversationSearch',
  )

  assert.match(
    shell,
    /<ConversationSearch\b/,
    'ChatShell must render the shared conversation search',
  )
})

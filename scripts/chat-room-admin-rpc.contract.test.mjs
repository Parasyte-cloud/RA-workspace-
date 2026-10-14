import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '20261013130400_chat_room_administration.sql',
)

function normalizedSql() {
  assert.ok(
    fs.existsSync(migrationPath),
    'secured chat room administration migration must exist',
  )

  return fs
    .readFileSync(migrationPath, 'utf8')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function functionBlock(sql, name) {
  const marker =
    `create or replace function public.${name}`

  const start = sql.indexOf(marker)

  assert.notEqual(
    start,
    -1,
    `${name} must exist`,
  )

  const end = sql.indexOf('$$;', start)

  assert.notEqual(
    end,
    -1,
    `${name} must have a complete function body`,
  )

  return sql.slice(start, end + 3)
}

test(
  'governed room mutations use secured audited RPC boundaries',
  () => {
    const sql = normalizedSql()

    const names = [
      'create_chat_room',
      'add_chat_room_member',
      'remove_chat_room_member',
      'set_chat_room_member_role',
      'archive_chat_room',
    ]

    for (const name of names) {
      const block =
        functionBlock(sql, name)

      assert.match(
        block,
        /security definer/,
        `${name} must use SECURITY DEFINER`,
      )

      assert.match(
        block,
        /set search_path\s*=\s*public,\s*pg_temp/,
        `${name} must control search_path`,
      )

      assert.match(
        sql,
        new RegExp(
          `revoke all on function public\\.${name}`,
        ),
        `${name} must explicitly revoke default execution`,
      )

      assert.match(
        sql,
        new RegExp(
          `grant execute[\\s\\S]{0,400}public\\.${name}`,
        ),
        `${name} must explicitly grant authenticated execution`,
      )
    }

    const createRoom =
      functionBlock(
        sql,
        'create_chat_room',
      )

    assert.match(
      createRoom,
      /is_workspace_chat_admin/,
      'only global Chat administrators may create rooms',
    )

    for (const kind of [
      'project',
      'committee',
      'restricted',
    ]) {
      assert.match(
        createRoom,
        new RegExp(`['"]${kind}['"]`),
        `create_chat_room must support ${kind} rooms`,
      )
    }

    const membershipMutations = [
      'add_chat_room_member',
      'remove_chat_room_member',
      'set_chat_room_member_role',
    ]

    for (
      const name of membershipMutations
    ) {
      assert.match(
        functionBlock(sql, name),
        /is_room_admin/,
        `${name} must require same-room administrative authority`,
      )
    }

    const archiveRoom =
      functionBlock(
        sql,
        'archive_chat_room',
      )

    assert.match(
      archiveRoom,
      /is_room_admin/,
      'room admins may administer their own additional rooms',
    )

    assert.match(
      archiveRoom,
      /is_workspace_chat_admin/,
      'Department Room archival must retain a global-admin boundary',
    )

    assert.match(
      archiveRoom,
      /department/,
      'archive policy must explicitly distinguish Department Rooms',
    )

    assert.match(
      sql,
      /admin_audit_log/,
      'room administration must write the existing immutable audit trail',
    )

    for (const event of [
      'chat.room.created',
      'chat.room.member_added',
      'chat.room.member_removed',
      'chat.room.member_role_changed',
      'chat.room.archived',
    ]) {
      assert.match(
        sql,
        new RegExp(
          event.replace(/\./g, '\\.'),
        ),
        `${event} must be audited`,
      )
    }

    assert.doesNotMatch(
      sql,
      /grant\s+(insert|update|delete)[\s\S]{0,150}chat_rooms[\s\S]{0,150}authenticated/,
      'authenticated browsers must not receive direct chat_rooms mutation privileges',
    )
  },
)

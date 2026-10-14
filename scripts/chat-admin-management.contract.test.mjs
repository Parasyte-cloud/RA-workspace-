import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

const migrationPath =
  'supabase/migrations/20261014235500_chat_admin_management.sql'

const managerPath =
  'src/modules/ChatAdminManager.tsx'

const accessManagerPath =
  'src/modules/AdminAccessManager.tsx'

function source(relativePath) {
  const fullPath = path.join(root, relativePath)

  assert.ok(
    fs.existsSync(fullPath),
    `${relativePath} must exist`,
  )

  return fs.readFileSync(fullPath, 'utf8')
}

test('Chat admin management migration exists', () => {
  source(migrationPath)
})

test('Chat admin management exposes secured list, grant and revoke RPCs', () => {
  const sql = source(migrationPath)

  for (const functionName of [
    'list_workspace_chat_admins',
    'grant_workspace_chat_admin',
    'revoke_workspace_chat_admin',
  ]) {
    assert.match(
      sql,
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}`,
        'i',
      ),
      `${functionName} must be defined`,
    )
  }

  assert.match(
    sql,
    /security\s+definer/i,
    'privileged Chat admin RPCs must use SECURITY DEFINER',
  )

  assert.match(
    sql,
    /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
    'privileged Chat admin RPCs must control search_path',
  )
})

test('only workspace administrators can grant or revoke global Chat admin capability', () => {
  const sql = source(migrationPath)

  const grantStart =
    sql.indexOf(
      'function public.grant_workspace_chat_admin',
    )

  const revokeStart =
    sql.indexOf(
      'function public.revoke_workspace_chat_admin',
    )

  assert.notEqual(
    grantStart,
    -1,
    'grant RPC must exist',
  )

  assert.notEqual(
    revokeStart,
    -1,
    'revoke RPC must exist',
  )

  const grantSql =
    sql.slice(
      grantStart,
      revokeStart,
    )

  const revokeSql =
    sql.slice(revokeStart)

  assert.match(
    grantSql,
    /is_workspace_admin\s*\(\s*\)/i,
    'grant must require workspace administrator authority',
  )

  assert.match(
    revokeSql,
    /is_workspace_admin\s*\(\s*\)/i,
    'revoke must require workspace administrator authority',
  )

  assert.doesNotMatch(
    grantSql,
    /is_workspace_chat_admin\s*\(\s*\)/i,
    'a delegated Chat admin must not be able to grant global Chat admin capability',
  )

  assert.doesNotMatch(
    revokeSql,
    /is_workspace_chat_admin\s*\(\s*\)/i,
    'a delegated Chat admin must not be able to revoke global Chat admin capability',
  )
})

test('Chat admin grants require an active employee', () => {
  const sql = source(migrationPath)

  assert.match(
    sql,
    /employee_profiles/i,
  )

  assert.match(
    sql,
    /active\s*=\s*true/i,
    'inactive employees must not receive Chat admin grants',
  )
})

test('Chat admin mutations remain RPC-only for authenticated browsers', () => {
  const sql = source(migrationPath)

  assert.doesNotMatch(
    sql,
    /grant\s+(insert|update|delete)[\s\S]*workspace_chat_admin_grants[\s\S]*authenticated/i,
    'authenticated browser clients must not receive direct mutation privileges',
  )

  assert.match(
    sql,
    /revoke[\s\S]*(insert|update|delete)[\s\S]*workspace_chat_admin_grants[\s\S]*authenticated/i,
    'direct authenticated mutations must remain explicitly denied',
  )
})

test('Chat admin grant and revoke operations are audited', () => {
  const sql = source(migrationPath)

  assert.match(
    sql,
    /record_admin_audit|admin_audit_log/i,
    'Chat admin changes must create audit evidence',
  )

  assert.match(
    sql,
    /chat\.admin\.granted/i,
    'grant audit action must be explicit',
  )

  assert.match(
    sql,
    /chat\.admin\.revoked/i,
    'revoke audit action must be explicit',
  )
})

test('Chat admin list distinguishes built-in and delegated authority', () => {
  const sql = source(migrationPath)

  assert.match(
    sql,
    /hr/i,
    'HR-derived Chat authority must be represented',
  )

  assert.match(
    sql,
    /admin/i,
    'workspace-admin-derived Chat authority must be represented',
  )

  assert.match(
    sql,
    /workspace_chat_admin_grants/i,
    'explicit delegated Chat admins must be represented',
  )

  assert.match(
    sql,
    /revocable/i,
    'the list must tell the UI whether an authority source can be revoked',
  )
})

test('Administration Access mounts a dedicated Chat admin manager', () => {
  const manager = source(managerPath)
  const accessManager = source(accessManagerPath)

  assert.match(
    manager,
    /Chat Administration/,
    'ChatAdminManager must expose a clear Chat Administration surface',
  )

  assert.match(
    manager,
    /list_workspace_chat_admins/,
    'ChatAdminManager must load effective Chat administrators through the secured RPC',
  )

  assert.match(
    manager,
    /grant_workspace_chat_admin/,
    'ChatAdminManager must grant through the secured RPC',
  )

  assert.match(
    manager,
    /revoke_workspace_chat_admin/,
    'ChatAdminManager must revoke through the secured RPC',
  )

  assert.match(
    accessManager,
    /ChatAdminManager/,
    'Administration Access must mount ChatAdminManager',
  )
})

test('Chat admin UI never writes workspace_chat_admin_grants directly', () => {
  const manager = source(managerPath)

  assert.doesNotMatch(
    manager,
    /\.from\(\s*['"]workspace_chat_admin_grants['"]\s*\)/,
    'browser UI must not directly mutate or query the grant table',
  )

  assert.doesNotMatch(
    manager,
    /\.insert\(|\.update\(|\.delete\(/,
    'Chat admin UI must use RPCs rather than raw mutation calls',
  )
})

test('Chat admin mutation success notices survive the directory refresh', () => {
  const manager = source(managerPath)

  assert.match(
    manager,
    /useCallback\s*\(\s*async\s*\(\s*clearMessage\s*=\s*true\s*\)/,
    'Chat admin directory loading must allow mutation refreshes to preserve notices',
  )

  assert.match(
    manager,
    /if\s*\(\s*clearMessage\s*\)\s*setMessage\(\s*['"]{2}\s*\)/,
    'only explicit directory loads should clear the current notice',
  )

  const mutationRefreshes =
    manager.match(/await\s+loadAdmins\(\s*false\s*\)/g) || []

  assert.equal(
    mutationRefreshes.length,
    2,
    'both grant and revoke must refresh without clearing their success notice',
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync(
  new URL('../supabase/functions/secret-vault/index.ts', import.meta.url),
  'utf8',
)

const migration = fs.readFileSync(
  new URL(
    '../supabase/migrations/20261022153000_secret_vault_atomic_create.sql',
    import.meta.url,
  ),
  'utf8',
)

test('Vault creation uses governed atomic RPC instead of browser RLS insert', () => {
  assert.match(edge, /vault_create_encrypted_item/)
  assert.doesNotMatch(
    edge,
    /userClient\.from\(['"]secret_vault_items['"]\)\.insert/,
  )
})

test('atomic Vault create writes metadata and encrypted payload together', () => {
  assert.match(
    migration,
    /insert into public\.secret_vault_items[\s\S]*insert into private\.secret_vault_payloads/i,
  )
})

test('atomic Vault create is service-role only', () => {
  assert.match(migration, /security definer/i)
  assert.match(
    migration,
    /revoke all[\s\S]*vault_create_encrypted_item[\s\S]*authenticated/i,
  )
  assert.match(
    migration,
    /grant execute[\s\S]*vault_create_encrypted_item[\s\S]*service_role/i,
  )
})

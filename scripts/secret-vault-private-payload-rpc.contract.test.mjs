import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync(
  new URL('../supabase/functions/secret-vault/index.ts', import.meta.url),
  'utf8',
)

const migration = fs.readFileSync(
  new URL(
    '../supabase/migrations/20261022150000_secret_vault_private_payload_rpc.sql',
    import.meta.url,
  ),
  'utf8',
)

test('Edge Function does not expose the private Vault schema through PostgREST', () => {
  assert.doesNotMatch(edge, /\.schema\(['"]private['"]\)/)
  assert.match(edge, /vault_store_encrypted_payload/)
  assert.match(edge, /vault_read_encrypted_payload/)
})

test('encrypted payload RPCs are SECURITY DEFINER', () => {
  assert.match(
    migration,
    /vault_store_encrypted_payload[\s\S]*security definer/i,
  )

  assert.match(
    migration,
    /vault_read_encrypted_payload[\s\S]*security definer/i,
  )
})

test('encrypted payload RPCs are restricted to service_role', () => {
  assert.match(
    migration,
    /revoke all[\s\S]*vault_store_encrypted_payload[\s\S]*authenticated/i,
  )

  assert.match(
    migration,
    /revoke all[\s\S]*vault_read_encrypted_payload[\s\S]*authenticated/i,
  )

  assert.match(
    migration,
    /grant execute[\s\S]*vault_store_encrypted_payload[\s\S]*service_role/i,
  )

  assert.match(
    migration,
    /grant execute[\s\S]*vault_read_encrypted_payload[\s\S]*service_role/i,
  )
})

test('private Vault payload table remains unavailable to browser roles', () => {
  assert.match(
    migration,
    /revoke all[\s\S]*private\.secret_vault_payloads[\s\S]*public,\s*anon,\s*authenticated/i,
  )
})

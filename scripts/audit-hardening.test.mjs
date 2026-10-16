import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = f => readFileSync(f, 'utf8')

test('hardening migration keeps staff reads to active callers and revokes anon', () => {
  const name = readdirSync('supabase/migrations').find(f => f.endsWith('_audit_hardening.sql'))
  const sql = read(`supabase/migrations/${name}`)
  assert.match(sql, /active = true and public\.is_active_employee\(\)/)
  assert.match(sql, /revoke all on all tables in schema public from anon/)
  assert.match(sql, /alter default privileges for role postgres in schema public revoke all on tables from anon/)
  assert.match(sql, /employee-kyc-documents[\s\S]*is_active_employee/)
})

test('zoho helper rejects inactive accounts and tokens are sealed', () => {
  const zoho = read('supabase/functions/_shared/zoho.ts')
  assert.match(zoho, /\.from\("employee_profiles"\)/)
  assert.match(zoho, /openToken\(/)
  assert.match(read('supabase/functions/zoho-mail-callback/index.ts'), /sealToken\(/)
  const c = read('supabase/functions/_shared/tokenCrypto.ts')
  assert.match(c, /AES-GCM/)
  assert.match(c, /startsWith\(PREFIX\)\) return stored/)
})

test('mail html strips attributes that load remote files', () => {
  const lib = read('src/lib/mailHtml.ts')
  for (const a of ['background', 'srcset', 'poster']) assert.ok(lib.includes(`'${a}'`), a)
  for (const t of ['video', 'link', 'meta', 'base']) assert.ok(lib.includes(`'${t}'`), t)
})

test('notification clicks never leave our origin', () => {
  assert.match(read('public/sw.js'), /wanted\.origin === self\.location\.origin/)
})

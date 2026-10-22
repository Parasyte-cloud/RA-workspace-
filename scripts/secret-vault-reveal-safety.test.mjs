import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'

const edge = fs.readFileSync(new URL('../supabase/functions/secret-vault/index.ts', import.meta.url), 'utf8')
const panel = fs.readFileSync(new URL('../src/modules/SecretVaultPanel.tsx', import.meta.url), 'utf8')
const libSrc = fs.readFileSync(new URL('../src/lib/secretVault.ts', import.meta.url), 'utf8')

// Load the real helper without the browser-only supabase import.
const js = transformSync(libSrc.replace("import { supabase } from './supabase'", 'const supabase = null'), { loader: 'ts', format: 'esm' }).code
const { vaultPreview } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

const read = edge.slice(edge.indexOf("if(action==='read')"), edge.indexOf("if(action==='hide')"))

test('a reveal token is claimed in one conditional update before any plaintext', () => {
  assert.match(read, /\.update\(\{[^}]*use_count:1\}\)\.eq\('id',session\.id\)\.eq\('use_count',0\)\.is\('revoked_at',null\)/)
  assert.match(read, /claimed\.length!==1\) return json\(\{error:'Reveal authorization expired'\},403\)/)
  assert.ok(read.indexOf('use_count:1') < read.indexOf('vault_read_encrypted_payload'), 'claim comes before the payload read')
})

test('the reveal is recorded before it is returned, and a failed audit write stops it', () => {
  assert.match(read, /auditError\) throw auditError/)
  assert.ok(read.indexOf("event_type:'revealed'") < read.indexOf('vault_read_encrypted_payload'))
  const authz = edge.slice(edge.indexOf("if(action==='authorize_reveal')"), edge.indexOf("if(action==='read')"))
  assert.match(authz, /authAuditError\)\{/)
})

test('documents are previewed only as pdf, image or text, decided by signature', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 ...')
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])
  const html = new TextEncoder().encode('<script>alert(1)</script>')
  assert.deepEqual(vaultPreview(pdf, 'application/pdf'), { kind: 'pdf', type: 'application/pdf' })
  assert.deepEqual(vaultPreview(png, 'image/png'), { kind: 'image', type: 'image/png' })
  assert.deepEqual(vaultPreview(html, 'text/html'), { kind: 'none' })
  // A script file that claims to be a PDF or image is refused by its first bytes.
  assert.deepEqual(vaultPreview(html, 'application/pdf'), { kind: 'none' })
  assert.deepEqual(vaultPreview(html, 'image/png'), { kind: 'none' })
  assert.deepEqual(vaultPreview(html, 'image/svg+xml'), { kind: 'none' })
  assert.deepEqual(vaultPreview(html, null), { kind: 'none' })
  assert.deepEqual(vaultPreview(html, 'text/plain'), { kind: 'text', type: 'text/plain' })
})

test('the panel builds the blob from the checked type, never the stored mime type', () => {
  assert.doesNotMatch(panel, /type:\s*result\.mime_type/)
  assert.match(panel, /type: preview\.type/)
  assert.match(panel, /vaultPreview\(bytes, result\.mime_type\)/)
})

test('the browser role cannot update vault item columns directly', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261022170000_secret_vault_lock_item_updates.sql', import.meta.url), 'utf8')
  assert.match(sql, /revoke update on table public\.secret_vault_items from authenticated/)
  // Nothing in the app depends on a direct update.
  const src = [panel, libSrc, edge].join('\n')
  assert.doesNotMatch(src, /from\('secret_vault_items'\)\.update\(/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/modules/MailModule.tsx', 'utf8')
const lib = readFileSync('src/lib/mailHtml.ts', 'utf8')

test('mail reader renders through the hardened sanitizer only', () => {
  assert.match(ui, /safeMailHtml\(/)
  assert.doesNotMatch(ui, /DOMPurify/)
})

test('sanitizer forces safe links, blocks remote images and forms', () => {
  assert.match(lib, /noopener noreferrer/)
  assert.match(lib, /remote image blocked/)
  for (const t of ['form', 'style', 'iframe']) assert.ok(lib.includes(`'${t}'`), t)
})

test('cron secrets are compared in constant time', () => {
  for (const f of ['notifications-email-dispatch', 'ridearrivo-bookings-poll']) {
    const s = readFileSync(`supabase/functions/${f}/index.ts`, 'utf8')
    assert.match(s, /sameSecret\(authorization/)
    assert.doesNotMatch(s, /authorization !== `Bearer/)
  }
})

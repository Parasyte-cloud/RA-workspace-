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

test('an image counts as embedded only when it really is a data: or cid: source', async () => {
  const { isEmbeddedImageSource } = await import('../src/lib/mailHtml.ts')
  // allowed: inside the message
  assert.equal(isEmbeddedImageSource('data:image/png;base64,iVBORw0KGgo='), true)
  assert.equal(isEmbeddedImageSource('cid:logo@example.com'), true)
  // remote, however it is written
  assert.equal(isEmbeddedImageSource('https://evil.test/a.png'), false)
  assert.equal(isEmbeddedImageSource('//evil.test/a.png'), false)
  assert.equal(isEmbeddedImageSource('/relative/pixel.gif'), false)
  // browsers ignore tabs and newlines inside a URL, so these load as https://
  assert.equal(isEmbeddedImageSource('ht\ntps://evil.test/a.png'), false)
  assert.equal(isEmbeddedImageSource('ht\ttps://evil.test/a.png'), false)
  assert.equal(isEmbeddedImageSource('  https://evil.test/a.png'), false)
  // a non-image data URL is not an embedded image
  assert.equal(isEmbeddedImageSource('data:text/html,<script>1</script>'), false)
  assert.equal(isEmbeddedImageSource(''), false)
})

test('svg and math are removed so an href cannot fetch a remote file', () => {
  for (const t of ['svg', 'math', 'image', 'use']) assert.ok(lib.includes(`'${t}'`), t)
})

import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const headers = fs.readFileSync('public/_headers', 'utf8')

function hostBlock(host) {
  const marker = `https://${host}/*`
  const start = headers.indexOf(marker)
  if (start < 0) return ''
  const rest = headers.slice(start + marker.length)
  const next = rest.search(/\nhttps:\/\//)
  return marker + (next < 0 ? rest : rest.slice(0, next))
}

test('support host has a dedicated enforced CSP and is not indexable', () => {
  const block = hostBlock('support.ridearrivo.com')
  assert.ok(block, 'support host block missing')
  assert.match(block, /X-Robots-Tag:\s*noindex, nofollow, noarchive/i)
  assert.match(block, /Content-Security-Policy:\s*default-src 'self'/)
  assert.match(block, /script-src 'self'/)
  assert.match(block, /object-src 'none'/)
  assert.match(block, /base-uri 'self'/)
  assert.match(block, /frame-ancestors 'none'/)
  assert.match(block, /form-action 'self'/)
  assert.match(block, /worker-src 'self' blob:/)
})

test('support enforced CSP permits required Supabase, realtime, analytics and Twilio transport only', () => {
  const block = hostBlock('support.ridearrivo.com')
  assert.match(block, /connect-src[^\n]*https:\/\/\*\.supabase\.co/)
  assert.match(block, /connect-src[^\n]*wss:\/\/\*\.supabase\.co/)
  assert.match(block, /connect-src[^\n]*https:\/\/\*\.twilio\.com/)
  assert.match(block, /connect-src[^\n]*wss:\/\/\*\.twilio\.com/)
  assert.match(block, /connect-src[^\n]*https:\/\/www\.googletagmanager\.com/)
  assert.match(block, /connect-src[^\n]*https:\/\/\*\.google-analytics\.com/)
})

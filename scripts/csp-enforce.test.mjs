import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const headers = readFileSync('public/_headers', 'utf8')
const html = readFileSync('index.html', 'utf8')
const block = headers.slice(headers.lastIndexOf('https://intranet.ridearrivo.com/*'))
const enforced = block.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:')) || ''

test('workspace enforces a script policy without inline scripts or eval', () => {
  assert.match(enforced, /script-src 'self'/)
  assert.doesNotMatch(enforced, /'unsafe-inline'|'unsafe-eval'/)
  assert.match(enforced, /object-src 'none'/)
  assert.match(enforced, /base-uri 'self'/)
  assert.match(enforced, /frame-ancestors 'self'/)
})

test('index.html has no inline script, so the enforced policy cannot block it', () => {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
  assert.equal(inline.length, 0)
  assert.match(html, /<script src="\/room7-host\.js">/)
})

test('every third-party script the app loads is allowed', () => {
  for (const host of ['www.googletagmanager.com', 'accounts.google.com', 'appleid.cdn-apple.com'])
    assert.ok(enforced.includes(host), host)
})

test('loose directives stay report-only', () => {
  const ro = block.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy-Report-Only:')) || ''
  assert.match(ro, /connect-src/)
  assert.doesNotMatch(enforced, /connect-src|img-src/)
})

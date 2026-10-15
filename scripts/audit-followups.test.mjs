import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'

test('workspace host sends a report-only CSP that forbids plugins and framing by others', () => {
  const h = readFileSync('public/_headers', 'utf8')
  const block = h.slice(h.indexOf('https://intranet.ridearrivo.com/*'))
  assert.match(block, /Content-Security-Policy-Report-Only:/)
  assert.match(block, /object-src 'none'/)
  assert.match(block, /frame-ancestors 'self'/)
})

test('hashtag insert policy validates the tag', () => {
  const s = readFileSync('supabase/migrations/20261015200000_hashtag_insert_guard.sql', 'utf8')
  assert.doesNotMatch(s, /with check\s*\(\s*true\s*\)/)
  assert.match(s, /char_length\(tag\) between 1 and 50/)
})

test('logo images stay small', () => {
  for (const f of ['ridearrivo-wordmark.png', 'parasyte-logo.png', 'ridearrivo-mark.png', 'ridearrivo-wordmark-forms-exact.png'])
    assert.ok(statSync('public/' + f).size < 400 * 1024, f)
})

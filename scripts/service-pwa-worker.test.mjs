import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const host = read('../public/service-host.js')
const sw = read('../public/service-sw.js')
const page = read('../public/service-offline.html')
const headers = read('../public/_headers')

test('customer sites register their own worker, only on their own hosts', () => {
  const hit = host.indexOf('if (!hit) return')
  const register = host.indexOf("register('/service-sw.js')")
  assert.ok(hit > -1 && register > hit, 'registration must come after the host check')
  assert.ok(!host.includes("register('/sw.js')"), 'must never use the workspace worker')
  for (const h of ['bookings', 'membership', 'move', 'easybook', 'boat', 'air']) assert.ok(host.includes(`${h}.ridearrivo.com`))
})

test('the worker only falls back for page loads and never caches live data', () => {
  assert.match(sw, /request\.method !== 'GET'\) return/)
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/)
  assert.match(sw, /request\.mode === 'navigate'/)
  assert.ok(!/cache\.put|addAll|\.put\(/.test(sw), 'only the offline page is cached, at install')
  assert.ok(!/push|notificationclick/i.test(sw.replace(/\/\/.*$/gm, '')), 'no push handling on customer sites')
})

test('the offline page works under a CSP that forbids inline script', () => {
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(page), 'no inline script')
  assert.match(page, /<script src="\/service-offline\.js">/)
  assert.ok(!page.includes('—') && !sw.includes('—'))
})

test('the new files revalidate on every visit and the workspace may frame blob PDFs', () => {
  assert.match(headers, /\/service-sw\.js\n  Cache-Control: no-cache/)
  assert.match(headers, /\/service-offline\.html\n  Cache-Control: no-cache/)
  const intranet = headers.slice(headers.indexOf('https://intranet.ridearrivo.com/*'))
  assert.match(intranet, /frame-src 'self' blob: https:/)
})

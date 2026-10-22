import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Every sessionStorage call must sit inside a try within the few lines above it.
function unguardedStorage(src) {
  const lines = src.split('\n')
  const bad = []
  lines.forEach((line, i) => {
    if (!/sessionStorage\.(get|set|remove)Item\(/.test(line)) return
    if (/^\s*(\/\/|\*)/.test(line)) return
    const near = lines.slice(Math.max(0, i - 6), i + 1).join('\n')
    if (!/\btry\b/.test(near)) bad.push(`${i + 1}: ${line.trim()}`)
  })
  return bad
}

test('a honeypot reply (ok with no submission) gives callers an empty receipt', () => {
  const src = read('src/lib/intake.ts')
  assert.match(src, /response\.submission \?\? \{/)
  assert.match(src, /reference: ''/)
})

test('intake requests time out instead of hanging', () => {
  const src = read('src/lib/intake.ts')
  assert.match(src, /new AbortController\(\)/)
  assert.match(src, /signal: controller\.signal/)
  assert.match(src, /clearTimeout\(timer\)/)
})

test('the late-request dialog ignores close while sending', () => {
  const src = read('src/forms-public/LateBookingDialog.tsx')
  assert.match(src, /function requestClose\(\) \{[^}]*if \(busy\) return/s)
})

test('membership has a way back from plans and checks phone and email', () => {
  const src = read('src/forms-public/MembershipApp.tsx')
  assert.match(src, /setStep\('identify'\)/)
  assert.match(src, /at least 7 digits/)
  assert.match(src, /does not look right/)
  assert.doesNotMatch(src, /compare all four/)
})

test('air return date cannot precede departure', () => {
  const src = read('src/forms-public/AirApp.tsx')
  assert.match(src, /return date cannot be before the departure date/)
  assert.match(src, /min=\{details\.departureDate \|\| lagosToday\(\)\}/)
})

test('room 7 survives a malformed link and blocked storage', () => {
  const src = read('src/room7-public/ExternalRoom7App.tsx')
  assert.doesNotMatch(src, /\.map\(part => decodeURIComponent\(part\)\)/)
  assert.match(src, /function safeDecode/)
  assert.deepEqual(unguardedStorage(src), [])
})

test('every form key access to sessionStorage is guarded', () => {
  for (const f of ['EasyBookApp', 'MembershipApp', 'MoveApp']) {
    const src = read(`src/forms-public/${f}.tsx`)
    assert.deepEqual(unguardedStorage(src), [], f)
  }
})

test('entry point has an error boundary and reloads once for a stale chunk', () => {
  const src = read('src/main.tsx')
  assert.match(src, /vite:preloadError/)
  assert.match(src, /<EntryErrorBoundary>/)
  assert.match(src, /ra:chunk-reload/)
})

test('forms and room7 hosts get an enforced script policy', () => {
  const h = read('public/_headers')
  for (const host of ['forms', 'room7']) {
    const block = h.split(`https://${host}.ridearrivo.com/*\n`)[1].split('\n\n')[0]
    assert.match(block, /^\s+Content-Security-Policy: script-src 'self'/m, host)
    assert.match(block, /object-src 'none'/)
  }
})

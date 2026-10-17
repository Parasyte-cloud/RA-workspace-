import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('ROOM 7 manifest is installable and separate from the intranet one', () => {
  const m = JSON.parse(read('public/room7.webmanifest'))
  assert.equal(m.name, 'ROOM 7')
  assert.equal(m.display, 'standalone')
  assert.equal(m.start_url, '/')
  const sizes = m.icons.map(i => i.sizes)
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'))
  assert.ok(m.icons.some(i => i.purpose === 'maskable'))
  for (const icon of m.icons) assert.ok(existsSync(new URL(`../public${icon.src}`, import.meta.url)), icon.src)
  assert.notEqual(m.name, JSON.parse(read('public/manifest.webmanifest')).name)
})

test('index.html swaps to the ROOM 7 manifest only on the room7 host', () => {
  const html = read('index.html')
  const host = read('public/room7-host.js')
  assert.match(html, /src="\/room7-host\.js"/)
  assert.match(host, /room7\.ridearrivo\.com/)
  assert.match(host, /\/room7\.webmanifest/)
  assert.match(html, /href="\/manifest\.webmanifest"/)
})

test('ROOM 7 service worker never answers anything but a failed page load', () => {
  const sw = read('public/room7-sw.js')
  assert.match(sw, /request\.method !== 'GET'/)
  assert.match(sw, /request\.mode === 'navigate'/)
  assert.doesNotMatch(sw, /cache\.put/)
  assert.ok(existsSync(new URL('../public/room7-offline.html', import.meta.url)))
})

test('install prompt is wired into the guest page and respects installed state', () => {
  assert.match(read('src/room7-public/ExternalRoom7App.tsx'), /<Room7Install \/>/)
  assert.match(read('src/room7-public/Room7Install.tsx'), /display-mode: standalone/)
})

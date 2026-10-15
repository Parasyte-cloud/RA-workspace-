import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('service worker answers hashed assets from the device cache first', () => {
  const sw = read('public/sw.js')
  assert.match(sw, /pathname\.startsWith\('\/assets\/'\)/)
  assert.match(sw, /cache\.match\(request\)/)
  assert.match(sw, /ASSET_LIMIT/)
  // pages stay network-first so a deploy shows on the next visit
  assert.match(sw, /Network-first prevents stale authenticated UI/)
})

test('app code is preloaded only on workspace hosts, from an external script', () => {
  const html = read('index.html')
  assert.doesNotMatch(html.replace(/<script [^>]*src=[^>]*><\/script>/g, ''), /<script/)
  const js = read('public/preload-internal.js')
  assert.match(js, /intranet\.ridearrivo\.com/)
  assert.match(js, /modulepreload/)
  assert.match(read('vite.config.ts'), /ra-preload/)
  assert.match(read('public/_headers'), /\/preload-internal\.js\n\s+Cache-Control: no-cache/)
})

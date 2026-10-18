import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

const read = p => readFileSync(p, 'utf8')

test('workspace and chauffeur icons exist at the sizes the manifests declare', async () => {
  const want = {
    'public/icons/icon-192.png': 192, 'public/icons/icon-512.png': 512, 'public/icons/icon-maskable-512.png': 512,
    'public/icons/apple-180.png': 180, 'public/favicon.png': 256,
    'public/icons/chauffeur-192.png': 192, 'public/icons/chauffeur-512.png': 512,
    'public/icons/chauffeur-maskable-512.png': 512, 'public/icons/chauffeur-apple-180.png': 180,
  }
  for (const [file, size] of Object.entries(want)) {
    assert.ok(existsSync(file), file)
    const meta = await sharp(file).metadata()
    assert.equal(meta.width, size, file)
    assert.equal(meta.height, size, file)
  }
})

test('rounded icons have transparent corners and the maskable and apple icons are opaque', async () => {
  for (const f of ['public/icons/icon-512.png', 'public/icons/chauffeur-512.png', 'public/favicon.png']) {
    const { data } = await sharp(f).ensureAlpha().extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    assert.equal(data[3], 0, `${f} corner must be transparent`)
  }
  for (const f of ['public/icons/icon-maskable-512.png', 'public/icons/apple-180.png', 'public/icons/chauffeur-maskable-512.png', 'public/icons/chauffeur-apple-180.png']) {
    const { data } = await sharp(f).ensureAlpha().extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    assert.equal(data[3], 255, `${f} must be opaque`)
  }
})

test('a build cannot overwrite the app icons', () => {
  const s = read('scripts/prepare-brand-assets.mjs')
  assert.doesNotMatch(s, /public\/icons\/icon-/)
  assert.doesNotMatch(s, /'public\/favicon\.png'/)
})

test('ArrivoChauffeur manifest uses its own icons and the workspace points at the gear set', () => {
  const m = JSON.parse(read('public/service-bookings.webmanifest'))
  assert.equal(m.name, 'ArrivoChauffeur')
  assert.ok(m.icons.every(i => i.src.startsWith('/icons/chauffeur-')))
  assert.match(read('public/service-host.js'), /ArrivoChauffeur/)
  assert.match(read('index.html'), /apple-touch-icon" href="\/icons\/apple-180\.png"/)
  assert.match(read('public/sw.js'), /ra-workspace-shell-v9/)
})

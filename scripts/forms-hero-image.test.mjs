import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync, readFileSync } from 'node:fs'

const assets = new URL('../src/forms-public/assets/', import.meta.url)
const LIMIT = 50_000 // bytes: the per-image budget for the public forms

test('every public forms banner image is under 50 KB', () => {
  const files = readdirSync(assets).filter(name => name.endsWith('.webp'))
  assert.ok(files.length >= 18, 'expected the handshake plus five page pictures, three sizes each')
  for (const name of files) {
    const size = statSync(new URL(name, assets)).size
    assert.ok(size < LIMIT, `${name} is ${size} bytes (limit ${LIMIT})`)
  }
})

test('every picture has all three sizes and is used by a page', () => {
  const source = readFileSync(new URL('../src/forms-public/FormsHeroImage.tsx', import.meta.url), 'utf8')
  const files = new Set(readdirSync(assets))
  for (const key of ['handshake', 'easybook', 'membership', 'air', 'boat', 'move']) {
    for (const size of ['1024', '640', 'mobile-560']) {
      assert.ok(files.has(`${key}-${size}.webp`), `${key}-${size}.webp missing`)
    }
    assert.match(source, new RegExp(`${key}: \\{`), `${key} not registered in FormsHeroImage`)
  }
})

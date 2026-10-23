import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(p, 'utf8')
const css = read('src/birthday.css')

test('on phones the birthday card sits above the floating bottom bar, not under it', () => {
  const phone = css.slice(css.indexOf('@media(max-width:599px)'))
  assert.match(phone, /\.bdToday\{[^}]*bottom:calc\(max\(10px,env\(safe-area-inset-bottom,0px\)\) \+ 52px \+ 12px\)/)
  assert.match(phone, /data-ra-island='compact'\] \.bdToday\{bottom:calc\(max\(6px,env\(safe-area-inset-bottom,0px\)\) \+ 42px \+ 10px\)/)
  assert.match(phone, /max-height:calc\(100dvh - 200px\)/)
  assert.match(phone, /overflow-y:auto/)
})

test('the wish box stays inside the card and the wishes stay readable', () => {
  assert.match(css, /\.bdCompose textarea\{box-sizing:border-box/)
  assert.match(css, /\.bdWishes\{[^}]*color:#3a2a14/)
})

test('the bar offsets match the real bar', () => {
  const island = read('src/island.css')
  assert.match(island, /bottom: max\(10px, env\(safe-area-inset-bottom, 0px\)\) !important;/)
  assert.match(island, /bottom: max\(6px, env\(safe-area-inset-bottom, 0px\)\) !important;/)
})

test('the birthday scene loads the stylesheet that positions its falling symbols', () => {
  assert.match(read('src/components/celebrations/BirthdayCelebrationScene.tsx'), /import '\.\.\/\.\.\/seasonal-celebrations\.css'/)
  assert.match(read('src/seasonal-celebrations.css'), /\.seasonalParticleField\{position:absolute/)
})

test('no em dash in what was added', () => {
  assert.ok(!/—/.test(css))
})

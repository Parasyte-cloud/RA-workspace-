import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/island.css')
const motion = read('../src/lib/islandMotion.ts')
const bar = read('../src/lib/islandBar.ts')
const app = read('../src/App.tsx')
const internal = read('../src/InternalApp.tsx')
const settings = read('../src/modules/NotificationSettings.tsx')

test('island motion: the bounce is played from script on shrink, grow and screen change', () => {
  assert.match(motion, /export function playIslandBounce/)
  assert.match(motion, /\.animate\(/)
  for (const kind of ['shrink', 'grow', 'screen']) assert.match(motion, new RegExp(`${kind}:\\{`), kind)
  assert.match(motion, /attributeFilter:\['data-ra-island','data-ra-pulse'\]/)
  assert.match(motion, /max-width: 599px/)
  assert.match(internal, /useEffect\(\(\)=>startIslandMotion\(\),\[\]\)/)
})

test('island motion: screen changes reset the bar and pulse, chat list drives the bar', () => {
  assert.match(bar, /export function pulseIsland/)
  assert.match(bar, /ISLAND_RESET_EVENT/)
  assert.match(bar, /cmShell\.listOpen/)
  assert.match(app, /useEffect\(\(\)=>\{pulseIsland\(\)\},\[section\]\)/)
})

test('island motion: respects Reduce Motion unless the person opts in, from Settings', () => {
  assert.match(motion, /prefers-reduced-motion: reduce/)
  assert.match(motion, /export function funAllowed/)
  assert.match(motion, /export function setFunChoice/)
  assert.match(settings, /Playful island motion/)
  assert.match(settings, /setFunChoice/)
})

test('liquid glow: phones only, gated on data-ra-fun, behind the contents', () => {
  assert.match(css, /\.raGlow \{ display: none; \}/)
  assert.match(css, /@media \(max-width: 599px\)/)
  assert.match(css, /html\[data-ra-fun='on'\] \.raGlow/)
  assert.match(css, /z-index: -1/)
  for (const name of ['raGlowDriftA', 'raGlowDriftB', 'raGlowMorph']) assert.match(css, new RegExp(`@keyframes ${name}\\b`), name)
  assert.match(motion, /className='raGlow'/)
  assert.ok(!/animation[^;]*(forwards|both)/.test(css.slice(css.indexOf('Liquid glow'))), 'no fill mode')
})

test('liquid glow is a true pill and the names and icons pulse, with a Settings switch for both', () => {
  const glow = css.slice(css.indexOf('Liquid glow'))
  assert.match(glow, /border-radius: 999px/)
  assert.match(glow, /clip-path: inset\(0 round 999px\)/)
  assert.match(css, /@keyframes raBeat/)
  assert.match(css, /html\[data-ra-beat='on'\]/)
  assert.match(css, /max-width: 599px/)
  assert.match(motion, /export function beatEnabled/)
  assert.match(motion, /export function setBeatEnabled/)
  assert.match(motion, /data-ra-beat/)
  assert.match(settings, /Pulse the names and icons/)
  assert.match(settings, /setBeatEnabled/)
})

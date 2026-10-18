import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/island.css', import.meta.url), 'utf8')
const block = css.slice(css.indexOf('Island motion'))

test('island motion: bar contents and dock tabs bounce when the bar shrinks and grows, phones only', () => {
  assert.match(block, /@media \(max-width: 599px\)/)
  for (const name of ['raIslandTitleIn', 'raIslandTitleOut', 'raIslandBtnIn', 'raIslandBtnOut', 'raDockIn', 'raDockOut']) {
    assert.match(block, new RegExp(`@keyframes ${name}\\b`), name)
    assert.match(block, new RegExp(`animation: ${name} `), `${name} used`)
  }
  assert.match(block, /data-ra-island='compact'/)
  assert.match(block, /data-ra-island='full'/)
})

test('island motion: respects reduced motion and never leaves a transform behind', () => {
  assert.match(block, /prefers-reduced-motion: reduce/)
  assert.ok(!/animation[^;]*(forwards|both)/.test(block), 'no fill mode that would keep a transform')
})

test('island motion: every screen change resets the bar and replays the bounce, chat list included', () => {
  const bar = readFileSync(new URL('../src/lib/islandBar.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(bar, /export function pulseIsland/)
  assert.match(bar, /ISLAND_RESET_EVENT/)
  assert.match(bar, /cmShell\.listOpen/)
  assert.match(app, /useEffect\(\(\)=>\{pulseIsland\(\)\},\[section\]\)/)
  assert.match(css, /data-ra-pulse='a'/)
  assert.match(css, /data-ra-pulse='b'/)
  assert.match(css, /raScreenTitleA/)
  assert.match(css, /raScreenTitleB/)
})

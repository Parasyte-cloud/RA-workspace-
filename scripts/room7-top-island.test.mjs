import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROOM7_PRODUCTS, safeProductHref } from '../src/room7-public/room7Products.ts'

assert.deepEqual(ROOM7_PRODUCTS.map(p => p.name), ['RideArrivo', 'ArrivoExpress', 'ArrivoAir', 'ArrivoBoat', 'ArrivoRemovals', 'ArrivoChauffeur'])
for (const p of ROOM7_PRODUCTS) assert.ok(safeProductHref(p.href), `${p.name} link is allowed`)
assert.equal(safeProductHref('http://www.ridearrivo.com'), null, 'https only')
assert.equal(safeProductHref('https://evil.example/ridearrivo.com'), null)
assert.equal(safeProductHref('https://ridearrivo.com.evil.example'), null)
assert.equal(safeProductHref('javascript:alert(1)'), null)
assert.equal(safeProductHref('nonsense'), null)

const tsx = readFileSync('src/room7-public/Room7TopIsland.tsx', 'utf8')
assert.match(tsx, /r7IslandRoom/, 'ROOM 7 is pinned in the bar')
assert.match(tsx, /rel="noopener noreferrer"/)
assert.match(tsx, /target="_blank"/, 'links open in a new tab so the waiting room is not lost')
assert.match(tsx, /aria-hidden=\{copy === 1/, 'the duplicate marquee run is hidden from screen readers')
assert.match(tsx, /Escape/)

const css = readFileSync('src/room7-public/room7-top-island.css', 'utf8')
assert.match(css, /\.r7Island\{[^}]*position:sticky/s)
assert.match(css, /main\.room7Public\.responsiveModule\{overflow:hidden;overflow:clip\}/, 'clip so sticky works')
assert.match(css, /margin:0;min-height:100dvh/, 'no browser margin, fills the screen')
assert.match(css, /prefers-reduced-motion:reduce/)
assert.match(css, /\.r7IslandTicker:active \.r7IslandTrack/, 'pauses under a finger')
const pill = /\.r7IslandPill\{([^}]*)\}/.exec(css)[1]
assert.ok(!/backdrop-filter/.test(pill))
console.log('room7-top-island ok')

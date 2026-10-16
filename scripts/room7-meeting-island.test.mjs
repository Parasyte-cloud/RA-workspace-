import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldIdleCompact, ISLAND_IDLE_MS } from '../src/room7-public/meetingIslandState.ts'

assert.equal(shouldIdleCompact({ idleMs: ISLAND_IDLE_MS, overBar: false, menuOpen: false }), true)
assert.equal(shouldIdleCompact({ idleMs: ISLAND_IDLE_MS - 1, overBar: false, menuOpen: false }), false)
assert.equal(shouldIdleCompact({ idleMs: 60000, overBar: true, menuOpen: false }), false, 'never shrink under the pointer')
assert.equal(shouldIdleCompact({ idleMs: 60000, overBar: false, menuOpen: true }), false, 'never shrink with settings open')

const css = readFileSync('src/room7-public/room7-island.css', 'utf8')
// The glass must live on a pseudo element. A filter on the bar itself traps
// position:fixed dropdowns (this bit us before).
const bar = /\.room7ExperienceChrome\{([^}]*)\}/.exec(css)[1]
assert.ok(!/backdrop-filter/.test(bar), 'bar itself has no backdrop-filter')
assert.match(css, /\.room7ExperienceChrome::before\{[^}]*backdrop-filter:blur\(26px\) saturate\(180%\)/s)
assert.ok(!/transform:|scale:|filter:blur/.test(bar), 'no transform on the bar (containing block trap)')
assert.match(css, /data-island="compact"\] \.room7ExperienceIdentity\{\s*display:none/)
assert.match(css, /prefers-reduced-motion:reduce/)

const meeting = readFileSync('src/room7-public/ExternalRoom7Meeting.tsx', 'utf8')
assert.match(meeting, /data-island=\{island\}/)
// Hook order: the island hook must sit above the first early return.
assert.ok(meeting.indexOf('useMeetingIsland(shellRef') < meeting.indexOf('if (error) {'), 'hook before early returns')

const app = readFileSync('src/room7-public/ExternalRoom7App.tsx', 'utf8')
assert.match(app, /data-theme=\{appearance\.theme\}/)
assert.match(app, /<Room7TopIsland pref={appearance.pref}/)
console.log('room7-meeting-island ok')

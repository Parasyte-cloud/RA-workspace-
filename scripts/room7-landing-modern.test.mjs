import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/room7-public/ExternalRoom7App.tsx', 'utf8')
const css = readFileSync('src/room7-public/room7-public.css', 'utf8')
const manifest = JSON.parse(readFileSync('public/room7.webmanifest', 'utf8'))
const hostScript = readFileSync('public/room7-host.js', 'utf8')

const start = app.indexOf('<section className="room7Landing">')
const end = app.indexOf('{!loading && locator && error && !room', start)
assert.ok(start >= 0 && end > start, 'landing block is present')
const landing = app.slice(start, end)

assert.match(landing, /Meet without[\s\S]*the friction\./, 'new product headline is present')
assert.match(landing, /Join a meeting/, 'join experience has its own card heading')
assert.match(landing, /No downloads/, 'landing keeps a low-friction product promise')
assert.match(landing, /room7LandingJoinCard/, 'join form is promoted into a dedicated card')
assert.match(landing, /room7LandingStaffPill/, 'staff workspace link uses a pill treatment')
assert.match(landing, /RideArrivo staff/, 'RideArrivo remains on the approved staff link')
assert.doesNotMatch(landing, /RIDEARRIVO ROOM 7/, 'RideArrivo branding is removed from the hero copy')
assert.match(landing, /room7LandingStepIcon/, 'steps use modern visual icons rather than number-only circles')

assert.match(css, /\.room7LandingMain\{[^}]*grid-template-columns:/s, 'desktop landing uses a two-column product layout')
assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.room7LandingMain\{[^}]*grid-template-columns:1fr/s, 'mobile landing collapses to one column')
assert.match(css, /\.room7LandingStaffPill\{[^}]*border-radius:999px/s, 'staff workspace link is rendered as a pill')
assert.match(css, /\.room7LandingJoinCard\{[^}]*backdrop-filter:blur/s, 'join card keeps the liquid-glass visual treatment')
assert.match(css, /prefers-reduced-motion:reduce/, 'landing respects reduced motion')

assert.equal(manifest.name, 'ROOM 7', 'PWA is branded as ROOM 7')
assert.equal(manifest.short_name, 'ROOM 7', 'PWA short name stays ROOM 7')
assert.ok(!/RideArrivo/i.test(manifest.description), 'PWA description is standalone ROOM 7 copy')
assert.match(hostScript, /document\.title = 'ROOM 7'/, 'ROOM 7 host title is standalone')
assert.doesNotMatch(hostScript, /document\.title = 'RideArrivo ROOM 7'/, 'old host title is removed')

console.log('room7 modern landing ok')

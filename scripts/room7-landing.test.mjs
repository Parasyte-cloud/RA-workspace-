import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const tsx = readFileSync('src/room7-public/ExternalRoom7App.tsx', 'utf8')
const css = readFileSync('src/room7-public/room7-public.css', 'utf8')
assert.match(tsx, /className="room7Landing"/)
assert.match(tsx, /htmlFor="room7-entry-code"/, 'input needs a visible label')
assert.match(tsx, /role="alert"/)
assert.ok(!/Join a ROOM 7 event/.test(tsx), 'old flat entry card is gone')
assert.match(css, /\.room7LandingSteps\{[^}]*grid-template-columns:repeat\(3,1fr\)/)
assert.match(css, /\.room7LandingSteps\{grid-template-columns:1fr\}/)
const start = tsx.indexOf('room7Landing')
assert.ok(!tsx.slice(start, start + 3000).includes(String.fromCharCode(0x2014)), 'no em dash')
console.log('room7-landing ok')

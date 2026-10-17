import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync('src/room7-public/ExternalRoom7App.tsx', 'utf8')

assert.match(app, /RideArrivo staff · Open workspace/, 'approved staff link keeps RideArrivo name')
assert.doesNotMatch(app, /RIDEARRIVO ROOM 7/, 'public Room7 content does not repeat the parent brand')
assert.doesNotMatch(app, /RIDEARRIVO · ROOM 7/, 'event hero stays standalone ROOM 7')
assert.doesNotMatch(app, /professionally hosted RideArrivo event experience/, 'default public summary stays standalone')
assert.doesNotMatch(app, /valid RideArrivo invitation link/, 'invitation copy stays standalone')
assert.doesNotMatch(app, /validated by the RideArrivo event service/, 'trust copy stays standalone')
assert.doesNotMatch(app, />\s*RideArrivo Limited\s*</, 'public footer does not repeat the parent brand')

console.log('room7 public brand scope ok')

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/prefetch.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const P = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('prefetch is skipped on Data Saver and 2g, allowed otherwise', () => {
  assert.equal(P.shouldPrefetch(null), true)
  assert.equal(P.shouldPrefetch({ saveData: true, effectiveType: '4g' }), false)
  assert.equal(P.shouldPrefetch({ effectiveType: '2g' }), false)
  assert.equal(P.shouldPrefetch({ effectiveType: 'slow-2g' }), false)
  assert.equal(P.shouldPrefetch({ effectiveType: '4g' }), true)
})

test('both meeting screens warm their chunk, and stay lazy', () => {
  const room = readFileSync('src/modules/RoomModule.tsx', 'utf8')
  const guest = readFileSync('src/room7-public/ExternalRoom7App.tsx', 'utf8')
  assert.match(room, /prefetchWhenIdle\(loadRoomMeeting\)/)
  assert.match(room, /lazy\(loadRoomMeeting\)/)
  assert.match(guest, /prefetchWhenIdle\(loadExternalMeeting\)/)
  assert.match(guest, /lazy\(loadExternalMeeting\)/)
})

test('meeting SDK is never pinned into the entry chunk', () => {
  // A manualChunks rule for the SDK made the entry page preload 3.8 MB. Keep it lazy.
  assert.doesNotMatch(readFileSync('vite.config.ts', 'utf8'), /realtimekit/)
})

import fs from 'node:fs'
import assert from 'node:assert/strict'

const cors = fs.readFileSync(
  'supabase/functions/_shared/roomAiCors.ts',
  'utf8'
)

const auth = fs.readFileSync(
  'supabase/functions/_shared/roomAiAuth.ts',
  'utf8'
)

assert.doesNotMatch(
  cors,
  /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/,
  'Room7 AI CORS must not allow arbitrary origins'
)

assert.match(cors, /https:\/\/intranet\.ridearrivo\.com/)
assert.match(cors, /https:\/\/room7\.ridearrivo\.com/)
assert.match(cors, /ra-workspace\\\.pages\\\.dev/)
assert.match(cors, /localhost/)
assert.match(cors, /127\\\.0\\\.0\\\.1/)
assert.match(cors, /Vary["']?\s*:\s*["']Origin["']/)

assert.match(
  cors,
  /return null/,
  'unapproved origins must not receive an allow-origin value'
)

for (const file of [
  'room-ai-upload',
  'room-ai-transcribe',
  'room-ai-finalize',
]) {
  const source = fs.readFileSync(
    `supabase/functions/${file}/index.ts`,
    'utf8'
  )

  assert.match(
    source,
    /Deno\.serve\(handle\([\s\S]*},\s*roomAiCors\)\)\s*$/,
    `${file} must pass roomAiCors to the handle wrapper`
  )

  for (const match of source.matchAll(/\.map\(/g)) {
    const mapStart = match.index
    const mapEnd = source.indexOf("\n  }))", mapStart)

    assert.notEqual(
      mapEnd,
      -1,
      `${file} map call must have a detectable closing boundary`
    )

    const mapCall = source.slice(mapStart, mapEnd + 5)

    assert.doesNotMatch(
      mapCall,
      /roomAiCors/,
      `${file} must not pass roomAiCors as an Array.map thisArg`
    )
  }
}

assert.match(
  auth,
  /responseHeaders/,
  'shared handler must support per-function response headers'
)

console.log('Room7 AI CORS security checks passed')

for (const file of [
  'room-ai-upload',
  'room-ai-transcribe',
  'room-ai-finalize',
]) {
  const source = fs.readFileSync(
    `supabase/functions/${file}/index.ts`,
    'utf8'
  )

  assert.match(
    source,
    /roomAiJson/,
    `${file} successful responses must use Room7-specific CORS`
  )

  assert.doesNotMatch(
    source,
    /return\s+json\s*\(/,
    `${file} must not return generic wildcard-CORS JSON responses`
  )
}

assert.match(
  cors,
  /export function roomAiJson/,
  'Room7 must provide a dedicated JSON response helper'
)

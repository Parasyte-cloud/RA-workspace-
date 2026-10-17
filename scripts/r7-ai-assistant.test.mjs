import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  baseMime, chunkPath, finalPath, missingChunks, normalizeUtterances, speakerLabel, latestCorrections,
  transcriptToText, retentionDeadline, deepgramQuery, sameSecret, clock, validSeq, isSha256, topicsFrom, summaryFrom,
} from '../supabase/functions/_shared/roomAiCore.ts'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('mime types are reduced to the bare allow-listed type', () => {
  assert.equal(baseMime('audio/webm;codecs=opus'), 'audio/webm')
  assert.equal(baseMime('AUDIO/MP4'), 'audio/mp4')
  assert.equal(baseMime('application/x-msdownload'), null)
  assert.equal(baseMime(undefined), null)
})

test('chunk paths are ordered, session-scoped and unguessable without the session id', () => {
  const sid = '11111111-1111-4111-8111-111111111111'
  assert.equal(chunkPath(sid, 7, 'audio/webm'), `${sid}/chunks/000007.webm`)
  assert.ok(chunkPath(sid, 10, 'audio/mp4') > chunkPath(sid, 9, 'audio/mp4'))
  assert.equal(finalPath(sid, 'audio/webm'), `${sid}/final.webm`)
})

test('missing chunk detection finds gaps and ignores extras', () => {
  assert.deepEqual(missingChunks(5, [0, 1, 3, 4]), [2])
  assert.deepEqual(missingChunks(3, [0, 1, 2, 9]), [])
  assert.deepEqual(missingChunks(0, []), [])
  assert.deepEqual(missingChunks(3, []), [0, 1, 2])
})

test('input validation', () => {
  assert.ok(validSeq(0) && validSeq(19999))
  assert.ok(!validSeq(-1) && !validSeq(1.5) && !validSeq('3') && !validSeq(20000))
  assert.ok(isSha256('a'.repeat(64)))
  assert.ok(!isSha256('A'.repeat(64)) && !isSha256('abc'))
})

test('utterances become segments with stable speaker keys and offsets', () => {
  const segs = normalizeUtterances([
    { start: 0.5, end: 2.25, transcript: '  Good   morning everyone ', speaker: 0, confidence: 0.98 },
    { start: 2.5, end: 4, transcript: 'Morning.', speaker: 1, confidence: 7 },
    { start: 5, end: 6, transcript: '   ' },
  ], 60000)
  assert.equal(segs.length, 2)
  assert.deepEqual(segs[0], { speaker_key: 's0', start_ms: 60500, end_ms: 62250, text: 'Good morning everyone', confidence: 0.98 })
  assert.equal(segs[1].speaker_key, 's1')
  assert.equal(segs[1].confidence, null, 'out of range confidence is dropped')
  assert.deepEqual(normalizeUtterances(undefined), [])
})

test('speaker correction wins and the raw key is never rewritten', () => {
  const c = latestCorrections([
    { speaker_key: 's0', display_name: 'Adeola' },
    { speaker_key: 's0', display_name: 'Adeola Bello' },
  ])
  assert.equal(speakerLabel('s0', c), 'Adeola Bello')
  assert.equal(speakerLabel('s1', c), 'Speaker 2')
})

test('text export groups runs by speaker and shows timestamps', () => {
  const txt = transcriptToText('Weekly ops', [
    { speaker_key: 's0', start_ms: 0, text: 'Hello.' },
    { speaker_key: 's0', start_ms: 3000, text: 'Shall we start?' },
    { speaker_key: 's1', start_ms: 3_725_000, text: 'Yes.' },
  ], new Map([['s0', 'Adeola']]))
  assert.equal(txt, 'Weekly ops\n\n[00:00] Adeola\nHello.\nShall we start?\n\n[1:02:05] Speaker 2\nYes.\n')
  assert.equal(clock(61000), '01:01')
})

test('retention deadlines match the database clock', () => {
  const t = new Date('2026-10-17T10:00:00Z')
  assert.equal(retentionDeadline('delete_after_finalize', t)?.toISOString(), t.toISOString())
  assert.equal(retentionDeadline('days_7', t)?.toISOString(), '2026-10-24T10:00:00.000Z')
  assert.equal(retentionDeadline('days_30', t)?.toISOString(), '2026-11-16T10:00:00.000Z')
  assert.equal(retentionDeadline('days_90', t)?.toISOString(), '2027-01-15T10:00:00.000Z')
  assert.equal(retentionDeadline('permanent', t), null)
})

test('deepgram query asks for diarization and summary only on the final pass', () => {
  const live = new URLSearchParams(deepgramQuery({ diarize: false, summarize: false }))
  assert.equal(live.get('diarize'), 'false')
  assert.equal(live.get('summarize'), null)
  const fin = new URLSearchParams(deepgramQuery({ diarize: true, summarize: true, language: 'en' }))
  assert.equal(fin.get('diarize'), 'true')
  assert.equal(fin.get('summarize'), 'v2')
  assert.equal(fin.get('utterances'), 'true')
})

test('provider summary and topics are read defensively', () => {
  assert.equal(summaryFrom({ results: { summary: { short: ' Budget agreed. ' } } }), 'Budget agreed.')
  assert.equal(summaryFrom({}), null)
  assert.deepEqual(topicsFrom({ results: { topics: { segments: [{ topics: [{ topic: 'Budget' }, { topic: 'Hiring' }] }] } } }), ['Budget', 'Hiring'])
  assert.deepEqual(topicsFrom(null), [])
})

test('cron secret comparison', () => {
  assert.ok(sameSecret('Bearer abc', 'Bearer abc'))
  assert.ok(!sameSecret('Bearer abc', 'Bearer abd'))
  assert.ok(!sameSecret('', 'Bearer abc'))
})

// ---- contract checks on the functions and the migration ----
const fns = ['room-ai-upload', 'room-ai-transcribe', 'room-ai-finalize', 'room-ai-retention']
test('no function returns or logs a provider key, service key or signed URL to the client', () => {
  for (const f of fns) {
    const src = read(`../supabase/functions/${f}/index.ts`)
    assert.doesNotMatch(src, /json\([^)]*(DEEPGRAM_API_KEY|SERVICE_ROLE)/s, f)
    assert.doesNotMatch(src, /console\.(log|error)\([^)]*(signedUrl|transcript|text)/i, f)
  }
  const fin = read('../supabase/functions/room-ai-finalize/index.ts')
  assert.doesNotMatch(fin, /json\([^)]*signedUrl/s)
})

test('client-facing functions authenticate an active employee and check the host', () => {
  for (const f of ['room-ai-upload', 'room-ai-transcribe', 'room-ai-finalize']) {
    const src = read(`../supabase/functions/${f}/index.ts`)
    assert.match(src, /authenticate\(req, admin\)/, f)
    assert.match(src, /loadManagedSession\(/, f)
  }
  const auth = read('../supabase/functions/_shared/roomAiAuth.ts')
  assert.match(auth, /profile\.active !== true/)
  assert.match(auth, /started_by !== userId/)
  assert.doesNotMatch(auth, /role.*admin/i, 'admin role must not grant access')
})

test('retention function only accepts the cron secret', () => {
  const src = read('../supabase/functions/room-ai-retention/index.ts')
  assert.match(src, /CRON_DISPATCH_SECRET/)
  assert.match(src, /sameSecret\(/)
  const cfg = read('../supabase/config.toml')
  assert.match(cfg, /\[functions\.room-ai-retention\][^[]*verify_jwt = false/)
  for (const f of ['room-ai-upload', 'room-ai-transcribe', 'room-ai-finalize'])
    assert.match(cfg, new RegExp(`\\[functions\\.${f}\\][^[]*verify_jwt = true`), f)
})

test('finalize never deletes audio and never writes over an earlier transcript revision', () => {
  const src = read('../supabase/functions/room-ai-finalize/index.ts')
  assert.doesNotMatch(src, /storage[^;]*\.remove\(/)
  assert.match(src, /revision = session\.processing_revision \+ 1/)
  assert.match(src, /missingChunks\(/)
})

test('migration: read-only for clients, no admin branch, append-only trail, private bucket without policies', () => {
  const sql = read('../supabase/migrations/20261017120000_r7_ai_assistant_foundation.sql')
  assert.match(sql, /grant select on public\.workspace_room_ai_sessions/)
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to authenticated/i)
  assert.doesNotMatch(sql, /role\s*=\s*'admin'/)
  assert.match(sql, /e\.active = true/)
  assert.match(sql, /r7_ai_append_only/)
  assert.match(sql, /'room-ai-recordings', 'room-ai-recordings', false/)
  assert.doesNotMatch(sql, /create policy[^;]*storage\.objects/i)
})

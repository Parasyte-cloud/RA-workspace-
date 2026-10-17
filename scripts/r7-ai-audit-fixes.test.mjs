import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const mig = read('../supabase/migrations/20261017160000_r7_ai_hardening.sql')

// ---- Finding 1: a failed IndexedDB write must not lose a chunk (no IndexedDB here, like private mode)
test('a chunk survives a failed on-device write and is still uploadable', async () => {
  assert.equal(typeof indexedDB, 'undefined')
  const store = await import('../src/room7-ai/recorderStore.ts')
  const sid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const blob = new Blob([new Uint8Array(40)], { type: 'audio/webm' })
  await assert.rejects(store.putChunk({ sessionId: sid, seq: 0, mime: 'audio/webm', blob, bytes: 40, uploaded: false }))
  await assert.rejects(store.putChunk({ sessionId: sid, seq: 1, mime: 'audio/webm', blob, bytes: 40, uploaded: false }))
  let list = await store.chunksFor(sid)
  assert.deepEqual(list.map((c) => [c.seq, c.uploaded, !!c.blob]), [[0, false, true], [1, false, true]])
  await store.markUploaded(sid, 0)
  list = await store.chunksFor(sid)
  assert.deepEqual(list.map((c) => [c.seq, c.uploaded, !!c.blob]), [[0, true, false], [1, false, true]])
  await assert.rejects(store.forgetSession(sid)) // IndexedDB missing; memory is still cleared first
  assert.deepEqual(await store.chunksFor(sid), [])
})

test('the recorder tells the person when its backup copy failed', () => {
  const hook = read('../src/room7-ai/usePhysicalRecorder.ts')
  assert.match(hook, /\.catch\(\(\) => setBufferProblem\(true\)\)/)
  assert.ok(!/putChunk\([^)]*\)\s*\n?\s*\.catch\(\(\) => undefined\)/.test(hook))
  assert.match(read('../src/room7-ai/PhysicalMeetingRecorder.tsx'), /r\.bufferProblem/)
})

// ---- Finding 2: stored chunks are verified against their SHA-256
test('finalize checks every downloaded chunk against its stored SHA-256', () => {
  const fin = read('../supabase/functions/room-ai-finalize/index.ts')
  assert.match(fin, /select\("seq,storage_path,bytes,mime,sha256"\)/)
  assert.match(fin, /sha256Hex\(part\)\) !== c\.sha256/)
  assert.match(fin, /chunk_checksum_mismatch/)
})

// ---- Finding 3: cron repair can be re-run and inspected
test('cron re-authentication is re-runnable, inspectable and not exposed to the app', () => {
  assert.match(mig, /function public\.repair_cron_authentication\(\)/)
  assert.match(mig, /function public\.cron_authentication_status\(\)/)
  assert.match(mig, /revoke all on function public\.repair_cron_authentication\(\) from public, anon, authenticated/)
  assert.match(mig, /revoke all on function public\.cron_authentication_status\(\) from public, anon, authenticated/)
  assert.match(mig, /raise warning 'Cron job %/)
  assert.match(read('../docs/live-security-checks.sql'), /cron_authentication_status/)
})

// ---- Finding 4: hard server-side maximum for expected_chunks
test('expected_chunks has a database ceiling and a server check, matching MAX_CHUNKS', async () => {
  const core = await import('../supabase/functions/_shared/roomAiCore.ts')
  assert.equal(core.MAX_CHUNKS, 20000)
  assert.match(mig, /check \(expected_chunks is null or expected_chunks <= 20000\)/)
  assert.match(mig, /p_expected_chunks > 20000/)
  assert.match(mig, /least\(greatest\(coalesce\(p_duration_seconds, 0\), 0\), 259200\)/)
  assert.match(read('../supabase/functions/room-ai-finalize/index.ts'), /expected > MAX_CHUNKS/)
})

// ---- Finding 5: consent evidence
test('consent wording is stored by version, append-only, and shown from the same constant', async () => {
  const api = read('../src/room7-ai/api.ts')
  const text = api.match(/PHYSICAL_CONSENT_TEXT = '([^']+)'/)[1]
  assert.ok(mig.includes(`'${text}'`), 'database wording must equal the screen wording')
  assert.match(mig, /create trigger r7_ai_statements_append_only/)
  assert.match(mig, /statement_version, client_user_agent/)
  assert.match(mig, /'consent_statement', statement/)
  assert.match(mig, /'attendee_names', names/)
  assert.match(mig, /drop function if exists public\.start_physical_ai_session\(text, jsonb, text, boolean, boolean, text\)/)
  assert.match(api, /p_statement_version: PHYSICAL_CONSENT_VERSION/)
  assert.match(read('../src/room7-ai/PhysicalMeetingSetup.tsx'), /\{PHYSICAL_CONSENT_TEXT\}/)
})

// ---- Finding 6: transcript pagination (Supabase returns at most 1000 rows per request)
test('long transcripts are read in pages, in order, without gaps or repeats', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r7api-'))
  const stub = join(dir, 'supabase-stub.mjs')
  writeFileSync(stub, `
    const TOTAL = 2500
    export const calls = []
    export const supabase = { from() {
      let range = [0, 999]
      const q = { select() { return q }, eq() { return q }, order() { return q },
        range(a, b) { range = [a, b]; calls.push([a, b]); return q },
        then(resolve) {
          const rows = []
          for (let i = range[0]; i <= Math.min(range[1], 999) + (range[0] - 0) && i < TOTAL && rows.length < 1000; i++) rows.push({ id: i, text: 't' + i })
          resolve({ data: rows, error: null })
        } }
      return q } }
    globalThis.__calls = calls
  `)
  const out = join(dir, 'api.mjs')
  await build({
    entryPoints: [new URL('../src/room7-ai/api.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: stub })) } }],
  })
  const api = await import(out)
  const rows = await api.loadTranscript({ id: 's', state: 'ready', processing_revision: 1 })
  assert.equal(rows.length, 2500)
  assert.deepEqual(rows.map((r) => r.id), [...Array(2500).keys()])
  assert.deepEqual(globalThis.__calls, [[0, 999], [1000, 1999], [2000, 2999]])
  assert.ok(!/\.limit\(5000\)/.test(read('../src/room7-ai/api.ts')))
})

test('no em dash in the new files', () => {
  for (const f of ['../supabase/migrations/20261017160000_r7_ai_hardening.sql', '../src/room7-ai/recorderStore.ts', '../src/room7-ai/api.ts']) {
    assert.ok(!read(f).includes('—'), f)
  }
})

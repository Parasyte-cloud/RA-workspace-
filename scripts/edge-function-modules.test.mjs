import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { build } from 'esbuild'

const FUNCS = ['room-event-control', 'room-event-documents', 'ridearrivo-support']

// Bundle each entry point the way the Deno bundler will: every relative import
// must resolve, and nothing may be imported in a circle. URL imports stay external.
for (const name of FUNCS) {
  test(`${name} bundles with every relative import resolved`, async () => {
    const r = await build({
      entryPoints: [`supabase/functions/${name}/index.ts`],
      bundle: true, write: false, format: 'esm', platform: 'neutral',
      external: ['https://*'], logLevel: 'silent',
    })
    assert.equal(r.errors.length, 0)
  })

  test(`${name} keeps mutable state and the request handler in index.ts`, () => {
    const idx = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')
    assert.match(idx, /serve\(|Deno\.serve\(/)
    for (const f of readdirSync(`supabase/functions/${name}`).filter((x) => x !== 'index.ts')) {
      const src = readFileSync(`supabase/functions/${name}/${f}`, 'utf8')
      assert.doesNotMatch(src, /^let /m, `${f} must not hold mutable module state`)
      assert.doesNotMatch(src, /serve\(|Deno\.serve\(/, `${f} must not start a server`)
    }
  })
}

test('extracted helpers behave exactly as before', async () => {
  const out = await build({
    entryPoints: ['supabase/functions/room-event-control/lib.ts'],
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
  })
  const m = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
  assert.equal(m.cleanText('  hello world  ', 5), 'hello')
  assert.equal(m.cleanText(42, 5), '')
  assert.equal(m.normalizeCode(' ab-c1d9 e!'), 'ABCD9E')
  assert.equal(new m.HttpError(403, 'no').status, 403)
  assert.equal(m.cors(new Request('https://x', { headers: { Origin: 'https://evil.example' } }))['Access-Control-Allow-Origin'], 'https://intranet.ridearrivo.com')
  assert.equal(m.cors(new Request('https://x', { headers: { Origin: 'http://localhost:5173' } }))['Access-Control-Allow-Origin'], 'http://localhost:5173')
})

test('every function directory only imports files that exist', () => {
  for (const name of FUNCS) {
    for (const f of readdirSync(`supabase/functions/${name}`)) {
      const src = readFileSync(`supabase/functions/${name}/${f}`, 'utf8')
      for (const m of src.matchAll(/from "(\.\/[^"]+)"/g)) assert.ok(existsSync(`supabase/functions/${name}/${m[1]}`), `${name}/${f} -> ${m[1]}`)
    }
  }
})

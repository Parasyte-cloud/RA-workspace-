// The service worker must never serve or keep an HTML page in place of a
// script or stylesheet. Runs the real public/sw.js against fakes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const code = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const ORIGIN = 'https://intranet.example'

function boot({ network, cachedBody }) {
  const handlers = {}
  const stored = new Map()
  const cachePut = []
  const calls = []
  const sandbox = {
    URL, Response, Request,
    self: { location: { origin: ORIGIN }, addEventListener: (n, f) => { handlers[n] = f }, skipWaiting() {}, clients: { claim() {} } },
    caches: {
      open: async () => ({ addAll: async () => {}, put: async (r, res) => { cachePut.push(r.url) } }),
      match: async () => cachedBody ? new Response(cachedBody.body, { headers: { 'content-type': cachedBody.type } }) : undefined,
      keys: async () => [], delete: async () => true,
    },
    fetch: async (input, init) => { calls.push({ url: typeof input === 'string' ? input : input.url, cache: init && init.cache }); return network(calls.length, init) },
  }
  vm.runInNewContext(code, sandbox)
  return { calls, cachePut, run: async path => {
    let out
    handlers.fetch({ request: new Request(ORIGIN + path), respondWith: p => { out = p } })
    return out
  } }
}

const js = () => new Response('export{}', { headers: { 'content-type': 'application/javascript' } })
const html = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })

test('a good script is returned and cached', async () => {
  const sw = boot({ network: () => js() })
  const r = await sw.run('/assets/index-abc.js')
  assert.equal(r.headers.get('content-type'), 'application/javascript')
  assert.equal(sw.calls.length, 1)
})

test('HTML in place of a script triggers one cache-bypassing retry and recovers', async () => {
  const sw = boot({ network: n => (n === 1 ? html() : js()) })
  const r = await sw.run('/assets/index-abc.js')
  assert.equal(r.headers.get('content-type'), 'application/javascript')
  assert.equal(sw.calls[1].cache, 'reload')
  assert.match(sw.calls[1].url, /\?_r=/, 'the retry must carry a throwaway query so edge caches are skipped')
  assert.deepEqual(sw.cachePut.length, 1)
})

test('HTML that persists is refused and never cached', async () => {
  const sw = boot({ network: () => html() })
  const r = await sw.run('/assets/index-abc.js')
  assert.equal(r.type, 'error')
  assert.equal(sw.cachePut.length, 0)
})

test('a bad cached script is not served when offline', async () => {
  const sw = boot({ network: () => { throw new Error('offline') }, cachedBody: { body: '<!doctype html>', type: 'text/html' } })
  const r = await sw.run('/assets/index-abc.js')
  assert.equal(r.type, 'error')
})

test('pages themselves may be HTML', async () => {
  const sw = boot({ network: () => html() })
  const r = await sw.run('/')
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(sw.calls.length, 1)
})

test('headers: hashed assets are not marked immutable', () => {
  const headers = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  const block = headers.split('\n/assets/*\n')[1].split('\n')[0]
  assert.ok(!/immutable/.test(block), block)
  assert.match(block, /must-revalidate/)
})

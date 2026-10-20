import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../public/support-join.html', import.meta.url), 'utf8')
const requiredIds = [
  'join-form','join-email','join-code','join-password','join-confirm','join-submit',
  'join-message','join-ready','join-success','join-success-text','join-continue'
]

test('join page DOM and script use one consistent contract', () => {
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing markup id ${id}`)
    assert.match(html, new RegExp(`\\$\\(['"]${id}['"]\\)`), `script does not reference ${id}`)
  }
})

test('join page securely prefills and removes invitation query parameters', () => {
  assert.match(html, /new URLSearchParams\(location\.search\)/)
  assert.match(html, /params\.get\('email'\)/)
  assert.match(html, /params\.get\('code'\)/)
  assert.match(html, /history\.replaceState\(null, '', location\.pathname\)/)
})

test('join page validates the 10 character password contract', () => {
  const minlength10 = html.match(/minlength=["']10["']/g) || []
  assert.equal(minlength10.length, 2)
  assert.match(html, /password\.length < 10/)
  assert.match(html, /password !== \$\('join-confirm'\)\.value/)
})

test('join page sends only the supported redeem payload and has recoverable states', () => {
  assert.match(html, /JSON\.stringify\(\{ action: 'redeem', email: email, code: code, password: password \}\)/)
  assert.match(html, /'Creating access…'/)
  assert.match(html, /join-submit.*disabled/s)
  assert.match(html, /join-ready.*hidden/s)
  assert.match(html, /join-success.*hidden/s)
  assert.match(html, /existingAccount/)
  assert.match(html, /location\.href = '\/'/)
  assert.match(html, /Could not reach the server/)
})

test('join page has an explicit configured functions endpoint', () => {
  assert.match(html, /meta name=["']support-functions-url["'] content=["']https:\/\/fkkxcivxnwshahnbatnp\.supabase\.co\/functions\/v1["']/)
})

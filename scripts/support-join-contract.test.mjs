import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../public/support-join.html', import.meta.url), 'utf8')
const requiredIds = [
  'join-form','join-email','join-code','join-password-stage','join-password','join-confirm','join-submit',
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

test('join page starts with invite verification and keeps password setup hidden', () => {
  assert.match(html, /id=["']join-password-stage["'][^>]*hidden/)
  assert.match(html, /var passwordStage = false/)
  assert.match(html, /Verify invitation/)
  assert.match(html, /var payload = passwordStage/)
  assert.match(html, /JSON\.stringify\(\{ action: 'redeem', email: email, code: code \}\)/)
})

test('join page reveals password setup only after needsPassword', () => {
  assert.match(html, /result\.body\.needsPassword/)
  assert.match(html, /passwordStage = true/)
  assert.match(html, /\$\('join-password-stage'\)\.hidden = false/)
  assert.match(html, /join-email[^\n]+readOnly = true/)
  assert.match(html, /join-code[^\n]+readOnly = true/)
})

test('join page validates the 10 character password contract only in password stage', () => {
  const minlength10 = html.match(/minlength=["']10["']/g) || []
  assert.equal(minlength10.length, 2)
  assert.match(html, /if \(passwordStage\)[\s\S]*password\.length < 10/)
  assert.match(html, /if \(passwordStage\)[\s\S]*password !== \$\('join-confirm'\)\.value/)
})

test('join page sends a password only during second-stage new-account creation', () => {
  assert.match(html, /JSON\.stringify\(\{ action: 'redeem', email: email, code: code, password: password \}\)/)
  assert.match(html, /Creating access…/)
  assert.match(html, /existingAccount/)
  assert.match(html, /existing password/i)
  assert.match(html, /location\.href = '\/'/)
})

test('join page keeps recoverable query stripping and network errors', () => {
  assert.match(html, /join-submit.*disabled/s)
  assert.match(html, /join-ready.*hidden/s)
  assert.match(html, /join-success.*hidden/s)
  assert.match(html, /Could not reach the server/)
})

test('join page has an explicit configured functions endpoint', () => {
  assert.match(html, /meta name=["']support-functions-url["'] content=["']https:\/\/fkkxcivxnwshahnbatnp\.supabase\.co\/functions\/v1["']/)
})

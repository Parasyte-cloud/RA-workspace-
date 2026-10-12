import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/authLink.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const L = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const app = readFileSync('src/App.tsx', 'utf8')
const client = readFileSync('src/lib/supabase.ts', 'utf8')
const sql = readFileSync('supabase/migrations/20261012220000_account_has_password.sql', 'utf8')

test('an expired or used link is recognised and explained, not silently ignored', () => {
  const link = L.parseAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '')
  assert.equal(link.kind, 'error')
  assert.match(link.message, /expired or was already used/)
  assert.match(link.message, /Forgot \/ Reset Password/)
})

test('invite and recovery links are recognised from the address bar', () => {
  assert.equal(L.parseAuthLink('#access_token=abc&type=invite&refresh_token=x', '').kind, 'invite')
  assert.equal(L.parseAuthLink('#access_token=abc&type=recovery', '').kind, 'recovery')
  assert.equal(L.parseAuthLink('', '').kind, 'none')
  assert.equal(L.parseAuthLink('#access_token=abc&type=magiclink', '').kind, 'none')
})

test('a click-to-continue link (token_hash) is recognised, and unknown types are ignored', () => {
  const ok = L.parseAuthLink('', '?token_hash=h123&type=recovery')
  assert.deepEqual({ ...ok }, { kind: 'confirm', tokenHash: 'h123', type: 'recovery' })
  assert.equal(L.parseAuthLink('', '?token_hash=h123&type=bogus').kind, 'none')
})

test('sign-in errors are described in plain words', () => {
  assert.match(L.describeSignInError({ message: 'Invalid login credentials', code: 'invalid_credentials' }), /capital letter or an extra space/)
  assert.match(L.describeSignInError({ message: 'Email not confirmed' }), /not been confirmed/)
  assert.match(L.describeSignInError({ message: 'x', status: 429 }), /Too many attempts/)
  assert.equal(L.describeSignInError({ message: 'Something else' }), 'Something else')
})

test('a pasted password with a stray space gets one extra try; a clean one does not', () => {
  assert.equal(L.trimmedRetry('Secret phrase here '), 'Secret phrase here')
  assert.equal(L.trimmedRetry('Secret phrase here\n'), 'Secret phrase here')
  assert.equal(L.trimmedRetry('Secret phrase here'), null)
  assert.equal(L.trimmedRetry('   '), null)
})

test('the address is read before the Supabase client can erase it', () => {
  assert.ok(client.indexOf('initialAuthLink') < client.indexOf('createClient(url'))
  assert.match(client, /parseAuthLink\(window\.location\.hash, window\.location\.search\)/)
})

test('an invited person is made to choose a password, even if they arrive without the link', () => {
  assert.match(app, /rpc\('my_account_has_password'\)/)
  assert.match(app, /initialAuthLink\.kind==='invite'/)
  assert.match(app, /mode==='invite'/)
  assert.match(app, /Create your password\./)
})

test('the password check never exposes the hash and fails open', () => {
  assert.match(sql, /returns boolean/)
  assert.match(sql, /security definer/)
  assert.match(sql, /u\.id = auth\.uid\(\)/)
  assert.match(sql, /true\s*\)/)
  assert.ok(!/select[^;]*encrypted_password\s*from/i.test(sql))
  assert.match(sql, /revoke all on function public\.my_account_has_password\(\) from public, anon/)
})

test('the sign-in form helps typing mistakes: no auto-capital, show password, trimmed retry', () => {
  assert.match(app, /autoCapitalize="none"/)
  assert.match(app, /Show password/)
  assert.match(app, /trimmedRetry\(password\)/)
  assert.match(app, /describeSignInError\(error\)/)
})

test('after saving a password the person is told, and the link page needs a real click', () => {
  assert.match(app, /Password saved\. Sign in with your work email/)
  assert.match(app, /verifyOtp\(\{token_hash:link\.tokenHash,type:link\.type\}\)/)
})

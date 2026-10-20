import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function authGateBody() {
  const start = source.indexOf('function AuthGate(')
  assert.notEqual(start, -1, 'AuthGate must exist')
  return source.slice(start)
}

test('Support surface allows invited personal email to reach auth while intranet keeps company-domain policy', () => {
  const body = authGateBody()
  assert.match(body, /const emailAllowedForCurrentSurface=\(value:string\)=>/)
  assert.match(body, /isSupportDomain\(\)\s*\?\s*isValidEmailAddress\(value\)\s*:\s*validDomain\(value\)/)
  assert.match(body, /if\(!emailAllowedForCurrentSurface\(cleanEmail\)\)/)
  assert.match(body, /supabase\.auth\.signInWithPassword/)
  assert.match(body, /allowedDomains\.some/)
})

test('Support password reset uses the same host-aware email policy', () => {
  const body = authGateBody()
  const resetStart = body.indexOf('const sendPasswordReset=async()=>')
  const submitStart = body.indexOf('const submit=async')
  assert.notEqual(resetStart, -1)
  assert.notEqual(submitStart, -1)
  const reset = body.slice(resetStart, submitStart)
  assert.match(reset, /emailAllowedForCurrentSurface\(cleanEmail\)/)
  assert.match(reset, /resetPasswordForEmail/)
})

test('Support and intranet display surface-appropriate email guidance', () => {
  const body = authGateBody()
  assert.match(body, /isSupportDomain\(\)\s*\?\s*'Email address'\s*:\s*'Work email'/)
  assert.match(body, /isSupportDomain\(\)\s*\?\s*'you@example\.com'\s*:\s*'name@ridearrivo\.com'/)
  assert.match(body, /email address attached to your Support invitation/i)
  assert.match(body, /approved RideArrivo work email/i)
})

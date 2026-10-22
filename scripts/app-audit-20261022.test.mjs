import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { lagosToday, lagosDayOffset } from '../src/lib/lagosDate.ts'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('Lagos "today" is the Lagos calendar day, not the UTC day', () => {
  // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in Lagos (UTC+1, no daylight saving).
  const lateUtc = new Date('2026-10-09T23:30:00Z')
  assert.equal(lagosToday(lateUtc), '2026-10-10')
  assert.equal(lagosToday(new Date('2026-10-09T10:00:00Z')), '2026-10-09')
  assert.equal(lagosDayOffset(30, lateUtc), '2026-11-09')
  assert.equal(lagosDayOffset(-1, lateUtc), '2026-10-09')
  assert.equal(lagosDayOffset(1, new Date('2026-12-31T23:30:00Z')), '2027-01-02')
})

test('leave, receipts and vendor contracts use the Lagos day', () => {
  for (const f of ['src/components/MyLeave.tsx', 'src/modules/OperationsReceiptsPanel.tsx', 'src/modules/VendorsPanel.tsx']) {
    const src = read(f)
    assert.match(src, /lagosDate/, f)
    assert.doesNotMatch(src, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, `${f} still uses the UTC day`)
  }
})

test('the chat attachment signing effect cannot loop on a missing file', () => {
  const src = read('src/chat/ChatShell.tsx')
  const start = src.indexOf('createSignedUrls(need,SIGNED_SECONDS)')
  assert.notEqual(start, -1)
  const block = src.slice(start, start + 900)
  assert.match(block, /let next=current/)
  assert.match(block, /return next/)
  assert.doesNotMatch(block, /const next=\{\.\.\.current\}/, 'must not build a new object on every response')
})

test('text typed for a confidential message is not saved as a draft', () => {
  const src = read('src/chat/ChatShell.tsx')
  assert.match(src, /if\(selectedId && !vaultOn\)rememberDraft\(selectedId,next\)/)
  assert.match(src, /if\(!vaultOn && selectedId\)rememberDraft\(selectedId,''\)/)
})

test('a password reset ends the other sessions, not only this device', () => {
  const src = read('src/App.tsx')
  const i = src.indexOf("Password saved. Taking you to sign in")
  assert.notEqual(i, -1)
  const block = src.slice(i, i + 600)
  assert.match(block, /signOutOtherDevices\(supabase\)/)
  assert.ok(block.indexOf('signOutOtherDevices') < block.indexOf("signOutThisDevice(supabase,'password')"))
  assert.match(read('src/lib/authSignOut.ts'), /signOut\(\{ scope: 'others' \}\)/)
})

test('links that come from the database go through safeHttpUrl', () => {
  assert.match(read('src/modules/ApplicationsHub.tsx'), /safeHttpUrl\(app\.url\)/)
  assert.match(read('src/modules/Phase2Modules.tsx'), /safeHttpUrl\(payload\?\.provider_url\)/)
})

test('no em dash in the files added by this change', () => {
  const dash = String.fromCharCode(0x2014)
  for (const f of ['src/lib/lagosDate.ts', 'src/lib/bankStatementParse.ts', 'scripts/app-audit-20261022.test.mjs', 'scripts/bank-statement-parse.test.mjs']) {
    assert.ok(!read(f).includes(dash), f)
  }
})

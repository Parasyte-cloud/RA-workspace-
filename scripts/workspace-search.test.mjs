import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const fn = readFileSync('supabase/functions/workspace-search/index.ts', 'utf8')
const sql = readFileSync('supabase/checks/workspace_search_rls_check.sql', 'utf8')
const gs = readFileSync('src/components/GlobalSearch.tsx', 'utf8')

const block = fn.slice(fn.indexOf('const USER_SCOPED_DOMAINS'), fn.indexOf('function relevance'))
const tables = [...block.matchAll(/table: "([a-z_]+)"/g)].map(m => m[1])
const keys = [...block.matchAll(/key: "([A-Za-z]+)"/g)].map(m => m[1])

test('every user-scoped table is covered by the RLS check', () => {
  assert.ok(tables.length >= 10)
  for (const table of tables) assert.ok(sql.includes(`'${table}'`), `${table} missing from RLS check`)
})

test('user-scoped domains use the caller client, never the service role', () => {
  assert.match(fn, /SUPABASE_ANON_KEY/)
  assert.match(fn, /Authorization: authHeader/)
  assert.doesNotMatch(block, /service/i)
})

test('legal domains stay role guarded', () => {
  for (const key of ['legalStatutes', 'legalOpinions', 'legalContracts']) {
    const at = block.indexOf(`key: "${key}"`)
    assert.ok(block.slice(at, at + 500).includes('roles: LEGAL_ROLES'), `${key} not role guarded`)
  }
})

test('sensitive tables are not searchable', () => {
  for (const bad of ['kyc', 'performance', 'candidate', 'ledger', 'wallet', 'hr_detail']) {
    assert.ok(!tables.some(t => t.includes(bad)), `${bad} must not be searched`)
  }
})

test('front end renders every backend domain', () => {
  for (const key of keys) assert.ok(gs.includes(`r('${key}')`), `${key} not shown in GlobalSearch`)
})

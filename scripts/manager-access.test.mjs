import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261015210000_narrow_manager_hr_legal_access.sql', 'utf8')
const ui = readFileSync('src/modules/CoreModules.tsx', 'utf8')

test('people tables are limited to hr and admin', () => {
  assert.match(sql, /'people_candidates','people_performance_reviews','people_training_records'/)
  assert.match(sql, /array\[''hr'',''admin''\]/)
})

test('legal intake tables are limited to legal and admin', () => {
  assert.match(sql, /'legal_requests','privacy_requests','regulatory_filings'/)
  assert.match(sql, /array\[''legal'',''admin''\]/)
})

test('no manager role appears in the new policies', () => {
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(code, /manager/)
})

test('people screen hides HR workbenches from other roles', () => {
  assert.match(ui, /!operationsView&&\['hr','admin'\]\.includes\(viewerRole\)&&<>/)
})

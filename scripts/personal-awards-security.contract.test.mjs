import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const path = new URL('../supabase/migrations/20261020300000_recognition_personal_awards.sql', import.meta.url)
const sql = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : ''
const normalized = sql.toLowerCase().replace(/\s+/g, ' ')
const has = (pattern, message) => assert.match(sql, pattern, message)

function functionSlice(name) {
  const marker = `create or replace function public.${name}`
  const start = normalized.indexOf(marker)
  assert.ok(start >= 0, `${name} must exist`)
  const next = normalized.indexOf('create or replace function public.', start + marker.length)
  return normalized.slice(start, next < 0 ? normalized.length : next)
}

function statementSlice(startMarker, endMarker) {
  const start = normalized.indexOf(startMarker)
  assert.ok(start >= 0, `${startMarker} must exist`)
  const end = normalized.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`)
  return normalized.slice(start, end)
}

test('personal award migration adds the approved fields and values', () => {
  assert.ok(sql.length > 0, 'personal award migration must exist')
  for (const column of ['award_category','title','description','visibility','company_title','company_message','source_kind','source_key','issued_by','issue_reason','revoked_at','revoked_by','revocation_reason','updated_at']) {
    has(new RegExp(`add column if not exists ${column}`, 'i'), `${column} missing`)
  }
  for (const category of ['monthly_kpi_excellence','annual_kpi_excellence','golden_of_week','major_project_contribution','clean_overdue_record','customer_commendation','team_commendation','service_anniversary','training_compliance','identity_compliance_milestone','other']) {
    has(new RegExp(`'${category}'`), `${category} missing`)
  }
  has(/visibility[^;]+check[^;]+private[^;]+company_recognition/is, 'visibility constraint missing')
})

test('migration relaxes KPI-only fields and replaces unsafe global uniqueness', () => {
  has(/alter column score drop not null/i, 'score must be nullable for non-KPI awards')
  has(/alter column performance_month drop not null/i, 'performance month must be nullable')
  has(/drop constraint if exists employee_recognition_awards_award_month_key/i, 'legacy month uniqueness must be removed')
  has(/drop index if exists (?:public\.)?employee_recognition_one_active_idx/i, 'global active index must be removed')
  const monthlyIndex = statementSlice('create unique index if not exists employee_recognition_monthly_winner_unique', 'create unique index if not exists employee_recognition_source_unique')
  assert.match(monthlyIndex, /award_month/)
  assert.match(monthlyIndex, /revoked_at\s+is\s+null/)
  assert.match(monthlyIndex, /award_category\s*=\s*'monthly_kpi_excellence'/)
  assert.doesNotMatch(monthlyIndex, /active\s*=\s*true/, 'historical monthly awards remain valid after their featured badge becomes inactive')
})

test('existing rows backfill privately without changing KPI evidence', () => {
  const backfill = statementSlice('update public.employee_recognition_awards set award_category', 'alter table public.employee_recognition_awards alter column award_category')
  assert.match(backfill, /award_category/)
  assert.match(backfill, /visibility = 'private'/)
  assert.doesNotMatch(backfill, /score\s*=/, 'backfill must not rewrite scores')
  assert.doesNotMatch(backfill, /performance_month\s*=/, 'backfill must not rewrite performance months')
})

test('monthly KPI refresh targets only monthly rows and creates one private winner', () => {
  const fragment = functionSlice('refresh_monthly_kpi_award')
  assert.match(fragment, /award_category\s*=\s*'monthly_kpi_excellence'/)
  assert.match(fragment, /source_kind\s*,\s*source_key/)
  assert.match(fragment, /'kpi_monthly_winner'/)
  assert.match(fragment, /visibility/)
  assert.match(fragment, /'private'/)
  assert.match(fragment, /where active\s*=\s*true[\s\S]{0,300}award_category\s*=\s*'monthly_kpi_excellence'/)
  assert.doesNotMatch(fragment, /set active=false\s+where active=true\s*;/, 'refresh must not deactivate all award categories')
  assert.match(fragment, /where a\.award_month\s*=\s*target_award_month/)
  assert.match(fragment, /where a\.award_month\s*=\s*target_award_month[\s\S]{0,180}a\.revoked_at\s+is\s+null/, 'only an unrevoked monthly award keeps refresh idempotent')
  assert.doesNotMatch(fragment, /where a\.award_month\s*=\s*target_award_month[\s\S]{0,180}a\.active\s*=\s*true/, 'an existing historical monthly award must keep refresh idempotent')
})

test('private award DTO is caller scoped, paginated, permanent and excludes revoked rows', () => {
  const fragment = functionSlice('list_my_awards')
  assert.match(fragment, /a\.employee_id\s*=\s*auth\.uid\(\)/)
  assert.match(fragment, /a\.revoked_at\s+is\s+null/)
  assert.doesNotMatch(fragment, /a\.active\s*=\s*true/, 'legacy featured-badge state must not hide permanent award history')
  assert.match(fragment, /greatest\s*\(\s*1\s*,\s*least/)
  assert.match(fragment, /order by a\.awarded_at desc\s*,\s*a\.id desc/)
  assert.doesNotMatch(fragment, /total_assigned|completed_on_time|overdue_open/)
})

test('company recognition DTO is sanitized and explicit', () => {
  const fragment = functionSlice('list_company_recognition_awards')
  assert.match(fragment, /visibility\s*=\s*'company_recognition'/)
  assert.match(fragment, /company_title/)
  assert.match(fragment, /company_message/)
  assert.doesNotMatch(fragment, /a\.active\s*=\s*true/, 'published recognition history remains visible until explicit revocation')
  for (const privateField of ['score','overdue_open','total_assigned','total_completed','completed_on_time','issue_reason']) {
    assert.doesNotMatch(fragment, new RegExp(`\\b${privateField}\\b`), `company DTO leaks ${privateField}`)
  }
})

test('browser access is RPC only and helpers are hardened', () => {
  assert.match(normalized, /revoke all on public\.employee_recognition_awards from public, anon, authenticated/)
  for (const fn of ['list_my_awards','list_company_recognition_awards']) {
    const fragment = functionSlice(fn)
    assert.match(fragment, /security definer/)
    assert.match(fragment, /set search_path\s*=\s*public\s*,\s*pg_temp/)
    assert.match(normalized, new RegExp(`grant execute on function public\\.${fn}`))
  }
})

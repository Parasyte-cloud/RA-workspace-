import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql = fs.readFileSync('supabase/migrations/20261020330000_recognition_seasonal_campaigns.sql','utf8')

test('seasonal campaigns use exact governed state and type vocabulary',()=>{
  for (const v of ['christmas','new_year','draft','scheduled','published','materialized','cancelled','completed']) assert.match(sql,new RegExp(`'${v}'`))
  assert.match(sql,/audience_scope[^\n]+company/i)
  assert.match(sql,/unique\s*\([^)]*campaign_type[^)]*campaign_year[^)]*audience_scope/i)
})

test('seasonal materialization is server timed idempotent and recipient unique',()=>{
  assert.match(sql,/materialize_due_recognition_seasonal_campaigns\s*\(\s*p_now timestamptz default now\(\)/i)
  assert.match(sql,/for update skip locked/i)
  assert.match(sql,/on conflict do nothing/i)
  assert.match(sql,/ensure_my_due_seasonal_deliveries\s*\(\s*\)/i)
  assert.doesNotMatch(sql,/ensure_my_due_seasonal_deliveries\s*\([^)]*user/i)
})

test('New Year variant is refreshed at claim time from server now',()=>{
  assert.match(sql,/refresh_due_seasonal_delivery_variant/i)
  assert.match(sql,/live_midnight/i)
  assert.match(sql,/delayed/i)
  assert.match(sql,/claim_next_recognition_ceremony[\s\S]*refresh_due_seasonal_delivery_variant/i)
})

test('seasonal cron reads Vault secret and never embeds service role credentials',()=>{
  assert.match(sql,/cron_dispatch_secret/i)
  assert.match(sql,/ridearrivo-recognition-seasonal-dispatch/i)
  assert.match(sql,/\* \* \* \* \*/)
  assert.doesNotMatch(sql,/service_role_key|SUPABASE_SERVICE_ROLE_KEY/i)
})

test('cancelling a seasonal campaign revokes only unclaimed pending deliveries',()=>{
  const cancel = sql.match(/create or replace function public\.cancel_recognition_seasonal_campaign[\s\S]*?end; \$\$;/i)?.[0] || ''
  assert.match(cancel,/source_kind='seasonal_campaign'/i)
  assert.match(cancel,/state\s*=\s*'pending'/i)
  assert.doesNotMatch(cancel,/state\s+in\s*\(\s*'pending'\s*,\s*'claimed'\s*\)/i)
})

test('seasonal edits and cancellation reject stale administrator state',()=>{
  const save = sql.match(/create or replace function public\.save_recognition_seasonal_campaign[\s\S]*?end; \$\$;/i)?.[0] || ''
  const cancel = sql.match(/create or replace function public\.cancel_recognition_seasonal_campaign[\s\S]*?end; \$\$;/i)?.[0] || ''
  assert.match(save,/expected_updated_at/i)
  assert.match(save,/updated_at\s*<>\s*v_expected|v_current\.updated_at\s*<>\s*v_expected/i)
  assert.match(cancel,/p_expected_updated_at/i)
  assert.match(cancel,/updated_at\s*<>\s*p_expected_updated_at|v\.updated_at\s*<>\s*p_expected_updated_at/i)
})

test('caller fallback cannot widen a materialized seasonal recipient snapshot',()=>{
  const start=sql.indexOf('create or replace function public.ensure_my_due_seasonal_deliveries')
  const end=sql.indexOf('create or replace function public.refresh_due_seasonal_delivery_variant',start)
  const body=sql.slice(start,end)
  assert.match(body,/state\s+in\s*\(\s*'scheduled'\s*,\s*'published'\s*\)/i)
  assert.doesNotMatch(body,/state\s+in\s*\([^)]*'materialized'/i)
})

test('seasonal variant refresh avoids PLpgSQL row-variable and SQL-alias collisions',()=>{
  const refresh = sql.match(/create or replace function public\.refresh_due_seasonal_delivery_variant[\s\S]*?end; \$\$;/i)?.[0] || ''
  assert.doesNotMatch(refresh,/declare\s+c\s+public\.recognition_seasonal_campaigns%rowtype/i)
  assert.match(refresh,/declare\s+v_campaign\s+public\.recognition_seasonal_campaigns%rowtype/i)
  assert.match(refresh,/join\s+public\.recognition_seasonal_campaigns\s+sc\s+on\s+sc\.id\s*=\s*d\.source_id/i)
})

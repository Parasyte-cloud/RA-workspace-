import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012180000_backup_dispatch.sql', 'utf8')
const wf = readFileSync('.github/workflows/admin-backup-writer.yml', 'utf8')
const dispatchFn = sql.slice(sql.indexOf('create or replace function public.dispatch_admin_backup_runner'), sql.indexOf('create or replace function public.check_admin_backup_health'))

test('the dispatcher is security definer with a pinned search_path and is not callable by clients', () => {
  assert.match(dispatchFn, /security definer/)
  assert.match(dispatchFn, /set search_path = public, pg_temp/)
  assert.match(sql, /revoke all on function public\.dispatch_admin_backup_runner\(text, text, text\)\s+from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant execute on function public\.dispatch_admin_backup_runner/)
})

test('the log table is closed to every client role', () => {
  assert.match(sql, /alter table public\.admin_backup_dispatches enable row level security/)
  assert.match(sql, /revoke all on table public\.admin_backup_dispatches from public, anon, authenticated/)
  assert.doesNotMatch(sql, /create policy[^;]*admin_backup_dispatches/)
})

test('the token comes from Vault and is never written anywhere', () => {
  assert.match(dispatchFn, /from vault\.decrypted_secrets/)
  assert.match(dispatchFn, /name = 'admin_backup_github_token'/)
  const insertLog = dispatchFn.slice(dispatchFn.indexOf('insert into public.admin_backup_dispatches'))
  assert.doesNotMatch(insertLog, /v_token/)
  assert.doesNotMatch(dispatchFn, /raise notice[^;]*v_token/)
})

test('it only calls GitHub when work is waiting, and backs off', () => {
  assert.match(dispatchFn, /return 'idle'/)
  assert.match(dispatchFn, /return 'busy'/)
  assert.match(dispatchFn, /interval '10 minutes'/)
  assert.match(dispatchFn, /interval '1 hour'/)
})

test('it runs every minute when pg_cron exists and says what to do when it does not', () => {
  assert.match(sql, /pg_extension where extname = 'pg_cron'/)
  assert.match(sql, /'\* \* \* \* \*'/)
  assert.match(sql, /raise notice 'pg_cron is not enabled/)
})

test('a refused dispatch reaches the admins through the existing alert', () => {
  assert.match(sql, /join net\._http_response r on r\.id = d\.request_id/)
  assert.match(sql, /GitHub refused the request to start the backup runner/)
})

test('the workflow can be started by the API and keeps only an hourly safety net', () => {
  assert.match(wf, /workflow_dispatch:/)
  assert.match(wf, /cron: "7 \* \* \* \*"/)
  assert.doesNotMatch(wf, /7,22,37,52/)
  assert.match(wf, /ADMIN_BACKUP_WRITER_ENABLED == 'true'/)
  assert.match(wf, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/)
})

test('upload diagnostics are an explicit, off-by-default workflow input', () => {
  assert.match(wf, /debug_upload:/)
  assert.match(wf, /default: false/)
  assert.match(wf, /BACKUP_RCLONE_DEBUG: \$\{\{ inputs\.debug_upload && '1' \|\| '0' \}\}/)
})

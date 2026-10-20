import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migrationPath = new URL('../supabase/migrations/20261020240000_department_trophy_achievements.sql', import.meta.url)
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''
const normalized = sql.toLowerCase().replace(/\s+/g, ' ')

function has(pattern, message) {
  assert.match(sql, pattern, message)
}

test('defines durable department achievement storage and seen state', () => {
  has(/create table if not exists public\.department_achievements/i, 'department_achievements table missing')
  has(/create table if not exists public\.department_achievement_seen/i, 'department_achievement_seen table missing')
  has(/tier text not null default 'gold'/i, 'gold tier default missing')
  has(/source_milestone_id uuid/i, 'source milestone identity missing')
  has(/primary key\s*\(achievement_id,\s*user_id\)/i, 'per-user seen primary key missing')
})

test('enforces department-scoped RLS with active-user and admin access', () => {
  has(/alter table public\.department_achievements enable row level security/i, 'achievement RLS missing')
  has(/alter table public\.department_achievement_seen enable row level security/i, 'seen RLS missing')
  has(/public\.is_active_employee\(\)/i, 'active employee guard missing')
  has(/public\.is_workspace_admin\(\)/i, 'workspace admin guard missing')
  has(/lower\s*\(\s*trim\s*\(.*department/i, 'department normalisation missing')
  has(/auth\.uid\(\)/i, 'signed-in user boundary missing')
})

test('defines authorised achievement RPCs and bounds unseen ceremony rows', () => {
  has(/function public\.unseen_department_achievements\(\)/i, 'unseen RPC missing')
  has(/limit\s+5/i, 'unseen RPC must be bounded to five')
  has(/interval\s+'3 days'/i, 'unseen RPC must be recent-only')
  has(/function public\.mark_department_achievements_seen\(p_ids uuid\[\]\)/i, 'mark seen RPC missing')
  has(/on conflict do nothing/i, 'seen writes must be idempotent')
  has(/function public\.department_achievement_history\(p_department text\)/i, 'history RPC missing')
  assert.ok(!/department_achievement_history[\s\S]{0,1500}interval\s+'3 days'/i.test(sql), 'history must not be recency-limited')
})

test('prevents duplicate achievement materialisation identities', () => {
  has(/create unique index[\s\S]*project_complete[\s\S]*project_id/i, 'project-complete dedupe index missing')
  has(/create unique index[\s\S]*source_milestone_id/i, 'source-event dedupe index missing')
})

test('mark seen authorises the achievement before writing', () => {
  const markStart = normalized.indexOf('function public.mark_department_achievements_seen')
  assert.ok(markStart >= 0, 'mark seen RPC missing')
  const fragment = normalized.slice(markStart, markStart + 3000)
  assert.match(fragment, /department_achievements/, 'mark seen must join achievements')
  assert.match(fragment, /can_view_department_achievement|is_workspace_admin|employee_profiles/, 'mark seen must check caller authorization')
})

test('materialises overdue-clear and project-complete achievements by department', () => {
  has(/function public\.materialize_department_achievement\(p_milestone_id uuid\)/i, 'materialisation function missing')
  has(/m\.kind\s*=\s*'dept_overdue_clear'/i, 'overdue-clear path missing')
  has(/m\.kind\s*=\s*'project_complete'/i, 'project-complete path missing')
  has(/collaboration_space_members/i, 'active member departments must participate')
  has(/collaboration_space_departments/i, 'explicit cross-department mappings must participate')
  has(/home_department/i, 'project home department must participate when valid')
  has(/ep\.active\s*=\s*true/i, 'inactive project members must not create trophies')
  has(/lower\s*\(\s*trim/i, 'department labels must be normalized')
  has(/unassigned/i, 'Unassigned departments must be explicitly ignored')
})

test('materialisation is event-triggered, backfilled safely, and conflict-safe', () => {
  has(/after insert on public\.team_milestones/i, 'team milestone INSERT trigger missing')
  has(/execute function public\.[a-z_]*department_achievement/i, 'achievement trigger function missing')
  has(/created_at\s*>\s*now\(\)\s*-\s*interval\s+'7 days'/i, 'backfill must be recent-only')
  has(/on conflict do nothing/i, 'repeated trigger delivery must be idempotent')
  assert.ok(!/coalesce\([^)]*department[^)]*,\s*'company'/i.test(sql), 'must not create a global fallback department')
})

test('legacy milestone reads are admin-only and deprecated ceremony RPCs are revoked', () => {
  has(/drop policy if exists "milestones read active" on public\.team_milestones/i, 'broad milestone read policy must be removed')
  has(/create policy "milestones read admin"[\s\S]*is_workspace_admin\(\)/i, 'legacy direct milestone reads must be admin-only')
  has(/revoke execute on function public\.unseen_team_milestones\(\) from authenticated/i, 'deprecated unseen milestone RPC must be revoked')
  has(/revoke execute on function public\.mark_team_milestones_seen\(uuid\[\]\) from authenticated/i, 'deprecated seen milestone RPC must be revoked')
})

test('department achievements are registered with Supabase Realtime', () => {
  has(/pg_publication[\s\S]*supabase_realtime/i, 'realtime publication guard missing')
  has(/alter publication supabase_realtime add table public\.department_achievements/i, 'department achievements must be published for INSERT signals')
})

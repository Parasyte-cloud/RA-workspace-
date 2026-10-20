import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const migrationUrl = new URL('../supabase/migrations/20261020270000_support_invite_abuse_controls.sql', import.meta.url)
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : ''

function mustHaveMigration() {
  assert.ok(migration.length > 0, '20261020270000_support_invite_abuse_controls.sql must exist')
}

test('invite abuse state is durable and inaccessible to browser roles', () => {
  mustHaveMigration()
  assert.match(migration, /create table if not exists public\.support_invitation_security/i)
  assert.match(migration, /invitation_id\s+uuid\s+primary key\s+references public\.support_invites\(id\)\s+on delete cascade/i)
  assert.match(migration, /failed_attempts_window\s+integer\s+not null\s+default\s+0/i)
  assert.match(migration, /cooldown_until\s+timestamptz/i)
  assert.match(migration, /held_at\s+timestamptz/i)
  assert.match(migration, /revoke all on table public\.support_invitation_security from public, anon, authenticated/i)
})

test('invite check locks invitation and security rows before applying rolling thresholds', () => {
  mustHaveMigration()
  assert.match(migration, /create or replace function public\.support_invite_check\(p_email text, p_code text\)/i)
  assert.match(migration, /from public\.support_invites[^;]+for update/is)
  assert.match(migration, /from public\.support_invitation_security[^;]+for update/is)
  assert.match(migration, /window_started_at[^;]+interval '24 hours'/is)
  assert.match(migration, /failed_attempts_window\s*=\s*0/is)
  assert.match(migration, /v_failures\s+in\s*\(5,\s*10,\s*15\)/i)
  assert.match(migration, /interval '15 minutes'/i)
  assert.match(migration, /v_failures\s*>=\s*20/i)
  assert.match(migration, /when v_failures >= 20 then coalesce\(held_at, now\(\)\)/i)
})

test('blocked invites fail before code verification and do not increment while blocked', () => {
  mustHaveMigration()
  const held = migration.indexOf("reason', 'held")
  const cooldown = migration.indexOf("reason', 'cooldown")
  const hash = migration.indexOf('support_invite_hash(v_row.code_salt, p_code)')
  assert.ok(held > -1 && cooldown > -1 && hash > -1, 'held, cooldown and hash paths must exist')
  assert.ok(held < hash, 'hold check must happen before code verification')
  assert.ok(cooldown < hash, 'cooldown check must happen before code verification')
  assert.doesNotMatch(migration, /status\s*=\s*case\s+when[^;]+['"]locked['"]/is)
})

test('successful completion and admin reissue clear abuse state', () => {
  mustHaveMigration()
  assert.match(migration, /create or replace function public\.support_invite_complete\(p_invite uuid, p_user uuid\)/i)
  assert.match(migration, /delete from public\.support_invitation_security\s+where invitation_id = p_invite/i)
  assert.match(migration, /create or replace function public\.support_invite_reissue\(p_actor uuid, p_invite uuid, p_code text\)/i)
  assert.match(migration, /staff_invite_hold_cleared/i)
  assert.match(migration, /delete from public\.support_invitation_security\s+where invitation_id = p_invite/i)
})

test('admin invite list exposes safe cooldown and hold metadata but no secrets', () => {
  mustHaveMigration()
  assert.match(migration, /create (?:or replace )?function public\.support_invites_list\(\)/i)
  assert.match(migration, /security_state/i)
  assert.match(migration, /cooldown_until/i)
  assert.match(migration, /held_at/i)
  assert.doesNotMatch(migration, /returns table \([^)]*code_hash/is)
  assert.doesNotMatch(migration, /returns table \([^)]*code_salt/is)
})

test('replacement RPCs remain service-role only', () => {
  mustHaveMigration()
  for (const signature of [
    'support_invite_check(text,text)',
    'support_invite_reissue(uuid,uuid,text)',
    'support_invite_complete(uuid,uuid)',
  ]) {
    const escaped = signature.replace(/[()]/g, '\\$&')
    assert.match(migration, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${escaped} to service_role`, 'i'))
  }
})

const edgeSource = readFileSync(new URL('../supabase/functions/support-invite/index.ts', import.meta.url), 'utf8')

function redeemBody() {
  const start = edgeSource.indexOf("if (action === 'redeem')")
  const end = edgeSource.indexOf('// ------------------------------------------------------------- admin actions', start)
  assert.ok(start > -1 && end > start, 'redeem block must exist')
  return edgeSource.slice(start, end)
}

test('redeem validates the invite before asking for or validating a password', () => {
  const body = redeemBody()
  const check = body.indexOf("admin.rpc('support_invite_check'")
  const password = body.indexOf('validateJoinPassword(')
  assert.ok(check > -1, 'invite check must exist')
  assert.ok(password > check, 'password validation must happen only after invite validation')
})

test('valid existing accounts complete immediately without changing their password', () => {
  const body = redeemBody()
  assert.match(body, /if \(existing\?\.id\)/)
  assert.match(body, /support_invite_complete/)
  assert.match(body, /existingAccount:\s*true/)
  const existingStart = body.indexOf('if (existing?.id)')
  const existingEnd = body.indexOf('if (!body?.password)', existingStart)
  const existingBlock = body.slice(existingStart, existingEnd)
  assert.doesNotMatch(existingBlock, /updateUserById|password\s*:/)
})

test('valid new-account invite can request password setup without creating a user', () => {
  const body = redeemBody()
  assert.match(body, /if \(!body\?\.password\)/)
  assert.match(body, /needsPassword:\s*true/)
  const needsPassword = body.indexOf('needsPassword: true')
  const createUser = body.indexOf('admin.auth.admin.createUser')
  assert.ok(needsPassword > -1 && createUser > needsPassword, 'password setup response must happen before user creation')
})

test('new account creation retains the 10-character password validation before createUser', () => {
  const body = redeemBody()
  const validate = body.indexOf('validateJoinPassword(')
  const create = body.indexOf('admin.auth.admin.createUser')
  assert.ok(validate > -1 && create > validate)
  assert.match(body, /password:\s*String\(body\.password\)/)
})

test('all invite-check failures use one generic public error and local throttling is only a brake', () => {
  const body = redeemBody()
  assert.match(body, /if \(!chk\?\.ok\)[\s\S]*GENERIC_FAIL/)
  assert.doesNotMatch(body, /chk\?\.reason|chk\.reason/)
  assert.match(edgeSource, /Best-effort per-instance IP brake/)
  assert.doesNotMatch(edgeSource, /real limit is the 5-guess lockout/i)
})

const supportClientSource = readFileSync(new URL('../src/lib/supportCommandCentre.ts', import.meta.url), 'utf8')
const supportInvitesSource = readFileSync(new URL('../src/modules/SupportInvites.tsx', import.meta.url), 'utf8')

test('StaffInvite models safe cooldown and hold metadata', () => {
  const start = supportClientSource.indexOf('export type StaffInvite = {')
  const end = supportClientSource.indexOf('export type InviteOutcome', start)
  assert.ok(start > -1 && end > start)
  const block = supportClientSource.slice(start, end)
  assert.match(block, /security_state:\s*'normal' \| 'cooldown' \| 'held'/)
  assert.match(block, /cooldown_until:\s*string \| null/)
  assert.match(block, /held_at:\s*string \| null/)
  assert.match(block, /failed_attempts_window:\s*number/)
  assert.doesNotMatch(block, /code_hash|code_salt/)
})

test('Support Administration renders cooldown and security hold states with recovery action', () => {
  assert.match(supportInvitesSource, /security_state === 'held'/)
  assert.match(supportInvitesSource, /Security hold/i)
  assert.match(supportInvitesSource, /security_state === 'cooldown'/)
  assert.match(supportInvitesSource, /Cooling down/i)
  assert.match(supportInvitesSource, /Reissue/)
  assert.match(supportInvitesSource, /status === 'locked'/)
})

test('Support invite admin copy no longer promises every invitee creates a password', () => {
  assert.doesNotMatch(supportInvitesSource, /open the join page, pick a password/i)
  assert.match(supportInvitesSource, /existing account/i)
})

test('existing-account email lookup escapes SQL wildcard characters with a literal backslash', () => {
  const body = redeemBody()
  assert.match(body, /email\.replace\(\/\[\\\\%_\]\/g, \(c\) => '\\\\' \+ c\)/)
})

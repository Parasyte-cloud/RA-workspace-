import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/recognition.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const R = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('the Lagos week starts on Monday at 00:00 Lagos time', () => {
  // Wednesday 14 Oct 2026, 15:00 UTC
  const start = R.lagosWeekStart(new Date('2026-10-14T15:00:00Z'))
  assert.equal(start.toISOString(), '2026-10-11T23:00:00.000Z') // Monday 12 Oct 00:00 in Lagos
  // Sunday 23:30 Lagos is still the old week
  assert.equal(R.lagosWeekStart(new Date('2026-10-18T22:30:00Z')).toISOString(), '2026-10-11T23:00:00.000Z')
  // Monday 00:10 Lagos is the new week
  assert.equal(R.lagosWeekStart(new Date('2026-10-18T23:10:00Z')).toISOString(), '2026-10-18T23:00:00.000Z')
})

test('flames start at three on-time completions', () => {
  assert.equal(R.flameTier(2), null)
  assert.equal(R.flameTier(3), 'spark')
  assert.equal(R.flameTier(5), 'blaze')
  assert.equal(R.flameTier(12), 'inferno')
})

test('week labels read naturally', () => {
  assert.equal(R.weekLabel('2026-10-05'), '5 to 11 Oct')
  assert.equal(R.weekLabel('2026-09-28'), '28 Sep to 4 Oct')
})

test('ribbon counts and scores match the database', () => {
  assert.equal(R.ribbonCountLine(1, 0), '1 ribbon')
  assert.equal(R.ribbonCountLine(3, 2), '3 ribbons, 2 golden')
  assert.equal(R.ribbonScore(['golden', 'star', 'fire']), 11)
})

const sql = readFileSync(`supabase/migrations/${readdirSync('supabase/migrations').find(f => f.endsWith('_ribbon_recognition.sql'))}`, 'utf8')

test('database: automatic champion, budget, streak, thanks, milestones, digest', () => {
  for (const fn of ['crown_ribbon_champion', 'current_ribbon_champion', 'assert_golden_budget', 'work_streak', 'thank_ribbon',
    'work_item_milestones', 'send_ribbon_digest', 'give_direct_ribbon', 'give_room_buzzer']) {
    assert.ok(sql.includes(`function public.${fn}`), fn)
  }
  assert.match(sql, /champion headshot readable by staff/)
  assert.match(sql, /cron\.schedule\('ridearrivo-ribbon-champion'/)
  assert.match(sql, /cron\.schedule\('ridearrivo-ribbon-digest'/)
  assert.match(sql, /golden_monthly_limit/)
})

test('the digest email and the champion frame are wired', () => {
  assert.match(readFileSync('supabase/functions/notifications-email-dispatch/index.ts', 'utf8'), /ribbonDigestEmail\(/)
  assert.match(readFileSync('src/components/HeaderAvatar.tsx', 'utf8'), /champFramed/)
  assert.match(readFileSync('src/modules/PersonalDashboard.tsx', 'utf8'), /<HallOfFameCard\/>/)
  assert.match(readFileSync('src/modules/ProfileModule.tsx', 'utf8'), /<RibbonWall/)
  assert.match(readFileSync('src/InternalApp.tsx', 'utf8'), /<RecognitionHost\/>/)
})

test('chat and ROOM 7 can give ribbons, and guests never import the database client', () => {
  assert.match(readFileSync('src/chat/ChatShell.tsx', 'utf8'), /give_direct_ribbon/)
  assert.match(readFileSync('src/modules/RoomMeeting.tsx', 'utf8'), /give_room_buzzer/)
  const shared = readFileSync('src/room7-shared/useRoom7MeetingExtras.tsx', 'utf8')
  assert.doesNotMatch(shared, /lib\/supabase/)
  assert.match(shared, /MSG_BUZZ/)
})

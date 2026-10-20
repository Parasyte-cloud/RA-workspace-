import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012160000_birthday_celebrations.sql', 'utf8')
const fn = readFileSync('supabase/functions/notifications-email-dispatch/index.ts', 'utf8')
const ui = readFileSync('src/modules/BirthdayCelebration.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const css = readFileSync('src/birthday.css', 'utf8')

test('greetings run daily at 06:00 Lagos and cannot be called from the app', () => {
  assert.match(sql, /'0 5 \* \* \*'/)
  assert.match(sql, /revoke all on function public\.send_birthday_greetings\(\) from public, anon, authenticated/)
})

test('only the birthday person gets email; everyone else gets a quiet bell', () => {
  assert.match(sql, /'birthday', 'Happy Birthday, '[\s\S]*'pending'/)
  assert.match(sql, /'birthday_today'[\s\S]*'skipped'/)
})

test('one greeting per person per year, and wishes are one per sender', () => {
  assert.match(sql, /primary key \(employee_id, year\)/)
  assert.match(sql, /unique \(to_id, from_id, year\)/)
})

test('wishes and the log are closed to direct access; the year and age are never returned', () => {
  assert.match(sql, /revoke all on public\.birthday_wishes from anon, authenticated/)
  const fnSql = sql.slice(sql.indexOf('create or replace function public.get_birthdays_today'), sql.indexOf('-- 4. Send a wish'))
  assert.doesNotMatch(fnSql, /returns table\([^)]*(date_of_birth|age)/)
  assert.doesNotMatch(fnSql, /age\(/)
})

test('the email dispatcher renders a designed card for birthdays and escapes names', () => {
  assert.match(fn, /row\.type === "birthday"/)
  assert.match(fn, /function birthdayEmail/)
  assert.match(fn, /escapeHtml\(fullName/)
  assert.match(fn, /RIBBON = \["#ff9900"/)
})

test('the celebration shows once a day, respects reduced motion and mounts in the shell', () => {
  assert.match(ui, /ra\.bday\.seen\./)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.match(app, /<BirthdayCelebration\/>/)
  assert.doesNotMatch(css + ui, /—/)
})

test('signed-in birthday takeover uses the shared premium birthday stage and keeps wishes', () => {
  assert.match(ui, /PremiumCelebrationStage/)
  assert.match(ui, /intensity="birthday"/)
  assert.match(ui, /introMs=\{1700\}/)
  assert.match(ui, /holdMs=\{8000\}/)
  assert.doesNotMatch(ui, /function Confetti\s*\(/)
  assert.match(ui, /get_my_birthday_wishes/)
  assert.match(ui, /send_birthday_wish/)
  assert.match(ui, /bdWishes/)
  assert.match(ui, /hiddenKey/)
})

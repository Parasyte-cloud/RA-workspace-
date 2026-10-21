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

test('birthday colleague surface stays mounted while automatic takeover is durable and central', () => {
  assert.doesNotMatch(ui, /ra\.bday\.seen\./)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.match(app, /<BirthdayCelebration\/>/)
  assert.doesNotMatch(css + ui, /—/)
})

test('birthday module preserves coworker wishes while central host owns the takeover', () => {
  assert.doesNotMatch(ui, /PremiumCelebrationStage/)
  assert.match(ui, /send_birthday_wish/)
  assert.match(ui, /get_birthdays_today/)
  assert.match(ui, /hiddenKey/)
})

import fs from 'node:fs'

test('enhanced birthday takeover is central durable and preserves coworker wishes',()=>{ const host=fs.readFileSync('src/components/RecognitionCeremonyHost.tsx','utf8'); const scene=fs.readFileSync('src/components/celebrations/BirthdayCelebrationScene.tsx','utf8'); const module=fs.readFileSync('src/modules/BirthdayCelebration.tsx','utf8'); assert.match(host,/sourceKind === 'birthday'/); assert.match(scene,/holdMs=\{9000\}/); assert.match(scene,/fullCount=\{136\}/); assert.doesNotMatch(module,/ra\.bday\.seen/); assert.match(module,/send_birthday_wish/); assert.match(module,/get_birthdays_today/); })

test('static Birthday profile uses the shared static fallback rather than animated balloons',()=>{
  const scene=fs.readFileSync('src/components/celebrations/BirthdayCelebrationScene.tsx','utf8')
  assert.match(scene,/SeasonalStaticFallback/)
  assert.match(scene,/profile\s*===\s*['"]static['"]/)
})

test('explicit reduced Birthday preview suppresses balloons even without an OS reduced-motion setting',()=>{
  const scene=fs.readFileSync('src/components/celebrations/BirthdayCelebrationScene.tsx','utf8')
  const birthdayCss=fs.readFileSync('src/birthday.css','utf8')
  assert.match(scene,/birthdayEnhancedScene[^\n]*isReduced/)
  assert.match(birthdayCss,/isReduced[^}]*birthdayCornerBalloons|birthdayEnhancedScene\.isReduced[^{]*\{[^}]*animation:none|birthdayEnhancedScene\.isReduced[^\n]*birthdayCornerBalloons/)
})

test('birthday employee can manually replay the production scene without claiming another delivery',()=>{
  const module=fs.readFileSync('src/modules/BirthdayCelebration.tsx','utf8')
  assert.match(module,/lazy\(\(\)\s*=>\s*import\(['"]\.\.\/components\/celebrations\/BirthdayCelebrationScene['"]\)\)/)
  assert.match(module,/Replay celebration/)
  assert.match(module,/sourceKind:\s*['"]birthday['"]/)
  assert.doesNotMatch(module,/claim_next_recognition_ceremony|mark_recognition_ceremony_presented|dismiss_recognition_ceremony/)
})

import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/20261020340000_recognition_birthday_delivery.sql','utf8')
test('birthday delivery uses one cross-device source key per employee year',()=>{assert.match(sql,/birthday:/); assert.match(sql,/employee_id/); assert.match(sql,/year/); assert.match(sql,/on conflict do nothing/i); assert.match(sql,/ensure_my_birthday_delivery\s*\(\s*\)/i)})
test('birthday DTO never includes age birth year or date of birth',()=>{assert.doesNotMatch(sql,/date_of_birth[^\n]*presentation|presentation[^\n]*date_of_birth/i); assert.doesNotMatch(sql,/['"](?:age|birth_year|date_of_birth)['"]\s*,/i)})
test('claim path ensures birthday and seasonal deliveries before selecting queue',()=>{assert.match(sql,/claim_next_recognition_ceremony[\s\S]*ensure_my_due_seasonal_deliveries[\s\S]*ensure_my_birthday_delivery/i)})

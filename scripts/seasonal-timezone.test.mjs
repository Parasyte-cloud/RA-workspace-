import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const admin = fs.readFileSync('src/modules/RecognitionCelebrationsAdmin.tsx', 'utf8')
const helper = fs.existsSync('src/lib/zonedDateTime.ts') ? fs.readFileSync('src/lib/zonedDateTime.ts', 'utf8') : ''

test('seasonal scheduler converts selected IANA wall time to UTC instead of browser-local time', () => {
  assert.match(admin, /zonedDateTimeToUtc/)
  assert.match(admin, /campaignTimezone/)
  assert.doesNotMatch(admin, /function\s+isoLocal[\s\S]*new Date\(value\)/)
  assert.match(helper, /Intl\.DateTimeFormat/)
  assert.match(helper, /timeZone/)
  assert.match(helper, /Date\.UTC/)
})

test('seasonal editor formats persisted UTC timestamps back into the selected campaign timezone', () => {
  assert.match(admin, /formatDateTimeInZone/)
  assert.match(admin, /row\.timezone/)
  assert.match(helper, /formatToParts/)
})

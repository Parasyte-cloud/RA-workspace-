import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const path='supabase/functions/recognition-seasonal-dispatch/index.ts'

test('seasonal dispatch is cron-secret only and body cannot select campaigns',()=>{
  assert.ok(fs.existsSync(path))
  const s=fs.readFileSync(path,'utf8')
  assert.match(s,/CRON_DISPATCH_SECRET/)
  assert.match(s,/timingSafeEqual|constantTime/i)
  assert.doesNotMatch(s,/req\.json\(|campaign_id/i)
  assert.match(s,/materialize_due_recognition_seasonal_campaigns/)
})

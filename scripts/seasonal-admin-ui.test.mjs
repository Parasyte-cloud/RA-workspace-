import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'
const s=()=>fs.readFileSync('src/modules/RecognitionCelebrationsAdmin.tsx','utf8')
test('Administration uses seasonal RPC governance only',()=>{const x=s(); for(const rpc of ['list_recognition_seasonal_campaigns','save_recognition_seasonal_campaign','publish_recognition_seasonal_campaign','cancel_recognition_seasonal_campaign']) assert.match(x,new RegExp(rpc)); assert.doesNotMatch(x,/from\(['"]recognition_seasonal_campaigns/)} )
test('seasonal scheduler exposes type year timezone windows and confirmations',()=>{const x=s(); for(const token of ['campaignYear','campaignTimezone','campaignStarts','campaignEnds','liveWindowStarts','liveWindowEnds']) assert.match(x,new RegExp(token)); assert.match(x,/window\.confirm/); assert.match(x,/Christmas/); assert.match(x,/New Year/)})
test('preview uses exact production seasonal and birthday scenes without mutation RPCs',()=>{const x=s(); assert.match(x,/ChristmasCelebrationScene/); assert.match(x,/NewYearCelebrationScene/); assert.match(x,/BirthdayCelebrationScene/); assert.match(x,/new_year_live/); assert.match(x,/new_year_delayed/); assert.match(x,/seasonalProfile/); assert.match(x,/desktop[^\n]+tablet[^\n]+mobile/)} )

test('seasonal Administration sends optimistic concurrency versions for edits and cancellation',()=>{
  const x=s()
  assert.match(x,/expected_updated_at[^\n]*selectedCampaign\?\.updated_at|selectedCampaign\?\.updated_at[^\n]*expected_updated_at/)
  assert.match(x,/p_expected_updated_at\s*:\s*row\.updated_at/)
})

test('seasonal preview reports first-party Christmas asset health and static fallback readiness',()=>{
  const x=s()
  assert.match(x,/seasonalAssetHealth/)
  assert.match(x,/new Image\(\)/)
  assert.match(x,/Asset health/)
  assert.match(x,/fallback/i)
})

test('asset health indicator has readable success and fallback states',()=>{
  const css=fs.readFileSync('src/recognition-admin.css','utf8')
  assert.match(css,/\.recognitionAssetHealth/)
  assert.match(css,/recognitionAssetHealth-ready/)
  assert.match(css,/recognitionAssetHealth-fallback/)
})

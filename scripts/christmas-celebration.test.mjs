import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'
const read=p=>fs.readFileSync(p,'utf8')
test('Christmas uses seasonal max with approved timing and deterministic ranges',()=>{const s=read('src/components/celebrations/ChristmasCelebrationScene.tsx'); assert.match(s,/seasonal_max/); assert.match(s,/holdMs=\{12000\}/); assert.match(s,/fullCount=\{200\}/); assert.match(s,/balancedCount=\{128\}/); assert.match(s,/sleigh|Santa/i); assert.match(s,/gift/i); assert.match(s,/snow/i); assert.match(s,/ribbon/i)})
test('Christmas reduced and static profiles preserve semantic copy',()=>{const s=read('src/components/celebrations/ChristmasCelebrationScene.tsx'); assert.match(s,/profile === 'reduced'|profile==='reduced'/); assert.match(s,/profile === 'static'|profile==='static'/); assert.match(s,/presentation\.title/); assert.match(s,/presentation\.message/)})

test('Christmas sleigh downgrades to the first-party static asset if an animated profile asset fails',()=>{
  const s=read('src/components/celebrations/ChristmasCelebrationScene.tsx')
  assert.match(s,/onError/)
  assert.match(s,/seasonalAssets\.christmas\.static/)
  assert.doesNotMatch(s,/https?:\/\//)
})

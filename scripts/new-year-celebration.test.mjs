import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'
const s=()=>fs.readFileSync('src/components/celebrations/NewYearCelebrationScene.tsx','utf8')
test('New Year uses seasonal max 11 second stage and approved element ranges',()=>{const x=s(); assert.match(x,/seasonal_max/); assert.match(x,/holdMs=\{11000\}/); assert.match(x,/fullCount=\{200\}/); assert.match(x,/balancedCount=\{128\}/)})
test('live countdown is server variant only and delayed login has welcome copy',()=>{const x=s(); assert.match(x,/presentation\.variant === 'live_midnight'/); assert.match(x,/3\s*[·•]\s*2\s*[·•]\s*1/); assert.match(x,/Welcome to/); assert.doesNotMatch(x,/new Date\(|Date\.now\(/)})
test('reduced mode suppresses fireworks motion',()=>{const x=s(); assert.match(x,/profile === 'reduced'|profile==='reduced'/); assert.match(x,/firework/i)})

test('static delayed New Year preserves the server-selected Welcome to year title',()=>{
  const x=s()
  assert.match(x,/profile === 'static'[\s\S]*title/)
  assert.match(x,/Welcome to \$\{year\}/)
})

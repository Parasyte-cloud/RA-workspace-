import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=p=>fs.readFileSync(p,'utf8')

test('seasonal motion profile is device aware and reduced motion never upgrades',()=>{
  const s=read('src/components/celebrations/useCelebrationMotionProfile.ts')
  assert.match(s,/prefers-reduced-motion/)
  assert.match(s,/saveData/)
  assert.match(s,/deviceMemory/)
  assert.match(s,/full[^\n]+balanced[^\n]+reduced[^\n]+static|CelebrationMotionProfile/)
})

test('seasonal scenes are lazy loaded and normal entry has no eager scene import',()=>{
  const h=read('src/components/RecognitionCeremonyHost.tsx')
  assert.match(h,/lazy\(\(\) => import\(['"]\.\/celebrations\/ChristmasCelebrationScene/)
  assert.match(h,/lazy\(\(\) => import\(['"]\.\/celebrations\/NewYearCelebrationScene/)
  assert.match(h,/lazy\(\(\) => import\(['"]\.\/celebrations\/BirthdayCelebrationScene/)
  assert.doesNotMatch(h,/import ChristmasCelebrationScene from|import NewYearCelebrationScene from|import BirthdayCelebrationScene from/)
})

test('seasonal particles are deterministic and static fallback is semantic',()=>{
  const p=read('src/components/celebrations/SeasonalParticleField.tsx')
  const f=read('src/components/celebrations/SeasonalStaticFallback.tsx')
  assert.doesNotMatch(p,/Math\.random/)
  assert.match(p,/Array\.from/)
  assert.match(f,/role="status"|aria-live/)
})

test('seasonal presentation types include campaign and birthday metadata',()=>{
  const s=read('src/celebrations/types.ts')
  for(const v of ['seasonal_campaign','birthday','campaignType','campaignYear','variant']) assert.match(s,new RegExp(v))
})

test('static fallback disables the shared ribbon and glow motion instead of only hiding seasonal particles',()=>{
  const fallback=read('src/components/celebrations/SeasonalStaticFallback.tsx')
  const stage=read('src/components/PremiumCelebrationStage.tsx')
  assert.match(fallback,/staticVisuals/)
  assert.match(stage,/staticVisuals/)
  assert.match(stage,/!staticVisuals[^\n]*premiumCelebrationGlow|staticVisuals[\s\S]*premiumCelebrationGlow/)
  assert.match(stage,/!staticVisuals[^\n]*premiumCelebrationRibbons|staticVisuals[\s\S]*premiumCelebrationRibbons/)
})

test('explicit reduced profiles suppress shared-stage motion even when previewing on a normal-motion device',()=>{
  for(const file of ['ChristmasCelebrationScene.tsx','NewYearCelebrationScene.tsx','BirthdayCelebrationScene.tsx']){
    const scene=read(`src/components/celebrations/${file}`)
    assert.match(scene,/staticVisuals=\{(?:reduced|profile\s*===\s*['"]reduced['"])\}/,file)
  }
})

test('Administration recognition console is lazy so seasonal preview scenes stay out of normal workspace startup',()=>{
  const admin=read('src/modules/AdministrationControlPlane.tsx')
  assert.match(admin,/lazy\(\(\)\s*=>\s*import\(['"]\.\/RecognitionCelebrationsAdmin['"]\)\)/)
  assert.doesNotMatch(admin,/import RecognitionCelebrationsAdmin from/)
  assert.match(admin,/Suspense/)
})

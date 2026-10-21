import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'
const paths=['public/celebrations/christmas/santa-sleigh-full.b04b44ff40.webp','public/celebrations/christmas/santa-sleigh-balanced.5bff5fc781.webp','public/celebrations/christmas/santa-sleigh-static.fc7a71e638.webp']
test('Christmas assets exist and remain inside approved budgets',()=>{for(const p of paths) assert.ok(fs.existsSync(p),p); assert.ok(fs.statSync(paths[0]).size<=3_000_000); assert.ok(fs.statSync(paths[1]).size<=1_500_000); assert.ok(fs.statSync(paths[2]).size<=250_000)})
test('asset manifest is first party and contains no runtime remote url',()=>{const s=fs.readFileSync('public/celebrations/christmas/asset-manifest.json','utf8'); assert.doesNotMatch(s,/https?:\/\//i); assert.match(s,/santa-sleigh-full\.[a-f0-9]{10}\.webp/); assert.match(s,/image\/webp/)})

test('runtime Christmas asset paths are content-fingerprinted for safe cache busting',()=>{
  const runtime=fs.readFileSync('src/celebrations/seasonalAssets.ts','utf8')
  const manifest=JSON.parse(fs.readFileSync('public/celebrations/christmas/asset-manifest.json','utf8'))
  assert.match(runtime,/santa-sleigh-full\.[a-f0-9]{10}\.webp/)
  assert.match(runtime,/santa-sleigh-balanced\.[a-f0-9]{10}\.webp/)
  assert.match(runtime,/santa-sleigh-static\.[a-f0-9]{10}\.webp/)
  for(const variant of Object.values(manifest.variants)) assert.match(String(variant),/\.[a-f0-9]{10}\.webp$/)
})

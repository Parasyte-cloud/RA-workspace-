import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const componentPath = new URL('../src/components/PremiumCelebrationStage.tsx', import.meta.url)
const cssPath = new URL('../src/premium-celebration.css', import.meta.url)

function source(pathUrl) {
  return fs.existsSync(pathUrl) ? fs.readFileSync(pathUrl, 'utf8') : ''
}

test('premium stage defines the three supported intensity presets and 108 deterministic pieces', () => {
  const component = source(componentPath)
  assert.match(component, /export type CelebrationIntensity\s*=\s*'major'\s*\|\s*'birthday'\s*\|\s*'trophy'/)
  assert.match(component, /PIECE_COUNT\s*=\s*108/)
  assert.match(component, /Array\.from\(\{\s*length:\s*PIECE_COUNT\s*\}/)
  assert.doesNotMatch(component, /Math\.random\s*\(/)
})

test('premium stage owns intro and hold timing plus Escape and backdrop dismissal', () => {
  const component = source(componentPath)
  assert.match(component, /introMs:\s*number/)
  assert.match(component, /holdMs:\s*number/)
  assert.match(component, /setTimeout\(\(\) => setRevealed\(true\),\s*introMs\)/)
  assert.match(component, /setTimeout\(onClose,\s*holdMs\)/)
  assert.match(component, /event\.key\s*===\s*'Escape'/)
  assert.match(component, /event\.currentTarget\s*===\s*event\.target/)
  assert.match(component, /role="alertdialog"/)
})

test('premium stage provides full reduced-motion content and no audio autoplay path', () => {
  const component = source(componentPath)
  const css = source(cssPath)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(css, /\.premiumCelebrationCard/)
  assert.match(component, /premiumCelebrationCard/)
  assert.doesNotMatch(component, /<audio|Audio\(|\.play\(\)|autoplay|autoPlay/i)
})

test('premium stage accepts domain-specific body content without owning persistence', () => {
  const component = source(componentPath)
  assert.match(component, /children\?:\s*ReactNode/)
  assert.match(component, /\{children\}/)
})

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const css = readFileSync(new URL('../src/visibility-fixes.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/InternalApp.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const prompt = readFileSync(new URL('../src/components/SoundOnPrompt.tsx', import.meta.url), 'utf8')

test('phone tab bar hides behind any open dialog', () => {
  assert.match(css, /body:has\(\[aria-modal='true'\]\) nav\.phoneTabs/)
  assert.match(css, /body:has\(\.downloadAccessOverlay\) nav\.phoneTabs/)
})
test('dialog action row is sticky and safe-area aware', () => {
  assert.match(css, /\.downloadAccessModalActions\s*\{[^}]*position:\s*sticky/)
  assert.match(css, /safe-area|--ra-safe-bottom/)
})
test('dark theme secondary buttons have an explicit readable colour', () => {
  assert.match(css, /data-ra-theme='dark'\] \.downloadAccessModal \.glassButton/)
})
test('visibility css is loaded after the other design layers', () => {
  assert.ok(app.indexOf('visibility-fixes.css') > app.indexOf('glass-clear.css'))
})
test('first-run sound prompt unlocks audio from a tap and is mounted once', () => {
  assert.match(prompt, /primeAudio\(\)/)
  assert.match(prompt, /ra-sound-prompt-v1/)
  assert.equal((shell.match(/<SoundOnPrompt\/>/g) || []).length, 1)
})

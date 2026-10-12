import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/phone-shell.css', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../src/modules/PhoneNav.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('phone shell hides the sidebar and shows a bottom tab bar at 640px', () => {
  assert.match(css, /@media \(max-width: 640px\)/)
  assert.match(css, /\.shell\.glassFrame > \.sidebar\s*\{\s*display: none !important/)
  assert.match(css, /\.phoneTabs\s*\{[^}]*position: fixed/)
  assert.match(css, /safe-area-inset-bottom/)
})

test('phone nav lists every section from the filtered nav and is wired into the app', () => {
  assert.match(nav, /groups\.groups\.map/)
  assert.match(nav, /groups\.system/)
  assert.match(app, /<PhoneNav/)
  assert.match(app, /import PhoneNav from/)
})

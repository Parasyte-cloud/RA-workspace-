import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/phone-shell.css', import.meta.url), 'utf8')
const responsive = readFileSync(new URL('../src/responsive.css', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../src/modules/PhoneNav.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('compact shell hides the sidebar and shows a safe-area bottom tab bar through 599px', () => {
  assert.match(css, /@media \(max-width: 599px\)/)
  assert.match(css, /\.shell\.glassFrame > \.sidebar\s*\{\s*display: none !important/)
  assert.match(css, /\.phoneTabs\s*\{[^}]*position: fixed/s)
  assert.match(css, /var\(--ra-safe-bottom\)/)
  assert.match(css, /overflow-x:\s*clip/)
})

test('tablet widths use the workspace rail instead of the compact phone bar', () => {
  assert.match(responsive, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)/)
  assert.match(responsive, /\.mediumNavToggle/)
  assert.match(responsive, /--ra-nav-medium/)
  assert.match(css, /@media \(min-width: 600px\)/)
  assert.match(css, /\.phoneTabs,\s*\.phoneMoreLayer\s*\{\s*display:\s*none !important/s)
})

test('phone nav keeps four daily destinations and a labelled More sheet', () => {
  assert.match(nav, /const TAB_IDS = \['overview', 'tasks', 'chat', 'mail'\]/)
  assert.match(nav, /aria-controls="phone-more-sheet"/)
  assert.match(nav, /aria-label="More sections"/)
  assert.match(nav, /role="dialog"/)
  assert.match(nav, /aria-label="All sections"/)
  assert.match(app, /<PhoneNav/)
  assert.match(app, /import PhoneNav from/)
})

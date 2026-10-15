import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = path => existsSync(path) ? readFileSync(path, 'utf8') : ''
const styles = read('src/styles.css')
const glass = read('src/liquid-glass.css')
const shell = read('src/workspace-shell.css')
const responsive = read('src/responsive.css')
const phoneCss = read('src/phone-shell.css')
const phoneNav = read('src/modules/PhoneNav.tsx')

const combined = [styles, glass, shell, responsive, phoneCss].join('\n')

test('shared shell defines compact medium and wide layout modes', () => {
  assert.match(styles, /--ra-gutter-compact\s*:/)
  assert.match(styles, /--ra-gutter-medium\s*:/)
  assert.match(styles, /--ra-gutter-wide\s*:/)
  assert.match(responsive, /@media\s*\(max-width:\s*599px\)/)
  assert.match(responsive, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)/)
  assert.match(responsive, /@media\s*\(min-width:\s*1024px\)/)
})

test('full height shell uses dynamic viewport and safe area fallbacks', () => {
  assert.match(combined, /100dvh/)
  assert.match(styles, /--ra-safe-top\s*:\s*env\(safe-area-inset-top/)
  assert.match(styles, /--ra-safe-right\s*:\s*env\(safe-area-inset-right/)
  assert.match(styles, /--ra-safe-bottom\s*:\s*env\(safe-area-inset-bottom/)
  assert.match(styles, /--ra-safe-left\s*:\s*env\(safe-area-inset-left/)
  assert.match(shell + responsive, /min-height:\s*0/)
})

test('phone navigation exposes a More affordance without horizontal scrolling', () => {
  assert.match(phoneNav, /const TAB_IDS = \['overview', 'tasks', 'chat', 'mail'\]/)
  assert.match(phoneNav, /aria-controls="phone-more-sheet"/)
  assert.match(phoneNav, /<span>More<\/span>/)
  assert.match(phoneCss, /\.phoneTabs\s*\{[^}]*overflow-x:\s*clip/s)
  assert.match(phoneCss, /\.phoneMoreSheet\s*\{[^}]*max-width:\s*100%/s)
})

test('glass surfaces have a non backdrop-filter fallback', () => {
  assert.match(glass, /\.glassSurface/)
  assert.match(glass, /\.glassNav/)
  assert.match(glass, /\.glassSheet/)
  assert.match(glass, /\.workSurface/)
  assert.match(glass, /background:\s*var\(--ra-glass-fallback\)/)
  assert.match(glass, /@supports\s*\(\(backdrop-filter:\s*blur/)
})

test('dark appearance keeps new glass sheets and work surfaces readable', () => {
  assert.match(glass, /html\[data-ra-theme=['"]dark['"]\][\s\S]*\.glassSheet/)
  assert.match(glass, /html\[data-ra-theme=['"]dark['"]\][\s\S]*\.workSurface/)
  assert.match(glass, /html\[data-ra-theme=['"]dark['"]\][\s\S]*background:\s*var\(--ra-surface\)/)
  assert.match(glass, /html\[data-ra-theme=['"]dark['"]\][\s\S]*color:\s*var\(--ra-text\)/)
})

test('reduced motion disables non essential transitions', () => {
  assert.match(glass + responsive, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(glass + responsive, /animation-duration:\s*0\.01ms/)
  assert.match(glass + responsive, /transition-duration:\s*0\.01ms/)
})

test('tablet shell uses a labelled expandable navigation rail', () => {
  const app = read('src/App.tsx')
  assert.match(app, /mediumNavExpanded/)
  assert.match(app, /'Collapse navigation'/)
  assert.match(app, /'Expand navigation'/)
  assert.match(app, /className="mediumNavToggle/)
  assert.match(responsive, /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*1023px\)[\s\S]*--ra-nav-medium/)
  assert.match(responsive, /\.shell\.mediumNavExpanded/)
})

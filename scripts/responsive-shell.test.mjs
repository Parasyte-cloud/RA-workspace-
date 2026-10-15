import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = path => existsSync(path) ? readFileSync(path, 'utf8') : ''
const styles = read('src/styles.css')
const glass = read('src/liquid-glass.css')
const shell = read('src/workspace-shell.css')
const responsive = read('src/responsive.css')
const phoneCss = read('src/phone-shell.css')
const combined = [styles, glass, shell, responsive, phoneCss].join('\n')

test('full height shell uses dynamic viewport and safe area fallbacks', () => {
  assert.match(combined, /100dvh/)
  assert.match(styles, /--ra-safe-top\s*:\s*env\(safe-area-inset-top/)
  assert.match(styles, /--ra-safe-right\s*:\s*env\(safe-area-inset-right/)
  assert.match(styles, /--ra-safe-bottom\s*:\s*env\(safe-area-inset-bottom/)
  assert.match(styles, /--ra-safe-left\s*:\s*env\(safe-area-inset-left/)
  assert.match(shell + responsive, /min-height:\s*0/)
})

test('glass surfaces have a non backdrop-filter fallback', () => {
  assert.match(glass, /\.glassSurface/)
  assert.match(glass, /\.glassNav/)
  assert.match(glass, /\.glassSheet/)
  assert.match(glass, /\.workSurface/)
  assert.match(glass, /background:\s*var\(--ra-glass-fallback\)/)
  assert.match(glass, /@supports\s*\(\(backdrop-filter:\s*blur/)
})

test('reduced motion disables non essential transitions', () => {
  assert.match(glass + responsive, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(glass + responsive, /animation-duration:\s*0\.01ms/)
  assert.match(glass + responsive, /transition-duration:\s*0\.01ms/)
})

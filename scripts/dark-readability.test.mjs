import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const css = readFileSync(new URL('../src/dark-readability.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/InternalApp.tsx', import.meta.url), 'utf8')
const lh = readFileSync(new URL('../src/letterhead.css', import.meta.url), 'utf8')

// Imported last among the theme sheets so it wins the cascade.
assert.ok(app.includes("import './dark-readability.css'"), 'dark-readability.css must be imported')
assert.ok(app.indexOf('visibility-fixes.css') < app.indexOf('dark-readability.css'), 'must load after visibility-fixes.css')

// Every rule is dark-mode only, so light mode cannot change.
const blocks = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((b) => b.trim()).filter(Boolean)
for (const b of blocks) assert.ok(b.startsWith("html[data-ra-theme='dark']"), `non dark rule: ${b.slice(0, 60)}`)

// The Letterhead access lists (the reported screen) are covered, with theme colours.
assert.ok(/lhAdminList li/.test(css) && /lhAdminResults li/.test(css) && /lhAdminAdd label/.test(css))
assert.ok(/background:\s*var\(--ra-surface-muted\)/.test(css))
assert.ok(/rgba\(255,255,255,\.55\)/.test(lh), 'light-mode letterhead rule still present')
assert.ok(!/(^|[^-\w])em dash/.test(css) && !css.includes('—'), 'no em dash')
console.log('dark-readability ok')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(
  new URL('../src/appearance.css', import.meta.url),
  'utf8',
)

test('sidebar active state uses a contained subtle orbit instead of a clipped heavy amber frame', () => {
  assert.match(
    css,
    /RA_SIDEBAR_ACTIVE_ORBIT_START/,
    'dedicated sidebar active-state override is missing',
  )

  assert.match(
    css,
    /@property\s+--ra-sidebar-active-angle/,
    'the orbit angle should be explicitly registered',
  )

  assert.match(
    css,
    /conic-gradient\(\s*from\s+var\(--ra-sidebar-active-angle\)/s,
    'the active border should use a contained conic-gradient orbit',
  )

  assert.match(
    css,
    /border:\s*1px\s+solid\s+transparent\s*!important/,
    'the animated border must remain inside the button box',
  )

  assert.match(
    css,
    /animation:\s*raSidebarActiveOrbit\s+6s\s+linear\s+infinite/,
    'the desktop/tablet highlight should rotate slowly',
  )

  assert.match(
    css,
    /@keyframes\s+raSidebarActiveOrbit[\s\S]*--ra-sidebar-active-angle:\s*360deg/,
    'the orbit animation must complete one clean revolution',
  )
})

test('sidebar orbit respects reduced motion and keeps phone navigation restrained', () => {
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*ra-sidebar-active-angle[\s\S]*animation:\s*none\s*!important/s,
    'reduced-motion users must not receive the orbit animation',
  )

  assert.match(
    css,
    /@media\s*\(max-width:\s*599px\)[\s\S]*sidebar nav button\.active[\s\S]*animation:\s*none\s*!important/s,
    'phone navigation should use a static subtle active state',
  )
})

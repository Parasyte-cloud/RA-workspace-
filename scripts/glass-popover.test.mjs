import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const read = p => readFileSync(p, 'utf8')
const js = transformSync(read('src/lib/placePopover.ts'), { loader: 'ts', format: 'esm' }).code
const P = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const view = { width: 1440, height: 900 }

test('the sheet opens under the button with right edges lined up', () => {
  const p = P.placeBelow({ top: 100, bottom: 140, left: 1200, right: 1240 }, view, 300)
  assert.equal(p.width, 300)
  assert.equal(p.left + p.width, 1240)
  assert.ok(p.top > 140)
})

test('the sheet never leaves the screen, even on a narrow phone', () => {
  const p = P.placeBelow({ top: 10, bottom: 50, left: 0, right: 40 }, { width: 360, height: 640 }, 300)
  assert.ok(p.left >= 12)
  assert.ok(p.left + p.width <= 360 - 12)
  const tiny = P.placeBelow({ top: 10, bottom: 50, left: 300, right: 340 }, { width: 320, height: 600 }, 300)
  assert.ok(tiny.left >= 12 && tiny.left + tiny.width <= 320 - 12)
})

test('header menus render in a glass portal above the thread, with a blurred scrim', () => {
  const shell = read('src/chat/ChatShell.tsx')
  assert.match(shell, /<GlassPopover anchor=\{muteBtnRef\.current\}/)
  assert.match(shell, /<GlassPopover anchor=\{exportBtnRef\.current\}/)
  assert.ok(!/className="cmMenu" role="menu"/.test(shell), 'old in-header menus are gone')
  const pop = read('src/chat/ui/GlassPopover.tsx')
  assert.match(pop, /createPortal\(/)
  const css = read('src/chat/ui/glass-popover.css')
  assert.match(css, /\.cmGlassScrim[\s\S]*backdrop-filter: blur\(12px\)/)
  assert.match(css, /\.cmGlassMenu[\s\S]*backdrop-filter: blur\(30px\)/)
  assert.ok(!/—/.test(css + pop))
})

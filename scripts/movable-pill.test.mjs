import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const tsx = readFileSync('src/components/ParasyteCrest.tsx', 'utf8')
const css = readFileSync('src/parasyte-crest.css', 'utf8')

test('the pill is movable on phones: double tap, drag, lock, reset, remembered per device', () => {
  assert.match(tsx, /ra-parasyte-pill-pos/)
  assert.match(tsx, /DOUBLE_TAP_MS/)
  assert.match(tsx, /setPointerCapture/)
  assert.match(tsx, /Double tap to lock/)
  assert.match(tsx, /Reset/)
  // A single tap still reaches parasyte.cloud, after waiting for a possible second tap.
  assert.match(tsx, /window\.open\(PARASYTE_URL/)
  // Desktop keeps the plain link.
  assert.match(tsx, /if \(!isPhone\(\)\) return/)
})

test('a placed pill beats the rules that tie it to the top bar and stays in view', () => {
  assert.match(css, /\.parasyteCrestBar\.parasyteMoved\{/)
  assert.match(css, /left:clamp\(56px,var\(--pp-x\),calc\(100vw - 56px\)\) !important/)
  assert.match(css, /parasyteMoved\{display:flex !important\}/)
  assert.match(css, /parasyteMoving \.parasyteSignature/)
})

test('a damaged saved position is ignored and values are kept inside the screen', () => {
  const m = tsx.slice(tsx.indexOf('export function readPillPos'), tsx.indexOf('function loadPillPos'))
  const js = transformSync(`type PillPos = { x: number; y: number }\n${m.replace('export function', 'function')}\nglobalThis.__fn = readPillPos`, { loader: 'ts' }).code
  new Function(js)()
  const fn = globalThis.__fn
  assert.equal(fn('not json'), null)
  assert.equal(fn(null), null)
  assert.deepEqual(fn('{"x":0.3,"y":0.5}'), { x: 0.3, y: 0.5 })
  assert.deepEqual(fn('{"x":5,"y":-2}'), { x: 1, y: 0 })
})

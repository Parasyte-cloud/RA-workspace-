import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/mailFit.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const M = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('the mail area gets the space between its top and the bottom menu', () => {
  assert.equal(M.mailAreaHeight({ top: 140, scrollY: 0, viewportHeight: 844, bottomReserve: 96 }), 608)
})

test('a scrolled page is measured from the top of the page, not the window', () => {
  assert.equal(M.mailAreaHeight({ top: -40, scrollY: 180, viewportHeight: 844, bottomReserve: 96 }), 608)
})

test('the list never gets squeezed below a usable size', () => {
  assert.equal(M.mailAreaHeight({ top: 600, scrollY: 0, viewportHeight: 700, bottomReserve: 96 }), 320)
})

test('and never taller than the screen', () => {
  assert.equal(M.mailAreaHeight({ top: -500, scrollY: 0, viewportHeight: 700, bottomReserve: 0 }), 700)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('letterhead carries the RC number in the copyable company details', () => {
  const lh = read('../src/lib/letterhead.ts')
  const card = read('../src/components/CompanyContactCard.tsx')
  assert.match(lh, /rcNumber: 'RC 9700401'/)
  assert.match(card, /id: 'rc'[^\n]*LETTERHEAD\.rcNumber/)
  assert.match(card, /const all = \[[^\]]*LETTERHEAD\.rcNumber/)
  assert.ok(!/1654710|Richathaoir/i.test(lh + card))
})

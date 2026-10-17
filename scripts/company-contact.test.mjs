import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const lib = read('../src/lib/letterhead.ts')
const card = read('../src/components/CompanyContactCard.tsx')
const studio = read('../src/modules/LetterheadStudio.tsx')

test('company address and telephone are the ones given', () => {
  assert.match(lib, /address: 'Babajide Sanwo-Olu International Market, Ikosi, Lagos, Nigeria'/)
  assert.match(lib, /phoneIntl: '\+234 816 270 6078'/)
})
test('the PDF footer keeps the official template wording', () => {
  assert.match(lib, /\['TELEPHONE', LETTERHEAD\.phone,/)
  assert.match(lib, /\['LOCATION', LETTERHEAD\.location,/)
})
test('each detail has its own copy button and there is a copy-all', () => {
  assert.match(card, /aria-label=\{copied === row\.id/)
  assert.match(card, /Copy all/)
  for (const id of ['address', 'phone', 'email', 'web']) assert.ok(card.includes(`id: '${id}'`), id)
})
test('copy works without the async clipboard API', () => {
  assert.match(card, /execCommand\('copy'\)/)
})
test('the phone is a tap-to-call link with no spaces', () => {
  assert.match(card, /tel:\$\{LETTERHEAD\.phoneIntl\.replace\(\/\\s\+\/g, ''\)\}/)
})
test('the card is on the Letterhead page', () => {
  assert.match(studio, /<CompanyContactCard \/>/)
})
test('no em dash in the new files', () => {
  assert.ok(!card.includes('—'))
  assert.ok(!read('../src/components/company-contact.css').includes('—'))
})

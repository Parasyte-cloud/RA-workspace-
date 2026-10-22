import assert from 'node:assert/strict'
import test from 'node:test'
import { toDate, toAmount, toSignedAmount } from '../src/lib/bankStatementParse.ts'

// Run under several zones to prove the computer's timezone never changes a date:
//   TZ=Africa/Lagos node --test scripts/bank-statement-parse.test.mjs
//   TZ=America/Los_Angeles node --test scripts/bank-statement-parse.test.mjs

test('day-first text dates are read as day first', () => {
  assert.equal(toDate('05/10/2026'), '2026-10-05')
  assert.equal(toDate('05-10-2026'), '2026-10-05')
  assert.equal(toDate('5.10.26'), '2026-10-05')
  assert.equal(toDate('25/10/2026'), '2026-10-25')
  assert.equal(toDate('01/02/2026'), '2026-02-01')
})

test('a month that can only be month-first is still understood', () => {
  assert.equal(toDate('10/25/2026'), '2026-10-25')
})

test('named months do not shift a day in any timezone', () => {
  assert.equal(toDate('05 Oct 2026'), '2026-10-05')
  assert.equal(toDate('5 October 2026'), '2026-10-05')
  assert.equal(toDate('Oct 5, 2026'), '2026-10-05')
  assert.equal(toDate('05-Oct-2026'), '2026-10-05')
})

test('ISO dates, with or without a time, are kept', () => {
  assert.equal(toDate('2026-10-05'), '2026-10-05')
  assert.equal(toDate('2026-10-05T09:30:00'), '2026-10-05')
  assert.equal(toDate('2026/10/05'), '2026-10-05')
})

test('Excel dates arrive at UTC midnight and keep their calendar day', () => {
  assert.equal(toDate(new Date(Date.UTC(2026, 9, 5))), '2026-10-05')
  assert.equal(toDate(new Date('invalid')), '')
})

test('impossible days are not turned into another day', () => {
  assert.equal(toDate('31/02/2026'), '31/02/2026') // kept as text, never rolled into March
  assert.equal(toDate(''), '')
  assert.equal(toDate(null), '')
})

test('debits and credits are magnitudes, a balance keeps its sign', () => {
  assert.equal(toAmount('₦1,250.50'), 1250.5)
  assert.equal(toAmount('(1,250.50)'), 1250.5)
  assert.equal(toAmount('-300'), 300)
  assert.equal(toSignedAmount('1,000'), 1000)
  assert.equal(toSignedAmount('-1,000'), -1000)
  assert.equal(toSignedAmount('(1,000.00)'), -1000)
  assert.equal(toSignedAmount('1,000.00-'), -1000)
  assert.equal(toSignedAmount('1,000.00 DR'), -1000)
  assert.equal(toSignedAmount(-45.5), -45.5)
  assert.equal(toSignedAmount('abc'), 0)
})

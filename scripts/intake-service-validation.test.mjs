import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_BODY_BYTES,
  clientSchema,
  normalizePhone,
  normalizeSchema,
  validateSubmission,
} from '../supabase/functions/intake/validation.mjs'

const schema = {
  fields: [
    { key: 'full_name', label: 'Full name', type: 'text', required: true, minLength: 2, maxLength: 80 },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'interest', label: 'Interest', type: 'select', required: true, options: ['investor', 'partner'] },
    { key: 'employees', label: 'Employees', type: 'integer', min: 1, max: 100000 },
    { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 5000 },
    { key: 'consent', label: 'Consent', type: 'checkbox', required: true },
  ],
}

test('normalizes Nigerian and E.164 phone values', () => {
  assert.equal(normalizePhone('08162706078'), '+2348162706078')
  assert.equal(normalizePhone('2348162706078'), '+2348162706078')
  assert.equal(normalizePhone('+44 7700 900123'), '+447700900123')
  assert.equal(normalizePhone('not-a-phone'), null)
})

test('rejects malformed or duplicate schema fields', () => {
  assert.equal(normalizeSchema({ fields: [{ key: 'Bad Key', type: 'text' }] }).ok, false)
  assert.equal(normalizeSchema({ fields: [{ key: 'x', type: 'text' }, { key: 'x', type: 'text' }] }).ok, false)
})

test('accepts and normalizes a valid dynamic submission', () => {
  const result = validateSubmission(schema, {
    full_name: '  Ada Lovelace  ',
    email: 'ADA@EXAMPLE.COM',
    phone: '08162706078',
    interest: 'investor',
    employees: '42',
    notes: '  Call next week. ',
    consent: true,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, {
    full_name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+2348162706078',
    interest: 'investor',
    employees: 42,
    notes: 'Call next week.',
    consent: true,
  })
})

test('rejects unknown fields and missing required fields', () => {
  const unknown = validateSubmission(schema, {
    full_name: 'Ada',
    email: 'ada@example.com',
    interest: 'investor',
    consent: true,
    admin: true,
  })
  assert.equal(unknown.ok, false)
  assert.match(unknown.errors[0], /Unknown field/)

  const missing = validateSubmission(schema, { full_name: 'Ada' })
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((item) => item.includes('Email is required')))
  assert.ok(missing.errors.some((item) => item.includes('Interest is required')))
  assert.ok(missing.errors.some((item) => item.includes('Consent is required')))
})

test('rejects invalid email, select, integer, and checkbox values', () => {
  const result = validateSubmission(schema, {
    full_name: 'Ada',
    email: 'bad-email',
    interest: 'owner',
    employees: 1.5,
    consent: 'yes',
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((item) => item.includes('valid email')))
  assert.ok(result.errors.some((item) => item.includes('invalid option')))
  assert.ok(result.errors.some((item) => item.includes('valid integer')))
  assert.ok(result.errors.some((item) => item.includes('true or false')))
})

test('client schema exposes only rendering and validation metadata', () => {
  const result = clientSchema({
    fields: [{
      key: 'email',
      label: 'Email',
      type: 'email',
      required: true,
      placeholder: 'you@example.com',
      internalRoutingHint: 'secret',
    }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.fields[0].key, 'email')
  assert.equal('internalRoutingHint' in result.fields[0], false)
})

test('request size constant is fixed at 64 KiB', () => {
  assert.equal(MAX_BODY_BYTES, 65536)
})

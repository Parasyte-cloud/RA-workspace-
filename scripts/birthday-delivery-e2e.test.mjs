import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

function env() {
  assert.equal(readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1], 'RA-workspace')
  const out = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  const values = {}
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"')) value = JSON.parse(value)
    else if (value.startsWith("'")) value = value.slice(1, -1)
    values[match[1]] = value
  }
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(values.API_URL).hostname))
  return { url: values.API_URL, anon: values.ANON_KEY, serviceKey: values.SERVICE_ROLE_KEY }
}

async function must(label, promise) {
  const result = await promise
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

test('birthday delivery is once per employee year across parallel sessions without private date leakage', async () => {
  const e = env()
  const service = createClient(e.url, e.serviceKey, opts)
  const tag = `birthday-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
  const email = `${tag}@ridearrivo.com`
  const password = `Local!${crypto.randomUUID()}Aa1`
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const user = created.data.user
  const lagosNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', month: '2-digit', day: '2-digit', year: 'numeric' }).formatToParts(new Date())
  const part = Object.fromEntries(lagosNow.filter(value => value.type !== 'literal').map(value => [value.type, value.value]))
  const birthday = `1990-${part.month}-${part.day}`
  const year = Number(part.year)
  const sourceKey = `birthday:${user.id}:${year}`

  try {
    await must('profile', service.from('employee_profiles').upsert({
      id: user.id,
      email,
      full_name: 'Birthday Fixture',
      department: 'Operations',
      job_title: 'Fixture',
      role: 'employee',
      location: 'Lagos',
      active: true,
      date_of_birth: birthday,
    }, { onConflict: 'id' }))

    async function login() {
      const client = createClient(e.url, e.anon, opts)
      await must('login', client.auth.signInWithPassword({ email, password }))
      return client
    }
    const first = await login()
    const second = await login()

    const ensured = await Promise.all([
      first.rpc('ensure_my_birthday_delivery'),
      second.rpc('ensure_my_birthday_delivery'),
    ])
    for (const result of ensured) if (result.error) throw new Error(`ensure birthday: ${result.error.message}`)

    const deliveries = await must('birthday delivery', service.from('recognition_ceremony_deliveries')
      .select('id,source_key,recipient_id,state,presentation')
      .eq('source_kind', 'birthday')
      .eq('source_key', sourceKey)
      .eq('recipient_id', user.id))
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0].state, 'pending')
    assert.equal(deliveries[0].presentation.employee_name, 'Birthday Fixture')
    for (const privateKey of ['age', 'birth_year', 'date_of_birth']) assert.equal(privateKey in deliveries[0].presentation, false)

    const [claimA, claimB] = await Promise.all([
      first.rpc('claim_next_recognition_ceremony'),
      second.rpc('claim_next_recognition_ceremony'),
    ])
    if (claimA.error) throw new Error(`claim A: ${claimA.error.message}`)
    if (claimB.error) throw new Error(`claim B: ${claimB.error.message}`)
    const claims = [claimA.data, claimB.data].filter(value => value?.source_kind === 'birthday')
    assert.equal(claims.length, 1)
    assert.equal(claims[0].source_key, sourceKey)
    assert.equal('age' in claims[0], false)
    assert.equal('birth_year' in claims[0], false)
    assert.equal('date_of_birth' in claims[0], false)

    await must('present birthday', first.rpc('mark_recognition_ceremony_presented', { p_delivery_id: claims[0].delivery_id }))
    const history = await must('birthday persisted', service.from('recognition_ceremony_deliveries').select('state,presented_at').eq('id', claims[0].delivery_id).single())
    assert.equal(history.state, 'presented')
    assert.ok(history.presented_at)
  } finally {
    await service.from('recognition_ceremony_deliveries').delete().eq('source_kind', 'birthday').eq('source_key', sourceKey)
    await service.auth.admin.deleteUser(user.id)
  }
})

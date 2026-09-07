import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const opts = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

function localEnv() {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  assert.equal(config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1], 'RA-workspace')
  assert.match(config, /^\[functions\.intake\]$/m)
  assert.match(config, /^verify_jwt\s*=\s*false$/m)

  const output = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const env = {}
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    env[match[1]] = value
  }
  assert.ok(env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY)
  const host = new URL(env.API_URL).hostname
  assert.ok(host === '127.0.0.1' || host === 'localhost', `Refusing non-local API ${env.API_URL}`)
  return {
    url: env.API_URL.replace(/\/$/, ''),
    anon: env.ANON_KEY,
    serviceKey: env.SERVICE_ROLE_KEY,
  }
}

async function value(label, promise) {
  const result = await promise
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function responseJson(label, response, expectedStatus) {
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${label}: non-JSON response ${text.slice(0, 200)}`)
  }
  assert.equal(response.status, expectedStatus, `${label}: ${response.status} ${text}`)
  return body
}

function headers(token = null, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:5173',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

const fieldSchema = {
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

function validPayload(name) {
  return {
    full_name: name,
    email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com`,
    phone: '08162706078',
    interest: 'investor',
    employees: '42',
    notes: 'Local intake service regression.',
    consent: true,
  }
}

test('intake Edge Function public/internal service matrix', { timeout: 120000 }, async () => {
  const { url, anon, serviceKey } = localEnv()
  const service = createClient(url, serviceKey, opts)
  const functionUrl = `${url}/functions/v1/intake`
  const tag = `intake-e2e-${Date.now()}-${crypto.randomUUID()}`
  const publicSlug = `${tag}-public`.slice(0, 96)
  const internalSlug = `${tag}-internal`.slice(0, 96)
  const users = []
  const formIds = []
  let failure = null

  async function identity(key, role, department) {
    const email = `${tag}-${key}@ridearrivo.com`
    const password = `LocalOnly!${crypto.randomUUID()}Aa1`
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Intake E2E ${key}` },
    })
    if (created.error || !created.data?.user) {
      throw new Error(`create ${key}: ${created.error?.message || 'missing user'}`)
    }
    const user = { id: created.data.user.id, key, email, password }
    users.push(user)
    await value(`profile ${key}`, service.from('employee_profiles').upsert({
      id: user.id,
      full_name: `Intake E2E ${key}`,
      email,
      department,
      job_title: 'Local intake Edge Function fixture',
      role,
      location: 'Lagos',
      active: true,
    }, { onConflict: 'id' }))
    return user
  }

  async function login(user) {
    const client = createClient(url, anon, opts)
    const signed = await client.auth.signInWithPassword({ email: user.email, password: user.password })
    if (signed.error || !signed.data?.session?.access_token) {
      throw new Error(`login ${user.key}: ${signed.error?.message || 'missing access token'}`)
    }
    return signed.data.session.access_token
  }

  async function createPublishedForm({ categoryId, slug, publicSlugValue, visibility, title }) {
    const form = await value(`${title} form`, service.from('intake_forms').insert({
      category_id: categoryId,
      slug,
      internal_name: title,
      public_slug: publicSlugValue,
      destination_workstation: 'support',
      default_assignee_id: null,
      visibility,
      lifecycle_status: 'draft',
    }).select('id').single())
    formIds.push(form.id)

    const version = await value(`${title} version`, service.from('intake_form_versions').insert({
      form_id: form.id,
      version_number: 1,
      title,
      description: 'Local-only intake Edge Function regression form.',
      field_schema: fieldSchema,
      published_at: new Date().toISOString(),
    }).select('id').single())

    await value(`${title} publish`, service.from('intake_forms').update({
      lifecycle_status: 'published',
      published_version_id: version.id,
    }).eq('id', form.id).select('id').single())

    return form.id
  }

  async function cleanup() {
    if (formIds.length) {
      await value('cleanup submissions', service.from('intake_submissions').delete().in('form_id', formIds))
      await value('disable cleanup forms', service.from('intake_forms').update({
        lifecycle_status: 'disabled',
        published_version_id: null,
      }).in('id', formIds))
      await value('delete cleanup forms', service.from('intake_forms').delete().in('id', formIds))
    }

    const userIds = users.map((user) => user.id)
    if (userIds.length) {
      await value('cleanup assignments', service.from('workspace_workstation_assignments').delete().in('employee_id', userIds))
    }
    for (const user of [...users].reverse()) {
      const deleted = await service.auth.admin.deleteUser(user.id)
      if (deleted.error) throw new Error(`delete ${user.key}: ${deleted.error.message}`)
    }
    await value('cleanup rate limits', service.from('intake_rate_limits').delete().gte('last_seen_at', '1970-01-01T00:00:00Z'))

    assert.equal((await value('residual profiles', service.from('employee_profiles').select('id').like('email', `${tag}%`))).length, 0)
    assert.equal((await value('residual forms', service.from('intake_forms').select('id').like('slug', `${tag}%`))).length, 0)
  }

  try {
    const support = await identity('support', 'support', 'Support')
    const finance = await identity('finance', 'finance', 'Finance')
    await value('support assignment', service.from('workspace_workstation_assignments').insert({
      employee_id: support.id,
      workstation: 'support',
      is_primary: false,
      active: true,
    }))

    const [supportToken, financeToken] = await Promise.all([login(support), login(finance)])
    const category = await value('customer support category', service.from('intake_categories').select('id').eq('slug', 'customer-support').single())

    const publicFormId = await createPublishedForm({
      categoryId: category.id,
      slug: `${tag}-public-form`.slice(0, 96),
      publicSlugValue: publicSlug,
      visibility: 'public',
      title: 'Public Intake E2E',
    })
    const internalFormId = await createPublishedForm({
      categoryId: category.id,
      slug: internalSlug,
      publicSlugValue: null,
      visibility: 'internal',
      title: 'Internal Intake E2E',
    })

    const publicSchema = await responseJson('public schema', await fetch(`${functionUrl}?slug=${encodeURIComponent(publicSlug)}`, {
      headers: { Origin: 'http://localhost:5173' },
    }), 200)
    assert.equal(publicSchema.form.slug, publicSlug)
    assert.equal(publicSchema.form.title, 'Public Intake E2E')
    assert.equal(publicSchema.form.category.slug, 'customer-support')
    assert.equal(publicSchema.form.fields.length, fieldSchema.fields.length)
    assert.equal('internalRoutingHint' in publicSchema.form.fields[0], false)

    await responseJson('evil origin', await fetch(`${functionUrl}?slug=${encodeURIComponent(publicSlug)}`, {
      headers: { Origin: 'https://evil.example' },
    }), 403)

    await responseJson('internal schema without token', await fetch(`${functionUrl}?scope=internal&slug=${encodeURIComponent(internalSlug)}`, {
      headers: { Origin: 'http://localhost:5173' },
    }), 401)

    await responseJson('finance internal schema isolation', await fetch(`${functionUrl}?scope=internal&slug=${encodeURIComponent(internalSlug)}`, {
      headers: headers(financeToken),
    }), 404)

    const internalSchema = await responseJson('support internal schema', await fetch(`${functionUrl}?scope=internal&slug=${encodeURIComponent(internalSlug)}`, {
      headers: headers(supportToken),
    }), 200)
    assert.equal(internalSchema.form.slug, internalSlug)
    assert.equal(internalSchema.form.title, 'Internal Intake E2E')

    const honeypot = await responseJson('honeypot', await fetch(functionUrl, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ slug: publicSlug, website: 'spam.example', payload: {} }),
    }), 202)
    assert.equal(honeypot.ok, true)

    const publicCreated = await responseJson('public submission', await fetch(functionUrl, {
      method: 'POST',
      headers: headers(null, { 'cf-connecting-ip': '198.51.100.10' }),
      body: JSON.stringify({ slug: publicSlug, payload: validPayload('Public Prospect') }),
    }), 201)
    assert.equal(publicCreated.ok, true)
    assert.equal(publicCreated.submission.status, 'new')

    const publicRow = await value('public row', service.from('intake_submissions').select(
      'id,form_id,payload,source,destination_workstation,assigned_employee_id,status,submitted_by_user_id,whatsapp_conversation_id',
    ).eq('id', publicCreated.submission.id).single())
    assert.equal(publicRow.form_id, publicFormId)
    assert.equal(publicRow.payload.phone, '+2348162706078')
    assert.equal(publicRow.payload.email, 'public.prospect@example.com')
    assert.equal(publicRow.source, 'public_form')
    assert.equal(publicRow.destination_workstation, 'support')
    assert.equal(publicRow.assigned_employee_id, null)
    assert.equal(publicRow.status, 'new')
    assert.equal(publicRow.submitted_by_user_id, null)
    assert.equal(publicRow.whatsapp_conversation_id, null)

    const invalidPayload = { ...validPayload('Unknown Field'), admin: true }
    const invalid = await responseJson('unknown field', await fetch(functionUrl, {
      method: 'POST',
      headers: headers(null, { 'cf-connecting-ip': '198.51.100.11' }),
      body: JSON.stringify({ slug: publicSlug, payload: invalidPayload }),
    }), 422)
    assert.equal(invalid.error, 'Submission validation failed.')
    assert.ok(Array.isArray(invalid.fields) && invalid.fields.some((item) => /Unknown field/.test(item)))

    await responseJson('public WhatsApp link denied', await fetch(functionUrl, {
      method: 'POST',
      headers: headers(null, { 'cf-connecting-ip': '198.51.100.12' }),
      body: JSON.stringify({
        slug: publicSlug,
        payload: validPayload('Public WhatsApp'),
        whatsappConversationId: crypto.randomUUID(),
      }),
    }), 403)

    await responseJson('internal submission without token', await fetch(`${functionUrl}?scope=internal`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ slug: internalSlug, payload: validPayload('No Token') }),
    }), 401)

    await responseJson('finance internal submission isolation', await fetch(`${functionUrl}?scope=internal`, {
      method: 'POST',
      headers: headers(financeToken),
      body: JSON.stringify({ slug: internalSlug, payload: validPayload('Finance Blocked') }),
    }), 404)

    const internalCreated = await responseJson('support internal submission', await fetch(`${functionUrl}?scope=internal`, {
      method: 'POST',
      headers: headers(supportToken, { 'cf-connecting-ip': '198.51.100.13' }),
      body: JSON.stringify({ slug: internalSlug, payload: validPayload('Support Internal') }),
    }), 201)
    assert.equal(internalCreated.ok, true)

    const internalRow = await value('internal row', service.from('intake_submissions').select(
      'id,form_id,source,destination_workstation,status,submitted_by_user_id',
    ).eq('id', internalCreated.submission.id).single())
    assert.equal(internalRow.form_id, internalFormId)
    assert.equal(internalRow.source, 'workspace_form')
    assert.equal(internalRow.destination_workstation, 'support')
    assert.equal(internalRow.status, 'new')
    assert.equal(internalRow.submitted_by_user_id, support.id)

    const directKey = crypto.createHash('sha256').update(`${tag}:direct-rate`).digest('hex')
    const rate1 = await value('rate 1', service.rpc('consume_intake_rate_limit', { p_key_hash: directKey, p_limit: 2, p_window_seconds: 600 }))
    const rate2 = await value('rate 2', service.rpc('consume_intake_rate_limit', { p_key_hash: directKey, p_limit: 2, p_window_seconds: 600 }))
    const rate3 = await value('rate 3', service.rpc('consume_intake_rate_limit', { p_key_hash: directKey, p_limit: 2, p_window_seconds: 600 }))
    assert.equal(rate1[0].allowed, true)
    assert.equal(rate1[0].remaining, 1)
    assert.equal(rate2[0].allowed, true)
    assert.equal(rate2[0].remaining, 0)
    assert.equal(rate3[0].allowed, false)
    assert.equal(rate3[0].remaining, 0)

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const result = await fetch(functionUrl, {
        method: 'POST',
        headers: headers(null, { 'cf-connecting-ip': '203.0.113.77' }),
        body: JSON.stringify({ slug: publicSlug, payload: {} }),
      })
      if (attempt <= 10) {
        const body = await responseJson(`rate integration ${attempt}`, result, 422)
        assert.equal(body.error, 'Submission validation failed.')
      } else {
        const body = await responseJson('rate integration blocked', result, 429)
        assert.match(body.error, /Too many submissions/i)
      }
    }

    const oversized = JSON.stringify({ slug: publicSlug, payload: { notes: 'x'.repeat(70000) } })
    await responseJson('oversized request', await fetch(functionUrl, {
      method: 'POST',
      headers: headers(null, { 'cf-connecting-ip': '198.51.100.14' }),
      body: oversized,
    }), 413)

    console.log('INTAKE_EDGE_PUBLIC_SCHEMA=PASS')
    console.log('INTAKE_EDGE_INTERNAL_AUTHORIZATION=PASS')
    console.log('INTAKE_EDGE_PUBLIC_SUBMISSION=PASS')
    console.log('INTAKE_EDGE_INTERNAL_SUBMISSION=PASS')
    console.log('INTAKE_EDGE_VALIDATION=PASS')
    console.log('INTAKE_EDGE_ORIGIN_POLICY=PASS')
    console.log('INTAKE_EDGE_HONEYPOT=PASS')
    console.log('INTAKE_EDGE_RATE_LIMIT=PASS')
    console.log('INTAKE_EDGE_REQUEST_SIZE_LIMIT=PASS')
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  }

  try {
    await cleanup()
    console.log('INTAKE_EDGE_FIXTURE_CLEANUP=PASS')
  } catch (error) {
    if (!failure) failure = error instanceof Error ? error : new Error(String(error))
    else console.error('INTAKE_EDGE_CLEANUP_FAILURE', error)
  }

  if (failure) throw failure
})

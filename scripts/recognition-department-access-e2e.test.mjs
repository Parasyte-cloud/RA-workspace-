import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

function localEnv() {
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  assert.equal(config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1], 'RA-workspace')
  const out = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  const env = {}
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    env[match[1]] = value
  }
  const host = new URL(env.API_URL).hostname
  assert.ok(host === '127.0.0.1' || host === 'localhost')
  return { url: env.API_URL, anon: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY }
}

async function must(label, promise) {
  const result = await promise
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function fixture() {
  const { url, anon, serviceKey } = localEnv()
  const service = createClient(url, serviceKey, opts)
  const tag = `recognition-access-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
  const users = []
  async function identity(key, { department = 'Operations', role = 'employee', active = true } = {}) {
    const email = `${tag}-${key}@ridearrivo.com`
    const password = `LocalOnly!${crypto.randomUUID()}Aa1`
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data?.user) throw new Error(`create ${key}: ${created.error?.message}`)
    const user = { id: created.data.user.id, email, password, key }
    users.push(user)
    await must(`profile ${key}`, service.from('employee_profiles').upsert({
      id: user.id, full_name: `Recognition ${key}`, email, department,
      job_title: 'Recognition fixture', role, location: 'Lagos', active,
    }, { onConflict: 'id' }))
    return user
  }
  async function login(user) {
    const client = createClient(url, anon, opts)
    await must(`login ${user.key}`, client.auth.signInWithPassword({ email: user.email, password: user.password }))
    return client
  }
  async function cleanup() {
    await service.from('department_achievements').delete().like('title', `${tag}%`)
    await service.from('workspace_department_leads').delete().is('ended_at', null).in('employee_id', users.map(u => u.id))
    await service.from('workspace_workstation_assignments').delete().in('employee_id', users.map(u => u.id))
    for (const user of [...users].reverse()) await service.auth.admin.deleteUser(user.id)
  }
  return { service, tag, identity, login, cleanup }
}

test('department trophy access resolves exact authorized relationships and aliases', async () => {
  const f = await fixture()
  try {
    const member = await f.identity('member', { department: 'Marketing' })
    const assigned = await f.identity('assigned', { department: 'Finance' })
    const head = await f.identity('head', { department: 'Finance' })
    const delegated = await f.identity('delegated', { department: 'Operations' })
    const admin = await f.identity('admin', { department: 'Administration', role: 'admin' })
    const unrelated = await f.identity('unrelated', { department: 'Legal' })
    const inactive = await f.identity('inactive', { department: 'Marketing', active: false })

    await must('assigned workstation', f.service.from('workspace_workstation_assignments').insert({ employee_id: assigned.id, workstation: 'marketing', active: true, is_primary: true }))
    await must('head workstation', f.service.from('workspace_workstation_assignments').insert({ employee_id: head.id, workstation: 'people', active: true, is_primary: true, is_head: true }))
    await must('delegated lead', f.service.from('workspace_department_leads').insert({ department: 'Executive / CEO Management', employee_id: delegated.id }))
    await must('trophies', f.service.from('department_achievements').insert([
      { department: 'marketing', kind: 'dept_overdue_clear', title: `${f.tag} marketing`, description: 'fixture', tier: 'gold' },
      { department: 'people', kind: 'dept_overdue_clear', title: `${f.tag} people`, description: 'fixture', tier: 'gold' },
      { department: 'executive', kind: 'dept_overdue_clear', title: `${f.tag} executive`, description: 'fixture', tier: 'gold' },
    ]))

    const memberClient = await f.login(member)
    const assignedClient = await f.login(assigned)
    const headClient = await f.login(head)
    const delegatedClient = await f.login(delegated)
    const adminClient = await f.login(admin)
    const unrelatedClient = await f.login(unrelated)
    const inactiveClient = await f.login(inactive)

    const cases = [
      [memberClient, 'Marketing', 'department_member'],
      [assignedClient, 'marketing', 'workstation_assignee'],
      [headClient, 'People & HR', 'department_head'],
      [delegatedClient, 'CEO / Management', 'delegated_leadership'],
      [adminClient, 'Marketing', 'workspace_admin'],
    ]
    for (const [client, department, relationship] of cases) {
      const context = await must(`context ${relationship}`, client.rpc('get_authorized_department_trophy_context', { p_department: department }))
      assert.equal(context.authorized, true)
      assert.equal(context.relationship, relationship)
    }

    const denied = await must('unrelated context', unrelatedClient.rpc('get_authorized_department_trophy_context', { p_department: 'Marketing' }))
    assert.equal(denied.authorized, false)
    assert.equal((await must('unrelated history', unrelatedClient.rpc('list_department_trophy_history', { p_department: 'Marketing', p_limit: 50 }))).length, 0)
    const inactiveContext = await must('inactive context', inactiveClient.rpc('get_authorized_department_trophy_context', { p_department: 'Marketing' }))
    assert.equal(inactiveContext.authorized, false)
    const partial = await must('partial alias', unrelatedClient.rpc('get_authorized_department_trophy_context', { p_department: 'market' }))
    assert.equal(partial.authorized, false)
  } finally { await f.cleanup() }
})

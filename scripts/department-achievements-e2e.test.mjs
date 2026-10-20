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

  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  const env = {}
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    env[match[1]] = value
  }

  assert.ok(env.API_URL)
  assert.ok(env.ANON_KEY)
  assert.ok(env.SERVICE_ROLE_KEY)
  const host = new URL(env.API_URL).hostname
  assert.ok(host === '127.0.0.1' || host === 'localhost', `Refusing non-local API ${env.API_URL}`)
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
  const tag = `achievement-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const deptA = `${tag}-alpha`.toLowerCase()
  const deptB = `${tag}-bravo`.toLowerCase()
  const users = []

  async function identity(key, { department = deptA, role = 'employee', active = true } = {}) {
    const email = `${tag}-${key}@ridearrivo.com`
    const password = `LocalOnly!${crypto.randomUUID()}Aa1`
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data?.user) throw new Error(`create ${key}: ${created.error?.message || 'missing user'}`)
    const user = { id: created.data.user.id, email, password, key }
    users.push(user)
    await must(`profile ${key}`, service.from('employee_profiles').upsert({
      id: user.id,
      full_name: `Achievement ${key}`,
      email,
      department,
      job_title: 'Department achievement test',
      role,
      location: 'Lagos',
      active,
    }, { onConflict: 'id' }))
    return user
  }

  async function login(user) {
    const client = createClient(url, anon, opts)
    const result = await client.auth.signInWithPassword({ email: user.email, password: user.password })
    if (result.error) throw new Error(`login ${user.key}: ${result.error.message}`)
    return client
  }

  async function cleanup() {
    const milestones = await service.from('team_milestones').select('id').like('title', `${tag}%`)
    const milestoneIds = (milestones.data || []).map(row => row.id)
    if (milestoneIds.length) {
      await service.from('department_achievements').delete().in('source_milestone_id', milestoneIds)
      await service.from('team_milestones').delete().in('id', milestoneIds)
    }
    const spaces = await service.from('collaboration_spaces').select('id').like('name', `${tag}%`)
    const spaceIds = (spaces.data || []).map(row => row.id)
    if (spaceIds.length) await service.from('collaboration_spaces').delete().in('id', spaceIds)
    for (const user of [...users].reverse()) await service.auth.admin.deleteUser(user.id)
  }

  return { service, deptA, deptB, identity, login, cleanup, tag }
}

test('department trophies are isolated, cross-department, durably delivered, and transfer-aware', async () => {
  const f = await fixture()
  try {
    const admin = await f.identity('admin', { department: f.deptA, role: 'admin' })
    const alpha = await f.identity('alpha', { department: `  ${f.deptA.toUpperCase()}  ` })
    const bravo = await f.identity('bravo', { department: f.deptB })
    const inactive = await f.identity('inactive', { department: f.deptA, active: false })

    const [space] = await must('project space', f.service.from('collaboration_spaces').insert({
      name: `${f.tag} project`,
      description: 'Cross-department trophy fixture',
      space_type: 'project',
      home_department: f.deptA,
      created_by: admin.id,
    }).select('id'))

    await must('project members', f.service.from('collaboration_space_members').insert([
      { space_id: space.id, user_id: alpha.id, member_role: 'member', added_by: admin.id },
      { space_id: space.id, user_id: bravo.id, member_role: 'member', added_by: admin.id },
    ]))

    await must('project milestone', f.service.from('team_milestones').insert({
      kind: 'project_complete',
      title: `${f.tag} project`,
      project_id: space.id,
    }))
    await must('duplicate project milestone delivery', f.service.from('team_milestones').insert({
      kind: 'project_complete',
      title: `${f.tag} project duplicate delivery`,
      project_id: space.id,
    }))

    const trophies = await must('materialised trophies', f.service
      .from('department_achievements')
      .select('id,department,kind,project_id')
      .eq('project_id', space.id)
      .order('department'))

    assert.deepEqual(trophies.map(row => row.department).sort(), [f.deptA, f.deptB].sort())
    assert.equal(trophies.length, 2)

    const alphaClient = await f.login(alpha)
    const bravoClient = await f.login(bravo)
    const adminClient = await f.login(admin)
    const inactiveClient = await f.login(inactive)

    const alphaHistory = await must('alpha history', alphaClient.rpc('list_department_trophy_history', { p_department: f.deptA, p_limit: 50 }))
    assert.equal(alphaHistory.length, 1)
    const deniedOther = await must('alpha other history', alphaClient.rpc('list_department_trophy_history', { p_department: f.deptB, p_limit: 50 }))
    assert.equal(deniedOther.length, 0)

    const bravoHistory = await must('bravo history', bravoClient.rpc('list_department_trophy_history', { p_department: f.deptB, p_limit: 50 }))
    assert.equal(bravoHistory.length, 1)

    const inactiveClaim = await must('inactive claim', inactiveClient.rpc('claim_next_recognition_ceremony'))
    assert.equal(inactiveClaim, null)

    const adminA = await must('admin alpha history', adminClient.rpc('list_department_trophy_history', { p_department: f.deptA, p_limit: 50 }))
    const adminB = await must('admin bravo history', adminClient.rpc('list_department_trophy_history', { p_department: f.deptB, p_limit: 50 }))
    assert.equal(adminA.length, 1)
    assert.equal(adminB.length, 1)

    const alphaId = alphaHistory[0].id
    const bravoId = bravoHistory[0].id

    const [alphaClaimA, alphaClaimB] = await Promise.all([
      must('alpha claim tab A', alphaClient.rpc('claim_next_recognition_ceremony')),
      must('alpha claim tab B', alphaClient.rpc('claim_next_recognition_ceremony')),
    ])
    const claimed = [alphaClaimA, alphaClaimB].filter(Boolean)
    assert.equal(claimed.length, 1, 'parallel tabs must only receive the achievement once')
    assert.equal(claimed[0].source_kind, 'department_achievement')
    assert.equal(claimed[0].source_id, alphaId)

    const alphaDeliveries = await must('alpha delivery audit', f.service
      .from('recognition_ceremony_deliveries')
      .select('source_id,recipient_id,state')
      .eq('source_kind', 'department_achievement')
      .eq('source_id', alphaId)
      .eq('recipient_id', alpha.id))
    assert.equal(alphaDeliveries.length, 1)
    assert.equal(alphaDeliveries[0].state, 'claimed', 'claim must persist before the ceremony is rendered')

    const bravoDeliveries = await must('bravo delivery isolation', f.service
      .from('recognition_ceremony_deliveries')
      .select('source_id,recipient_id,state')
      .eq('source_kind', 'department_achievement')
      .eq('source_id', bravoId)
      .eq('recipient_id', bravo.id))
    assert.equal(bravoDeliveries.length, 1)
    assert.equal(bravoDeliveries[0].state, 'pending', 'another employee claim must not consume bravo delivery')

    const alphaAgain = await must('alpha refresh claim', alphaClient.rpc('claim_next_recognition_ceremony'))
    assert.equal(alphaAgain, null, 'refresh must not replay a claimed ceremony')

    const alphaPersistent = await must('alpha persistent history', alphaClient.rpc('list_department_trophy_history', { p_department: f.deptA, p_limit: 50 }))
    assert.equal(alphaPersistent.length, 1, 'ceremony claim must not hide persistent trophy')

    await must('transfer alpha', f.service.from('employee_profiles').update({ department: f.deptB }).eq('id', alpha.id))
    const oldAfterTransfer = await must('old history after transfer', alphaClient.rpc('list_department_trophy_history', { p_department: f.deptA, p_limit: 50 }))
    const newAfterTransfer = await must('new history after transfer', alphaClient.rpc('list_department_trophy_history', { p_department: f.deptB, p_limit: 50 }))
    assert.equal(oldAfterTransfer.length, 0)
    assert.equal(newAfterTransfer.length, 1)
  } finally {
    await f.cleanup()
  }
})

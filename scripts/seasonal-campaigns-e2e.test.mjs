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

test('seasonal campaigns materialize active recipients and cancellation preserves claimed history', async () => {
  const e = env()
  const service = createClient(e.url, e.serviceKey, opts)
  const tag = `seasonal-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`
  const users = []
  const campaignIds = []

  async function make(key, { role = 'employee', workstation = null, active = true } = {}) {
    const email = `${tag}-${key}@ridearrivo.com`
    const password = `Local!${crypto.randomUUID()}Aa1`
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw created.error
    users.push(created.data.user)
    await must('profile', service.from('employee_profiles').upsert({
      id: created.data.user.id,
      email,
      full_name: `Seasonal ${key}`,
      department: workstation === 'people' ? 'People' : 'Operations',
      job_title: 'Fixture',
      role,
      location: 'Lagos',
      active,
    }, { onConflict: 'id' }))
    if (workstation) {
      await must('workstation', service.from('workspace_workstation_assignments').upsert({
        employee_id: created.data.user.id,
        workstation,
        is_primary: false,
        active: true,
      }, { onConflict: 'employee_id,workstation' }))
    }
    return { id: created.data.user.id, email, password, key }
  }

  async function login(user) {
    const client = createClient(e.url, e.anon, opts)
    await must(`login ${user.key}`, client.auth.signInWithPassword({ email: user.email, password: user.password }))
    return client
  }

  const governor = await make('governor', { workstation: 'people' })
  const recipientA = await make('recipient-a')
  const recipientB = await make('recipient-b')
  const inactive = await make('inactive', { active: false })
  const governorClient = await login(governor)
  const ordinaryClient = await login(recipientA)
  const year = 2198

  try {
    const christmasPayload = {
      campaign_type: 'christmas',
      campaign_year: year,
      timezone: 'Africa/Lagos',
      starts_at: `${year}-12-24T00:00:00+01:00`,
      ends_at: `${year}-12-27T00:00:00+01:00`,
      greeting_title: 'Merry Christmas',
      greeting_message: 'Seasonal fixture greeting',
    }
    const denied = await ordinaryClient.rpc('save_recognition_seasonal_campaign', { p_payload: christmasPayload, p_request_id: crypto.randomUUID() })
    assert.ok(denied.error)
    const invalidZone = await governorClient.rpc('save_recognition_seasonal_campaign', { p_payload: { ...christmasPayload, timezone: 'Mars/Phobos' }, p_request_id: crypto.randomUUID() })
    assert.ok(invalidZone.error)
    assert.match(invalidZone.error.message, /timezone/i)
    const invalidWindow = await governorClient.rpc('save_recognition_seasonal_campaign', { p_payload: { ...christmasPayload, starts_at: `${year}-12-27T00:00:00+01:00`, ends_at: `${year}-12-24T00:00:00+01:00` }, p_request_id: crypto.randomUUID() })
    assert.ok(invalidWindow.error)

    const requestId = crypto.randomUUID()
    const campaignId = await must('save campaign', governorClient.rpc('save_recognition_seasonal_campaign', {
      p_payload: christmasPayload,
      p_request_id: requestId,
    }))
    campaignIds.push(campaignId)

    const listed = await must('list campaign', governorClient.rpc('list_recognition_seasonal_campaigns', { p_year: year }))
    const campaign = listed.find(row => row.campaign_id === campaignId)
    assert.ok(campaign)
    assert.equal(campaign.state, 'draft')

    await must('publish campaign', governorClient.rpc('publish_recognition_seasonal_campaign', {
      p_campaign_id: campaignId,
      p_expected_updated_at: campaign.updated_at,
      p_request_id: crypto.randomUUID(),
    }))

    const [materializedA, materializedB] = await Promise.all([
      must('materialize campaign A', service.rpc('materialize_due_recognition_seasonal_campaigns', { p_now: `${year}-12-25T12:00:00+01:00` })),
      must('materialize campaign B', service.rpc('materialize_due_recognition_seasonal_campaigns', { p_now: `${year}-12-25T12:00:00+01:00` })),
    ])
    assert.ok([...materializedA, ...materializedB].some(row => row.campaign_id === campaignId))

    const deliveries = await must('deliveries', service.from('recognition_ceremony_deliveries')
      .select('id,recipient_id,state,presentation')
      .eq('source_kind', 'seasonal_campaign')
      .eq('source_id', campaignId))
    const deliveryA = deliveries.find(row => row.recipient_id === recipientA.id)
    const deliveryB = deliveries.find(row => row.recipient_id === recipientB.id)
    assert.ok(deliveryA)
    assert.ok(deliveryB)
    assert.equal(deliveryA.presentation.campaign_type, 'christmas')
    assert.equal(deliveries.some(row => row.recipient_id === inactive.id), false)
    assert.equal(new Set(deliveries.map(row => row.recipient_id)).size, deliveries.length)

    await must('claim fixture delivery', service.from('recognition_ceremony_deliveries')
      .update({ state: 'claimed', claimed_at: new Date().toISOString() })
      .eq('id', deliveryA.id))

    const beforeCancelRows = await must('campaign before cancel', governorClient.rpc('list_recognition_seasonal_campaigns', { p_year: year }))
    const beforeCancel = beforeCancelRows.find(row => row.campaign_id === campaignId)
    assert.ok(beforeCancel)
    await must('cancel campaign', governorClient.rpc('cancel_recognition_seasonal_campaign', {
      p_campaign_id: campaignId,
      p_reason: 'Fixture cancellation verification',
      p_expected_updated_at: beforeCancel.updated_at,
      p_request_id: crypto.randomUUID(),
    }))

    const after = await must('delivery states after cancel', service.from('recognition_ceremony_deliveries')
      .select('id,state')
      .in('id', [deliveryA.id, deliveryB.id]))
    assert.equal(after.find(row => row.id === deliveryA.id)?.state, 'claimed')
    assert.equal(after.find(row => row.id === deliveryB.id)?.state, 'revoked')

    const now = Date.now()
    const iso = offset => new Date(now + offset).toISOString()
    const newYearId = await must('save New Year regression campaign', governorClient.rpc('save_recognition_seasonal_campaign', {
      p_payload: {
        campaign_type: 'new_year', campaign_year: 2199, timezone: 'Africa/Lagos',
        starts_at: iso(-2 * 60 * 60 * 1000), ends_at: iso(2 * 60 * 60 * 1000),
        live_window_starts_at: iso(-60 * 60 * 1000), live_window_ends_at: iso(-30 * 60 * 1000),
        greeting_title: 'Happy New Year', greeting_message: 'Server variant regression fixture',
      },
      p_request_id: crypto.randomUUID(),
    }))
    campaignIds.push(newYearId)
    const newYearRows = await must('list New Year campaign', governorClient.rpc('list_recognition_seasonal_campaigns', { p_year: 2199 }))
    const newYear = newYearRows.find(row => row.campaign_id === newYearId)
    assert.ok(newYear)
    await must('publish New Year', governorClient.rpc('publish_recognition_seasonal_campaign', { p_campaign_id: newYearId, p_expected_updated_at: newYear.updated_at, p_request_id: crypto.randomUUID() }))
    await must('materialize inside historical live window', service.rpc('materialize_due_recognition_seasonal_campaigns', { p_now: iso(-45 * 60 * 1000) }))
    const beforeClaim = await must('New Year delivery before claim', service.from('recognition_ceremony_deliveries').select('id,presentation').eq('source_kind', 'seasonal_campaign').eq('source_id', newYearId).eq('recipient_id', recipientB.id).single())
    assert.equal(beforeClaim.presentation.variant, 'live_midnight')
    const recipientBClient = await login(recipientB)
    const claim = await must('claim after live window', recipientBClient.rpc('claim_next_recognition_ceremony'))
    assert.equal(claim.source_id, newYearId)
    assert.equal(claim.variant, 'delayed')
    await must('dismiss New Year fixture', recipientBClient.rpc('mark_recognition_ceremony_dismissed', { p_delivery_id: claim.delivery_id }))
  } finally {
    if (campaignIds.length) {
      await service.from('recognition_ceremony_deliveries').delete().in('source_id', campaignIds)
      await service.from('recognition_governance_audit_events').delete().in('entity_id', campaignIds)
      await service.from('recognition_seasonal_campaigns').delete().in('id', campaignIds)
    }
    await service.from('workspace_workstation_assignments').delete().in('employee_id', users.map(user => user.id))
    for (const user of users.reverse()) await service.auth.admin.deleteUser(user.id)
  }
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const panel=
  readFileSync(
    'src/modules/MarketingIntelligencePanel.tsx',
    'utf8'
  )

const workspace=
  readFileSync(
    'src/modules/MarketingTeamWorkspace.tsx',
    'utf8'
  )

const css=
  readFileSync(
    'src/marketing-intelligence.css',
    'utf8'
  )

test('intelligence is an additive Marketing view',()=>{
  assert.match(
    workspace,
    /\| 'intelligence'/
  )

  assert.match(
    workspace,
    /setView\('intelligence'\)/
  )

  assert.match(
    workspace,
    /view==='intelligence'/
  )

  assert.match(
    workspace,
    /<MarketingIntelligencePanel\/>/
  )
})

test('existing Marketing execution remains available',()=>{
  assert.match(
    workspace,
    /view==='execution'/
  )

  assert.match(
    workspace,
    /<MarketingModule\/>/
  )
})

test('M3B dashboard is strictly read only',()=>{
  assert.doesNotMatch(
    panel,
    /\.(insert|update|delete|upsert|rpc)\(/
  )
})

test('dashboard uses approved aggregate sources',()=>{
  for(
    const table of [
      'marketing_campaigns',
      'marketing_creators',
      'marketing_performance_snapshots',
      'marketing_attribution'
    ]
  ){
    assert.match(
      panel,
      new RegExp(
        `\\.from\\('${table}'\\)`
      )
    )
  }
})

test('campaign creator assignments are part of intelligence',()=>{
  assert.match(
    panel,
    /\.from\('marketing_campaign_creators'\)/
  )

  assert.match(
    panel,
    /Creator assignments/
  )

  assert.match(
    panel,
    /campaignCreators\.length/
  )
})

test('creator-linked content is part of intelligence',()=>{
  assert.match(
    panel,
    /\.from\('marketing_content'\)/
  )

  assert.match(
    panel,
    /\.from\('marketing_content_creators'\)/
  )

  assert.match(
    panel,
    /Creator-linked content/
  )

  assert.match(
    panel,
    /linkedContentCount/
  )
})

test('tracking links are part of intelligence',()=>{
  assert.match(
    panel,
    /\.from\('marketing_tracking_links'\)/
  )

  assert.match(
    panel,
    /Active tracking links/
  )

  assert.match(
    panel,
    /activeTrackingLinks/
  )

  assert.match(
    panel,
    /utm_source,utm_medium,utm_campaign/
  )

  assert.match(
    panel,
    /row=>row\.status==='active'/
  )
})

test('social KPIs exclude superseded snapshots',()=>{
  assert.match(
    panel,
    /supersedes_snapshot_id/
  )

  assert.match(
    panel,
    /const supersededSnapshotIds=/
  )

  assert.match(
    panel,
    /const currentSnapshots=/
  )

  assert.match(
    panel,
    /!supersededSnapshotIds\.has\(row\.id\)/
  )

  assert.match(
    panel,
    /const reach=\s*currentSnapshots\.reduce\(/
  )

  assert.doesNotMatch(
    panel,
    /const reach=\s*snapshots\.reduce\(/
  )
})

test('creator attribution keeps financial values in marketing attribution',()=>{
  assert.match(
    panel,
    /\.from\('marketing_attribution_links'\)/
  )

  assert.match(
    panel,
    /const creatorAttributionIds=/
  )

  assert.match(
    panel,
    /row=>row\.campaign_creator_id!==null/
  )

  assert.match(
    panel,
    /creatorAttributedBookings/
  )

  assert.match(
    panel,
    /creatorAttributedRevenue/
  )

  const linkType =
    panel.match(
      /type AttributionLink=\{[\s\S]*?\n\}/
    )?.[0] ?? ''

  assert.doesNotMatch(
    linkType,
    /\b(?:spend|bookings|revenue):/
  )

  assert.match(
    panel,
    /\.from\('marketing_attribution'\)/
  )
})

test('dashboard does not query customer PII',()=>{
  assert.doesNotMatch(
    panel,
    /\bcustomer_name\b|\bcustomer_id\b|\bbooking_reference\b|\bphone\b|\bemail\b|\baddress\b/i
  )
})

test('intelligence styling is explicitly mounted',()=>{
  assert.match(
    panel,
    /import '\.\.\/marketing-intelligence\.css'/
  )

  assert.match(
    css,
    /\.marketingIntelHero/
  )

  assert.match(
    css,
    /\.marketingIntelMetrics/
  )

  assert.match(
    css,
    /@media\(max-width:700px\)/
  )
})

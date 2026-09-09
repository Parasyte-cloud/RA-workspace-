import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const workspace=fs.readFileSync(
  new URL(
    '../src/modules/MarketingTeamWorkspace.tsx',
    import.meta.url
  ),
  'utf8'
)

const manager=fs.readFileSync(
  new URL(
    '../src/modules/MarketingCreatorManager.tsx',
    import.meta.url
  ),
  'utf8'
)

const intelligence=fs.readFileSync(
  new URL(
    '../src/modules/MarketingIntelligencePanel.tsx',
    import.meta.url
  ),
  'utf8'
)

test('creator management is wired into intelligence',()=>{
  assert.match(
    workspace,
    /import MarketingCreatorManager/
  )

  assert.match(
    workspace,
    /<MarketingCreatorManager[\s\S]*?role=\{profile\?\.role \?\? null\}[\s\S]*?\/>/
  )

  assert.match(
    workspace,
    /<MarketingIntelligencePanel\/>/
  )
})

test('only marketing and admin receive creator controls',()=>{
  assert.match(
    manager,
    /role==='marketing'/
  )

  assert.match(
    manager,
    /role==='admin'/
  )

  assert.doesNotMatch(
    manager,
    /role==='manager'/
  )

  assert.match(
    manager,
    /if\(!canManage\)\{\s*return null\s*\}/
  )
})

test('creator manager has one scoped write path',()=>{
  const writes=
    manager.match(
      /\.(?:insert|update|delete|upsert|rpc)\(/g
    ) ?? []

  assert.equal(
    writes.length,
    1
  )

  assert.match(
    manager,
    /\.from\('marketing_creators'\)[\s\S]*?\.insert\(/
  )
})

test('creator registration contains no private contact data',()=>{
  assert.match(
    manager,
    /primary_platform/
  )

  assert.doesNotMatch(
    manager,
    /\b(?:email|phone|whatsapp|mobile_number)\b/i
  )
})

test('intelligence dashboard remains read only',()=>{
  assert.doesNotMatch(
    intelligence,
    /\.(?:insert|update|delete|upsert|rpc)\(/
  )
})

const assignment=fs.readFileSync(
  new URL(
    '../src/modules/MarketingCampaignCreatorManager.tsx',
    import.meta.url
  ),
  'utf8'
)

test('campaign creator management is wired into intelligence',()=>{
  assert.match(
    workspace,
    /import MarketingCampaignCreatorManager/
  )

  assert.match(
    workspace,
    /<MarketingCampaignCreatorManager[\s\S]*?role=\{profile\?\.role \?\? null\}[\s\S]*?\/>/
  )
})

test('only marketing and admin receive assignment controls',()=>{
  assert.match(
    assignment,
    /role==='marketing'/
  )

  assert.match(
    assignment,
    /role==='admin'/
  )

  assert.doesNotMatch(
    assignment,
    /role==='manager'/
  )

  assert.match(
    assignment,
    /if\(!canManage\)\{\s*return null\s*\}/
  )
})

test('campaign creator manager has one scoped write path',()=>{
  const writes=
    assignment.match(
      /\.(?:insert|update|delete|upsert|rpc)\(/g
    ) ?? []

  assert.equal(
    writes.length,
    1
  )

  assert.match(
    assignment,
    /\.from\('marketing_campaign_creators'\)[\s\S]*?\.insert\(/
  )
})

test('assignment fields preserve tracking and wallet boundaries',()=>{
  assert.match(assignment,/relationship_type/)
  assert.match(assignment,/agreed_fee/)
  assert.match(assignment,/currency/)
  assert.match(assignment,/tracking_code/)
  assert.match(assignment,/started_at/)
  assert.match(assignment,/ended_at/)
  assert.match(assignment,/brief/)
  assert.match(assignment,/\.toLowerCase\(\)/)
  assert.match(assignment,/\.toUpperCase\(\)/)

  assert.match(
    assignment,
    /authoritative in Marketing Wallet/
  )

  assert.doesNotMatch(
    assignment,
    /\b(?:email|phone|whatsapp|mobile_number)\b/i
  )
})

const contentCampaign=fs.readFileSync(
  new URL(
    '../src/modules/MarketingContentCampaignManager.tsx',
    import.meta.url
  ),
  'utf8'
)

test('content campaign management is wired into intelligence',()=>{
  assert.match(
    workspace,
    /import MarketingContentCampaignManager/
  )

  assert.match(
    workspace,
    /<MarketingContentCampaignManager[\s\S]*?role=\{profile\?\.role \?\? null\}[\s\S]*?\/>/
  )
})

test('only marketing and admin receive content campaign controls',()=>{
  assert.match(
    contentCampaign,
    /role==='marketing'/
  )

  assert.match(
    contentCampaign,
    /role==='admin'/
  )

  assert.doesNotMatch(
    contentCampaign,
    /role==='manager'/
  )

  assert.match(
    contentCampaign,
    /if\([^)]*canManage[^)]*\)\{\s*return null\s*\}/
  )
})

test('content campaign manager has one scoped update path',()=>{
  const writes=
    contentCampaign.match(
      /\.(?:insert|update|delete|upsert|rpc)\(/g
    ) ?? []

  assert.equal(
    writes.length,
    1
  )

  assert.match(
    contentCampaign,
    /\.from\('marketing_content'\)[\s\S]*?\.update\(\{\s*campaign_id:selectedCampaignId\s*\}\)[\s\S]*?\.eq\('id',selectedContentId\)[\s\S]*?\.is\('campaign_id',null\)[\s\S]*?\.select\('id,campaign_id'\)[\s\S]*?\.maybeSingle\(\)/
  )
})

test('content campaign binding prevents reassignment',()=>{
  const nullGuards=
    contentCampaign.match(
      /\.is\('campaign_id',null\)/g
    ) ?? []

  assert.equal(
    nullGuards.length,
    2
  )

  assert.match(
    contentCampaign,
    /Select unbound content/
  )

  assert.match(
    contentCampaign,
    /does not reassign/
  )

  assert.match(
    contentCampaign,
    /Content is no longer unbound/
  )
})

const contentCreator=fs.readFileSync(
  new URL(
    '../src/modules/MarketingContentCreatorManager.tsx',
    import.meta.url
  ),
  'utf8'
)

test('content creator management is wired into intelligence',()=>{
  assert.match(
    workspace,
    /import MarketingContentCreatorManager/
  )

  assert.match(
    workspace,
    /<MarketingContentCreatorManager[\s\S]*?role=\{profile\?\.role \?\? null\}[\s\S]*?\/>/
  )
})

test('only marketing and admin receive content creator controls',()=>{
  assert.match(
    contentCreator,
    /role==='marketing'/
  )

  assert.match(
    contentCreator,
    /role==='admin'/
  )

  assert.doesNotMatch(
    contentCreator,
    /role==='manager'/
  )

  assert.match(
    contentCreator,
    /if\(canManage===false\)\{\s*return null\s*\}/
  )
})

test('content creator manager has one scoped insert path',()=>{
  const writes=
    contentCreator.match(
      /\.(?:insert|update|delete|upsert|rpc)\(/g
    ) ?? []

  assert.equal(
    writes.length,
    1
  )

  assert.match(
    contentCreator,
    /\.from\('marketing_content_creators'\)[\s\S]*?\.insert\(\{[\s\S]*?campaign_id:selectedContent\.campaign_id,[\s\S]*?content_id:selectedContent\.id,[\s\S]*?campaign_creator_id:selectedAssignment\.id,[\s\S]*?relationship_role:draft\.relationship_role/
  )
})

test('content creator linking preserves same campaign integrity',()=>{
  assert.match(
    contentCreator,
    /const eligibleAssignments=/
  )

  assert.match(
    contentCreator,
    /item\.campaign_id===[\s\S]*?selectedContent\.campaign_id/
  )

  assert.match(
    contentCreator,
    /Creator assignment must belong to the content campaign/
  )

  assert.match(
    contentCreator,
    /Select same-campaign creator/
  )

  const draftStart=
    contentCreator.indexOf('type Draft={')

  const draftEnd=
    contentCreator.indexOf(
      '}\n\nconst relationshipRoles',
      draftStart
    )

  assert.ok(draftStart>=0)
  assert.ok(draftEnd>draftStart)

  const draftBlock=
    contentCreator.slice(
      draftStart,
      draftEnd
    )

  assert.doesNotMatch(
    draftBlock,
    /campaign_id:/
  )
})

test('content creator fields preserve validation and privacy boundaries',()=>{
  assert.match(
    contentCreator,
    /'primary'/
  )

  assert.match(
    contentCreator,
    /'collaborator'/
  )

  assert.match(
    contentCreator,
    /'featured'/
  )

  assert.match(
    contentCreator,
    /'paid_partner'/
  )

  assert.match(
    contentCreator,
    /normalizedPlatformContentId\.length>255/
  )

  assert.match(
    contentCreator,
    /\^https:/
  )

  assert.match(
    contentCreator,
    /maxLength=\{255\}/
  )

  assert.doesNotMatch(
    contentCreator,
    /\b(?:email|phone|whatsapp|mobile_number)\b/i
  )
})

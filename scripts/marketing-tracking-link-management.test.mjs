import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const manager=
  readFileSync(
    'src/modules/MarketingTrackingLinkManager.tsx',
    'utf8'
  )

const workspace=
  readFileSync(
    'src/modules/MarketingTeamWorkspace.tsx',
    'utf8'
  )

const intelligence=
  readFileSync(
    'src/modules/MarketingIntelligencePanel.tsx',
    'utf8'
  )

test(
  'tracking-link manager is wired into Marketing Intelligence',
  ()=>{
    assert.ok(
      workspace.includes(
        "import MarketingTrackingLinkManager"
      )
    )

    assert.match(
      workspace,
      /<MarketingTrackingLinkManager[\s\S]*?role=\{profile\?\.role \?\? null\}[\s\S]*?\/>/
    )

    assert.match(
      workspace,
      /<MarketingTrackingLinkManager[\s\S]*?<MarketingIntelligencePanel\/>/
    )
  }
)

test(
  'tracking-link write controls remain marketing and admin only',
  ()=>{
    assert.ok(
      manager.includes("role==='marketing'")
    )
    assert.ok(
      manager.includes("role==='admin'")
    )
    assert.ok(
      !manager.includes("role==='manager'")
    )
    assert.ok(
      manager.includes(
        'if(canManage===false)'
      )
    )
  }
)

test(
  'tracking-link manager has exactly one scoped write path',
  ()=>{
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
      /\.from\('marketing_tracking_links'\)[\s\S]*?\.insert\(/
    )
  }
)

test(
  'relationship selectors are derived from existing records',
  ()=>{
    assert.ok(
      manager.includes(
        'eligibleCampaignCreators='
      )
    )

    assert.ok(
      manager.includes(
        'eligibleContentCreators='
      )
    )

    assert.match(
      manager,
      /row\.campaign_id===campaignId/
    )

    assert.match(
      manager,
      /row\.campaign_creator_id===campaignCreatorId/
    )
  }
)

test(
  'tracking preview keeps persisted UTM values explicit',
  ()=>{
    assert.ok(
      manager.includes(
        'trackingUrlPreview='
      )
    )

    for(
      const field of [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term'
      ]
    ){
      assert.ok(
        manager.includes(field),
        `missing ${field}`
      )
    }
  }
)

test(
  'destination is restricted to HTTPS RideArrivo hosts',
  ()=>{
    assert.ok(
      manager.includes(
        "url.protocol!=='https:'"
      )
    )

    assert.ok(
      manager.includes(
        "hostname!=='ridearrivo.com'"
      )
    )

    assert.ok(
      manager.includes(
        "hostname.endsWith('.ridearrivo.com')"
      )
    )

    assert.ok(
      manager.includes(
        "url.search!==''"
      )
    )

    assert.ok(
      manager.includes(
        "url.hash!==''"
      )
    )
  }
)

test(
  'Marketing Intelligence dashboard remains strictly read only',
  ()=>{
    assert.doesNotMatch(
      intelligence,
      /\.(?:insert|update|delete|upsert|rpc)\(/
    )
  }
)

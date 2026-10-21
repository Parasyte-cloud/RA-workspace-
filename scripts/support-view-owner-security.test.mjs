import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'supabase/migrations/20261019200000_support_command_centre_core.sql',
  'supabase/migrations/20261019210000_support_voice_taskrouter.sql',
  'supabase/migrations/20261020100000_support_telephony_controls.sql',
  'supabase/migrations/20261020200000_support_workstation_safety.sql',
]

const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')

const views = [
  'support_active_calls_view',
  'support_agent_presence_view',
  'support_callbacks_view',
  'support_channel_stats_view',
  'support_incident_board_view',
  'support_kpi_today_view',
  'support_queue_snapshot_view',
  'support_telephony_health_view',
  'support_ticket_summary_view',
]

for (const view of views) {
  const start = source.search(
    new RegExp(`create\\s+view\\s+public\\.${view}\\s+as`, 'i')
  )

  assert.notEqual(start, -1, `${view} definition must exist`)

  const tail = source.slice(start)
  const nextView = tail.slice(1).search(/\bcreate\s+view\s+public\./i)
  const definition =
    nextView === -1 ? tail : tail.slice(0, nextView + 1)

  assert.match(
    definition,
    /support_is_(staff|supervisor)\s*\(\s*auth\.uid\(\)\s*\)/i,
    `${view} must explicitly authorize the caller`
  )
}

const hardening = fs.readFileSync(
  'supabase/migrations/20261021124000_support_views_security_barrier.sql',
  'utf8'
)

for (const view of views) {
  assert.match(
    hardening,
    new RegExp(
      `alter\\s+view\\s+public\\.${view}[\\s\\S]*?security_barrier\\s*=\\s*true`,
      'i'
    ),
    `${view} must use security_barrier`
  )

  assert.match(
    hardening,
    new RegExp(
      `revoke\\s+all\\s+on\\s+public\\.${view}\\s+from\\s+anon\\s*,\\s*public`,
      'i'
    ),
    `${view} must remain inaccessible to anon/public`
  )
}

console.log('support owner-view security checks passed')

import {
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'

const send =
  readFileSync(
    'supabase/functions/whatsapp-send/index.ts',
    'utf8',
  )

const webhook =
  readFileSync(
    'supabase/functions/whatsapp-webhook/index.ts',
    'utf8',
  )

const config =
  readFileSync(
    'supabase/config.toml',
    'utf8',
  )

const migrationDir =
  'supabase/migrations'

const migrations =
  readdirSync(migrationDir)
    .filter(name => name.endsWith('.sql'))
    .map(name =>
      readFileSync(
        join(migrationDir, name),
        'utf8',
      ),
    )
    .join('\n')

let pass = 0
let fail = 0

function check(name, condition) {
  if (condition) {
    console.log(`PASS: ${name}`)
    pass += 1
  } else {
    console.log(`FAIL: ${name}`)
    fail += 1
  }
}

const sendConfig =
  config.match(
    /\[functions\.whatsapp-send\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1] || ''

const webhookConfig =
  config.match(
    /\[functions\.whatsapp-webhook\]([\s\S]*?)(?=\n\[|$)/,
  )?.[1] || ''

check(
  'outbound send requires Supabase JWT verification',
  /verify_jwt\s*=\s*true/.test(sendConfig),
)

check(
  'Meta webhook remains externally callable',
  /verify_jwt\s*=\s*false/.test(webhookConfig),
)

check(
  'outbound send authenticates employee session',
  /Authorization/.test(send)
    && /auth\.getUser|getUser\(/.test(send),
)

check(
  'outbound send authorises Support role or workstation',
  /employee_profiles/.test(send)
    && /workspace_workstation_assignments/.test(send),
)

check(
  'caller cannot supply arbitrary WhatsApp destination',
  !/\{\s*conversationId\s*,\s*to\s*,/.test(send),
)

check(
  'webhook verifies Meta signature header',
  /x-hub-signature-256/i.test(webhook),
)

check(
  'webhook uses Meta application secret',
  /WHATSAPP_APP_SECRET/.test(webhook),
)

check(
  'webhook performs HMAC verification',
  /HMAC|crypto\.subtle/i.test(webhook),
)

check(
  'conversation persistence migration exists',
  /support_whatsapp_conversations/.test(migrations),
)

check(
  'message persistence migration exists',
  /support_whatsapp_messages/.test(migrations),
)

check(
  'WhatsApp message identifier is idempotent',
  /whatsapp_message_id[\s\S]{0,160}(unique|UNIQUE)/i
    .test(migrations)
    || /unique[\s\S]{0,160}whatsapp_message_id/i
      .test(migrations),
)

console.log(`WHATSAPP_SECURITY_PASS=${pass}`)
console.log(`WHATSAPP_SECURITY_FAIL=${fail}`)

if (fail !== 0) process.exit(1)

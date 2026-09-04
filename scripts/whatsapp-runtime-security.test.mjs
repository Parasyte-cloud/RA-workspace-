import fs from "node:fs"

const send =
  fs.readFileSync(
    "supabase/functions/whatsapp-send/index.ts",
    "utf8",
  )

const webhook =
  fs.readFileSync(
    "supabase/functions/whatsapp-webhook/index.ts",
    "utf8",
  )

const config =
  fs.readFileSync(
    "supabase/config.toml",
    "utf8",
  )

const migration =
  fs.readFileSync(
    "supabase/migrations/20260903144500_whatsapp_meta_security.sql",
    "utf8",
  )

let pass = 0
let fail = 0

function check(name, ok) {
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${name}`,
  )

  if (ok) pass += 1
  else fail += 1
}

const raw = webhook.indexOf("req.text")
const parse = webhook.indexOf("JSON.parse")
const signature =
  webhook.indexOf("x-hub-signature-256")
const secret =
  webhook.indexOf("WHATSAPP_APP_SECRET")

check(
  "webhook reads raw request body",
  raw >= 0,
)

check(
  "signature checked before JSON parsing",
  signature >= 0 &&
    parse >= 0 &&
    signature < parse,
)

check(
  "app secret used before JSON parsing",
  secret >= 0 &&
    parse >= 0 &&
    secret < parse,
)

check(
  "HMAC verification exists",
  /HMAC|crypto\.subtle|hmac/i.test(webhook),
)

check(
  "send authenticates employee",
  /auth\.getUser/.test(send),
)

check(
  "send resolves persisted conversation",
  /support_whatsapp_conversations/.test(send),
)

check(
  "send derives wa_id server-side",
  /wa_id/.test(send),
)

check(
  "caller cannot directly supply destination",
  !/payload\??\.to\b/.test(send),
)

const sendConfig =
  config.match(
    /\[functions\.whatsapp-send\][\s\S]*?(?=\n\[|$)/,
  )?.[0] || ""

const webhookConfig =
  config.match(
    /\[functions\.whatsapp-webhook\][\s\S]*?(?=\n\[|$)/,
  )?.[0] || ""

check(
  "outbound JWT verification enabled",
  /verify_jwt\s*=\s*true/.test(sendConfig),
)

check(
  "Meta webhook JWT verification disabled",
  /verify_jwt\s*=\s*false/.test(webhookConfig),
)

check(
  "message id has unique persistence",
  /unique[\s\S]{0,250}whatsapp_message_id|whatsapp_message_id[\s\S]{0,250}unique/i
    .test(migration),
)

console.log(
  `WHATSAPP_RUNTIME_PASS=${pass}`,
)

console.log(
  `WHATSAPP_RUNTIME_FAIL=${fail}`,
)

if (fail) process.exitCode = 1

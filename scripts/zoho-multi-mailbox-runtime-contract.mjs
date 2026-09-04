import fs from "node:fs"

const read = path => fs.readFileSync(path, "utf8")

const sharedPath =
  "supabase/functions/_shared/zoho.ts"

const functions = {
  inbox:
    "supabase/functions/zoho-mail-inbox/index.ts",
  folders:
    "supabase/functions/zoho-mail-folders/index.ts",
  folderMessages:
    "supabase/functions/zoho-mail-folder-messages/index.ts",
  message:
    "supabase/functions/zoho-mail-message/index.ts",
  send:
    "supabase/functions/zoho-mail-send/index.ts",
  status:
    "supabase/functions/zoho-mail-status/index.ts",
}

for (const path of [
  sharedPath,
  ...Object.values(functions),
]) {
  if (!fs.existsSync(path)) {
    console.error(`FAIL: missing ${path}`)
    process.exit(1)
  }
}

const shared = read(sharedPath)

const sources = Object.fromEntries(
  Object.entries(functions)
    .map(([name, path]) => [
      name,
      read(path),
    ]),
)

let passed = 0
let failed = 0

function check(name, condition) {
  if (condition) {
    console.log(`PASS: ${name}`)
    passed += 1
  } else {
    console.log(`FAIL: ${name}`)
    failed += 1
  }
}

console.log(
  "Zoho multi-mailbox runtime security contract:",
)

check(
  "shared helper accepts internal mailbox UUID",
  /mailboxId|mailbox_id/.test(shared),
)

check(
  "shared helper uses server-only mailbox resolver",
  /resolve_zoho_mailbox_connection/.test(shared),
)

check(
  "shared helper authenticates Workspace JWT",
  /auth\.getUser/.test(shared),
)

check(
  "shared helper passes authenticated employee UUID to mailbox resolver",
  /p_employee_id\s*:\s*userId/.test(shared),
)

check(
  "shared helper does not read legacy connection by user alone",
  !/from\(["']zoho_mail_connections["']\)[\s\S]{0,1000}\.eq\(["']user_id["']/.test(
    shared,
  ),
)

for (const [name, source] of Object.entries(
  sources,
)) {
  check(
    `${name} uses an internal mailbox identifier`,
    /mailboxId|mailbox_id/.test(source),
  )
}

for (const name of [
  "inbox",
  "folders",
  "folderMessages",
  "message",
  "send",
]) {
  const source = sources[name]

  check(
    `${name} does not accept provider accountId from the caller`,
    !/(?:body|payload|searchParams|url\.searchParams)[\s\S]{0,400}(?:accountId|account_id)/.test(
      source,
    ),
  )
}

check(
  "send accepts an internal sender identity UUID",
  /identityId|identity_id/.test(sources.send),
)

check(
  "send resolves sender identity server-side",
  /resolve_zoho_send_identity/.test(
    sources.send + shared,
  ),
)

check(
  "send does not trust caller supplied From address",
  !/payload\?\.(?:fromAddress|from_address)/.test(sources.send) &&
    /fromAddress\s*:\s*senderIdentity\.email_address/.test(
      sources.send,
    ),
)

check(
  "status supports returning multiple entitled mailboxes",
  /mailboxes|zoho_mailboxes|zoho_mailbox_access/.test(
    sources.status,
  ),
)


for (const name of [
  "inbox",
  "folders",
  "folderMessages",
  "message",
]) {
  check(
    `${name} exact mailbox capability propagation`,
    /getZohoConnection\([\s\S]{0,500}user\.id[\s\S]{0,200}mailboxId[\s\S]{0,120}["']read["']/.test(
      sources[name],
    ),
  )
}

check(
  "send exact mailbox capability propagation",
  /getZohoConnection\([\s\S]{0,500}user\.id[\s\S]{0,200}mailboxId[\s\S]{0,120}["']send["']/.test(
    sources.send,
  ),
)

check(
  "send identity resolution remains employee scoped",
  /resolve_zoho_send_identity[\s\S]{0,900}p_employee_id\s*:\s*user\.id[\s\S]{0,400}p_mailbox_id\s*:\s*mailboxId[\s\S]{0,400}p_identity_id\s*:\s*identityId/.test(
    sources.send,
  ),
)

check(
  "status entitlement lookup is employee scoped",
  /from\(["']zoho_mailbox_access["']\)[\s\S]{0,900}eq\(["']employee_id["']\s*,\s*user\.id\)/.test(
    sources.status,
  ),
)

check(
  "status mailbox metadata is restricted to entitled ids",
  /from\(["']zoho_mailboxes["']\)[\s\S]{0,900}\.in\(["']id["']\s*,\s*mailboxIds\)/.test(
    sources.status,
  ),
)

check(
  "OAuth access and refresh tokens are not returned in normal mail responses",
  Object.entries(sources).every(
    ([name, source]) =>
      name === "status"
        ? !/JSON\.stringify\([^)]*(?:refresh_token|access_token)/.test(
            source,
          )
        : !/JSON\.stringify\([^)]*(?:refresh_token|access_token)/.test(
            source,
          ),
  ),
)

console.log(
  `ZOHO_MULTI_MAILBOX_RUNTIME_PASS=${passed}`,
)
console.log(
  `ZOHO_MULTI_MAILBOX_RUNTIME_FAIL=${failed}`,
)

if (failed > 0) {
  process.exitCode = 1
}

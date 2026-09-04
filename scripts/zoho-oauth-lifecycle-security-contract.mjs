import fs from "node:fs"

const config =
  fs.readFileSync(
    "supabase/config.toml",
    "utf8",
  )

const authUrl =
  fs.readFileSync(
    "supabase/functions/zoho-mail-auth-url/index.ts",
    "utf8",
  )

const callback =
  fs.readFileSync(
    "supabase/functions/zoho-mail-callback/index.ts",
    "utf8",
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

function functionConfig(name) {
  const escaped =
    name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )

  const match =
    config.match(
      new RegExp(
        `\\[functions\\.${escaped}\\]` +
        `([\\s\\S]*?)` +
        `(?=\\n\\[|$)`,
      ),
    )

  return match?.[1] || ""
}

const authConfig =
  functionConfig(
    "zoho-mail-auth-url",
  )

const callbackConfig =
  functionConfig(
    "zoho-mail-callback",
  )

check(
  "OAuth Auth URL explicitly requires JWT verification",
  /verify_jwt\s*=\s*true/.test(
    authConfig,
  ),
)

check(
  "OAuth callback is explicitly public at the gateway",
  /verify_jwt\s*=\s*false/.test(
    callbackConfig,
  ),
)

const authGetUser =
  authUrl.indexOf(
    "admin.auth.getUser(token)",
  )

const stateInsert =
  authUrl.indexOf(
    '.from("zoho_oauth_states")',
  )

check(
  "OAuth initiation authenticates employee before state creation",
  authGetUser >= 0 &&
    stateInsert >= 0 &&
    authGetUser < stateInsert,
)

check(
  "OAuth state is server generated, employee bound and expiring",
  /crypto\.randomUUID\(\)/.test(
    authUrl,
  ) &&
    /user_id\s*:\s*user\.id/.test(
      authUrl,
    ) &&
    /expires_at\s*:\s*expiresAt/.test(
      authUrl,
    ),
)

const firstProviderFetch =
  callback.indexOf("fetch(")

const atomicConsume =
  /\.from\(["']zoho_oauth_states["']\)[\s\S]{0,300}\.delete\(\)[\s\S]{0,300}\.eq\(["']state["']\s*,\s*state\)[\s\S]{0,400}\.(?:gt|gte)\(["']expires_at["']/.test(
    callback,
  )

const consumePosition =
  callback.indexOf(
    ".delete()",
    callback.indexOf(
      "zoho_oauth_states",
    ),
  )

check(
  "OAuth state is atomically consumed before provider exchange",
  atomicConsume &&
    consumePosition >= 0 &&
    firstProviderFetch >= 0 &&
    consumePosition < firstProviderFetch,
)

check(
  "OAuth callback does not persist into legacy connection table",
  !/\.from\(["']zoho_mail_connections["']\)/.test(
    callback,
  ),
)

check(
  "OAuth callback persists through new multi-mailbox control plane",
  /complete_zoho_mail_oauth_connection/.test(
    callback,
  ) ||
    (
      /zoho_mail_oauth_connections/.test(
        callback,
      ) &&
      /zoho_mailboxes/.test(
        callback,
      ) &&
      /zoho_mailbox_identities/.test(
        callback,
      ) &&
      /zoho_mailbox_access/.test(
        callback,
      )
    ),
)

check(
  "OAuth owner comes from consumed state rather than caller input",
  /stateRow\.user_id/.test(
    callback,
  ) &&
    !/searchParams\.get\(["'](?:user|user_id|employee_id)["']\)/.test(
      callback,
    ),
)

check(
  "OAuth callback does not dump raw token response to logs",
  !/console\.(?:log|error)\(\s*tokenData\s*\)/.test(
    callback,
  ),
)

console.log(
  `ZOHO_OAUTH_SECURITY_PASS=${passed}`,
)

console.log(
  `ZOHO_OAUTH_SECURITY_FAIL=${failed}`,
)

if (failed > 0) {
  process.exitCode = 1
}

import fs from "node:fs"

const path =
  "supabase/migrations/20260903143000_marketing_wallet_governance.sql"

const sql = fs.readFileSync(path, "utf8")

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

const requiredFunctions = [
  "marketing_wallet_submit_funding_request",
  "marketing_wallet_review_funding_request",
  "marketing_wallet_final_approve_funding_request",
  "marketing_wallet_confirm_funding",
  "marketing_wallet_submit_payment_request",
  "marketing_wallet_final_approve_payment_request",
  "marketing_wallet_begin_bank_transfer",
  "marketing_wallet_settle_bank_transfer",
  "marketing_wallet_fail_bank_transfer",
]

console.log(
  "Marketing Wallet state-machine security contract:",
)

for (const name of requiredFunctions) {
  check(
    `${name} exists`,
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`,
      "i",
    ).test(sql),
  )
}

check(
  "state transitions use SECURITY DEFINER control plane",
  (
    sql.match(/security\s+definer/gi) || []
  ).length >= requiredFunctions.length,
)

check(
  "state transitions pin a safe search_path",
  /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i.test(
    sql,
  ),
)

check(
  "funding workflow contains finance review",
  /finance_review/i.test(sql),
)

check(
  "funding workflow contains executive approval",
  /executive_approval/i.test(sql),
)

check(
  "funding cannot become funded without confirmation path",
  /funding_in_progress/i.test(sql) &&
    /\bfunded\b/i.test(sql),
)

check(
  "payment workflow contains approved-for-transfer state",
  /approved_for_transfer/i.test(sql),
)

check(
  "payment workflow contains transfer-in-progress state",
  /transfer_in_progress/i.test(sql),
)

check(
  "payment settlement uses reserved balance",
  /reserved_delta/i.test(sql) &&
    /vendor_settlement/i.test(sql),
)

check(
  "failed transfer can release reservation",
  /reservation_release/i.test(sql),
)

check(
  "wallet mutations use row locking",
  /for\s+update/i.test(sql),
)

check(
  "actor identity is derived from auth.uid",
  /auth\.uid\s*\(\s*\)/i.test(sql),
)

check(
  "explicit operator authority remains required",
  /operator/i.test(sql) &&
    /marketing_wallet_has_authority/i.test(sql),
)

check(
  "explicit final approver authority remains required",
  /final_approver/i.test(sql) &&
    /marketing_wallet_has_authority/i.test(sql),
)

check(
  "finance authority remains a separate helper",
  /marketing_wallet_is_finance/i.test(sql),
)

check(
  "idempotency remains part of governed requests",
  /idempotency_key/i.test(sql),
)

check(
  "external transfer execution remains Providus-scoped",
  /provider[^,\n]*providus/i.test(sql),
)

console.log(
  `MARKETING_WALLET_STATE_MACHINE_PASS=${passed}`,
)

console.log(
  `MARKETING_WALLET_STATE_MACHINE_FAIL=${failed}`,
)

if (failed > 0) {
  process.exitCode = 1
}

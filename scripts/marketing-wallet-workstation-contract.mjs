import fs from 'node:fs'

const workspace=
  fs.readFileSync(
    'src/modules/MarketingTeamWorkspace.tsx',
    'utf8'
  )

const panel=
  fs.readFileSync(
    'src/modules/MarketingWalletPanel.tsx',
    'utf8'
  )

const css=
  fs.readFileSync(
    'src/marketing-wallet.css',
    'utf8'
  )

const migration=
  fs.readFileSync(
    'supabase/migrations/20260904172000_marketing_wallet_workstation_bootstrap.sql',
    'utf8'
  )

const governance=
  fs.readFileSync(
    'supabase/migrations/20260903143000_marketing_wallet_governance.sql',
    'utf8'
  )

let passed=0
let failed=0

function check(name,condition){
  if(condition){
    console.log(`PASS: ${name}`)
    passed+=1
  }else{
    console.log(`FAIL: ${name}`)
    failed+=1
  }
}

console.log(
  'Marketing Wallet workstation contract:'
)

check(
  'Marketing View includes wallet',
  workspace.includes(
    "| 'wallet'"
  )
)

check(
  'Marketing workspace imports wallet panel',
  workspace.includes(
    "import MarketingWalletPanel from './MarketingWalletPanel'"
  )
)

check(
  'Marketing workspace exposes visible Wallet tab',
  workspace.includes(
    "view==='wallet'"
  ) &&
  workspace.includes(
    '<WalletCards size={16}/>'
  )
)

check(
  'Marketing wallet panel is rendered',
  workspace.includes(
    '<MarketingWalletPanel/>'
  )
)

check(
  'wallet metrics derive from ledger deltas',
  panel.includes(
    'entry.available_delta'
  ) &&
  panel.includes(
    'entry.reserved_delta'
  )
)

check(
  'funding uses governed funding RPC',
  panel.includes(
    "'marketing_wallet_submit_funding_request'"
  )
)

check(
  'payment uses governed payment RPC',
  panel.includes(
    "'marketing_wallet_submit_payment_request'"
  )
)

check(
  'funding request uses idempotency',
  /marketing_wallet_submit_funding_request[\s\S]{0,900}crypto\.randomUUID\(\)/.test(
    panel
  )
)

check(
  'payment request uses idempotency',
  /marketing_wallet_submit_payment_request[\s\S]{0,900}crypto\.randomUUID\(\)/.test(
    panel
  )
)

check(
  'Marketing cannot invoke final funding approval',
  !panel.includes(
    'marketing_wallet_final_approve_funding_request'
  )
)

check(
  'Marketing cannot confirm funding',
  !panel.includes(
    'marketing_wallet_confirm_funding'
  )
)

check(
  'Marketing cannot invoke final payment approval',
  !panel.includes(
    'marketing_wallet_final_approve_payment_request'
  )
)

check(
  'Marketing cannot begin bank transfer',
  !panel.includes(
    'marketing_wallet_begin_bank_transfer'
  )
)

check(
  'Marketing cannot settle bank transfer',
  !panel.includes(
    'marketing_wallet_settle_bank_transfer'
  )
)

check(
  'Marketing cannot fail bank transfer',
  !panel.includes(
    'marketing_wallet_fail_bank_transfer'
  )
)

check(
  'Marketing UI performs no direct wallet table insert',
  !/\.from\(\s*['"]marketing_wallet_[^'"]+['"]\s*\)[\s\S]{0,120}\.insert\(/.test(
    panel
  )
)

check(
  'Marketing UI performs no direct wallet table update',
  !/\.from\(\s*['"]marketing_wallet_[^'"]+['"]\s*\)[\s\S]{0,120}\.update\(/.test(
    panel
  )
)

check(
  'Marketing UI performs no direct wallet table delete',
  !/\.from\(\s*['"]marketing_wallet_[^'"]+['"]\s*\)[\s\S]{0,120}\.delete\(/.test(
    panel
  )
)

check(
  'only verified vendors are offered for payment',
  panel.includes(
    "vendor.verification_status==='verified'"
  )
)

check(
  'Marketing does not capture arbitrary beneficiary bank account',
  !/bank_account_reference|account_number|routing_number/i.test(
    panel
  )
)

check(
  'Marketing workstation contains no provider secret',
  !/PAYSTACK_SECRET|FLUTTERWAVE_SECRET|PROVIDUS_SECRET|SECRET_KEY/i.test(
    panel
  )
)

check(
  'Marketing workstation directly contacts no payment provider',
  !/api\.paystack|api\.flutterwave|providusbank|providus\.com/i.test(
    panel
  )
)

check(
  'bootstrap creates wallet only when active wallet absent',
  migration.includes(
    'if v_wallet_id is null then'
  )
)

check(
  'bootstrap never creates wallet balance directly',
  !migration.includes(
    'marketing_wallet_ledger'
  )
)

check(
  'bootstrap grants operator only to active Marketing staff',
  migration.includes(
    "'operator'"
  ) &&
  migration.includes(
    'p.active=true'
  ) &&
  migration.includes(
    "lower(coalesce(p.role,''))='marketing'"
  )
)

check(
  'bootstrap grants final approver only to active Manager/Admin',
  migration.includes(
    "'final_approver'"
  ) &&
  migration.includes(
    "'manager'"
  ) &&
  migration.includes(
    "'admin'"
  )
)

check(
  'bootstrap does not grant Finance authority',
  !migration.includes(
    "'finance_reviewer'"
  )
)

check(
  'governance requires operator authority',
  governance.includes(
    "'Marketing Wallet operator authority is required'"
  )
)

check(
  'governance derives actor from auth uid',
  governance.includes(
    'auth.uid()'
  )
)

check(
  'responsive wallet stylesheet exists',
  css.includes(
    '.marketingWalletMetrics'
  ) &&
  css.includes(
    '@media'
  )
)

console.log(
  `MARKETING_WALLET_WORKSTATION_PASS=${passed}`
)

console.log(
  `MARKETING_WALLET_WORKSTATION_FAIL=${failed}`
)

if(failed>0){
  process.exitCode=1
}

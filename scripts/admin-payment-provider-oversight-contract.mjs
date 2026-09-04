import fs from 'node:fs'

const admin=
  fs.readFileSync(
    'src/modules/AdministrationControlPlane.tsx',
    'utf8'
  )

const panel=
  fs.readFileSync(
    'src/modules/FinancePaymentsPanel.tsx',
    'utf8'
  )

const edge=
  fs.readFileSync(
    'supabase/functions/finance-payments/index.ts',
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
  'Administration payment-provider oversight contract:'
)

check(
  'Admin imports shared Finance payment panel',
  admin.includes(
    "import FinancePaymentsPanel from './FinancePaymentsPanel'"
  )
)

check(
  'AdminTab includes payments',
  admin.includes(
    "| 'payments'"
  )
)

check(
  'Administration exposes visible Payments tab',
  admin.includes(
    "['payments','Payments',CreditCard]"
  )
)

check(
  'Administration renders payment panel in admin context',
  admin.includes(
    '<FinancePaymentsPanel context="admin"/>'
  )
)

check(
  'Finance payment panel remains reusable',
  panel.includes(
    "context?:'finance'|'admin'"
  ) &&
  panel.includes(
    "context='finance'"
  )
)

check(
  'Finance wording remains available',
  panel.includes(
    'inside the Finance workstation'
  )
)

check(
  'Administration wording is available',
  panel.includes(
    'Administration oversight'
  )
)

check(
  'backend explicitly authorises Admin',
  edge.includes(
    '["finance", "manager", "admin"].includes(role)'
  )
)

check(
  'backend requires authenticated RideArrivo session',
  edge.includes(
    'Missing RideArrivo session.'
  ) &&
  edge.includes(
    'admin.auth.getUser(token)'
  )
)

check(
  'backend requires active employee',
  edge.includes(
    'Active employee access is required.'
  )
)

check(
  'payment provider secrets remain server-side',
  edge.includes(
    'Deno.env.get("PAYSTACK_SECRET_KEY")'
  ) &&
  edge.includes(
    'Deno.env.get("FLUTTERWAVE_SECRET_KEY")'
  ) &&
  !panel.includes(
    'PAYSTACK_SECRET_KEY'
  ) &&
  !panel.includes(
    'FLUTTERWAVE_SECRET_KEY'
  )
)

check(
  'shared panel still calls only finance-payments Edge Function',
  panel.includes(
    "'finance-payments'"
  )
)

check(
  'Admin UI exposes no refund action',
  !/refund/i.test(
    admin
  ) ||
  !/refund.*button|button.*refund/i.test(
    admin
  )
)

check(
  'Admin UI exposes no payout action',
  !/payout.*button|button.*payout/i.test(
    admin
  )
)

check(
  'Admin UI exposes no transfer execution action',
  !/execute.*transfer|transfer.*execute/i.test(
    admin
  )
)

console.log(
  `ADMIN_PAYMENT_OVERSIGHT_PASS=${passed}`
)

console.log(
  `ADMIN_PAYMENT_OVERSIGHT_FAIL=${failed}`
)

if(failed>0){
  process.exitCode=1
}

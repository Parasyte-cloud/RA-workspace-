import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/migrations/20261024140000_support_complaints_approvals_reports.sql')
const lib = read('src/lib/supportCommandCentre.ts')
const centre = read('src/modules/SupportCommandCentre.tsx')
const drawer = read('src/modules/SupportTicketDrawer.tsx')
const insights = read('src/modules/SupportInsights.tsx')

test('every RPC the UI calls exists in the migration', () => {
  const called = [...lib.matchAll(/'(support_[a-z_]+)'/g)].map((m) => m[1])
  const newOnes = ['support_complaints_list', 'support_raise_complaint', 'support_complaint_detail', 'support_update_complaint', 'support_approvals_list', 'support_request_approval',
    'support_decide_approval', 'support_cancel_approval', 'support_mark_compensation_paid', 'support_request_merge', 'support_customer_duplicates', 'support_edit_customer', 'support_report_complaints']
  for (const fn of newOnes) {
    assert.ok(called.includes(fn), `${fn} wrapped in lib`)
    assert.match(sql, new RegExp(`function public\\.${fn}\\(`), `${fn} defined`)
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(`), `${fn} granted`)
  }
})

test('approval rules stay server-side', () => {
  assert.match(sql, /support_approvals/)
  assert.match(sql, /raise exception 'you cannot decide your own request'|own request/i)
  assert.doesNotMatch(lib, /support_apply_approval/)
})

test('tabs are wired and notifications can jump to approvals', () => {
  assert.match(centre, /'complaints', 'approvals'\]\.includes/)
  assert.match(centre, /SupportApprovalsTab/)
  assert.match(centre, /SupportComplaintsTab/)
  assert.match(drawer, /SupportComplaintPanel/)
  assert.match(insights, /ComplaintReports/)
})

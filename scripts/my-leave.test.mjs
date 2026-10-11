import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261012150000_my_leave.sql', 'utf8')
const leave = readFileSync('src/components/MyLeave.tsx', 'utf8')
const profile = readFileSync('src/modules/ProfileModule.tsx', 'utf8')
const center = readFileSync('src/components/NotificationCenter.tsx', 'utf8')

test('leave lives on My Profile with a list of the person\'s own requests', () => {
  assert.match(profile, /<MyLeave\/>/)
  assert.match(leave, /\.eq\('employee_id', auth\.user\.id\)/)
  assert.match(leave, /Waiting for approval/)
})

test('only the owner can cancel, and only while pending', () => {
  assert.match(sql, /row\.employee_id is distinct from auth\.uid\(\)/)
  assert.match(sql, /row\.status <> 'pending'/)
  assert.match(leave, /rpc\('cancel_leave_request'/)
})

test('approvers are told of requests and the requester of the decision', () => {
  assert.match(sql, /'leave_request_pending'/)
  assert.match(sql, /new\.approver_id is null/)
  assert.match(center, /entity_type==='leave_request'/)
})

test('anon cannot cancel', () => {
  assert.match(sql, /revoke all on function public\.cancel_leave_request\(uuid\) from public, anon/)
})

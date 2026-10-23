import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const read = (p) => fs.readFileSync(p, 'utf8')

test('anyone can ask anyone for task approval, and the approver can open the task', () => {
  const sqlA = read('supabase/migrations/20261023210000_task_approval_anyone.sql')
  assert.equal((sqlA.match(/not public\.can_read_work_item\(target_work_item\)/g) || []).length, 2)
  assert.doesNotMatch(sqlA, /is_department_head_of_work/)
  assert.match(sqlA, /insert into public\.work_item_watchers\(work_item_id,user_id,added_by\)\s+values\(target_work_item,target_approver,actor\)/)
  assert.match(read('src/modules/WorkItemDetail.tsx'), /const canRequestApproval=true/)
})

test('task attachments take several files, drops, pastes and show image previews', () => {
  const ui = read('src/modules/WorkItemDetail.tsx')
  assert.match(ui, /type="file"\s+multiple/)
  assert.match(ui, /onDrop=/)
  assert.match(ui, /onPaste=/)
  assert.match(ui, /createSignedUrls/)
  assert.match(ui, /MAX_ATTACHMENT_BYTES=15\*1024\*1024/)
})

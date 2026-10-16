import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(p, 'utf8')

test('every mail call is scoped to the mailbox on screen, except connect and status', () => {
  const mail = read('src/modules/MailModule.tsx')
  assert.match(mail, /mailboxRef\.current/)
  assert.match(mail, /name!=='zoho-mail-auth-url' && name!=='zoho-mail-status'/)
  assert.match(mail, /mailboxId:mailboxRef\.current/)
  assert.match(mail, /mailboxes\.length>1/)
})

test('the mailbox admin screen is admin only and calls the guarded functions', () => {
  const ui = read('src/components/MailboxAdmin.tsx')
  assert.match(ui, /if \(!data\?\.is_admin\) return null/)
  assert.match(ui, /admin_zoho_mailbox_overview/)
  assert.match(ui, /admin_set_zoho_mailbox_access/)
  const sql = read('supabase/migrations/20261016280000_zoho_mailbox_admin.sql')
  assert.match(sql, /not public\.zoho_mailbox_is_admin\(\)/)
  assert.match(sql, /at most 10 mailboxes/)
  assert.match(sql, /revoke all on function public\.admin_set_zoho_mailbox_access[^;]*from public, anon/)
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/)
})

test('email alerts cover up to 10 mailboxes per person', () => {
  assert.match(read('supabase/functions/mail-notify-poll/index.ts'), /MAX_MAILBOXES_PER_PERSON = 10/)
})

test('the sign-in screen and Settings both offer keep me signed in', () => {
  assert.match(read('src/App.tsx'), /Keep me signed in on this device/)
  assert.match(read('src/modules/NotificationSettings.tsx'), /moveSession\(/)
  assert.match(read('src/lib/supabase.ts'), /createAuthStorage\(window\.localStorage, window\.sessionStorage\)/)
})

test('admins can connect another mailbox, and the return from Zoho lands on Mail with a notice', () => {
  assert.match(read('src/components/MailboxAdmin.tsx'), /Connect another mailbox/)
  assert.match(read('src/modules/MailModule.tsx'), /Mailbox connected\./)
  assert.match(read('src/App.tsx'), /query\.has\('mail'\) \? 'mail'/)
})

test('a request that never reaches a mail function names the function', () => {
  assert.match(read('src/modules/MailModule.tsx'), /did not respond\. Try Refresh/)
})

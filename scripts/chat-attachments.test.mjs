import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/chatAttachments.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const A = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const sql = readFileSync('supabase/migrations/20261012210000_chat_attachments.sql', 'utf8')
const ui = readFileSync('src/modules/ChatModule.tsx', 'utf8')

const file = (name, size, type) => ({ name, size, type })

test('common documents and images are accepted, even when the browser gives no type', () => {
  assert.equal(A.validateAttachment(file('a.png', 10, 'image/png')).ok, true)
  assert.equal(A.validateAttachment(file('report.pdf', 10, 'application/pdf')).ok, true)
  assert.equal(A.validateAttachment(file('sheet.csv', 10, '')).mime, 'text/csv')
  assert.equal(A.validateAttachment(file('plan.docx', 10, '')).mime.includes('wordprocessingml'), true)
})

test('programs, scripts, SVG and HTML are refused', () => {
  for (const name of ['setup.exe', 'run.sh', 'x.bat', 'page.html', 'pic.svg', 'tool.js', 'app.dmg'])
    assert.equal(A.validateAttachment(file(name, 10, '')).ok, false, name)
  assert.equal(A.validateAttachment(file('x.png', 10, 'application/x-msdownload')).ok, true) // extension wins, content-type is set from our own list on upload
})

test('empty files and files over 25 MB are refused with a plain reason', () => {
  assert.match(A.validateAttachment(file('a.pdf', 0, 'application/pdf')).reason, /empty/)
  assert.match(A.validateAttachment(file('a.pdf', 25 * 1024 * 1024 + 1, 'application/pdf')).reason, /25 MB/)
  assert.equal(A.validateAttachment(file('a.pdf', 25 * 1024 * 1024, 'application/pdf')).ok, true)
})

test('storage names are boring and stay inside <conversation>/<sender>/', () => {
  assert.equal(A.safeFileName('../../etc/pass wd?.pdf'), 'etc_pass_wd_.pdf')
  assert.equal(A.safeFileName('Résumé final.docx'), 'Resume_final.docx')
  assert.equal(A.safeFileName('///'), 'file')
  assert.ok(A.safeFileName('x'.repeat(200) + '.pdf').length <= 80)
  assert.ok(A.safeFileName('x'.repeat(200) + '.pdf').endsWith('.pdf'))
  const path = A.attachmentPath('c1', 'u1', 'r1', '../evil.pdf')
  assert.equal(path.split('/').length, 3)
  assert.ok(path.startsWith('c1/u1/'))
})

test('lists, replies and notifications describe a file instead of showing nothing', () => {
  assert.equal(A.messagePreview({ body: 'hi', attachment_name: 'a.png' }), 'hi')
  assert.equal(A.messagePreview({ body: '', attachment_name: 'a.png', attachment_mime: 'image/png' }), 'Photo')
  assert.equal(A.messagePreview({ body: '', attachment_name: 'q.xlsx', attachment_mime: 'application/vnd.ms-excel' }), 'File: q.xlsx')
  assert.equal(A.formatBytes(2048), '2 KB')
  assert.equal(A.formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('the bucket is private and the type list matches the app', () => {
  assert.match(sql, /'chat-attachments',\s*'chat-attachments',\s*false/)
  assert.match(sql, /26214400/)
  for (const type of A.ALLOWED_ATTACHMENT_TYPES) assert.ok(sql.includes(`'${type}'`), type)
  assert.ok(!/image\/svg|text\/html|javascript|x-msdownload/.test(sql))
})

test('only members can read or upload, and only into their own sender folder', () => {
  assert.match(sql, /"chat attachments read"[\s\S]*can_access_social_conversation\(public\.chat_attachment_conversation\(name\)\)/)
  assert.match(sql, /"chat attachments upload"[\s\S]*split_part\(name, '\/', 2\) = auth\.uid\(\)::text/)
  assert.match(sql, /"social messages member send"[\s\S]*split_part\(attachment_path, '\/', 1\) = conversation_id::text/)
  assert.ok(!/\bto (anon|public)\b(?!\.)/.test(sql.replace(/revoke[^;]*;/gi, '')))
})

test('unused files can be cleaned up by the sender, and admins can clear a chat', () => {
  assert.match(sql, /"chat attachments orphan cleanup"[\s\S]*not exists/)
  assert.match(sql, /"chat attachments admin delete"[\s\S]*is_workspace_admin\(\)/)
})

test('a message may be a file with no text, and a file needs a name', () => {
  assert.match(sql, /char_length\(body\) >= 1\s+or \(attachment_path is not null and attachment_name is not null\)/)
})

test('the screen offers picker, drag and drop and paste, previews, and signed links only', () => {
  assert.match(ui, /type="file"/)
  assert.match(ui, /onDrop=/)
  assert.match(ui, /onPaste=/)
  assert.match(ui, /createSignedUrls/)
  assert.match(ui, /createSignedUrl\(path,300,\{download:name\}\)/)
  assert.ok(!/getPublicUrl/.test(ui))
  assert.match(ui, /storage\.from\(ATTACH_BUCKET\)\.remove\(paths\)/)
})

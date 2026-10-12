import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/archive.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const A = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const sql = readFileSync('supabase/migrations/20261012310000_archive.sql', 'utf8')
  + readFileSync('supabase/migrations/20261012320000_archive_folders_and_sharing.sql', 'utf8')
const ui = readFileSync('src/modules/ArchiveModule.tsx', 'utf8')
const fn = readFileSync('supabase/functions/archive-share/index.ts', 'utf8')
const config = readFileSync('supabase/config.toml', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const file = (name, size, type = '') => ({ name, size, type })

test('common office files, images, audio and video are accepted; programs are not', () => {
  for (const n of ['a.pdf', 'b.docx', 'c.xlsx', 'd.pptx', 'e.png', 'f.mp4', 'g.mp3', 'h.zip', 'i.csv'])
    assert.equal(A.validateArchiveFile(file(n, 10)).ok, true, n)
  for (const n of ['x.exe', 'x.sh', 'x.html', 'x.svg', 'x.js', 'x.dmg', 'x.bat'])
    assert.equal(A.validateArchiveFile(file(n, 10)).ok, false, n)
})

test('empty and oversized files are refused with a plain reason', () => {
  assert.match(A.validateArchiveFile(file('a.pdf', 0)).reason, /empty/)
  assert.match(A.validateArchiveFile(file('a.pdf', 50 * 1024 * 1024 + 1)).reason, /50 MB/)
  assert.equal(A.validateArchiveFile(file('a.pdf', 50 * 1024 * 1024)).ok, true)
})

test('storage path starts with the user id and is safe', () => {
  const p = A.archivePath('u-1', 'f-1', '../Q3 report (final) é.pdf')
  assert.ok(p.startsWith('u-1/f-1-'))
  assert.equal(/[^A-Za-z0-9._/-]/.test(p), false)
  assert.equal(p.includes('..'), false)
  assert.ok(p.endsWith('.pdf'))
  assert.ok(A.safeFileName('???').length > 0)
})

test('folder names are tidied and never contain slashes', () => {
  assert.equal(A.normaliseFolder('  Legal / Contracts  '), 'Legal Contracts')
  assert.equal(A.normaliseFolder(''), 'General')
  assert.equal(A.normaliseFolder(null), 'General')
  assert.equal(A.normaliseFolder('x'.repeat(100)).length, 60)
})

const row = (o = {}) => ({ id: 'a', name: 'Budget.xlsx', description: null, folder: 'Finance', storage_path: 'u/a', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size_bytes: 100, visibility: 'company', uploaded_by: 'u1', uploader_name: 'Ada', deleted_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', can_manage: true, ...o })

test('search matches every word across name, note, folder and uploader', () => {
  const rows = [row(), row({ id: 'b', name: 'Logo.png', mime_type: 'image/png', folder: 'Brand', uploader_name: 'Tunde', description: 'final logo' })]
  assert.deepEqual(A.filterAndSort(rows, { query: 'tunde logo' }).map(r => r.id), ['b'])
  assert.deepEqual(A.filterAndSort(rows, { query: 'finance ada' }).map(r => r.id), ['a'])
  assert.deepEqual(A.filterAndSort(rows, { kind: 'image' }).map(r => r.id), ['b'])
  assert.deepEqual(A.filterAndSort(rows, { folder: 'Brand' }).map(r => r.id), ['b'])
  assert.deepEqual(A.filterAndSort(rows, { mineOnly: true, userId: 'zzz' }), [])
})

test('sorting: newest, oldest, name, size', () => {
  const rows = [
    row({ id: '1', name: 'b', created_at: '2026-10-02T00:00:00Z', size_bytes: 5 }),
    row({ id: '2', name: 'A', created_at: '2026-10-01T00:00:00Z', size_bytes: 50 }),
    row({ id: '3', name: 'c', created_at: '2026-10-03T00:00:00Z', size_bytes: 20 }),
  ]
  const ids = s => A.filterAndSort(rows, { sort: s }).map(r => r.id).join('')
  assert.equal(ids('newest'), '312')
  assert.equal(ids('oldest'), '213')
  assert.equal(ids('name'), '213')
  assert.equal(ids('size'), '231')
})

test('folder counts and kinds', () => {
  const counts = A.folderCounts([row(), row({ id: 'b' }), row({ id: 'c', folder: 'Brand' })])
  assert.deepEqual(counts, [{ folder: 'Brand', count: 1 }, { folder: 'Finance', count: 2 }])
  assert.equal(A.kindOf('application/pdf'), 'pdf')
  assert.equal(A.kindOf('video/mp4'), 'video')
  assert.equal(A.kindOf('text/csv'), 'sheet')
  assert.equal(A.canPreview('application/zip'), false)
  assert.equal(A.canPreview('image/png'), true)
})

test('bin keeps items for 30 days', () => {
  const now = Date.parse('2026-10-31T00:00:00Z')
  assert.equal(A.binDaysLeft('2026-10-30T00:00:00Z', now), 29)
  assert.equal(A.binExpired('2026-10-01T00:00:00Z', now), true)
  assert.equal(A.binExpired('2026-10-02T00:00:01Z', now), false)
})

test('database: private bucket, owner-folder uploads, bin-only hard delete, guarded columns', () => {
  assert.match(sql, /'archive',\s*'archive',\s*false/)
  assert.match(sql, /52428800/)
  assert.match(sql, /split_part\(name, '\/', 1\) = auth\.uid\(\)::text/)
  assert.match(sql, /for delete[\s\S]*deleted_at is not null and public\.archive_can_manage/)
  assert.match(sql, /uploaded_by is distinct from old\.uploaded_by/)
  assert.match(sql, /p_department <> 'Unassigned'/)
  assert.doesNotMatch(sql, /text\/html|image\/svg|javascript|x-msdownload/)
  assert.match(sql, /bucket_id = 'archive'\s+and exists \(select 1 from public\.archive_files/)
})

test('page: wired in the app, signed links only, no em dash', () => {
  assert.match(app, /section==='archive'&&<ArchiveModule\/>/)
  assert.match(app, /\['archive','Archive',Archive\]/)
  assert.match(ui, /createSignedUrl/)
  assert.doesNotMatch(ui, /getPublicUrl/)
  for (const f of ['src/modules/ArchiveModule.tsx', 'src/lib/archive.ts', 'src/archive.css', 'supabase/migrations/20261012310000_archive.sql', 'supabase/migrations/20261012320000_archive_folders_and_sharing.sql'])
    assert.ok(!readFileSync(f, 'utf8').includes('—'), f)
})

test('folder limits: names are matched without regard to case, and listed once', () => {
  const limits = [{ folder: 'Finance', departments: ['Finance'] }]
  assert.deepEqual(A.limitFor(limits, ' finance ')?.departments, ['Finance'])
  assert.equal(A.limitFor(limits, 'Brand'), undefined)
  const names = A.allFolderNames([row({ folder: 'finance' }), row({ id: 'b', folder: 'Brand' })], limits)
  assert.deepEqual(names, ['Brand', 'finance'])
})

test('share links: url, states and friendly errors', () => {
  assert.equal(A.shareUrl('https://x.supabase.co/', 'abc_-DEF'), 'https://x.supabase.co/functions/v1/archive-share?t=abc_-DEF')
  const now = Date.parse('2026-10-12T00:00:00Z')
  assert.equal(A.shareState({ expires_at: '2026-10-13T00:00:00Z', revoked_at: null }, now), 'active')
  assert.equal(A.shareState({ expires_at: '2026-10-11T00:00:00Z', revoked_at: null }, now), 'expired')
  assert.equal(A.shareState({ expires_at: '2026-10-13T00:00:00Z', revoked_at: 'x' }, now), 'revoked')
  assert.match(A.friendlyArchiveError('new row violates row-level security policy for table "archive_files"'), /access to that folder/)
  assert.deepEqual([...A.SHARE_DAY_OPTIONS], [1, 7, 30])
})

test('database: folder limits are enforced on read, upload and move; only admins set them', () => {
  assert.match(sql, /archive_folder_allows\(p_folder\)/)
  assert.match(sql, /public\.archive_folder_allows\(p_folder\)\s+and \(/)
  assert.match(sql, /and public\.archive_folder_allows\(folder\)\s+and split_part/)
  assert.match(sql, /with check \(public\.archive_can_manage\(uploaded_by\) and public\.archive_folder_allows\(folder\)\)/)
  assert.match(sql, /Only an administrator can limit a folder/)
  assert.match(sql, /revoke all on public\.archive_folder_access from public, anon, authenticated/)
})

test('database: share links store only a hash, expire within 30 days, are capped and die with the file', () => {
  assert.match(sql, /token_hash text not null unique check \(char_length\(token_hash\) = 64\)/)
  assert.match(sql, /encode\(digest\(raw, 'sha256'\), 'hex'\)/)
  assert.match(sql, /least\(greatest\(coalesce\(p_days, 7\), 1\), 30\)/)
  assert.match(sql, /already has 10 active links/)
  assert.match(sql, /update public\.archive_shares set revoked_at = now\(\) where file_id = new\.id/)
  assert.match(sql, /revoke all on public\.archive_shares from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant [a-z, ]+ on public\.archive_shares to authenticated/)
})

test('archive-share function: hashes the code, checks revoke, expiry and bin, redirects to a one minute link', () => {
  assert.match(fn, /crypto\.subtle\.digest\("SHA-256"/)
  assert.match(fn, /!share\.revoked_at/)
  assert.match(fn, /!file\.deleted_at/)
  assert.match(fn, /expires_at\)\.getTime\(\) > Date\.now\(\)/)
  assert.match(fn, /SIGNED_SECONDS = 60/)
  assert.match(fn, /status: 302/)
  assert.match(fn, /room7_rate_count/)
  assert.match(fn, /NOT_VALID/)
  assert.match(config, /\[functions\.archive-share\]\s+enabled = true\s+verify_jwt = false/)
})

test('page: folder access for admins, share dialog shows the link once', () => {
  for (const t of ['FolderAccessModal', 'set_archive_folder_access', 'list_archive_folders', 'ShareModal', 'create_archive_share', 'revoke_archive_share', 'shown only once'])
    assert.ok(ui.includes(t), t)
  assert.ok(!fn.includes('\u2014') && !readFileSync('src/lib/archive.ts', 'utf8').includes('\u2014'))
})

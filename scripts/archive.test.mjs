import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const js = transformSync(readFileSync('src/lib/archive.ts', 'utf8'), { loader: 'ts', format: 'esm' }).code
const A = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const sql = readFileSync('supabase/migrations/20261012310000_archive.sql', 'utf8')
const ui = readFileSync('src/modules/ArchiveModule.tsx', 'utf8')
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
  for (const f of ['src/modules/ArchiveModule.tsx', 'src/lib/archive.ts', 'src/archive.css', 'supabase/migrations/20261012310000_archive.sql'])
    assert.ok(!readFileSync(f, 'utf8').includes('—'), f)
})

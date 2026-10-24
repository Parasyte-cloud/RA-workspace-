import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build as esbuild } from 'esbuild'

// PArAsYtE: regression tests for the ROOM 7 document upload audit.
//
// Symptom that started it: documents in Downloads did not appear when choosing
// a file. The picker, the type check, the Edge Function, the table constraint
// and the storage bucket each carried their own copy of "PDF, JPEG, PNG, WebP",
// so Word, Excel, PowerPoint, text and CSV files could not be chosen or stored.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

async function loadTypes() {
  const out = (await esbuild({
    entryPoints: [new URL('../src/lib/room7DocumentTypes.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  })).outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}#${Math.random()}`)
}

const mimesIn = text => [...text.matchAll(/'((?:application|image|text)\/[a-z0-9.+-]+)'|"((?:application|image|text)\/[a-z0-9.+-]+)"/g)].map(m => m[1] || m[2])

test('the browser list, the Edge Function, the constraint and the bucket all allow the same nine types', async () => {
  const types = await loadTypes()
  const browser = [...types.ROOM7_DOCUMENT_MIMES].sort()
  assert.equal(browser.length, 9)

  const server = read('supabase/functions/room-event-documents/lib.ts')
  const allowedBlock = server.slice(server.indexOf('export const allowedMimeTypes'), server.indexOf('export const previewableMimeTypes'))
  assert.deepEqual([...new Set(mimesIn(allowedBlock))].sort(), browser)

  const sql = read('supabase/migrations/20261024120000_room7_documents_more_types.sql')
  const constraint = sql.slice(sql.indexOf('room7_event_documents_mime_check\n  check'), sql.indexOf('drop constraint if exists room7_event_documents_download_check'))
  assert.deepEqual([...new Set(mimesIn(constraint))].sort(), browser)
  const bucket = sql.slice(sql.indexOf('update storage.buckets'), sql.indexOf('where id = '))
  assert.deepEqual([...new Set(mimesIn(bucket))].sort(), browser)

  // Every allowed type has a file extension the server can store it under.
  const extBlock = server.slice(server.indexOf('export const extensionByMime'), server.indexOf('export function cleanText'))
  assert.deepEqual([...new Set(mimesIn(extBlock))].sort(), browser)
})

test('previewable types agree between the browser, the server and the download constraint', async () => {
  const types = await loadTypes()
  const browser = types.ROOM7_DOCUMENT_TYPES.filter(type => type.previewable).map(type => type.mime).sort()
  assert.deepEqual(browser, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

  const server = read('supabase/functions/room-event-documents/lib.ts')
  const block = server.slice(server.indexOf('export const previewableMimeTypes'), server.indexOf('export function isPreviewableMime'))
  assert.deepEqual([...new Set(mimesIn(block))].sort(), browser)

  const sql = read('supabase/migrations/20261024120000_room7_documents_more_types.sql')
  const download = sql.slice(sql.indexOf('room7_event_documents_download_check\n  check'), sql.indexOf('update storage.buckets'))
  assert.deepEqual([...new Set(mimesIn(download))].sort(), browser)
})

test('the picker lists extensions, so Word, Excel, PowerPoint, text and CSV files show up in Downloads', async () => {
  const { ROOM7_DOCUMENT_ACCEPT } = await loadTypes()
  const accept = ROOM7_DOCUMENT_ACCEPT.split(',')
  for (const extension of ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.docx', '.xlsx', '.pptx', '.txt', '.csv']) {
    assert.ok(accept.includes(extension), extension)
  }
  // Legacy and macro-enabled formats stay out.
  for (const extension of ['.doc', '.xls', '.ppt', '.docm', '.xlsm', '.pptm', '.exe', '.zip', '.html', '.svg']) {
    assert.ok(!accept.includes(extension), extension)
  }
})

test('file typing: the extension wins over what the browser reports', async () => {
  const { inferRoom7DocumentMime: infer } = await loadTypes()
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  assert.equal(infer({ name: 'Agenda.docx', type: '' }), docx)
  assert.equal(infer({ name: 'Budget.XLSX', type: 'application/octet-stream' }), xlsx)
  assert.equal(infer({ name: 'Deck.pptx', type: pptx }), pptx)
  // Windows with Excel installed says application/vnd.ms-excel for a .csv.
  assert.equal(infer({ name: 'riders.csv', type: 'application/vnd.ms-excel' }), 'text/csv')
  assert.equal(infer({ name: 'notes.txt', type: '' }), 'text/plain')
  assert.equal(infer({ name: 'scan.JPG', type: '' }), 'image/jpeg')
  assert.equal(infer({ name: 'scan.jpeg', type: 'image/jpeg' }), 'image/jpeg')
  assert.equal(infer({ name: 'brochure.pdf', type: '' }), 'application/pdf')
  // No extension: trust a type we allow.
  assert.equal(infer({ name: 'download', type: 'application/pdf' }), 'application/pdf')
  // Refused.
  for (const bad of [
    { name: 'old.doc', type: 'application/msword' },
    { name: 'old.xls', type: 'application/vnd.ms-excel' },
    { name: 'macro.docm', type: '' },
    { name: 'setup.exe', type: 'application/x-msdownload' },
    { name: 'page.html', type: 'text/html' },
    { name: 'logo.svg', type: 'image/svg+xml' },
    { name: 'noext', type: '' },
  ]) {
    assert.equal(infer(bad), null, bad.name)
  }
})

test('only PDFs and images are previewable, so everything else is download only', async () => {
  const { isRoom7DocumentPreviewable: previewable, room7DocumentLabel: label } = await loadTypes()
  assert.equal(previewable('application/pdf'), true)
  assert.equal(previewable('image/png'), true)
  assert.equal(previewable('text/plain'), false)
  assert.equal(previewable('text/csv'), false)
  assert.equal(previewable('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false)
  assert.equal(previewable('something/else'), false)
  assert.equal(label('text/csv'), 'CSV file')
  assert.equal(label('unknown/type'), 'Document')
})

test('manager: uses the shared list, forces downloading on for download-only types, and says which types work', () => {
  const ui = read('src/modules/RoomEventDocumentsManager.tsx')
  assert.match(ui, /accept=\{ROOM7_DOCUMENT_ACCEPT\}/)
  assert.doesNotMatch(ui, /accept="\.pdf/)
  assert.match(ui, /inferRoom7DocumentMime\(/)
  assert.match(ui, /allow_download:\s*!isRoom7DocumentPreviewable\(\s*mimeType,?\s*\)/)
  assert.match(ui, /disabled=\{\s*!isRoom7DocumentPreviewable\(/)
  assert.match(ui, /this file type is not supported\./)
  assert.match(ui, /room7DocumentLabel\(/)
  assert.doesNotMatch(ui, /use PDF, JPEG, PNG or WebP/)
})

test('guest reader: download-only files get a download card and never request a preview', () => {
  const ui = read('src/room7-public/Room7GuestDocuments.tsx')
  assert.match(ui, /isRoom7DocumentPreviewable\(\s*documentRecord\s*\.mime_type,?\s*\)/)
  assert.match(ui, /This file type cannot be previewed here\. Download it to open it on your device\./)
  assert.match(ui, /room7GuestDocumentDownloadOnly/)
  const css = read('src/room7-public/room7-public.css')
  assert.match(css, /\.room7GuestDocumentDownloadButton\{/)
  assert.match(css, /background:\s*var\(--r7x-amber\)/)
})

test('server: validation message, forced download, and preview paths all know about download-only types', () => {
  const validate = read('supabase/functions/room-event-documents/validate.ts')
  assert.match(validate, /Word \(\.docx\), Excel \(\.xlsx\), PowerPoint \(\.pptx\)/)
  assert.match(validate, /!isPreviewableMime\(\s*mimeType,?\s*\)\s*\|\|\s*booleanField\(/)
  const index = read('supabase/functions/room-event-documents/index.ts')
  // Public reader and admin preview both fall through to a download disposition.
  assert.equal((index.match(/!isPreviewableMime\(\s*document\.mime_type,?\s*\)/g) || []).length, 2)
  // An update cannot switch downloading off for a type that cannot be previewed.
  assert.match(index, /This file type cannot be previewed, so downloading must stay on\./)
  // Storage may report a charset for text types.
  assert.match(index, /actualMimeType\s*\.split\(";"\)\[0\]/)
})

test('migration: constraints are replaced idempotently, the bucket stays private and capped at 25 MB, no em dash', () => {
  const sql = read('supabase/migrations/20261024120000_room7_documents_more_types.sql')
  assert.match(sql, /drop constraint if exists room7_event_documents_mime_check/)
  assert.match(sql, /drop constraint if exists room7_event_documents_download_check/)
  assert.match(sql, /bucket_record\.public is true/)
  assert.match(sql, /file_size_limit <> 26214400/)
  assert.match(sql, /cardinality\(bucket_record\.allowed_mime_types\) <> 9/)
  assert.doesNotMatch(sql, /—/)
})

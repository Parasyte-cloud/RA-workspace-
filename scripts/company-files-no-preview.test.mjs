import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict'
const src=fs.readFileSync('src/modules/Phase2Modules.tsx','utf8')
const mod=src.slice(src.indexOf('export function CompanyFilesModule'))
test('previews are never generated automatically',()=>{
  assert.doesNotMatch(mod,/backfillMissingCompanyPreviews|previewBackfillStarted/)
  assert.match(mod,/useState<'none'\|'picture'>\('none'\)/)
})
test('upload makes a preview only when the uploader chose picture, and only for images',()=>{
  assert.match(mod,/previewMode === 'picture' && isPreviewableImage\(selectedFile\)/)
})
test('a preview is made or removed one file at a time by an uploader role',()=>{
  assert.match(mod,/async function showPreview\(file: WorkspaceFile\)\s*\{\s*if \(!supabase \|\| !canUpload/)
  assert.match(mod,/async function hidePreview\(file: WorkspaceFile\)\s*\{\s*if \(!supabase \|\| !canUpload/)
  assert.match(mod,/remove\(\[path\]\)/)
})
test('files without a preview show the plain card, never a pending picture',()=>{
  assert.match(mod,/companyFileDocumentCard/)
  assert.doesNotMatch(mod,/Preview preparing/)
})
test('originals still need an approved download',()=>{
  assert.match(mod,/Download approved file/)
})
test('no em dash',()=>{assert.ok(!mod.includes('—'))})

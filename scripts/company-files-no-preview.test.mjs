import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/modules/Phase2Modules.tsx', import.meta.url), 'utf8')
const files = src.slice(src.indexOf('export function CompanyFilesModule'))

test('Company Files never renders or creates a picture of an uploaded file', () => {
  assert.doesNotMatch(src, /createInternalImagePreview|isPreviewableImage/)
  assert.doesNotMatch(src, /workspace-previews/)
  assert.doesNotMatch(src, /companyFilePreview/)
  assert.doesNotMatch(files, /<img\b/)
  // The only signed URL left is the approved download, which forces a download.
  for (const m of files.matchAll(/createSignedUrl\([^)]*\)/g)) assert.match(m[0], /download|, 60/)
  assert.doesNotMatch(files, /preview_url:\s*\w/)
})

test('every company file is the same plain card with an approved-download button', () => {
  assert.match(files, /companyFileDocumentCard/)
  assert.match(files, /Download approved file/)
  assert.match(files, /preview_path: null/)
})

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
const sql = readFileSync(new URL('../supabase/migrations/20261017100000_company_files_more_mime_types.sql', import.meta.url), 'utf8')
test('company-files accepts iWork, OpenDocument and RTF', () => {
  for (const m of ['x-iwork-numbers-sffnumbers','x-iwork-pages-sffpages','x-iwork-keynote-sffkey','opendocument.spreadsheet','rtf','image/heic'])
    assert.ok(sql.includes(m), m)
})
test('bucket stays private and only the allow-list changes', () => {
  assert.doesNotMatch(sql, /public\s*=\s*true/)
  assert.match(sql, /where id = 'company-files'/)
})

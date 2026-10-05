import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// A CTE that is referenced in a select list must also appear in that
// statement's FROM clause. This once shipped broken in the Move v2 form
// migration (ERROR 42P01: missing FROM-clause entry for table "next_version").
const dir = new URL('../supabase/migrations/', import.meta.url)

test('form-version migrations that read next_version.n also select from it', () => {
  for (const name of readdirSync(dir).filter(file => file.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, dir), 'utf8')
    if (!/next_version\.n/.test(sql)) continue
    assert.match(
      sql,
      /^\s*from form, next_version\s*$/m,
      `${name} uses next_version.n but never lists next_version in FROM`,
    )
  }
})

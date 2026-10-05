// Runs every contract and unit test that needs nothing but Node.
// Two suites are skipped here because they drive a local Supabase stack and
// need the Supabase CLI: run them with `npm run test:supabase` when it is
// installed.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const NEEDS_SUPABASE = new Set([
  'intake-platform-security.test.mjs',
  'intake-service-e2e.test.mjs',
])

const files = readdirSync(new URL('.', import.meta.url))
  .filter(name => /(\.test|contract)\.mjs$/.test(name))
  .filter(name => !NEEDS_SUPABASE.has(name))
  .sort()

let failed = 0
for (const name of files) {
  const result = spawnSync(process.execPath, ['--test', `scripts/${name}`], {
    stdio: 'pipe',
    encoding: 'utf8',
  })
  const ok = result.status === 0
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) {
    failed += 1
    console.log(result.stdout.split('\n').slice(-25).join('\n'))
    console.log(result.stderr)
  }
}

console.log(`\n${files.length - failed}/${files.length} suites passed`)
process.exit(failed ? 1 : 0)

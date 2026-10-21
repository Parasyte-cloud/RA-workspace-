import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync(
  'scripts/support-sql-tests/run.sh',
  'utf8'
)

assert.match(
  source,
  /scc_test_pass\$\{pass\}/,
  'each replay pass must use its own fresh database'
)

assert.match(
  source,
  /reset_db "\$DB"/,
  'database must be reset before each replay'
)

assert.match(
  source,
  /MIGRATION_REPLAY_\$\{pass\}_OK/,
  'each independent migration replay must report success'
)

assert.match(
  source,
  /TEST_DB="scc_test_pass2"/,
  'SQL tests should run against the second clean replay'
)

assert.doesNotMatch(
  source,
  /for pass in 1 2; do[\s\S]*?apply_support_migrations\s+"?scc_test"?/,
  'migration passes must not reuse one final schema'
)

console.log('support SQL replay harness checks: 5/5 passed')

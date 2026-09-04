#!/usr/bin/env bash

set -euo pipefail

repo="$(
  CDPATH= cd -- "$(dirname -- "$0")/../../.." &&
    pwd
)"

contract="$repo/scripts/admin-backup/database-reconciliation-contract.mjs"

tmp="$(
  mktemp -d
)"

cleanup() {
  rm -rf "$tmp"
}

trap cleanup EXIT

node - "$tmp" <<'NODE'
const fs = require('fs')
const path = require('path')

const root = process.argv[2]
const hash = '0'.repeat(64)
const sequenceHash = 'a'.repeat(64)

const table = (
  schema,
  name,
) => ({
  schema,
  table: name,
  columns: 'id',
  row_count: 0,
  content_sha256: hash,
})

const tables = [
  table('auth', 'users'),
  table('auth', 'identities'),
  table('public', 'employee_profiles'),
  table('storage', 'buckets'),
  table('storage', 'objects'),
  table('supabase_functions', 'hooks'),
]

const base = {
  validated: true,

  source_component:
    'database/data.sql',

  algorithm:
    'sha256-schema-table-columns-sorted-copy-lines-v1',

  copy_format:
    'postgres-copy-text',

  table_count:
    tables.length,

  total_row_count:
    0,

  schema_counts: {
    auth: 2,
    public: 1,
    storage: 2,
    supabase_functions: 1,
  },

  data_schemas: [
    'auth',
    'public',
    'storage',
    'supabase_functions',
  ],

  platform_managed_exclusions: [
    'auth.schema_migrations',
    'storage.migrations',
    'supabase_functions.migrations',
  ],

  sequence_count:
    0,

  sequence_state_sha256:
    sequenceHash,

  tables,
}

const v1 = {
  format_version: 1,
  ...base,
}

const v2 = {
  format_version: 2,
  ...base,

  source_schema_presence: {
    supabase_functions: true,
  },
}

const absentTables =
  tables.filter(
    item =>
      item.schema !== 'supabase_functions',
  )

const v2Absent = {
  format_version: 2,
  ...base,

  source_schema_presence: {
    supabase_functions: false,
  },

  table_count:
    absentTables.length,

  schema_counts: {
    auth: 2,
    public: 1,
    storage: 2,
  },

  data_schemas: [
    'auth',
    'public',
    'storage',
  ],

  platform_managed_exclusions: [
    'auth.schema_migrations',
    'storage.migrations',
  ],

  tables:
    absentTables,
}

const badV1 = {
  ...v1,

  source_schema_presence: {
    supabase_functions: true,
  },
}

const badV2 = {
  ...v2,
}

delete badV2.source_schema_presence

const badAbsent = {
  ...v2Absent,

  tables: [
    ...v2Absent.tables,
    table(
      'supabase_functions',
      'hooks',
    ),
  ],

  table_count:
    v2Absent.table_count + 1,

  schema_counts: {
    ...v2Absent.schema_counts,
    supabase_functions: 1,
  },
}

const fixtures = {
  v1,
  v2,
  'v2-absent': v2Absent,
  'bad-v1': badV1,
  'bad-v2': badV2,
  'bad-absent': badAbsent,
}

for (
  const [name, value]
  of Object.entries(fixtures)
) {
  fs.writeFileSync(
    path.join(
      root,
      `${name}.json`,
    ),
    `${JSON.stringify(
      value,
      null,
      2,
    )}\n`,
  )
}
NODE

passes=0
failures=0

pass() {
  printf 'PASS: %s\n' "$1"
  passes=$((passes + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

for fixture in \
  v1 \
  v2 \
  v2-absent
do
  if node \
    "$contract" \
    validate \
    "$tmp/$fixture.json" \
    >/dev/null
  then
    pass "$fixture accepted"
  else
    fail "$fixture rejected"
  fi
done

node \
  "$contract" \
  normalize \
  "$tmp/v1.json" \
  "$tmp/v1.normalized.json"

node \
  "$contract" \
  normalize \
  "$tmp/v2.json" \
  "$tmp/v2.normalized.json"

node \
  "$contract" \
  normalize \
  "$tmp/v2-absent.json" \
  "$tmp/v2-absent.normalized.json"

if cmp -s \
  "$tmp/v1.normalized.json" \
  "$tmp/v2.normalized.json"
then
  pass \
    "legacy v1 and equivalent v2 normalize identically"
else
  fail \
    "legacy v1 and equivalent v2 normalization differs"
fi

if cmp -s \
  "$tmp/v1.normalized.json" \
  "$tmp/v2-absent.normalized.json"
then
  fail \
    "present and absent schema normalized identically"
else
  pass \
    "present and absent schema remain semantically distinct"
fi

for fixture in \
  bad-v1 \
  bad-v2 \
  bad-absent
do
  if node \
    "$contract" \
    validate \
    "$tmp/$fixture.json" \
    >/dev/null 2>&1
  then
    fail \
      "$fixture was accepted"
  else
    pass \
      "$fixture rejected fail-closed"
  fi
done

printf \
  'PASS_COUNT=%s\nFAIL_COUNT=%s\n' \
  "$passes" \
  "$failures"

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi

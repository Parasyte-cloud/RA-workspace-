#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { resolve } from 'node:path'

const BASE_KEYS = [
  'algorithm',
  'copy_format',
  'data_schemas',
  'format_version',
  'platform_managed_exclusions',
  'schema_counts',
  'sequence_count',
  'sequence_state_sha256',
  'source_component',
  'table_count',
  'tables',
  'total_row_count',
  'validated',
]

const TABLE_KEYS = [
  'columns',
  'content_sha256',
  'row_count',
  'schema',
  'table',
]

const HASH_RE = /^[0-9a-f]{64}$/

function fail(message) {
  throw new Error(message)
}

function isObject(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
  )
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false

  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()

  return JSON.stringify(actual) === JSON.stringify(wanted)
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual)
    && JSON.stringify(actual) === JSON.stringify(expected)
  )
}

function validateLedger(ledger) {
  if (!isObject(ledger)) {
    fail('reconciliation ledger must be a JSON object')
  }

  const version = ledger.format_version

  if (version !== 1 && version !== 2) {
    fail('reconciliation format_version must be 1 or 2')
  }

  const topLevelKeys =
    version === 1
      ? BASE_KEYS
      : [...BASE_KEYS, 'source_schema_presence']

  if (!exactKeys(ledger, topLevelKeys)) {
    fail(
      `reconciliation v${version} top-level keys are not exact`,
    )
  }

  let supabaseFunctionsPresent

  if (version === 1) {
    // Historical v1 was strict: supabase_functions was mandatory and
    // source_schema_presence did not exist.
    supabaseFunctionsPresent = true
  } else {
    if (
      !exactKeys(
        ledger.source_schema_presence,
        ['supabase_functions'],
      )
    ) {
      fail(
        'reconciliation v2 source_schema_presence keys are not exact',
      )
    }

    if (
      typeof ledger.source_schema_presence.supabase_functions
        !== 'boolean'
    ) {
      fail(
        'reconciliation v2 supabase_functions presence must be boolean',
      )
    }

    supabaseFunctionsPresent =
      ledger.source_schema_presence.supabase_functions
  }

  if (ledger.validated !== true) {
    fail('reconciliation ledger must be validated')
  }

  if (ledger.source_component !== 'database/data.sql') {
    fail('unexpected reconciliation source_component')
  }

  if (
    ledger.algorithm
      !== 'sha256-schema-table-columns-sorted-copy-lines-v1'
  ) {
    fail('unexpected reconciliation algorithm')
  }

  if (ledger.copy_format !== 'postgres-copy-text') {
    fail('unexpected reconciliation copy_format')
  }

  const expectedSchemas = [
    'auth',
    'public',
    'storage',
    ...(supabaseFunctionsPresent
      ? ['supabase_functions']
      : []),
  ]

  const expectedExclusions = [
    'auth.schema_migrations',
    'storage.migrations',
    ...(supabaseFunctionsPresent
      ? ['supabase_functions.migrations']
      : []),
  ]

  const requiredTargets = [
    'auth.users',
    'auth.identities',
    'storage.buckets',
    'storage.objects',
    ...(supabaseFunctionsPresent
      ? ['supabase_functions.hooks']
      : []),
    'public.employee_profiles',
  ]

  if (!sameArray(ledger.data_schemas, expectedSchemas)) {
    fail('reconciliation data_schemas contract differs')
  }

  if (
    !sameArray(
      ledger.platform_managed_exclusions,
      expectedExclusions,
    )
  ) {
    fail('reconciliation managed exclusions contract differs')
  }

  if (
    !Number.isInteger(ledger.table_count)
    || ledger.table_count <= 0
  ) {
    fail(
      'reconciliation table_count must be a positive integer',
    )
  }

  if (
    !Number.isInteger(ledger.total_row_count)
    || ledger.total_row_count < 0
  ) {
    fail(
      'reconciliation total_row_count must be a non-negative integer',
    )
  }

  if (
    !Number.isInteger(ledger.sequence_count)
    || ledger.sequence_count < 0
  ) {
    fail(
      'reconciliation sequence_count must be a non-negative integer',
    )
  }

  if (
    typeof ledger.sequence_state_sha256 !== 'string'
    || !HASH_RE.test(ledger.sequence_state_sha256)
  ) {
    fail('reconciliation sequence_state_sha256 is invalid')
  }

  if (
    !Array.isArray(ledger.tables)
    || ledger.tables.length !== ledger.table_count
  ) {
    fail('reconciliation tables inventory length differs')
  }

  if (
    !exactKeys(
      ledger.schema_counts,
      expectedSchemas,
    )
  ) {
    fail('reconciliation schema_counts keys differ')
  }

  const targets = []
  let rowTotal = 0

  for (const table of ledger.tables) {
    if (!exactKeys(table, TABLE_KEYS)) {
      fail('reconciliation table keys are not exact')
    }

    if (!expectedSchemas.includes(table.schema)) {
      fail(
        `unexpected reconciliation schema: ${table.schema}`,
      )
    }

    if (
      typeof table.table !== 'string'
      || table.table.length === 0
    ) {
      fail('reconciliation table name is invalid')
    }

    if (
      typeof table.columns !== 'string'
      || table.columns.length === 0
    ) {
      fail('reconciliation columns contract is invalid')
    }

    if (
      !Number.isInteger(table.row_count)
      || table.row_count < 0
    ) {
      fail('reconciliation row_count is invalid')
    }

    if (
      typeof table.content_sha256 !== 'string'
      || !HASH_RE.test(table.content_sha256)
    ) {
      fail(
        'reconciliation table content hash is invalid',
      )
    }

    targets.push(
      `${table.schema}.${table.table}`,
    )

    rowTotal += table.row_count
  }

  if (
    new Set(targets).size !== ledger.table_count
  ) {
    fail(
      'reconciliation table targets are not unique',
    )
  }

  if (
    rowTotal !== ledger.total_row_count
  ) {
    fail(
      'reconciliation total row count differs from table inventory',
    )
  }

  for (const schema of expectedSchemas) {
    const expectedCount =
      ledger.tables.filter(
        table => table.schema === schema,
      ).length

    if (
      !Number.isInteger(
        ledger.schema_counts[schema],
      )
      || ledger.schema_counts[schema]
        !== expectedCount
    ) {
      fail(
        `reconciliation schema count differs for ${schema}`,
      )
    }
  }

  for (const target of requiredTargets) {
    if (!targets.includes(target)) {
      fail(
        `reconciliation required target missing: ${target}`,
      )
    }
  }

  for (const excluded of expectedExclusions) {
    if (targets.includes(excluded)) {
      fail(
        `reconciliation excluded target present: ${excluded}`,
      )
    }
  }

  return {
    formatVersion: version,
    supabaseFunctionsPresent,
  }
}

function normalizeLedger(ledger) {
  const contract = validateLedger(ledger)

  const tables =
    [...ledger.tables].sort(
      (left, right) =>
        `${left.schema}\0${left.table}`
          .localeCompare(
            `${right.schema}\0${right.table}`,
          ),
    )

  const schemaCounts =
    Object.fromEntries(
      Object.entries(
        ledger.schema_counts,
      ).sort(
        ([left], [right]) =>
          left.localeCompare(right),
      ),
    )

  // format_version itself is deliberately excluded here.
  // A strict legacy v1 artifact and its equivalent v2 target
  // must normalize to the same semantic representation.
  return {
    semantic_contract_version: 1,
    validated: true,

    source_component:
      ledger.source_component,

    algorithm:
      ledger.algorithm,

    copy_format:
      ledger.copy_format,

    source_schema_presence: {
      supabase_functions:
        contract.supabaseFunctionsPresent,
    },

    data_schemas:
      [...ledger.data_schemas].sort(),

    platform_managed_exclusions:
      [...ledger.platform_managed_exclusions].sort(),

    table_count:
      ledger.table_count,

    total_row_count:
      ledger.total_row_count,

    schema_counts:
      schemaCounts,

    sequence_count:
      ledger.sequence_count,

    sequence_state_sha256:
      ledger.sequence_state_sha256,

    tables,
  }
}

function loadJson(path) {
  try {
    return JSON.parse(
      readFileSync(path, 'utf8'),
    )
  } catch (error) {
    fail(
      `unable to read reconciliation ledger: ${error.message}`,
    )
  }
}

function atomicWrite(path, value) {
  const resolved = resolve(path)
  const temporary =
    `${resolved}.partial.${process.pid}`

  try {
    writeFileSync(
      temporary,
      `${JSON.stringify(
        value,
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    )

    renameSync(
      temporary,
      resolved,
    )
  } catch (error) {
    rmSync(
      temporary,
      { force: true },
    )

    throw error
  }
}

const [
  mode,
  input,
  output,
] = process.argv.slice(2)

try {
  if (!mode || !input) {
    fail(
      'usage: database-reconciliation-contract.mjs validate INPUT | normalize INPUT OUTPUT',
    )
  }

  const ledger =
    loadJson(input)

  if (mode === 'validate') {
    const contract =
      validateLedger(ledger)

    process.stdout.write(
      `${JSON.stringify({
        valid: true,
        format_version:
          contract.formatVersion,
        source_schema_presence: {
          supabase_functions:
            contract.supabaseFunctionsPresent,
        },
      })}\n`,
    )
  } else if (mode === 'normalize') {
    if (!output) {
      fail(
        'normalize mode requires OUTPUT',
      )
    }

    atomicWrite(
      output,
      normalizeLedger(ledger),
    )
  } else {
    fail(
      `unsupported mode: ${mode}`,
    )
  }
} catch (error) {
  console.error(
    `ERROR: ${error.message}`,
  )
  process.exit(1)
}

#!/usr/bin/env node

import {
  createHash,
} from 'node:crypto'

import {
  readFileSync,
  writeFileSync,
} from 'node:fs'

const [
  ,
  ,
  inputPath,
  outputPath,
] = process.argv

if (!inputPath || !outputPath) {
  console.error(
    'Usage: build-database-reconciliation.mjs DATA_SQL OUTPUT_JSON',
  )

  process.exit(2)
}

const source = readFileSync(
  inputPath,
  'utf8',
)

const lines = source.split(/\r?\n/)

const quotedIdentifier =
  '"((?:[^"]|"")*)"'

const copyPattern =
  new RegExp(
    '^COPY '
    + quotedIdentifier
    + '\\.'
    + quotedIdentifier
    + ' \\((.*)\\) FROM stdin;$',
  )

const decodeIdentifier = value =>
  value.replaceAll(
    '""',
    '"',
  )

const sha256 = values => {
  const hash = createHash('sha256')

  for (const value of values) {
    hash.update(
      value,
      'utf8',
    )
  }

  return hash.digest('hex')
}

const basePlatformManagedExclusions = [
  'auth.schema_migrations',
  'storage.migrations',
]

const baseExpectedDataSchemas = [
  'auth',
  'public',
  'storage',
]

const baseRequiredRestoreTargets = [
  'auth.users',
  'auth.identities',
  'storage.buckets',
  'storage.objects',
  'public.employee_profiles',
]

const tables = []
const sequences = []

let copyHeaderCount = 0

for (
  let index = 0;
  index < lines.length;
  index += 1
) {
  const line = lines[index]

  if (
    /^\s*INSERT\s+INTO\s+/i.test(line)
  ) {
    throw new Error(
      'INSERT-based table data is not supported by the reconciliation contract',
    )
  }

  if (
    line.startsWith(
      'SELECT pg_catalog.setval(',
    )
  ) {
    sequences.push(line)
    continue
  }

  if (!line.startsWith('COPY ')) {
    continue
  }

  copyHeaderCount += 1

  const match = copyPattern.exec(line)

  if (!match) {
    throw new Error(
      `unsupported COPY header: ${line}`,
    )
  }

  const schema =
    decodeIdentifier(match[1])

  const table =
    decodeIdentifier(match[2])

  const columns =
    match[3]

  const rows = []

  let terminated = false

  for (
    index += 1;
    index < lines.length;
    index += 1
  ) {
    const row = lines[index]

    if (row === String.raw`\.`) {
      terminated = true
      break
    }

    rows.push(row)
  }

  if (!terminated) {
    throw new Error(
      `unterminated COPY block: ${schema}.${table}`,
    )
  }

  const canonicalRows = [
    ...rows,
  ].sort()

  const contentSha256 = sha256([
    schema,
    '\0',
    table,
    '\0',
    columns,
    '\0',
    ...canonicalRows.flatMap(
      row => [
        row,
        '\n',
      ],
    ),
  ])

  tables.push({
    schema,
    table,
    columns,
    row_count: rows.length,
    content_sha256: contentSha256,
  })
}

const targets =
  tables.map(
    item =>
      `${item.schema}.${item.table}`,
  )

const targetSet =
  new Set(targets)


const supabaseFunctionsPresent =
  targets.some(
    target =>
      target.startsWith(
        'supabase_functions.',
      ),
  )

const platformManagedExclusions = [
  ...basePlatformManagedExclusions,
  ...(supabaseFunctionsPresent
    ? ['supabase_functions.migrations']
    : []),
]

const expectedDataSchemas = [
  ...baseExpectedDataSchemas,
  ...(supabaseFunctionsPresent
    ? ['supabase_functions']
    : []),
]

const requiredRestoreTargets = [
  ...baseRequiredRestoreTargets,
  ...(supabaseFunctionsPresent
    ? ['supabase_functions.hooks']
    : []),
]

if (targetSet.size !== targets.length) {
  const duplicateTargets =
    [
      ...new Set(
        targets.filter(
          (
            target,
            index,
            values,
          ) =>
            values.indexOf(target)
            !== index,
        ),
      ),
    ].sort()

  throw new Error(
    `duplicate COPY targets: ${duplicateTargets.join(', ')}`,
  )
}

if (copyHeaderCount !== tables.length) {
  throw new Error(
    'not every COPY header produced a ledger entry',
  )
}

for (
  const excluded
  of platformManagedExclusions
) {
  if (targetSet.has(excluded)) {
    throw new Error(
      `platform-managed migration table unexpectedly exists in data.sql: ${excluded}`,
    )
  }
}

for (
  const required
  of requiredRestoreTargets
) {
  if (!targetSet.has(required)) {
    throw new Error(
      `required recovery table missing from data.sql: ${required}`,
    )
  }
}

const schemaCounts = {}

for (const item of tables) {
  schemaCounts[item.schema] =
    (
      schemaCounts[item.schema]
      ?? 0
    )
    + 1
}

const actualSchemas =
  Object.keys(schemaCounts)
    .sort()

if (
  JSON.stringify(actualSchemas)
  !== JSON.stringify(
    expectedDataSchemas,
  )
) {
  throw new Error(
    'data-bearing schema contract changed: '
    + actualSchemas.join(', '),
  )
}

const sortedTables =
  [
    ...tables,
  ].sort(
    (left, right) =>
      (
        left.schema
        + '\0'
        + left.table
      ).localeCompare(
        right.schema
        + '\0'
        + right.table,
      ),
  )

const sortedSchemaCounts =
  Object.fromEntries(
    Object.entries(schemaCounts)
      .sort(
        ([left], [right]) =>
          left.localeCompare(right),
      ),
  )

const sortedSequences =
  [
    ...sequences,
  ].sort()

const sequenceStateSha256 =
  sha256(
    sortedSequences.flatMap(
      line => [
        line,
        '\n',
      ],
    ),
  )

const totalRowCount =
  sortedTables.reduce(
    (
      total,
      item,
    ) =>
      total + item.row_count,
    0,
  )

const ledger = {
  format_version: 2,

  validated: true,

  source_component:
    'database/data.sql',

  algorithm:
    'sha256-schema-table-columns-sorted-copy-lines-v1',

  copy_format:
    'postgres-copy-text',

  source_schema_presence: {
    supabase_functions:
      supabaseFunctionsPresent,
  },
  table_count:
    sortedTables.length,

  total_row_count:
    totalRowCount,

  schema_counts:
    sortedSchemaCounts,

  data_schemas:
    actualSchemas,

  platform_managed_exclusions:
    platformManagedExclusions,

  sequence_count:
    sortedSequences.length,

  sequence_state_sha256:
    sequenceStateSha256,

  tables:
    sortedTables,
}

writeFileSync(
  outputPath,
  JSON.stringify(
    ledger,
    null,
    2,
  )
  + '\n',
  {
    encoding: 'utf8',
    mode: 0o600,
  },
)

console.log(
  `PASS: database reconciliation ledger created for ${sortedTables.length} COPY tables`,
)

import {
  createHash,
} from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  join,
  relative,
  resolve,
} from 'node:path'
import {
  execFileSync,
} from 'node:child_process'

const [, , workspaceArg] = process.argv

if (!workspaceArg) {
  console.error(
    'Usage: node build-manifest.mjs WORKSPACE_DIR',
  )
  process.exit(2)
}

const workspace = resolve(workspaceArg)

if (!existsSync(workspace)) {
  console.error(
    `Backup workspace does not exist: ${workspace}`,
  )
  process.exit(1)
}

const componentsDir = join(workspace, 'components')
const metadataDir = join(workspace, 'metadata')
const manifestPath = join(workspace, 'manifest.json')
const checksumPath = join(
  metadataDir,
  'component-checksums.sha256',
)

mkdirSync(componentsDir, {
  recursive: true,
})

mkdirSync(metadataDir, {
  recursive: true,
})

const sectionedSchemaFiles = [
  'database/auth-pre.sql',
  'database/auth-post.sql',
  'database/storage-pre.sql',
  'database/storage-post.sql',
  'database/supabase-functions-pre.sql',
  'database/supabase-functions-post.sql',
  'database/public-pre.sql',
  'database/public-post.sql',
]

const sectionedSchemaEvidenceFiles =
  sectionedSchemaFiles.map(
    path => path.replace(
      /^database\//,
      '',
    ),
  )

const requiredCoverage = {
  database: [
    'database/roles.sql',
    'database/schema.sql',
    'database/data.sql',
    ...sectionedSchemaFiles,
  ],
  auth: [
    'database/auth-data.sql',
  ],
  repository: [
    'repository/repository.bundle',
    'repository/repository-state.json',
  ],
  configuration_manifest: [
    'configuration/configuration-inventory.json',
  ],
}

const secretNames = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_STORAGE_S3_ENDPOINT',
  'SUPABASE_STORAGE_S3_REGION',
  'SUPABASE_STORAGE_S3_ACCESS_KEY_ID',
  'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_REGION',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_AGE_RECIPIENT',
]

const configurationDir = join(
  componentsDir,
  'configuration',
)

mkdirSync(configurationDir, {
  recursive: true,
})

const configurationInventory = {
  format_version: 1,
  generated_at: new Date().toISOString(),
  required_environment_names: secretNames,
  values_included: false,
}

writeFileSync(
  join(
    configurationDir,
    'configuration-inventory.json',
  ),
  `${JSON.stringify(
    configurationInventory,
    null,
    2,
  )}\n`,
)

const repositoryDir = join(
  componentsDir,
  'repository',
)

mkdirSync(repositoryDir, {
  recursive: true,
})

function git(args) {
  return execFileSync(
    'git',
    args,
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: [
        'ignore',
        'pipe',
        'pipe',
      ],
    },
  ).trim()
}

let repositoryState

try {
  repositoryState = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    head: git([
      'rev-parse',
      'HEAD',
    ]),
    branch: git([
      'branch',
      '--show-current',
    ]),
    remote_origin:
      (() => {
        try {
          return git([
            'remote',
            'get-url',
            'origin',
          ])
        } catch {
          return null
        }
      })(),
  }
} catch (error) {
  console.error(
    `Unable to inspect Git repository: ${
      error instanceof Error
        ? error.message
        : String(error)
    }`,
  )
  process.exit(1)
}

writeFileSync(
  join(
    repositoryDir,
    'repository-state.json',
  ),
  `${JSON.stringify(
    repositoryState,
    null,
    2,
  )}\n`,
)

const bundlePath = join(
  repositoryDir,
  'repository.bundle',
)

try {
  execFileSync(
    'git',
    [
      'bundle',
      'create',
      bundlePath,
      '--all',
    ],
    {
      cwd: process.cwd(),
      stdio: [
        'ignore',
        'pipe',
        'pipe',
      ],
    },
  )
} catch (error) {
  console.error(
    `Unable to create Git bundle: ${
      error instanceof Error
        ? error.message
        : String(error)
    }`,
  )
  process.exit(1)
}

function collectFiles(root) {
  const results = []

  function walk(current) {
    for (
      const entry
      of readdirSync(
        current,
        {
          withFileTypes: true,
        },
      )
    ) {
      const absolute = join(
        current,
        entry.name,
      )

      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }

      if (entry.isFile()) {
        results.push(absolute)
      }
    }
  }

  if (existsSync(root)) {
    walk(root)
  }

  return results.sort()
}

async function sha256(path) {
  const hash = createHash('sha256')

  await new Promise(
    (resolvePromise, rejectPromise) => {
      const stream = createReadStream(path)

      stream.on(
        'data',
        (chunk) => {
          hash.update(chunk)
        },
      )

      stream.on(
        'error',
        rejectPromise,
      )

      stream.on(
        'end',
        resolvePromise,
      )
    },
  )

  return hash.digest('hex')
}

const files = collectFiles(
  componentsDir,
)

const fileEntries = []

for (const file of files) {
  const stats = statSync(file)

  fileEntries.push({
    path: relative(
      componentsDir,
      file,
    ).replaceAll('\\', '/'),
    bytes: stats.size,
    sha256: await sha256(file),
  })
}

const checksumLines = fileEntries
  .map(
    (entry) =>
      `${entry.sha256}  ${entry.path}`,
  )
  .join('\n')

writeFileSync(
  checksumPath,
  checksumLines
    ? `${checksumLines}\n`
    : '',
)

function componentExists(path) {
  return existsSync(
    join(
      componentsDir,
      path,
    ),
  )
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) {
    return null
  }

  try {
    return JSON.parse(
      readFileSync(
        path,
        'utf8',
      ),
    )
  } catch {
    return null
  }
}

function hasExactKeys(
  value,
  expected,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    return false
  }

  return JSON.stringify(
    Object.keys(value).sort(),
  ) === JSON.stringify(
    [...expected].sort(),
  )
}

const databaseEvidence =
  readJsonIfPresent(
    join(
      metadataDir,
      'database-backup.json',
    ),
  )

const storageEvidence =
  readJsonIfPresent(
    join(
      metadataDir,
      'storage-backup.json',
    ),
  )

const reconciliationPath =
  join(
    metadataDir,
    'database-reconciliation.json',
  )

const reconciliationEvidence =
  readJsonIfPresent(
    reconciliationPath,
  )

const reconciliationTopLevelKeys = [
  'algorithm',
  'copy_format',
  'data_schemas',
  'format_version',
  'platform_managed_exclusions',
  'schema_counts',
  'sequence_count',
  'sequence_state_sha256',
  'source_component',
  'source_schema_presence',
  'table_count',
  'tables',
  'total_row_count',
  'validated',
]

const reconciliationTableKeys = [
  'columns',
  'content_sha256',
  'row_count',
  'schema',
  'table',
]

const reconciliationSourceSchemaPresence =
  reconciliationEvidence?.source_schema_presence

const supabaseFunctionsPresent =
  reconciliationSourceSchemaPresence?.supabase_functions
    === true

const expectedReconciliationSchemas = [
  'auth',
  'public',
  'storage',
  ...(supabaseFunctionsPresent
    ? ['supabase_functions']
    : []),
]

const expectedManagedExclusions = [
  'auth.schema_migrations',
  'storage.migrations',
  ...(supabaseFunctionsPresent
    ? ['supabase_functions.migrations']
    : []),
]

const requiredReconciliationTargets = [
  'auth.users',
  'auth.identities',
  'storage.buckets',
  'storage.objects',
  ...(supabaseFunctionsPresent
    ? ['supabase_functions.hooks']
    : []),
  'public.employee_profiles',
]

const reconciliationTables =
  Array.isArray(
    reconciliationEvidence?.tables,
  )
    ? reconciliationEvidence.tables
    : []

const reconciliationTargets =
  reconciliationTables.map(
    item =>
      `${item?.schema}.${item?.table}`,
  )

const reconciliationTargetSet =
  new Set(
    reconciliationTargets,
  )

const reconciliationEvidenceValid =
  hasExactKeys(
    reconciliationEvidence,
    reconciliationTopLevelKeys,
  )
  && reconciliationEvidence?.format_version === 2
  && reconciliationEvidence?.validated === true
  && reconciliationEvidence?.source_component
    === 'database/data.sql'
  && reconciliationEvidence?.algorithm
    === 'sha256-schema-table-columns-sorted-copy-lines-v1'
  && reconciliationEvidence?.copy_format
    === 'postgres-copy-text'
  && reconciliationSourceSchemaPresence !== null
  && typeof reconciliationSourceSchemaPresence
    === 'object'
  && !Array.isArray(
    reconciliationSourceSchemaPresence,
  )
  && hasExactKeys(
    reconciliationSourceSchemaPresence,
    ['supabase_functions'],
  )
  && typeof reconciliationSourceSchemaPresence
    .supabase_functions
    === 'boolean'
  && JSON.stringify(
    reconciliationEvidence?.data_schemas,
  ) === JSON.stringify(
    expectedReconciliationSchemas,
  )
  && JSON.stringify(
    reconciliationEvidence?.platform_managed_exclusions,
  ) === JSON.stringify(
    expectedManagedExclusions,
  )
  && Number.isInteger(
    reconciliationEvidence?.table_count,
  )
  && reconciliationEvidence.table_count > 0
  && reconciliationTables.length
    === reconciliationEvidence.table_count
  && reconciliationTargetSet.size
    === reconciliationEvidence.table_count
  && Number.isInteger(
    reconciliationEvidence?.total_row_count,
  )
  && reconciliationEvidence.total_row_count >= 0
  && reconciliationTables.reduce(
    (total, item) =>
      total + (
        Number.isInteger(item?.row_count)
          ? item.row_count
          : -1
      ),
    0,
  ) === reconciliationEvidence.total_row_count
  && Number.isInteger(
    reconciliationEvidence?.sequence_count,
  )
  && reconciliationEvidence.sequence_count >= 0
  && typeof reconciliationEvidence?.sequence_state_sha256
    === 'string'
  && /^[0-9a-f]{64}$/.test(
    reconciliationEvidence.sequence_state_sha256,
  )
  && hasExactKeys(
    reconciliationEvidence?.schema_counts,
    expectedReconciliationSchemas,
  )
  && reconciliationTables.every(
    item =>
      hasExactKeys(
        item,
        reconciliationTableKeys,
      )
      && typeof item.schema === 'string'
      && item.schema.length > 0
      && expectedReconciliationSchemas.includes(
        item.schema,
      )
      && typeof item.table === 'string'
      && item.table.length > 0
      && typeof item.columns === 'string'
      && item.columns.length > 0
      && Number.isInteger(
        item.row_count,
      )
      && item.row_count >= 0
      && typeof item.content_sha256
        === 'string'
      && /^[0-9a-f]{64}$/.test(
        item.content_sha256,
      ),
  )
  && expectedReconciliationSchemas.every(
    schema =>
      Number.isInteger(
        reconciliationEvidence.schema_counts[schema],
      )
      && reconciliationEvidence.schema_counts[schema] >= 0
      && reconciliationEvidence.schema_counts[schema]
        === reconciliationTables.filter(
          item => item.schema === schema,
        ).length,
  )
  && requiredReconciliationTargets.every(
    target =>
      reconciliationTargetSet.has(
        target,
      ),
  )
  && expectedManagedExclusions.every(
    target =>
      !reconciliationTargetSet.has(
        target,
      ),
  )

const databaseFilesPresent =
  requiredCoverage.database.every(
    componentExists,
  )

const databaseEvidenceValid =
  databaseEvidence?.validated === true
  && databaseEvidence?.roles_dump === true
  && databaseEvidence?.schema_dump === true
  && databaseEvidence?.data_dump === true
  && databaseEvidence?.sectioned_schema_dump === true
  && databaseEvidence?.sectioned_schema?.validated === true
  && databaseEvidence?.sectioned_schema?.dump_tool === 'pg_dump'
  && databaseEvidence?.sectioned_schema?.postgres_version === '17.6'
  && databaseEvidence?.sectioned_schema?.container_image
    === 'supabase/postgres:17.6.1.165'
  && Array.isArray(
    databaseEvidence?.sectioned_schema?.files,
  )
  && databaseEvidence.sectioned_schema.files.length
    === sectionedSchemaEvidenceFiles.length
  && sectionedSchemaEvidenceFiles.every(
    (file, index) =>
      databaseEvidence.sectioned_schema.files[index]
      === file,
  )
  && databaseEvidence?.reconciliation_ledger?.validated === true
  && databaseEvidence?.reconciliation_ledger?.file
    === 'database-reconciliation.json'
  && databaseEvidence?.reconciliation_ledger?.source_component
    === 'database/data.sql'
  && databaseEvidence?.reconciliation_ledger?.algorithm
    === 'sha256-schema-table-columns-sorted-copy-lines-v1'
  && reconciliationEvidenceValid

const authEvidenceValid =
  databaseEvidenceValid
  && databaseEvidence?.auth_recovery_data === true

const storageEvidenceValid =
  storageEvidence?.format_version === 1
  && storageEvidence?.validated === true
  && storageEvidence?.all_buckets_enumerated === true
  && storageEvidence?.all_objects_copied === true
  && Number.isInteger(
    storageEvidence?.bucket_count,
  )
  && storageEvidence.bucket_count >= 0
  && Number.isInteger(
    storageEvidence?.object_count,
  )
  && storageEvidence.object_count >= 0
  && Number.isInteger(
    storageEvidence?.total_bytes,
  )
  && storageEvidence.total_bytes >= 0
  && Array.isArray(
    storageEvidence?.buckets,
  )
  && storageEvidence.buckets.length
    === storageEvidence.bucket_count
  && storageEvidence.buckets.every(
    (bucket) =>
      bucket !== null
      && typeof bucket === 'object'
      && typeof bucket.name === 'string'
      && bucket.name.length > 0
      && bucket.name !== '.'
      && bucket.name !== '..'
      && bucket.name.indexOf('/') === -1
      && bucket.name.indexOf('\\') === -1
      && Number.isInteger(bucket.objects)
      && bucket.objects >= 0
      && Number.isInteger(bucket.bytes)
      && bucket.bytes >= 0
      && bucket.copy_verified === true,
  )
  && new Set(
    storageEvidence.buckets.map(
      (bucket) => bucket.name,
    ),
  ).size === storageEvidence.buckets.length
  && storageEvidence.buckets.reduce(
    (sum, bucket) => sum + bucket.objects,
    0,
  ) === storageEvidence.object_count
  && storageEvidence.buckets.reduce(
    (sum, bucket) => sum + bucket.bytes,
    0,
  ) === storageEvidence.total_bytes

const reconciliationSha256 =
  reconciliationEvidenceValid
    ? await sha256(
      reconciliationPath,
    )
    : null

const coverage = {
  database:
    databaseFilesPresent
    && databaseEvidenceValid,
  auth:
    requiredCoverage.auth.every(
      componentExists,
    )
    && authEvidenceValid,
  storage:
    componentExists('storage')
    && storageEvidenceValid,
  repository:
    requiredCoverage.repository.every(
      componentExists,
    ),
  configuration_manifest:
    requiredCoverage.configuration_manifest.every(
      componentExists,
    ),
}

const manifest = {
  format_version: 1,
  generated_at: new Date().toISOString(),
  archive_encrypted: false,
  offsite_uploaded: false,
  restore_verified: false,
  coverage,
  database_reconciliation: {
    path:
      'metadata/database-reconciliation.json',
    validated:
      reconciliationEvidenceValid,
    sha256:
      reconciliationSha256,
    source_component:
      'database/data.sql',
    algorithm:
      'sha256-schema-table-columns-sorted-copy-lines-v1',
  },
  repository: repositoryState,
  configuration: {
    inventory_path:
      'configuration/configuration-inventory.json',
    values_included: false,
  },
  components: fileEntries,
}

writeFileSync(
  manifestPath,
  `${JSON.stringify(
    manifest,
    null,
    2,
  )}\n`,
)

console.log(
  JSON.stringify(
    {
      workspace,
      manifest: basename(manifestPath),
      component_count: fileEntries.length,
      coverage,
    },
    null,
    2,
  ),
)

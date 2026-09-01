#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  verify-backup-artifact.sh plan ARTIFACT_PATH OUTPUT_JSON
  verify-backup-artifact.sh run ARTIFACT_PATH OUTPUT_JSON
EOF
}

sha256_file() {
  file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  printf 'ERROR: no SHA-256 utility is available\n' >&2
  return 1
}

require_command() {
  name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'ERROR: required command %s is unavailable\n' \
      "$name" >&2
    return 1
  fi
}

script_dir="$(
  CDPATH= cd -- "$(dirname -- "$0")" &&
    pwd
)"

storage_restore_helper="$script_dir/verify-storage-restore.sh"
database_restore_helper="$script_dir/verify-database-restore.sh"

mode="${1:-}"
artifact_path="${2:-}"
output_json="${3:-}"

if [ -z "$mode" ] ||
   [ -z "$artifact_path" ] ||
   [ -z "$output_json" ]; then
  usage
  exit 2
fi

if [ "$mode" != "plan" ] &&
   [ "$mode" != "run" ]; then
  usage
  exit 2
fi

if [ "$mode" = "plan" ]; then
  cat <<'EOF'
1. Reject production and backup-writer credentials.
2. Require a file-based age private identity.
3. Verify encrypted artifact size and SHA-256.
4. Decrypt into an isolated temporary workspace.
5. Reject unsafe archive members and link/device entries.
6. Validate component checksums.
7. Verify the Git repository bundle.
8. Validate the configuration names-only manifest.
9. Verify authenticated Storage objects through isolated loopback restore.
10. Verify database/Auth semantics through isolated network-disabled PostgreSQL.
11. Hash-bind both restore verification records into artifact inspection evidence.
12. Promote final database/auth/storage claims only after authenticated database/Auth and Storage restore proofs succeed.
EOF
  exit 0
fi

for forbidden in \
  SUPABASE_DB_URL \
  SUPABASE_DB_PASSWORD \
  DATABASE_URL \
  DIRECT_URL \
  SUPABASE_SECRET_KEY \
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID \
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY \
  BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY \
  BACKUP_AGE_PRIVATE_KEY \
  AGE_SECRET_KEY
do
  if [ -n "${!forbidden:-}" ]; then
    printf 'ERROR: forbidden verifier credential is present: %s\n' \
      "$forbidden" >&2
    exit 1
  fi
done

if [ -z "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
  printf 'ERROR: BACKUP_AGE_IDENTITY_FILE is missing\n' >&2
  exit 1
fi

if [ ! -f "$BACKUP_AGE_IDENTITY_FILE" ] ||
   [ ! -s "$BACKUP_AGE_IDENTITY_FILE" ] ||
   [ ! -r "$BACKUP_AGE_IDENTITY_FILE" ]; then
  printf 'ERROR: age identity file is unavailable\n' >&2
  exit 1
fi

require_command age
require_command tar
require_command jq
require_command git
require_command grep
require_command awk
require_command wc
require_command find
require_command sort
require_command uniq
require_command mktemp

if [ "${artifact_path%.age}" = "$artifact_path" ]; then
  printf 'ERROR: restore verifier accepts .age artifacts only\n' >&2
  exit 1
fi

if [ ! -f "$artifact_path" ] ||
   [ ! -s "$artifact_path" ]; then
  printf 'ERROR: encrypted artifact is missing or empty\n' >&2
  exit 1
fi

sidecar_path="${artifact_path}.json"

if [ ! -f "$sidecar_path" ] ||
   [ ! -s "$sidecar_path" ]; then
  printf 'ERROR: artifact sidecar is missing\n' >&2
  exit 1
fi

if ! jq -e '
  .encryption.tool == "age"
  and .encryption.encrypted == true
  and .offsite_uploaded == true
  and .offsite.remote_verified == true
  and .restore_verified == false
  and .coverage.database == true
  and .coverage.auth == true
  and .coverage.storage == true
  and .coverage.repository == true
  and .coverage.configuration_manifest == true
' "$sidecar_path" >/dev/null; then
  printf 'ERROR: artifact sidecar is not restore-verifiable\n' >&2
  exit 1
fi

artifact_name="$(basename "$artifact_path")"

recorded_name="$(
  jq -er '.artifact.name' "$sidecar_path"
)"

recorded_bytes="$(
  jq -er '.artifact.bytes' "$sidecar_path"
)"

recorded_sha256="$(
  jq -er '.artifact.sha256' "$sidecar_path"
)"

recorded_manifest_sha256="$(
  jq -er '.component_manifest_sha256' "$sidecar_path"
)"

if [ "$recorded_name" != "$artifact_name" ]; then
  printf 'ERROR: artifact name does not match sidecar\n' >&2
  exit 1
fi

if ! printf '%s\n' "$recorded_bytes" |
     grep -Eq '^[1-9][0-9]*$'; then
  printf 'ERROR: recorded artifact size is invalid\n' >&2
  exit 1
fi

if ! printf '%s\n' "$recorded_sha256" |
     grep -Eq '^[0-9a-f]{64}$'; then
  printf 'ERROR: recorded artifact SHA-256 is invalid\n' >&2
  exit 1
fi

if ! printf '%s\n' "$recorded_manifest_sha256" |
     grep -Eq '^[0-9a-f]{64}$'; then
  printf 'ERROR: recorded component manifest SHA-256 is invalid\n' >&2
  exit 1
fi

actual_bytes="$(
  wc -c < "$artifact_path" |
    tr -d '[:space:]'
)"

actual_sha256="$(
  sha256_file "$artifact_path"
)"

if [ "$actual_bytes" != "$recorded_bytes" ]; then
  printf 'ERROR: encrypted artifact size mismatch\n' >&2
  exit 1
fi

if [ "$actual_sha256" != "$recorded_sha256" ]; then
  printf 'ERROR: encrypted artifact checksum mismatch\n' >&2
  exit 1
fi

temporary_root="$(mktemp -d)"
decrypted_tar="$temporary_root/recovery.tar"
restore_root="$temporary_root/restored"
member_list="$temporary_root/members.txt"
type_list="$temporary_root/member-types.txt"
seen_paths="$temporary_root/checksum-paths.txt"

cleanup() {
  rm -rf "$temporary_root"
}

trap cleanup EXIT

mkdir -p "$restore_root"

if ! age \
  --decrypt \
  --identity "$BACKUP_AGE_IDENTITY_FILE" \
  --output "$decrypted_tar" \
  "$artifact_path"; then
  printf 'ERROR: age decryption failed\n' >&2
  exit 1
fi

if [ ! -s "$decrypted_tar" ]; then
  printf 'ERROR: decrypted archive is missing or empty\n' >&2
  exit 1
fi

if ! tar -tf "$decrypted_tar" > "$member_list"; then
  printf 'ERROR: decrypted archive cannot be listed\n' >&2
  exit 1
fi

if [ ! -s "$member_list" ]; then
  printf 'ERROR: decrypted archive contains no members\n' >&2
  exit 1
fi

if awk '
  {
    path = $0
    allowed = 0

    if (path == "manifest.json") allowed = 1
    if (path == "components") allowed = 1
    if (path == "components/") allowed = 1
    if (index(path, "components/") == 1) allowed = 1
    if (path == "metadata") allowed = 1
    if (path == "metadata/") allowed = 1
    if (index(path, "metadata/") == 1) allowed = 1

    if (path ~ /^\/+/) bad = 1
    if (path ~ /(^|\/)\.\.(\/|$)/) bad = 1
    if (path ~ /\/\//) bad = 1
    if (!allowed) bad = 1
  }

  END {
    if (bad) exit 1
    exit 0
  }
' "$member_list"; then
  :
else
  printf 'ERROR: unsafe or unexpected archive member detected\n' >&2
  exit 1
fi

if ! tar -tvf "$decrypted_tar" > "$type_list"; then
  printf 'ERROR: decrypted archive member types cannot be read\n' >&2
  exit 1
fi

if awk '
  {
    type = substr($1, 1, 1)

    if (type != "-" && type != "d") {
      bad = 1
    }
  }

  END {
    exit bad
  }
' "$type_list"; then
  :
else
  printf 'ERROR: archive contains link or special-file entry\n' >&2
  exit 1
fi

if ! tar -xf "$decrypted_tar" -C "$restore_root"; then
  printf 'ERROR: decrypted archive extraction failed\n' >&2
  exit 1
fi

manifest="$restore_root/manifest.json"
checksum_inventory="$restore_root/metadata/component-checksums.sha256"
database_evidence="$restore_root/metadata/database-backup.json"
database_reconciliation="$restore_root/metadata/database-reconciliation.json"
storage_evidence="$restore_root/metadata/storage-backup.json"
configuration_inventory="$restore_root/components/configuration/configuration-inventory.json"
repository_bundle="$restore_root/components/repository/repository.bundle"

for required in \
  "$manifest" \
  "$checksum_inventory" \
  "$database_evidence" \
  "$database_reconciliation" \
  "$storage_evidence" \
  "$configuration_inventory" \
  "$repository_bundle" \
  "$restore_root/components/database/roles.sql" \
  "$restore_root/components/database/schema.sql" \
  "$restore_root/components/database/data.sql" \
  "$restore_root/components/database/auth-data.sql" \
  "$restore_root/components/database/auth-pre.sql" \
  "$restore_root/components/database/auth-post.sql" \
  "$restore_root/components/database/storage-pre.sql" \
  "$restore_root/components/database/storage-post.sql" \
  "$restore_root/components/database/supabase-functions-pre.sql" \
  "$restore_root/components/database/supabase-functions-post.sql" \
  "$restore_root/components/database/public-pre.sql" \
  "$restore_root/components/database/public-post.sql"
do
  if [ ! -s "$required" ]; then
    printf 'ERROR: required recovery component is missing: %s\n' \
      "$required" >&2
    exit 1
  fi
done

actual_manifest_sha256="$(
  sha256_file "$manifest"
)"

if [ "$actual_manifest_sha256" != "$recorded_manifest_sha256" ]; then
  printf 'ERROR: component manifest SHA-256 does not match sidecar\n' >&2
  exit 1
fi

if ! jq -e '
  .archive_encrypted == false
  and .offsite_uploaded == false
  and .restore_verified == false
  and .coverage.database == true
  and .coverage.auth == true
  and .coverage.storage == true
  and .coverage.repository == true
  and .coverage.configuration_manifest == true
  and .database_reconciliation.path
    == "metadata/database-reconciliation.json"
  and .database_reconciliation.validated == true
  and (
    .database_reconciliation.sha256
    | test("^[0-9a-f]{64}$")
  )
  and .database_reconciliation.source_component
    == "database/data.sql"
  and .database_reconciliation.algorithm
    == "sha256-schema-table-columns-sorted-copy-lines-v1"
' "$manifest" >/dev/null; then
  printf 'ERROR: internal recovery manifest is invalid\n' >&2
  exit 1
fi

recorded_reconciliation_sha256="$(
  jq -er \
    '.database_reconciliation.sha256' \
    "$manifest"
)"

actual_reconciliation_sha256="$(
  sha256_file \
    "$database_reconciliation"
)"

if [ "$actual_reconciliation_sha256" != "$recorded_reconciliation_sha256" ]; then
  printf 'ERROR: database reconciliation SHA-256 does not match manifest\n' >&2
  exit 1
fi

if ! jq -e '
  (.components | type == "array")
  and (.components | length > 0)
  and all(
    .components[];
    (.path | type == "string")
    and (.path | length > 0)
    and (.bytes | type == "number")
    and (.bytes >= 0)
    and (.sha256 | type == "string")
    and (.sha256 | test("^[0-9a-f]{64}$"))
  )
' "$manifest" >/dev/null; then
  printf 'ERROR: component manifest ledger is invalid\n' >&2
  exit 1
fi

: > "$seen_paths"

while IFS= read -r line; do
  [ -n "$line" ] || continue

  checksum="${line%%  *}"
  relative_path="${line#*  }"

  if ! printf '%s\n' "$checksum" |
       grep -Eq '^[0-9a-f]{64}$'; then
    printf 'ERROR: invalid component checksum entry\n' >&2
    exit 1
  fi

  if [ "$relative_path" = "$line" ] ||
     [ -z "$relative_path" ]; then
    printf 'ERROR: invalid component checksum path\n' >&2
    exit 1
  fi

  if [ "${relative_path#/}" != "$relative_path" ] ||
     printf '%s\n' "$relative_path" |
       grep -Eq '(^|/)\.\.(/|$)|//'; then
    printf 'ERROR: unsafe component checksum path\n' >&2
    exit 1
  fi

  component_file="$restore_root/components/$relative_path"

  if [ ! -f "$component_file" ]; then
    printf 'ERROR: checksummed component is missing: %s\n' \
      "$relative_path" >&2
    exit 1
  fi

  actual_component_sha="$(
    sha256_file "$component_file"
  )"

  if [ "$actual_component_sha" != "$checksum" ]; then
    printf 'ERROR: component checksum mismatch: %s\n' \
      "$relative_path" >&2
    exit 1
  fi

  manifest_entry_count="$(
    jq \
      --arg path "$relative_path" \
      '[
        .components[]
        | select(.path == $path)
      ] | length' \
      "$manifest"
  )"

  if [ "$manifest_entry_count" -ne 1 ]; then
    printf 'ERROR: component manifest path is missing or duplicated: %s\n' \
      "$relative_path" >&2
    exit 1
  fi

  manifest_component_sha="$(
    jq -er \
      --arg path "$relative_path" \
      '.components[]
       | select(.path == $path)
       | .sha256' \
      "$manifest"
  )"

  manifest_component_bytes="$(
    jq -er \
      --arg path "$relative_path" \
      '.components[]
       | select(.path == $path)
       | .bytes' \
      "$manifest"
  )"

  actual_component_bytes="$(
    wc -c < "$component_file" |
      tr -d '[:space:]'
  )"

  if [ "$manifest_component_sha" != "$checksum" ]; then
    printf 'ERROR: checksum inventory disagrees with component manifest: %s\n' \
      "$relative_path" >&2
    exit 1
  fi

  if [ "$manifest_component_sha" != "$actual_component_sha" ]; then
    printf 'ERROR: component manifest SHA-256 disagrees with file: %s\n' \
      "$relative_path" >&2
    exit 1
  fi

  if [ "$manifest_component_bytes" != "$actual_component_bytes" ]; then
    printf 'ERROR: component byte count disagrees with manifest: %s\n' \
      "$relative_path" >&2
    exit 1
  fi

  printf '%s\n' "$relative_path" >> "$seen_paths"
done < "$checksum_inventory"

if [ -n "$(
  sort "$seen_paths" |
    uniq -d
)" ]; then
  printf 'ERROR: duplicate component checksum path detected\n' >&2
  exit 1
fi

actual_component_count="$(
  find "$restore_root/components" \
    -type f \
    -print |
    wc -l |
    tr -d '[:space:]'
)"

checksum_component_count="$(
  wc -l < "$seen_paths" |
    tr -d '[:space:]'
)"

if [ "$actual_component_count" != "$checksum_component_count" ]; then
  printf 'ERROR: component checksum inventory is incomplete\n' >&2
  exit 1
fi

manifest_component_count="$(
  jq -er '.components | length' "$manifest"
)"

if [ "$actual_component_count" != "$manifest_component_count" ]; then
  printf 'ERROR: component manifest inventory is incomplete\n' >&2
  exit 1
fi

if [ "$checksum_component_count" != "$manifest_component_count" ]; then
  printf 'ERROR: checksum and manifest component inventories disagree\n' >&2
  exit 1
fi

if ! git bundle verify "$repository_bundle" >/dev/null 2>&1; then
  printf 'ERROR: repository bundle verification failed\n' >&2
  exit 1
fi

if ! jq -e '
  .format_version == 1
  and .values_included == false
  and (.required_environment_names | type == "array")
  and (.required_environment_names | length > 0)
  and (
    .required_environment_names
    | all(type == "string" and length > 0)
  )
  and (
    keys
    == [
      "format_version",
      "generated_at",
      "required_environment_names",
      "values_included"
    ]
  )
' "$configuration_inventory" >/dev/null; then
  printf 'ERROR: configuration manifest is invalid\n' >&2
  exit 1
fi

if ! jq -e '
  .validated == true
  and .roles_dump == true
  and .schema_dump == true
  and .data_dump == true
  and .auth_dump == true
  and .sectioned_schema_dump == true
  and .sectioned_schema.validated == true
  and .sectioned_schema.dump_tool == "pg_dump"
  and .sectioned_schema.postgres_version == "17.6"
  and .sectioned_schema.container_image
    == "supabase/postgres:17.6.1.165"
  and .sectioned_schema.files == [
    "auth-pre.sql",
    "auth-post.sql",
    "storage-pre.sql",
    "storage-post.sql",
    "supabase-functions-pre.sql",
    "supabase-functions-post.sql",
    "public-pre.sql",
    "public-post.sql"
  ]
  and .reconciliation_ledger.validated == true
  and .reconciliation_ledger.file
    == "database-reconciliation.json"
  and .reconciliation_ledger.source_component
    == "database/data.sql"
  and .reconciliation_ledger.algorithm
    == "sha256-schema-table-columns-sorted-copy-lines-v1"
  and .auth_recovery_data == true
' "$database_evidence" >/dev/null; then
  printf 'ERROR: database recovery evidence is invalid\n' >&2
  exit 1
fi

if ! jq -e '
  . as $root
  | (
      [
        .tables[]
        | (
            .schema
            + "."
            + .table
          )
      ]
    ) as $targets
  | (
      .format_version == 1
      and .validated == true
      and .source_component == "database/data.sql"
      and .algorithm
        == "sha256-schema-table-columns-sorted-copy-lines-v1"
      and .copy_format == "postgres-copy-text"
      and .data_schemas == [
        "auth",
        "public",
        "storage",
        "supabase_functions"
      ]
      and .platform_managed_exclusions == [
        "auth.schema_migrations",
        "storage.migrations",
        "supabase_functions.migrations"
      ]
      and (
        keys
        | sort
      ) == (
        [
          "algorithm",
          "copy_format",
          "data_schemas",
          "format_version",
          "platform_managed_exclusions",
          "schema_counts",
          "sequence_count",
          "sequence_state_sha256",
          "source_component",
          "table_count",
          "tables",
          "total_row_count",
          "validated"
        ]
        | sort
      )
      and (.table_count | type == "number")
      and (.table_count > 0)
      and (.tables | type == "array")
      and ((.tables | length) == .table_count)
      and (($targets | unique | length) == .table_count)
      and (.total_row_count | type == "number")
      and (.total_row_count >= 0)
      and (
        (
          [
            .tables[].row_count
          ]
          | add
        ) // 0
      ) == .total_row_count
      and (.sequence_count | type == "number")
      and (.sequence_count >= 0)
      and (
        .sequence_state_sha256
        | test("^[0-9a-f]{64}$")
      )
      and (
        .schema_counts
        | keys
        | sort
      ) == [
        "auth",
        "public",
        "storage",
        "supabase_functions"
      ]
      and all(
        .tables[];
        (
          keys
          | sort
        ) == (
          [
            "columns",
            "content_sha256",
            "row_count",
            "schema",
            "table"
          ]
          | sort
        )
        and (.schema | type == "string")
        and (.schema | length > 0)
        and (
          .schema
          | IN(
              "auth",
              "public",
              "storage",
              "supabase_functions"
            )
        )
        and (.table | type == "string")
        and (.table | length > 0)
        and (.columns | type == "string")
        and (.columns | length > 0)
        and (.row_count | type == "number")
        and (.row_count >= 0)
        and (
          .content_sha256
          | test("^[0-9a-f]{64}$")
        )
      )
      and (
        .schema_counts.auth
        == (
          [
            .tables[]
            | select(.schema == "auth")
          ]
          | length
        )
      )
      and (
        .schema_counts.public
        == (
          [
            .tables[]
            | select(.schema == "public")
          ]
          | length
        )
      )
      and (
        .schema_counts.storage
        == (
          [
            .tables[]
            | select(.schema == "storage")
          ]
          | length
        )
      )
      and (
        .schema_counts.supabase_functions
        == (
          [
            .tables[]
            | select(.schema == "supabase_functions")
          ]
          | length
        )
      )
      and (
        [
          "auth.users",
          "auth.identities",
          "storage.buckets",
          "storage.objects",
          "supabase_functions.hooks",
          "public.employee_profiles"
        ]
        - $targets
        | length
      ) == 0
      and (
        [
          "auth.schema_migrations",
          "storage.migrations",
          "supabase_functions.migrations"
        ]
        | all(
            . as $excluded
            | (
                $targets
                | index($excluded)
              )
              == null
          )
      )
    )
' "$database_reconciliation" >/dev/null; then
  printf 'ERROR: database reconciliation evidence is invalid\n' >&2
  exit 1
fi

if ! jq -e '
  . as $root
  | .format_version == 1
  and .validated == true
  and .all_buckets_enumerated == true
  and .all_objects_copied == true
  and (.bucket_count | type == "number")
  and (.bucket_count | floor == .)
  and .bucket_count >= 0
  and (.object_count | type == "number")
  and (.object_count | floor == .)
  and .object_count >= 0
  and (.total_bytes | type == "number")
  and (.total_bytes | floor == .)
  and .total_bytes >= 0
  and (.buckets | type == "array")
  and ((.buckets | length) == .bucket_count)
  and all(
    .buckets[];
    type == "object"
    and (.name | type == "string")
    and (.name | length > 0)
    and (.name != ".")
    and (.name != "..")
    and (.name | index("/") == null)
    and (.name | index("\\") == null)
    and (.objects | type == "number")
    and (.objects | floor == .)
    and .objects >= 0
    and (.bytes | type == "number")
    and (.bytes | floor == .)
    and .bytes >= 0
    and .copy_verified == true
  )
  and (
    (
      [.buckets[].name]
      | unique
      | length
    )
    == $root.bucket_count
  )
  and (
    (
      [.buckets[].objects]
      | add // 0
    )
    == $root.object_count
  )
  and (
    (
      [.buckets[].bytes]
      | add // 0
    )
    == $root.total_bytes
  )
' "$storage_evidence" >/dev/null; then
  printf 'ERROR: Storage recovery evidence is invalid\n' >&2
  exit 1
fi

echo
echo "=== AUTHENTICATED STORAGE RESTORE PROOF ==="

if [ ! -f "$storage_restore_helper" ] ||
   [ ! -r "$storage_restore_helper" ]; then
  printf 'ERROR: Storage restore verifier helper is unavailable\n' >&2
  exit 1
fi

storage_restore_evidence="$temporary_root/storage-restore-verification.json"

rm -f "$storage_restore_evidence"

if bash   "$storage_restore_helper"   run   "$restore_root"   "$storage_restore_evidence"
then
  printf 'PASS: authenticated artifact Storage restore helper completed\n'
else
  printf 'ERROR: authenticated artifact Storage restore helper failed\n' >&2
  exit 1
fi

if [ ! -f "$storage_restore_evidence" ] ||
   [ ! -s "$storage_restore_evidence" ]; then
  printf 'ERROR: Storage restore proof evidence is missing\n' >&2
  exit 1
fi

if jq -e   --slurpfile source "$storage_evidence"   '
    ($source | length) == 1
    and .format_version == 1
    and .validated == true
    and .verifier == "rclone-loopback-s3"
    and (.verifier_version | type == "string")
    and (.verifier_version | length > 0)
    and (.verified_at | type == "string")
    and (.verified_at | length > 0)
    and (.isolated_target | type == "object")
    and .isolated_target.loopback_only == true
    and .isolated_target.wildcard_listener == false
    and .bucket_inventory_exact == true
    and .object_inventory_exact == true
    and .object_counts_verified == true
    and .byte_counts_verified == true
    and .object_content_verified == true
    and .empty_bucket_preservation_verified == true
    and .storage_object_restore_verified == true
    and .production_storage_contacted == false
    and (.bucket_count | type == "number")
    and (.bucket_count | floor == .)
    and .bucket_count >= 0
    and (.empty_bucket_count | type == "number")
    and (.empty_bucket_count | floor == .)
    and .empty_bucket_count >= 0
    and (.object_count | type == "number")
    and (.object_count | floor == .)
    and .object_count >= 0
    and (.total_bytes | type == "number")
    and (.total_bytes | floor == .)
    and .total_bytes >= 0
    and (.buckets | type == "array")
    and (.buckets | length) == .bucket_count
    and .bucket_count == $source[0].bucket_count
    and .object_count == $source[0].object_count
    and .total_bytes == $source[0].total_bytes
    and .empty_bucket_count
      == (
        [
          $source[0].buckets[]
          | select(.objects == 0)
        ]
        | length
      )
    and all(
      .buckets[];
      (.name | type == "string")
      and (.objects | type == "number")
      and (.bytes | type == "number")
      and .inventory_verified == true
      and .content_verified == true
    )
    and (
      [
        .buckets[]
        | {
            name,
            objects,
            bytes
          }
      ]
      | sort_by(.name)
    )
    == (
      [
        $source[0].buckets[]
        | {
            name,
            objects,
            bytes
          }
      ]
      | sort_by(.name)
    )
  '   "$storage_restore_evidence"   >/dev/null
then
  printf 'PASS: Storage restore proof matches authenticated artifact contract\n'
else
  printf 'ERROR: Storage restore proof does not match authenticated artifact\n' >&2
  exit 1
fi

storage_restore_evidence_sha256="$(
  sha256_file "$storage_restore_evidence"
)"

if printf '%s\n' "$storage_restore_evidence_sha256" |
   grep -Eq '^[0-9a-f]{64}$'
then
  printf 'PASS: Storage restore proof SHA-256 recorded\n'
else
  printf 'ERROR: Storage restore proof SHA-256 is invalid\n' >&2
  exit 1
fi


echo
echo "=== AUTHENTICATED DATABASE + AUTH RESTORE PROOF ==="

if [ ! -f "$database_restore_helper" ] ||
   [ ! -r "$database_restore_helper" ]; then
  printf 'ERROR: database restore verifier helper is unavailable\n' >&2
  exit 1
fi

database_restore_evidence="$temporary_root/database-restore-verification.json"

rm -f "$database_restore_evidence"

if env \
  -u SUPABASE_DB_URL \
  -u SUPABASE_DB_PASSWORD \
  -u DATABASE_URL \
  -u DIRECT_URL \
  bash \
    "$database_restore_helper" \
    semantic \
    "$restore_root" \
    "$database_restore_evidence"
then
  printf 'PASS: authenticated artifact database restore helper completed\n'
else
  printf 'ERROR: authenticated artifact database restore helper failed\n' >&2
  exit 1
fi

if [ ! -f "$database_restore_evidence" ] ||
   [ ! -s "$database_restore_evidence" ]; then
  printf 'ERROR: database restore proof evidence is missing\n' >&2
  exit 1
fi

if jq -e \
  --slurpfile source "$database_reconciliation" \
  --arg expected_sha256 "$actual_reconciliation_sha256" \
  '
    ($source | length) == 1
    and .format_version == 1
    and .verifier
      == "ridearrivo-database-restore-verifier"
    and (.verified_at | type == "string")
    and (.verified_at | length > 0)

    and .database_restore_verified == true
    and .auth_restore_verified == true
    and .storage_database_metadata_verified == true
    and .production_database_contacted == false

    and (.isolated_target | type == "object")
    and .isolated_target.network_disabled == true
    and .isolated_target.ports_published == false
    and .isolated_target.external_network_interface_present
      == false
    and .isolated_target.cleanup_verified == true
    and .isolated_target.image_reference
      == "supabase/postgres:17.6.1.165"
    and (
      .isolated_target.image_id
      | test("^sha256:[0-9a-f]{64}$")
    )

    and (.reconciliation | type == "object")
    and .reconciliation.source_component
      == "metadata/database-reconciliation.json"
    and .reconciliation.exact == true

    and .reconciliation.algorithm
      == $source[0].algorithm

    and .reconciliation.artifact_sha256
      == $expected_sha256
    and .reconciliation.target_sha256
      == $expected_sha256

    and .reconciliation.table_count
      == $source[0].table_count

    and .reconciliation.total_row_count
      == $source[0].total_row_count

    and .reconciliation.sequence_count
      == $source[0].sequence_count

    and .reconciliation.sequence_state_sha256
      == $source[0].sequence_state_sha256
  ' \
  "$database_restore_evidence" \
  >/dev/null
then
  printf 'PASS: database restore proof matches authenticated artifact contract\n'
else
  printf 'ERROR: database restore proof does not match authenticated artifact\n' >&2
  exit 1
fi

database_restore_evidence_sha256="$(
  sha256_file "$database_restore_evidence"
)"

if printf '%s\n' "$database_restore_evidence_sha256" |
   grep -Eq '^[0-9a-f]{64}$'
then
  printf 'PASS: database restore proof SHA-256 recorded\n'
else
  printf 'ERROR: database restore proof SHA-256 is invalid\n' >&2
  exit 1
fi

temporary_output="${output_json}.partial.$$"

jq -n \
  --arg artifact_sha256 "$actual_sha256" \
  --arg database_restore_evidence_sha256 "$database_restore_evidence_sha256" \
  --arg database_reconciliation_sha256 "$actual_reconciliation_sha256" \
  --arg storage_restore_evidence_sha256 "$storage_restore_evidence_sha256" \
  --arg verified_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  '{
    format_version: 1,
    verified_at: $verified_at,
    artifact_sha256: $artifact_sha256,
    checksum_verified: true,
    decryption_verified: true,
    database_restore: true,
    auth_restore: true,
    storage_restore: true,

    database_restore_verification: {
      executed: true,
      authenticated_artifact_sha256:
        $artifact_sha256,
      evidence_sha256:
        $database_restore_evidence_sha256,
      reconciliation_sha256:
        $database_reconciliation_sha256,
      isolated_database_restore_verified: true,
      auth_restore_verified: true,
      storage_database_metadata_verified: true,
      production_database_contacted: false,
      final_claim_promoted: true
    },

    storage_restore_verification: {
      executed: true,
      authenticated_artifact_sha256: $artifact_sha256,
      evidence_sha256: $storage_restore_evidence_sha256,
      isolated_restore_verified: true,
      production_storage_contacted: false,
      final_claim_promoted: true
    },
    repository_available: true,
    configuration_manifest_valid: true,
    artifact_inspection_completed: true
  }' \
  > "$temporary_output"

mv "$temporary_output" "$output_json"

printf 'PASS: encrypted recovery artifact inspected successfully\n'
printf 'EVIDENCE: %s\n' "$output_json"

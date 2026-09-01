#!/usr/bin/env bash

set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  database-backup.sh plan WORKSPACE_DIR
  database-backup.sh run WORKSPACE_DIR
EOF
}

require_command() {
  name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'ERROR: required command %s is unavailable\n' "$name" >&2
    return 1
  fi
}

nonempty_file() {
  [ -f "$1" ] && [ -s "$1" ]
}

contains_auth_table() {
  table_name="$1"
  file_name="$2"

  grep -Fq "auth.${table_name}" "$file_name" ||
    grep -Fq "\"auth\".\"${table_name}\"" "$file_name"
}

script_dir="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

sectioned_helper="$script_dir/sectioned-schema-backup.sh"
reconciliation_helper="$script_dir/build-database-reconciliation.mjs"

mode="${1:-}"
workspace="${2:-}"

if [ -z "$mode" ] || [ -z "$workspace" ]; then
  usage
  exit 2
fi

case "$mode" in
  plan|run)
    ;;
  *)
    usage
    exit 2
    ;;
esac

db_dir="$workspace/components/database"
metadata_dir="$workspace/metadata"

roles_file="$db_dir/roles.sql"
schema_file="$db_dir/schema.sql"
data_file="$db_dir/data.sql"
auth_file="$db_dir/auth-data.sql"

auth_pre="$db_dir/auth-pre.sql"
auth_post="$db_dir/auth-post.sql"
storage_pre="$db_dir/storage-pre.sql"
storage_post="$db_dir/storage-post.sql"
sf_pre="$db_dir/supabase-functions-pre.sql"
sf_post="$db_dir/supabase-functions-post.sql"
public_pre="$db_dir/public-pre.sql"
public_post="$db_dir/public-post.sql"

section_files=(
  "$auth_pre"
  "$auth_post"
  "$storage_pre"
  "$storage_post"
  "$sf_pre"
  "$sf_post"
  "$public_pre"
  "$public_post"
)

evidence_file="$metadata_dir/database-backup.json"
reconciliation_file="$metadata_dir/database-reconciliation.json"

mkdir -p "$db_dir" "$metadata_dir"

print_plan() {
  cat <<EOF
supabase db dump --db-url "\$SUPABASE_DB_URL" -f "$roles_file" --role-only
supabase db dump --db-url "\$SUPABASE_DB_URL" -f "$schema_file"
supabase db dump --db-url "\$SUPABASE_DB_URL" -f "$data_file" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "\$SUPABASE_DB_URL" -f "$auth_file" --use-copy --data-only --schema auth
"$sectioned_helper" run "$workspace"
node "$reconciliation_helper" "$data_file" "$reconciliation_file"
EOF
}

if [ "$mode" = "plan" ]; then
  print_plan
  exit 0
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  printf 'ERROR: SUPABASE_DB_URL is missing\n' >&2
  exit 1
fi

if [ ! -x "$sectioned_helper" ]; then
  printf 'ERROR: sectioned schema helper is missing or not executable\n' >&2
  exit 1
fi

if [ ! -x "$reconciliation_helper" ]; then
  printf 'ERROR: database reconciliation helper is missing or not executable\n' >&2
  exit 1
fi

require_command supabase
require_command jq
require_command grep
require_command node

rm -f \
  "$roles_file" \
  "$schema_file" \
  "$data_file" \
  "$auth_file" \
  "${section_files[@]}" \
  "$evidence_file" \
  "$reconciliation_file"

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  -f "$roles_file" \
  --role-only

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  -f "$schema_file"

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  -f "$data_file" \
  --use-copy \
  --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes"

supabase db dump \
  --db-url "$SUPABASE_DB_URL" \
  -f "$auth_file" \
  --use-copy \
  --data-only \
  --schema auth

validation_failed=0

if nonempty_file "$roles_file"; then
  printf 'PASS: roles dump created\n'
else
  printf 'ERROR: roles dump is missing or empty\n' >&2
  validation_failed=1
fi

if nonempty_file "$schema_file"; then
  printf 'PASS: schema dump created\n'
else
  printf 'ERROR: schema dump is missing or empty\n' >&2
  validation_failed=1
fi

if nonempty_file "$data_file"; then
  printf 'PASS: data dump created\n'
else
  printf 'ERROR: data dump is missing or empty\n' >&2
  validation_failed=1
fi

if nonempty_file "$auth_file"; then
  printf 'PASS: dedicated Auth data dump created\n'
else
  printf 'ERROR: dedicated Auth data dump is missing or empty\n' >&2
  validation_failed=1
fi

auth_users_present=false
auth_identities_present=false

if nonempty_file "$auth_file"; then
  if contains_auth_table users "$auth_file"; then
    auth_users_present=true
  fi

  if contains_auth_table identities "$auth_file"; then
    auth_identities_present=true
  fi
fi

if [ "$auth_users_present" = true ] &&
   [ "$auth_identities_present" = true ]; then
  printf 'PASS: Auth recovery sections detected\n'
else
  printf 'ERROR: required Auth recovery sections were not detected\n' >&2
  validation_failed=1
fi

sectioned_schema_valid=false

if [ "$validation_failed" -eq 0 ]; then
  if "$sectioned_helper" run "$workspace"; then
    sectioned_schema_valid=true
    printf 'PASS: sectioned schema recovery capture completed\n'
  else
    printf 'ERROR: sectioned schema recovery capture failed\n' >&2
    validation_failed=1
  fi
fi

if [ "$sectioned_schema_valid" = true ]; then
  for section_file in "${section_files[@]}"; do
    if nonempty_file "$section_file"; then
      printf 'PASS: sectioned recovery component present: %s\n' \
        "$(basename "$section_file")"
    else
      printf 'ERROR: sectioned recovery component missing: %s\n' \
        "$(basename "$section_file")" >&2
      validation_failed=1
    fi
  done
fi

reconciliation_valid=false

if [ "$validation_failed" -eq 0 ]; then
  if node \
    "$reconciliation_helper" \
    "$data_file" \
    "$reconciliation_file"
  then
    if jq -e '
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
      and (.table_count | type == "number")
      and (.table_count > 0)
      and (.total_row_count | type == "number")
      and (.total_row_count >= 0)
      and (.sequence_count | type == "number")
      and (.sequence_count >= 0)
      and (
        .sequence_state_sha256
        | test("^[0-9a-f]{64}$")
      )
      and (.tables | type == "array")
      and (
        (.tables | length)
        == .table_count
      )
      and all(
        .tables[];
        (
          .schema
          | type == "string"
        )
        and (
          .table
          | type == "string"
        )
        and (
          .columns
          | type == "string"
        )
        and (
          .row_count
          | type == "number"
        )
        and (
          .row_count >= 0
        )
        and (
          .content_sha256
          | test("^[0-9a-f]{64}$")
        )
      )
    ' "$reconciliation_file" \
      >/dev/null
    then
      reconciliation_valid=true
      printf 'PASS: database semantic reconciliation ledger validated\n'
    else
      printf 'ERROR: database reconciliation ledger is invalid\n' >&2
      validation_failed=1
    fi
  else
    printf 'ERROR: database reconciliation ledger generation failed\n' >&2
    validation_failed=1
  fi
fi

if [ "$validation_failed" -ne 0 ]; then
  rm -f \
    "$evidence_file" \
    "$reconciliation_file" \
    "${section_files[@]}"
  printf 'ERROR: database backup validation failed\n' >&2
  exit 1
fi

generated_at="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

temporary_evidence="${evidence_file}.tmp"

jq -n \
  --arg generated_at "$generated_at" \
  --argjson auth_users "$auth_users_present" \
  --argjson auth_identities "$auth_identities_present" \
  --argjson sectioned_schema "$sectioned_schema_valid" \
  --argjson reconciliation "$reconciliation_valid" \
  '{
    format_version: 1,
    generated_at: $generated_at,
    validated: true,
    dump_tool: "supabase db dump",
    roles_dump: true,
    schema_dump: true,
    data_dump: true,
    auth_dump: true,
    sectioned_schema_dump: $sectioned_schema,
    sectioned_schema: {
      validated: $sectioned_schema,
      dump_tool: "pg_dump",
      postgres_version: "17.6",
      container_image:
        "supabase/postgres:17.6.1.165",
      files: [
        "auth-pre.sql",
        "auth-post.sql",
        "storage-pre.sql",
        "storage-post.sql",
        "supabase-functions-pre.sql",
        "supabase-functions-post.sql",
        "public-pre.sql",
        "public-post.sql"
      ]
    },
    reconciliation_ledger: {
      validated: $reconciliation,
      file: "database-reconciliation.json",
      source_component: "database/data.sql",
      algorithm:
        "sha256-schema-table-columns-sorted-copy-lines-v1"
    },
    auth_recovery_data:
      ($auth_users and $auth_identities),
    auth_sections: {
      users: $auth_users,
      identities: $auth_identities
    },
    auth_dump_options: {
      schema: "auth",
      data_only: true,
      use_copy: true,
      restore_source: false,
      purpose: "independent Auth recovery provenance"
    },
    data_dump_options: {
      use_copy: true,
      excluded_tables: [
        "storage.buckets_vectors",
        "storage.vector_indexes"
      ]
    }
  }' > "$temporary_evidence"

mv "$temporary_evidence" "$evidence_file"

printf 'PASS: database backup evidence created\n'

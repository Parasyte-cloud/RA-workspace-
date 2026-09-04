#!/usr/bin/env bash

set -u

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

fake_bin="$(mktemp -d)"
workspace="$(mktemp -d)"
log_file="$(mktemp)"
failures=0

test_admin_backup="$fake_bin/admin-backup"
database_backup="$test_admin_backup/database-backup.sh"

mkdir -p "$test_admin_backup"

cp \
  "$repo/scripts/admin-backup/database-backup.sh" \
  "$database_backup"

cp \
  "$repo/scripts/admin-backup/build-database-reconciliation.mjs" \
  "$test_admin_backup/build-database-reconciliation.mjs"

cat > "$test_admin_backup/sectioned-schema-backup.sh" <<'FAKE_SECTIONED'
#!/usr/bin/env bash

set -eu

mode="${1:-}"
workspace="${2:-}"

if [ "$mode" = "plan" ]; then
  echo "FAKE SECTIONED SCHEMA HELPER PLAN"
  exit 0
fi

if [ "$mode" != "run" ] ||
   [ -z "$workspace" ]; then
  exit 2
fi

db_dir="$workspace/components/database"

mkdir -p "$db_dir"

for section_file in \
  auth-pre.sql \
  auth-post.sql \
  storage-pre.sql \
  storage-post.sql \
  supabase-functions-pre.sql \
  supabase-functions-post.sql \
  public-pre.sql \
  public-post.sql
do
  printf '%s\n' \
    "-- synthetic sectioned recovery component: $section_file" \
    > "$db_dir/$section_file"
done

echo "PASS: fake sectioned schema recovery capture"
FAKE_SECTIONED

chmod +x \
  "$database_backup" \
  "$test_admin_backup/sectioned-schema-backup.sh" \
  "$test_admin_backup/build-database-reconciliation.mjs"

cleanup() {
  rm -rf \
    "$fake_bin" \
    "$workspace"

  rm -f "$log_file"
}

trap cleanup EXIT

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

cat > "$fake_bin/supabase" <<'FAKE'
#!/usr/bin/env bash

set -eu

printf '%s' 'supabase' >> "$FAKE_SUPABASE_LOG"

for arg in "$@"; do
  printf ' %s' "$arg" >> "$FAKE_SUPABASE_LOG"
done

printf '\n' >> "$FAKE_SUPABASE_LOG"

if [ "${1:-}" != "db" ] ||
   [ "${2:-}" != "dump" ]; then
  printf 'unsupported fake supabase invocation\n' >&2
  exit 2
fi

shift 2

output=""
role_only=false
data_only=false
schema=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -f)
      output="${2:-}"
      shift 2
      ;;

    --db-url)
      shift 2
      ;;

    --role-only)
      role_only=true
      shift
      ;;

    --data-only)
      data_only=true
      shift
      ;;

    --use-copy)
      shift
      ;;

    --schema)
      schema="${2:-}"
      shift 2
      ;;

    -x)
      shift 2
      ;;

    *)
      shift
      ;;
  esac
done

if [ -z "$output" ]; then
  printf 'fake supabase: output path missing\n' >&2
  exit 3
fi

mkdir -p "$(dirname "$output")"

case "$(basename "$output")" in
  roles.sql)
    [ "$role_only" = true ] || exit 10

    cat > "$output" <<'SQL'
-- synthetic role dump
CREATE ROLE synthetic_backup_role;
SQL
    ;;

  schema.sql)
    cat > "$output" <<'SQL'
-- synthetic schema dump
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.synthetic_backup (
  id uuid
);
SQL
    ;;

  data.sql)
    [ "$data_only" = true ] || exit 11

    if [ "${FAKE_RECONCILIATION_INCOMPLETE:-0}" = "1" ]; then
      cat > "$output" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
\.
COPY "auth"."identities" ("id") FROM stdin;
\.
COPY "public"."synthetic_backup" ("id") FROM stdin;
00000000-0000-0000-0000-000000000001
\.
COPY "public"."employee_profiles" ("id") FROM stdin;
\.
COPY "storage"."buckets" ("id") FROM stdin;
\.
COPY "supabase_functions"."hooks" ("id") FROM stdin;
\.
SQL
    else
      cat > "$output" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
\.
COPY "auth"."identities" ("id") FROM stdin;
\.
COPY "public"."synthetic_backup" ("id") FROM stdin;
00000000-0000-0000-0000-000000000001
\.
COPY "public"."employee_profiles" ("id") FROM stdin;
\.
COPY "storage"."buckets" ("id") FROM stdin;
\.
COPY "storage"."objects" ("id") FROM stdin;
\.
COPY "supabase_functions"."hooks" ("id") FROM stdin;
\.
SQL
    fi
    ;;

  auth-data.sql)
    [ "$data_only" = true ] || exit 12
    [ "$schema" = "auth" ] || exit 13

    if [ "${FAKE_AUTH_INCOMPLETE:-0}" = "1" ]; then
      cat > "$output" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
\.
SQL
    else
      cat > "$output" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
\.
COPY "auth"."identities" ("id") FROM stdin;
\.
SQL
    fi
    ;;

  *)
    printf 'fake supabase: unexpected output %s\n' \
      "$output" >&2
    exit 14
    ;;
esac
FAKE

chmod +x "$fake_bin/supabase"

fake_db_url="postgresql://offline:offline@127.0.0.1:6543/postgres"

echo "=== SUCCESS PATH ==="

: > "$log_file"

if PATH="$fake_bin:$PATH" \
   FAKE_SUPABASE_LOG="$log_file" \
   SUPABASE_DB_URL="$fake_db_url" \
   "$database_backup" \
   run \
   "$workspace" \
   >/tmp/r4-auth-success.log 2>&1
then
  pass "database backup completed with dedicated Auth provenance"
else
  fail "database backup rejected valid dedicated Auth dump"
  cat /tmp/r4-auth-success.log
fi

echo
echo "=== FOUR-DUMP CONTRACT ==="

invocation_count="$(
  wc -l < "$log_file" |
    tr -d '[:space:]'
)"

if [ "$invocation_count" = "4" ]; then
  pass "exactly four Supabase dump operations executed"
else
  fail "expected four Supabase dump operations, got $invocation_count"
fi

for file in \
  roles.sql \
  schema.sql \
  data.sql \
  auth-data.sql
do
  if [ -s "$workspace/components/database/$file" ]; then
    pass "$file created"
  else
    fail "$file missing"
  fi
done

echo
echo "=== SECTIONED SCHEMA COMPONENT CONTRACT ==="

for section_file in \
  auth-pre.sql \
  auth-post.sql \
  storage-pre.sql \
  storage-post.sql \
  supabase-functions-pre.sql \
  supabase-functions-post.sql \
  public-pre.sql \
  public-post.sql
do
  if [ -s "$workspace/components/database/$section_file" ]; then
    pass "$section_file created"
  else
    fail "$section_file missing"
  fi
done

echo
echo "=== EXPLICIT AUTH DUMP CONTRACT ==="

auth_invocation="$(
  grep 'auth-data.sql' "$log_file" || true
)"

if printf '%s\n' "$auth_invocation" |
   grep -qF -- '--schema auth'
then
  pass "dedicated Auth dump uses explicit auth schema"
else
  fail "dedicated Auth dump does not use --schema auth"
fi

if printf '%s\n' "$auth_invocation" |
   grep -qF -- '--data-only'
then
  pass "dedicated Auth dump is data-only"
else
  fail "dedicated Auth dump missing --data-only"
fi

if printf '%s\n' "$auth_invocation" |
   grep -qF -- '--use-copy'
then
  pass "dedicated Auth dump uses copy format"
else
  fail "dedicated Auth dump missing --use-copy"
fi

echo
echo "=== GENERAL DATA / AUTH PROVENANCE SEPARATION ==="

if grep -qF \
  '"auth"."users"' \
  "$workspace/components/database/data.sql" &&
   grep -qF \
  '"auth"."identities"' \
  "$workspace/components/database/data.sql"
then
  pass "general data fixture mirrors current Supabase Auth inclusion"
else
  fail "general data fixture is missing expected Auth restore data"
fi

if grep -qF \
  'contains_auth_table users "$auth_file"' \
  "$repo/scripts/admin-backup/database-backup.sh" &&
   grep -qF \
  'contains_auth_table identities "$auth_file"' \
  "$repo/scripts/admin-backup/database-backup.sh"
then
  pass "dedicated Auth provenance remains independent from general data"
else
  fail "dedicated Auth provenance source is incorrect"
fi

if jq -e '
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
  and (.sectioned_schema.files | type == "array")
  and (.sectioned_schema.files | length == 8)
  and .reconciliation_ledger.validated == true
  and .reconciliation_ledger.file
    == "database-reconciliation.json"
  and .reconciliation_ledger.source_component
    == "database/data.sql"
  and .reconciliation_ledger.algorithm
    == "sha256-schema-table-columns-sorted-copy-lines-v1"
  and .auth_recovery_data == true
  and .auth_sections.users == true
  and .auth_sections.identities == true
  and .auth_dump_options.schema == "auth"
  and .auth_dump_options.data_only == true
  and .auth_dump_options.use_copy == true
  and .auth_dump_options.restore_source == false
' "$workspace/metadata/database-backup.json" >/dev/null
then
  pass "Auth provenance evidence contract is valid"
else
  fail "Auth provenance evidence contract is invalid"
fi

echo
echo "=== DATABASE RECONCILIATION LEDGER CONTRACT ==="

reconciliation_file="$workspace/metadata/database-reconciliation.json"

if jq -e '
  .format_version == 2
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
  and .table_count == 7
  and .total_row_count == 1
  and (.tables | length == 7)
  and all(
    .tables[];
    (
      .content_sha256
      | test("^[0-9a-f]{64}$")
    )
  )
' "$reconciliation_file" >/dev/null
then
  pass "database semantic reconciliation ledger is valid"
else
  fail "database semantic reconciliation ledger is invalid"
fi

for reconciliation_target in \
  auth.users \
  auth.identities \
  storage.buckets \
  storage.objects \
  supabase_functions.hooks \
  public.employee_profiles
do
  if jq -e \
    --arg target "$reconciliation_target" \
    '
      any(
        .tables[];
        (
          .schema
          + "."
          + .table
        ) == $target
      )
    ' \
    "$reconciliation_file" \
    >/dev/null
  then
    pass "reconciliation ledger contains $reconciliation_target"
  else
    fail "reconciliation ledger missing $reconciliation_target"
  fi
done

echo
echo "=== AUTH EVIDENCE SOURCE ==="

if grep -qF \
  'contains_auth_table users "$auth_file"' \
  "$repo/scripts/admin-backup/database-backup.sh" &&
   grep -qF \
  'contains_auth_table identities "$auth_file"' \
  "$repo/scripts/admin-backup/database-backup.sh"
then
  pass "Auth evidence derives exclusively from auth-data.sql"
else
  fail "Auth evidence source is incorrect"
fi

echo
echo "=== FAILURE-CLOSED AUTH TEST ==="

failure_workspace="$(mktemp -d)"

if PATH="$fake_bin:$PATH" \
   FAKE_SUPABASE_LOG="$log_file" \
   FAKE_AUTH_INCOMPLETE=1 \
   SUPABASE_DB_URL="$fake_db_url" \
   "$database_backup" \
   run \
   "$failure_workspace" \
   >/tmp/r4-auth-failure.log 2>&1
then
  fail "incomplete dedicated Auth dump was accepted"
else
  pass "incomplete dedicated Auth dump was rejected"
fi

if grep -qF \
  'ERROR: required Auth recovery sections were not detected' \
  /tmp/r4-auth-failure.log
then
  pass "incomplete Auth dump reached expected validation gate"
else
  fail "incomplete Auth dump failed at unexpected gate"
  cat /tmp/r4-auth-failure.log
fi

if [ -e "$failure_workspace/metadata/database-backup.json" ]; then
  fail "failed Auth backup produced validated evidence"
else
  pass "failed Auth backup produced no evidence"
fi

rm -rf "$failure_workspace"

echo
echo "=== FAILURE-CLOSED RECONCILIATION TEST ==="

reconciliation_failure_workspace="$(mktemp -d)"

if PATH="$fake_bin:$PATH" \
   FAKE_SUPABASE_LOG="$log_file" \
   FAKE_RECONCILIATION_INCOMPLETE=1 \
   SUPABASE_DB_URL="$fake_db_url" \
   "$database_backup" \
   run \
   "$reconciliation_failure_workspace" \
   >/tmp/r4-reconciliation-failure.log 2>&1
then
  fail "incomplete semantic reconciliation source was accepted"
else
  pass "incomplete semantic reconciliation source was rejected"
fi

if grep -qF \
  'required recovery table missing from data.sql: storage.objects' \
  /tmp/r4-reconciliation-failure.log
then
  pass "reconciliation failure reached required-table semantic gate"
else
  fail "reconciliation failure reached unexpected gate"
  cat /tmp/r4-reconciliation-failure.log
fi

if [ -e \
  "$reconciliation_failure_workspace/metadata/database-backup.json" ]
then
  fail "failed reconciliation backup produced parent evidence"
else
  pass "failed reconciliation backup produced no parent evidence"
fi

if [ -e \
  "$reconciliation_failure_workspace/metadata/database-reconciliation.json" ]
then
  fail "failed reconciliation backup retained semantic evidence"
else
  pass "failed reconciliation evidence was removed"
fi

rm -rf "$reconciliation_failure_workspace"

echo
echo "=== SECRET OUTPUT CHECK ==="

if grep -Fq \
  "$fake_db_url" \
  /tmp/r4-auth-success.log ||
   grep -Fq \
  "$fake_db_url" \
  /tmp/r4-auth-failure.log ||
   grep -Fq \
  "$fake_db_url" \
  /tmp/r4-reconciliation-failure.log
then
  fail "database URL appeared in backup script output"
else
  pass "database URL is not printed by backup script"
fi

echo
echo "=== PROHIBITED OPERATION CHECK ==="

if grep -nE \
  'db reset|db push|db pull|--linked' \
  "$repo/scripts/admin-backup/database-backup.sh"
then
  fail "prohibited database operation exists"
else
  pass "no reset/push/pull/linked operation"
fi

echo
echo
echo "=== PG_DUMP RUNTIME IMAGE REGISTRY CONTRACT ==="

sectioned_schema_script="$repo/scripts/admin-backup/sectioned-schema-backup.sh"

unqualified_plan="$(env -u SUPABASE_INTERNAL_IMAGE_REGISTRY "$sectioned_schema_script" plan "$workspace")"
if printf "%s\n" "$unqualified_plan" | grep -qF "Docker image: supabase/postgres:17.6.1.165"
then
  pass "sectioned schema runtime keeps canonical image when registry is unset"
else
  fail "sectioned schema runtime changed canonical image when registry is unset"
  printf "%s\n" "$unqualified_plan"
fi

qualified_plan="$(SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io "$sectioned_schema_script" plan "$workspace")"
if printf "%s\n" "$qualified_plan" | grep -qF "Docker image: ghcr.io/supabase/postgres:17.6.1.165"
then
  pass "sectioned schema runtime qualifies image with configured registry"
else
  fail "sectioned schema runtime did not qualify image with configured registry"
  printf "%s\n" "$qualified_plan"
fi

slashed_plan="$(SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io/ "$sectioned_schema_script" plan "$workspace")"
if printf "%s\n" "$slashed_plan" | grep -qF "Docker image: ghcr.io/supabase/postgres:17.6.1.165"
then
  pass "sectioned schema runtime normalises registry trailing slash"
else
  fail "sectioned schema runtime did not normalise registry trailing slash"
  printf "%s\n" "$slashed_plan"
fi

if grep -qF "\${SUPABASE_INTERNAL_IMAGE_REGISTRY:+\${SUPABASE_INTERNAL_IMAGE_REGISTRY%/}/}supabase/postgres:17.6.1.165" "$repo/scripts/admin-backup/verify-database-restore.sh"
then
  pass "database restore runtime uses the same registry-aware pinned image"
else
  fail "database restore runtime is missing registry-aware pinned image resolution"
fi

echo "=== R4 REGRESSION RESULT ==="

if [ "$failures" -eq 0 ]; then
  echo "PASS: dedicated Auth database-backup contract"
else
  echo "FAIL: R4 regression found $failures issue(s)"
fi

exit "$failures"

#!/usr/bin/env bash

set -euo pipefail

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

source_container="supabase_db_RA-workspace"
image="supabase/postgres:17.6.1.165"

target_container="ridearrivo-r8c-full-$$"
target_database="ridearrivo_restore_validation"

work="$(mktemp -d)"

roles_file="$work/roles.sql"
schema_file="$work/schema.sql"
data_file="$work/data.sql"
auth_data_file="$work/auth-data.sql"

artifact_reconciliation="$work/artifact-database-reconciliation.json"
target_data_file="$work/target-data.sql"
target_reconciliation="$work/target-database-reconciliation.json"
target_container_data="/tmp/r8c35c-target-data-$$.sql"

auth_pre="$work/auth-pre.sql"
auth_post="$work/auth-post.sql"
storage_pre="$work/storage-pre.sql"
storage_post="$work/storage-post.sql"

public_pre="$work/public-pre.sql"
public_post="$work/public-post.sql"

sf_pre="$work/supabase-functions-pre.sql"
sf_post="$work/supabase-functions-post.sql"

source_sf_pre="/tmp/r8c-supabase-functions-pre-$$.sql"
source_sf_post="/tmp/r8c-supabase-functions-post-$$.sql"

source_public_pre="/tmp/r8c-public-pre-$$.sql"
source_public_post="/tmp/r8c-public-post-$$.sql"

source_auth_pre="/tmp/r8c-auth-pre-$$.sql"
source_auth_post="/tmp/r8c-auth-post-$$.sql"
source_storage_pre="/tmp/r8c-storage-pre-$$.sql"
source_storage_post="/tmp/r8c-storage-post-$$.sql"

source_public_counts="$work/source-public-counts.txt"
target_public_counts="$work/target-public-counts.txt"

failures=0
ready=false

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

wait_for_final_postgres() {
  container="$1"
  database="$2"

  stable=0

  for attempt in $(seq 1 160)
  do
    running="$(
      docker inspect \
        --format '{{.State.Running}}' \
        "$container" \
        2>/dev/null \
        || echo false
    )"

    pid1_cmdline="$(
      docker exec \
        "$container" \
        sh -c \
        "tr '\\000' ' ' < /proc/1/cmdline" \
        2>/dev/null \
        || echo unavailable
    )"

    if docker exec \
      "$container" \
      pg_isready \
        -U postgres \
        -d "$database" \
        >/dev/null 2>&1
    then
      ready_now=true
    else
      ready_now=false
    fi

    case "$pid1_cmdline" in
      */bin/postgres\ -D\ /etc/postgresql*)
        final_process=true
        ;;

      *)
        final_process=false
        ;;
    esac

    if [ "$running" = true ] &&
       [ "$ready_now" = true ] &&
       [ "$final_process" = true ]
    then
      stable=$((stable + 1))
    else
      stable=0
    fi

    if [ "$stable" -ge 5 ]; then
      return 0
    fi

    sleep 0.25
  done

  return 1
}

cleanup() {
  docker rm -f \
    "$target_container" \
    >/dev/null 2>&1 || true

  docker exec \
    "$source_container" \
    rm -f \
      "$source_auth_pre" \
      "$source_auth_post" \
      "$source_storage_pre" \
      "$source_storage_post" \
      "$source_public_pre" \
      "$source_public_post" \
      "$source_sf_pre" \
      "$source_sf_post" \
    >/dev/null 2>&1 || true

  rm -rf "$work"
}

trap cleanup EXIT

snapshot_public_counts() {
  container="$1"
  database="$2"
  output="$3"

  docker exec -i \
    "$container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$database" \
      -At \
      -F '|' \
      > "$output" <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.public_table_counts()
RETURNS TABLE (
  table_name text,
  row_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    table_name := item.tablename;

    EXECUTE format(
      'select count(*) from public.%I',
      item.tablename
    )
    INTO row_count;

    RETURN NEXT;
  END LOOP;
END
$$;

SELECT
  table_name,
  row_count
FROM pg_temp.public_table_counts()
ORDER BY table_name;
SQL
}

auth_fingerprint() {
  container="$1"
  database="$2"

  docker exec \
    "$container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$database" \
      -Atc "
        select
          (
            select count(*)::text
            from auth.users
          )
          || '|'
          ||
          (
            select md5(
              coalesce(
                string_agg(
                  row_to_json(u)::text,
                  E'\n'
                  order by u.id::text
                ),
                ''
              )
            )
            from auth.users u
          )
          || '|'
          ||
          (
            select count(*)::text
            from auth.identities
          )
          || '|'
          ||
          (
            select md5(
              coalesce(
                string_agg(
                  row_to_json(i)::text,
                  E'\n'
                  order by i.id::text
                ),
                ''
              )
            )
            from auth.identities i
          );
      "
}

storage_metadata_fingerprint() {
  container="$1"
  database="$2"

  docker exec \
    "$container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$database" \
      -Atc "
        select
          (
            select count(*)::text
            from storage.buckets
          )
          || '|'
          ||
          (
            select count(*)::text
            from storage.objects
          );
      "
}

echo "=== R8C-11 FULL RESTORE WITH PROVEN BOOTSTRAP ==="

echo
echo "=== SOURCE CONTRACT ==="

if docker inspect \
  "$source_container" \
  >/dev/null 2>&1
then
  pass "initialized local Supabase source found"
else
  fail "initialized local Supabase source unavailable"
  exit "$failures"
fi

source_image="$(
  docker inspect \
    --format '{{.Config.Image}}' \
    "$source_container"
)"

if [ "$source_image" = "$image" ]; then
  pass "restore image exactly matches source image"
else
  fail "source and restore image versions differ"

  printf 'SOURCE=%s\n' "$source_image"
  printf 'TARGET=%s\n' "$image"

  exit "$failures"
fi

echo
echo "=== SOURCE FINGERPRINTS ==="

snapshot_public_counts \
  "$source_container" \
  postgres \
  "$source_public_counts"

source_public_table_count="$(
  wc -l < "$source_public_counts" |
    tr -d '[:space:]'
)"

printf 'SOURCE_PUBLIC_TABLES=%s\n' \
  "$source_public_table_count"

source_auth="$(
  auth_fingerprint \
    "$source_container" \
    postgres
)"

source_storage="$(
  storage_metadata_fingerprint \
    "$source_container" \
    postgres
)"

pass "source public-table counts captured"
pass "source Auth fingerprint captured"
pass "source Storage metadata fingerprint captured"

echo
echo "=== CREATE BACKUP MATERIAL ==="

if supabase db dump \
  --local \
  -f "$roles_file" \
  --role-only \
  >/tmp/r8c11-roles-dump.log 2>&1
then
  pass "roles.sql created"
else
  fail "roles dump failed"
  tail -80 /tmp/r8c11-roles-dump.log
  exit "$failures"
fi

if supabase db dump \
  --local \
  -f "$schema_file" \
  >/tmp/r8c11-schema-dump.log 2>&1
then
  pass "schema.sql created"
else
  fail "schema dump failed"
  tail -80 /tmp/r8c11-schema-dump.log
  exit "$failures"
fi

if supabase db dump \
  --local \
  -f "$data_file" \
  --use-copy \
  --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes" \
  >/tmp/r8c11-data-dump.log 2>&1
then
  pass "data.sql created"
else
  fail "data dump failed"
  tail -80 /tmp/r8c11-data-dump.log
  exit "$failures"
fi

if supabase db dump \
  --local \
  -f "$auth_data_file" \
  --use-copy \
  --data-only \
  --schema auth \
  >/tmp/r8c11-auth-dump.log 2>&1
then
  pass "auth-data.sql provenance dump created"
else
  fail "Auth provenance dump failed"
  tail -80 /tmp/r8c11-auth-dump.log
  exit "$failures"
fi

for file in \
  "$roles_file" \
  "$schema_file" \
  "$data_file" \
  "$auth_data_file"
do
  if [ -s "$file" ]; then
    printf 'PASS: %s is non-empty\n' \
      "$(basename "$file")"
  else
    printf 'FAIL: %s is missing or empty\n' \
      "$(basename "$file")"

    failures=$((failures + 1))
  fi
done

if [ "$failures" -ne 0 ]; then
  exit "$failures"
fi

echo
echo "=== ARTIFACT-DERIVED DATABASE RECONCILIATION ==="

if node \
  "$repo/scripts/admin-backup/build-database-reconciliation.mjs" \
  "$data_file" \
  "$artifact_reconciliation"
then
  pass "artifact-derived database reconciliation ledger created"
else
  fail "artifact-derived database reconciliation ledger creation failed"
  exit "$failures"
fi

if node \
  "$repo/scripts/admin-backup/database-reconciliation-contract.mjs" \
  validate \
  "$artifact_reconciliation" \
  >/dev/null
then
  pass "artifact-derived reconciliation ledger contract validated"
else
  fail "artifact-derived reconciliation ledger contract invalid"
  exit "$failures"
fi

artifact_table_count="$(
  jq -r     '.table_count'     "$artifact_reconciliation"
)"

artifact_total_rows="$(
  jq -r     '.total_row_count'     "$artifact_reconciliation"
)"

artifact_sequence_count="$(
  jq -r     '.sequence_count'     "$artifact_reconciliation"
)"

printf 'ARTIFACT_RECONCILIATION_TABLES=%s\n'   "$artifact_table_count"

printf 'ARTIFACT_RECONCILIATION_ROWS=%s\n'   "$artifact_total_rows"

printf 'ARTIFACT_RECONCILIATION_SEQUENCES=%s\n'   "$artifact_sequence_count"

echo
echo "=== AUTH PROVENANCE ==="

if grep -Eq \
  'auth\.users|"auth"\."users"' \
  "$auth_data_file" &&
   grep -Eq \
  'auth\.identities|"auth"\."identities"' \
  "$auth_data_file"
then
  pass "dedicated Auth provenance contains users and identities"
else
  fail "dedicated Auth provenance is incomplete"
  exit "$failures"
fi

echo
echo "=== MANAGED SCHEMA SECTIONS ==="

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=auth \
    --section=pre-data \
    -f "$source_auth_pre"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=auth \
    --section=post-data \
    -f "$source_auth_post"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=storage \
    --section=pre-data \
    -f "$source_storage_pre"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=storage \
    --section=post-data \
    -f "$source_storage_post"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=supabase_functions \
    --section=pre-data \
    -f "$source_sf_pre"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=supabase_functions \
    --section=post-data \
    -f "$source_sf_post"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=public \
    --section=pre-data \
    -f "$source_public_pre"

docker exec \
  "$source_container" \
  pg_dump \
    -U postgres \
    -d postgres \
    --schema-only \
    --schema=public \
    --section=post-data \
    -f "$source_public_post"

docker cp \
  "$source_container:$source_auth_pre" \
  "$auth_pre" \
  >/dev/null

docker cp \
  "$source_container:$source_auth_post" \
  "$auth_post" \
  >/dev/null

docker cp \
  "$source_container:$source_storage_pre" \
  "$storage_pre" \
  >/dev/null

docker cp \
  "$source_container:$source_storage_post" \
  "$storage_post" \
  >/dev/null

docker cp \
  "$source_container:$source_sf_pre" \
  "$sf_pre" \
  >/dev/null

docker cp \
  "$source_container:$source_sf_post" \
  "$sf_post" \
  >/dev/null

docker cp \
  "$source_container:$source_public_pre" \
  "$public_pre" \
  >/dev/null

docker cp \
  "$source_container:$source_public_post" \
  "$public_post" \
  >/dev/null

for file in \
  "$auth_pre" \
  "$auth_post" \
  "$storage_pre" \
  "$storage_post" \
  "$sf_pre" \
  "$sf_post" \
  "$public_pre" \
  "$public_post"
do
  if [ -s "$file" ]; then
    printf 'PASS: %s created\n' \
      "$(basename "$file")"
  else
    printf 'FAIL: %s missing\n' \
      "$(basename "$file")"

    failures=$((failures + 1))
  fi
done

if [ "$failures" -ne 0 ]; then
  exit "$failures"
fi

echo
echo "=== START DISPOSABLE RESTORE TARGET ==="

docker run \
  --detach \
  --network none \
  --name "$target_container" \
  --env POSTGRES_PASSWORD="ridearrivo-r8c11-only" \
  "$image" \
  >/dev/null

if wait_for_final_postgres \
  "$target_container" \
  postgres
then
  ready=true
  pass "disposable restore target reached stable final readiness"
else
  fail "disposable restore target failed final-postmaster readiness"

  echo
  echo "--- RESTORE TARGET STARTUP LOG TAIL ---"

  docker logs \
    "$target_container" \
    2>&1 |
    tail -120

  exit "$failures"
fi

echo
echo "=== NETWORK ISOLATION ==="

network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

if [ "$network_mode" = "none" ]; then
  pass "restore target network mode is none"
else
  fail "restore target is not network isolated"
fi

port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$port_bindings" = "null" ] ||
   [ "$port_bindings" = "{}" ]; then
  pass "restore target publishes no ports"
else
  fail "restore target publishes ports"
fi

echo
echo "=== MINIMAL SUPABASE ROLE BOOTSTRAP ==="

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d postgres \
    >/tmp/r8c11-role-bootstrap.log 2>&1 <<'SQL'
DO
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'supabase_functions_admin'
  )
  THEN
    CREATE ROLE supabase_functions_admin
      NOSUPERUSER
      NOINHERIT
      CREATEROLE
      NOCREATEDB
      LOGIN
      NOREPLICATION
      NOBYPASSRLS
      CONNECTION LIMIT -1;
  END IF;
END
$$;

ALTER ROLE supabase_functions_admin
  NOSUPERUSER
  NOINHERIT
  CREATEROLE
  NOCREATEDB
  LOGIN
  NOREPLICATION
  NOBYPASSRLS
  CONNECTION LIMIT -1;

ALTER ROLE supabase_functions_admin
  SET search_path TO supabase_functions;

GRANT supabase_functions_admin
TO postgres
WITH INHERIT TRUE, SET TRUE;

DO
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'supabase_realtime_admin'
  )
  THEN
    CREATE ROLE supabase_realtime_admin
      NOSUPERUSER
      NOINHERIT
      NOCREATEROLE
      NOCREATEDB
      NOLOGIN
      NOREPLICATION
      NOBYPASSRLS
      CONNECTION LIMIT -1;
  END IF;
END
$$;

ALTER ROLE supabase_realtime_admin
  NOSUPERUSER
  NOINHERIT
  NOCREATEROLE
  NOCREATEDB
  NOLOGIN
  NOREPLICATION
  NOBYPASSRLS
  CONNECTION LIMIT -1;

ALTER ROLE supabase_realtime_admin
  SET search_path TO public, extensions, realtime;

GRANT anon
TO supabase_realtime_admin
WITH INHERIT FALSE, SET TRUE;

GRANT authenticated
TO supabase_realtime_admin
WITH INHERIT FALSE, SET TRUE;

GRANT service_role
TO supabase_realtime_admin
WITH INHERIT FALSE, SET TRUE;
SQL
then
  pass "minimal role bootstrap applied"
else
  fail "minimal role bootstrap failed"

  cat /tmp/r8c11-role-bootstrap.log
  exit "$failures"
fi

echo
echo "=== BOOTSTRAP PRIVILEGE CHECK ==="

unexpected_super="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d postgres \
      -Atc "
        select count(*)
        from pg_roles
        where rolname in (
          'supabase_functions_admin',
          'supabase_realtime_admin'
        )
          and rolsuper;
      "
)"

if [ "$unexpected_super" = "0" ]; then
  pass "bootstrap introduced no superuser escalation"
else
  fail "bootstrap introduced unexpected superuser privilege"
  exit "$failures"
fi

echo
echo "=== COPY RESTORE MATERIAL ==="

for file in \
  "$roles_file" \
  "$schema_file" \
  "$data_file" \
  "$auth_pre" \
  "$auth_post" \
  "$storage_pre" \
  "$storage_post" \
  "$sf_pre" \
  "$sf_post" \
  "$public_pre" \
  "$public_post"
do
  docker cp \
    "$file" \
    "$target_container:/tmp/$(basename "$file")" \
    >/dev/null
done

pass "restore material copied"

echo
echo "=== RESTORE ROLES ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d postgres \
    -f /tmp/roles.sql \
    >/tmp/r8c11-roles-restore.log 2>&1
then
  pass "roles.sql restored"
else
  fail "roles.sql restore failed"

  tail -100 \
    /tmp/r8c11-roles-restore.log

  exit "$failures"
fi

echo
echo "=== CREATE EMPTY RESTORE DATABASE ==="

if docker exec \
  "$target_container" \
  createdb \
    -U supabase_admin \
    -T template0 \
    "$target_database"
then
  pass "empty restore database created"
else
  fail "empty restore database creation failed"
  exit "$failures"
fi

echo
echo "=== CONFIGURE PG_CRON RESTORE DATABASE ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d postgres \
    -c "ALTER SYSTEM SET cron.database_name = '$target_database';" \
    >/tmp/r8c11-cron-config.log 2>&1
then
  pass "pg_cron restore database configured"
else
  fail "could not configure pg_cron restore database"

  cat /tmp/r8c11-cron-config.log

  exit "$failures"
fi

echo
echo "=== RESTART ISOLATED POSTGRES FOR PG_CRON ==="

if docker restart \
  "$target_container" \
  >/dev/null
then
  pass "isolated restore container restarted"
else
  fail "isolated restore container restart failed"
  exit "$failures"
fi

ready=false

if wait_for_final_postgres \
  "$target_container" \
  "$target_database"
then
  ready=true
  pass "restore database reached stable final readiness after pg_cron restart"
else
  fail "restore database failed final-postmaster readiness after pg_cron restart"

  echo
  echo "--- POST-RESTART LOG TAIL ---"

  docker logs \
    "$target_container" \
    2>&1 |
    tail -120

  exit "$failures"
fi

echo
echo "=== VERIFY PG_CRON DATABASE AFFINITY ==="

actual_cron_database="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "show cron.database_name;"
)"

printf 'CRON_DATABASE_NAME=%s\n' \
  "$actual_cron_database"

if [ "$actual_cron_database" = "$target_database" ]; then
  pass "pg_cron is bound to isolated restore database"
else
  fail "pg_cron database affinity is incorrect"
  exit "$failures"
fi

echo
echo "=== POST-RESTART ISOLATION CHECK ==="

network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

if [ "$network_mode" = "none" ]; then
  pass "restart preserved network-none isolation"
else
  fail "restart changed restore target network mode"
  exit "$failures"
fi

port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$port_bindings" = "null" ] ||
   [ "$port_bindings" = "{}" ]; then
  pass "restart preserved zero published ports"
else
  fail "restart introduced published ports"
  exit "$failures"
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  pass "restart preserved external network isolation"
else
  fail "restart introduced an external network interface"
  exit "$failures"
fi

echo
echo "=== REMOVE TEMPLATE0 DEFAULT PUBLIC SCHEMA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -c "DROP SCHEMA public;" \
    >/tmp/r8c11-drop-public.log 2>&1
then
  pass "empty template0 public schema removed"
else
  fail "could not remove template0 public schema"

  cat /tmp/r8c11-drop-public.log
  exit "$failures"
fi

public_after_drop="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_namespace
        where nspname = 'public';
      "
)"

if [ "$public_after_drop" = "0" ]; then
  pass "public schema absent before sectioned replay"
else
  fail "public schema still exists after clean removal"
  exit "$failures"
fi

echo
echo "=== PLATFORM SCHEMA BOOTSTRAP ==="

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    >/tmp/r8c11-platform-schema-create.log 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions
  AUTHORIZATION postgres;

ALTER SCHEMA extensions
  OWNER TO postgres;

CREATE SCHEMA IF NOT EXISTS vault
  AUTHORIZATION supabase_admin;

ALTER SCHEMA vault
  OWNER TO supabase_admin;

REVOKE ALL ON SCHEMA vault
FROM PUBLIC;

GRANT ALL ON SCHEMA vault
TO supabase_admin;

GRANT USAGE ON SCHEMA vault
TO postgres
WITH GRANT OPTION;

GRANT USAGE ON SCHEMA vault
TO service_role;
SQL
then
  pass "platform schemas created with proven owners"
else
  fail "platform schema creation failed"

  cat /tmp/r8c11-platform-schema-create.log
  exit "$failures"
fi

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d "$target_database" \
    >/tmp/r8c11-extensions-acl.log 2>&1 <<'SQL'
REVOKE ALL ON SCHEMA extensions
FROM PUBLIC;

GRANT ALL ON SCHEMA extensions
TO postgres;

GRANT USAGE ON SCHEMA extensions
TO anon;

GRANT USAGE ON SCHEMA extensions
TO authenticated;

GRANT USAGE ON SCHEMA extensions
TO service_role;

GRANT ALL ON SCHEMA extensions
TO dashboard_user;
SQL
then
  pass "extensions schema ACL applied by source owner"
else
  fail "extensions schema ACL bootstrap failed"

  cat /tmp/r8c11-extensions-acl.log
  exit "$failures"
fi

echo
echo "=== PLATFORM SCHEMA OWNER RECONCILIATION ==="

source_platform_owners="$(
  docker exec \
    "$source_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d postgres \
      -At \
      -F '|' \
      -c "
        select
          n.nspname,
          pg_get_userbyid(n.nspowner)
        from pg_namespace n
        where n.nspname in (
          'extensions',
          'vault'
        )
        order by n.nspname;
      "
)"

target_platform_owners="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -At \
      -F '|' \
      -c "
        select
          n.nspname,
          pg_get_userbyid(n.nspowner)
        from pg_namespace n
        where n.nspname in (
          'extensions',
          'vault'
        )
        order by n.nspname;
      "
)"

printf '%s\n' "$target_platform_owners"

if [ "$target_platform_owners" = "$source_platform_owners" ]; then
  pass "platform schema owners exactly match initialized source"
else
  fail "platform schema owners differ from initialized source"

  echo
  echo "--- SOURCE PLATFORM OWNERS ---"
  printf '%s\n' "$source_platform_owners"

  echo
  echo "--- TARGET PLATFORM OWNERS ---"
  printf '%s\n' "$target_platform_owners"

  exit "$failures"
fi

echo
echo "=== PLATFORM SCHEMA ACL RECONCILIATION ==="

source_platform_acl="$(
  docker exec \
    "$source_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d postgres \
      -At \
      -F '|' \
      -c "
        select
          n.nspname,
          case
            when acl.grantee = 0
              then 'PUBLIC'
            else pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type,
          acl.is_grantable
        from pg_namespace n
        cross join lateral
          aclexplode(n.nspacl) acl
        where n.nspname in (
          'extensions',
          'vault'
        )
        order by
          n.nspname,
          2,
          acl.privilege_type,
          acl.is_grantable;
      "
)"

target_platform_acl="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -At \
      -F '|' \
      -c "
        select
          n.nspname,
          case
            when acl.grantee = 0
              then 'PUBLIC'
            else pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type,
          acl.is_grantable
        from pg_namespace n
        cross join lateral
          aclexplode(n.nspacl) acl
        where n.nspname in (
          'extensions',
          'vault'
        )
        order by
          n.nspname,
          2,
          acl.privilege_type,
          acl.is_grantable;
      "
)"

if [ "$target_platform_acl" = "$source_platform_acl" ]; then
  pass "platform schema ACLs exactly match initialized source"
else
  fail "platform schema ACLs differ from initialized source"

  echo
  echo "--- SOURCE PLATFORM ACL ---"
  printf '%s\n' "$source_platform_acl"

  echo
  echo "--- TARGET PLATFORM ACL ---"
  printf '%s\n' "$target_platform_acl"

  exit "$failures"
fi

echo
echo "=== PLATFORM SCHEMA MINIMALITY ==="

cron_before_application_schema="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_namespace
        where nspname = 'cron';
      "
)"

if [ "$cron_before_application_schema" = "0" ]; then
  pass "cron schema was not fabricated by bootstrap"
else
  fail "cron schema appeared before pg_cron extension creation"
  exit "$failures"
fi

echo
echo "=== REQUIRED EXTENSION BOOTSTRAP ==="

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    >/tmp/r8c11-extension-bootstrap.log 2>&1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_cron
  WITH SCHEMA pg_catalog;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements
  WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto
  WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS supabase_vault
  WITH SCHEMA vault;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
  WITH SCHEMA extensions;

REVOKE ALL ON SCHEMA cron
FROM PUBLIC;

GRANT ALL ON SCHEMA cron
TO supabase_admin;

GRANT USAGE ON SCHEMA cron
TO postgres
WITH GRANT OPTION;
SQL
then
  pass "required Supabase extensions installed"
else
  fail "required extension bootstrap failed"

  cat /tmp/r8c11-extension-bootstrap.log
  exit "$failures"
fi

echo
echo "=== EXTENSION RECONCILIATION ==="

source_extensions="$(
  docker exec \
    "$source_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d postgres \
      -At \
      -F '|' \
      -c "
        select
          e.extname,
          e.extversion,
          n.nspname,
          pg_get_userbyid(e.extowner)
        from pg_extension e
        join pg_namespace n
          on n.oid = e.extnamespace
        where e.extname in (
          'pg_cron',
          'pg_stat_statements',
          'pgcrypto',
          'supabase_vault',
          'uuid-ossp'
        )
        order by e.extname;
      "
)"

target_extensions="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -At \
      -F '|' \
      -c "
        select
          e.extname,
          e.extversion,
          n.nspname,
          pg_get_userbyid(e.extowner)
        from pg_extension e
        join pg_namespace n
          on n.oid = e.extnamespace
        where e.extname in (
          'pg_cron',
          'pg_stat_statements',
          'pgcrypto',
          'supabase_vault',
          'uuid-ossp'
        )
        order by e.extname;
      "
)"

printf '%s\n' "$target_extensions"

if [ "$target_extensions" = "$source_extensions" ]; then
  pass "required extension versions, schemas, and owners exactly match source"
else
  fail "required extension inventory differs from source"

  echo
  echo "--- SOURCE EXTENSIONS ---"
  printf '%s\n' "$source_extensions"

  echo
  echo "--- TARGET EXTENSIONS ---"
  printf '%s\n' "$target_extensions"

  exit "$failures"
fi

echo
echo "=== CRON SCHEMA ACL RECONCILIATION ==="

source_cron_acl="$(
  docker exec \
    "$source_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d postgres \
      -At \
      -F '|' \
      -c "
        select
          case
            when acl.grantee = 0
              then 'PUBLIC'
            else pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type,
          acl.is_grantable
        from pg_namespace n
        cross join lateral
          aclexplode(n.nspacl) acl
        where n.nspname = 'cron'
        order by
          1,
          acl.privilege_type,
          acl.is_grantable;
      "
)"

target_cron_acl="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -At \
      -F '|' \
      -c "
        select
          case
            when acl.grantee = 0
              then 'PUBLIC'
            else pg_get_userbyid(acl.grantee)
          end,
          acl.privilege_type,
          acl.is_grantable
        from pg_namespace n
        cross join lateral
          aclexplode(n.nspacl) acl
        where n.nspname = 'cron'
        order by
          1,
          acl.privilege_type,
          acl.is_grantable;
      "
)"

if [ "$target_cron_acl" = "$source_cron_acl" ]; then
  pass "cron schema ACL exactly matches initialized source"
else
  fail "cron schema ACL differs from source"

  echo
  echo "--- SOURCE CRON ACL ---"
  printf '%s\n' "$source_cron_acl"

  echo
  echo "--- TARGET CRON ACL ---"
  printf '%s\n' "$target_cron_acl"

  exit "$failures"
fi

echo
echo "=== RESTORE MANAGED PRE-DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/auth-pre.sql \
    >/tmp/r8c11-auth-pre.log 2>&1
then
  pass "Auth pre-data restored"
else
  fail "Auth pre-data restore failed"

  tail -100 \
    /tmp/r8c11-auth-pre.log

  exit "$failures"
fi

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/storage-pre.sql \
    >/tmp/r8c11-storage-pre.log 2>&1
then
  pass "Storage pre-data restored"
else
  fail "Storage pre-data restore failed"

  tail -100 \
    /tmp/r8c11-storage-pre.log

  exit "$failures"
fi

echo
echo "=== RESTORE SUPABASE_FUNCTIONS PRE-DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/supabase-functions-pre.sql \
    >/tmp/r8c11-supabase-functions-pre.log 2>&1
then
  pass "supabase_functions pre-data restored"
else
  fail "supabase_functions pre-data restore failed"

  echo
  echo "--- SUPABASE_FUNCTIONS PRE-DATA FAILURE TAIL ---"

  tail -120 \
    /tmp/r8c11-supabase-functions-pre.log

  exit "$failures"
fi

echo
echo "=== SUPABASE_FUNCTIONS FOUNDATION ==="

sf_foundation="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select
          to_regclass(
            'supabase_functions.hooks'
          ) is not null
          and
          to_regclass(
            'supabase_functions.migrations'
          ) is not null
          and
          to_regprocedure(
            'supabase_functions.http_request()'
          ) is not null;
      "
)"

if [ "$sf_foundation" = "t" ]; then
  pass "supabase_functions tables and function exist before data replay"
else
  fail "supabase_functions pre-data foundation is incomplete"
  exit "$failures"
fi

sf_owners="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -At \
      -F '|' \
      -c "
        select
          'schema',
          pg_get_userbyid(n.nspowner)
        from pg_namespace n
        where n.nspname = 'supabase_functions'

        union all

        select
          c.relname,
          pg_get_userbyid(c.relowner)
        from pg_class c
        join pg_namespace n
          on n.oid = c.relnamespace
        where n.nspname = 'supabase_functions'
          and c.relname in (
            'hooks',
            'migrations'
          )

        order by 1;
      "
)"

expected_sf_owners="$(
  printf '%s\n' \
    'hooks|supabase_functions_admin' \
    'migrations|supabase_functions_admin' \
    'schema|supabase_admin'
)"

printf '%s\n' "$sf_owners"

if [ "$sf_owners" = "$expected_sf_owners" ]; then
  pass "supabase_functions ownership matches source contract"
else
  fail "supabase_functions ownership differs from source contract"
  exit "$failures"
fi

echo
echo "=== RESTORE RIDEARRIVO PUBLIC PRE-DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/public-pre.sql \
    >/tmp/r8c11-public-pre.log 2>&1
then
  pass "RideArrivo public pre-data restored"
else
  fail "RideArrivo public pre-data restore failed"

  echo
  echo "--- PUBLIC PRE-DATA FAILURE TAIL ---"

  tail -120 \
    /tmp/r8c11-public-pre.log

  exit "$failures"
fi

public_after_pre="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_namespace
        where nspname = 'public';
      "
)"

if [ "$public_after_pre" = "1" ]; then
  pass "public schema recreated by RideArrivo pre-data"
else
  fail "RideArrivo public schema was not recreated exactly once"
  exit "$failures"
fi

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d "$target_database" \
    -Atc "
      select
        to_regclass('public.employee_profiles') is not null
        and
        to_regprocedure(
          'public.handle_new_workspace_user()'
        ) is not null;
    " \
  | grep -qxF 't'
then
  pass "RideArrivo cross-schema foundations exist before managed post-data"
else
  fail "RideArrivo pre-data foundations are incomplete"
  exit "$failures"
fi

echo
echo "=== RESTORE DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/data.sql \
    >/tmp/r8c11-data-restore.log 2>&1
then
  pass "database data restored"
else
  fail "database data restore failed"

  echo
  echo "--- DATA FAILURE TAIL ---"

  tail -120 \
    /tmp/r8c11-data-restore.log

  exit "$failures"
fi

echo
echo "=== RESTORE MANAGED POST-DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/auth-post.sql \
    >/tmp/r8c11-auth-post.log 2>&1
then
  pass "Auth post-data restored"
else
  fail "Auth post-data restore failed"

  echo
  echo "--- AUTH POST-DATA FAILURE TAIL ---"

  tail -120 \
    /tmp/r8c11-auth-post.log

  exit "$failures"
fi

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/storage-post.sql \
    >/tmp/r8c11-storage-post.log 2>&1
then
  pass "Storage post-data restored"
else
  fail "Storage post-data restore failed"

  echo
  echo "--- STORAGE POST-DATA FAILURE TAIL ---"

  tail -120 \
    /tmp/r8c11-storage-post.log

  exit "$failures"
fi

echo
echo "=== RESTORE SUPABASE_FUNCTIONS POST-DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/supabase-functions-post.sql \
    >/tmp/r8c11-supabase-functions-post.log 2>&1
then
  pass "supabase_functions post-data restored"
else
  fail "supabase_functions post-data restore failed"

  echo
  echo "--- SUPABASE_FUNCTIONS POST-DATA FAILURE TAIL ---"

  tail -120 \
    /tmp/r8c11-supabase-functions-post.log

  exit "$failures"
fi

echo
echo "=== SUPABASE_FUNCTIONS POST-DATA CONTRACT ==="

sf_constraints="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_constraint con
        join pg_class rel
          on rel.oid = con.conrelid
        join pg_namespace n
          on n.oid = rel.relnamespace
        where n.nspname = 'supabase_functions'
          and con.conname in (
            'hooks_pkey',
            'migrations_pkey'
          )
          and con.contype = 'p';
      "
)"

if [ "$sf_constraints" = "2" ]; then
  pass "supabase_functions primary-key contract restored"
else
  fail "supabase_functions primary-key contract incomplete"
  exit "$failures"
fi

sf_indexes="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_indexes
        where schemaname = 'supabase_functions'
          and indexname in (
            'supabase_functions_hooks_h_table_id_h_name_idx',
            'supabase_functions_hooks_request_id_idx'
          );
      "
)"

if [ "$sf_indexes" = "2" ]; then
  pass "supabase_functions secondary indexes restored"
else
  fail "supabase_functions secondary indexes incomplete"
  exit "$failures"
fi

echo
echo "=== RESTORE RIDEARRIVO PUBLIC POST-DATA ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/public-post.sql \
    >/tmp/r8c11-public-post.log 2>&1
then
  pass "RideArrivo public post-data restored"
else
  fail "RideArrivo public post-data restore failed"

  echo
  echo "--- PUBLIC POST-DATA FAILURE TAIL ---"

  tail -140 \
    /tmp/r8c11-public-post.log

  exit "$failures"
fi

echo
echo "=== PUBLIC TO AUTH FK CONTRACT ==="

employee_auth_fk="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_constraint c
        join pg_class r
          on r.oid = c.conrelid
        join pg_namespace n
          on n.oid = r.relnamespace
        where n.nspname = 'public'
          and r.relname = 'employee_profiles'
          and c.conname = 'employee_profiles_id_fkey'
          and c.contype = 'f';
      "
)"

if [ "$employee_auth_fk" = "1" ]; then
  pass "employee_profiles Auth foreign key restored"
else
  fail "employee_profiles Auth foreign key missing"
  exit "$failures"
fi

echo
echo "=== MANAGED FOUNDATION ==="

managed_foundation="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select
          to_regclass('auth.users') is not null
          and
          to_regclass('auth.identities') is not null
          and
          to_regclass('storage.buckets') is not null
          and
          to_regclass('storage.objects') is not null;
      "
)"

if [ "$managed_foundation" = "t" ]; then
  pass "required Auth and Storage tables exist"
else
  fail "managed foundation incomplete"
fi

echo
echo "=== PUBLIC DATABASE RECONCILIATION ==="

snapshot_public_counts \
  "$target_container" \
  "$target_database" \
  "$target_public_counts"

target_public_table_count="$(
  wc -l < "$target_public_counts" |
    tr -d '[:space:]'
)"

printf 'TARGET_PUBLIC_TABLES=%s\n' \
  "$target_public_table_count"

if cmp -s \
  "$source_public_counts" \
  "$target_public_counts"
then
  pass "every public table row count matches source"
else
  fail "public table inventory or row counts differ"

  echo
  echo "--- PUBLIC TABLE DIFF ---"

  diff -u \
    "$source_public_counts" \
    "$target_public_counts" \
    || true
fi

echo
echo "=== AUTH RECONCILIATION ==="

target_auth="$(
  auth_fingerprint \
    "$target_container" \
    "$target_database"
)"

if [ "$target_auth" = "$source_auth" ]; then
  pass "Auth users and identities exactly match source fingerprint"
else
  fail "Auth fingerprint differs from source"

  printf 'SOURCE_AUTH=%s\n' "$source_auth"
  printf 'TARGET_AUTH=%s\n' "$target_auth"
fi

echo
echo "=== STORAGE METADATA RECONCILIATION ==="

target_storage="$(
  storage_metadata_fingerprint \
    "$target_container" \
    "$target_database"
)"

if [ "$target_storage" = "$source_storage" ]; then
  pass "Storage bucket/object metadata counts match source"
else
  fail "Storage metadata fingerprint differs"

  printf 'SOURCE_STORAGE=%s\n' "$source_storage"
  printf 'TARGET_STORAGE=%s\n' "$target_storage"
fi

echo
echo "=== RESTORED DATABASE SEMANTIC DUMP ==="

if docker exec \
  "$target_container" \
  pg_dump \
    -U postgres \
    -d "$target_database" \
    --data-only \
    --quote-all-identifiers \
    --schema='*' \
    --exclude-schema='information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor' \
    --exclude-table='auth.schema_migrations' \
    --exclude-table='storage.migrations' \
    --exclude-table='supabase_functions.migrations' \
    --exclude-table='storage.buckets_vectors' \
    --exclude-table='storage.vector_indexes' \
    -f "$target_container_data"
then
  pass "isolated restored database semantic dump created"
else
  fail "isolated restored database semantic dump failed"
  exit "$failures"
fi

if docker cp \
  "$target_container:$target_container_data" \
  "$target_data_file" \
  >/dev/null
then
  pass "restored database semantic dump copied for offline reconciliation"
else
  fail "restored database semantic dump copy failed"
  exit "$failures"
fi

if [ -s "$target_data_file" ]; then
  pass "restored database semantic dump is non-empty"
else
  fail "restored database semantic dump is empty"
  exit "$failures"
fi

echo
echo "=== RESTORED DATABASE SEMANTIC RECONCILIATION ==="

if node \
  "$repo/scripts/admin-backup/build-database-reconciliation.mjs" \
  "$target_data_file" \
  "$target_reconciliation"
then
  pass "restored database reconciliation ledger created"
else
  fail "restored database reconciliation ledger creation failed"
  exit "$failures"
fi

target_table_count="$(
  jq -r \
    '.table_count' \
    "$target_reconciliation"
)"

target_total_rows="$(
  jq -r \
    '.total_row_count' \
    "$target_reconciliation"
)"

target_sequence_count="$(
  jq -r \
    '.sequence_count' \
    "$target_reconciliation"
)"

printf 'TARGET_RECONCILIATION_TABLES=%s\n' \
  "$target_table_count"

printf 'TARGET_RECONCILIATION_ROWS=%s\n' \
  "$target_total_rows"

printf 'TARGET_RECONCILIATION_SEQUENCES=%s\n' \
  "$target_sequence_count"

echo
echo "=== ARTIFACT VS RESTORED DATABASE SEMANTIC PROOF ==="

if cmp -s \
  "$artifact_reconciliation" \
  "$target_reconciliation"
then
  pass "restored database semantic ledger exactly matches backup artifact"
else
  fail "restored database semantic ledger differs from backup artifact"

  echo
  echo "--- SEMANTIC LEDGER DIFF ---"

  diff -u \
    "$artifact_reconciliation" \
    "$target_reconciliation" \
    | head -240 \
    || true
fi

artifact_sequence_sha="$(
  jq -r \
    '.sequence_state_sha256' \
    "$artifact_reconciliation"
)"

target_sequence_sha="$(
  jq -r \
    '.sequence_state_sha256' \
    "$target_reconciliation"
)"

if [ "$artifact_sequence_sha" = "$target_sequence_sha" ]; then
  pass "restored sequence state exactly matches artifact"
else
  fail "restored sequence state differs from artifact"
fi

if [ "$artifact_table_count" = "$target_table_count" ] &&
   [ "$artifact_total_rows" = "$target_total_rows" ]
then
  pass "restored table inventory and total row count match artifact"
else
  fail "restored table inventory or total row count differs from artifact"
fi

echo
echo "=== CROSS-SCHEMA DEPENDENCIES ==="

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d "$target_database" \
    -Atc "
      select to_regprocedure(
        'public.handle_new_workspace_user()'
      ) is not null;
    " \
  | grep -qxF 't'
then
  pass "handle_new_workspace_user restored"
else
  fail "handle_new_workspace_user missing"
fi

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U postgres \
    -d "$target_database" \
    -Atc "
      select to_regclass(
        'public.employee_profiles'
      ) is not null;
    " \
  | grep -qxF 't'
then
  pass "employee_profiles restored"
else
  fail "employee_profiles missing"
fi

echo
echo "=== FINAL NETWORK ISOLATION ==="

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  pass "entire restore remained externally network-isolated"
else
  fail "restore target gained external network interface"
fi

echo
echo "=== R8C-35C RESULT ==="

if [ "$failures" -eq 0 ]; then
  echo "PASS: isolated database restore matches artifact semantic ledger"
  echo "INFO: actual Storage object restore remains outside this database proof"
  echo "INFO: production restore claims remain intentionally unpromoted"
else
  echo "FAIL: semantic restore proof found $failures issue(s)"
fi

exit "$failures"

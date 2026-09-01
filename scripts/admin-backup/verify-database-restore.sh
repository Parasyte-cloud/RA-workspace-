#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  verify-database-restore.sh plan WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh foundation WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh bootstrap WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh platform WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh predata WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh data WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh postdata WORKSPACE_DIR OUTPUT_JSON
  verify-database-restore.sh semantic WORKSPACE_DIR OUTPUT_JSON

The foundation mode validates the authenticated-artifact input contract
and proves that an isolated PostgreSQL restore target can be created.

The bootstrap mode additionally establishes the minimum Supabase role
foundation, transfers authenticated recovery material, restores roles.sql,
and creates an empty isolated restore database.

The platform mode additionally establishes the isolated pg_cron,
platform-schema, ACL, and required-extension foundation.

The predata mode additionally replays the authenticated Auth, Storage,
supabase_functions, and RideArrivo public pre-data sections.

The data mode additionally replays authenticated database/data.sql.
auth-data.sql remains provenance-only and is not replayed.
No post-data section is replayed in data mode.

The postdata mode additionally replays the authenticated Auth, Storage,
supabase_functions, and RideArrivo public post-data sections and verifies
critical restored constraint and index contracts.

The semantic mode additionally creates a data-only dump from the isolated
restored target, rebuilds the database reconciliation ledger offline, and
requires it to exactly match the authenticated artifact reconciliation.

These incomplete modes do not emit restore evidence.
USAGE
}

require_command() {
  command_name="$1"

  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi

  printf 'ERROR: required command %s is unavailable\n' \
    "$command_name" >&2

  return 1
}

wait_for_final_postgres() {
  container_name="$1"
  database_name="$2"

  stable=0

  for attempt in $(seq 1 160)
  do
    running="$(
      docker inspect \
        --format '{{.State.Running}}' \
        "$container_name" \
        2>/dev/null \
        || echo false
    )"

    pid1_cmdline="$(
      docker exec \
        "$container_name" \
        sh -c \
        "tr '\000' ' ' < /proc/1/cmdline" \
        2>/dev/null \
        || echo unavailable
    )"

    if docker exec \
      "$container_name" \
      pg_isready \
        -U postgres \
        -d "$database_name" \
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

mode="${1:-}"
workspace="${2:-}"
output_json="${3:-}"

case "$mode" in
  plan|foundation|bootstrap|platform|predata|data|postdata|semantic)
    ;;

  *)
    usage
    exit 2
    ;;
esac

if [ -z "$workspace" ] ||
   [ -z "$output_json" ]
then
  usage
  exit 2
fi

if [ "$mode" = "plan" ]; then
  cat <<'PLAN'
1. Reject live database credentials and connection strings.
2. Accept only an already-authenticated backup workspace.
3. Require every database recovery component and reconciliation ledger.
4. Require the pinned PostgreSQL image to exist locally.
5. Never pull a verifier image from the network.
6. Start the disposable PostgreSQL target with network mode none.
7. Publish no host ports.
8. Verify the running container uses the locally inspected image.
9. Verify no external network interface exists in the target.
10. Foundation mode performs no database restore.
11. Bootstrap mode creates only the minimum isolated role/database foundation.
12. Bootstrap mode transfers authenticated recovery material but does not replay application schema or data.
13. Platform mode establishes pg_cron, required schemas, ACLs, and extensions only.
14. Predata mode replays authenticated managed and RideArrivo pre-data sections.
15. Data mode additionally replays database/data.sql exactly once.
16. auth-data.sql remains provenance-only and is never a second restore input.
17. Postdata mode replays exactly four authenticated post-data sections.
18. Postdata mode verifies critical managed and cross-schema constraints.
19. Semantic mode rebuilds reconciliation from the isolated restored target.
20. Semantic mode requires exact artifact-versus-target ledger equality.
21. Incomplete modes emit no restore evidence.
22. Keep all production restore claims unpromoted.
PLAN

  exit 0
fi

for forbidden in \
  SUPABASE_DB_URL \
  SUPABASE_DB_PASSWORD \
  DATABASE_URL \
  DIRECT_URL
do
  if printenv "$forbidden" >/dev/null 2>&1; then
    printf 'ERROR: forbidden database verifier credential is present: %s\n' \
      "$forbidden" >&2

    exit 1
  fi
done

for command_name in \
  bash \
  docker \
  jq \
  node \
  python3 \
  grep \
  sed \
  cmp \
  mktemp \
  wc \
  diff \
  tail \
  tr \
  seq
do
  require_command "$command_name"
done

if [ -d "$workspace" ]; then
  :
else
  printf 'ERROR: authenticated backup workspace is unavailable\n' >&2
  exit 1
fi

workspace="$(
  CDPATH= cd -- "$workspace" &&
    pwd
)"

output_directory="$(dirname "$output_json")"

mkdir -p "$output_directory"

output_directory="$(
  CDPATH= cd -- "$output_directory" &&
    pwd
)"

output_json="$output_directory/$(basename "$output_json")"

case "$output_json" in
  "$workspace"|"$workspace"/*)
    printf 'ERROR: verifier evidence path must be outside backup workspace\n' >&2
    exit 1
    ;;
esac

database_dir="$workspace/components/database"
database_reconciliation="$workspace/metadata/database-reconciliation.json"

required_files="
$database_dir/roles.sql
$database_dir/schema.sql
$database_dir/data.sql
$database_dir/auth-data.sql
$database_dir/auth-pre.sql
$database_dir/auth-post.sql
$database_dir/storage-pre.sql
$database_dir/storage-post.sql
$database_dir/supabase-functions-pre.sql
$database_dir/supabase-functions-post.sql
$database_dir/public-pre.sql
$database_dir/public-post.sql
$database_reconciliation
"

printf '%s\n' "$required_files" |
while IFS= read -r required_file
do
  if [ -z "$required_file" ]; then
    continue
  fi

  if [ -f "$required_file" ] &&
     [ -s "$required_file" ]
  then
    :
  else
    printf 'ERROR: required database recovery component is missing: %s\n' \
      "$required_file" >&2

    exit 1
  fi
done

if jq -e \
  '
    .format_version == 1
    and .algorithm
      == "sha256-schema-table-columns-sorted-copy-lines-v1"
    and (.table_count | type == "number")
    and (.table_count > 0)
    and (.total_row_count | type == "number")
    and (.total_row_count >= 0)
    and (.sequence_count | type == "number")
    and (.sequence_count >= 0)
    and (
      .sequence_state_sha256
      | type == "string"
    )
    and (
      .sequence_state_sha256
      | test("^[0-9a-f]{64}$")
    )
  ' \
  "$database_reconciliation" \
  >/dev/null
then
  echo "PASS: authenticated database reconciliation contract valid"
else
  printf 'ERROR: database reconciliation contract is invalid\n' >&2
  exit 1
fi

rm -f \
  "$output_json" \
  "${output_json}.partial.$$"

image="supabase/postgres:17.6.1.165"

if docker image inspect \
  "$image" \
  >/dev/null 2>&1
then
  echo "PASS: pinned restore image is already local"
else
  printf 'ERROR: pinned restore image is unavailable locally\n' >&2
  exit 1
fi

expected_image_id="$(
  docker image inspect \
    --format '{{.Id}}' \
    "$image"
)"

if printf '%s\n' "$expected_image_id" |
   grep -Eq '^sha256:[0-9a-f]{64}$'
then
  echo "PASS: local restore image identity recorded"
else
  printf 'ERROR: local restore image identity is invalid\n' >&2
  exit 1
fi

temporary_root="$(
  mktemp -d
)"

target_container="ridearrivo-db-restore-foundation-$$"
target_database="ridearrivo_restore_validation"

cleanup() {
  docker rm -f \
    "$target_container" \
    >/dev/null 2>&1 || true

  if [ -n "${evidence_partial:-}" ]; then
    rm -f "$evidence_partial"
  fi

  rm -rf \
    "$temporary_root"
}

trap cleanup EXIT

echo
echo "=== START ISOLATED DATABASE TARGET ==="

if docker run \
  --detach \
  --pull=never \
  --network none \
  --name "$target_container" \
  --env POSTGRES_PASSWORD="ridearrivo-db-verifier-only" \
  "$image" \
  >/dev/null
then
  echo "PASS: isolated PostgreSQL target started"
else
  printf 'ERROR: isolated PostgreSQL target failed to start\n' >&2
  exit 1
fi

if wait_for_final_postgres \
  "$target_container" \
  postgres
then
  echo "PASS: isolated PostgreSQL target reached stable readiness"
else
  printf 'ERROR: isolated PostgreSQL target failed readiness\n' >&2

  docker logs \
    "$target_container" \
    2>&1 |
    tail -120

  exit 1
fi

actual_image_id="$(
  docker inspect \
    --format '{{.Image}}' \
    "$target_container"
)"

if [ "$actual_image_id" = "$expected_image_id" ]; then
  echo "PASS: restore target uses inspected local image"
else
  printf 'ERROR: restore target image identity differs\n' >&2
  exit 1
fi

network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

if [ "$network_mode" = "none" ]; then
  echo "PASS: database verifier target network mode is none"
else
  printf 'ERROR: database verifier target is not network isolated\n' >&2
  exit 1
fi

port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$port_bindings" = "null" ] ||
   [ "$port_bindings" = "{}" ]
then
  echo "PASS: database verifier target publishes no ports"
else
  printf 'ERROR: database verifier target publishes ports\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: database verifier target has no external network interface"
else
  printf 'ERROR: database verifier target has an external network interface\n' >&2
  exit 1
fi

if [ "$mode" = "foundation" ]; then
  if [ -e "$output_json" ]; then
    printf 'ERROR: foundation mode unexpectedly emitted restore evidence\n' >&2
    exit 1
  else
    echo "PASS: foundation mode emitted no restore evidence"
  fi

  echo
  echo "PASS: artifact-only database verifier foundation established"
  echo "INFO: database and Auth restore remain intentionally unverified"

  exit 0
fi

echo
echo "=== MINIMAL SUPABASE ROLE BOOTSTRAP ==="

role_bootstrap_log="$temporary_root/role-bootstrap.log"

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d postgres \
    >"$role_bootstrap_log" 2>&1 <<'SQL'
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
  echo "PASS: minimal Supabase role bootstrap applied"
else
  printf 'ERROR: minimal Supabase role bootstrap failed\n' >&2

  tail -120 \
    "$role_bootstrap_log" >&2

  exit 1
fi

unexpected_bootstrap_superusers="$(
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

if [ "$unexpected_bootstrap_superusers" = "0" ]; then
  echo "PASS: role bootstrap introduced no superuser escalation"
else
  printf 'ERROR: role bootstrap introduced unexpected superuser privilege\n' >&2
  exit 1
fi

echo
echo "=== COPY AUTHENTICATED RESTORE MATERIAL ==="

for recovery_name in \
  roles.sql \
  schema.sql \
  data.sql \
  auth-data.sql \
  auth-pre.sql \
  auth-post.sql \
  storage-pre.sql \
  storage-post.sql \
  supabase-functions-pre.sql \
  supabase-functions-post.sql \
  public-pre.sql \
  public-post.sql
do
  if docker cp \
    "$database_dir/$recovery_name" \
    "$target_container:/tmp/$recovery_name" \
    >/dev/null
  then
    :
  else
    printf 'ERROR: could not transfer recovery component: %s\n' \
      "$recovery_name" >&2

    exit 1
  fi
done

echo "PASS: authenticated database recovery material transferred"

echo
echo "=== RESTORE ROLES ==="

roles_restore_log="$temporary_root/roles-restore.log"

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d postgres \
    -f /tmp/roles.sql \
    >"$roles_restore_log" 2>&1
then
  echo "PASS: roles.sql restored in isolated target"
else
  printf 'ERROR: roles.sql restore failed\n' >&2

  tail -120 \
    "$roles_restore_log" >&2

  exit 1
fi

post_restore_bootstrap_superusers="$(
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

if [ "$post_restore_bootstrap_superusers" = "0" ]; then
  echo "PASS: roles restore preserved bootstrap non-superuser contract"
else
  printf 'ERROR: roles restore elevated verifier bootstrap roles\n' >&2
  exit 1
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
  echo "PASS: empty isolated restore database created"
else
  printf 'ERROR: empty isolated restore database creation failed\n' >&2
  exit 1
fi

database_exists="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d postgres \
      -Atc "
        select count(*)
        from pg_database
        where datname = '$target_database';
      "
)"

if [ "$database_exists" = "1" ]; then
  echo "PASS: isolated restore database existence verified"
else
  printf 'ERROR: isolated restore database is unavailable\n' >&2
  exit 1
fi

network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$network_mode" = "none" ] &&
   {
     [ "$port_bindings" = "null" ] ||
     [ "$port_bindings" = "{}" ];
   }
then
  echo "PASS: bootstrap retained network-none and zero-port isolation"
else
  printf 'ERROR: bootstrap changed database target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: bootstrap target still has no external network interface"
else
  printf 'ERROR: bootstrap target gained an external network interface\n' >&2
  exit 1
fi

if [ "$mode" = "bootstrap" ]; then
  if [ -e "$output_json" ]; then
    printf 'ERROR: bootstrap mode unexpectedly emitted restore evidence\n' >&2
    exit 1
  else
    echo "PASS: bootstrap mode emitted no restore evidence"
  fi

  echo
  echo "PASS: artifact-only database bootstrap mechanics established"
  echo "INFO: schema, data, database semantics, and Auth recovery remain unverified"

  exit 0
fi

echo
echo "=== CONFIGURE ISOLATED PG_CRON ==="

cron_config_log="$temporary_root/cron-config.log"

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d postgres \
    -c "ALTER SYSTEM SET cron.database_name = '$target_database';" \
    >"$cron_config_log" 2>&1
then
  echo "PASS: isolated pg_cron database configured"
else
  printf 'ERROR: isolated pg_cron configuration failed\n' >&2

  tail -120 \
    "$cron_config_log" >&2

  exit 1
fi

echo
echo "=== RESTART ISOLATED POSTGRES ==="

if docker restart \
  "$target_container" \
  >/dev/null
then
  echo "PASS: isolated PostgreSQL target restarted"
else
  printf 'ERROR: isolated PostgreSQL restart failed\n' >&2
  exit 1
fi

if wait_for_final_postgres \
  "$target_container" \
  "$target_database"
then
  echo "PASS: isolated restore database reached stable post-restart readiness"
else
  printf 'ERROR: isolated restore database failed post-restart readiness\n' >&2

  docker logs \
    "$target_container" \
    2>&1 |
    tail -120

  exit 1
fi

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

if [ "$actual_cron_database" = "$target_database" ]; then
  echo "PASS: pg_cron is bound to isolated restore database"
else
  printf 'ERROR: pg_cron database affinity is incorrect\n' >&2
  exit 1
fi

echo
echo "=== POST-RESTART ISOLATION ==="

network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$network_mode" = "none" ] &&
   {
     [ "$port_bindings" = "null" ] ||
     [ "$port_bindings" = "{}" ];
   }
then
  echo "PASS: restart preserved network-none and zero-port isolation"
else
  printf 'ERROR: restart changed database target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: restart preserved absence of external network interface"
else
  printf 'ERROR: restart introduced an external network interface\n' >&2
  exit 1
fi

echo
echo "=== REMOVE TEMPLATE0 PUBLIC SCHEMA ==="

drop_public_log="$temporary_root/drop-public.log"

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -c "DROP SCHEMA public;" \
    >"$drop_public_log" 2>&1
then
  echo "PASS: template0 public schema removed"
else
  printf 'ERROR: template0 public schema removal failed\n' >&2

  tail -120 \
    "$drop_public_log" >&2

  exit 1
fi

public_schema_count="$(
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

if [ "$public_schema_count" = "0" ]; then
  echo "PASS: public schema absent before authenticated replay"
else
  printf 'ERROR: public schema still exists before replay\n' >&2
  exit 1
fi

echo
echo "=== PLATFORM SCHEMA FOUNDATION ==="

platform_schema_log="$temporary_root/platform-schema.log"

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    >"$platform_schema_log" 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions
  AUTHORIZATION postgres;

ALTER SCHEMA extensions
  OWNER TO postgres;

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
  echo "PASS: platform schemas and ACL foundation established"
else
  printf 'ERROR: platform schema foundation failed\n' >&2

  tail -160 \
    "$platform_schema_log" >&2

  exit 1
fi

platform_owners="$(
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

expected_platform_owners="$(
  printf '%s\n' \
    'extensions|postgres' \
    'vault|supabase_admin'
)"

if [ "$platform_owners" = "$expected_platform_owners" ]; then
  echo "PASS: platform schema ownership contract exact"
else
  printf 'ERROR: platform schema ownership contract differs\n' >&2
  printf '%s\n' "$platform_owners" >&2
  exit 1
fi

public_platform_acl_count="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_namespace n
        cross join lateral aclexplode(n.nspacl) acl
        where n.nspname in (
          'extensions',
          'vault'
        )
          and acl.grantee = 0;
      "
)"

if [ "$public_platform_acl_count" = "0" ]; then
  echo "PASS: platform schemas expose no PUBLIC ACL grants"
else
  printf 'ERROR: platform schema PUBLIC ACL exposure detected\n' >&2
  exit 1
fi

platform_privileges="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select
          has_schema_privilege(
            'anon',
            'extensions',
            'USAGE'
          )
          and not has_schema_privilege(
            'anon',
            'extensions',
            'CREATE'
          )
          and has_schema_privilege(
            'authenticated',
            'extensions',
            'USAGE'
          )
          and not has_schema_privilege(
            'authenticated',
            'extensions',
            'CREATE'
          )
          and has_schema_privilege(
            'service_role',
            'extensions',
            'USAGE'
          )
          and has_schema_privilege(
            'service_role',
            'vault',
            'USAGE'
          )
          and not has_schema_privilege(
            'anon',
            'vault',
            'USAGE'
          )
          and not has_schema_privilege(
            'authenticated',
            'vault',
            'USAGE'
          );
      "
)"

if [ "$platform_privileges" = "t" ]; then
  echo "PASS: platform schema privilege contract valid"
else
  printf 'ERROR: platform schema privilege contract invalid\n' >&2
  exit 1
fi

echo
echo "=== CRON SCHEMA MINIMALITY ==="

cron_schema_before_extensions="$(
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

if [ "$cron_schema_before_extensions" = "0" ]; then
  echo "PASS: cron schema not fabricated before pg_cron extension"
else
  printf 'ERROR: cron schema exists before pg_cron installation\n' >&2
  exit 1
fi

echo
echo "=== REQUIRED PLATFORM EXTENSIONS ==="

extension_log="$temporary_root/extensions.log"

if docker exec -i \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    >"$extension_log" 2>&1 <<'SQL'
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
  echo "PASS: required platform extensions installed"
else
  printf 'ERROR: required platform extension installation failed\n' >&2

  tail -180 \
    "$extension_log" >&2

  exit 1
fi

extension_inventory="$(
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
          n.nspname
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

expected_extension_inventory="$(
  printf '%s\n' \
    'pg_cron|pg_catalog' \
    'pg_stat_statements|extensions' \
    'pgcrypto|extensions' \
    'supabase_vault|vault' \
    'uuid-ossp|extensions'
)"

if [ "$extension_inventory" = "$expected_extension_inventory" ]; then
  echo "PASS: required extension schema inventory exact"
else
  printf 'ERROR: required extension schema inventory differs\n' >&2
  printf '%s\n' "$extension_inventory" >&2
  exit 1
fi

cron_public_acl_count="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select count(*)
        from pg_namespace n
        cross join lateral aclexplode(n.nspacl) acl
        where n.nspname = 'cron'
          and acl.grantee = 0;
      "
)"

if [ "$cron_public_acl_count" = "0" ]; then
  echo "PASS: cron schema exposes no PUBLIC ACL grants"
else
  printf 'ERROR: cron schema PUBLIC ACL exposure detected\n' >&2
  exit 1
fi

cron_privilege_contract="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select
          has_schema_privilege(
            'supabase_admin',
            'cron',
            'USAGE'
          )
          and has_schema_privilege(
            'supabase_admin',
            'cron',
            'CREATE'
          )
          and has_schema_privilege(
            'postgres',
            'cron',
            'USAGE'
          );
      "
)"

if [ "$cron_privilege_contract" = "t" ]; then
  echo "PASS: cron schema privilege contract valid"
else
  printf 'ERROR: cron schema privilege contract invalid\n' >&2
  exit 1
fi

echo
echo "=== PLATFORM MODE FINAL ISOLATION ==="

final_network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

final_port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$final_network_mode" = "none" ] &&
   {
     [ "$final_port_bindings" = "null" ] ||
     [ "$final_port_bindings" = "{}" ];
   }
then
  echo "PASS: complete platform bootstrap remained network isolated"
else
  printf 'ERROR: platform bootstrap changed target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: platform target has no external network interface"
else
  printf 'ERROR: platform target gained an external network interface\n' >&2
  exit 1
fi

if [ "$mode" = "platform" ]; then
  if [ -e "$output_json" ]; then
    printf 'ERROR: platform mode unexpectedly emitted restore evidence\n' >&2
    exit 1
  else
    echo "PASS: platform mode emitted no restore evidence"
  fi

  echo
  echo "PASS: artifact-only database platform foundation established"
  echo "INFO: authenticated Auth/public/schema/data replay remains unverified"

  exit 0
fi

restore_predata_component() {
  component_label="$1"
  component_file="$2"
  component_log="$3"

  if docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U supabase_admin \
      -d "$target_database" \
      -f "/tmp/$component_file" \
      >"$component_log" 2>&1
  then
    printf 'PASS: %s restored\n' \
      "$component_label"
  else
    printf 'ERROR: %s restore failed\n' \
      "$component_label" >&2

    tail -160 \
      "$component_log" >&2

    exit 1
  fi
}

echo
echo "=== AUTHENTICATED AUTH PRE-DATA ==="

restore_predata_component \
  "Auth pre-data" \
  "auth-pre.sql" \
  "$temporary_root/auth-pre.log"

auth_foundation="$(
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
          to_regclass('auth.identities') is not null;
      "
)"

if [ "$auth_foundation" = "t" ]; then
  echo "PASS: Auth pre-data foundation exists"
else
  printf 'ERROR: Auth pre-data foundation is incomplete\n' >&2
  exit 1
fi

echo
echo "=== AUTHENTICATED STORAGE PRE-DATA ==="

restore_predata_component \
  "Storage pre-data" \
  "storage-pre.sql" \
  "$temporary_root/storage-pre.log"

storage_foundation="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select
          to_regclass('storage.buckets') is not null
          and
          to_regclass('storage.objects') is not null;
      "
)"

if [ "$storage_foundation" = "t" ]; then
  echo "PASS: Storage metadata pre-data foundation exists"
else
  printf 'ERROR: Storage pre-data foundation is incomplete\n' >&2
  exit 1
fi

echo
echo "=== AUTHENTICATED SUPABASE_FUNCTIONS PRE-DATA ==="

restore_predata_component \
  "supabase_functions pre-data" \
  "supabase-functions-pre.sql" \
  "$temporary_root/supabase-functions-pre.log"

supabase_functions_foundation="$(
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

if [ "$supabase_functions_foundation" = "t" ]; then
  echo "PASS: supabase_functions pre-data foundation exists"
else
  printf 'ERROR: supabase_functions pre-data foundation is incomplete\n' >&2
  exit 1
fi

supabase_functions_owners="$(
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

expected_supabase_functions_owners="$(
  printf '%s\n' \
    'hooks|supabase_functions_admin' \
    'migrations|supabase_functions_admin' \
    'schema|supabase_admin'
)"

if [ "$supabase_functions_owners" = "$expected_supabase_functions_owners" ]; then
  echo "PASS: supabase_functions ownership contract exact"
else
  printf 'ERROR: supabase_functions ownership contract differs\n' >&2
  printf '%s\n' "$supabase_functions_owners" >&2
  exit 1
fi

echo
echo "=== AUTHENTICATED RIDEARRIVO PUBLIC PRE-DATA ==="

restore_predata_component \
  "RideArrivo public pre-data" \
  "public-pre.sql" \
  "$temporary_root/public-pre.log"

public_schema_count="$(
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

if [ "$public_schema_count" = "1" ]; then
  echo "PASS: RideArrivo public schema recreated exactly once"
else
  printf 'ERROR: RideArrivo public schema recreation is invalid\n' >&2
  exit 1
fi

cross_schema_foundation="$(
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
            'public.employee_profiles'
          ) is not null
          and
          to_regprocedure(
            'public.handle_new_workspace_user()'
          ) is not null;
      "
)"

if [ "$cross_schema_foundation" = "t" ]; then
  echo "PASS: RideArrivo cross-schema pre-data foundation exists"
else
  printf 'ERROR: RideArrivo pre-data foundation is incomplete\n' >&2
  exit 1
fi

echo
echo "=== PRE-DATA NETWORK ISOLATION ==="

predata_network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

predata_port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$predata_network_mode" = "none" ] &&
   {
     [ "$predata_port_bindings" = "null" ] ||
     [ "$predata_port_bindings" = "{}" ];
   }
then
  echo "PASS: authenticated pre-data replay remained network isolated"
else
  printf 'ERROR: pre-data replay changed target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: pre-data target has no external network interface"
else
  printf 'ERROR: pre-data target gained an external network interface\n' >&2
  exit 1
fi

if [ "$mode" = "predata" ]; then
  if [ -e "$output_json" ]; then
    printf 'ERROR: predata mode unexpectedly emitted restore evidence\n' >&2
    exit 1
  else
    echo "PASS: predata mode emitted no restore evidence"
  fi

  echo
  echo "PASS: authenticated artifact pre-data replay established"
  echo "INFO: data.sql and every post-data section remain intentionally unreplayed"
  echo "INFO: database and Auth recovery claims remain intentionally unverified"

  exit 0
fi

echo
echo "=== AUTHENTICATED DATABASE DATA ==="

data_restore_log="$temporary_root/data-restore.log"

if docker exec \
  "$target_container" \
  psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -U supabase_admin \
    -d "$target_database" \
    -f /tmp/data.sql \
    >"$data_restore_log" 2>&1
then
  echo "PASS: authenticated database data restored"
else
  printf 'ERROR: authenticated database data restore failed\n' >&2

  tail -180 \
    "$data_restore_log" >&2

  exit 1
fi

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
          to_regclass('storage.objects') is not null
          and
          to_regclass('supabase_functions.hooks') is not null
          and
          to_regclass('supabase_functions.migrations') is not null
          and
          to_regclass('public.employee_profiles') is not null;
      "
)"

if [ "$managed_foundation" = "t" ]; then
  echo "PASS: data replay preserved required schema foundations"
else
  printf 'ERROR: required schema foundation missing after data replay\n' >&2
  exit 1
fi

data_network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

data_port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$data_network_mode" = "none" ] &&
   {
     [ "$data_port_bindings" = "null" ] ||
     [ "$data_port_bindings" = "{}" ];
   }
then
  echo "PASS: authenticated data replay remained network isolated"
else
  printf 'ERROR: data replay changed target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: data replay target has no external network interface"
else
  printf 'ERROR: data replay target gained an external network interface\n' >&2
  exit 1
fi

if [ "$mode" = "data" ]; then
  if [ -e "$output_json" ]; then
    printf 'ERROR: data mode unexpectedly emitted restore evidence\n' >&2
    exit 1
  else
    echo "PASS: data mode emitted no restore evidence"
  fi

  echo
  echo "PASS: authenticated artifact data replay established"
  echo "INFO: auth-data.sql remains provenance-only and unreplayed"
  echo "INFO: every post-data section remains intentionally unreplayed"
  echo "INFO: database and Auth recovery claims remain intentionally unverified"

  exit 0
fi

restore_postdata_component() {
  component_label="$1"
  component_file="$2"
  component_log="$3"

  if docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U supabase_admin \
      -d "$target_database" \
      -f "/tmp/$component_file" \
      >"$component_log" 2>&1
  then
    printf 'PASS: %s restored\n' "$component_label"
  else
    printf 'ERROR: %s restore failed\n' "$component_label" >&2
    tail -180 "$component_log" >&2
    exit 1
  fi
}

echo
echo "=== AUTHENTICATED AUTH POST-DATA ==="

restore_postdata_component \
  "Auth post-data" \
  "auth-post.sql" \
  "$temporary_root/auth-post.log"

echo
echo "=== AUTHENTICATED STORAGE POST-DATA ==="

restore_postdata_component \
  "Storage post-data" \
  "storage-post.sql" \
  "$temporary_root/storage-post.log"

echo
echo "=== AUTHENTICATED SUPABASE_FUNCTIONS POST-DATA ==="

restore_postdata_component \
  "supabase_functions post-data" \
  "supabase-functions-post.sql" \
  "$temporary_root/supabase-functions-post.log"

echo
echo "=== AUTHENTICATED RIDEARRIVO PUBLIC POST-DATA ==="

restore_postdata_component \
  "RideArrivo public post-data" \
  "public-post.sql" \
  "$temporary_root/public-post.log"

echo
echo "=== POST-DATA CONTRACT VERIFICATION ==="

managed_constraint_contract="$(
  docker exec \
    "$target_container" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -U postgres \
      -d "$target_database" \
      -Atc "
        select
          (
            select count(*)
            from pg_constraint c
            join pg_class r
              on r.oid = c.conrelid
            join pg_namespace n
              on n.oid = r.relnamespace
            where n.nspname = 'auth'
              and r.relname = 'identities'
              and c.contype = 'f'
          ) >= 1
          and
          (
            select count(*)
            from pg_constraint c
            join pg_class r
              on r.oid = c.conrelid
            join pg_namespace n
              on n.oid = r.relnamespace
            where n.nspname = 'storage'
              and r.relname = 'objects'
              and c.contype = 'f'
          ) >= 1;
      "
)"

if [ "$managed_constraint_contract" = "t" ]; then
  echo "PASS: Auth and Storage foreign-key contracts restored"
else
  printf 'ERROR: Auth or Storage foreign-key contract missing\n' >&2
  exit 1
fi

sf_primary_keys="$(
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
        where n.nspname = 'supabase_functions'
          and r.relname in ('hooks', 'migrations')
          and c.contype = 'p';
      "
)"

if [ "$sf_primary_keys" = "2" ]; then
  echo "PASS: supabase_functions primary-key contract restored"
else
  printf 'ERROR: supabase_functions primary-key contract incomplete\n' >&2
  exit 1
fi

sf_secondary_indexes="$(
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

if [ "$sf_secondary_indexes" = "2" ]; then
  echo "PASS: supabase_functions secondary-index contract restored"
else
  printf 'ERROR: supabase_functions secondary-index contract incomplete\n' >&2
  exit 1
fi

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
  echo "PASS: employee_profiles Auth foreign key restored"
else
  printf 'ERROR: employee_profiles Auth foreign key missing\n' >&2
  exit 1
fi

postdata_network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

postdata_port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$postdata_network_mode" = "none" ] &&
   {
     [ "$postdata_port_bindings" = "null" ] ||
     [ "$postdata_port_bindings" = "{}" ];
   }
then
  echo "PASS: authenticated post-data replay remained network isolated"
else
  printf 'ERROR: post-data replay changed target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: post-data target has no external network interface"
else
  printf 'ERROR: post-data target gained an external network interface\n' >&2
  exit 1
fi

if [ "$mode" = "postdata" ]; then
  if [ -e "$output_json" ]; then
    printf 'ERROR: postdata mode unexpectedly emitted restore evidence\n' >&2
    exit 1
  else
    echo "PASS: postdata mode emitted no restore evidence"
  fi

  echo
  echo "PASS: authenticated artifact post-data replay established"
  echo "INFO: semantic reconciliation and final restore proof remain unverified"

  exit 0
fi

echo
echo "=== RESTORED DATABASE SEMANTIC DUMP ==="

database_verifier_dir="$(
  CDPATH= cd -- "$(dirname -- "$0")" &&
    pwd
)"

reconciliation_builder="$database_verifier_dir/build-database-reconciliation.mjs"
artifact_reconciliation="$database_reconciliation"
target_data_file="$temporary_root/target-data.sql"
target_reconciliation="$temporary_root/target-database-reconciliation.json"
target_container_data="/tmp/ridearrivo-target-data-$$.sql"

if [ -f "$reconciliation_builder" ]; then
  echo "PASS: database reconciliation builder available"
else
  printf 'ERROR: database reconciliation builder missing\n' >&2
  exit 1
fi

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
  echo "PASS: isolated restored database semantic dump created"
else
  printf 'ERROR: isolated restored database semantic dump failed\n' >&2
  exit 1
fi

if docker cp \
  "$target_container:$target_container_data" \
  "$target_data_file" \
  >/dev/null
then
  echo "PASS: restored semantic dump copied for offline reconciliation"
else
  printf 'ERROR: restored semantic dump copy failed\n' >&2
  exit 1
fi

docker exec \
  "$target_container" \
  rm -f "$target_container_data" \
  >/dev/null 2>&1 \
  || true

if [ -s "$target_data_file" ]; then
  echo "PASS: restored semantic dump is non-empty"
else
  printf 'ERROR: restored semantic dump is empty\n' >&2
  exit 1
fi

echo
echo "=== RESTORED DATABASE SEMANTIC RECONCILIATION ==="

if node \
  "$reconciliation_builder" \
  "$target_data_file" \
  "$target_reconciliation"
then
  echo "PASS: restored database reconciliation ledger created"
else
  printf 'ERROR: restored database reconciliation ledger creation failed\n' >&2
  exit 1
fi

if cmp -s \
  "$artifact_reconciliation" \
  "$target_reconciliation"
then
  echo "PASS: restored database semantic ledger exactly matches backup artifact"
else
  printf 'ERROR: restored database semantic ledger differs from backup artifact\n' >&2

  echo
  echo "=== SEMANTIC LEDGER DIFF ==="

  diff -u \
    "$artifact_reconciliation" \
    "$target_reconciliation" \
    | head -240 \
    || true

  exit 1
fi

artifact_table_count="$(
  jq -r \
    '.table_count' \
    "$artifact_reconciliation"
)"

target_table_count="$(
  jq -r \
    '.table_count' \
    "$target_reconciliation"
)"

artifact_total_rows="$(
  jq -r \
    '.total_row_count' \
    "$artifact_reconciliation"
)"

target_total_rows="$(
  jq -r \
    '.total_row_count' \
    "$target_reconciliation"
)"

artifact_sequence_count="$(
  jq -r \
    '.sequence_count' \
    "$artifact_reconciliation"
)"

target_sequence_count="$(
  jq -r \
    '.sequence_count' \
    "$target_reconciliation"
)"

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

if [ "$artifact_table_count" = "$target_table_count" ] &&
   [ "$artifact_total_rows" = "$target_total_rows" ]
then
  echo "PASS: restored table inventory and total row count match artifact"
else
  printf 'ERROR: restored table inventory or total row count differs\n' >&2
  exit 1
fi

if [ "$artifact_sequence_count" = "$target_sequence_count" ] &&
   [ "$artifact_sequence_sha" = "$target_sequence_sha" ]
then
  echo "PASS: restored sequence state exactly matches artifact"
else
  printf 'ERROR: restored sequence state differs from artifact\n' >&2
  exit 1
fi

echo
echo "=== SEMANTIC RESTORE ISOLATION ==="

semantic_network_mode="$(
  docker inspect \
    --format '{{.HostConfig.NetworkMode}}' \
    "$target_container"
)"

semantic_port_bindings="$(
  docker inspect \
    --format '{{json .HostConfig.PortBindings}}' \
    "$target_container"
)"

if [ "$semantic_network_mode" = "none" ] &&
   {
     [ "$semantic_port_bindings" = "null" ] ||
     [ "$semantic_port_bindings" = "{}" ];
   }
then
  echo "PASS: semantic verification remained network isolated"
else
  printf 'ERROR: semantic verification changed target isolation\n' >&2
  exit 1
fi

if docker exec \
  "$target_container" \
  sh -c 'test ! -e /sys/class/net/eth0'
then
  echo "PASS: semantic target has no external network interface"
else
  printf 'ERROR: semantic target gained an external network interface\n' >&2
  exit 1
fi

if [ -e "$output_json" ]; then
  printf 'ERROR: semantic mode encountered pre-existing restore evidence\n' >&2
  exit 1
else
  echo "PASS: semantic mode emitted no restore evidence before final proof"
fi

echo
echo "PASS: isolated restored database matches authenticated semantic ledger"

echo
echo "=== FINALIZE ISOLATED DATABASE TARGET ==="

if docker rm -f \
  "$target_container" \
  >/dev/null 2>&1
then
  echo "PASS: isolated database verification target removed"
else
  printf 'ERROR: isolated database verification target cleanup failed\n' >&2
  exit 1
fi

if docker ps -a \
  --format '{{.Names}}' |
  grep -Fxq "$target_container"
then
  printf 'ERROR: isolated database verification target still exists\n' >&2
  exit 1
else
  echo "PASS: isolated database target cleanup verified"
fi

echo
echo "=== BUILD DATABASE RESTORE VERIFICATION EVIDENCE ==="

verified_at="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

reconciliation_algorithm="$(
  jq -r \
    '.algorithm' \
    "$artifact_reconciliation"
)"

artifact_reconciliation_sha="$(
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const file = process.argv[1];

    process.stdout.write(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex")
    );
  ' \
    "$artifact_reconciliation"
)"

target_reconciliation_sha="$(
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const file = process.argv[1];

    process.stdout.write(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex")
    );
  ' \
    "$target_reconciliation"
)"

if [ "$artifact_reconciliation_sha" = "$target_reconciliation_sha" ] &&
   printf '%s\n' "$artifact_reconciliation_sha" |
     grep -Eq '^[0-9a-f]{64}$'
then
  echo "PASS: database restore reconciliation evidence hash exact"
else
  printf 'ERROR: database restore reconciliation evidence hash mismatch\n' >&2
  exit 1
fi

evidence_partial="${output_json}.partial.$$"

rm -f "$evidence_partial"

if jq -n \
  --arg verifier \
    "ridearrivo-database-restore-verifier" \
  --arg verified_at \
    "$verified_at" \
  --arg image_reference \
    "$image" \
  --arg image_id \
    "$actual_image_id" \
  --arg reconciliation_algorithm \
    "$reconciliation_algorithm" \
  --arg artifact_reconciliation_sha256 \
    "$artifact_reconciliation_sha" \
  --arg target_reconciliation_sha256 \
    "$target_reconciliation_sha" \
  --arg sequence_state_sha256 \
    "$artifact_sequence_sha" \
  --argjson table_count \
    "$artifact_table_count" \
  --argjson total_row_count \
    "$artifact_total_rows" \
  --argjson sequence_count \
    "$artifact_sequence_count" \
  '{
    format_version: 1,
    verifier: $verifier,
    verified_at: $verified_at,

    database_restore_verified: true,
    auth_restore_verified: true,
    storage_database_metadata_verified: true,

    production_database_contacted: false,

    isolated_target: {
      network_disabled: true,
      ports_published: false,
      external_network_interface_present: false,
      cleanup_verified: true,
      image_reference: $image_reference,
      image_id: $image_id
    },

    reconciliation: {
      source_component:
        "metadata/database-reconciliation.json",

      algorithm:
        $reconciliation_algorithm,

      exact: true,

      artifact_sha256:
        $artifact_reconciliation_sha256,

      target_sha256:
        $target_reconciliation_sha256,

      table_count:
        $table_count,

      total_row_count:
        $total_row_count,

      sequence_count:
        $sequence_count,

      sequence_state_sha256:
        $sequence_state_sha256
    }
  }' \
  >"$evidence_partial"
then
  :
else
  rm -f "$evidence_partial"

  printf 'ERROR: database restore verification evidence generation failed\n' >&2
  exit 1
fi

if jq -e '
  .format_version == 1
  and
  .verifier
    == "ridearrivo-database-restore-verifier"
  and
  (
    .verified_at
    | type
  ) == "string"
  and
  .database_restore_verified == true
  and
  .auth_restore_verified == true
  and
  .storage_database_metadata_verified == true
  and
  .production_database_contacted == false
  and
  .isolated_target.network_disabled == true
  and
  .isolated_target.ports_published == false
  and
  .isolated_target.external_network_interface_present
    == false
  and
  .isolated_target.cleanup_verified == true
  and
  (
    .isolated_target.image_reference
    | type
  ) == "string"
  and
  (
    .isolated_target.image_id
    | startswith("sha256:")
  )
  and
  .reconciliation.exact == true
  and
  .reconciliation.source_component
    == "metadata/database-reconciliation.json"
  and
  (
    .reconciliation.algorithm
    | type
  ) == "string"
  and
  (
    .reconciliation.artifact_sha256
    | test("^[0-9a-f]{64}$")
  )
  and
  (
    .reconciliation.target_sha256
    | test("^[0-9a-f]{64}$")
  )
  and
  .reconciliation.artifact_sha256
    == .reconciliation.target_sha256
  and
  (
    .reconciliation.table_count
    | type
  ) == "number"
  and
  .reconciliation.table_count >= 0
  and
  (
    .reconciliation.total_row_count
    | type
  ) == "number"
  and
  .reconciliation.total_row_count >= 0
  and
  (
    .reconciliation.sequence_count
    | type
  ) == "number"
  and
  .reconciliation.sequence_count >= 0
  and
  (
    .reconciliation.sequence_state_sha256
    | test("^[0-9a-f]{64}$")
  )
' \
  "$evidence_partial" \
  >/dev/null
then
  echo "PASS: database restore verification evidence contract valid"
else
  rm -f "$evidence_partial"

  printf 'ERROR: database restore verification evidence contract invalid\n' >&2
  exit 1
fi

chmod 600 "$evidence_partial"

mv \
  "$evidence_partial" \
  "$output_json"

echo "PASS: database restore verification evidence emitted atomically"

echo
echo "PASS: isolated database and Auth restore verification established"
echo "INFO: Storage object verification remains independently authenticated"
echo "INFO: final database, Auth, and Storage artifact claims remain unpromoted"

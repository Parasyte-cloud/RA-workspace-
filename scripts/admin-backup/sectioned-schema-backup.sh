#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  sectioned-schema-backup.sh plan WORKSPACE_DIR
  sectioned-schema-backup.sh run WORKSPACE_DIR
EOF
}

require_command() {
  local name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'ERROR: required command %s is unavailable\n' "$name" >&2
    return 1
  fi
}

nonempty_file() {
  [ -f "$1" ] && [ -s "$1" ]
}

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

pgdump_image="${SUPABASE_INTERNAL_IMAGE_REGISTRY:+${SUPABASE_INTERNAL_IMAGE_REGISTRY%/}/}supabase/postgres:17.6.1.165"
db_dir="$workspace/components/database"

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

mkdir -p "$db_dir"

print_plan() {
  cat <<EOF
Docker image: $pgdump_image
Output:
  $auth_pre
  $auth_post
  $storage_pre
  $storage_post
  $sf_pre
  $sf_post
  $public_pre
  $public_post
Credentials:
  SUPABASE_DB_URL is parsed into non-secret connection coordinates.
  The database password is transported only through a temporary mode-600 .pgpass file.
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

require_command docker
require_command node
require_command grep

if ! docker image inspect \
  "$pgdump_image" \
  >/dev/null 2>&1
then
  printf 'ERROR: required pg_dump image is not available: %s\n' \
    "$pgdump_image" >&2
  exit 1
fi

pgdump_version="$(
  docker run \
    --rm \
    --network none \
    --entrypoint pg_dump \
    "$pgdump_image" \
    --version
)"

case "$pgdump_version" in
  *"PostgreSQL) 17.6"*)
    ;;
  *)
    printf 'ERROR: unexpected pg_dump version\n' >&2
    exit 1
    ;;
esac

credential_dir="$(
  mktemp -d
)"

cleanup() {
  rm -rf "$credential_dir"
}

trap cleanup EXIT

chmod 700 "$credential_dir"

pgpass="$credential_dir/.pgpass"
host_file="$credential_dir/host"
port_file="$credential_dir/port"
database_file="$credential_dir/database"
user_file="$credential_dir/user"
sslmode_file="$credential_dir/sslmode"
local_host_file="$credential_dir/local-host"

db_url_file="$credential_dir/db-url"

umask 077

printf '%s' "$SUPABASE_DB_URL" \
  > "$db_url_file"

chmod 600 "$db_url_file"

node - \
  "$credential_dir" \
  "$db_url_file" <<'NODE'
const fs = require('fs')

const outputDir = process.argv[2]
const inputPath = process.argv[3]

const raw =
  fs.readFileSync(
    inputPath,
    'utf8',
  ).trim()

const parsed = new URL(raw)

  if (
    parsed.protocol !== 'postgresql:'
    && parsed.protocol !== 'postgres:'
  ) {
    throw new Error(
      'SUPABASE_DB_URL is not PostgreSQL',
    )
  }

  const decode = value =>
    decodeURIComponent(value)

  const originalHost = parsed.hostname

  const localHost =
    originalHost === '127.0.0.1'
    || originalHost === 'localhost'

  const host =
    localHost
      ? 'host.docker.internal'
      : originalHost

  const port =
    parsed.port || '5432'

  const database =
    decode(
      parsed.pathname.replace(/^\/+/, ''),
    )

  const user =
    decode(parsed.username)

  const password =
    decode(parsed.password)

  let sslmode =
    parsed.searchParams.get('sslmode')

  if (!sslmode) {
    sslmode =
      localHost
        ? 'disable'
        : 'require'
  }

  const allowedSslModes = new Set([
    'disable',
    'allow',
    'prefer',
    'require',
    'verify-ca',
    'verify-full',
  ])

  if (!allowedSslModes.has(sslmode)) {
    throw new Error(
      'unsupported sslmode',
    )
  }

  for (
    const [name, value]
    of Object.entries({
      host,
      port,
      database,
      user,
      sslmode,
    })
  ) {
    if (
      !value
      || /[\r\n\0]/.test(value)
    ) {
      throw new Error(
        `unsafe or empty ${name}`,
      )
    }
  }

  if (/[\r\n\0]/.test(password)) {
    throw new Error(
      'unsafe password characters',
    )
  }

  const pgpassEscape = value =>
    value
      .replace(/\\/g, '\\\\')
      .replace(/:/g, '\\:')

  fs.writeFileSync(
    `${outputDir}/.pgpass`,
    [
      host,
      port,
      database,
      user,
      password,
    ]
      .map(pgpassEscape)
      .join(':')
      + '\n',
    {
      mode: 0o600,
    },
  )

  const safeFiles = {
    host,
    port,
    database,
    user,
    sslmode,
    'local-host':
      localHost
        ? 'true'
        : 'false',
  }

for (
  const [name, value]
  of Object.entries(safeFiles)
) {
  fs.writeFileSync(
    `${outputDir}/${name}`,
    `${value}\n`,
    {
      mode: 0o600,
    },
  )
}
NODE

rm -f "$db_url_file"

chmod 600 \
  "$pgpass" \
  "$host_file" \
  "$port_file" \
  "$database_file" \
  "$user_file" \
  "$sslmode_file" \
  "$local_host_file"

pg_host="$(cat "$host_file")"
pg_port="$(cat "$port_file")"
pg_database="$(cat "$database_file")"
pg_user="$(cat "$user_file")"
pg_sslmode="$(cat "$sslmode_file")"
local_host="$(cat "$local_host_file")"

docker_network_args=(
  --network bridge
)

if [ "$local_host" = "true" ]; then
  docker_network_args+=(
    --add-host
    host.docker.internal:host-gateway
  )
fi

section_dump() {
  local schema="$1"
  local section="$2"
  local output="$3"
  local log_file="$credential_dir/pgdump-${schema}-${section}.log"

  if docker run \
    --rm \
    "${docker_network_args[@]}" \
    --mount \
      "type=bind,src=$pgpass,dst=/run/secrets/ridearrivo.pgpass,readonly" \
    --env \
      PGPASSFILE=/run/secrets/ridearrivo.pgpass \
    --env \
      PGSSLMODE="$pg_sslmode" \
    --entrypoint pg_dump \
    "$pgdump_image" \
    --no-password \
    --host="$pg_host" \
    --port="$pg_port" \
    --username="$pg_user" \
    --dbname="$pg_database" \
    --schema-only \
    --schema="$schema" \
    --section="$section" \
    >"$output" \
    2>"$log_file"
  then
    :
  else
    printf 'ERROR: section dump failed for %s/%s\n' \
      "$schema" \
      "$section" >&2

    tail -80 "$log_file" >&2
    return 1
  fi

  if ! nonempty_file "$output"; then
    printf 'ERROR: empty section dump for %s/%s\n' \
      "$schema" \
      "$section" >&2
    return 1
  fi
}

rm -f "${section_files[@]}"

section_dump \
  auth \
  pre-data \
  "$auth_pre"

section_dump \
  auth \
  post-data \
  "$auth_post"

section_dump \
  storage \
  pre-data \
  "$storage_pre"

section_dump \
  storage \
  post-data \
  "$storage_post"

section_dump \
  supabase_functions \
  pre-data \
  "$sf_pre"

section_dump \
  supabase_functions \
  post-data \
  "$sf_post"

section_dump \
  public \
  pre-data \
  "$public_pre"

section_dump \
  public \
  post-data \
  "$public_post"

validation_failed=0

for file in "${section_files[@]}"; do
  if nonempty_file "$file"; then
    printf 'PASS: %s created\n' \
      "$(basename "$file")"
  else
    printf 'ERROR: %s is missing or empty\n' \
      "$(basename "$file")" >&2
    validation_failed=1
  fi
done

if grep -Eq \
  'CREATE TABLE (auth\.)?users|CREATE TABLE "auth"\."users"' \
  "$auth_pre" &&
   grep -Eq \
  'CREATE TABLE (auth\.)?identities|CREATE TABLE "auth"\."identities"' \
  "$auth_pre"
then
  printf 'PASS: Auth pre-data contains users and identities\n'
else
  printf 'ERROR: Auth pre-data contract is incomplete\n' >&2
  validation_failed=1
fi

if grep -Eq \
  'CREATE TABLE (storage\.)?objects|CREATE TABLE "storage"\."objects"' \
  "$storage_pre"
then
  printf 'PASS: Storage pre-data contains objects table\n'
else
  printf 'ERROR: Storage pre-data contract is incomplete\n' >&2
  validation_failed=1
fi

if grep -Eq \
  'CREATE TABLE (supabase_functions\.)?hooks|CREATE TABLE "supabase_functions"\."hooks"' \
  "$sf_pre" &&
   grep -Eq \
  'CREATE TABLE (supabase_functions\.)?migrations|CREATE TABLE "supabase_functions"\."migrations"' \
  "$sf_pre"
then
  printf 'PASS: supabase_functions pre-data contains required tables\n'
else
  printf 'ERROR: supabase_functions pre-data contract is incomplete\n' >&2
  validation_failed=1
fi

if grep -Eq \
  'CREATE TABLE (public\.)?employee_profiles|CREATE TABLE "public"\."employee_profiles"' \
  "$public_pre" &&
   grep -Eq \
  'CREATE( OR REPLACE)? FUNCTION (public\.)?handle_new_workspace_user|CREATE( OR REPLACE)? FUNCTION "public"\."handle_new_workspace_user"' \
  "$public_pre"
then
  printf 'PASS: RideArrivo public pre-data contains cross-schema foundations\n'
else
  printf 'ERROR: RideArrivo public pre-data contract is incomplete\n' >&2
  validation_failed=1
fi

if grep -qF \
  'users_pkey' \
  "$auth_post"
then
  printf 'PASS: Auth post-data contains users primary-key contract\n'
else
  printf 'ERROR: Auth users primary-key contract missing\n' >&2
  validation_failed=1
fi

if grep -qF \
  'employee_profiles_id_fkey' \
  "$public_post"
then
  printf 'PASS: public post-data contains Auth foreign-key contract\n'
else
  printf 'ERROR: public Auth foreign-key contract missing\n' >&2
  validation_failed=1
fi

if [ "$validation_failed" -ne 0 ]; then
  rm -f "${section_files[@]}"
  printf 'ERROR: sectioned schema backup validation failed\n' >&2
  exit 1
fi

printf 'PASS: sectioned schema backup created with PostgreSQL 17.6\n'

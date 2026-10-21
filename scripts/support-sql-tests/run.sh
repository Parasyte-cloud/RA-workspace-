#!/bin/bash
# PArAsYtE | RA-Workspace support module
#
# Usage:
#   run.sh <bundle dir>
#
# Replays the complete Support migration chain twice, each time against a
# freshly-created database. Historical migrations are intentionally not
# reapplied on top of the final schema because later migrations may replace
# functions with new signatures.

set -euo pipefail

PGT_DIR=${PGT_DIR:-/tmp/pgtest}
PGT_PORT=${PGT_PORT:-54399}

B=${1:?usage: run.sh <bundle dir>}
S=$(cd "$(dirname "$0")" && pwd)

export PGOPTIONS="-c client_min_messages=warning"

PSQL_BASE=(
  psql
  -h "$PGT_DIR"
  -p "$PGT_PORT"
  -U postgres
  -v ON_ERROR_STOP=1
  -q
)

reset_db() {
  local db="$1"

  "${PSQL_BASE[@]}" \
    -d postgres \
    -c "drop database if exists \"$db\" with (force)" \
    -c "create database \"$db\"" \
    >/dev/null

  "${PSQL_BASE[@]}" \
    -d "$db" \
    -f "$S/stub.sql"
}

apply_support_migrations() {
  local db="$1"
  local pass="$2"
  local f

  for f in "$B"/supabase/migrations/20261*_support_*.sql; do
    [ -e "$f" ] || continue

    "${PSQL_BASE[@]}" \
      -d "$db" \
      -c "set client_min_messages=warning" \
      -f "$f" \
      2>&1 |
      sed "s#^#[pass $pass $(basename "$f")] #"

    if [ "${PIPESTATUS[0]}" -ne 0 ]; then
      echo "FAILED $f pass $pass"
      return 1
    fi
  done
}

for pass in 1 2; do
  DB="scc_test_pass${pass}"

  reset_db "$DB"
  apply_support_migrations "$DB" "$pass"

  echo "MIGRATION_REPLAY_${pass}_OK"
done

TEST_DB="scc_test_pass2"

echo MIGRATIONS_OK

for t in \
  tests.sql \
  tests_routing.sql \
  tests_controls.sql \
  tests_safety.sql \
  tests_invites.sql \
  tests_teams.sql \
  tests_notifications.sql
do
  "${PSQL_BASE[@]}" \
    -d "$TEST_DB" \
    -f "$S/$t" \
    2>&1 |
    sed "s#^#[$t] #"

  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    echo "FAILED $t"
    exit 1
  fi
done

echo SQL_TESTS_OK

#!/bin/bash
# PArAsYtE | RA-Workspace support module
PGT_DIR=${PGT_DIR:-/tmp/pgtest}; PGT_PORT=${PGT_PORT:-54399}
# usage: run.sh <bundle dir>  -> rebuilds scc_test and applies stub + migrations twice
B=$1; S=$(dirname $0)
export PGOPTIONS="-c client_min_messages=warning"
P="psql -h "$PGT_DIR" -p "$PGT_PORT" -U postgres -v ON_ERROR_STOP=1 -q"
psql -h "$PGT_DIR" -p "$PGT_PORT" -U postgres -q -c "drop database if exists scc_test" -c "create database scc_test" >/dev/null 2>&1
$P -d scc_test -f $S/stub.sql || exit 1
for pass in 1 2; do
  for f in $B/supabase/migrations/20261*_support_*.sql; do
    $P -d scc_test -c "set client_min_messages=warning" -f $f 2>&1 | sed "s#^#[pass $pass $(basename $f)] #" ; [ ${PIPESTATUS[0]} -ne 0 ] && { echo "FAILED $f pass $pass"; exit 1; }
  done
done
echo MIGRATIONS_OK
for t in tests.sql tests_routing.sql tests_controls.sql tests_safety.sql tests_invites.sql tests_teams.sql tests_notifications.sql; do
  $P -d scc_test -f $S/$t 2>&1 | sed "s#^#[$t] #" ; [ ${PIPESTATUS[0]} -ne 0 ] && { echo "FAILED $t"; exit 1; }
done
echo SQL_TESTS_OK

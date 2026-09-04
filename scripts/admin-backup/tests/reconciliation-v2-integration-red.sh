#!/usr/bin/env bash
set -u

repo="$(
  CDPATH= cd -- "$(dirname -- "$0")/../../.." &&
    pwd
)"

builder="$repo/scripts/admin-backup/build-database-reconciliation.mjs"
manifest="$repo/scripts/admin-backup/build-manifest.mjs"
artifact="$repo/scripts/admin-backup/verify-backup-artifact.sh"
restore="$repo/scripts/admin-backup/verify-database-restore.sh"

passes=0
failures=0

pass() {
  printf 'PASS: %s\n' "$1"
  passes=$((passes + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

if grep -Fq 'format_version: 2,' "$builder"; then
  pass "new reconciliation writer emits v2"
else
  fail "new reconciliation writer still emits legacy v1"
fi

if grep -Fq \
  'reconciliationEvidence?.format_version === 1' \
  "$manifest"
then
  fail "manifest still hardcodes malformed v1 reconciliation"
else
  pass "manifest no longer hardcodes malformed v1 reconciliation"
fi

if grep -Fq \
  'database-reconciliation-contract.mjs' \
  "$artifact"
then
  pass "artifact verifier uses central v1/v2 contract"
else
  fail "artifact verifier is not wired to central v1/v2 contract"
fi

if grep -Fq \
  'database-reconciliation-contract.mjs' \
  "$restore"
then
  pass "restore verifier uses central v1/v2 contract"
else
  fail "restore verifier is not wired to central v1/v2 contract"
fi

if grep -Fq \
  'normalize' \
  "$restore"
then
  pass "restore verifier performs semantic normalization"
else
  fail "restore verifier does not normalize reconciliation ledgers"
fi

if grep -A6 -F \
  'if cmp -s' \
  "$restore" |
  grep -Fq 'artifact_reconciliation'
then
  fail "restore still byte-compares raw artifact and target ledgers"
else
  pass "restore no longer requires raw cross-version ledger equality"
fi

printf '\nPASS_COUNT=%s\n' "$passes"
printf 'FAIL_COUNT=%s\n' "$failures"

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi

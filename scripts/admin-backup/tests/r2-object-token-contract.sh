#!/usr/bin/env bash

set -u

root="$(
  cd "$(dirname "$0")/../../.." &&
  pwd
)"

upload="$root/scripts/admin-backup/upload-backup.sh"
verifier="$root/scripts/admin-backup/restore-verifier-runner.sh"
source_backup="$root/scripts/admin-backup/storage-backup.sh"

passes=0
errors=0

pass() {
  printf 'PASS: %s\n' "$1"
  passes=$((passes + 1))
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  errors=$((errors + 1))
}

contains() {
  file="$1"
  pattern="$2"
  label="$3"

  if grep -qF -- "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label"
  fi
}

absent() {
  file="$1"
  pattern="$2"
  label="$3"

  if grep -qF -- "$pattern" "$file"; then
    fail "$label"
  else
    pass "$label"
  fi
}

contains \
  "$upload" \
  'export RCLONE_CONFIG_DST_TYPE="s3"' \
  "writer destination uses S3"

contains \
  "$upload" \
  'export RCLONE_CONFIG_DST_PROVIDER="Cloudflare"' \
  "writer destination uses Cloudflare provider"

contains \
  "$upload" \
  'export RCLONE_CONFIG_DST_FORCE_PATH_STYLE="true"' \
  "writer destination forces path style"

contains \
  "$upload" \
  'export RCLONE_CONFIG_DST_NO_CHECK_BUCKET="true"' \
  "writer supports bucket-scoped R2 token"

contains \
  "$verifier" \
  'export RCLONE_CONFIG_VERIFY_TYPE="s3"' \
  "verifier destination uses S3"

contains \
  "$verifier" \
  'export RCLONE_CONFIG_VERIFY_PROVIDER="Cloudflare"' \
  "verifier destination uses Cloudflare provider"

contains \
  "$verifier" \
  'export RCLONE_CONFIG_VERIFY_FORCE_PATH_STYLE="true"' \
  "verifier destination forces path style"

contains \
  "$verifier" \
  'export RCLONE_CONFIG_VERIFY_NO_CHECK_BUCKET="true"' \
  "verifier supports bucket-scoped R2 token"

unset_count="$(
  grep -cF \
    'unset RCLONE_CONFIG_VERIFY_NO_CHECK_BUCKET' \
    "$verifier" || true
)"

if [ "$unset_count" = "2" ]; then
  pass "verifier clears R2 no-check-bucket state"
else
  fail "verifier clears R2 no-check-bucket state"
fi

contains \
  "$source_backup" \
  'export RCLONE_CONFIG_SRC_PROVIDER="Other"' \
  "Supabase source retains generic S3 provider"

absent \
  "$source_backup" \
  'RCLONE_CONFIG_SRC_NO_CHECK_BUCKET' \
  "Supabase source does not inherit R2 workaround"

absent \
  "$source_backup" \
  'RCLONE_CONFIG_SRC_PROVIDER="Cloudflare"' \
  "Supabase source is not reclassified as Cloudflare"

printf 'R2_CONTRACT_PASS_MARKERS=%s\n' "$passes"
printf 'R2_CONTRACT_ERROR_MARKERS=%s\n' "$errors"

if [ "$errors" -ne 0 ]; then
  exit 1
fi

#!/usr/bin/env bash

set -u

failures=0

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

require_command() {
  name="$1"

  if command -v "$name" >/dev/null 2>&1; then
    pass "$name is available"
  else
    fail "$name is unavailable"
  fi
}

echo "=== RESTORE VERIFIER SECURITY PREFLIGHT ==="

echo
echo "=== PRIVATE DECRYPTION IDENTITY ==="

if [ -z "${BACKUP_AGE_IDENTITY_FILE:-}" ]; then
  fail "BACKUP_AGE_IDENTITY_FILE is missing"
elif [ ! -f "$BACKUP_AGE_IDENTITY_FILE" ]; then
  fail "age identity file does not exist"
elif [ ! -s "$BACKUP_AGE_IDENTITY_FILE" ]; then
  fail "age identity file is empty"
elif [ ! -r "$BACKUP_AGE_IDENTITY_FILE" ]; then
  fail "age identity file is not readable"
else
  pass "age identity file is available"
fi

echo
echo "=== PRODUCTION-CREDENTIAL SEPARATION ==="

for forbidden in \
  SUPABASE_DB_URL \
  SUPABASE_SECRET_KEY \
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID \
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY \
  BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY
do
  if [ -n "${!forbidden:-}" ]; then
    fail "$forbidden must not exist in restore-verifier environment"
  else
    pass "$forbidden is absent"
  fi
done

echo
echo "=== PRIVATE KEY ENVIRONMENT CHECK ==="

for forbidden in \
  BACKUP_AGE_PRIVATE_KEY \
  AGE_SECRET_KEY
do
  if [ -n "${!forbidden:-}" ]; then
    fail "$forbidden must not contain private key material in environment"
  else
    pass "$forbidden is absent"
  fi
done

echo
echo "=== REQUIRED LOCAL TOOLS ==="

require_command bash
require_command age
require_command tar
require_command jq
require_command git
require_command docker
require_command rclone
require_command python3
require_command grep
require_command awk

echo
echo "=== LOCAL S3 RESTORE CAPABILITY ==="

if command -v rclone >/dev/null 2>&1; then
  if rclone serve s3 --help >/dev/null 2>&1; then
    pass "rclone serve s3 is available"
  else
    fail "rclone serve s3 is unavailable"
  fi
fi

if command -v sha256sum >/dev/null 2>&1; then
  pass "sha256sum is available"
elif command -v shasum >/dev/null 2>&1; then
  pass "shasum is available"
else
  fail "no SHA-256 utility is available"
fi

echo
echo "=== PREFLIGHT RESULT ==="

if [ "$failures" -eq 0 ]; then
  echo "PASS: restore verifier environment is isolated and ready"
else
  echo "FAIL: restore verifier preflight found $failures issue(s)"
fi

exit "$failures"

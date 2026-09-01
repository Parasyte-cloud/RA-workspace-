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

require_env() {
  name="$1"

  if [ -n "${!name:-}" ]; then
    pass "$name is configured"
  else
    fail "$name is missing"
  fi
}

require_command() {
  name="$1"

  if command -v "$name" >/dev/null 2>&1; then
    pass "$name is available"
  else
    fail "$name is unavailable"
  fi
}

echo "=== RIDEARRIVO BACKUP RUNNER PREFLIGHT ==="

echo
echo "=== SUPABASE CONTROL PLANE ==="

require_env SUPABASE_URL
require_env SUPABASE_SECRET_KEY
require_env SUPABASE_DB_URL

if [ -n "${SUPABASE_SECRET_KEY:-}" ]; then
  case "$SUPABASE_SECRET_KEY" in
    sb_secret_*)
      pass "SUPABASE_SECRET_KEY uses current secret-key format"
      ;;
    *)
      fail "SUPABASE_SECRET_KEY must use sb_secret_ format"
      ;;
  esac
fi

if [ -n "${SUPABASE_URL:-}" ]; then
  case "$SUPABASE_URL" in
    https://*)
      pass "SUPABASE_URL uses HTTPS"
      ;;
    *)
      fail "SUPABASE_URL must use HTTPS"
      ;;
  esac
fi


echo
echo "=== SUPABASE STORAGE SOURCE ==="

require_env SUPABASE_STORAGE_S3_ENDPOINT
require_env SUPABASE_STORAGE_S3_REGION
require_env SUPABASE_STORAGE_S3_ACCESS_KEY_ID
require_env SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY


echo
echo "=== OFF-SITE BACKUP DESTINATION ==="

require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_REGION
require_env BACKUP_S3_BUCKET
require_env BACKUP_S3_ACCESS_KEY_ID
require_env BACKUP_S3_SECRET_ACCESS_KEY

if [ -n "${SUPABASE_STORAGE_S3_ENDPOINT:-}" ] &&
   [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then

  source_endpoint="${SUPABASE_STORAGE_S3_ENDPOINT%/}"
  backup_endpoint="${BACKUP_S3_ENDPOINT%/}"

  if [ "$source_endpoint" = "$backup_endpoint" ]; then
    fail "off-site destination must not use the Supabase Storage endpoint"
  else
    pass "backup destination is a separate endpoint"
  fi
fi


echo
echo "=== ENCRYPTION ==="

require_env BACKUP_AGE_RECIPIENT

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  case "$BACKUP_AGE_RECIPIENT" in
    age1*|age-plugin-*)
      pass "backup encryption recipient format is recognised"
      ;;
    *)
      fail "BACKUP_AGE_RECIPIENT does not look like an age recipient"
      ;;
  esac
fi


echo
echo "=== RUNNER TOOLS ==="

require_command bash
require_command git
require_command tar
require_command curl
require_command jq
require_command supabase
require_command rclone
require_command age

if command -v sha256sum >/dev/null 2>&1; then
  pass "sha256sum is available"
elif command -v shasum >/dev/null 2>&1; then
  pass "shasum is available"
else
  fail "no SHA-256 command is available"
fi


echo
echo "=== SECRET-NAME SAFETY ==="

for forbidden in \
  VITE_SUPABASE_SECRET_KEY \
  VITE_SUPABASE_SERVICE_ROLE_KEY \
  VITE_SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY \
  VITE_BACKUP_S3_SECRET_ACCESS_KEY \
  VITE_BACKUP_AGE_PRIVATE_KEY
do
  if [ -n "${!forbidden:-}" ]; then
    fail "$forbidden must never be exposed through VITE"
  else
    pass "$forbidden is not exposed"
  fi
done


echo
echo "=== PREFLIGHT RESULT ==="

if [ "$failures" -eq 0 ]; then
  echo "PASS: backup runner environment is ready"
else
  echo "FAIL: backup runner preflight found $failures issue(s)"
fi

exit "$failures"

#!/usr/bin/env bash

# Runs the independent restore verifier on THIS machine.
#
# A backup nobody has restored is a hope, not a backup. The verifier downloads
# the newest completed backup, decrypts it with your age PRIVATE key, restores
# the database and storage into a throwaway local copy, checks the contents
# against the manifest, and records the result on the job in the Control
# Centre (Restore verified goes from 0 to 1).
#
# This wrapper exists so the private key and the secrets it needs are handled
# safely:
#   - they live in one private file that must not be readable by anyone else,
#   - only a short list of expected names is accepted from it,
#   - the verifier runs in a CLEAN environment, so production credentials
#     that happen to be in your shell can never reach it,
#   - no value is ever printed.
#
# Usage:
#   restore-drill.sh --check [ENV_FILE]   check the file and tools, run nothing
#   restore-drill.sh run     [ENV_FILE]   check, then restore and verify
#
# ENV_FILE defaults to ~/.ridearrivo-restore/drill.env. See README.md.

set -u

script_dir="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
  pwd
)"

usage() {
  sed -n '/^# Usage:/,/^# ENV_FILE/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
}

mode="${1:-}"
env_file="${2:-$HOME/.ridearrivo-restore/drill.env}"

case "$mode" in
  --check|run) ;;
  *) usage; exit 2 ;;
esac

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

# Octal permission bits, on Linux and macOS. GNU stat is tried first because on
# Linux "stat -f" means "filesystem status" and succeeds with unrelated output.
file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

require_private_file() {
  path="$1"
  label="$2"

  [ -f "$path" ] || die "$label does not exist: $path"
  [ -s "$path" ] || die "$label is empty: $path"

  bits="$(file_mode "$path")"

  case "$bits" in
    600|400) ;;
    *) die "$label must be private (chmod 600). It is $bits: $path" ;;
  esac
}

require_private_file "$env_file" "restore drill settings file"

allowed="
SUPABASE_URL
SUPABASE_SECRET_KEY
BACKUP_VERIFY_S3_ENDPOINT
BACKUP_VERIFY_S3_REGION
BACKUP_VERIFY_S3_ACCESS_KEY_ID
BACKUP_VERIFY_S3_SECRET_ACCESS_KEY
BACKUP_AGE_IDENTITY_FILE
BACKUP_RESTORE_WORK_ROOT
"

required="
SUPABASE_URL
SUPABASE_SECRET_KEY
BACKUP_VERIFY_S3_ENDPOINT
BACKUP_VERIFY_S3_REGION
BACKUP_VERIFY_S3_ACCESS_KEY_ID
BACKUP_VERIFY_S3_SECRET_ACCESS_KEY
BACKUP_AGE_IDENTITY_FILE
"

# Parsed, never sourced: a settings file is data, not a script.
pairs=()
loaded=""

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac

  key="${line%%=*}"
  value="${line#*=}"

  if [ "$key" = "$line" ]; then
    die "settings file has a line that is not NAME=value"
  fi

  case "$key" in
    *[!A-Z0-9_]*|'') die "settings file has an invalid name" ;;
  esac

  if ! printf '%s\n' "$allowed" | grep -Fxq -- "$key"; then
    die "settings file contains $key, which the restore verifier does not accept (production and writer credentials must never be here)"
  fi

  # Tolerate one pair of surrounding quotes.
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac

  pairs+=("$key=$value")
  loaded="$loaded $key"
done < "$env_file"

for name in $required; do
  case " $loaded " in
    *" $name "*) ;;
    *) die "settings file is missing $name" ;;
  esac
done

identity=""

for pair in "${pairs[@]}"; do
  case "$pair" in
    BACKUP_AGE_IDENTITY_FILE=*) identity="${pair#*=}" ;;
  esac
done

case "$identity" in
  '~/'*) identity="$HOME/${identity#\~/}" ;;
esac

require_private_file "$identity" "age private key file"

# A private key inside a git working tree is one careless commit from public.
if git -C "$(dirname -- "$identity")" rev-parse --show-toplevel >/dev/null 2>&1; then
  die "the age private key file is inside a git repository; move it out"
fi

# Replace the identity path with the expanded one.
clean=()
for pair in "${pairs[@]}"; do
  case "$pair" in
    BACKUP_AGE_IDENTITY_FILE=*) clean+=("BACKUP_AGE_IDENTITY_FILE=$identity") ;;
    *) clean+=("$pair") ;;
  esac
done

printf 'Settings loaded (names only):%s\n' "$loaded"

# A clean environment: nothing from the calling shell comes along.
run_clean() {
  env -i \
    HOME="$HOME" \
    PATH="$PATH" \
    TERM="${TERM:-dumb}" \
    TMPDIR="${TMPDIR:-/tmp}" \
    "${clean[@]}" \
    bash "$@"
}

echo
echo "=== PREFLIGHT ==="

if ! run_clean "$script_dir/restore-verifier-preflight.sh"; then
  die "restore verifier preflight failed; fix the lines marked FAIL above"
fi

if [ "$mode" = "--check" ]; then
  echo
  echo "PASS: ready. Run: restore-drill.sh run"
  exit 0
fi

echo
echo "=== RESTORE DRILL ==="

run_clean "$script_dir/restore-verifier-runner.sh" run
exit "$?"

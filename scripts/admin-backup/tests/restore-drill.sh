#!/usr/bin/env bash

set -u

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

work="$(mktemp -d)"
failures=0
trap 'rm -rf -- "$work"' EXIT

# The wrapper next to stand-ins for the preflight and the verifier, so the
# test can see exactly what environment they are given.
mkdir -p "$work/ab" "$work/home/.ridearrivo-restore"
cp "$repo/scripts/admin-backup/restore-drill.sh" "$work/ab/restore-drill.sh"

cat > "$work/ab/restore-verifier-preflight.sh" <<'FAKE'
#!/usr/bin/env bash
echo "fake preflight"
[ -f "$(dirname "$0")/preflight_fail" ] && { echo "FAIL: pretend"; exit 1; }
exit 0
FAKE
cat > "$work/ab/restore-verifier-runner.sh" <<'FAKE'
#!/usr/bin/env bash
echo "fake runner sees:"
for n in SUPABASE_URL SUPABASE_SECRET_KEY BACKUP_VERIFY_S3_ENDPOINT BACKUP_VERIFY_S3_SECRET_ACCESS_KEY BACKUP_AGE_IDENTITY_FILE SUPABASE_DB_URL BACKUP_S3_SECRET_ACCESS_KEY BACKUP_AGE_PRIVATE_KEY; do
  [ -n "${!n:-}" ] && echo "  has $n"
done
[ -f "$(dirname "$0")/runner_exit" ] && exit "$(cat "$(dirname "$0")/runner_exit")"
exit 0
FAKE
chmod +x "$work/ab/"*.sh

export HOME="$work/home"
key="$work/key/age.key"
mkdir -p "$work/key"
printf 'AGE-SECRET-KEY-FAKE-VALUE-DO-NOT-LEAK\n' > "$key"
chmod 600 "$key"

settings="$work/home/.ridearrivo-restore/drill.env"
write_settings() {
  cat > "$settings" <<SET
# comment
SUPABASE_URL=https://example.supabase.co
SUPABASE_SECRET_KEY="sb_secret_LEAKCHECK_1"
BACKUP_VERIFY_S3_ENDPOINT=https://dest.example.test
BACKUP_VERIFY_S3_REGION=auto
BACKUP_VERIFY_S3_ACCESS_KEY_ID=readonlyid
BACKUP_VERIFY_S3_SECRET_ACCESS_KEY=LEAKCHECK_2
BACKUP_AGE_IDENTITY_FILE=$key
SET
  chmod 600 "$settings"
}

drill() { bash "$work/ab/restore-drill.sh" "$@" 2>&1; }

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }
expect_fail() {
  name="$1"; needle="$2"; shift 2
  out="$(drill "$@")"; code=$?
  if [ "$code" -ne 0 ] && printf '%s\n' "$out" | grep -Fq -- "$needle"; then pass "$name"
  else fail "$name"; printf '%s\n' "$out" | tail -4 | sed 's/^/    /'; fi
}

# Refusals
rm -f "$settings"
expect_fail 'a missing settings file is refused' 'does not exist' run

write_settings; chmod 644 "$settings"
expect_fail 'a settings file other users can read is refused' 'must be private' run

write_settings
printf 'SUPABASE_DB_URL=postgresql://x\n' >> "$settings"
expect_fail 'a production credential in the file is refused' 'SUPABASE_DB_URL, which the restore verifier does not accept' run

write_settings
printf 'BACKUP_S3_SECRET_ACCESS_KEY=x\n' >> "$settings"
expect_fail 'a backup-writer credential in the file is refused' 'BACKUP_S3_SECRET_ACCESS_KEY' run

write_settings
grep -v '^BACKUP_VERIFY_S3_REGION' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings" && chmod 600 "$settings"
expect_fail 'a missing required setting is named' 'missing BACKUP_VERIFY_S3_REGION' run

write_settings; chmod 644 "$key"
expect_fail 'a private key other users can read is refused' 'age private key file must be private' run
chmod 600 "$key"

write_settings
printf 'not a pair\n' >> "$settings"
expect_fail 'a malformed line is refused' 'not NAME=value' run

# Healthy run
write_settings
out="$(drill --check)"; code=$?
if [ "$code" -eq 0 ] && printf '%s\n' "$out" | grep -Fq 'PASS: ready'; then pass '--check passes on a good setup without running the verifier'
else fail '--check should pass'; printf '%s\n' "$out" | tail -4 | sed 's/^/    /'; fi
if printf '%s\n' "$out" | grep -Fq 'fake runner'; then fail '--check must not run the verifier'; else pass '--check does not run the verifier'; fi

# The runner gets exactly the expected variables and nothing from the shell
out="$(
  SUPABASE_DB_URL=postgresql://prod BACKUP_S3_SECRET_ACCESS_KEY=prodsecret BACKUP_AGE_PRIVATE_KEY=oops \
  bash "$work/ab/restore-drill.sh" run 2>&1
)"; code=$?
[ "$code" -eq 0 ] && pass 'a good setup runs the verifier' || fail 'a good setup should run'
for want in SUPABASE_URL SUPABASE_SECRET_KEY BACKUP_VERIFY_S3_ENDPOINT BACKUP_VERIFY_S3_SECRET_ACCESS_KEY BACKUP_AGE_IDENTITY_FILE; do
  printf '%s\n' "$out" | grep -Fq "has $want" && pass "verifier receives $want" || fail "verifier should receive $want"
done
for banned in SUPABASE_DB_URL BACKUP_S3_SECRET_ACCESS_KEY BACKUP_AGE_PRIVATE_KEY; do
  printf '%s\n' "$out" | grep -Fq "has $banned" && fail "$banned leaked from the calling shell into the verifier" || pass "$banned from the calling shell never reaches the verifier"
done

# Nothing secret is printed
if printf '%s\n' "$out" | grep -E 'LEAKCHECK|AGE-SECRET-KEY|readonlyid' >/dev/null; then fail 'a secret value was printed'; else pass 'no secret value is ever printed'; fi

# Exit codes pass through
echo 3 > "$work/ab/runner_exit"
out="$(bash "$work/ab/restore-drill.sh" run 2>&1)"; code=$?
rm -f "$work/ab/runner_exit"
[ "$code" -eq 3 ] && pass "the verifier's exit code is returned" || fail "the verifier's exit code should be returned (got $code)"

touch "$work/ab/preflight_fail"
out="$(bash "$work/ab/restore-drill.sh" run 2>&1)"; code=$?
rm -f "$work/ab/preflight_fail"
if [ "$code" -ne 0 ] && ! printf '%s\n' "$out" | grep -Fq 'fake runner'; then pass 'a failed preflight stops before the restore'; else fail 'a failed preflight must stop the run'; fi

# A private key inside a git repository is refused
mkdir -p "$work/repo" && git -C "$work/repo" init -q 2>/dev/null
cp "$key" "$work/repo/age.key"; chmod 600 "$work/repo/age.key"
write_settings; sed -i.bak "s#^BACKUP_AGE_IDENTITY_FILE=.*#BACKUP_AGE_IDENTITY_FILE=$work/repo/age.key#" "$settings"; chmod 600 "$settings"
expect_fail 'a private key inside a git repository is refused' 'inside a git repository' run

if [ "$failures" -ne 0 ]; then printf 'FAILED: %s restore drill check(s)\n' "$failures"; exit 1; fi
echo 'PASS: restore drill checks'

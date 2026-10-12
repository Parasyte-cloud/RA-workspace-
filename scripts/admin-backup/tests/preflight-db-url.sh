#!/usr/bin/env bash

set -u

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

fake_bin="$(mktemp -d)"
failures=0

cleanup() { rm -rf -- "$fake_bin"; }
trap cleanup EXIT

# A resolver that only knows one host with an IPv4 address.
cat > "$fake_bin/getent" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = "ahostsv4" ] && [ "${2:-}" = "aws-0-eu-west-2.pooler.supabase.com" ]; then
  echo "203.0.113.10 STREAM aws-0-eu-west-2.pooler.supabase.com"
fi
exit 0
FAKE
chmod +x "$fake_bin/getent"

run_preflight() {
  PATH="$fake_bin:$PATH" SUPABASE_DB_URL="$1" \
    bash "$repo/scripts/admin-backup/preflight.sh" 2>&1
}

expect() {
  name="$1"; url="$2"; needle="$3"; want="$4"
  out="$(run_preflight "$url")"
  if printf '%s\n' "$out" | grep -Fq -- "$needle"; then
    got=yes
  else
    got=no
  fi
  if [ "$got" = "$want" ]; then
    printf 'PASS: %s\n' "$name"
  else
    printf 'FAIL: %s\n' "$name"
    printf '%s\n' "$out" | grep -E 'DATABASE|database|pooler|6543' | sed 's/^/    /'
    failures=$((failures + 1))
  fi
}

good='postgresql://postgres.abcdefgh:s3cret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'
direct='postgresql://postgres:s3cret@db.abcdefgh.supabase.co:5432/postgres'
txn='postgresql://postgres.abcdefgh:s3cret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres'
baduser='postgresql://postgres:s3cret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'

expect 'session pooler URL passes the host check'        "$good"   'has an IPv4 address' yes
expect 'session pooler URL is not flagged as transaction' "$good"  'FAIL: SUPABASE_DB_URL uses port 6543' no
expect 'pooler user with project reference passes'        "$good"   'pooler user name carries the project reference' yes
expect 'IPv6-only direct host fails'                      "$direct" 'has no IPv4 address' yes
expect 'transaction pooler port fails'                    "$txn"    'FAIL: SUPABASE_DB_URL uses port 6543' yes
expect 'bare user on the pooler fails'                    "$baduser" 'need the user postgres.<project-ref>' yes
expect 'a non-PostgreSQL string fails'                    'mysql://x@y/z' 'must start with postgresql://' yes

# The password must never be printed.
if run_preflight "$good" | grep -Fq 's3cret'; then
  echo 'FAIL: password leaked into preflight output'
  failures=$((failures + 1))
else
  echo 'PASS: password is not printed'
fi

if [ "$failures" -ne 0 ]; then
  printf 'FAILED: %s preflight DB URL check(s)\n' "$failures"
  exit 1
fi

echo 'PASS: preflight DB URL checks'

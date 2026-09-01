#!/usr/bin/env bash

set -eu

pass_count=0
fail_count=0

pass() {
  printf 'PASS: %s\n' "$1"
  pass_count=$((pass_count + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1"
  fail_count=$((fail_count + 1))
}

assert_rc() {
  expected="$1"
  actual="$2"
  label="$3"

  if [ "$actual" -eq "$expected" ]; then
    pass "$label"
  else
    fail "$label expected=$expected actual=$actual"
  fi
}

assert_nonzero() {
  actual="$1"
  label="$2"

  if [ "$actual" -ne 0 ]; then
    pass "$label"
  else
    fail "$label unexpectedly returned zero"
  fi
}

assert_contains() {
  file="$1"
  pattern="$2"
  label="$3"

  if grep -Fq -- "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label"
  fi
}

assert_absent() {
  file="$1"
  pattern="$2"
  label="$3"

  if grep -Fq -- "$pattern" "$file"; then
    fail "$label"
  else
    pass "$label"
  fi
}

assert_count() {
  file="$1"
  pattern="$2"
  expected="$3"
  label="$4"

  actual="$(
    grep -Fc -- "$pattern" "$file" || true
  )"

  if [ "$actual" -eq "$expected" ]; then
    pass "$label"
  else
    fail "$label expected=$expected actual=$actual"
  fi
}

assert_repeated_identically() {
  file="$1"
  pattern="$2"
  expected="$3"
  label="$4"

  matches="$(
    grep -F -- "$pattern" "$file" || true
  )"

  count="$(
    printf '%s\n' "$matches" |
      grep -c . || true
  )"

  unique="$(
    printf '%s\n' "$matches" |
      sort -u |
      grep -c . || true
  )"

  if [ "$count" -eq "$expected" ] &&
     [ "$unique" -eq 1 ]
  then
    pass "$label"
  else
    fail \
      "$label expected=$expected count=$count unique=$unique"
  fi
}

assert_empty_dir() {
  directory="$1"
  label="$2"

  first="$(
    find "$directory" \
      -mindepth 1 \
      -print \
      -quit
  )"

  if [ -z "$first" ]; then
    pass "$label"
  else
    fail "$label leftover=$first"
  fi
}

assert_order() {
  file="$1"
  label="$2"
  shift 2

  previous=0

  for pattern in "$@"
  do
    line="$(
      grep -nF -- "$pattern" "$file" |
        head -1 |
        cut -d: -f1
    )"

    if [ -z "$line" ]; then
      fail "$label missing=$pattern"
      return
    fi

    if [ "$line" -le "$previous" ]; then
      fail "$label order-broken=$pattern"
      return
    fi

    previous="$line"
  done

  pass "$label"
}

test_dir="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
    pwd
)"

repo="$(
  git -C "$test_dir" rev-parse --show-toplevel
)"

source_runner="$repo/scripts/admin-backup/backup-runner.sh"

if [ ! -x "$source_runner" ]; then
  printf 'ERROR: backup-runner.sh is unavailable\n' >&2
  exit 1
fi

temporary_root="$(
  mktemp -d "${TMPDIR:-/tmp}/ridearrivo-backup-runner-test.XXXXXX"
)"

cleanup() {
  rm -rf -- "$temporary_root"
}

trap cleanup EXIT

fixture_repo="$temporary_root/repository"
fixture_scripts="$fixture_repo/scripts/admin-backup"

mkdir -p "$fixture_scripts"

git -C "$temporary_root" init -q repository

cp \
  "$source_runner" \
  "$fixture_scripts/backup-runner.sh"

chmod 700 \
  "$fixture_scripts/backup-runner.sh"

cat > "$fixture_scripts/preflight.sh" <<'STUB'
#!/usr/bin/env bash
set -u
printf 'preflight\n' >> "$TEST_LOG"
printf 'PASS: stub preflight\n'
STUB

cat > "$fixture_scripts/queue-client.sh" <<'STUB'
#!/usr/bin/env bash
set -u

printf 'queue:%s\n' "$*" >> "$TEST_LOG"

command_name="${1:-}"

case "$command_name" in
  claim-detail)
    if [ "${TEST_SCENARIO:-}" = "claim-fail" ]; then
      printf 'ERROR: synthetic claim transport failure\n' >&2
      exit 71
    fi

    if [ "${TEST_SCENARIO:-}" = "no-job" ]; then
      printf 'null\n'
      exit 0
    fi

    printf '%s\n' \
      '{"job_id":"11111111-2222-4333-8444-555555555555","attempt_count":2}'
    ;;

  heartbeat)
    if [ "${TEST_SCENARIO:-}" = "heartbeat-fail" ]; then
      printf 'ERROR: synthetic heartbeat rejection\n' >&2
      exit 72
    fi

    exit 0
    ;;

  complete)
    completion_count_file="${TEST_LOG}.completion-count"
    completion_count=0

    if [ -f "$completion_count_file" ]; then
      completion_count="$(
        cat "$completion_count_file"
      )"
    fi

    completion_count=$((completion_count + 1))

    printf '%s\n' "$completion_count" \
      > "$completion_count_file"

    case "${TEST_SCENARIO:-}" in
      complete-retry)
        if [ "$completion_count" -eq 1 ]; then
          printf \
            'ERROR: synthetic lost completion response\n' \
            >&2
          exit 75
        fi
        ;;

      complete-ambiguous)
        printf \
          'ERROR: synthetic ambiguous completion response\n' \
          >&2
        exit 75
        ;;
    esac

    exit 0
    ;;

  fail)
    exit 0
    ;;

  *)
    printf 'ERROR: unexpected queue command\n' >&2
    exit 73
    ;;
esac
STUB

cat > "$fixture_scripts/database-backup.sh" <<'STUB'
#!/usr/bin/env bash
set -u

printf 'database:%s\n' "$*" >> "$TEST_LOG"

if [ "${TEST_SCENARIO:-}" = "database-fail" ]; then
  printf 'ERROR: synthetic database backup failure\n' >&2
  exit 61
fi

exit 0
STUB

cat > "$fixture_scripts/storage-backup.sh" <<'STUB'
#!/usr/bin/env bash
set -u

printf 'storage:%s\n' "$*" >> "$TEST_LOG"
exit 0
STUB

cat > "$fixture_scripts/package-backup.sh" <<'STUB'
#!/usr/bin/env bash
set -eu

printf 'package:%s\n' "$*" >> "$TEST_LOG"

mode="${1:-}"
workspace="${2:-}"
artifact="${3:-}"

if [ "$mode" != "run" ] ||
   [ -z "$workspace" ] ||
   [ -z "$artifact" ]
then
  exit 62
fi

mkdir -p \
  "$workspace" \
  "$(dirname "$artifact")"

cat > "$workspace/manifest.json" <<'JSON'
{
  "coverage": {
    "database": true,
    "auth": true,
    "storage": true,
    "repository": true,
    "configuration_manifest": true
  }
}
JSON

printf 'synthetic encrypted artifact\n' \
  > "$artifact"

cat > "${artifact}.json" <<'JSON'
{
  "format_version": 1,
  "encryption": {
    "tool": "age",
    "encrypted": true
  },
  "coverage": {
    "database": true,
    "auth": true,
    "storage": true,
    "repository": true,
    "configuration_manifest": true
  },
  "offsite_uploaded": false,
  "restore_verified": false
}
JSON

exit 0
STUB

cat > "$fixture_scripts/upload-backup.sh" <<'STUB'
#!/usr/bin/env bash
set -eu

printf 'upload:%s\n' "$*" >> "$TEST_LOG"

mode="${1:-}"
artifact="${2:-}"

if [ "$mode" != "run" ] ||
   [ -z "$artifact" ]
then
  exit 63
fi

sidecar="${artifact}.json"

cat > "$sidecar" <<'JSON'
{
  "format_version": 1,
  "artifact": {
    "name": "synthetic.age",
    "bytes": 123,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "encryption": {
    "tool": "age",
    "encrypted": true
  },
  "coverage": {
    "database": true,
    "auth": true,
    "storage": true,
    "repository": true,
    "configuration_manifest": true
  },
  "offsite_uploaded": true,
  "offsite": {
    "remote_verified": true,
    "remote_path": "ridearrivo-test/admin-backups/synthetic.age"
  },
  "restore_verified": false
}
JSON

exit 0
STUB

chmod 700 \
  "$fixture_scripts/preflight.sh" \
  "$fixture_scripts/queue-client.sh" \
  "$fixture_scripts/database-backup.sh" \
  "$fixture_scripts/storage-backup.sh" \
  "$fixture_scripts/package-backup.sh" \
  "$fixture_scripts/upload-backup.sh"

runner="$fixture_scripts/backup-runner.sh"

run_case() {
  case_name="$1"
  scenario="$2"
  private_identity="$3"
  use_failing_mktemp="$4"

  case_root="$temporary_root/cases/$case_name"
  work_root="$case_root/work"
  log="$case_root/events.log"
  output="$case_root/output.log"

  mkdir -p \
    "$work_root"

  : > "$log"
  : > "$output"

  run_path="$PATH"

  if [ "$use_failing_mktemp" = "true" ]; then
    fail_bin="$case_root/fail-bin"

    mkdir -p "$fail_bin"

    cat > "$fail_bin/mktemp" <<'MKTEMP'
#!/usr/bin/env bash
printf 'ERROR: synthetic mktemp failure\n' >&2
exit 74
MKTEMP

    chmod 700 "$fail_bin/mktemp"

    run_path="$fail_bin:$run_path"
  fi

  case_rc=99

  if [ -n "$private_identity" ]; then
    if env -i \
      PATH="$run_path" \
      TEST_LOG="$log" \
      TEST_SCENARIO="$scenario" \
      BACKUP_RUNNER_ID="test-runner" \
      BACKUP_RUN_WORK_ROOT="$work_root" \
      BACKUP_HEARTBEAT_INTERVAL_SECONDS=30 \
      BACKUP_AGE_IDENTITY_FILE="$private_identity" \
      bash "$runner" run \
      >"$output" 2>&1
    then
      case_rc=0
    else
      case_rc=$?
    fi
  else
    if env -i \
      PATH="$run_path" \
      TEST_LOG="$log" \
      TEST_SCENARIO="$scenario" \
      BACKUP_RUNNER_ID="test-runner" \
      BACKUP_RUN_WORK_ROOT="$work_root" \
      BACKUP_HEARTBEAT_INTERVAL_SECONDS=30 \
      bash "$runner" run \
      >"$output" 2>&1
    then
      case_rc=0
    else
      case_rc=$?
    fi
  fi

  printf '%s\n' "$case_rc" \
    > "$case_root/rc"

  printf '%s\n' "$case_root"
}

job_id='11111111-2222-4333-8444-555555555555'
attempt_count=2

echo "=== BACKUP WRITER SUCCESS PATH ==="

success_root="$(
  run_case \
    success \
    success \
    "" \
    false
)"

success_rc="$(
  cat "$success_root/rc"
)"

assert_rc \
  0 \
  "$success_rc" \
  "writer success exit"

assert_contains \
  "$success_root/output.log" \
  "PASS: backup job completed successfully" \
  "writer success result"

assert_contains \
  "$success_root/output.log" \
  "ATTEMPT_COUNT=$attempt_count" \
  "writer reports detailed claim attempt"

assert_contains \
  "$success_root/events.log" \
  "ridearrivo-admin-backup-${job_id}-attempt-${attempt_count}.age" \
  "writer uses attempt-bound immutable artifact identity"

assert_order \
  "$success_root/events.log" \
  "writer executes required stages in order" \
  "preflight" \
  "queue:claim-detail test-runner" \
  "queue:heartbeat $job_id test-runner" \
  "database:run " \
  "storage:run " \
  "package:run " \
  "upload:run " \
  "queue:complete $job_id test-runner "

assert_absent \
  "$success_root/events.log" \
  "queue:fail " \
  "successful writer does not fail job"

assert_empty_dir \
  "$success_root/work" \
  "successful writer removes recovery workspace"

echo
echo "=== COMPLETION RESPONSE LOSS RETRY ==="

retry_root="$(
  run_case \
    completion-retry \
    complete-retry \
    "" \
    false
)"

retry_rc="$(
  cat "$retry_root/rc"
)"

assert_rc \
  0 \
  "$retry_rc" \
  "lost completion response retries successfully"

assert_count \
  "$retry_root/events.log" \
  "queue:complete $job_id test-runner " \
  2 \
  "completion response loss performs exactly two attempts"

assert_repeated_identically \
  "$retry_root/events.log" \
  "queue:complete $job_id test-runner " \
  2 \
  "completion retry reuses exact completion payload"

assert_contains \
  "$retry_root/output.log" \
  "WARN: completion response unresolved; retrying exact request" \
  "lost completion response is explicitly retried"

assert_contains \
  "$retry_root/output.log" \
  "PASS: backup job completed successfully" \
  "idempotent completion retry reaches success"

assert_absent \
  "$retry_root/events.log" \
  "queue:fail " \
  "lost completion response never terminalizes job"

assert_empty_dir \
  "$retry_root/work" \
  "completion retry success cleans recovery workspace"

echo
echo "=== PERSISTENT COMPLETION AMBIGUITY ==="

ambiguous_root="$(
  run_case \
    completion-ambiguous \
    complete-ambiguous \
    "" \
    false
)"

ambiguous_rc="$(
  cat "$ambiguous_root/rc"
)"

assert_nonzero \
  "$ambiguous_rc" \
  "persistent completion ambiguity exits nonzero"

assert_count \
  "$ambiguous_root/events.log" \
  "queue:complete $job_id test-runner " \
  3 \
  "persistent ambiguity performs exactly three attempts"

assert_repeated_identically \
  "$ambiguous_root/events.log" \
  "queue:complete $job_id test-runner " \
  3 \
  "all ambiguous retries reuse exact completion payload"

assert_contains \
  "$ambiguous_root/output.log" \
  "completion remains unresolved after bounded retries; job left for lease recovery" \
  "persistent ambiguity defers state decision to lease recovery"

assert_absent \
  "$ambiguous_root/events.log" \
  "queue:fail " \
  "persistent completion ambiguity never issues fail transition"

assert_absent \
  "$ambiguous_root/output.log" \
  "PASS: backup job completed successfully" \
  "persistent ambiguity cannot report false success"

assert_empty_dir \
  "$ambiguous_root/work" \
  "persistent ambiguity still cleans local recovery workspace"

echo
echo "=== NO-JOB PATH ==="

no_job_root="$(
  run_case \
    no-job \
    no-job \
    "" \
    false
)"

no_job_rc="$(
  cat "$no_job_root/rc"
)"

assert_rc \
  0 \
  "$no_job_rc" \
  "no-job exit"

assert_contains \
  "$no_job_root/output.log" \
  "PASS: no queued or currently-due backup job" \
  "no-job result"

assert_absent \
  "$no_job_root/events.log" \
  "database:run " \
  "no-job does not start database backup"

assert_absent \
  "$no_job_root/events.log" \
  "queue:complete " \
  "no-job does not complete anything"

assert_absent \
  "$no_job_root/events.log" \
  "queue:fail " \
  "no-job does not fail anything"

echo
echo "=== CLAIM TRANSPORT FAILURE ==="

claim_root="$(
  run_case \
    claim-failure \
    claim-fail \
    "" \
    false
)"

claim_rc="$(
  cat "$claim_root/rc"
)"

assert_nonzero \
  "$claim_rc" \
  "claim transport failure exits nonzero"

assert_contains \
  "$claim_root/output.log" \
  "ERROR: unable to claim detailed backup job" \
  "claim failure remains distinct from no-job"

assert_absent \
  "$claim_root/events.log" \
  "queue:fail " \
  "unclaimed job is not failed"

assert_absent \
  "$claim_root/events.log" \
  "database:run " \
  "claim failure starts no backup stage"

echo
echo "=== DATABASE STAGE FAILURE ==="

database_root="$(
  run_case \
    database-failure \
    database-fail \
    "" \
    false
)"

database_rc="$(
  cat "$database_root/rc"
)"

assert_nonzero \
  "$database_rc" \
  "database stage failure exits nonzero"

assert_order \
  "$database_root/events.log" \
  "database failure transition order" \
  "queue:claim-detail test-runner" \
  "queue:heartbeat $job_id test-runner" \
  "database:run " \
  "queue:fail $job_id test-runner "

assert_absent \
  "$database_root/events.log" \
  "storage:run " \
  "database failure blocks Storage"

assert_absent \
  "$database_root/events.log" \
  "package:run " \
  "database failure blocks packaging"

assert_absent \
  "$database_root/events.log" \
  "upload:run " \
  "database failure blocks upload"

assert_absent \
  "$database_root/events.log" \
  "queue:complete " \
  "database failure cannot complete job"

assert_empty_dir \
  "$database_root/work" \
  "failed writer removes recovery workspace"

echo
echo "=== HEARTBEAT REJECTION ==="

heartbeat_root="$(
  run_case \
    heartbeat-failure \
    heartbeat-fail \
    "" \
    false
)"

heartbeat_rc="$(
  cat "$heartbeat_root/rc"
)"

assert_nonzero \
  "$heartbeat_rc" \
  "heartbeat rejection exits nonzero"

assert_order \
  "$heartbeat_root/events.log" \
  "heartbeat rejection fails leased job" \
  "queue:claim-detail test-runner" \
  "queue:heartbeat $job_id test-runner" \
  "queue:fail $job_id test-runner "

assert_absent \
  "$heartbeat_root/events.log" \
  "database:run " \
  "heartbeat rejection blocks database backup"

assert_absent \
  "$heartbeat_root/events.log" \
  "queue:complete " \
  "heartbeat rejection cannot complete job"

assert_empty_dir \
  "$heartbeat_root/work" \
  "heartbeat failure removes recovery workspace"

echo
echo "=== POST-CLAIM WORKSPACE FAILURE ==="

setup_root="$(
  run_case \
    setup-failure \
    success \
    "" \
    true
)"

setup_rc="$(
  cat "$setup_root/rc"
)"

assert_nonzero \
  "$setup_rc" \
  "workspace creation failure exits nonzero"

assert_order \
  "$setup_root/events.log" \
  "workspace creation failure transitions leased job" \
  "queue:claim-detail test-runner" \
  "queue:fail $job_id test-runner "

assert_contains \
  "$setup_root/output.log" \
  "Unable to create isolated backup workspace." \
  "workspace creation failure is explicit"

assert_absent \
  "$setup_root/events.log" \
  "database:run " \
  "workspace failure starts no backup stage"

assert_absent \
  "$setup_root/events.log" \
  "queue:complete " \
  "workspace failure cannot complete job"

echo
echo "=== PRIVATE IDENTITY SEPARATION ==="

private_root="$(
  run_case \
    private-identity \
    success \
    "$temporary_root/synthetic-private-identity" \
    false
)"

private_rc="$(
  cat "$private_root/rc"
)"

assert_nonzero \
  "$private_rc" \
  "writer rejects private age identity"

assert_contains \
  "$private_root/output.log" \
  "backup writer must not possess decryption credential" \
  "private identity rejection is explicit"

assert_absent \
  "$private_root/events.log" \
  "preflight" \
  "private identity rejected before preflight"

assert_absent \
  "$private_root/events.log" \
  "queue:claim-detail " \
  "private identity rejected before claim"

assert_absent \
  "$private_root/events.log" \
  "database:run " \
  "private identity can never reach backup execution"

echo
echo "=== SECRET ISOLATION ==="

secret_hits="$(
  grep -RniE \
    'sb_secret_|SUPABASE_DB_URL=|BACKUP_S3_SECRET_ACCESS_KEY=|SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=|AGE-SECRET-KEY-' \
    "$temporary_root/cases" \
    2>/dev/null \
    || true
)"

if [ -z "$secret_hits" ]; then
  pass "stubbed lifecycle tests expose no real credential material"
else
  fail "stubbed lifecycle tests contain credential-like material"
fi

echo
echo "=== WRITER LIFECYCLE RESULT ==="

printf 'PASS_COUNT=%s\n' "$pass_count"
printf 'FAIL_COUNT=%s\n' "$fail_count"

if [ "$fail_count" -eq 0 ]; then
  echo "PASS: backup writer lifecycle contract"
  exit 0
fi

echo "FAIL: backup writer lifecycle contract"
exit 1

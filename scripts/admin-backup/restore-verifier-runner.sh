#!/usr/bin/env bash

set -Euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  restore-verifier-runner.sh run
USAGE
}

require_env() {
  name="$1"

  if [ -z "${!name:-}" ]; then
    printf 'ERROR: required environment variable %s is missing\n' \
      "$name" >&2
    return 1
  fi
}

require_command() {
  name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'ERROR: required command %s is unavailable\n' \
      "$name" >&2
    return 1
  fi
}

sha256_file() {
  file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  return 1
}

script_dir="$(
  CDPATH= cd -- "$(dirname -- "$0")" &&
    pwd
)"

control_client="$script_dir/restore-control-client.sh"
security_preflight="$script_dir/restore-verifier-preflight.sh"
artifact_verifier="$script_dir/verify-backup-artifact.sh"

mode="${1:-}"

if [ "$mode" != "run" ]; then
  usage
  exit 2
fi

for helper in \
  "$control_client" \
  "$security_preflight" \
  "$artifact_verifier"
do
  if [ ! -x "$helper" ]; then
    printf 'ERROR: required verifier helper is unavailable: %s\n' \
      "$helper" >&2
    exit 1
  fi
done

for required in \
  SUPABASE_URL \
  SUPABASE_SECRET_KEY \
  BACKUP_VERIFY_S3_ENDPOINT \
  BACKUP_VERIFY_S3_REGION \
  BACKUP_VERIFY_S3_ACCESS_KEY_ID \
  BACKUP_VERIFY_S3_SECRET_ACCESS_KEY \
  BACKUP_AGE_IDENTITY_FILE
do
  require_env "$required" || exit 1
done

for forbidden in \
  SUPABASE_DB_URL \
  SUPABASE_DB_PASSWORD \
  DATABASE_URL \
  DIRECT_URL \
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID \
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY \
  BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY \
  BACKUP_AGE_PRIVATE_KEY \
  AGE_SECRET_KEY
do
  if [ -n "${!forbidden:-}" ]; then
    printf 'ERROR: forbidden verifier-runner credential is present: %s\n' \
      "$forbidden" >&2
    exit 1
  fi
done

if ! printf '%s\n' "$SUPABASE_URL" |
     grep -Eq '^https://'; then
  printf 'ERROR: SUPABASE_URL must use HTTPS\n' >&2
  exit 1
fi

if ! printf '%s\n' "$SUPABASE_SECRET_KEY" |
     grep -Eq '^sb_secret_'; then
  printf 'ERROR: SUPABASE_SECRET_KEY must use sb_secret_ format\n' >&2
  exit 1
fi

if ! printf '%s\n' "$BACKUP_VERIFY_S3_ENDPOINT" |
     grep -Eq '^https://'; then
  printf 'ERROR: verification S3 endpoint must use HTTPS\n' >&2
  exit 1
fi

if [ ! -f "$BACKUP_AGE_IDENTITY_FILE" ] ||
   [ ! -s "$BACKUP_AGE_IDENTITY_FILE" ] ||
   [ ! -r "$BACKUP_AGE_IDENTITY_FILE" ]
then
  printf 'ERROR: age identity file is unavailable\n' >&2
  exit 1
fi

for command_name in \
  bash \
  jq \
  rclone \
  grep \
  awk \
  wc \
  mktemp
do
  require_command "$command_name" || exit 1
done

if ! command -v sha256sum >/dev/null 2>&1 &&
   ! command -v shasum >/dev/null 2>&1
then
  printf 'ERROR: no SHA-256 utility is available\n' >&2
  exit 1
fi

verifier_id="${BACKUP_RESTORE_VERIFIER_ID:-}"

if [ -z "$verifier_id" ]; then
  verifier_id="$(
    date -u '+ridearrivo-restore-%Y%m%dT%H%M%SZ'
  )-$$"
fi

if ! printf '%s\n' "$verifier_id" |
     grep -Eq '^[A-Za-z0-9._:-]{1,128}$'
then
  printf 'ERROR: restore verifier identifier is invalid\n' >&2
  exit 1
fi

heartbeat_interval="${BACKUP_RESTORE_HEARTBEAT_SECONDS:-300}"

if ! printf '%s\n' "$heartbeat_interval" |
     grep -Eq '^[0-9]+$'
then
  printf 'ERROR: restore heartbeat interval is invalid\n' >&2
  exit 1
fi

if [ "$heartbeat_interval" -lt 30 ] ||
   [ "$heartbeat_interval" -gt 1800 ]
then
  printf 'ERROR: restore heartbeat interval must be 30..1800 seconds\n' \
    >&2
  exit 1
fi

echo "=== RIDEARRIVO INDEPENDENT RESTORE VERIFIER ==="
printf 'VERIFIER_ID=%s\n' "$verifier_id"

claim_json=""

if claim_json="$(
  "$control_client" claim "$verifier_id"
)"
then
  :
else
  printf 'ERROR: unable to claim restore-verification job\n' >&2
  exit 1
fi

if printf '%s\n' "$claim_json" |
   jq -e '. == null' >/dev/null
then
  echo "PASS: no completed backup currently requires restore verification"
  exit 0
fi

job_id="$(
  printf '%s\n' "$claim_json" |
    jq -er '.job_id'
)" || exit 1

remote_path="$(
  printf '%s\n' "$claim_json" |
    jq -er '.artifact_path'
)" || exit 1

expected_bytes="$(
  printf '%s\n' "$claim_json" |
    jq -er '.artifact_bytes'
)" || exit 1

expected_sha256="$(
  printf '%s\n' "$claim_json" |
    jq -er '.checksum_sha256'
)" || exit 1

if ! printf '%s\n' "$job_id" |
     grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
then
  printf 'ERROR: claimed restore job identifier is invalid\n' >&2
  exit 1
fi

if ! printf '%s\n' "$remote_path" |
     grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._/-]+[.]age$'
then
  "$control_client" \
    release \
    "$job_id" \
    "$verifier_id" \
    "Claimed artifact path failed local safety validation." \
    >/dev/null 2>&1 || true

  printf 'ERROR: claimed artifact path is invalid\n' >&2
  exit 1
fi

if printf '%s\n' "$remote_path" |
   grep -Eq '(^|/)[.][.]?(/|$)|//'
then
  "$control_client" \
    release \
    "$job_id" \
    "$verifier_id" \
    "Claimed artifact path failed traversal validation." \
    >/dev/null 2>&1 || true

  printf 'ERROR: claimed artifact path contains unsafe segments\n' >&2
  exit 1
fi

artifact_name="$(
  basename "$remote_path"
)"

if ! printf '%s\n' "$artifact_name" |
     grep -Eq '^[A-Za-z0-9._-]+[.]age$'
then
  "$control_client" \
    release \
    "$job_id" \
    "$verifier_id" \
    "Claimed artifact filename failed local safety validation." \
    >/dev/null 2>&1 || true

  printf 'ERROR: claimed artifact filename is invalid\n' >&2
  exit 1
fi

work_root="${BACKUP_RESTORE_WORK_ROOT:-${TMPDIR:-/tmp}}"

run_root=""

if run_root="$(
  mktemp -d \
    "${work_root%/}/ridearrivo-restore-verifier.${job_id}.XXXXXX"
)"
then
  :
else
  "$control_client" \
    release \
    "$job_id" \
    "$verifier_id" \
    "Unable to create isolated verification workspace." \
    >/dev/null 2>&1 || true

  printf 'ERROR: unable to create isolated verification workspace\n' >&2
  exit 1
fi

chmod 700 "$run_root"

artifact_path="$run_root/$artifact_name"
sidecar_path="${artifact_path}.json"
evidence_path="$run_root/verification-evidence.json"
verifier_log="$run_root/verifier.log"
heartbeat_failure="$run_root/heartbeat.failed"

child_pid=""
heartbeat_pid=""
terminal=false

stop_heartbeat() {
  if [ -n "$heartbeat_pid" ]; then
    kill "$heartbeat_pid" >/dev/null 2>&1 || true
    wait "$heartbeat_pid" >/dev/null 2>&1 || true
    heartbeat_pid=""
  fi
}

stop_child() {
  if [ -n "$child_pid" ] &&
     kill -0 "$child_pid" >/dev/null 2>&1
  then
    kill "$child_pid" >/dev/null 2>&1 || true
    wait "$child_pid" >/dev/null 2>&1 || true
  fi

  child_pid=""
}

cleanup() {
  stop_heartbeat
  stop_child

  unset RCLONE_CONFIG_VERIFY_TYPE
  unset RCLONE_CONFIG_VERIFY_PROVIDER
  unset RCLONE_CONFIG_VERIFY_ENDPOINT
  unset RCLONE_CONFIG_VERIFY_REGION
  unset RCLONE_CONFIG_VERIFY_ACCESS_KEY_ID
  unset RCLONE_CONFIG_VERIFY_SECRET_ACCESS_KEY
  unset RCLONE_CONFIG_VERIFY_FORCE_PATH_STYLE
unset RCLONE_CONFIG_VERIFY_NO_CHECK_BUCKET

  rm -rf -- "$run_root"
}

release_claim() {
  reason="$1"

  stop_heartbeat

  if [ "$terminal" = false ]; then
    "$control_client" \
      release \
      "$job_id" \
      "$verifier_id" \
      "$reason" \
      >/dev/null 2>&1 || true
  fi
}

handle_signal() {
  signal_name="$1"

  stop_child

  release_claim \
    "Restore verifier interrupted by ${signal_name}."

  exit 130
}

trap cleanup EXIT
trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM
trap 'handle_signal HUP' HUP

heartbeat_once() {
  "$control_client" \
    heartbeat \
    "$job_id" \
    "$verifier_id"
}

echo
echo "=== DOWNLOAD AUTHENTICATED OFF-SITE ARTIFACT ==="

if ! heartbeat_once; then
  release_claim \
    "Restore verifier lost its lease before artifact download."

  printf 'ERROR: restore verifier heartbeat was rejected\n' >&2
  exit 1
fi

export RCLONE_CONFIG_VERIFY_TYPE="s3"
export RCLONE_CONFIG_VERIFY_PROVIDER="Cloudflare"
export RCLONE_CONFIG_VERIFY_ENDPOINT="$BACKUP_VERIFY_S3_ENDPOINT"
export RCLONE_CONFIG_VERIFY_REGION="$BACKUP_VERIFY_S3_REGION"
export RCLONE_CONFIG_VERIFY_ACCESS_KEY_ID="$BACKUP_VERIFY_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_VERIFY_SECRET_ACCESS_KEY="$BACKUP_VERIFY_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_VERIFY_FORCE_PATH_STYLE="true"
export RCLONE_CONFIG_VERIFY_NO_CHECK_BUCKET="true"

if ! rclone copyto \
     "verify:${remote_path}" \
     "$artifact_path" \
     --immutable \
     --check-first
then
  release_claim \
    "Unable to download encrypted backup artifact."

  printf 'ERROR: encrypted backup artifact download failed\n' >&2
  exit 1
fi

if ! rclone copyto \
     "verify:${remote_path}.json" \
     "$sidecar_path" \
     --immutable \
     --check-first
then
  release_claim \
    "Unable to download backup artifact sidecar."

  printf 'ERROR: backup artifact sidecar download failed\n' >&2
  exit 1
fi

unset RCLONE_CONFIG_VERIFY_TYPE
unset RCLONE_CONFIG_VERIFY_PROVIDER
unset RCLONE_CONFIG_VERIFY_ENDPOINT
unset RCLONE_CONFIG_VERIFY_REGION
unset RCLONE_CONFIG_VERIFY_ACCESS_KEY_ID
unset RCLONE_CONFIG_VERIFY_SECRET_ACCESS_KEY
unset RCLONE_CONFIG_VERIFY_FORCE_PATH_STYLE
unset RCLONE_CONFIG_VERIFY_NO_CHECK_BUCKET

actual_bytes="$(
  wc -c < "$artifact_path" |
    tr -d '[:space:]'
)"

actual_sha256="$(
  sha256_file "$artifact_path"
)"

if [ "$actual_bytes" != "$expected_bytes" ] ||
   [ "$actual_sha256" != "$expected_sha256" ]
then
  release_claim \
    "Downloaded artifact does not match the control-plane checksum contract."

  printf 'ERROR: downloaded artifact failed control-plane binding\n' >&2
  exit 1
fi

if ! jq -e \
  --arg remote_path "$remote_path" \
  --arg name "$artifact_name" \
  --arg sha "$expected_sha256" \
  --argjson bytes "$expected_bytes" \
  '
    .artifact.name == $name
    and .artifact.bytes == $bytes
    and .artifact.sha256 == $sha
    and .encryption.tool == "age"
    and .encryption.encrypted == true
    and .offsite_uploaded == true
    and .offsite.remote_verified == true
    and .offsite.remote_path == $remote_path
    and .restore_verified == false
  ' \
  "$sidecar_path" >/dev/null
then
  release_claim \
    "Downloaded sidecar does not match the control-plane artifact contract."

  printf 'ERROR: downloaded sidecar failed control-plane binding\n' >&2
  exit 1
fi

echo "PASS: encrypted artifact is bound to claimed control-plane metadata"

echo
echo "=== ISOLATED RESTORE SECURITY PREFLIGHT ==="

child_home="$run_root/child-home"
child_tmp="$run_root/child-tmp"

if mkdir -p      "$child_home"      "$child_tmp" &&
   chmod 700      "$child_home"      "$child_tmp"
then
  :
else
  release_claim     "Unable to initialize isolated verifier child filesystem."

  printf 'ERROR: unable to initialize verifier child filesystem\n'     >&2

  exit 1
fi

child_env=(
  env
  -i
  "PATH=$PATH"
  "HOME=$child_home"
  "TMPDIR=$child_tmp"
  "BACKUP_AGE_IDENTITY_FILE=$BACKUP_AGE_IDENTITY_FILE"
)

if ! "${child_env[@]}" \
     "$security_preflight"
then
  release_claim \
    "Independent restore-verifier security preflight failed."

  printf 'ERROR: isolated restore-verifier preflight failed\n' >&2
  exit 1
fi

if ! heartbeat_once; then
  release_claim \
    "Restore verifier lost its lease before recovery proof."

  printf 'ERROR: restore verifier heartbeat was rejected\n' >&2
  exit 1
fi

echo
echo "=== ISOLATED RECOVERY PROOF ==="

"${child_env[@]}" \
  "$artifact_verifier" \
  run \
  "$artifact_path" \
  "$evidence_path" \
  >"$verifier_log" 2>&1 &

child_pid=$!

(
  heartbeat_sleep_pid=""

  stop_loop_sleep() {
    if [ -n "$heartbeat_sleep_pid" ]; then
      kill "$heartbeat_sleep_pid" >/dev/null 2>&1 || true
      wait "$heartbeat_sleep_pid" >/dev/null 2>&1 || true
      heartbeat_sleep_pid=""
    fi
  }

  handle_loop_signal() {
    stop_loop_sleep
    exit 0
  }

  trap - EXIT
  trap 'handle_loop_signal' INT TERM HUP

  while kill -0 "$child_pid" >/dev/null 2>&1
  do
    sleep "$heartbeat_interval" &
    heartbeat_sleep_pid=$!

    if wait "$heartbeat_sleep_pid"; then
      heartbeat_sleep_pid=""
    else
      heartbeat_sleep_pid=""
      exit 0
    fi

    if kill -0 "$child_pid" >/dev/null 2>&1
    then
      if ! "$control_client" \
           heartbeat \
           "$job_id" \
           "$verifier_id" \
           >/dev/null 2>&1
      then
        printf '%s\n' \
          "restore verifier heartbeat failed" \
          > "$heartbeat_failure"

        kill "$child_pid" >/dev/null 2>&1 || true
        exit 0
      fi
    fi
  done
) >/dev/null 2>&1 &

heartbeat_pid=$!

child_rc=0

if wait "$child_pid"; then
  child_rc=0
else
  child_rc=$?
fi

child_pid=""

stop_heartbeat

if [ -s "$heartbeat_failure" ]; then
  release_claim \
    "Restore verifier lease was lost during recovery proof."

  printf 'ERROR: restore verifier lease was lost during recovery proof\n' \
    >&2
  exit 1
fi

if [ "$child_rc" -ne 0 ]; then
  cat "$verifier_log" >&2 || true

  release_claim \
    "Independent isolated restore verification failed."

  exit 1
fi

if [ ! -s "$evidence_path" ]; then
  release_claim \
    "Independent restore verifier produced no evidence."

  exit 1
fi

if ! jq -e \
  --arg sha "$expected_sha256" \
  '
    .artifact_sha256 == $sha
    and .checksum_verified == true
    and .decryption_verified == true
    and .database_restore == true
    and .auth_restore == true
    and .storage_restore == true
    and .repository_available == true
    and .configuration_manifest_valid == true
    and .database_restore_verification.executed == true
    and .database_restore_verification.production_database_contacted == false
    and .database_restore_verification.final_claim_promoted == true
    and .storage_restore_verification.executed == true
    and .storage_restore_verification.production_storage_contacted == false
    and .storage_restore_verification.final_claim_promoted == true
  ' \
  "$evidence_path" >/dev/null
then
  release_claim \
    "Independent restore verification evidence failed final promotion checks."

  exit 1
fi

if ! heartbeat_once; then
  release_claim \
    "Restore verifier lost its lease before finalization."

  printf 'ERROR: restore verifier heartbeat failed before finalization\n' \
    >&2
  exit 1
fi

if "$control_client" \
     verify \
     "$job_id" \
     "$verifier_id" \
     "$evidence_path"
then
  terminal=true
else
  printf 'ERROR: restore verification finalization was rejected\n' >&2
  exit 1
fi

echo
echo "PASS: independent restore verification completed"
printf 'JOB_ID=%s\n' "$job_id"
printf 'ARTIFACT=%s\n' "$remote_path"

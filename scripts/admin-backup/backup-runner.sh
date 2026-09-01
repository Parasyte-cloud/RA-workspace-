#!/usr/bin/env bash

set -Euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  backup-runner.sh run

The backup writer:
  1. validates its writer-only environment,
  2. claims one queued or currently-due job,
  3. keeps the database lease alive,
  4. exports Database/Auth,
  5. exports Storage,
  6. builds and encrypts the recovery artifact,
  7. uploads and remotely verifies the encrypted artifact,
  8. completes the control-plane job.

The backup writer must never possess the age private identity.
USAGE
}

script_dir="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
    pwd
)"

repo_root=""

if repo_root="$(
  git -C "$script_dir" rev-parse --show-toplevel
)"
then
  :
else
  printf 'ERROR: unable to resolve repository root\n' >&2
  exit 1
fi

if [ -z "$repo_root" ] ||
   [ ! -d "$repo_root" ]
then
  printf 'ERROR: resolved repository root is invalid\n' >&2
  exit 1
fi

queue_client="$script_dir/queue-client.sh"
preflight="$script_dir/preflight.sh"
database_backup="$script_dir/database-backup.sh"
storage_backup="$script_dir/storage-backup.sh"
package_backup="$script_dir/package-backup.sh"
upload_backup="$script_dir/upload-backup.sh"

mode="${1:-}"

if [ "$mode" != "run" ] || [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

require_executable() {
  file="$1"

  if [ ! -f "$file" ] || [ ! -x "$file" ]; then
    printf 'ERROR: required runner component is unavailable: %s\n' \
      "$file" >&2
    return 1
  fi
}

for component in \
  "$queue_client" \
  "$preflight" \
  "$database_backup" \
  "$storage_backup" \
  "$package_backup" \
  "$upload_backup"
do
  require_executable "$component" || exit 1
done

for forbidden in \
  BACKUP_AGE_PRIVATE_KEY \
  BACKUP_AGE_IDENTITY \
  BACKUP_AGE_IDENTITY_FILE \
  AGE_SECRET_KEY \
  AGE_IDENTITY
do
  if [ -n "${!forbidden:-}" ]; then
    printf \
      'ERROR: backup writer must not possess decryption credential: %s\n' \
      "$forbidden" >&2
    exit 1
  fi
done

if ! "$preflight"; then
  printf 'ERROR: backup writer preflight failed\n' >&2
  exit 1
fi

runner_id="${BACKUP_RUNNER_ID:-}"

if [ -z "$runner_id" ]; then
  runner_id="$(
    printf 'ridearrivo-backup-%s-%s' \
      "$(date -u '+%Y%m%dT%H%M%SZ')" \
      "$$"
  )"
fi

if ! printf '%s\n' "$runner_id" |
     grep -Eq '^[A-Za-z0-9._:-]{1,128}$'
then
  printf \
    'ERROR: BACKUP_RUNNER_ID contains unsafe characters or is too long\n' \
    >&2
  exit 1
fi

heartbeat_interval="${BACKUP_HEARTBEAT_INTERVAL_SECONDS:-300}"

case "$heartbeat_interval" in
  ''|*[!0-9]*)
    printf \
      'ERROR: BACKUP_HEARTBEAT_INTERVAL_SECONDS must be an integer\n' \
      >&2
    exit 1
    ;;
esac

if [ "$heartbeat_interval" -lt 30 ] ||
   [ "$heartbeat_interval" -gt 1800 ]
then
  printf \
    'ERROR: heartbeat interval must be between 30 and 1800 seconds\n' \
    >&2
  exit 1
fi

work_root="${BACKUP_RUN_WORK_ROOT:-${TMPDIR:-/tmp}}"

if [ ! -d "$work_root" ] ||
   [ ! -w "$work_root" ]
then
  printf 'ERROR: backup work root is unavailable or not writable\n' >&2
  exit 1
fi

if cd "$repo_root"
then
  :
else
  printf 'ERROR: unable to enter repository root\n' >&2
  exit 1
fi

echo "=== RIDEARRIVO BACKUP WRITER ==="
echo
printf 'RUNNER_ID=%s\n' "$runner_id"

job_id=""
attempt_count=""
claim_output=""

if claim_output="$(
  "$queue_client" claim-detail "$runner_id"
)"
then
  :
else
  printf 'ERROR: unable to claim detailed backup job\n' >&2
  exit 1
fi

if printf '%s\n' "$claim_output" |
   jq -e '. == null' >/dev/null
then
  echo "PASS: no queued or currently-due backup job"
  exit 0
fi

if job_id="$(
     printf '%s\n' "$claim_output" |
       jq -er '.job_id'
   )" &&
   attempt_count="$(
     printf '%s\n' "$claim_output" |
       jq -er '.attempt_count'
   )"
then
  :
else
  printf 'ERROR: detailed backup claim is invalid\n' >&2
  exit 1
fi

if printf '%s\n' "$job_id" |
   grep -Eq \
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
then
  :
else
  printf 'ERROR: claimed backup job identifier is invalid\n' >&2
  exit 1
fi

case "$attempt_count" in
  ''|*[!0-9]*)
    printf 'ERROR: claimed backup attempt number is invalid\n' >&2
    exit 1
    ;;
esac

if [ "$attempt_count" -lt 1 ] ||
   [ "$attempt_count" -gt 20 ]
then
  printf 'ERROR: claimed backup attempt number is outside 1..20\n' >&2
  exit 1
fi

printf 'JOB_ID=%s\n' "$job_id"
printf 'ATTEMPT_COUNT=%s\n' "$attempt_count"

run_root=""

if run_root="$(
  mktemp -d \
    "${work_root%/}/ridearrivo-admin-backup.${job_id}.XXXXXX"
)"
then
  :
else
  setup_reason="Unable to create isolated backup workspace."

  printf 'ERROR: %s\n' "$setup_reason" >&2

  if "$queue_client" \
       fail \
       "$job_id" \
       "$runner_id" \
       "$setup_reason" \
       >/dev/null 2>&1
  then
    :
  else
    printf \
      'ERROR: setup failure could not transition backup job to failed\n' \
      >&2
  fi

  exit 1
fi

workspace="$run_root/workspace"
artifact_dir="$run_root/artifacts"

if mkdir -p \
     "$workspace" \
     "$artifact_dir" &&
   chmod 700 \
     "$run_root" \
     "$workspace" \
     "$artifact_dir"
then
  :
else
  setup_reason="Unable to initialize isolated backup workspace."

  printf 'ERROR: %s\n' "$setup_reason" >&2

  if "$queue_client" \
       fail \
       "$job_id" \
       "$runner_id" \
       "$setup_reason" \
       >/dev/null 2>&1
  then
    :
  else
    printf \
      'ERROR: setup failure could not transition backup job to failed\n' \
      >&2
  fi

  rm -rf -- "$run_root"

  exit 1
fi

artifact_path="$artifact_dir/ridearrivo-admin-backup-${job_id}-attempt-${attempt_count}.age"
sidecar_path="${artifact_path}.json"
manifest_path="$workspace/manifest.json"
heartbeat_failure="$run_root/heartbeat.failed"

heartbeat_pid=""
job_terminal=false
completion_phase=false
failure_reason="Backup runner terminated before completion."

stop_heartbeat() {
  if [ -n "$heartbeat_pid" ]; then
    kill "$heartbeat_pid" >/dev/null 2>&1 || true
    wait "$heartbeat_pid" >/dev/null 2>&1 || true
    heartbeat_pid=""
  fi
}

cleanup() {
  stop_heartbeat

  rm -rf -- "$run_root"
}

trap cleanup EXIT

mark_failed() {
  reason="$1"

  stop_heartbeat

  if [ "$job_terminal" = true ]; then
    return 0
  fi

  if [ -z "$reason" ]; then
    reason="Backup runner failed."
  fi

  if [ "${#reason}" -gt 1000 ]; then
    reason="${reason:0:1000}"
  fi

  if "$queue_client" \
       fail \
       "$job_id" \
       "$runner_id" \
       "$reason"
  then
    job_terminal=true
    printf 'PASS: backup job transitioned to failed\n'
  else
    printf \
      'ERROR: backup job failure transition was rejected\n' \
      >&2
  fi
}

on_signal() {
  signal_name="$1"

  failure_reason="Backup runner interrupted by ${signal_name}."

  if [ "$completion_phase" = true ]; then
    stop_heartbeat

    printf '%s
'       "ERROR: interrupted during ambiguous completion; job left for lease recovery"       >&2

    exit 130
  fi

  mark_failed "$failure_reason"

  exit 130
}

trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP

heartbeat_once() {
  if ! "$queue_client" \
       heartbeat \
       "$job_id" \
       "$runner_id" \
       >/dev/null
  then
    printf 'ERROR: backup lease heartbeat was rejected\n' >&2
    return 1
  fi
}

start_heartbeat() {
  (
    while :
    do
      sleep "$heartbeat_interval"

      if ! "$queue_client" \
           heartbeat \
           "$job_id" \
           "$runner_id" \
           >/dev/null
      then
        printf '%s\n' \
          "Backup lease heartbeat failed." \
          >"$heartbeat_failure"

        exit 1
      fi
    done
  ) &

  heartbeat_pid=$!
}

check_heartbeat() {
  if [ -s "$heartbeat_failure" ]; then
    printf 'ERROR: background backup lease heartbeat failed\n' >&2
    return 1
  fi

  if [ -n "$heartbeat_pid" ] &&
     ! kill -0 "$heartbeat_pid" >/dev/null 2>&1
  then
    printf 'ERROR: backup lease heartbeat process stopped unexpectedly\n' \
      >&2
    return 1
  fi

  return 0
}

run_stage() {
  stage_name="$1"
  shift

  echo
  printf '=== %s ===\n' "$stage_name"

  if ! check_heartbeat; then
    failure_reason="Backup lease was lost before ${stage_name}."
    return 1
  fi

  if ! heartbeat_once; then
    failure_reason="Backup lease heartbeat failed before ${stage_name}."
    return 1
  fi

  if ! "$@"; then
    failure_reason="Backup runner stage failed: ${stage_name}."
    return 1
  fi

  if ! check_heartbeat; then
    failure_reason="Backup lease was lost during ${stage_name}."
    return 1
  fi

  return 0
}

start_heartbeat

if ! run_stage \
  "DATABASE AND AUTH BACKUP" \
  "$database_backup" \
  run \
  "$workspace"
then
  mark_failed "$failure_reason"
  exit 1
fi

if ! run_stage \
  "STORAGE BACKUP" \
  "$storage_backup" \
  run \
  "$workspace"
then
  mark_failed "$failure_reason"
  exit 1
fi

if ! run_stage \
  "ENCRYPTED PACKAGE" \
  "$package_backup" \
  run \
  "$workspace" \
  "$artifact_path"
then
  mark_failed "$failure_reason"
  exit 1
fi

if ! run_stage \
  "OFF-SITE UPLOAD" \
  "$upload_backup" \
  run \
  "$artifact_path"
then
  mark_failed "$failure_reason"
  exit 1
fi

echo
echo "=== COMPLETION CONTRACT ==="

if ! check_heartbeat; then
  failure_reason="Backup lease was lost before completion."
  mark_failed "$failure_reason"
  exit 1
fi

if [ ! -s "$artifact_path" ]; then
  failure_reason="Encrypted backup artifact is unavailable after upload."
  mark_failed "$failure_reason"
  exit 1
fi

if [ ! -s "$sidecar_path" ]; then
  failure_reason="Uploaded backup sidecar is unavailable."
  mark_failed "$failure_reason"
  exit 1
fi

if [ ! -s "$manifest_path" ]; then
  failure_reason="Backup manifest is unavailable at completion."
  mark_failed "$failure_reason"
  exit 1
fi

if ! jq -e '
  .encryption.tool == "age"
  and .encryption.encrypted == true
  and .offsite_uploaded == true
  and .offsite.remote_verified == true
  and .restore_verified == false
  and .coverage.database == true
  and .coverage.auth == true
  and .coverage.storage == true
  and .coverage.repository == true
  and .coverage.configuration_manifest == true
  and (
    .offsite.remote_path
    | type == "string"
  )
  and (
    .offsite.remote_path
    | length > 0
  )
  and (
    .artifact.bytes
    | type == "number"
  )
  and .artifact.bytes > 0
  and (
    .artifact.sha256
    | type == "string"
  )
  and (
    .artifact.sha256
    | test("^[0-9a-f]{64}$")
  )
' "$sidecar_path" >/dev/null
then
  failure_reason="Uploaded backup sidecar completion contract is invalid."
  mark_failed "$failure_reason"
  exit 1
fi

remote_artifact_path=""
artifact_bytes=""
artifact_sha256=""

if remote_artifact_path="$(
     jq -er \
       '.offsite.remote_path' \
       "$sidecar_path"
   )" &&
   artifact_bytes="$(
     jq -er \
       '.artifact.bytes' \
       "$sidecar_path"
   )" &&
   artifact_sha256="$(
     jq -er \
       '.artifact.sha256' \
       "$sidecar_path"
   )"
then
  :
else
  failure_reason="Unable to read validated backup completion metadata."

  mark_failed "$failure_reason"

  exit 1
fi

if ! heartbeat_once; then
  failure_reason="Backup lease heartbeat failed before final completion."
  mark_failed "$failure_reason"
  exit 1
fi

stop_heartbeat

completion_phase=true
completion_attempt=1
completion_max_attempts=3
completion_succeeded=false

while [ "$completion_attempt" -le "$completion_max_attempts" ]
do
  printf 'Completion attempt %s of %s...\n' \
    "$completion_attempt" \
    "$completion_max_attempts"

  if "$queue_client" \
       complete \
       "$job_id" \
       "$runner_id" \
       "$remote_artifact_path" \
       "$artifact_bytes" \
       "$artifact_sha256" \
       "$manifest_path"
  then
    completion_succeeded=true
    job_terminal=true
    completion_phase=false
    break
  fi

  if [ "$completion_attempt" -lt "$completion_max_attempts" ]
  then
    printf '%s\n' \
      "WARN: completion response unresolved; retrying exact request" \
      >&2

    sleep "$completion_attempt"
  fi

  completion_attempt=$((completion_attempt + 1))
done

if [ "$completion_succeeded" = true ]; then
  :
else
  printf '%s\n' \
    "ERROR: completion remains unresolved after bounded retries; job left for lease recovery" \
    >&2

  exit 1
fi

echo
echo "=== BACKUP WRITER RESULT ==="

echo "PASS: backup job completed successfully"
printf 'JOB_ID=%s\n' "$job_id"
printf 'REMOTE_ARTIFACT=%s\n' "$remote_artifact_path"
printf 'ARTIFACT_BYTES=%s\n' "$artifact_bytes"
printf 'ARTIFACT_SHA256=%s\n' "$artifact_sha256"

exit 0

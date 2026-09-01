#!/usr/bin/env bash

set -u

die() {
  printf 'ERROR: %s\n' "$1" >&2
  return 1
}

require_runtime() {
  [ -n "${SUPABASE_URL:-}" ] ||
    die "SUPABASE_URL is missing" ||
    return 1

  [ -n "${SUPABASE_SECRET_KEY:-}" ] ||
    die "SUPABASE_SECRET_KEY is missing" ||
    return 1

  case "$SUPABASE_URL" in
    https://*) ;;
    *)
      die "SUPABASE_URL must use HTTPS"
      return 1
      ;;
  esac

  case "$SUPABASE_SECRET_KEY" in
    sb_secret_*) ;;
    *)
      die "SUPABASE_SECRET_KEY must use sb_secret_ format"
      return 1
      ;;
  esac

  command -v curl >/dev/null 2>&1 ||
    die "curl is unavailable" ||
    return 1

  command -v jq >/dev/null 2>&1 ||
    die "jq is unavailable" ||
    return 1
}

valid_id() {
  value="$1"

  [ -n "$value" ] &&
    [ "${#value}" -le 128 ]
}

valid_uuid() {
  printf '%s\n' "$1" |
    grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
}

rpc() {
  function_name="$1"
  payload="$2"

  response_file="$(mktemp)" || return 1

  endpoint="${SUPABASE_URL%/}/rest/v1/rpc/${function_name}"

  status="$(
    curl --silent --show-error \
      --output "$response_file" \
      --write-out '%{http_code}' \
      --request POST \
      --header "apikey: ${SUPABASE_SECRET_KEY}" \
      --header "Content-Type: application/json" \
      --header "Accept: application/json" \
      --data "$payload" \
      "$endpoint"
  )"

  curl_rc=$?

  if [ "$curl_rc" -ne 0 ]; then
    rm -f "$response_file"
    die "Supabase RPC transport failed"
    return 1
  fi

  case "$status" in
    2??)
      cat "$response_file"
      rm -f "$response_file"
      ;;
    *)
      message="$(
        jq -r '.message // .details // .hint // .code // empty' \
          "$response_file" 2>/dev/null
      )"

      rm -f "$response_file"

      if [ -n "$message" ]; then
        printf 'ERROR: Supabase RPC HTTP %s: %s\n' \
          "$status" "$message" >&2
      else
        printf 'ERROR: Supabase RPC HTTP %s\n' \
          "$status" >&2
      fi

      return 1
      ;;
  esac
}

expect_true() {
  response="$1"
  label="$2"

  if [ "$(printf '%s' "$response" | jq -r '.')" != "true" ]; then
    die "$label was rejected"
    return 1
  fi
}

claim_restore() {
  verifier_id="$1"

  valid_id "$verifier_id" ||
    die "restore verifier identifier is invalid" ||
    return 1

  payload="$(
    jq -cn --arg id "$verifier_id" \
      '{p_verifier_id:$id}'
  )" || return 1

  response="$(
    rpc claim_admin_backup_restore "$payload"
  )" || return 1

  printf '%s' "$response" |
    jq -e '
      . == null
      or (
        type == "object"
        and (.job_id | type == "string")
        and (
          .job_id |
          test(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
          )
        )
        and (.artifact_path | type == "string")
        and (.artifact_path | length > 0)
        and (.artifact_bytes | type == "number")
        and .artifact_bytes > 0
        and (.checksum_sha256 | type == "string")
        and (.checksum_sha256 | test("^[0-9a-f]{64}$"))
        and (.restore_attempt_count | type == "number")
        and .restore_attempt_count >= 1
      )
    ' >/dev/null ||
    die "restore claim returned an invalid contract" ||
    return 1

  printf '%s\n' "$response"
}

heartbeat_restore() {
  job_id="$1"
  verifier_id="$2"

  valid_uuid "$job_id" ||
    die "backup job identifier is invalid" ||
    return 1

  valid_id "$verifier_id" ||
    die "restore verifier identifier is invalid" ||
    return 1

  payload="$(
    jq -cn \
      --arg job "$job_id" \
      --arg verifier "$verifier_id" \
      '{p_job_id:$job,p_verifier_id:$verifier}'
  )" || return 1

  response="$(
    rpc heartbeat_admin_backup_restore "$payload"
  )" || return 1

  expect_true "$response" "restore verifier heartbeat"
}

release_restore() {
  job_id="$1"
  verifier_id="$2"
  reason="$3"

  valid_uuid "$job_id" ||
    die "backup job identifier is invalid" ||
    return 1

  valid_id "$verifier_id" ||
    die "restore verifier identifier is invalid" ||
    return 1

  [ -n "$reason" ] ||
    die "restore release reason is required" ||
    return 1

  [ "${#reason}" -le 1000 ] ||
    die "restore release reason exceeds 1000 characters" ||
    return 1

  payload="$(
    jq -cn \
      --arg job "$job_id" \
      --arg verifier "$verifier_id" \
      --arg reason "$reason" \
      '{p_job_id:$job,p_verifier_id:$verifier,p_reason:$reason}'
  )" || return 1

  response="$(
    rpc release_admin_backup_restore "$payload"
  )" || return 1

  expect_true "$response" "restore verifier release"
}

verify_restore() {
  job_id="$1"
  verifier_id="$2"
  evidence_file="$3"

  valid_uuid "$job_id" ||
    die "backup job identifier is invalid" ||
    return 1

  valid_id "$verifier_id" ||
    die "restore verifier identifier is invalid" ||
    return 1

  [ -s "$evidence_file" ] ||
    die "restore verification evidence is unavailable" ||
    return 1

  evidence="$(
    jq -ce '
      select(
        .checksum_verified == true
        and .decryption_verified == true
        and .database_restore == true
        and .auth_restore == true
        and .storage_restore == true
        and .repository_available == true
        and .configuration_manifest_valid == true
      )
    ' "$evidence_file"
  )" ||
    die "restore verification evidence is incomplete" ||
    return 1

  payload="$(
    jq -cn \
      --arg job "$job_id" \
      --arg verifier "$verifier_id" \
      --argjson evidence "$evidence" \
      '{
        p_job_id:$job,
        p_verifier_id:$verifier,
        p_verified:true,
        p_verification:$evidence,
        p_notes:null
      }'
  )" || return 1

  response="$(
    rpc verify_admin_backup_restore "$payload"
  )" || return 1

  expect_true "$response" "restore verification finalization"
}

fail_restore() {
  job_id="$1"
  verifier_id="$2"
  notes="$3"

  valid_uuid "$job_id" ||
    die "backup job identifier is invalid" ||
    return 1

  valid_id "$verifier_id" ||
    die "restore verifier identifier is invalid" ||
    return 1

  [ -n "$notes" ] ||
    die "failed verification notes are required" ||
    return 1

  [ "${#notes}" -le 4000 ] ||
    die "failed verification notes exceed 4000 characters" ||
    return 1

  payload="$(
    jq -cn \
      --arg job "$job_id" \
      --arg verifier "$verifier_id" \
      --arg notes "$notes" \
      '{
        p_job_id:$job,
        p_verifier_id:$verifier,
        p_verified:false,
        p_verification:{},
        p_notes:$notes
      }'
  )" || return 1

  response="$(
    rpc verify_admin_backup_restore "$payload"
  )" || return 1

  expect_true "$response" "failed restore verification finalization"
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  restore-control-client.sh claim VERIFIER_ID
  restore-control-client.sh heartbeat JOB_ID VERIFIER_ID
  restore-control-client.sh release JOB_ID VERIFIER_ID REASON
  restore-control-client.sh verify JOB_ID VERIFIER_ID EVIDENCE_FILE
  restore-control-client.sh fail JOB_ID VERIFIER_ID NOTES
USAGE
}

main() {
  require_runtime || return 1

  command_name="${1:-}"

  case "$command_name" in
    claim)
      [ "$#" -eq 2 ] || { usage; return 2; }
      claim_restore "$2"
      ;;
    heartbeat)
      [ "$#" -eq 3 ] || { usage; return 2; }
      heartbeat_restore "$2" "$3"
      ;;
    release)
      [ "$#" -eq 4 ] || { usage; return 2; }
      release_restore "$2" "$3" "$4"
      ;;
    verify)
      [ "$#" -eq 4 ] || { usage; return 2; }
      verify_restore "$2" "$3" "$4"
      ;;
    fail)
      [ "$#" -eq 4 ] || { usage; return 2; }
      fail_restore "$2" "$3" "$4"
      ;;
    *)
      usage
      return 2
      ;;
  esac
}

main "$@"

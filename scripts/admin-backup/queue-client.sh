#!/usr/bin/env bash

set -u

require_env() {
  name="$1"

  if [ -z "${!name:-}" ]; then
    printf 'ERROR: required environment variable %s is missing\n' "$name" >&2
    return 1
  fi
}

require_command() {
  name="$1"

  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'ERROR: required command %s is unavailable\n' "$name" >&2
    return 1
  fi
}

validate_runtime() {
  require_env SUPABASE_URL || return 1
  require_env SUPABASE_SECRET_KEY || return 1

  require_command curl || return 1
  require_command jq || return 1

  case "$SUPABASE_URL" in
    https://*)
      ;;
    *)
      printf 'ERROR: SUPABASE_URL must use HTTPS\n' >&2
      return 1
      ;;
  esac

  case "$SUPABASE_SECRET_KEY" in
    sb_secret_*)
      ;;
    *)
      printf 'ERROR: SUPABASE_SECRET_KEY must use sb_secret_ format\n' >&2
      return 1
      ;;
  esac
}

rpc_post() {
  function_name="$1"
  payload="$2"

  response_file="$(mktemp)"
  trap 'rm -f "$response_file"' RETURN

  endpoint="${SUPABASE_URL%/}/rest/v1/rpc/${function_name}"

  http_status="$(
    curl \
      --silent \
      --show-error \
      --output "$response_file" \
      --write-out '%{http_code}' \
      --request POST \
      --header "apikey: ${SUPABASE_SECRET_KEY}" \
      --header "Content-Type: application/json" \
      --header "Accept: application/json" \
      --data "$payload" \
      "$endpoint"
  )"

  curl_status=$?

  if [ "$curl_status" -ne 0 ]; then
    printf 'ERROR: Supabase RPC transport failed\n' >&2
    return 1
  fi

  case "$http_status" in
    2??)
      cat "$response_file"
      ;;
    *)
      message="$(
        jq -r '
          .message //
          .details //
          .hint //
          .code //
          empty
        ' "$response_file" 2>/dev/null
      )"

      if [ -n "$message" ]; then
        printf 'ERROR: Supabase RPC failed with HTTP %s: %s\n' \
          "$http_status" \
          "$message" >&2
      else
        printf 'ERROR: Supabase RPC failed with HTTP %s\n' \
          "$http_status" >&2
      fi

      return 1
      ;;
  esac
}

claim_job() {
  runner_id="$1"

  if [ -z "$runner_id" ]; then
    printf 'ERROR: runner identifier is required\n' >&2
    return 1
  fi

  payload="$(
    jq -cn \
      --arg runner_id "$runner_id" \
      '{
        p_runner_id: $runner_id
      }'
  )"

  response="$(
    rpc_post \
      claim_admin_backup_job \
      "$payload"
  )" || return 1

  job_id="$(
    printf '%s' "$response" |
      jq -r '
        if . == null
        then ""
        else .
        end
      '
  )" || return 1

  printf '%s\n' "$job_id"
}

claim_detail_job() {
  runner_id="$1"

  if [ -z "$runner_id" ]; then
    printf 'ERROR: runner identifier is required\n' >&2
    return 1
  fi

  payload="$(
    jq -cn \
      --arg runner_id "$runner_id" \
      '{
        p_runner_id: $runner_id
      }'
  )" || return 1

  response="$(
    rpc_post \
      claim_admin_backup_job_detail \
      "$payload"
  )" || return 1

  if printf '%s' "$response" |
     jq -e '. == null' >/dev/null
  then
    printf 'null\n'
    return 0
  fi

  if ! printf '%s' "$response" |
       jq -e '
         type == "object"
         and (.job_id | type == "string")
         and (
           .job_id |
           test(
             "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
           )
         )
         and (.attempt_count | type == "number")
         and (.attempt_count | floor == .)
         and (.attempt_count >= 1)
         and (.attempt_count <= 20)
       ' >/dev/null
  then
    printf 'ERROR: detailed backup claim returned an invalid contract\n' >&2
    return 1
  fi

  printf '%s' "$response" |
    jq -c '{
      job_id: .job_id,
      attempt_count: .attempt_count
    }'
}

heartbeat_job() {
  job_id="$1"
  runner_id="$2"

  if [ -z "$job_id" ] || [ -z "$runner_id" ]; then
    printf 'ERROR: job and runner identifiers are required\n' >&2
    return 1
  fi

  payload="$(
    jq -cn \
      --arg job_id "$job_id" \
      --arg runner_id "$runner_id" \
      '{
        p_job_id: $job_id,
        p_runner_id: $runner_id
      }'
  )"

  response="$(
    rpc_post \
      heartbeat_admin_backup_job \
      "$payload"
  )" || return 1

  if [ "$(printf '%s' "$response" | jq -r '.')" != "true" ]; then
    printf 'ERROR: backup heartbeat was rejected\n' >&2
    return 1
  fi
}

complete_job() {
  job_id="$1"
  runner_id="$2"
  artifact_path="$3"
  artifact_bytes="$4"
  checksum_sha256="$5"
  manifest_file="$6"

  if [ -z "$job_id" ] ||
     [ -z "$runner_id" ] ||
     [ -z "$artifact_path" ]; then
    printf 'ERROR: completion identifiers and artifact path are required\n' >&2
    return 1
  fi

  case "$artifact_bytes" in
    ''|*[!0-9]*|0)
      printf 'ERROR: artifact size must be a positive integer\n' >&2
      return 1
      ;;
  esac

  if ! printf '%s' "$checksum_sha256" |
       grep -Eq '^[0-9a-fA-F]{64}$'; then
    printf 'ERROR: checksum must be a 64-character SHA-256 value\n' >&2
    return 1
  fi

  if [ ! -f "$manifest_file" ]; then
    printf 'ERROR: manifest file does not exist\n' >&2
    return 1
  fi

  manifest_json="$(
    jq -c . "$manifest_file"
  )" || {
    printf 'ERROR: manifest is not valid JSON\n' >&2
    return 1
  }

  payload="$(
    jq -cn \
      --arg job_id "$job_id" \
      --arg runner_id "$runner_id" \
      --arg artifact_path "$artifact_path" \
      --arg artifact_bytes "$artifact_bytes" \
      --arg checksum "$(printf '%s' "$checksum_sha256" | tr '[:upper:]' '[:lower:]')" \
      --argjson manifest "$manifest_json" \
      '{
        p_job_id: $job_id,
        p_runner_id: $runner_id,
        p_artifact_path: $artifact_path,
        p_artifact_bytes: ($artifact_bytes | tonumber),
        p_checksum_sha256: $checksum,
        p_manifest: $manifest
      }'
  )" || return 1

  response="$(
    rpc_post \
      complete_admin_backup_job \
      "$payload"
  )" || return 1

  if [ "$(printf '%s' "$response" | jq -r '.')" != "true" ]; then
    printf 'ERROR: backup completion was rejected\n' >&2
    return 1
  fi
}

fail_job() {
  job_id="$1"
  runner_id="$2"
  error_message="$3"

  if [ -z "$job_id" ] ||
     [ -z "$runner_id" ] ||
     [ -z "$error_message" ]; then
    printf 'ERROR: job, runner and failure reason are required\n' >&2
    return 1
  fi

  payload="$(
    jq -cn \
      --arg job_id "$job_id" \
      --arg runner_id "$runner_id" \
      --arg error_message "$error_message" \
      '{
        p_job_id: $job_id,
        p_runner_id: $runner_id,
        p_error_message: $error_message
      }'
  )"

  response="$(
    rpc_post \
      fail_admin_backup_job \
      "$payload"
  )" || return 1

  if [ "$(printf '%s' "$response" | jq -r '.')" != "true" ]; then
    printf 'ERROR: backup failure transition was rejected\n' >&2
    return 1
  fi
}

usage() {
  cat >&2 <<'EOF'
Usage:
  queue-client.sh claim RUNNER_ID
  queue-client.sh heartbeat JOB_ID RUNNER_ID
  queue-client.sh claim-detail RUNNER_ID
  queue-client.sh complete JOB_ID RUNNER_ID ARTIFACT_PATH ARTIFACT_BYTES SHA256 MANIFEST_FILE
  queue-client.sh fail JOB_ID RUNNER_ID ERROR_MESSAGE
EOF
}

main() {
  validate_runtime || return 1

  command_name="${1:-}"

  case "$command_name" in
    claim)
      [ "$#" -eq 2 ] || {
        usage
        return 2
      }

      claim_job "$2"
      ;;

    claim-detail)
      [ "$#" -eq 2 ] || {
        usage
        return 2
      }

      claim_detail_job "$2"
      ;;

    heartbeat)
      [ "$#" -eq 3 ] || {
        usage
        return 2
      }

      heartbeat_job "$2" "$3"
      ;;

    complete)
      [ "$#" -eq 7 ] || {
        usage
        return 2
      }

      complete_job \
        "$2" \
        "$3" \
        "$4" \
        "$5" \
        "$6" \
        "$7"
      ;;

    fail)
      [ "$#" -eq 4 ] || {
        usage
        return 2
      }

      fail_job "$2" "$3" "$4"
      ;;

    *)
      usage
      return 2
      ;;
  esac
}

main "$@"

#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  upload-backup.sh plan ARTIFACT_PATH
  upload-backup.sh run ARTIFACT_PATH
EOF
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
    sha256sum "$file" |
      awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" |
      awk '{print $1}'
    return
  fi

  printf 'ERROR: no SHA-256 utility is available\n' >&2
  return 1
}

mode="${1:-}"
artifact_path="${2:-}"

if [ -z "$mode" ] ||
   [ -z "$artifact_path" ]; then
  usage
  exit 2
fi

if [ "$mode" != "plan" ] &&
   [ "$mode" != "run" ]; then
  usage
  exit 2
fi

if [ "$mode" = "plan" ]; then
  cat <<'EOF'
1. Accept an encrypted .age artifact only.
2. Validate its local sidecar, byte size and SHA-256.
3. Require the destination to be separate from Supabase Storage.
4. Upload only the encrypted artifact.
5. Verify remote bytes with rclone check --download.
6. Create an upload-state sidecar with offsite_uploaded=true.
7. Upload and verify that sidecar.
8. Replace the local sidecar only after remote verification.
EOF
  exit 0
fi

require_env SUPABASE_STORAGE_S3_ENDPOINT

require_env BACKUP_S3_ENDPOINT
require_env BACKUP_S3_REGION
require_env BACKUP_S3_BUCKET
require_env BACKUP_S3_ACCESS_KEY_ID
require_env BACKUP_S3_SECRET_ACCESS_KEY

require_command rclone
require_command jq
require_command grep
require_command awk
require_command wc
require_command tr

if [ "${BACKUP_S3_ENDPOINT#https://}" = \
     "$BACKUP_S3_ENDPOINT" ]; then
  printf 'ERROR: off-site S3 endpoint must use HTTPS\n' >&2
  exit 1
fi

source_endpoint="${SUPABASE_STORAGE_S3_ENDPOINT%/}"
destination_endpoint="${BACKUP_S3_ENDPOINT%/}"

if [ "$source_endpoint" = "$destination_endpoint" ]; then
  printf 'ERROR: backup destination must be outside Supabase Storage\n' >&2
  exit 1
fi

if [ "${artifact_path%.age}" = "$artifact_path" ]; then
  printf 'ERROR: only an encrypted .age artifact may be uploaded\n' >&2
  exit 1
fi

if [ ! -f "$artifact_path" ] ||
   [ ! -s "$artifact_path" ]; then
  printf 'ERROR: encrypted artifact is missing or empty\n' >&2
  exit 1
fi

artifact_name="$(
  basename "$artifact_path"
)"

if ! printf '%s\n' "$artifact_name" |
     grep -Eq '^[A-Za-z0-9._-]+\.age$'; then
  printf 'ERROR: artifact filename contains unsafe characters\n' >&2
  exit 1
fi

sidecar_path="${artifact_path}.json"

if [ ! -f "$sidecar_path" ] ||
   [ ! -s "$sidecar_path" ]; then
  printf 'ERROR: encrypted artifact sidecar is missing\n' >&2
  exit 1
fi

if ! jq -e '
  .encryption.tool == "age"
  and .encryption.encrypted == true
  and .offsite_uploaded == false
  and .restore_verified == false
  and .coverage.database == true
  and .coverage.auth == true
  and .coverage.storage == true
  and .coverage.repository == true
  and .coverage.configuration_manifest == true
' "$sidecar_path" >/dev/null; then
  printf 'ERROR: artifact sidecar state is not uploadable\n' >&2
  exit 1
fi

recorded_name="$(
  jq -er '.artifact.name' "$sidecar_path"
)"

recorded_bytes="$(
  jq -er '.artifact.bytes' "$sidecar_path"
)"

recorded_sha256="$(
  jq -er '.artifact.sha256' "$sidecar_path"
)"

if [ "$recorded_name" != "$artifact_name" ]; then
  printf 'ERROR: artifact filename does not match sidecar\n' >&2
  exit 1
fi

if ! printf '%s\n' "$recorded_bytes" |
     grep -Eq '^[1-9][0-9]*$'; then
  printf 'ERROR: sidecar artifact byte count is invalid\n' >&2
  exit 1
fi

if ! printf '%s\n' "$recorded_sha256" |
     grep -Eq '^[0-9a-f]{64}$'; then
  printf 'ERROR: sidecar artifact SHA-256 is invalid\n' >&2
  exit 1
fi

actual_bytes="$(
  wc -c < "$artifact_path" |
    tr -d '[:space:]'
)"

actual_sha256="$(
  sha256_file "$artifact_path"
)"

if [ "$recorded_bytes" != "$actual_bytes" ]; then
  printf 'ERROR: artifact byte count does not match sidecar\n' >&2
  exit 1
fi

if [ "$recorded_sha256" != "$actual_sha256" ]; then
  printf 'ERROR: artifact SHA-256 does not match sidecar\n' >&2
  exit 1
fi

backup_prefix="${BACKUP_S3_PREFIX:-ridearrivo/admin-backups}"

if ! printf '%s\n' "$BACKUP_S3_BUCKET" |
     grep -Eq '^[A-Za-z0-9._-]+$'; then
  printf 'ERROR: backup bucket name contains unsafe characters\n' >&2
  exit 1
fi

if [ "$BACKUP_S3_BUCKET" = "." ] ||
   [ "$BACKUP_S3_BUCKET" = ".." ]; then
  printf 'ERROR: backup bucket name is unsafe\n' >&2
  exit 1
fi

if ! printf '%s\n' "$backup_prefix" |
     grep -Eq '^[A-Za-z0-9._/-]+$'; then
  printf 'ERROR: backup prefix contains unsafe characters\n' >&2
  exit 1
fi

if [ "${backup_prefix#/}" != "$backup_prefix" ] ||
   [ "${backup_prefix%/}" != "$backup_prefix" ]; then
  printf 'ERROR: backup prefix must not start or end with slash\n' >&2
  exit 1
fi

if printf '%s\n' "$backup_prefix" |
   grep -Eq '(^|/)\.\.?(/|$)|//'; then
  printf 'ERROR: backup prefix contains unsafe path segments\n' >&2
  exit 1
fi

export RCLONE_CONFIG_DST_TYPE="s3"
export RCLONE_CONFIG_DST_PROVIDER="Cloudflare"
export RCLONE_CONFIG_DST_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_DST_REGION="$BACKUP_S3_REGION"
export RCLONE_CONFIG_DST_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_DST_FORCE_PATH_STYLE="true"
export RCLONE_CONFIG_DST_NO_CHECK_BUCKET="true"

remote_base="dst:${BACKUP_S3_BUCKET}/${backup_prefix}"
remote_artifact="${remote_base}/${artifact_name}"
remote_sidecar="${remote_artifact}.json"

temporary_sidecar="$(
  mktemp
)"

existing_remote_sidecar="$(
  mktemp
)"

cleanup() {
  rm -f \
    "$temporary_sidecar" \
    "$existing_remote_sidecar"
}

trap cleanup EXIT

printf 'Uploading encrypted backup artifact...\n'

if ! rclone copyto \
  "$artifact_path" \
  "$remote_artifact" \
  --immutable \
  --check-first; then
  printf 'ERROR: encrypted artifact upload failed\n' >&2
  exit 1
fi

printf 'Verifying encrypted backup artifact remotely...\n'

if ! rclone check \
  "$artifact_path" \
  "$remote_artifact" \
  --download \
  --one-way; then
  printf 'ERROR: encrypted remote artifact verification failed\n' >&2
  exit 1
fi

expected_remote_path="${BACKUP_S3_BUCKET}/${backup_prefix}/${artifact_name}"

uploaded_at="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

jq \
  --arg uploaded_at "$uploaded_at" \
  --arg remote_path "$expected_remote_path" \
  '
    .offsite_uploaded = true
    | .offsite = {
        uploaded_at: $uploaded_at,
        remote_path: $remote_path,
        remote_verified: true
      }
  ' \
  "$sidecar_path" \
  > "$temporary_sidecar"

if ! jq -e '
  .encryption.encrypted == true
  and .offsite_uploaded == true
  and .offsite.remote_verified == true
  and .restore_verified == false
' "$temporary_sidecar" >/dev/null; then
  printf 'ERROR: generated upload sidecar is invalid\n' >&2
  exit 1
fi

printf 'Uploading backup artifact sidecar...\n'

sidecar_uploaded=true

if ! rclone copyto \
  "$temporary_sidecar" \
  "$remote_sidecar" \
  --immutable \
  --check-first; then
  sidecar_uploaded=false
fi

if [ "$sidecar_uploaded" = false ]; then
  printf 'Existing remote sidecar detected; validating retry state...\n'

  if rclone cat \
    "$remote_sidecar" \
    > "$existing_remote_sidecar" 2>/dev/null; then

    expected_coverage="$(
      jq -c '.coverage' "$sidecar_path"
    )"

    expected_manifest_sha="$(
      jq -r '.component_manifest_sha256 // ""' "$sidecar_path"
    )"

    if jq -e \
      --arg name "$artifact_name" \
      --arg sha "$actual_sha256" \
      --argjson bytes "$actual_bytes" \
      --arg remote_path "$expected_remote_path" \
      --argjson coverage "$expected_coverage" \
      --arg manifest_sha "$expected_manifest_sha" \
      '
        .artifact.name == $name
        and .artifact.bytes == $bytes
        and .artifact.sha256 == $sha
        and .encryption.tool == "age"
        and .encryption.encrypted == true
        and .coverage == $coverage
        and .offsite_uploaded == true
        and .offsite.remote_verified == true
        and .offsite.remote_path == $remote_path
        and (.offsite.uploaded_at | type == "string")
        and (.offsite.uploaded_at | length > 0)
        and .restore_verified == false
        and (
          $manifest_sha == ""
          or .component_manifest_sha256 == $manifest_sha
        )
      ' \
      "$existing_remote_sidecar" >/dev/null; then

      if rclone check \
        "$existing_remote_sidecar" \
        "$remote_sidecar" \
        --download \
        --one-way; then

        mv \
          "$existing_remote_sidecar" \
          "$sidecar_path"

        printf 'PASS: existing verified off-site sidecar accepted\n'
        printf 'REMOTE: %s\n' "$expected_remote_path"
        exit 0
      fi
    fi
  fi

  printf 'ERROR: existing remote sidecar does not match this backup\n' >&2
  exit 1
fi

if ! rclone check \
  "$temporary_sidecar" \
  "$remote_sidecar" \
  --download \
  --one-way; then
  printf 'ERROR: remote backup sidecar verification failed\n' >&2
  exit 1
fi

mv \
  "$temporary_sidecar" \
  "$sidecar_path"

printf 'PASS: encrypted backup uploaded and verified off-site\n'
printf 'REMOTE: %s\n' \
  "${BACKUP_S3_BUCKET}/${backup_prefix}/${artifact_name}"

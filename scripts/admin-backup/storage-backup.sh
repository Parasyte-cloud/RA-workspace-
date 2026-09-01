#!/usr/bin/env bash

set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  storage-backup.sh plan WORKSPACE_DIR
  storage-backup.sh run WORKSPACE_DIR
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

safe_bucket_name() {
  name="$1"

  if [ -z "$name" ] ||
     [ "$name" = "." ] ||
     [ "$name" = ".." ]; then
    return 1
  fi

  case "$name" in
    */*|*\\*)
      return 1
      ;;
  esac

  return 0
}

mode="${1:-}"
workspace="${2:-}"

if [ -z "$mode" ] || [ -z "$workspace" ]; then
  usage
  exit 2
fi

case "$mode" in
  plan|run)
    ;;
  *)
    usage
    exit 2
    ;;
esac

storage_dir="$workspace/components/storage"
metadata_dir="$workspace/metadata"
evidence_file="$metadata_dir/storage-backup.json"

if [ "$mode" = "plan" ]; then
  cat <<'EOF'
1. Configure a server-side rclone S3 remote.
2. Enumerate every Supabase Storage bucket.
3. Reject unsafe bucket names.
4. Copy every bucket into the recovery workspace.
5. Compare source/local object counts and bytes.
6. Run rclone check on each bucket.
7. Write storage-backup.json only after validation.
EOF
  exit 0
fi

require_env SUPABASE_STORAGE_S3_ENDPOINT
require_env SUPABASE_STORAGE_S3_REGION
require_env SUPABASE_STORAGE_S3_ACCESS_KEY_ID
require_env SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY

require_command rclone
require_command jq
require_command sort
require_command uniq
require_command grep
require_command sed

if [ "${SUPABASE_STORAGE_S3_ENDPOINT#https://}" = "$SUPABASE_STORAGE_S3_ENDPOINT" ]; then
  printf 'ERROR: Supabase Storage S3 endpoint must use HTTPS\n' >&2
  exit 1
fi

export RCLONE_CONFIG_SRC_TYPE="s3"
export RCLONE_CONFIG_SRC_PROVIDER="Other"
export RCLONE_CONFIG_SRC_ENDPOINT="$SUPABASE_STORAGE_S3_ENDPOINT"
export RCLONE_CONFIG_SRC_REGION="$SUPABASE_STORAGE_S3_REGION"
export RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$SUPABASE_STORAGE_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SRC_FORCE_PATH_STYLE="true"

rm -rf -- "$storage_dir"
mkdir -p "$storage_dir" "$metadata_dir"
rm -f "$evidence_file"

bucket_list="$(mktemp)"
bucket_records="$(mktemp)"
temporary_evidence="${evidence_file}.tmp"

cleanup() {
  rm -f \
    "$bucket_list" \
    "$bucket_records" \
    "$temporary_evidence"
}

trap cleanup EXIT

if ! rclone lsf \
  --dirs-only \
  src: \
  > "$bucket_list"; then
  printf 'ERROR: unable to enumerate Storage buckets\n' >&2
  exit 1
fi

normalized_list="${bucket_list}.normalized"

sed 's:/$::' "$bucket_list" |
  sed '/^[[:space:]]*$/d' |
  sort \
  > "$normalized_list"

mv "$normalized_list" "$bucket_list"

duplicates="$(
  uniq -d "$bucket_list"
)"

if [ -n "$duplicates" ]; then
  printf 'ERROR: duplicate bucket names returned\n' >&2
  exit 1
fi

bucket_count=0
object_count=0
total_bytes=0

while IFS= read -r bucket; do
  [ -n "$bucket" ] || continue

  if ! safe_bucket_name "$bucket"; then
    printf 'ERROR: unsafe bucket name rejected: %s\n' \
      "$bucket" >&2
    exit 1
  fi

  bucket_count=$((bucket_count + 1))

  local_bucket="$storage_dir/$bucket"
  source_bucket="src:$bucket"

  mkdir -p "$local_bucket"

  source_size="$(
    rclone size "$source_bucket" --json
  )"

  source_objects="$(
    printf '%s' "$source_size" |
      jq -er '.count'
  )"

  source_bytes="$(
    printf '%s' "$source_size" |
      jq -er '.bytes'
  )"

  if ! printf '%s\n' "$source_objects" |
       grep -Eq '^[0-9]+$'; then
    printf 'ERROR: invalid object count for %s\n' \
      "$bucket" >&2
    exit 1
  fi

  if ! printf '%s\n' "$source_bytes" |
       grep -Eq '^[0-9]+$'; then
    printf 'ERROR: invalid byte count for %s\n' \
      "$bucket" >&2
    exit 1
  fi

  if ! rclone copy \
    "$source_bucket" \
    "$local_bucket" \
    --fast-list \
    --transfers 4 \
    --checkers 8 \
    --timeout 30m; then
    printf 'ERROR: Storage copy failed for %s\n' \
      "$bucket" >&2
    exit 1
  fi

  local_size="$(
    rclone size "$local_bucket" --json
  )"

  local_objects="$(
    printf '%s' "$local_size" |
      jq -er '.count'
  )"

  local_bytes="$(
    printf '%s' "$local_size" |
      jq -er '.bytes'
  )"

  if [ "$source_objects" -ne "$local_objects" ]; then
    printf 'ERROR: object-count mismatch for %s\n' \
      "$bucket" >&2
    exit 1
  fi

  if [ "$source_bytes" -ne "$local_bytes" ]; then
    printf 'ERROR: byte-count mismatch for %s\n' \
      "$bucket" >&2
    exit 1
  fi

  if ! rclone check \
    "$source_bucket" \
    "$local_bucket" \
    --one-way; then
    printf 'ERROR: verification failed for %s\n' \
      "$bucket" >&2
    exit 1
  fi

  object_count=$((object_count + source_objects))
  total_bytes=$((total_bytes + source_bytes))

  jq -cn \
    --arg name "$bucket" \
    --argjson objects "$source_objects" \
    --argjson bytes "$source_bytes" \
    '{
      name: $name,
      objects: $objects,
      bytes: $bytes,
      copy_verified: true
    }' \
    >> "$bucket_records"

  printf 'PASS: Storage bucket %s copied and verified\n' \
    "$bucket"
done < "$bucket_list"

generated_at="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

if [ -s "$bucket_records" ]; then
  buckets_json="$(
    jq -s '.' "$bucket_records"
  )"
else
  buckets_json='[]'
fi

jq -n \
  --arg generated_at "$generated_at" \
  --argjson bucket_count "$bucket_count" \
  --argjson object_count "$object_count" \
  --argjson total_bytes "$total_bytes" \
  --argjson buckets "$buckets_json" \
  '{
    format_version: 1,
    generated_at: $generated_at,
    validated: true,
    copy_tool: "rclone",
    all_buckets_enumerated: true,
    all_objects_copied: true,
    bucket_count: $bucket_count,
    object_count: $object_count,
    total_bytes: $total_bytes,
    buckets: $buckets
  }' \
  > "$temporary_evidence"

mv "$temporary_evidence" "$evidence_file"

printf 'PASS: Storage backup evidence created\n'

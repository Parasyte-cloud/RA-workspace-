#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  verify-storage-restore.sh plan WORKSPACE_DIR OUTPUT_JSON
  verify-storage-restore.sh run WORKSPACE_DIR OUTPUT_JSON
EOF
}

require_command() {
  name="$1"

  if command -v "$name" >/dev/null 2>&1; then
    return 0
  fi

  printf 'ERROR: required command %s is unavailable\n' \
    "$name" >&2

  return 1
}

mode="${1:-}"
workspace="${2:-}"
output_json="${3:-}"

case "$mode" in
  plan|run)
    ;;
  *)
    usage
    exit 2
    ;;
esac

if [ -z "$workspace" ] ||
   [ -z "$output_json" ]; then
  usage
  exit 2
fi

if [ "$mode" = "plan" ]; then
  cat <<'EOF'
1. Reject production and backup-writer credentials.
2. Validate storage-backup.json semantically.
3. Verify artifact bucket directories match declared buckets.
4. Verify artifact object counts and bytes match declared evidence.
5. Start a disposable S3-compatible target on loopback only.
6. Explicitly create every bucket, including empty buckets.
7. Restore every object into the disposable target.
8. Reconcile restored bucket inventory exactly.
9. Reconcile object paths, counts, and bytes for every bucket.
10. Verify restored object contents with rclone check --download.
11. Emit Storage-object restore evidence only after complete success.
12. Never contact production Supabase Storage.
EOF

  exit 0
fi

for forbidden in \
  SUPABASE_DB_URL \
  SUPABASE_SECRET_KEY \
  SUPABASE_STORAGE_S3_ENDPOINT \
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID \
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY \
  BACKUP_S3_ENDPOINT \
  BACKUP_S3_ACCESS_KEY_ID \
  BACKUP_S3_SECRET_ACCESS_KEY
do
  if printenv "$forbidden" >/dev/null 2>&1; then
    printf 'ERROR: forbidden Storage verifier credential is present: %s\n' \
      "$forbidden" >&2

    exit 1
  fi
done

for command_name in \
  bash \
  rclone \
  jq \
  python3 \
  grep \
  sed \
  sort \
  cmp \
  mktemp \
  lsof \
  wc \
  diff \
  date
do
  require_command "$command_name"
done

storage_dir="$workspace/components/storage"
storage_evidence="$workspace/metadata/storage-backup.json"

if [ -d "$storage_dir" ]; then
  :
else
  printf 'ERROR: Storage component directory is missing\n' >&2
  exit 1
fi

if [ -f "$storage_evidence" ] &&
   [ -s "$storage_evidence" ]; then
  :
else
  printf 'ERROR: storage-backup.json is missing or empty\n' >&2
  exit 1
fi

rm -f \
  "$output_json" \
  "${output_json}.partial.$$"

mkdir -p \
  "$(dirname "$output_json")"

echo "=== STORAGE EVIDENCE CONTRACT ==="

if jq -e '
  . as $root
  | .format_version == 1
  and .validated == true
  and .all_buckets_enumerated == true
  and .all_objects_copied == true
  and (.bucket_count | type == "number")
  and (.bucket_count | floor == .)
  and .bucket_count >= 0
  and (.object_count | type == "number")
  and (.object_count | floor == .)
  and .object_count >= 0
  and (.total_bytes | type == "number")
  and (.total_bytes | floor == .)
  and .total_bytes >= 0
  and (.buckets | type == "array")
  and ((.buckets | length) == .bucket_count)
  and all(
    .buckets[];
    type == "object"
    and (.name | type == "string")
    and (.name | length > 0)
    and (.name == "." | not)
    and (.name == ".." | not)
    and (.name | index("/") == null)
    and (.name | index("\\") == null)
    and (.objects | type == "number")
    and (.objects | floor == .)
    and .objects >= 0
    and (.bytes | type == "number")
    and (.bytes | floor == .)
    and .bytes >= 0
    and .copy_verified == true
  )
  and (
    ([.buckets[].name] | unique | length)
    == $root.bucket_count
  )
  and (
    ([.buckets[].objects] | add // 0)
    == $root.object_count
  )
  and (
    ([.buckets[].bytes] | add // 0)
    == $root.total_bytes
  )
' "$storage_evidence" >/dev/null
then
  echo "PASS: Storage backup evidence contract validated"
else
  echo "ERROR: Storage backup evidence contract is invalid" >&2
  exit 1
fi

echo
echo "=== ARTIFACT STORAGE STRUCTURE ==="

python3 - \
  "$storage_dir" \
  "$storage_evidence" <<'PY'
from pathlib import Path
import json
import sys

storage = Path(sys.argv[1])
evidence_file = Path(sys.argv[2])

evidence = json.loads(
    evidence_file.read_text()
)

expected = sorted(
    item["name"]
    for item in evidence["buckets"]
)

for name in expected:
    if any(
        ord(character) < 32 or ord(character) == 127
        for character in name
    ):
        raise SystemExit(
            "ERROR: Storage bucket name contains control characters"
        )

entries = list(
    storage.iterdir()
)

bad_entries = [
    entry.name
    for entry in entries
    if entry.is_symlink() or not entry.is_dir()
]

if bad_entries:
    raise SystemExit(
        "ERROR: unexpected non-bucket entry in components/storage: "
        + repr(sorted(bad_entries))
    )

actual = sorted(
    entry.name
    for entry in entries
)

if actual != expected:
    raise SystemExit(
        "ERROR: artifact bucket inventory differs from Storage evidence"
        + f"\nEXPECTED={expected!r}"
        + f"\nACTUAL={actual!r}"
    )

for bucket in entries:
    for entry in bucket.rglob("*"):
        if entry.is_symlink():
            raise SystemExit(
                "ERROR: symbolic link found in Storage artifact"
            )

        if not (
            entry.is_file()
            or entry.is_dir()
        ):
            raise SystemExit(
                "ERROR: unsupported filesystem entry in Storage artifact"
            )

print(
    "PASS: artifact bucket directories exactly match Storage evidence"
)
PY

temporary_root="$(
  mktemp -d
)"

rclone_config="$temporary_root/rclone.conf"

: > "$rclone_config"
chmod 600 "$rclone_config"

export RCLONE_CONFIG="$rclone_config"

target_storage="$temporary_root/target-storage"
server_log="$temporary_root/rclone-s3.log"
expected_buckets="$temporary_root/expected-buckets.txt"
restored_buckets="$temporary_root/restored-buckets.txt"
bucket_results="$temporary_root/bucket-results.jsonl"

server_pid=""

cleanup() {
  rm -f \
    "${output_json}.partial.$$"

  if [ -n "$server_pid" ]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi

  rm -rf \
    "$temporary_root"
}

trap cleanup EXIT

mkdir -p \
  "$target_storage"

jq -r \
  '.buckets[].name' \
  "$storage_evidence" |
  sort \
  > "$expected_buckets"

expected_bucket_count="$(
  jq -er \
    '.bucket_count' \
    "$storage_evidence"
)"

expected_object_count="$(
  jq -er \
    '.object_count' \
    "$storage_evidence"
)"

expected_total_bytes="$(
  jq -er \
    '.total_bytes' \
    "$storage_evidence"
)"

echo
echo "=== ARTIFACT OBJECT RECONCILIATION ==="

source_object_total=0
source_byte_total=0

while IFS= read -r bucket
do
  [ -n "$bucket" ] || continue

  source_bucket="$storage_dir/$bucket"

  source_size="$(
    rclone size \
      "$source_bucket" \
      --json
  )"

  source_objects="$(
    printf '%s' "$source_size" |
      jq -er '.count'
  )"

  source_bytes="$(
    printf '%s' "$source_size" |
      jq -er '.bytes'
  )"

  evidence_objects="$(
    jq -er \
      --arg name "$bucket" \
      '.buckets[]
       | select(.name == $name)
       | .objects' \
      "$storage_evidence"
  )"

  evidence_bytes="$(
    jq -er \
      --arg name "$bucket" \
      '.buckets[]
       | select(.name == $name)
       | .bytes' \
      "$storage_evidence"
  )"

  if [ "$source_objects" -eq "$evidence_objects" ] &&
     [ "$source_bytes" -eq "$evidence_bytes" ]; then
    printf 'PASS: artifact bucket %s matches declared count and bytes\n' \
      "$bucket"
  else
    printf 'ERROR: artifact bucket %s differs from declared evidence\n' \
      "$bucket" >&2

    exit 1
  fi

  source_object_total=$((source_object_total + source_objects))

  source_byte_total=$((source_byte_total + source_bytes))
done < "$expected_buckets"

if [ "$source_object_total" -eq "$expected_object_count" ] &&
   [ "$source_byte_total" -eq "$expected_total_bytes" ]; then
  echo "PASS: artifact Storage aggregate counts and bytes match evidence"
else
  echo "ERROR: artifact Storage aggregate totals differ from evidence" >&2
  exit 1
fi

port="$(
  python3 - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"

access_key="ridearrivo-restore-verifier"
secret_key="ridearrivo-restore-verifier-${RANDOM}-$$"

export RCLONE_CONFIG_R8DST_TYPE="s3"
export RCLONE_CONFIG_R8DST_PROVIDER="Other"
export RCLONE_CONFIG_R8DST_ACCESS_KEY_ID="$access_key"
export RCLONE_CONFIG_R8DST_SECRET_ACCESS_KEY="$secret_key"
export RCLONE_CONFIG_R8DST_ENDPOINT="http://127.0.0.1:$port"
export RCLONE_CONFIG_R8DST_REGION="us-east-1"
export RCLONE_CONFIG_R8DST_FORCE_PATH_STYLE="true"

echo
echo "=== START ISOLATED STORAGE RESTORE TARGET ==="

rclone serve s3 \
  "$target_storage" \
  --addr "127.0.0.1:$port" \
  --auth-key "$access_key,$secret_key" \
  --log-level ERROR \
  >"$server_log" 2>&1 &

server_pid="$!"

ready=0

for attempt in 1 2 3 4 5
do
  if kill -0 "$server_pid" >/dev/null 2>&1; then
    :
  else
    break
  fi

  if rclone lsf \
    r8dst: \
    --dirs-only \
    --contimeout 2s \
    --timeout 3s \
    --retries 1 \
    --low-level-retries 1 \
    >/dev/null 2>&1
  then
    ready=1
    break
  fi

  sleep 1
done

if [ "$ready" -eq 1 ]; then
  echo "PASS: isolated Storage restore target ready"
else
  echo "ERROR: isolated Storage restore target failed readiness" >&2

  cat \
    "$server_log" >&2

  exit 1
fi

echo
echo "=== RESTORE TARGET NETWORK ISOLATION ==="

listener="$(
  lsof \
    -nP \
    -iTCP:"$port" \
    -sTCP:LISTEN \
    2>/dev/null \
    || true
)"

if printf '%s\n' "$listener" |
     grep -qF "127.0.0.1:$port"
then
  echo "PASS: Storage restore target bound to loopback"
else
  echo "ERROR: Storage restore target is not bound to loopback" >&2
  exit 1
fi

if printf '%s\n' "$listener" |
     grep -Eq '\*:|0\.0\.0\.0:|\[::\]:'
then
  echo "ERROR: Storage restore target has wildcard listener" >&2
  exit 1
else
  echo "PASS: Storage restore target has no wildcard listener"
fi

echo
echo "=== RESTORE STORAGE BUCKETS AND OBJECTS ==="

while IFS= read -r bucket
do
  [ -n "$bucket" ] || continue

  rclone mkdir \
    "r8dst:$bucket" \
    --contimeout 2s \
    --timeout 5s \
    --retries 1 \
    --low-level-retries 1

  rclone copy \
    "$storage_dir/$bucket" \
    "r8dst:$bucket" \
    --fast-list \
    --contimeout 2s \
    --timeout 5s \
    --retries 1 \
    --low-level-retries 1

  printf 'PASS: restored Storage bucket %s\n' \
    "$bucket"
done < "$expected_buckets"

echo
echo "=== RESTORED BUCKET INVENTORY ==="

rclone lsf \
  r8dst: \
  --dirs-only \
  --contimeout 2s \
  --timeout 5s \
  --retries 1 \
  --low-level-retries 1 |
  sed 's:/$::' |
  sort \
  > "$restored_buckets"

if cmp -s \
  "$expected_buckets" \
  "$restored_buckets"
then
  echo "PASS: restored bucket inventory exactly matches artifact"
else
  echo "ERROR: restored bucket inventory differs from artifact" >&2

  diff -u \
    "$expected_buckets" \
    "$restored_buckets" \
    || true

  exit 1
fi

echo
echo "=== RESTORED OBJECT SEMANTIC PROOF ==="

restored_object_total=0
restored_byte_total=0
empty_bucket_count=0
bucket_index=0

while IFS= read -r bucket
do
  [ -n "$bucket" ] || continue

  bucket_index=$((bucket_index + 1))

  source_bucket="$storage_dir/$bucket"
  target_bucket="r8dst:$bucket"

  expected_objects="$(
    jq -er \
      --arg name "$bucket" \
      '.buckets[]
       | select(.name == $name)
       | .objects' \
      "$storage_evidence"
  )"

  expected_bytes="$(
    jq -er \
      --arg name "$bucket" \
      '.buckets[]
       | select(.name == $name)
       | .bytes' \
      "$storage_evidence"
  )"

  target_size="$(
    rclone size \
      "$target_bucket" \
      --json \
      --contimeout 2s \
      --timeout 5s \
      --retries 1 \
      --low-level-retries 1
  )"

  target_objects="$(
    printf '%s' "$target_size" |
      jq -er '.count'
  )"

  target_bytes="$(
    printf '%s' "$target_size" |
      jq -er '.bytes'
  )"

  if [ "$target_objects" -eq "$expected_objects" ] &&
     [ "$target_bytes" -eq "$expected_bytes" ]; then
    printf 'PASS: restored bucket %s count and bytes match evidence\n' \
      "$bucket"
  else
    printf 'ERROR: restored bucket %s count or bytes differ from evidence\n' \
      "$bucket" >&2

    exit 1
  fi

  if [ "$expected_objects" -eq 0 ]; then
    if [ "$target_objects" -eq 0 ] &&
       [ "$target_bytes" -eq 0 ]; then
      empty_bucket_count=$((empty_bucket_count + 1))

      printf 'PASS: empty Storage bucket %s preserved\n' \
        "$bucket"
    else
      printf 'ERROR: empty Storage bucket %s was not preserved\n' \
        "$bucket" >&2

      exit 1
    fi
  fi

  source_inventory="$temporary_root/source-${bucket_index}.json"
  target_inventory="$temporary_root/target-${bucket_index}.json"

  source_normalized="$temporary_root/source-${bucket_index}-normalized.json"
  target_normalized="$temporary_root/target-${bucket_index}-normalized.json"

  rclone lsjson \
    "$source_bucket" \
    --recursive \
    --files-only \
    > "$source_inventory"

  rclone lsjson \
    "$target_bucket" \
    --recursive \
    --files-only \
    --contimeout 2s \
    --timeout 5s \
    --retries 1 \
    --low-level-retries 1 \
    > "$target_inventory"

  jq \
    '[.[] | {Path, Size}] | sort_by(.Path)' \
    "$source_inventory" \
    > "$source_normalized"

  jq \
    '[.[] | {Path, Size}] | sort_by(.Path)' \
    "$target_inventory" \
    > "$target_normalized"

  if cmp -s \
    "$source_normalized" \
    "$target_normalized"
  then
    printf 'PASS: restored bucket %s object inventory exactly matches artifact\n' \
      "$bucket"
  else
    printf 'ERROR: restored bucket %s object inventory differs from artifact\n' \
      "$bucket" >&2

    diff -u \
      "$source_normalized" \
      "$target_normalized" \
      || true

    exit 1
  fi

  if rclone check \
    "$source_bucket" \
    "$target_bucket" \
    --download \
    --contimeout 2s \
    --timeout 5s \
    --retries 1 \
    --low-level-retries 1
  then
    printf 'PASS: restored bucket %s object bytes exactly match artifact\n' \
      "$bucket"
  else
    printf 'ERROR: restored bucket %s byte verification failed\n' \
      "$bucket" >&2

    exit 1
  fi

  restored_object_total=$((restored_object_total + target_objects))

  restored_byte_total=$((restored_byte_total + target_bytes))

  jq -cn \
    --arg name "$bucket" \
    --argjson objects "$target_objects" \
    --argjson bytes "$target_bytes" \
    '{
      name: $name,
      objects: $objects,
      bytes: $bytes,
      inventory_verified: true,
      content_verified: true
    }' \
    >> "$bucket_results"
done < "$expected_buckets"

echo
echo "=== RESTORED STORAGE AGGREGATES ==="

if [ "$restored_object_total" -eq "$expected_object_count" ] &&
   [ "$restored_byte_total" -eq "$expected_total_bytes" ]; then
  echo "PASS: restored Storage aggregate counts and bytes match artifact"
else
  echo "ERROR: restored Storage aggregate totals differ from artifact" >&2
  exit 1
fi

actual_bucket_count="$(
  wc -l \
    < "$restored_buckets" |
    tr -d '[:space:]'
)"

if [ "$actual_bucket_count" -eq "$expected_bucket_count" ]; then
  echo "PASS: restored Storage bucket count matches evidence"
else
  echo "ERROR: restored Storage bucket count differs from evidence" >&2
  exit 1
fi

echo
echo "=== ISOLATED SERVER FINAL HEALTH ==="

if kill -0 "$server_pid" >/dev/null 2>&1; then
  echo "PASS: isolated Storage restore server remained alive"
else
  echo "ERROR: isolated Storage restore server exited unexpectedly" >&2
  exit 1
fi

if grep -E \
  'CRITICAL|Failed to create file system' \
  "$server_log"
then
  echo "ERROR: isolated Storage server reported fatal error" >&2
  exit 1
else
  echo "PASS: isolated Storage server reported no fatal error"
fi

echo
echo "=== WRITE STORAGE RESTORE EVIDENCE ==="

if [ -s "$bucket_results" ]; then
  restored_buckets_json="$(
    jq -s '.' \
      "$bucket_results"
  )"
else
  restored_buckets_json='[]'
fi

verified_at="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

rclone_version="$(
  rclone version |
    sed -n '1p'
)"

jq -n \
  --arg verified_at "$verified_at" \
  --arg verifier_version "$rclone_version" \
  --argjson bucket_count "$expected_bucket_count" \
  --argjson object_count "$expected_object_count" \
  --argjson total_bytes "$expected_total_bytes" \
  --argjson empty_bucket_count "$empty_bucket_count" \
  --argjson buckets "$restored_buckets_json" \
  '{
    format_version: 1,
    verified_at: $verified_at,
    validated: true,
    verifier: "rclone-loopback-s3",
    verifier_version: $verifier_version,
    isolated_target: {
      loopback_only: true,
      wildcard_listener: false
    },
    bucket_inventory_exact: true,
    object_inventory_exact: true,
    object_counts_verified: true,
    byte_counts_verified: true,
    object_content_verified: true,
    empty_bucket_preservation_verified: true,
    bucket_count: $bucket_count,
    empty_bucket_count: $empty_bucket_count,
    object_count: $object_count,
    total_bytes: $total_bytes,
    buckets: $buckets,
    storage_object_restore_verified: true,
    production_storage_contacted: false
  }' \
  > "${output_json}.partial.$$"

if jq -e '
  .format_version == 1
  and .validated == true
  and .isolated_target.loopback_only == true
  and .isolated_target.wildcard_listener == false
  and .bucket_inventory_exact == true
  and .object_inventory_exact == true
  and .object_counts_verified == true
  and .byte_counts_verified == true
  and .object_content_verified == true
  and .empty_bucket_preservation_verified == true
  and .storage_object_restore_verified == true
  and .production_storage_contacted == false
' "${output_json}.partial.$$" >/dev/null
then
  echo "PASS: Storage restore evidence is internally valid"
else
  echo "ERROR: generated Storage restore evidence is invalid" >&2
  exit 1
fi

mv \
  "${output_json}.partial.$$" \
  "$output_json"

echo
echo "=== STORAGE OBJECT RESTORE RESULT ==="

echo "PASS: isolated Storage object restore verified"

printf 'EVIDENCE: %s\n' \
  "$output_json"

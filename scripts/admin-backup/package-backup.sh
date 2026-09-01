#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  package-backup.sh plan WORKSPACE_DIR ARTIFACT_PATH
  package-backup.sh run WORKSPACE_DIR ARTIFACT_PATH
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
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  printf 'ERROR: no SHA-256 utility is available\n' >&2
  return 1
}

mode="${1:-}"
workspace="${2:-}"
artifact_path="${3:-}"

if [ -z "$mode" ] ||
   [ -z "$workspace" ] ||
   [ -z "$artifact_path" ]; then
  usage
  exit 2
fi

if [ "$mode" != "plan" ] && [ "$mode" != "run" ]; then
  usage
  exit 2
fi

if [ "$mode" = "plan" ]; then
  cat <<'EOF'
1. Refresh and validate the component manifest.
2. Require full Database/Auth/Storage/Repository/Configuration coverage.
3. Stream components, metadata and manifest directly from tar into age.
4. Never create a plaintext tar archive on disk.
5. Hash the encrypted artifact.
6. Write a non-secret artifact sidecar.
7. Keep offsite_uploaded and restore_verified false.
EOF
  exit 0
fi

require_env BACKUP_AGE_RECIPIENT

require_command age
require_command tar
require_command jq
require_command node
require_command awk
require_command wc
require_command grep

if [ -n "${BACKUP_AGE_PRIVATE_KEY:-}" ] ||
   [ -n "${BACKUP_AGE_IDENTITY:-}" ] ||
   [ -n "${AGE_SECRET_KEY:-}" ] ||
   [ -n "${AGE_IDENTITY:-}" ]; then
  printf 'ERROR: normal backup worker must not possess an age private identity\n' >&2
  exit 1
fi

if ! printf '%s\n' "$BACKUP_AGE_RECIPIENT" |
     grep -Eq '^(age1|age-plugin-)'; then
  printf 'ERROR: BACKUP_AGE_RECIPIENT format is not accepted\n' >&2
  exit 1
fi

if ! printf '%s\n' "$artifact_path" |
     grep -Eq '\.age$'; then
  printf 'ERROR: encrypted artifact path must end in .age\n' >&2
  exit 1
fi

if [ ! -d "$workspace" ]; then
  printf 'ERROR: backup workspace does not exist\n' >&2
  exit 1
fi

script_dir="$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd
)"

manifest_builder="$script_dir/build-manifest.mjs"

if [ ! -f "$manifest_builder" ]; then
  printf 'ERROR: manifest builder is unavailable\n' >&2
  exit 1
fi

node \
  "$manifest_builder" \
  "$workspace" \
  >/dev/null

manifest_path="$workspace/manifest.json"
checksum_path="$workspace/metadata/component-checksums.sha256"

if [ ! -s "$manifest_path" ]; then
  printf 'ERROR: component manifest was not created\n' >&2
  exit 1
fi

if [ ! -s "$checksum_path" ]; then
  printf 'ERROR: component checksum inventory was not created\n' >&2
  exit 1
fi

if ! jq -e '
  .coverage.database == true
  and .coverage.auth == true
  and .coverage.storage == true
  and .coverage.repository == true
  and .coverage.configuration_manifest == true
' "$manifest_path" >/dev/null; then
  printf 'ERROR: recovery coverage is incomplete\n' >&2
  exit 1
fi

if ! jq -e '
  .archive_encrypted == false
  and .offsite_uploaded == false
  and .restore_verified == false
' "$manifest_path" >/dev/null; then
  printf 'ERROR: component manifest has an invalid pre-package state\n' >&2
  exit 1
fi

artifact_dir="$(dirname "$artifact_path")"
mkdir -p "$artifact_dir"

temporary_artifact="${artifact_path}.partial.$$"
sidecar_path="${artifact_path}.json"
temporary_sidecar="${sidecar_path}.partial.$$"

cleanup() {
  rm -f \
    "$temporary_artifact" \
    "$temporary_sidecar"
}

trap cleanup EXIT

rm -f \
  "$artifact_path" \
  "$sidecar_path"

if ! (
  cd "$workspace"

  tar -cf - \
    components \
    metadata \
    manifest.json
) | age \
      -r "$BACKUP_AGE_RECIPIENT" \
      -o "$temporary_artifact"; then
  printf 'ERROR: backup encryption failed\n' >&2
  exit 1
fi

if [ ! -s "$temporary_artifact" ]; then
  printf 'ERROR: encrypted artifact is missing or empty\n' >&2
  exit 1
fi

chmod 600 "$temporary_artifact"

mv \
  "$temporary_artifact" \
  "$artifact_path"

artifact_bytes="$(
  wc -c < "$artifact_path" |
    tr -d '[:space:]'
)"

artifact_sha256="$(
  sha256_file "$artifact_path"
)"

manifest_sha256="$(
  sha256_file "$manifest_path"
)"

generated_at="$(
  date -u '+%Y-%m-%dT%H:%M:%SZ'
)"

coverage="$(
  jq -c '.coverage' "$manifest_path"
)"

jq -n \
  --arg generated_at "$generated_at" \
  --arg artifact_name "$(basename "$artifact_path")" \
  --arg artifact_sha256 "$artifact_sha256" \
  --arg manifest_sha256 "$manifest_sha256" \
  --argjson artifact_bytes "$artifact_bytes" \
  --argjson coverage "$coverage" \
  '{
    format_version: 1,
    generated_at: $generated_at,
    artifact: {
      name: $artifact_name,
      bytes: $artifact_bytes,
      sha256: $artifact_sha256
    },
    component_manifest_sha256: $manifest_sha256,
    encryption: {
      tool: "age",
      encrypted: true
    },
    coverage: $coverage,
    offsite_uploaded: false,
    restore_verified: false
  }' \
  > "$temporary_sidecar"

mv \
  "$temporary_sidecar" \
  "$sidecar_path"

printf 'PASS: encrypted backup artifact created\n'
printf 'ARTIFACT: %s\n' "$artifact_path"
printf 'BYTES: %s\n' "$artifact_bytes"
printf 'SHA256: %s\n' "$artifact_sha256"

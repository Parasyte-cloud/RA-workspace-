#!/usr/bin/env bash

set -euo pipefail

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

fake_bin="$(mktemp -d)"
workspace_root="$(mktemp -d)"
artifact_root="$(mktemp -d)"
identity="$artifact_root/identity.txt"
failures=0

cleanup() {
  rm -rf \
    "$fake_bin" \
    "$workspace_root" \
    "$artifact_root"
}

trap cleanup EXIT

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
  failures=$((failures + 1))
}

sha256_file() {
  file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" |
      awk '{print $1}'
  else
    shasum -a 256 "$file" |
      awk '{print $1}'
  fi
}

build_workspace() {
  root="$1"

  mkdir -p \
    "$root/components/database" \
    "$root/components/storage/bucket-a" \
    "$root/metadata"

  printf '%s\n' \
    '-- synthetic roles' \
    'CREATE ROLE synthetic_restore_role;' \
    > "$root/components/database/roles.sql"

  printf '%s\n' \
    '-- synthetic schema' \
    'CREATE TABLE public.synthetic_restore (id uuid);' \
    > "$root/components/database/schema.sql"

  cat > "$root/components/database/data.sql" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
\.
COPY "auth"."identities" ("id") FROM stdin;
\.
COPY "public"."synthetic_restore" ("id") FROM stdin;
\.
COPY "public"."employee_profiles" ("id") FROM stdin;
\.
COPY "storage"."buckets" ("id") FROM stdin;
\.
COPY "storage"."objects" ("id") FROM stdin;
\.
COPY "supabase_functions"."hooks" ("id") FROM stdin;
\.
SQL

cat > "$root/components/database/auth-data.sql" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
\.
COPY "auth"."identities" ("id") FROM stdin;
\.
SQL


for section_file in \
  auth-pre.sql \
  auth-post.sql \
  storage-pre.sql \
  storage-post.sql \
  supabase-functions-pre.sql \
  supabase-functions-post.sql \
  public-pre.sql \
  public-post.sql
do
  printf '%s\n' \
    "-- synthetic managed schema section: $section_file" \
    > "$root/components/database/$section_file"
done

  printf '%s\n' \
    'synthetic storage object' \
    > "$root/components/storage/bucket-a/object.txt"

  cat > "$root/metadata/database-backup.json" <<'JSON'
{
  "format_version": 1,
  "validated": true,
  "roles_dump": true,
  "schema_dump": true,
  "data_dump": true,
  "auth_dump": true,
  "sectioned_schema_dump": true,
  "sectioned_schema": {
    "validated": true,
    "dump_tool": "pg_dump",
    "postgres_version": "17.6",
    "container_image": "supabase/postgres:17.6.1.165",
    "files": [
      "auth-pre.sql",
      "auth-post.sql",
      "storage-pre.sql",
      "storage-post.sql",
      "supabase-functions-pre.sql",
      "supabase-functions-post.sql",
      "public-pre.sql",
      "public-post.sql"
    ]
  },
  "reconciliation_ledger": {
    "validated": true,
    "file": "database-reconciliation.json",
    "source_component": "database/data.sql",
    "algorithm": "sha256-schema-table-columns-sorted-copy-lines-v1"
  },
  "auth_recovery_data": true
}
JSON

  node \
    "$repo/scripts/admin-backup/build-database-reconciliation.mjs" \
    "$root/components/database/data.sql" \
    "$root/metadata/database-reconciliation.json" \
    >/dev/null

  echo "PASS: database semantic reconciliation ledger fixture created"

  cat > "$root/metadata/storage-backup.json" <<'JSON'
{
  "format_version": 1,
  "validated": true,
  "all_buckets_enumerated": true,
  "all_objects_copied": true,
  "bucket_count": 1,
  "object_count": 1,
  "total_bytes": 25,
  "buckets": [
    {
      "name": "bucket-a",
      "objects": 1,
      "bytes": 25,
      "copy_verified": true
    }
  ]
}
JSON

  node \
    "$repo/scripts/admin-backup/build-manifest.mjs" \
    "$root" \
    >/dev/null
}

make_artifact() {
  root="$1"
  artifact="$2"

  (
    cd "$root"

    tar -cf "$artifact" \
      components \
      metadata \
      manifest.json
  )
}

make_sidecar() {
  root="$1"
  artifact="$2"

  name="$(basename "$artifact")"
  artifact_sha="$(sha256_file "$artifact")"
  manifest_sha="$(sha256_file "$root/manifest.json")"

  artifact_bytes="$(
    wc -c < "$artifact" |
      tr -d '[:space:]'
  )"

  jq -n \
    --arg name "$name" \
    --arg artifact_sha "$artifact_sha" \
    --arg manifest_sha "$manifest_sha" \
    --argjson artifact_bytes "$artifact_bytes" \
    '{
      format_version: 1,
      artifact: {
        name: $name,
        bytes: $artifact_bytes,
        sha256: $artifact_sha
      },
      component_manifest_sha256: $manifest_sha,
      encryption: {
        tool: "age",
        encrypted: true
      },
      coverage: {
        database: true,
        auth: true,
        storage: true,
        repository: true,
        configuration_manifest: true
      },
      offsite_uploaded: true,
      offsite: {
        uploaded_at: "2026-08-30T20:00:00Z",
        remote_path: ("offline/" + $name),
        remote_verified: true
      },
      restore_verified: false
    }' \
    > "$artifact.json"
}

run_verifier() {
  artifact="$1"
  evidence="$2"

  env \
    -u SUPABASE_DB_URL \
    -u SUPABASE_SECRET_KEY \
    -u SUPABASE_STORAGE_S3_ACCESS_KEY_ID \
    -u SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY \
    -u BACKUP_S3_ACCESS_KEY_ID \
    -u BACKUP_S3_SECRET_ACCESS_KEY \
    -u BACKUP_AGE_PRIVATE_KEY \
    -u AGE_SECRET_KEY \
    PATH="$fake_bin:$PATH" \
    BACKUP_AGE_IDENTITY_FILE="$identity" \
    "$repo/scripts/admin-backup/verify-backup-artifact.sh" \
    run \
    "$artifact" \
    "$evidence"
}

cat > "$fake_bin/age" <<'FAKE'
#!/usr/bin/env bash
set -eu

output=""
input=""
identity=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --decrypt)
      shift
      ;;

    --identity)
      identity="${2:-}"
      shift 2
      ;;

    --output)
      output="${2:-}"
      shift 2
      ;;

    *)
      input="$1"
      shift
      ;;
  esac
done

[ -s "$identity" ] || exit 3
[ -n "$output" ] || exit 4
[ -n "$input" ] || exit 5

cp "$input" "$output"
FAKE

chmod +x "$fake_bin/age"

printf '%s\n' \
  'synthetic offline identity' \
  > "$identity"

chmod 600 "$identity"

echo "=== ARCHIVE TRAVERSAL ATTACK ==="

traversal_root="$workspace_root/traversal"
traversal_artifact="$artifact_root/traversal.age"
traversal_evidence="$artifact_root/traversal-evidence.json"

build_workspace "$traversal_root"
make_artifact "$traversal_root" "$traversal_artifact"

python3 - \
  "$traversal_artifact" <<'PY'
from io import BytesIO
from pathlib import Path
import tarfile
import sys

artifact = Path(sys.argv[1])

payload = b"must never be extracted\n"

with tarfile.open(artifact, "a") as archive:
    info = tarfile.TarInfo(
        name="../ridearrivo-r8-traversal-sentinel"
    )
    info.size = len(payload)
    info.mode = 0o600

    archive.addfile(
        info,
        BytesIO(payload),
    )
PY

make_sidecar \
  "$traversal_root" \
  "$traversal_artifact"

if run_verifier \
  "$traversal_artifact" \
  "$traversal_evidence" \
  >/tmp/r8-traversal.log 2>&1
then
  fail "archive traversal attack was accepted"
else
  pass "archive traversal attack was rejected"
fi

if grep -qF \
  'ERROR: unsafe or unexpected archive member detected' \
  /tmp/r8-traversal.log
then
  pass "traversal attack reached archive-path guard"
else
  fail "traversal attack failed at unexpected guard"
  cat /tmp/r8-traversal.log
fi

if [ -e "$traversal_evidence" ]; then
  fail "traversal attack produced restore evidence"
else
  pass "traversal attack produced no restore evidence"
fi

echo
echo "=== CORRUPT REPOSITORY BUNDLE ATTACK ==="

bundle_root="$workspace_root/bundle"
bundle_artifact="$artifact_root/corrupt-bundle.age"
bundle_evidence="$artifact_root/corrupt-bundle-evidence.json"

build_workspace "$bundle_root"

bundle_path="$bundle_root/components/repository/repository.bundle"
checksum_file="$bundle_root/metadata/component-checksums.sha256"
manifest="$bundle_root/manifest.json"

printf '%s\n' \
  'syntactically not a Git bundle' \
  'all outer integrity records will be regenerated' \
  > "$bundle_path"

bundle_sha="$(
  sha256_file "$bundle_path"
)"

bundle_bytes="$(
  wc -c < "$bundle_path" |
    tr -d '[:space:]'
)"

python3 - \
  "$checksum_file" \
  "$bundle_sha" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
new_sha = sys.argv[2]
target = "repository/repository.bundle"

lines = path.read_text().splitlines()

matches = [
    index
    for index, line in enumerate(lines)
    if line.endswith("  " + target)
]

if len(matches) != 1:
    raise SystemExit(
        "expected exactly one repository bundle checksum entry"
    )

lines[matches[0]] = (
    new_sha
    + "  "
    + target
)

path.write_text(
    "\n".join(lines) + "\n"
)
PY

temporary_manifest="$manifest.partial"

jq \
  --arg path "repository/repository.bundle" \
  --arg sha "$bundle_sha" \
  --argjson bytes "$bundle_bytes" \
  '
    .components |= map(
      if .path == $path
      then
        .sha256 = $sha
        | .bytes = $bytes
      else
        .
      end
    )
  ' \
  "$manifest" \
  > "$temporary_manifest"

mv \
  "$temporary_manifest" \
  "$manifest"

if ! jq -e \
  --arg sha "$bundle_sha" \
  --argjson bytes "$bundle_bytes" \
  '
    [
      .components[]
      | select(
          .path == "repository/repository.bundle"
          and .sha256 == $sha
          and .bytes == $bytes
        )
    ]
    | length == 1
  ' \
  "$manifest" >/dev/null
then
  fail "corrupt-bundle manifest regeneration failed"
else
  pass "corrupt bundle recorded in manifest ledger"
fi

if ! grep -qF \
  "$bundle_sha  repository/repository.bundle" \
  "$checksum_file"
then
  fail "corrupt-bundle checksum regeneration failed"
else
  pass "corrupt bundle recorded in checksum inventory"
fi

make_artifact \
  "$bundle_root" \
  "$bundle_artifact"

make_sidecar \
  "$bundle_root" \
  "$bundle_artifact"

if run_verifier \
  "$bundle_artifact" \
  "$bundle_evidence" \
  >/tmp/r8-corrupt-bundle.log 2>&1
then
  fail "invalid Git recovery bundle was accepted"
else
  pass "invalid Git recovery bundle was rejected"
fi

if grep -qF \
  'ERROR: repository bundle verification failed' \
  /tmp/r8-corrupt-bundle.log
then
  pass "corrupt bundle reached Git semantic verification gate"
else
  fail "corrupt bundle failed before Git semantic verification"
  cat /tmp/r8-corrupt-bundle.log
fi

if grep -qE \
  'component checksum mismatch|component manifest SHA-256 does not match sidecar|checksum inventory disagrees with component manifest|component byte count disagrees with manifest' \
  /tmp/r8-corrupt-bundle.log
then
  fail "corrupt bundle was stopped by an earlier hash gate"
else
  pass "regenerated hash layers allowed independent Git verification"
fi

if [ -e "$bundle_evidence" ]; then
  fail "invalid repository bundle produced restore evidence"
else
  pass "invalid repository bundle produced no restore evidence"
fi

echo
echo "=== MISSING DATABASE RECONCILIATION ATTACK ==="

missing_root="$workspace_root/missing-reconciliation"
missing_artifact="$artifact_root/missing-reconciliation.age"
missing_evidence="$artifact_root/missing-reconciliation-evidence.json"
missing_log="$artifact_root/missing-reconciliation.log"

build_workspace \
  "$missing_root"

rm -f \
  "$missing_root/metadata/database-reconciliation.json"

make_artifact \
  "$missing_root" \
  "$missing_artifact"

make_sidecar \
  "$missing_root" \
  "$missing_artifact"

if run_verifier \
  "$missing_artifact" \
  "$missing_evidence" \
  >"$missing_log" 2>&1
then
  fail "missing reconciliation ledger was accepted"
else
  pass "missing reconciliation ledger was rejected"
fi

if grep -qF \
  'ERROR: required recovery component is missing:' \
  "$missing_log" &&
   grep -qF \
  'database-reconciliation.json' \
  "$missing_log"
then
  pass "missing ledger reached required-component gate"
else
  fail "missing ledger failed at unexpected guard"
  cat "$missing_log"
fi

if [ -e "$missing_evidence" ]; then
  fail "missing reconciliation ledger produced restore evidence"
else
  pass "missing reconciliation ledger produced no restore evidence"
fi

echo
echo "=== MALFORMED RECONCILIATION WITH REGENERATED INTEGRITY ==="

malformed_root="$workspace_root/malformed-reconciliation"
malformed_artifact="$artifact_root/malformed-reconciliation.age"
malformed_evidence="$artifact_root/malformed-reconciliation-evidence.json"
malformed_log="$artifact_root/malformed-reconciliation.log"

build_workspace \
  "$malformed_root"

malformed_reconciliation="$malformed_root/metadata/database-reconciliation.json"
malformed_manifest="$malformed_root/manifest.json"

jq \
  '
    .tables[0].content_sha256
      = "not-a-valid-sha256"
  ' \
  "$malformed_reconciliation" \
  > "${malformed_reconciliation}.partial"

mv \
  "${malformed_reconciliation}.partial" \
  "$malformed_reconciliation"

malformed_reconciliation_sha="$(
  sha256_file \
    "$malformed_reconciliation"
)"

jq \
  --arg sha \
    "$malformed_reconciliation_sha" \
  '
    .database_reconciliation.sha256
      = $sha
  ' \
  "$malformed_manifest" \
  > "${malformed_manifest}.partial"

mv \
  "${malformed_manifest}.partial" \
  "$malformed_manifest"

make_artifact \
  "$malformed_root" \
  "$malformed_artifact"

make_sidecar \
  "$malformed_root" \
  "$malformed_artifact"

if run_verifier \
  "$malformed_artifact" \
  "$malformed_evidence" \
  >"$malformed_log" 2>&1
then
  fail "malformed reconciliation ledger was accepted"
else
  pass "malformed reconciliation ledger was rejected"
fi

if grep -qF \
  'ERROR: database reconciliation evidence is invalid' \
  "$malformed_log"
then
  pass "malformed ledger reached semantic validation gate"
else
  fail "malformed ledger failed at unexpected guard"
  cat "$malformed_log"
fi

if grep -qF \
  'ERROR: database reconciliation SHA-256 does not match manifest' \
  "$malformed_log"
then
  fail "malformed ledger was rejected before semantic validation"
else
  pass "regenerated reconciliation hash passed binding gate"
fi

if [ -e "$malformed_evidence" ]; then
  fail "malformed reconciliation ledger produced restore evidence"
else
  pass "malformed reconciliation ledger produced no restore evidence"
fi

echo
echo "=== STALE RECONCILIATION HASH ATTACK ==="

stale_root="$workspace_root/stale-reconciliation-hash"
stale_artifact="$artifact_root/stale-reconciliation-hash.age"
stale_evidence="$artifact_root/stale-reconciliation-hash-evidence.json"
stale_log="$artifact_root/stale-reconciliation-hash.log"

build_workspace \
  "$stale_root"

stale_reconciliation="$stale_root/metadata/database-reconciliation.json"

jq \
  '
    .tables[0].row_count
      = (
          .tables[0].row_count
          + 1
        )
  ' \
  "$stale_reconciliation" \
  > "${stale_reconciliation}.partial"

mv \
  "${stale_reconciliation}.partial" \
  "$stale_reconciliation"

make_artifact \
  "$stale_root" \
  "$stale_artifact"

make_sidecar \
  "$stale_root" \
  "$stale_artifact"

if run_verifier \
  "$stale_artifact" \
  "$stale_evidence" \
  >"$stale_log" 2>&1
then
  fail "stale reconciliation hash attack was accepted"
else
  pass "stale reconciliation hash attack was rejected"
fi

if grep -qF \
  'ERROR: database reconciliation SHA-256 does not match manifest' \
  "$stale_log"
then
  pass "stale ledger reached reconciliation hash-binding gate"
else
  fail "stale reconciliation attack failed at unexpected guard"
  cat "$stale_log"
fi

if [ -e "$stale_evidence" ]; then
  fail "stale reconciliation attack produced restore evidence"
else
  pass "stale reconciliation attack produced no restore evidence"
fi

echo
echo "=== STORAGE EVIDENCE SEMANTIC ATTACKS ==="

run_storage_evidence_attack() {
  attack_name="$1"
  jq_filter="$2"

  attack_root="$workspace_root/storage-$attack_name"
  attack_artifact="$artifact_root/storage-$attack_name.age"
  attack_evidence="$artifact_root/storage-$attack_name-evidence.json"
  attack_log="$artifact_root/storage-$attack_name.log"
  attack_storage="$attack_root/metadata/storage-backup.json"

  build_workspace \
    "$attack_root"

  jq \
    "$jq_filter" \
    "$attack_storage" \
    > "${attack_storage}.partial"

  mv \
    "${attack_storage}.partial" \
    "$attack_storage"

  make_artifact \
    "$attack_root" \
    "$attack_artifact"

  make_sidecar \
    "$attack_root" \
    "$attack_artifact"

  if run_verifier \
    "$attack_artifact" \
    "$attack_evidence" \
    >"$attack_log" 2>&1
  then
    fail "Storage evidence attack $attack_name was accepted"
  else
    pass "Storage evidence attack $attack_name was rejected"
  fi

  if grep -qF \
    'ERROR: Storage recovery evidence is invalid' \
    "$attack_log"
  then
    pass "Storage evidence attack $attack_name reached semantic validation gate"
  else
    fail "Storage evidence attack $attack_name failed at unexpected guard"
    cat "$attack_log"
  fi

  if grep -qE \
    'encrypted artifact checksum mismatch|component manifest SHA-256 does not match sidecar|component checksum mismatch|checksum inventory disagrees with component manifest|component byte count disagrees with manifest' \
    "$attack_log"
  then
    fail "Storage evidence attack $attack_name was stopped by an earlier integrity gate"
  else
    pass "Storage evidence attack $attack_name passed regenerated outer integrity"
  fi

  if [ -e "$attack_evidence" ]; then
    fail "Storage evidence attack $attack_name produced restore evidence"
  else
    pass "Storage evidence attack $attack_name produced no restore evidence"
  fi
}

echo
echo "--- TOTAL BYTES AGGREGATE MISMATCH ---"

run_storage_evidence_attack \
  "total-bytes-mismatch" \
  '.total_bytes = 26'

echo
echo "--- OBJECT COUNT AGGREGATE MISMATCH ---"

run_storage_evidence_attack \
  "object-count-mismatch" \
  '.object_count = 2'

echo
echo "--- DUPLICATE BUCKET NAME ---"

run_storage_evidence_attack \
  "duplicate-bucket-name" \
  '.buckets += [.buckets[0]]
   | .bucket_count = 2
   | .object_count = 2
   | .total_bytes = 50'

echo
echo "--- UNSAFE BUCKET NAME ---"

run_storage_evidence_attack \
  "unsafe-bucket-name" \
  '.buckets[0].name = "../bucket-a"'

echo
echo "--- COPY VERIFIED FALSE ---"

run_storage_evidence_attack \
  "copy-not-verified" \
  '.buckets[0].copy_verified = false'

echo
echo "--- BUCKET ARRAY LENGTH MISMATCH ---"

run_storage_evidence_attack \
  "bucket-count-mismatch" \
  '.bucket_count = 2'

echo
echo "--- NEGATIVE BYTE COUNT ---"

run_storage_evidence_attack \
  "negative-bytes" \
  '.buckets[0].bytes = -1
   | .total_bytes = -1'

echo
echo "--- NON-INTEGER OBJECT COUNT ---"

run_storage_evidence_attack \
  "fractional-object-count" \
  '.object_count = 1.5'

echo
echo "=== SAME-LENGTH STORAGE OBJECT MUTATION ==="

same_length_root="$workspace_root/storage-same-length-mutation"
same_length_artifact="$artifact_root/storage-same-length-mutation.age"
same_length_evidence="$artifact_root/storage-same-length-mutation-evidence.json"
same_length_log="$artifact_root/storage-same-length-mutation.log"

build_workspace "$same_length_root"

same_length_object="$same_length_root/components/storage/bucket-a/object.txt"
same_length_checksums="$same_length_root/metadata/component-checksums.sha256"
same_length_checksum_key="storage/bucket-a/object.txt"

original_object_bytes="$(
  wc -c < "$same_length_object" |
    tr -d '[:space:]'
)"

original_object_sha="$(
  sha256_file "$same_length_object"
)"

recorded_object_sha="$(
  awk \
    -v wanted="$same_length_checksum_key" \
    '$2 == wanted { print $1 }' \
    "$same_length_checksums"
)"

if [ -n "$recorded_object_sha" ]; then
  pass "same-length attack target exists in checksum ledger"
else
  fail "same-length attack target is missing from checksum ledger"
fi

if [ "$original_object_sha" = "$recorded_object_sha" ]; then
  pass "same-length attack starts from authenticated Storage object"
else
  fail "same-length attack fixture does not match checksum ledger"
fi

python3 - "$same_length_object" <<'PY_MUTATE'
from pathlib import Path
import sys

target = Path(sys.argv[1])
payload = bytearray(target.read_bytes())

if len(payload) == 0:
    raise SystemExit("same-length mutation target is empty")

payload[0] ^= 1
target.write_bytes(payload)
PY_MUTATE

mutated_object_bytes="$(
  wc -c < "$same_length_object" |
    tr -d '[:space:]'
)"

mutated_object_sha="$(
  sha256_file "$same_length_object"
)"

if [ "$original_object_bytes" = "$mutated_object_bytes" ]; then
  pass "same-length Storage mutation preserved exact byte count"
else
  fail "same-length Storage mutation changed byte count"
fi

if [ "$original_object_sha" != "$mutated_object_sha" ]; then
  pass "same-length Storage mutation changed object content"
else
  fail "same-length Storage mutation failed to change content"
fi

if [ "$recorded_object_sha" != "$mutated_object_sha" ]; then
  pass "authenticated component checksum remains stale after mutation"
else
  fail "component checksum unexpectedly matches mutated object"
fi

make_artifact \
  "$same_length_root" \
  "$same_length_artifact"

make_sidecar \
  "$same_length_root" \
  "$same_length_artifact"

actual_outer_sha="$(
  sha256_file "$same_length_artifact"
)"

recorded_outer_sha="$(
  jq -er \
    '.artifact.sha256' \
    "$same_length_artifact.json"
)"

actual_outer_bytes="$(
  wc -c < "$same_length_artifact" |
    tr -d '[:space:]'
)"

recorded_outer_bytes="$(
  jq -er \
    '.artifact.bytes' \
    "$same_length_artifact.json"
)"

actual_manifest_sha="$(
  sha256_file "$same_length_root/manifest.json"
)"

recorded_manifest_sha="$(
  jq -er \
    '.component_manifest_sha256' \
    "$same_length_artifact.json"
)"

if [ "$actual_outer_sha" = "$recorded_outer_sha" ]; then
  pass "same-length attack regenerated outer artifact SHA-256"
else
  fail "same-length attack outer artifact SHA-256 is stale"
fi

if [ "$actual_outer_bytes" = "$recorded_outer_bytes" ]; then
  pass "same-length attack regenerated outer artifact byte count"
else
  fail "same-length attack outer artifact byte count is stale"
fi

if [ "$actual_manifest_sha" = "$recorded_manifest_sha" ]; then
  pass "same-length attack retained valid manifest-sidecar binding"
else
  fail "same-length attack manifest-sidecar binding is invalid"
fi

rm -f \
  "$same_length_evidence" \
  "$same_length_log"

if run_verifier \
  "$same_length_artifact" \
  "$same_length_evidence" \
  >"$same_length_log" 2>&1
then
  fail "same-length Storage mutation was accepted"
else
  pass "same-length Storage mutation was rejected"
fi

if grep -qF \
  'ERROR: component checksum mismatch: storage/bucket-a/object.txt' \
  "$same_length_log"
then
  pass "same-length mutation reached authenticated component checksum gate"
else
  fail "same-length mutation missed authenticated component checksum gate"
fi

if grep -qF \
  'AUTHENTICATED STORAGE RESTORE PROOF' \
  "$same_length_log"
then
  fail "Storage restore executed after same-length checksum failure"
else
  pass "Storage restore remained blocked after same-length mutation"
fi

if [ -s "$same_length_evidence" ]; then
  fail "same-length mutation emitted final restore evidence"
else
  pass "same-length mutation emitted no final restore evidence"
fi

if ps -axo pid=,command= |
   grep '[r]clone serve s3' >/dev/null
then
  fail "same-length mutation left an isolated Storage process"
else
  pass "same-length mutation left no Storage verifier process"
fi

echo
echo "=== STORAGE ATTACK CREDENTIAL ISOLATION ==="

if grep -E \
  'postgres(ql)?://|SUPABASE_DB_URL=|SUPABASE_SECRET_KEY=|SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=|BACKUP_S3_SECRET_ACCESS_KEY=' \
  "$artifact_root"/storage-*.log
then
  fail "Storage evidence attack logs exposed credential material"
else
  pass "Storage evidence attack tests exposed no credential material"
fi

echo
echo "=== RECONCILIATION ATTACK CREDENTIAL ISOLATION ==="

if grep -E \
  'postgres(ql)?://|SUPABASE_DB_URL=|SUPABASE_SECRET_KEY=|BACKUP_S3_SECRET_ACCESS_KEY=' \
  "$missing_log" \
  "$malformed_log" \
  "$stale_log"
then
  fail "reconciliation attack logs exposed credential material"
else
  pass "reconciliation attack tests exposed no credential material"
fi

echo
echo "=== NETWORK / CREDENTIAL ISOLATION ==="

if grep -RE \
  'postgresql://|sb_secret_|SUPABASE_SECRET_KEY=|BACKUP_S3_SECRET_ACCESS_KEY=' \
  /tmp/r8-traversal.log \
  /tmp/r8-corrupt-bundle.log
then
  fail "credential material appeared in adversarial test output"
else
  pass "structural attack tests exposed no credential material"
fi

echo
echo "=== R8B2B-2 RESULT ==="

if [ "$failures" -eq 0 ]; then
  echo "PASS: structural attack rejection contract"
else
  echo "FAIL: structural audit found $failures issue(s)"
fi

exit "$failures"

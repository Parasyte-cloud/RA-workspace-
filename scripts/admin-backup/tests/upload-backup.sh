#!/usr/bin/env bash

set -u

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

work="$(mktemp -d)"
failures=0

cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

mkdir -p "$work/bin" "$work/remote"

# A stand-in for rclone that behaves like the real one where it matters:
#   copyto  copies one file and honours --immutable
#   cat     prints a remote object
#   check   compares two DIRECTORIES and refuses single files, exactly as the
#           real command does ("is a file not a directory")
cat > "$work/bin/rclone" <<'FAKE'
#!/usr/bin/env bash
[ -n "${FAKE_LOG:-}" ] && printf '%s\n' "$*" >> "$FAKE_LOG"
sub="${1:-}"; shift || true
remote_path() { printf '%s/%s' "$FAKE_REMOTE" "${1#dst:}"; }
case "$sub" in
  copyto)
    src="$1"; dst="$2"; shift 2
    target="$(remote_path "$dst")"
    mkdir -p "$(dirname "$target")"
    for a in "$@"; do
      if [ "$a" = "--immutable" ] && [ -e "$target" ]; then
        echo "ERROR: immutable: refusing to overwrite" >&2; exit 1
      fi
    done
    [ "${FAKE_DROP:-}" = "1" ] && exit 0
    case "$target" in
      *.age)
        if [ "${FAKE_CORRUPT:-}" = "1" ]; then
          head -c 100 "$src" > "$target"; exit 0
        fi ;;
    esac
    cp "$src" "$target" ;;
  cat)
    target="$(remote_path "$1")"
    [ -f "$target" ] || { echo "ERROR: object not found" >&2; exit 1; }
    cat "$target" ;;
  check)
    for a in "$1" "$2"; do
      path="$a"; case "$a" in dst:*) path="$(remote_path "$a")" ;; esac
      if [ -f "$path" ]; then
        echo "Failed to create file system for \"$a\": is a file not a directory" >&2
        exit 1
      fi
    done
    exit 0 ;;
  *) echo "fake rclone: unsupported $sub" >&2; exit 2 ;;
esac
FAKE
chmod +x "$work/bin/rclone"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

make_artifact() {
  dir="$1"
  mkdir -p "$dir"
  name="ridearrivo-admin-backup-11111111-2222-3333-4444-555555555555-attempt-1.age"
  head -c 300000 /dev/urandom > "$dir/$name"
  bytes="$(wc -c < "$dir/$name" | tr -d '[:space:]')"
  jq -n --arg name "$name" --arg sha "$(sha "$dir/$name")" --argjson bytes "$bytes" '{
    artifact: {name: $name, bytes: $bytes, sha256: $sha},
    encryption: {tool: "age", encrypted: true},
    offsite_uploaded: false,
    restore_verified: false,
    coverage: {database: true, auth: true, storage: true, repository: true, configuration_manifest: true}
  }' > "$dir/$name.json"
  printf '%s\n' "$dir/$name"
}

run_upload() {
  artifact="$1"; shift
  env "$@" \
    PATH="$work/bin:$PATH" \
    FAKE_REMOTE="$work/remote" \
    FAKE_LOG="$work/args.log" \
    SUPABASE_STORAGE_S3_ENDPOINT="https://source.example.test" \
    BACKUP_S3_ENDPOINT="https://dest.example.test" \
    BACKUP_S3_REGION="auto" \
    BACKUP_S3_BUCKET="test-bucket" \
    BACKUP_S3_ACCESS_KEY_ID="x" \
    BACKUP_S3_SECRET_ACCESS_KEY="y" \
    bash "$repo/scripts/admin-backup/upload-backup.sh" run "$artifact" 2>&1
}

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; failures=$((failures + 1)); }

# 1. Healthy upload: stored, byte-verified, sidecar marked verified.
a1="$(make_artifact "$work/run1")"
out="$(run_upload "$a1" FAKE_CORRUPT=0)"; code=$?
if [ "$code" -eq 0 ] && printf '%s\n' "$out" | grep -Fq 'encrypted backup uploaded and verified off-site'; then
  pass 'healthy upload is verified on a single-file artifact'
else
  fail 'healthy upload should verify'; printf '%s\n' "$out" | tail -5 | sed 's/^/    /'
fi
if [ -f "$work/remote/test-bucket/ridearrivo/admin-backups/$(basename "$a1")" ] &&
   [ -f "$work/remote/test-bucket/ridearrivo/admin-backups/$(basename "$a1").json" ]; then
  pass 'artifact and sidecar are both in the bucket'
else
  fail 'artifact and sidecar should both be uploaded'
fi
if jq -e '.offsite_uploaded == true and .offsite.remote_verified == true' "$a1.json" >/dev/null 2>&1; then
  pass 'local sidecar records the verified upload'
else
  fail 'local sidecar should be marked verified'
fi


# 1b. Diagnostics are off unless asked for, and on when asked.
if grep -E '^copyto ' "$work/args.log" | grep -Eq -- '--dump|-vv'; then
  fail 'diagnostic flags must not be sent unless BACKUP_RCLONE_DEBUG=1'
else
  pass 'no diagnostic flags by default'
fi

rm -rf "$work/remote"; mkdir -p "$work/remote"; : > "$work/args.log"
a1b="$(make_artifact "$work/run1b")"
out="$(run_upload "$a1b" BACKUP_RCLONE_DEBUG=1)"; code=$?
if [ "$code" -eq 0 ] &&
   [ "$(grep -E '^copyto ' "$work/args.log" | grep -c -- '-vv --dump headers')" -eq 2 ] &&
   printf '%s\n' "$out" | grep -Fq 'upload diagnostics are on'; then
  pass 'BACKUP_RCLONE_DEBUG=1 adds header dumps to both uploads and says so'
else
  fail 'BACKUP_RCLONE_DEBUG=1 should add -vv --dump headers to both uploads'
  grep -E '^copyto ' "$work/args.log" | sed 's/^/    /'
fi
if grep -E '^copyto ' "$work/args.log" | grep -Fq -- '--dump bodies'; then
  fail 'file contents must never be dumped'
else
  pass 'bodies (file contents) are never dumped'
fi

# 2. A truncated upload must be caught.
rm -rf "$work/remote"; mkdir -p "$work/remote"
a2="$(make_artifact "$work/run2")"
out="$(run_upload "$a2" FAKE_CORRUPT=1)"; code=$?
if [ "$code" -ne 0 ] && printf '%s\n' "$out" | grep -Fq 'encrypted remote artifact verification failed'; then
  pass 'a truncated remote object fails verification'
else
  fail 'a truncated remote object must fail'; printf '%s\n' "$out" | tail -5 | sed 's/^/    /'
fi
if jq -e '.offsite_uploaded == false' "$a2.json" >/dev/null 2>&1; then
  pass 'a failed verification never marks the sidecar uploaded'
else
  fail 'sidecar must stay not-uploaded after a failed verification'
fi

# 3. An object that never arrived must be caught.
rm -rf "$work/remote"; mkdir -p "$work/remote"
a3="$(make_artifact "$work/run3")"
out="$(run_upload "$a3" FAKE_DROP=1)"; code=$?
if [ "$code" -ne 0 ] && printf '%s\n' "$out" | grep -Fq 'verification failed'; then
  pass 'a missing remote object fails verification'
else
  fail 'a missing remote object must fail'; printf '%s\n' "$out" | tail -5 | sed 's/^/    /'
fi

# 4. The script must not call `rclone check` on single files again.
if grep -E '^[[:space:]]*(if !? ?)?rclone check' "$repo/scripts/admin-backup/upload-backup.sh" >/dev/null; then
  fail 'upload-backup.sh must not use rclone check on single files'
else
  pass 'upload-backup.sh no longer uses rclone check on single files'
fi

if [ "$failures" -ne 0 ]; then
  printf 'FAILED: %s upload check(s)\n' "$failures"
  exit 1
fi
echo 'PASS: upload-backup checks'

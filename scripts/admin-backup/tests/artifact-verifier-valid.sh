#!/usr/bin/env bash

set -euo pipefail

repo="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." &&
  pwd
)"

root="$(mktemp -d)"
out="$(mktemp -d)"
fake_bin="$(mktemp -d)"

cleanup() {
  rm -rf \
    "$root" \
    "$out" \
    "$fake_bin"
}

trap cleanup EXIT

identity="$out/identity.txt"
artifact="$out/valid-restore.age"
evidence="$out/evidence.json"

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

mkdir -p \
  "$root/components/database" \
  "$root/components/storage/bucket-a" \
  "$root/metadata"

cat > "$root/components/database/roles.sql" <<'SQL'
SELECT 1;
SQL

cat > "$root/components/database/schema.sql" <<'SQL'
SELECT 1;
SQL

cat > "$root/components/database/data.sql" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
11111111-1111-1111-1111-111111111111
\.
COPY "auth"."identities" ("id", "user_id") FROM stdin;
22222222-2222-2222-2222-222222222222	11111111-1111-1111-1111-111111111111
\.
COPY "storage"."buckets" ("id") FROM stdin;
bucket-a
\.
COPY "storage"."objects" ("id", "bucket_id", "name") FROM stdin;
33333333-3333-3333-3333-333333333333	bucket-a	object.txt
\.
COPY "supabase_functions"."hooks" ("id") FROM stdin;
1
\.
COPY "public"."employee_profiles" ("id") FROM stdin;
11111111-1111-1111-1111-111111111111
\.
SELECT pg_catalog.setval('"public"."synthetic_restore_seq"', 42, true);
SQL

cat > "$root/components/database/auth-data.sql" <<'SQL'
COPY "auth"."users" ("id") FROM stdin;
11111111-1111-1111-1111-111111111111
\.
COPY "auth"."identities" ("id", "user_id") FROM stdin;
22222222-2222-2222-2222-222222222222	11111111-1111-1111-1111-111111111111
\.
SQL

cat > "$root/components/database/auth-pre.sql" <<'SQL'
CREATE SCHEMA auth
  AUTHORIZATION supabase_admin;

CREATE TABLE auth.users (
  id uuid NOT NULL
);

CREATE TABLE auth.identities (
  id uuid NOT NULL,
  user_id uuid
);
SQL

cat > "$root/components/database/storage-pre.sql" <<'SQL'
CREATE SCHEMA storage
  AUTHORIZATION supabase_admin;

CREATE TABLE storage.buckets (
  id text NOT NULL
);

CREATE TABLE storage.objects (
  id uuid NOT NULL,
  bucket_id text,
  name text
);
SQL

cat > "$root/components/database/supabase-functions-pre.sql" <<'SQL'
CREATE SCHEMA supabase_functions
  AUTHORIZATION supabase_admin;

CREATE TABLE supabase_functions.hooks (
  id bigint NOT NULL
);

ALTER TABLE supabase_functions.hooks
  OWNER TO supabase_functions_admin;

CREATE TABLE supabase_functions.migrations (
  version text NOT NULL
);

ALTER TABLE supabase_functions.migrations
  OWNER TO supabase_functions_admin;

CREATE FUNCTION supabase_functions.http_request()
RETURNS void
LANGUAGE sql
AS $$
  SELECT;
$$;
SQL

cat > "$root/components/database/public-pre.sql" <<'SQL'
CREATE SCHEMA public
  AUTHORIZATION supabase_admin;

CREATE TABLE public.employee_profiles (
  id uuid NOT NULL
);

CREATE SEQUENCE public.synthetic_restore_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE FUNCTION public.handle_new_workspace_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;
SQL

cat > "$root/components/database/auth-post.sql" <<'SQL'
ALTER TABLE ONLY auth.users
  ADD CONSTRAINT users_pkey
  PRIMARY KEY (id);

ALTER TABLE ONLY auth.identities
  ADD CONSTRAINT identities_pkey
  PRIMARY KEY (id);

ALTER TABLE ONLY auth.identities
  ADD CONSTRAINT identities_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id);
SQL

cat > "$root/components/database/storage-post.sql" <<'SQL'
ALTER TABLE ONLY storage.buckets
  ADD CONSTRAINT buckets_pkey
  PRIMARY KEY (id);

ALTER TABLE ONLY storage.objects
  ADD CONSTRAINT objects_pkey
  PRIMARY KEY (id);

ALTER TABLE ONLY storage.objects
  ADD CONSTRAINT objects_bucket_id_fkey
  FOREIGN KEY (bucket_id)
  REFERENCES storage.buckets(id);
SQL

cat > "$root/components/database/supabase-functions-post.sql" <<'SQL'
ALTER TABLE ONLY supabase_functions.hooks
  ADD CONSTRAINT hooks_pkey
  PRIMARY KEY (id);

ALTER TABLE ONLY supabase_functions.migrations
  ADD CONSTRAINT migrations_pkey
  PRIMARY KEY (version);

CREATE INDEX
  supabase_functions_hooks_h_table_id_h_name_idx
ON supabase_functions.hooks (id);

CREATE INDEX
  supabase_functions_hooks_request_id_idx
ON supabase_functions.hooks (id);
SQL

cat > "$root/components/database/public-post.sql" <<'SQL'
ALTER TABLE ONLY public.employee_profiles
  ADD CONSTRAINT employee_profiles_pkey
  PRIMARY KEY (id);

ALTER TABLE ONLY public.employee_profiles
  ADD CONSTRAINT employee_profiles_id_fkey
  FOREIGN KEY (id)
  REFERENCES auth.users(id);
SQL

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

if jq -e '
  .sequence_count == 1
  and (
    .sequence_state_sha256
    | type
  ) == "string"
  and (
    .sequence_state_sha256
    | test("^[0-9a-f]{64}$")
  )
  and .sequence_state_sha256
    != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
' \
  "$root/metadata/database-reconciliation.json" \
  >/dev/null
then
  echo "PASS: non-empty database sequence state fixture authenticated"
else
  echo "FAIL: non-empty database sequence state fixture invalid"
  exit 1
fi

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

if ! jq -e '
  .coverage.database == true
  and .coverage.auth == true
  and .coverage.storage == true
  and .coverage.repository == true
  and .coverage.configuration_manifest == true
' "$root/manifest.json" >/dev/null; then
  echo "FAIL: fixture coverage incomplete"
  exit 1
fi

echo "PASS: fixture coverage complete"

(
  cd "$root"

  tar -cf "$artifact" \
    components \
    metadata \
    manifest.json
)

artifact_sha="$(
  sha256_file "$artifact"
)"

manifest_sha="$(
  sha256_file "$root/manifest.json"
)"

artifact_bytes="$(
  wc -c < "$artifact" |
    tr -d '[:space:]'
)"

jq -n \
  --arg sha "$artifact_sha" \
  --arg manifest_sha "$manifest_sha" \
  --argjson bytes "$artifact_bytes" \
  '{
    format_version: 1,
    artifact: {
      name: "valid-restore.age",
      bytes: $bytes,
      sha256: $sha
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
      remote_path: "offline/valid-restore.age",
      remote_verified: true
    },
    restore_verified: false
  }' \
  > "$artifact.json"

printf '%s\n' \
  'synthetic offline identity' \
  > "$identity"

chmod 600 "$identity"

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

env \
  -u SUPABASE_DB_URL \
  -u SUPABASE_DB_PASSWORD \
  -u DATABASE_URL \
  -u DIRECT_URL \
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
  "$evidence" \
  >/dev/null

echo "PASS: valid hardened artifact accepted"

if ! jq -e \
  --arg sha "$artifact_sha" \
  '
    .artifact_sha256 == $sha
    and .checksum_verified == true
    and .decryption_verified == true
    and .repository_available == true
    and .configuration_manifest_valid == true
    and .artifact_inspection_completed == true
    and .database_restore == true
    and .auth_restore == true
    and .storage_restore == true

    and .database_restore_verification.executed == true
    and .database_restore_verification.isolated_database_restore_verified == true
    and .database_restore_verification.auth_restore_verified == true
    and .database_restore_verification.storage_database_metadata_verified == true
    and .database_restore_verification.production_database_contacted == false
    and .database_restore_verification.final_claim_promoted == true
    and (
      .database_restore_verification.evidence_sha256
      | test("^[0-9a-f]{64}$")
    )
    and (
      .database_restore_verification.reconciliation_sha256
      | test("^[0-9a-f]{64}$")
    )

    and .storage_restore_verification.executed == true
    and .storage_restore_verification.isolated_restore_verified == true
    and .storage_restore_verification.production_storage_contacted == false
    and .storage_restore_verification.final_claim_promoted == true
    and (
      .storage_restore_verification.evidence_sha256
      | test("^[0-9a-f]{64}$")
    )
  ' \
  "$evidence" >/dev/null
then
  echo "FAIL: hardened verifier evidence invalid"
  exit 1
fi

echo "PASS: hardened verifier evidence accurate"
echo "PASS: database restore claim promoted"
echo "PASS: auth restore claim promoted"
echo "PASS: storage restore claim promoted"
echo "PASS: R8B2A hardened valid-path regression"

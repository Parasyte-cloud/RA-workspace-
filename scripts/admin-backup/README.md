# RideArrivo Administration Backup Runner

This directory contains server-side disaster-recovery tooling.

## Security boundary

These scripts are backend-only. They must never be imported by Vite or shipped
to a browser bundle.

The backup worker uses:

- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`
- Supabase Storage S3 credentials
- separate off-site S3-compatible destination credentials
- an age public encryption recipient

The worker must not possess the age private/decryption key.

## Required environment

### Supabase control plane

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`

`SUPABASE_SECRET_KEY` must use the current `sb_secret_...` server-key format.

### Supabase Storage source

- `SUPABASE_STORAGE_S3_ENDPOINT`
- `SUPABASE_STORAGE_S3_REGION`
- `SUPABASE_STORAGE_S3_ACCESS_KEY_ID`
- `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY`

### Off-site S3-compatible destination

- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_REGION`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_ACCESS_KEY_ID`
- `BACKUP_S3_SECRET_ACCESS_KEY`

The off-site endpoint must be a different failure domain from Supabase Storage.

### Encryption

- `BACKUP_AGE_RECIPIENT`

Only the age public recipient belongs on the normal backup worker.

## Required tools

- bash
- git
- tar
- curl
- jq
- Supabase CLI
- rclone
- age
- sha256sum or shasum

## Prohibited frontend secrets

Do not create any `VITE_` variable containing:

- Supabase secret/service-role keys
- source Storage S3 secrets
- destination S3 secrets
- age private keys

The browser Administration panel only queues jobs and reads their status.

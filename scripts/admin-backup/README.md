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

## Runbook: getting backups running and keeping them honest

### How a backup actually happens

1. A person presses Backup Now, or the schedule says a slot is due.
2. That creates a row in `admin_backup_jobs` with status `queued`. Nothing
   else happens at this point. The browser never runs a backup.
3. The **Admin Backup Writer** GitHub Actions workflow wakes every 15 minutes,
   claims a queued or due job, dumps the database and auth, copies storage,
   encrypts the result with the age public key, uploads it off-site and marks
   the job `succeeded`.

So if the workflow is off, every request just sits in `queued` with
`Attempts 0`. Scheduled slots are also created by the runner, so with the
runner off there are no scheduled jobs either.

### Checklist: why a job stays queued

Work down this list. The first miss explains it.

1. GitHub, repository **Settings > Secrets and variables > Actions > Variables**:
   `ADMIN_BACKUP_WRITER_ENABLED` must be exactly `true`. The 15 minute schedule
   is ignored without it. (A manual **Run workflow** from `main` works without
   it, which is the quickest test.)
2. **Secrets** on the same page, all present:
   `ADMIN_BACKUP_SUPABASE_URL`, `ADMIN_BACKUP_SUPABASE_SECRET_KEY`,
   `ADMIN_BACKUP_SUPABASE_DB_URL`, `ADMIN_BACKUP_SOURCE_S3_ENDPOINT`,
   `ADMIN_BACKUP_SOURCE_S3_REGION`, `ADMIN_BACKUP_SOURCE_S3_ACCESS_KEY_ID`,
   `ADMIN_BACKUP_SOURCE_S3_SECRET_ACCESS_KEY`, `ADMIN_BACKUP_DEST_S3_ENDPOINT`,
   `ADMIN_BACKUP_DEST_S3_REGION`, `ADMIN_BACKUP_DEST_S3_BUCKET`,
   `ADMIN_BACKUP_DEST_S3_ACCESS_KEY_ID`, `ADMIN_BACKUP_DEST_S3_SECRET_ACCESS_KEY`,
   `ADMIN_BACKUP_AGE_RECIPIENT`.
   A missing one makes preflight exit **before** it claims a job, so the job
   stays `queued` with `Attempts 0` and the only trace is the Actions log.
3. `ADMIN_BACKUP_SUPABASE_DB_URL` must be the **session pooler** string:
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   - The direct host `db.<ref>.supabase.co` is IPv6 only. GitHub-hosted runners
     have no IPv6, so the dump cannot connect.
   - Port 6543 is the transaction pooler. `pg_dump` cannot run through it.
   - Special characters in the password must be percent-encoded.
   Preflight now checks all three and says which one is wrong.
4. **Actions** tab, workflow **Admin Backup Writer**: it must not show
   "disabled". (GitHub also turns scheduled workflows off in a public repository
   after 60 days with no activity; a private one is not affected.)
5. **Settings > Billing > Actions usage**: a private repository on the Free plan
   has 2,000 minutes a month. A job is billed in whole minutes, and a run every
   15 minutes is about 2,900 runs a month even when there is nothing to do. If
   usage is near the limit, change the cron in the workflow to an hourly
   `7 * * * *`. Backup Now then waits up to an hour.

### First good backup

1. Fix the checklist above.
2. Actions > Admin Backup Writer > **Run workflow** on `main`.
3. Watch the log. A healthy run goes DATABASE AND AUTH BACKUP, STORAGE BACKUP,
   ENCRYPTED PACKAGE, OFF-SITE UPLOAD, COMPLETION CONTRACT.
4. In the Control Centre the job should read `succeeded` with an artifact path,
   a size and a retention date. Then turn the schedule on and save it.

### What the monitoring does

- The Control Centre shows a red banner when no backup has ever completed, when
  requests are waiting with no attempt, when the last run failed, when the
  newest good backup is too old for the schedule, when the schedule is off, and
  when nothing has been restore-tested.
- `check_admin_backup_health()` runs hourly inside Supabase (pg_cron), so it
  still works when GitHub does not. It tells every active admin in the bell and
  by email, at most once a day, until the problem clears. If pg_cron is not
  enabled, schedule `select public.check_admin_backup_health();` hourly some
  other way.

### Retention is not enforced by code

`retention_until` is recorded on each job and shown in the Control Centre, but
no script deletes the off-site object when it passes. Left alone, backups
accumulate and personal data is kept longer than the stated retention.

Do it with a **bucket lifecycle rule** on the off-site bucket, not with a
script: expire objects older than the retention days plus 7. This needs no
credentials in CI, and it lets the writer token stay without delete permission,
so a stolen writer token cannot erase the history.

### Restore drill (the only proof a backup works)

`Restore verified 0` means no backup has been proven. A backup that has not been
restored is a hope.

- Keep the age **private** key offline and in a second place (a password manager
  vault and a sealed copy). Without it every artifact is unreadable. The writer
  must never hold it.
- Run the restore verifier (`restore-verifier-runner.sh`) on a machine that has
  the private key and **no** production credentials. It refuses to start if it
  finds any. The restore result is written back to the job and the counter in
  the Control Centre moves.
- Do this once now, then at least every quarter, and after any change to the
  backup scripts.

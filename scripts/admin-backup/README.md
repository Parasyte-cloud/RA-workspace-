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
2. That creates a row in `admin_backup_jobs` with status `queued`. The browser
   never runs a backup.
3. Every minute the database (`dispatch_admin_backup_runner()`, pg_cron) looks
   for waiting work. If there is some and no runner is busy, it asks GitHub to
   start the **Admin Backup Writer** workflow through the GitHub API. It starts
   nothing when there is nothing to do.
4. The workflow claims the job, dumps the database and auth, copies storage,
   encrypts the result with the age public key, uploads it off-site, checks the
   stored bytes against the original and marks the job `succeeded`.

GitHub's own cron is best effort and drops runs, so it is only an hourly safety
net (and only when `ADMIN_BACKUP_WRITER_ENABLED` is `true`). If the database
cannot start the workflow, the Control Centre and an email to the admins say so
within a few hours.

### One-time setup: let the database start the workflow

1. Supabase > Database > Extensions: enable **pg_net** and **pg_cron**. Vault is
   already on.
2. GitHub > Settings > Developer settings > Fine-grained personal access tokens
   > Generate. Repository access: **only** `RA-workspace-`. Repository
   permissions: **Actions: Read and write**, nothing else. Set a one-year expiry
   and put the renewal date in your calendar.
3. Store it in Vault (SQL editor). Paste the token yourself; it is not kept in
   any file or log:
   ```sql
   select vault.create_secret(
     'PASTE_TOKEN_HERE',
     'admin_backup_github_token',
     'Starts the Admin Backup Writer workflow'
   );
   ```
4. Run `supabase/migrations/20261012180000_backup_dispatch.sql`.
5. Press Backup Now in the Control Centre. Within a minute the Actions tab shows
   a new "Admin Backup Writer" run started by the API.
6. Check by hand any time: `select public.dispatch_admin_backup_runner();`
   returns `idle` (nothing waiting), `busy` (a runner has it), `waiting`
   (started recently), `dispatched`, `no-token` (step 3 not done) or `error`.

To rotate the token, replace it in place:
```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'admin_backup_github_token'),
  'NEW_TOKEN'
);
```

If the token expires or is revoked, GitHub answers 401 or 404, the next health
check says "GitHub refused the request to start the backup runner", and the
admins are emailed. Nothing is lost; the requests stay queued.

### Checklist: why a job stays queued

Work down this list. The first miss explains it.

1. The database trigger above is set up (token in Vault, migration run).
   `ADMIN_BACKUP_WRITER_ENABLED` is only the hourly safety net: set it to
   `true` if you want that too. A manual **Run workflow** from `main` and the
   database trigger both work without it.
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
   has 2,000 minutes a month. A full backup run is about 4 minutes, so a daily
   backup is about 120 minutes a month. The database trigger only starts a run
   when there is work, so it does not burn minutes polling.

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

### The 501 on the first upload attempt

The destination answers `501 Not Implemented` to the first upload of each file,
and rclone's retry succeeds. The byte check proves the stored copy is right, so
this is not a failure, but it doubles the upload work and will matter as the
backup grows. To see what the destination is rejecting:

1. Press Backup Now so a job is waiting.
2. Actions > Admin Backup Writer > **Run workflow**, tick **Print rclone request
   and response headers for the off-site upload**, run it.
3. In the log, under OFF-SITE UPLOAD, find the first `PUT` request and the
   `501` response. The request headers (rclone redacts Authorization) show what
   was sent that the destination does not support.

It prints headers only, never file contents.

### Restore drill (the only proof a backup works)

`Restore verified 0` means no backup has been proven. A backup that has not been
restored is a hope. The drill downloads the newest completed backup, decrypts it
with your age **private** key, restores the database and storage into a
throwaway local copy, checks them against the manifest and records the result on
the job. The Control Centre counter then moves to 1.

It runs on a trusted machine (your Mac), never in GitHub. It needs these tools:
`age`, `tar`, `jq`, `git`, `docker`, `rclone` (with `rclone serve s3`) and
`python3`.

One-time setup:

1. **A read-only storage key.** In the Cloudflare dashboard create an API token
   with **Object Read only** on the backup bucket and nothing else. This is not
   the writer's key. A restore must never be able to change or delete backups.
2. **The age private key**, in a file only you can read, outside any git
   repository:
   ```bash
   mkdir -p ~/.ridearrivo-restore && chmod 700 ~/.ridearrivo-restore
   cp /path/to/your/age.key ~/.ridearrivo-restore/age.key
   chmod 600 ~/.ridearrivo-restore/age.key
   ```
   Keep a second copy somewhere else (a password manager vault, a sealed paper
   copy). Without the private key every backup is unreadable.
3. **The settings file**, `~/.ridearrivo-restore/drill.env`, mode 600, one
   `NAME=value` per line. Only these names are accepted:
   ```
   SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   BACKUP_VERIFY_S3_ENDPOINT=https://YOUR-ACCOUNT.r2.cloudflarestorage.com
   BACKUP_VERIFY_S3_REGION=auto
   BACKUP_VERIFY_S3_ACCESS_KEY_ID=...read-only key id...
   BACKUP_VERIFY_S3_SECRET_ACCESS_KEY=...read-only secret...
   BACKUP_AGE_IDENTITY_FILE=~/.ridearrivo-restore/age.key
   ```
   The Supabase pair is only used to find the backup to verify and to record the
   result. The database password, storage keys and the writer's keys must NOT be
   here, and the wrapper refuses a file that contains them.

Then:

```bash
cd ~/RA-workspace
bash scripts/admin-backup/restore-drill.sh --check   # tools, file modes, no restore yet
bash scripts/admin-backup/restore-drill.sh run       # the real drill
```

`--check` fixes everything that is wrong without touching a backup. `run`
prints no secret values, runs the verifier in a clean environment so nothing
from your shell can leak in, and returns the verifier's exit code. Do this once
now, then at least every quarter and after any change to these scripts.

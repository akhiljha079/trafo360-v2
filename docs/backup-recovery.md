# Backup & Recovery

## What's backed up, and by what

| Data | Backed up by | Notes |
|---|---|---|
| Postgres database (everything except file contents) | `scripts/backup.sh` (`pg_dump --format=custom`) | Users, roles, projects, document/physical-file metadata, audit log, notification templates, encrypted SMTP/AD secrets - all of it |
| `storage/local` (the `LOCAL_PENDING_SYNC`/`SYNC_FAILED` fallback area) | `scripts/backup.sh` | Should normally be near-empty in a healthy deployment - it's only non-empty while NFS is unreachable or a sync retry is pending |
| WhatsApp session (`storage/whatsapp-session`) | `scripts/backup.sh` | Lets a restore skip re-scanning the WhatsApp QR code; not security-critical to lose, just convenient to keep |
| **NFS-stored documents/physical-file scans** | **Not backed up by this script** | This is the bulk of the actual data and it lives on your NFS server - back it up at that layer (your NFS server's own snapshot/backup tooling), not through this app. `scripts/backup.sh` intentionally doesn't try to tar a potentially enormous, someone-else's-infrastructure NFS export. |
| Secrets (`SECRETS_ENCRYPTION_KEY`, `JWT_*_SECRET`, `INTERNAL_WORKER_TOKEN`) | **Not backed up by this script, on purpose** | These live in `.env` / your secrets manager, not in a database dump. A backup archive is exactly the kind of thing that ends up copied somewhere less controlled than the original server - don't put your encryption keys in it. Keep them in whatever secrets manager your organization already uses, separately. |

## Running a backup

```bash
set -a; source .env; set +a
./scripts/backup.sh /path/to/backup/storage
```

Produces one `trafo360-backup-<timestamp>.tar.gz` containing the DB dump plus the two storage
archives described above. Put this on a cron job (daily is reasonable for most deployments; more
often if your document upload volume is high) and make sure `/path/to/backup/storage` is itself
backed up somewhere off the same host - a backup that lives on the same disk as what it's backing up
doesn't protect against disk failure.

**Verification note**: this script's own control flow (argument handling, directory creation, tar
archiving, cleanup) was exercised live with a stubbed `pg_dump` during Phase 8 - confirmed to produce
a correctly-structured archive. The actual `pg_dump`/`pg_restore` invocations were **not** run
against a real Postgres in that environment (no `pg_dump`/`psql` client binaries were available - the
dev database there runs via the `embedded-postgres` npm package, which bundles only the server
binaries it needs to run, not the client tools). Run a real backup-then-restore drill against your
actual deployment before trusting this in production - the SQL itself (`pg_dump --format=custom`,
`pg_restore`) is standard Postgres tooling, but "the script never crashed" isn't the same claim as
"a restored database is actually correct."

## Restoring

```bash
set -a; source .env; set +a
./scripts/restore.sh /path/to/backup/storage/trafo360-backup-20260101-020000.tar.gz
```

This is **destructive** - it drops and recreates the `public` schema on whatever database
`DATABASE_URL` points at before restoring. It prompts for confirmation before doing so. Point
`DATABASE_URL` at a scratch/test database first if you want to verify a backup without touching
production.

After the DB and local-storage/WhatsApp-session restore, it runs `prisma migrate deploy` so a backup
taken from an older version of the app gets its schema caught up to the code you're restoring onto -
useful if you're restoring onto a newer deployment than the one the backup was taken from.

**Separately**, restore your NFS-stored documents from your NFS server's own backup - this script
has no way to do that for you, since it never had access to that data in the first place.

## Restore drill checklist (do this periodically, not just when you actually need it)

1. Take a backup of a real (or realistic test) database.
2. Restore it onto a *different* database (never test a restore against the database you're trying
   to protect).
3. Bring up the app pointed at the restored database and confirm: you can log in, a project you
   expect to see is there, a document's metadata is intact, and (if you back up NFS separately) the
   actual file downloads correctly.
4. Time how long the whole drill took - that's your real recovery-time estimate, not a guess.

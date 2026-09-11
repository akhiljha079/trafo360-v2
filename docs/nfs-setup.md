# NFS Storage Setup

There is no admin-UI form for this one (unlike AD/SMTP/WhatsApp) - NFS is a filesystem mount, not an
API credential, so it's configured at the infrastructure/`.env` level, not the front end. What *is*
manageable from the front end is watching whether it's actually working (see Health below).

## How storage selection works

Every document/physical-file-scan/type-test-certificate upload tries `NFS_MOUNT_PATH` first (a quick
canary write proves the mount is actually responsive, not just present) and falls back to
`LOCAL_STORAGE_PATH` on any failure or timeout - uploads never fail outright just because NFS is
briefly unreachable. A row that landed on local disk gets `storageStatus = LOCAL_PENDING_SYNC`; the
worker process re-probes NFS on its own schedule and, once healthy, copies the file over,
sha256-verifies the copy matches, and only then flips the status to `NFS_STORED` and deletes the
local temp copy. A copy that keeps failing gets `SYNC_FAILED` after enough retries and needs manual
attention (see Health below) rather than retrying forever silently.

## Setup

1. Export a directory from your NFS server for this app - a dedicated export, not a shared one other
   systems also write to (this app doesn't namespace within the mount beyond its own
   `projects/<projectNo>/...` / `certificates/...` structure, and doesn't expect other files to show
   up there).
2. Mount it wherever `NFS_MOUNT_PATH` points - for a bare-metal/VM deployment, an entry in
   `/etc/fstab` and a real `mount`; for Docker Compose, see `docs/deployment.md` section 4 for binding
   a real NFS export into the `nfs_storage` volume (by default it's just local disk inside a named
   Docker volume, which works but isn't actually NFS).
3. Make sure the user the `api`/`worker` processes run as can read and write the mount - a `no_root_squash`-
   style permission mismatch (common with NFS) is the most likely first failure mode, and shows up as
   every upload silently falling back to local storage rather than an obvious error.
4. Confirm it's actually being used: upload a test document, then check its `storageStatus` came back
   `NFS_STORED` (via `GET /api/documents/:id` or the Document Library detail view) rather than
   `LOCAL_PENDING_SYNC`.

## Health / troubleshooting

`GET /api/storage/health` (requires `storage.manage`) reports NFS online/offline, document counts by
storage status, total storage used, and last successful/failed sync timestamps. **No admin page
renders this yet** - the architecture plan called for a storage-health dashboard and only the API
side of it got built (a real, honest gap - see `docs/BUILD_PROGRESS.md`'s Known Gaps). Until a UI
page exists, check it directly:

```bash
curl -b <your session cookie> https://your-domain/api/storage/health
```

A nonzero `syncFailedDocuments` count means something needs a look - check the worker process logs
(`docker compose logs worker` under Compose) for the actual sync error, which is usually a
permissions or connectivity problem at the NFS layer rather than anything in the app itself, since
the app's own checksum-verify-then-flip logic has been exercised live (see
`docs/BUILD_PROGRESS.md`'s Phase 4 notes: a real `chmod 000`/`chmod 755` outage-then-recovery test).

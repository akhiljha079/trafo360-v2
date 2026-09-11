# Deployment

Production deployment via Docker Compose - `docker-compose.yml` builds four containers (`postgres`,
`api`, `worker`, `web`, plus `nginx` as a reverse proxy) from this repo. If you're deploying to
aaPanel without Docker, see `docs/aapanel-deployment.md` instead - same app, plain Node + PM2. This doc has not been run end-to-end in this
environment (no Docker available in the sandbox this was built in - see `docs/BUILD_PROGRESS.md`'s
Known Gaps), but every file it references has been reviewed line-by-line against what the app
actually needs, and two real bugs were found and fixed doing that review (see the note at the
bottom). Test a full `docker compose up` against this doc before depending on it for a real rollout.

## 1. Prerequisites

- A Linux host (or any Docker-capable host) with Docker + Docker Compose v2.
- A domain name pointed at the host, and a TLS certificate for it (Let's Encrypt via certbot is the
  path `nginx/trafo360.conf.example` assumes).
- An NFS export reachable from the host, if you're using NFS-backed document storage (see
  `docs/nfs-setup.md`) - otherwise everything falls back to local disk (`storage/local/` inside the
  `api`/`worker` containers' `local_storage` volume) and never syncs anywhere else.
- Outbound network access for: AD/LDAP (if used), SMTP (if used), and - only if WhatsApp is
  configured from the admin UI - the ability to run a headless Chromium (the `api`/`worker` base
  image is `node:20-bookworm-slim`, which has the shared libraries Puppeteer needs; no extra install
  required).

## 2. Configure `.env`

Copy `.env.example` to `.env` and fill in every `CHANGE_ME`. The ones that matter most:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Compose overrides the host/port to the `postgres` service automatically - only the password matters here (must match `DB_PASSWORD` below) |
| `DB_PASSWORD` | Not in `.env.example` (compose-only) - set it in the shell environment `docker compose` runs in, or add it to `.env` and reference it there |
| `APP_URL` | The public HTTPS URL - used for the CORS allow-origin and in outbound email links |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `SECRETS_ENCRYPTION_KEY` | `openssl rand -hex 32` each - these are what protect sessions and AD/SMTP passwords at rest, never reuse across environments |
| `INTERNAL_WORKER_TOKEN` | `openssl rand -hex 32` - the worker's shared secret with the API, see below |
| `API_INTERNAL_URL` | Leave as `http://api:4000` under Compose (already set in `docker-compose.yml`'s `worker` service, not `.env`) - only change this if you split api/worker across hosts, in which case it must be a URL the worker container can actually reach |
| `BOOTSTRAP_ADMIN_USERNAME/EMAIL/PASSWORD` | The one local (non-AD) admin account - change the password before first deploy, then change it again from the UI once you're in and disable local login if AD is fully configured |
| `NFS_MOUNT_PATH` | Only meaningful if you bind-mount a real NFS export into the containers at this path (see `docs/nfs-setup.md`) - otherwise leave the default and storage falls back to local |
| `WHATSAPP_SESSION_PATH` | Backed by the `whatsapp_session` named volume already in `docker-compose.yml` - don't change unless you also update that volume mount |

AD/SMTP config (`AD_*`, `SMTP_*`) can be left blank in `.env` and configured entirely from
Administration → AD/LDAP and → SMTP once the app is running - that's the intended path (see
`docs/ad-ldap-setup.md` / `docs/smtp-setup.md`). The `.env` values are only a fallback default.

## 3. Bring up the stack

```bash
docker compose build
docker compose up -d postgres
# Wait for postgres healthcheck to pass, then:
docker compose run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
docker compose run --rm api npx tsx prisma/seed.ts
docker compose up -d
```

The seed step is safe to run more than once (every write is an `upsert`) - re-running it after a
`git pull` that adds new permissions/roles/document types is the normal way to pick those up in an
existing deployment, not just first install.

## 4. NFS mount (if used)

`docker-compose.yml`'s `nfs_storage` volume is a named Docker volume, i.e. local disk, by default -
that's fine for testing but defeats the point of NFS in production. To bind a real NFS export in,
either:

- Mount the NFS export on the **host** first (`mount -t nfs4 nfs-server:/export/trafo360-docs
  /mnt/trafo360-nfs`), then change `nfs_storage` in `docker-compose.yml` to a bind mount:
  ```yaml
  nfs_storage:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/trafo360-nfs
  ```
- Or use Docker's native NFS volume driver directly (`driver: local`, `driver_opts: {type: nfs,
  o: addr=nfs-server,rw, device: ":/export/trafo360-docs"}`), skipping the host-level mount.

Either way, `NFS_MOUNT_PATH` in `.env` should stay `/mnt/company-document-storage` (the path
`docker-compose.yml` mounts the volume at inside the containers) - only the volume's `driver_opts`
change, not the app-facing env var.

## 5. nginx / TLS

`nginx/trafo360.conf.example` is a template, not consumed automatically by `docker-compose.yml`'s
`nginx` service as-is - it currently mounts that exact file read-only, which works for a quick test
but has a placeholder `server_name` and certificate paths. For a real deploy:

1. Get a certificate (`certbot certonly --standalone -d document.yourcompany.com`, or your org's CA).
2. Copy `nginx/trafo360.conf.example` to `nginx/trafo360.conf`, fill in the real domain and cert
   paths, and update `docker-compose.yml`'s `nginx` service to mount `nginx/trafo360.conf` (and the
   cert directory) instead of the `.example` file.
3. `client_max_body_size 200m` in that config must stay in sync with the API's own upload limit
   (`MAX_FILE_SIZE_BYTES` in `documents.service.ts`/`type-test-certificates.service.ts`) - nginx
   rejects an oversized upload before the API even sees it, so if one changes the other should too.

## 6. First login

`https://your-domain/` → login page → the bootstrap admin credentials from `.env`. From there:
Administration → AD/LDAP, SMTP, WhatsApp Web, and Roles/Departments to configure everything else -
nothing past this point requires touching the server again, per the original "everything manageable
from the front end" requirement.

## 7. Updating a running deployment

```bash
git pull
docker compose build
docker compose run --rm api npx prisma migrate deploy --schema=prisma/schema.prisma
docker compose run --rm api npx tsx prisma/seed.ts   # picks up any new permissions/roles/doc types
docker compose up -d
```

## 8. Bugs this review found and fixed (worth knowing about if you'd already deployed an older build)

1. **`apps/api/Dockerfile` and `apps/worker/Dockerfile` were missing `libs/shared/package.json`** in
   their runtime stage - `node_modules/@trafo360/shared` is an npm-workspaces symlink to
   `libs/shared/`, and without its `package.json` (which has the `"main"` field pointing at
   `dist/index.js`), Node can't resolve `require("@trafo360/shared")` at all. Both containers would
   have crashed on boot. Fixed by also copying `libs/shared/package.json` in the runtime stage.
2. **The worker's certificate-expiry check called `http://localhost:4000`** to reach the API - inside
   Docker Compose, `worker` and `api` are separate containers, so "localhost" from inside the worker
   container means the worker container itself, not the api one. Fixed with an `API_INTERNAL_URL` env
   var, defaulting to `localhost` for same-host dev and overridden to `http://api:4000` in
   `docker-compose.yml`'s `worker` service.

See `docs/backup-recovery.md` for backup/restore, `docs/test-plan.md` for what's actually been tested
and how.

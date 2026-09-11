# Deploying on aaPanel (Web UI Walkthrough)

This is the Node/PM2 deployment path, as an alternative to `docs/deployment.md`'s Docker Compose
path. Written to match the same "everything through the aaPanel browser dashboard, Terminal only for
what has no point-and-click equivalent" style as TRAFO 360 v1's guide
(`docs/legacy-reference/TRAFO360_V1_README.md` §2), but this app's topology is meaningfully different
from v1's - v1 was one Express+EJS process with no build step; this app is **three** processes (a
NestJS API, a background worker, and a separately-built React SPA) plus **PostgreSQL** instead of
MySQL, and it does need a build step. Read "Directory layout" below before starting - getting it
wrong is a real security exposure (your `.env` file, JWT secrets, and database credentials sitting in
a public web root), not just a cosmetic mistake.

**Honesty note, matching how the rest of this project's docs are written**: this guide was written by
working through aaPanel's documented, standard features precisely for this app's actual build/run
requirements (verified against the real build output on a real server, just not aaPanel itself - no
aaPanel instance was available in the environment this was built in). The two things flagged as
uncertain below (the worker's port field in the Node Project GUI, and your aaPanel version's exact
reverse-proxy/rewrite field names) both have a Terminal-based fallback that doesn't depend on the GUI
being exactly as described. Walk through this once on a staging domain before trusting it for a real
rollout, and tell whoever maintains this codebase next if a step doesn't match what you see - the
GUI genuinely does vary between aaPanel versions.

## Directory layout (read this first)

```
/www/wwwroot/<your-domain>/          <- the whole repo goes here (git clone or upload)
  apps/web/dist/                     <- built SPA - this is the ONLY part the public web
                                         server should ever serve directly
  apps/api/dist/main.js              <- API process entry point
  apps/worker/dist/main.js           <- worker process entry point
  .env                               <- secrets - must NEVER be web-accessible
  node_modules/, prisma/, ...        <- must NEVER be web-accessible

/www/wwwroot/trafo360-data/          <- OUTSIDE the website folder, on purpose
  local-storage/                     <- NFS-fallback storage
  whatsapp-session/                  <- WhatsApp session files
```

The critical step is in Step 3 below: aaPanel's website **Run Directory** (运行目录/"project
subdirectory") setting gets pointed at `apps/web/dist`, not the site's root folder. This scopes
Nginx's static file serving to just the built SPA - everything else in the repo (`.env`,
`node_modules`, `prisma/`, source code) sits one level up, outside anything Nginx serves, without
needing manual deny rules. **Verify this actually worked** once deployed by opening
`https://your-domain/.env` in a browser - it must 404, not show file contents. Don't skip this check.

## Step 1 - Install prerequisites (App Store)

- **Node.js Version Manager** → install Node **20.x LTS** (this app requires Node ≥20 -
  `package.json`'s `engines` field enforces it).
- **PostgreSQL Manager** (not MySQL - this app uses Postgres/Prisma) - search the App Store for it
  and install. If your aaPanel version doesn't have a PostgreSQL plugin, install PostgreSQL 15+
  yourself via Terminal (`apt install postgresql` or your distro's equivalent) - the app just needs a
  reachable Postgres instance, however it gets there.
- **PM2 Manager** (same as v1's guide) - installed automatically alongside Node.js Version Manager on
  most aaPanel versions; install separately if you don't see it.

## Step 2 - Create the database (Database, or Terminal if no PG plugin)

Via the PostgreSQL Manager plugin (if installed): **Database** → **Add database** → name `trafo360`,
generate a strong password, save it.

Via Terminal (if no plugin):
```bash
sudo -u postgres psql -c "CREATE USER trafo360 WITH PASSWORD 'a-strong-generated-password';"
sudo -u postgres psql -c "CREATE DATABASE trafo360 OWNER trafo360;"
```
Either way, you'll need `postgresql://trafo360:<password>@127.0.0.1:5432/trafo360?schema=public` for
`DATABASE_URL` in Step 4.

## Step 3 - Create the website and upload the code

1. **Website** → **Add site**. Domain: your real domain. Uncheck Database (already made one) and FTP
   unless you want it.
2. **Files** → the new site folder → delete the default `index.html`.
3. Get the code in, same two options as v1's guide:
   - **Upload a zip**: zip this repo on your machine excluding `node_modules/` (rebuilt on the server
     in Step 5) and `storage/local`, `storage/nfs-mock`, `storage/whatsapp-session` (runtime state,
     not code) - upload, then right-click → **Decompress**.
   - **Git clone**: **Terminal** → `cd /www/wwwroot/<your-domain> && git clone <your-repo-url> .`
4. Create the data directory referenced above, outside the website folder:
   ```bash
   mkdir -p /www/wwwroot/trafo360-data/local-storage /www/wwwroot/trafo360-data/whatsapp-session
   ```
5. **Website** → your site → **Settings** → find the **Run Directory** (sometimes labeled "project
   subdirectory" or shown as a dropdown of folders under the site root) → set it to `apps/web/dist`.
   This won't have anything in it yet - that's fine, it'll exist after Step 5's build. If your
   aaPanel version doesn't expose this setting on the Website Settings page, it's usually under
   **Node Project** setup instead (some versions only show Run Directory once a Node project or PHP
   project is attached) - or edit the site's Nginx config directly (**Website** → your site →
   **Config**) and change the `root` directive to point at the full path ending in `apps/web/dist`.

## Step 4 - Configure environment (Files' built-in editor)

1. **Files** → the site folder → rename `.env.example` to `.env` (or upload one).
2. Edit it:

| Variable | Set to |
|---|---|
| `DATABASE_URL` | `postgresql://trafo360:<password>@127.0.0.1:5432/trafo360?schema=public` from Step 2 |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://your-domain` (revisit after Step 7's SSL is issued) |
| `API_PORT` | `4000` (or any free port - just stay consistent with Step 6) |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` - both processes run on the same server here, so `localhost` is correct (this differs from the Docker Compose path, where it has to be the container name instead) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `SECRETS_ENCRYPTION_KEY` / `INTERNAL_WORKER_TOKEN` | Generate each with `openssl rand -hex 32` in Terminal - never reuse across environments |
| `BOOTSTRAP_ADMIN_USERNAME` / `EMAIL` / `PASSWORD` | Your first login - change the password after first login |
| `NFS_MOUNT_PATH` | Only if you're mounting a real NFS export (see `docs/nfs-setup.md`) - otherwise leave it pointed at a local path and storage falls back to local disk automatically |
| `LOCAL_STORAGE_PATH` | `/www/wwwroot/trafo360-data/local-storage` (Step 3.4) |
| `WHATSAPP_SESSION_PATH` | `/www/wwwroot/trafo360-data/whatsapp-session` (Step 3.4) |
| `SMTP_*`, `AD_*` | Leave blank - configure both from the app's Administration pages after first login, per the original "everything manageable from the front end" design |

3. Save.

## Step 5 - Install, build, migrate, seed (Terminal)

```bash
cd /www/wwwroot/<your-domain>
npm ci
npx prisma generate --schema=prisma/schema.prisma
npm run build
npx prisma migrate deploy --schema=prisma/schema.prisma
npx tsx prisma/seed.ts
```

`npm run build` compiles all three TypeScript packages and builds the SPA (`apps/web/dist` now
exists - the Run Directory from Step 3 now has something to serve). This takes a few minutes; it's
normal for `npm ci` to be the slowest part. `npx tsx prisma/seed.ts` is always safe to re-run later
(every write is an upsert) - do it again after any future `git pull` that adds permissions/roles/
document types.

If WhatsApp will be used, no extra install is needed - Puppeteer downloads its bundled Chromium
during `npm ci` automatically (needs outbound internet access, which almost all VPS/aaPanel servers
have). If Chromium fails to launch later (Administration → WhatsApp Web → Connect times out), your
base OS may be missing shared libraries Chromium needs - see `docs/whatsapp-setup.md`'s
troubleshooting section; installing them is a one-line `apt install` in Terminal, distro-dependent.

## Step 6 - Run the API and worker (Node Project)

**Website** → **Node Project** tab → **Add Node Project**, twice - once per process:

**API:**
- Project directory: `/www/wwwroot/<your-domain>` (the repo root, **not** a subfolder - this matters:
  both the API's `.env` loading and npm-workspace module resolution depend on running from here)
- Startup file: `apps/api/dist/main.js`
- Node version: the 20.x LTS from Step 1
- Port: `4000` (must match `API_PORT` in `.env`)
- Startup mode: **PM2**
- Run command: `node apps/api/dist/main.js` (equivalent - some aaPanel versions default this from
  the startup file automatically)

**Worker:**
- Project directory: same repo root - `/www/wwwroot/<your-domain>`
- Startup file: `apps/worker/dist/main.js`
- Port: the worker never listens on a port at all (it's a background job loop, not an HTTP server) -
  aaPanel's form likely still requires one; enter any free port (e.g. `4100`) purely to satisfy the
  form. **This is the one part of this guide not verified against real aaPanel behavior**: if aaPanel
  treats "nothing listening on that port" as a failed health check and won't show the project as
  running, use the Terminal fallback below instead - the process itself works either way (verified
  directly - see "How this was verified" in `docs/BUILD_PROGRESS.md`).
- Startup mode: **PM2**

**Terminal fallback for the worker** (guaranteed to work regardless of the GUI's port handling):
```bash
cd /www/wwwroot/<your-domain>
pm2 start apps/worker/dist/main.js --name trafo360-worker
pm2 save
```
`pm2 save` plus aaPanel's PM2 Manager plugin (which sets up PM2's own boot-persistence) means it
survives a server reboot. Use `pm2 logs trafo360-worker` to check on it, `pm2 restart
trafo360-worker` after a code update.

Click **Submit** then **Start** on both from the GUI (or confirm via `pm2 list` in Terminal). If a
project won't start, click **Logs** on it - the two most common first-run errors are a typo in `.env`
and a database connection failure (wrong `DATABASE_URL` password from Step 2).

## Step 7 - Reverse proxy + SSL

1. **Website** → your site → **Settings** → **Reverse Proxy** → **Add Reverse Proxy**:
   - Target URL: `http://127.0.0.1:4000`
   - Proxy directory: `/api` (this is what scopes the proxy to only `/api/*` requests - everything
     else keeps being served as static files from the Run Directory set in Step 3, which is what
     lets one site serve both the SPA and the API without them colliding). If your aaPanel version's
     reverse proxy panel doesn't have a "Proxy directory" field, add this to the site's Nginx config
     directly instead (**Website** → your site → **Config**):
     ```nginx
     location /api/ {
         proxy_pass http://127.0.0.1:4000/api/;
         proxy_http_version 1.1;
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto $scheme;
     }
     ```
     (This is the same block `nginx/trafo360.conf.example` uses for the Docker path - copy it
     verbatim if you're editing the config directly.)
2. The SPA needs one more thing static file serving doesn't give you for free: client-side routing
   fallback (so refreshing on `/projects/abc123` doesn't 404). **Website** → your site → **Rewrite**
   → paste a custom rule, or add directly to the site config:
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
3. Also in the site's Nginx config, set the upload size limit to match what the app itself allows
   (200MB for documents, 50MB for type test certificates - nginx's limit should be at least the
   larger of the two so it never rejects an upload the app would have accepted):
   ```nginx
   client_max_body_size 200m;
   ```
4. **SSL** → **Let's Encrypt** → select the domain → **Apply**. Toggle **Force HTTPS** once issued.
5. Update `APP_URL` in `.env` to the final `https://` address, then restart the API project (Step 6)
   for the change to take effect (it's read at process startup, not per-request).

## Step 8 - Verify, then first login

Before logging in, check the security-critical thing from "Directory layout" above:

```bash
curl -I https://your-domain/.env
```
Must return `404`. If it returns `200` and shows file contents, the Run Directory (Step 3.5) isn't
actually scoping Nginx correctly - fix that before doing anything else; don't put real credentials
into an admin session on a server that's currently leaking its own `.env`.

Then:
```bash
curl https://your-domain/api/health
```
Should return `{"status":"ok","db":true,...}`. If it doesn't, check the API's PM2 logs (Step 6).

Log in at `https://your-domain/` with the bootstrap admin credentials from `.env` (Step 4), then work
through `docs/admin-manual.md`'s "Initial setup order" - AD/LDAP, SMTP, WhatsApp, notification rules,
and your first workflow template, all from Administration, no further server access needed.

## Updating a running deployment

```bash
cd /www/wwwroot/<your-domain>
git pull
npm ci
npx prisma generate --schema=prisma/schema.prisma
npm run build
npx prisma migrate deploy --schema=prisma/schema.prisma
npx tsx prisma/seed.ts
```
Then restart both Node projects from the **Node Project** tab (or `pm2 restart trafo360-api
trafo360-worker` if you used the Terminal fallback for either).

## Backups

Same `scripts/backup.sh`/`scripts/restore.sh` as the Docker path - see `docs/backup-recovery.md`.
They need real `pg_dump`/`pg_restore`/`psql` on the `PATH`, which the PostgreSQL Manager plugin (or a
system `apt install postgresql-client`) provides - unlike the sandbox this app was built in, which
had neither (see that doc's verification note).

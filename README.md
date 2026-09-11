# TRAFO 360 v2

Manufacturing project workflow & document management system - NestJS + PostgreSQL/Prisma backend,
React + TypeScript + Ant Design frontend, self-hosted.

Full rewrite of TRAFO 360 v1 (see `main` branch) onto an enterprise stack: AD/LDAP auth, configurable
multi-stage workflows with document approval chains, confidentiality-tiered access control, NFS
document storage with local fallback and background sync, physical file tracking with QR/labels,
email/WhatsApp notifications, and a Type Test Certificate registry with automatic expiry reminders.

## Docs

Start with `docs/BUILD_PROGRESS.md` for the full build history, what's verified and how, and known
gaps - it's the single source of truth for "where does this project actually stand."

- `docs/architecture.md` - stack, module list, permission model, storage/workflow design
- `docs/deployment.md` - Docker Compose production deployment walkthrough
- `docs/aapanel-deployment.md` - Node/PM2 deployment walkthrough for aaPanel (no Docker)
- `docs/ad-ldap-setup.md`, `docs/smtp-setup.md`, `docs/nfs-setup.md`, `docs/whatsapp-setup.md` -
  per-integration setup guides (all configured from the admin UI, not server config, except NFS)
- `docs/backup-recovery.md` - backup/restore scripts and drill checklist
- `docs/admin-manual.md`, `docs/user-manual.md` - how to actually use the app
- `docs/test-plan.md` - what's automated, what's been verified live, and known coverage gaps
- `docs/permission-matrix.md` - generated (`node scripts/gen-permission-matrix.mjs`), don't hand-edit

## Local development

Requires Node 20+. No Docker/system Postgres needed for local dev - `embedded-postgres` runs a
self-contained Postgres with no sudo/system install.

```bash
npm install
node scripts/dev-postgres.mjs start   # starts a local embedded Postgres
cp .env.example .env                   # then fill in dev-appropriate values
npm run prisma:migrate
npm run prisma:seed
npm run dev:api      # apps/api,    http://localhost:4000
npm run dev:worker   # apps/worker, background jobs
npm run dev:web      # apps/web,    http://localhost:5173 (proxies /api to :4000)
```

Bootstrap admin credentials are whatever you set in `.env` (`BOOTSTRAP_ADMIN_USERNAME`/`PASSWORD`).

```bash
npm run typecheck   # all four workspaces
npm run test         # apps/api unit tests + libs/shared
```

## Production deployment

Two paths, pick one:

- **Docker Compose** - see `docs/deployment.md`. Not Docker-tested in the environment this was built
  in; reviewed line-by-line instead (two real bugs found and fixed that way - see that doc's
  section 8). Run a real `docker compose up` before depending on this for production.
- **aaPanel / bare Node + PM2** - see `docs/aapanel-deployment.md`. The production build
  (`npm run build` then `node apps/api/dist/main.js` / `node apps/worker/dist/main.js`) was verified
  live during Phase 8 - see `docs/BUILD_PROGRESS.md`.

## Repository layout

```
apps/api      NestJS backend (REST API)
apps/worker   Background jobs (storage sync, overdue detection, certificate expiry reminders)
apps/web      React + Vite frontend
libs/shared   Types/constants shared between api, worker, and web
prisma        Schema, migrations, seed data
docs          Everything above
scripts       Dev Postgres, backup/restore, permission-matrix generation
```

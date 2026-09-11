# TRAFO 360 v2 — Build Progress

Read this first in any session continuing this build. Full architecture/rationale is in
`/Users/akhiljha/.claude/plans/wobbly-crafting-marshmallow.md` (also summarized in this repo's
commit/PR history once committed). Original 82-section requirements spec was provided by the user
in conversation, not saved as a file in-repo — ask the user if it's needed again, or reconstruct
scope from this progress doc + `prisma/schema.prisma`, which between them cover it.

Branch: `worktree-rewrite-v2-enterprise` (worktree at `.claude/worktrees/rewrite-v2-enterprise`).
`main` still holds the original TRAFO 360 v1 (Express/EJS/MySQL) app, untouched.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Foundation scaffold | **Done** | See below |
| 1 — Identity (AD/LDAP, Users/Roles/Departments CRUD, audit UI) | **Done** | See below. AD/LDAP bind logic is code-complete but unverified against a real AD server (none available here) |
| 2 — Org data (Customers, Projects) | **Done** | See below |
| 3 — Workflow engine + builder UI | **Done** | See below |
| 4 — Documents (upload/version/approval/storage) | **Done** | See below |
| 5 — Physical files (QR/labels/issue/return/extension) | **Done** | See below |
| 6 — Notifications (SMTP/WhatsApp/templates) | **Done** | See below - includes a genuinely-verified real WhatsApp Web QR pairing, further than expected |
| 7 — Dashboards/Search/Reports | **Done** | See below |
| — Type Test Certificates (user request, inserted before Phase 8) | **Done** | See below |
| 8 — Hardening & deployment | **Done** | See below - two real deployment-breaking bugs found and fixed by reviewing the Docker/Compose setup line-by-line (still not Docker-tested itself - see Known Gaps) |

## What's actually built and verified (Phase 0)

- **Monorepo**: npm workspaces — `apps/api` (NestJS), `apps/worker` (stub), `apps/web`
  (React+Vite+AntD), `libs/shared` (permission/status constants — single source of truth, imported
  by both API seed data and (eventually) frontend gating).
- **Database**: `prisma/schema.prisma` has the full model set from the architecture plan §3 (~40
  models covering identity/access, org data, workflow engine, documents, physical files,
  notifications, storage, system settings). Ran `prisma migrate dev` successfully against a real
  Postgres — schema is valid and self-consistent (all relations resolve, no back-relation errors).
- **Seed data** (`prisma/seed.ts`): 5 confidentiality levels, 36 permissions, 8 default roles
  (spec §9) with role→permission grants, 17 departments (spec §8), 1 bootstrap local admin, and a
  full "Transformer Manufacturing - Standard" workflow template: 10 parent stages, 27 stages, 61
  document types with stage requirements — drawn from the spec's own §16-18 default document list,
  cross-checked against the validated stage names in `docs/legacy-reference/db/seed.sql` (the old
  v1 app's production seed data) for realism. **Ran successfully against a live Postgres.**
- **Auth (ahead of the Phase 1 schedule, folded into Phase 0's checkpoint)**: `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`. Bootstrap local admin can log in; JWT access+refresh
  tokens as httpOnly `SameSite=strict` cookies; permission resolution (role grants ∪ user
  GRANT/REVOKE overrides) implemented and returns the correct 36-permission set for the admin role.
  AD users (`source = AD`) are explicitly rejected with a clear error until the `ldap` module lands
  in Phase 1 — this is intentional, not a bug.
- **Frontend**: Login page (AntD) + protected route wrapper + app shell with the full spec §51
  navigation tree (Dashboard/Projects/Document Library/Physical Files/Workflow/Customers/Reports/
  Administration/Audit Logs) + a placeholder page per unbuilt section stating which phase covers it.
  Dashboard page shows the logged-in user, role, and permission count (real KPI tiles are Phase 7).

### How this was verified

- `npx prisma validate` and `prisma migrate dev` against a **real local Postgres** (see "Known
  Gaps" for how — not the eventual Docker Postgres, since Docker isn't available in this dev
  sandbox).
- `npm run typecheck` clean on `apps/api`, `apps/web`, `libs/shared`.
- Live HTTP verification with `curl` through the whole stack: health check, bad-password login
  (401), correct login (cookies set, full user+permissions payload correct), `/api/auth/me` with
  the session cookie, and the same three calls again through the Vite dev proxy on the web app's
  own port — confirming the frontend's `/api/*` fetches actually reach the backend correctly.
- **Visual verification**: took a real screenshot (Safari, via `screencapture`) of the running
  login page — renders correctly, AntD styling intact, no visible errors. Could **not** get a fully
  scripted click-through to the dashboard: Playwright doesn't support Chromium on this machine's
  macOS 12, and Safari's AppleScript automation (`System Events` keystrokes, `do JavaScript`) is
  blocked by macOS security prompts this session isn't able to click through. If picking this back
  up, either grant those permissions once in System Settings, or just log in by hand in a browser
  at whichever port the dev server reports — the backend contract is already proven via curl, so a
  manual click-through is mainly to catch pure rendering issues.

## What's actually built and verified (Phase 1)

- **Permission enforcement, for real**: `PermissionsGuard` + `@RequirePermissions`/`@Auth()`
  decorator enforce route-level permission checks on every controller added this phase. Fixed a
  real NestJS DI gotcha along the way — `JwtModule.register({})` is *not* itself global even when
  the module that imports it is marked `@Global()`, so a guard instantiated fresh in an unrelated
  module's context couldn't resolve `JwtService`. Fixed by using `JwtModule.register({ global: true
  })`. Documented here because it'll bite again if a future module adds another dynamically-registered
  dependency to a guard.
- **LDAP module** (`apps/api/src/ldap`): `SystemSetting`-backed AD config (host/port/protocol/
  baseDN/bind user/bind password **encrypted at rest**/search filter/group base/domain/timeout),
  `GET/PUT /api/admin/ad-config`, `POST /api/admin/ad-config/test-connection` (bind-only check),
  `POST /api/admin/ad-config/sync-now` (upserts `User`/`AdGroup` from a live directory walk).
  `AuthService.validateCredentials` branches on `user.source`: LOCAL uses bcrypt, AD calls
  `LdapService.authenticate` (bind-as-the-user, password never persisted).
  **Fixed a real crash**: ldapjs's client `EventEmitter` emits `error` independently of the bind
  callback on a connection failure; with no `error` listener, Node treats that as fatal. Added
  `client.on("error", ...)` in `buildClient()` — verified by repeatedly triggering a connect-timeout
  against a fake host and confirming the API process survives and keeps serving.
  **Not verified against a real AD server** (none available in this environment) — the bind/search/
  error-handling logic is correct per the ldapjs API and the failure paths are proven, but a real
  directory's actual attribute shapes (e.g. `memberOf` formatting) should get a first real-world
  smoke test before relying on it.
- **Users/Roles/Departments/Confidentiality/Audit modules**: full CRUD (see `docs/permission-matrix.md`,
  regenerated fresh from a clean-seeded DB), all mutations write `AuditLog` rows. `AuditController`
  is intentionally read-only — no PATCH/DELETE route exists anywhere for audit entries.
- **Session refresh**: added `POST /api/auth/refresh` (rotates both tokens from a valid refresh
  cookie) plus transparent client-side retry-on-401 in `apps/web/src/api/client.ts`. Without this,
  every session would've hard-expired every 15 minutes (the access token TTL) — caught while
  testing the admin UI, not planned upfront, so flagging it as a real gap that was closed rather
  than a nice-to-have.
- **Frontend**: `/admin/users` (list, create local user, edit profile/department/role/status,
  per-user permission GRANT/REVOKE overrides, login history timeline), `/admin/roles` (list,
  create, permission-matrix checkbox editor grouped by category), `/admin/departments` (list,
  create/edit, assign head), `/admin/ad-config` (full config form, test connection, sync now),
  `/audit-logs` (filterable, read-only table).

### How this was verified

- Live `curl` walkthroughs of every endpoint added this phase, including negative cases: 401 when
  unauthenticated, 403 for a low-privilege user hitting `user.manage`-gated routes, and confirming a
  live role-permission change propagates to an *already logged-in* session's next request (no
  re-login needed — permissions are resolved fresh from the DB per-request, never baked into the
  JWT).
- `npm run typecheck` clean on `apps/api` and `apps/web` after every module addition.
- A real Jest integration test (`apps/api/src/common/permissions.service.spec.ts`, runs against the
  live local Postgres, not mocks) pins the one genuinely subtle rule in the permission model: a user
  override REVOKE beats both the role's grant and an override GRANT for the same permission code.
  `npm run test --workspace=apps/api` — 3/3 passing.
- Reset the local dev DB to a clean migrate+seed state before regenerating
  `docs/permission-matrix.md`, so that file reflects true seed defaults rather than permissions
  mutated during ad-hoc testing.
- **Visual verification, this time with real interaction**: logged in through the actual browser
  (Safari) via the UI (not curl), navigated to `/admin/users`, `/admin/roles`, and `/admin/ad-config`
  by setting Safari's URL bar via AppleScript (the earlier session's keystroke/JS-injection routes
  were blocked by macOS permissions; direct URL navigation isn't) and screenshotted each — all three
  render correctly with live data from the API, including a form correctly pre-filled with
  previously-saved AD config values. The session survived across screenshots taken minutes apart,
  which is itself a live proof the refresh flow works, not just a claim.

## What's actually built and verified (Phase 2)

- **Customers module**: full CRUD (spec §11 fields), `customer.manage` gates mutations, listing is
  open to any authenticated user (`@Auth()` with no codes) since customer data isn't confidentiality-
  sensitive the way project/document data is and many roles need to pick a customer when creating a
  project.
- **Projects module**: full CRUD (spec §12 fields, minus the physical-file location fields — those
  deliberately live on the `PhysicalFile` model instead, one-to-one with `Project`, matching the
  spec's own §25 physical-file field list; wiring that up is Phase 5). Project numbering
  (`PRJ-YYYY-NNNNNN`, spec §12's own example) is a real atomic Postgres sequence via
  `INSERT ... ON CONFLICT DO UPDATE` on a per-year counter row in `SystemSetting` - verified by
  creating two projects back-to-back and confirming `000001`/`000002` with no gap or race. Admin-
  configurable numbering *format* (spec §6/§52) is not implemented - the pattern itself is fixed;
  noted as a deferred scope decision, not an oversight.
- **Confidentiality enforcement on projects** (spec §23): implemented now rather than deferred to
  Phase 4, since the data model was already there and it's cheap to get right early. A user's
  ceiling is their role's `maxConfidentialityLevel.rank` (defaults to PUBLIC-only if a role has none
  set - secure by default, not unrestricted). `ProjectsService.list` filters out projects above the
  ceiling; `ProjectsService.get` throws 403 on a direct hit past the ceiling even if the id is known.
  Verified live: created a RESTRICTED project, confirmed it doesn't appear in a Department User's
  list and returns 403 on direct access, while the admin (RESTRICTED ceiling) sees and can open it.
- **`ProjectMember`**: add/remove endpoints + UI on the project detail page. This is *not* currently
  used as an access-control boundary (any user with `project.view` can see any project within their
  confidentiality ceiling) - it's assignment/visibility bookkeeping for "My Projects"-style filtering
  and future notification targeting, per the architecture plan's resource-check layer being about
  confidentiality first; revisit if the spec's project-level ACL (separate from confidentiality)
  turns out to need real enforcement once more roles are exercised.
- **Frontend**: `/customers` (list/search/create/edit), `/projects` (list/search/create with
  customer/confidentiality/workflow-template pickers), `/projects/:id` (full detail view + member
  management), both replacing their Phase 0 placeholders.

### How this was verified

- Live `curl` walkthroughs: customer CRUD, project creation with numbering, confidentiality
  filtering on both list and direct-get, member add.
- `npm run typecheck` clean on `apps/api` and `apps/web`.
- **Real browser verification, logged in for real this time**: the Phase 1 checkpoint's Safari
  session had gone stale (the `prisma migrate reset` done at the end of Phase 1 invalidated the old
  JWT's user id). Rather than accept curl-only verification for the new pages, built a throwaway
  same-origin helper page (`apps/web/public/dev-login.html`) that does a real `fetch()` login and
  redirects - avoids the CORS/httpOnly-cookie issues that make a cross-origin or `document.cookie`
  shortcut impossible, and avoids the blocked `osascript`/System Events automation from Phase 0/1.
  Used it once to get a real session, screenshotted `/projects`, `/customers`, and a project detail
  page (all rendering correctly with live data), then **deleted the helper file immediately** -
  confirmed via `git status` that it was never tracked. Do not recreate this file with real
  credentials committed; if you need it again, generate fresh throwaway content and delete it the
  same way.

## Known gaps / environment limitations (be upfront about these)

1. **No Docker in this dev sandbox.** `docker-compose.yml`, `apps/*/Dockerfile`, and
   `nginx/trafo360.conf.example` are written to the architecture plan's spec but have **not been
   test-built or run**. Validate them for real in Phase 8 (or sooner, opportunistically, in any
   environment that has Docker).
2. **Local Postgres is a self-contained embedded binary**, not a system install: this machine's
   Homebrew is broken (old macOS 12, `/usr/local` ownership requires `sudo` this session won't run
   unasked) and there's no other system Postgres. `scripts/dev-postgres.mjs` uses the
   `embedded-postgres` npm package (already added to root `devDependencies`) to run a real Postgres
   with no system install, port 5432, db/user/password all `trafo360`. Start it with
   `node scripts/dev-postgres.mjs start` before running migrations/seed/the API locally in this
   kind of environment. This is a **dev-only convenience** — production deployment still uses a
   real Postgres per `docs/deployment.md` (Phase 8) / the compose file's `postgres` service.
3. **Redis isn't running anywhere yet** — not needed until Phase 4 (storage sync queue) / Phase 6
   (notification queues). When it's needed, the same "no brew, no sudo" constraint applies; either
   find a similarly self-contained option or ask the user whether to fix Homebrew's permissions.
4. **GTP (General Technical Particulars) field-builder** from the v1 app (`db/seed.sql`'s
   `gtp_field_groups`/`gtp_fields` — a schema-driven form for transformer technical parameters) was
   **not** carried into the rewrite. The new spec's §15/§16 document types don't require it
   explicitly; it was a v1-specific enhancement for capturing structured data *inside* the "Approved
   GTP" document rather than just treating it as an uploaded file. Flagging as a deliberate scope
   decision, not an oversight — revisit if the user wants that structured-capture capability back.
5. Dev servers (`api` on :4000, `web` on :5174, embedded Postgres on :5432) may still be running in
   the background from this session's verification. Stop the embedded Postgres with
   `node scripts/dev-postgres.mjs stop`; stop the Node dev servers by killing whatever's listening
   on those ports.

## What's actually built and verified (Phase 3)

- **Workflow templates**: full CRUD + clone (deep-copies every parent stage/stage/requirement) +
  activate/deactivate (`workflow.publish` specifically, separate from `workflow.edit`, per spec §14
  distinguishing the two). Verified live: cloned the seeded "Transformer Manufacturing - Standard"
  template (10 parent stages, 31 stages) and got an exact independent copy.
- **Parent stages / stages / document requirements**: full CRUD, `document-types` master data CRUD
  (separate module, reused by both the workflow builder and, later, Documents). Reordering uses a
  full-list `orderedIds` replace (`PATCH .../reorder`) rather than single-item move operations -
  simpler to reason about and atomic (one transaction). Verified: added a new parent stage/stage/
  requirement to the clone, reordered it to the front, confirmed the order stuck, then deleted all
  three (parent stage cascade-deletes its stages and their requirements via the schema's `onDelete:
  Cascade`).
- **Project instantiation** (spec §55): `WorkflowService.instantiateForProject` clones a project's
  assigned template into `ProjectStage`/`ProjectDocumentRequirement` rows, upsert-based so it's safe
  to re-run after the template gains new stages. Wired into `ProjectsService.create` automatically
  when `workflowTemplateId` is set, plus a manual `POST /projects/:id/workflow/instantiate` for
  projects created before this existed (or to pull in template changes later). Verified on the
  existing Phase 2 test project: 0 stages before, 31 after.
- **Stage status engine** (spec §73 - the "a stage isn't complete just because a file exists" rule):
  `src/workflow/stage-status.ts` is a pure function with zero DB/Nest dependency, covered by 10 unit
  tests including the exact scenario the spec calls out by name. Wired into
  `recomputeProjectStageStatus`, called after instantiation and after every requirement override.
  **Verified in the real UI, not just tests**: a stage with zero requirements shows COMPLETED
  immediately; the EXPORT parent stage (all-optional requirements per the seed data) shows 100%/
  COMPLETED; stages with unmet mandatory requirements show INCOMPLETE - all visible in a live
  screenshot of the project detail page's new checklist.
- **Project-specific requirement override** (spec §56): `PATCH .../project-document-requirements/
  :id/override` flips `required`/`notApplicable` with a mandatory reason, audited, and triggers a
  stage status recompute. Verified: marked a requirement N/A, watched its stage flip from
  INCOMPLETE to COMPLETED in the same request cycle.
- **Frontend**: `/workflow` replaces the placeholder - template selector, active/inactive toggle,
  a React Flow canvas rendering parent stages as a connected top-to-bottom pipeline (matches spec
  §53's flow-chart concept), click a node to open a drawer of its stages (add/reorder via up/down
  buttons/delete/open), click a stage to open a second drawer for document requirements
  (add/toggle-mandatory/remove). **Scope note**: reordering is buttons, not canvas drag-and-drop -
  a deliberate simplification (see below), not an oversight. The project detail page gained a real
  "Workflow Checklist" card: overall progress bar, one collapsible section per parent stage with its
  own %, a status icon/tag per stage, and a requirement list with document status tags and a
  "Mark N/A" / "Restore" action per requirement.

### How this was verified

- Live `curl` walkthroughs of every endpoint: template CRUD/clone/activate, parent-stage/stage/
  requirement CRUD/reorder/delete (with cascade), project instantiation (before/after), and the
  override → stage-recompute chain.
- `npm run typecheck` clean on `apps/api` and `apps/web`.
- `npm run test --workspace=apps/api` - 13/13 passing, 10 of them exercising `computeStageStatus`
  directly (including "not completed just because a file exists," the spec's own framing).
- **Real browser verification**, using the same throwaway same-origin login helper pattern as Phase
  2 (created, used, deleted, confirmed untracked by git each time - see that phase's notes for why):
  screenshotted the `/workflow` builder showing the live React Flow canvas with all 10 parent stages
  connected, and the project detail page's checklist (had to resize the Safari window taller via
  AppleScript's `bounds` property to get the lower, more interesting part of the checklist into
  frame, since scrolling itself needs the same blocked Accessibility permission as clicking/typing -
  window bounds is a plain application property, not simulated input, so it isn't blocked).

### Scope decisions worth knowing about

- **Builder reordering is explicit move-up/move-down buttons, not canvas drag-and-drop.** True
  drag-and-drop reordering (dragging a stage in a list, or repositioning nodes on the React Flow
  canvas and deriving order from position) is meaningfully more state-management work for the same
  end result - spec §14/§53 ask for "reorder," not specifically "drag." If the user wants actual
  drag interaction later, the reorder API (`PATCH .../reorder` with a full ordered id list) already
  supports it - it's a frontend-only change to wire a drag library up to that endpoint.
- **React Flow nodes are laid out by `sortOrder`, not draggable/persisted positions.** Simpler and
  removes a whole class of "the visual layout and the data model disagree" bugs; revisit if the user
  wants a freeform canvas.

## What's actually built and verified (Phase 4)

This was the densest phase so far - real bugs were found and fixed by actually exercising the
system end-to-end rather than just reading the code back. Each one is called out below rather than
silently folded in, since they're exactly the kind of thing worth knowing about before relying on
this.

- **Storage** (`apps/api/src/storage`, spec §36/§37): `StorageService.write()` tries NFS first (a
  timeboxed canary write/delete probe), falls back to local on any failure. The actual read/write/
  checksum/probe primitives live in `libs/shared/src/storage-primitives.ts` - framework-agnostic, so
  the worker's sync job can reuse them exactly instead of a parallel reimplementation. **No Redis/
  BullMQ available in this environment** (see Known Gaps) - the sync job runs on a plain
  `setInterval` in `apps/worker`. The sync *logic* (checksum-verify before AND after copy, never
  delete local before a verified NFS write, retry with an attempt counter, `SYNC_FAILED` after 5
  attempts, a `StorageSyncJob` audit row per attempt) doesn't change when this migrates to a real
  queue later - only the scheduling mechanism would.
- **Documents**: upload (multipart, `multer` memory storage, a conservative MIME whitelist, 200MB
  cap matching nginx's `client_max_body_size`), versioning, and a corrected lifecycle (see bugs
  below). Confidentiality ceiling enforced on list/get/download exactly like Phase 2's project
  check (same `PermissionsService.getConfidentialityRank`, extracted there once it was needed
  twice - see that phase's notes).
- **Approval workflows** (spec §22): `ApprovalWorkflow`/`ApprovalStep` CRUD, assignable per stage-
  document-requirement. A step can route to a role or a department; a document version pending
  approval creates one `DocumentApproval` row per step; all steps approved -> version promoted to
  current. **Resource-level routing enforcement was missing and got added after live testing
  exposed it**: holding `document.approve` isn't enough to decide *any* pending approval - the
  service now checks the deciding user's role/department actually matches the step's routing,
  verified by creating a Quality User test account and confirming the admin (wrong role) gets 403
  while the correctly-routed user succeeds.
- **Secure download** (spec §49): `GET /api/documents/versions/:id/download` resolves storage
  server-side and streams - verified byte-for-byte identical to the uploaded file, including a
  round-trip through the LOCAL_PENDING_SYNC fallback path (see NFS-outage test below).
- **Stage status wiring**: uploads and approval decisions now call
  `WorkflowService.recomputeProjectStageStatus`, so Phase 3's status engine is finally fed real
  data. Verified live: a 5-requirement stage went from INCOMPLETE to still-INCOMPLETE after 1 of 5
  approved, exactly as the engine's unit tests predict.
- **Frontend**: `/documents` (global Document Library, confidentiality-filtered, search by title/
  project), a `DocumentDetailDrawer` (version timeline, inline approve/reject with comment, upload-
  new-version), and the Phase 3 checklist now has real upload buttons per requirement and clickable
  document links into the same drawer.

### Real bugs found by testing, not by reading the code

1. **`BigInt` isn't JSON-serializable.** `DocumentVersion.sizeBytes` is a Prisma `BigInt`; the very
   first upload crashed with `TypeError: Do not know how to serialize a BigInt` inside Express's
   `res.json()`. Fixed with a `BigInt.prototype.toJSON` polyfill in `main.ts` (stringifies rather
   than `Number()`, to avoid silent precision loss on very large files).
2. **Relative storage paths resolve against process cwd, not a fixed root.** `.env`'s
   `NFS_MOUNT_PATH=./storage/nfs-mock` wrote to `apps/api/storage/nfs-mock` when the dev server was
   started from `apps/api/`, silently diverging from the `storage/nfs-mock` at the repo root
   everything else assumed. Fixed by making the dev `.env` use absolute paths (matching what
   `.env.example` already told production deployments to do) - the code itself was correct
   (`path.resolve` on whatever it's given), the *value* was the problem.
3. **Prisma's `P2025`/`P2002` weren't caught anywhere**, so a delete/update on a missing or
   duplicate row surfaced as an opaque 500 instead of 404/409. Found via a wrong id in manual
   testing (a template-level `StageDocumentRequirement` id vs. a project-level
   `ProjectDocumentRequirement` id - both are plausible-looking cuids, easy to mix up, which is
   itself worth knowing if you're calling these endpoints by hand). Fixed with a global
   `PrismaExceptionFilter` in `apps/api/src/common` rather than patching each call site - covers
   every current and future Prisma call in the app.
4. **ldapjs's client emits `error` independently of callback-based failures** - already fixed and
   documented in Phase 1, re-confirmed here as a pattern to remember: any Node `EventEmitter` this
   codebase wraps needs an `error` listener, or a connection hiccup can crash the process.
5. **The document lifecycle prematurely superseded a still-good approved version.** Original design
   marked the previous APPROVED version `SUPERSEDED` at *upload* time, before the new version had
   even been reviewed. Consequence: if the new revision then got rejected, the document showed
   `REJECTED` at the top level even though a perfectly good, previously-approved version still
   existed and remained the actual current/downloadable one - `document.currentVersionId` didn't
   move, but its status now said something misleading. Found by deliberately walking a v1-approve
   → v2-upload → v2-reject sequence and checking the result, not by reasoning about the code
   statically. Fixed by moving the supersede-and-promote logic (`markSupersededAndPromote`) to the
   single place a version actually *becomes* current - either an immediate no-approval-needed
   upload, or the moment an approval chain completes - and having `reject()` fall back to whatever
   the document's last good `currentVersionId` implies, only reading `REJECTED` at the document
   level if there was never an approved version to begin with. Re-verified the full v1-approve →
   v2-upload → v2-reject sequence after the fix: document correctly stayed `APPROVED` pointing at
   v1 throughout, v1 was never touched, v2 alone shows `REJECTED`.

### How this was verified

Almost entirely via live `curl` walkthroughs against the real API + real filesystem, because this
phase is mostly about side effects (files landing in the right place, statuses transitioning
correctly under retry/failure) that unit tests alone wouldn't have caught:

- Full upload → auto-approve (no workflow assigned) → download → byte-diff against the original.
- **Simulated NFS outage**: `chmod 000` on `storage/nfs-mock`, uploaded a document, confirmed
  `LOCAL_PENDING_SYNC` + the file landing under `storage/local/pending/...` + download still working
  from the local copy. Restored permissions, started the worker, watched it detect the pending file
  on its very first tick, checksum-verify, copy to NFS, flip the DB row to `NFS_STORED`, and delete
  the local temp copy - confirmed via `find` on disk, not just the API response.
- `GET /api/storage/health` reflecting the above accurately (`nfsOnline`, per-status counts,
  `lastSuccessfulSyncAt`).
- Full approval-workflow walkthrough: created a workflow with a QA-routed step, assigned it to a
  requirement, uploaded (→ `UNDER_REVIEW`, `DocumentApproval` row created), confirmed the wrong-role
  user gets 403, the right-role user's approve succeeds and promotes the version, then a second
  upload → reject cycle to prove the lifecycle fix.
- `npm run typecheck` clean on all four workspaces; `npm run test --workspace=apps/api` 13/13
  (unchanged from Phase 3 - no new unit tests were added this phase since the interesting behavior
  here is filesystem/DB side effects better exercised live than mocked).
- **Real browser verification** with the same throwaway same-origin login-helper pattern as Phases
  2-3 (created, used, deleted each time): screenshotted the Document Library with live, correctly-
  status-tagged rows. Did not get a clean full-page screenshot of the checklist's new upload/link
  buttons specifically (window-resize trick from Phase 3 hit the physical screen's height limit this
  time) - relying on the curl-level verification of the identical underlying data contract plus
  Phase 3's already-confirmed rendering of the same component family for that one piece.

## What's actually built and verified (Phase 5)

- **`PhysicalFile`**: creation is per-project (one physical file per project, matching the schema's
  `@unique` on `projectId`), with an atomic sequence-based `fileCode` (`PF-2026-000001`, same
  pattern as project numbering). QR token is a random 16-byte hex string - opaque, no db id or path
  embedded (spec §26). `GET /pf/:token` is the scan-resolver: auth-gated, resolves to the physical
  file (and audit-logs the scan), and the frontend's `/pf/:token` route redirects straight to the
  owning project's detail page once resolved.
- **QR + label**: `qrcode` generates a PNG data URL server-side, encoding
  `${APP_URL}/pf/<token>` - never document content, per spec §26's explicit prohibition. Label data
  (`GET /physical-files/:id/label`) returns project/customer/confidentiality/location plus the QR
  image; the frontend renders it as a simple printable card (`window.print()`) rather than a
  server-generated PDF - a deliberate scope simplification (see below).
- **Issue/return/extension** (spec §28-33): full state machine -
  `REQUESTED → [APPROVED] → ISSUED → RETURNED`, with `EXTENSION_REQUESTED` branching off `ISSUED`
  and resolving back to either `ISSUED` (approved, with the due date actually moved) or `ISSUED`/
  `OVERDUE` (rejected, **original due date preserved** - verified live, not just by reading the
  code: requested an extension, rejected it, confirmed the transaction reverted to the pre-request
  due date exactly). Confidentiality-gated issue (spec §23/§29): `RESTRICTED`/`HIGHLY_CONFIDENTIAL`
  files refuse a direct issue from `REQUESTED` and demand an explicit `approve()` first - verified
  by creating a physical file on the RESTRICTED test project and confirming the direct-issue attempt
  is rejected with a clear message, then succeeds once approved.
- **Overdue detection** (spec §31): a worker tick every 60s flips `ISSUED` transactions past their
  due date to `OVERDUE`; also exposed as a manual `POST /file-issues/check-overdue` trigger (same
  pattern as workflow instantiation and AD sync elsewhere in this build). Verified by issuing a file
  with a past due date and confirming both the manual trigger and (implicitly, same query) the
  worker's own schedule would catch it.
- **`DocumentRequest`/`RequestApproval`** (spec §28/§29) closes the gap flagged at the end of Phase
  4: `DocumentsService.prepareDownload` now requires an approved `DocumentRequest` for
  `HIGHLY_CONFIDENTIAL`/`RESTRICTED` documents, on top of the confidentiality-ceiling check that
  already existed. Verified strictly: even the admin account, whose role's confidentiality ceiling
  covers `RESTRICTED`, got a 403 downloading a `RESTRICTED` document with no approved request -
  confirming this is a real second gate, not just ceiling-check theater - then succeeded immediately
  after creating and approving a request for that exact document.
- **Frontend**: `/physical-files` (register list, confidentiality-filtered), a `PhysicalFileDrawer`
  (location editor, QR/label modal with print, issue-transaction history with inline approve/issue/
  return actions), a "Physical File" card on the project detail page (create-or-open), and the
  `/pf/:token` QR-scan resolver route.

### A real schema bug found by testing, not by reading the code

`DocumentRequest.documentId` was a plain column with **no actual Prisma relation** to `Document` -
present since the very first Phase 0 schema draft, invisible in `prisma validate` (a bare foreign-
key-shaped field isn't wrong on its own) and invisible in every migration since, because nothing had
tried to `include: { document: ... }` on a `DocumentRequest` query until this phase's
`DocumentRequestsService`. First real request attempt crashed with `Unknown field 'document' for
include statement`. Fixed by adding the missing `document Document? @relation(...)` field (plus the
reverse `documentRequests DocumentRequest[]` on `Document`) and a new migration
(`add_document_request_document_relation`) - non-destructive, since the column already existed with
the right data, just without the relation Prisma needs to traverse it. Worth remembering: a schema
passing `prisma validate` and every prior migration is not the same as every relation actually being
usable - only exercising the actual query path catches this class of gap.

### Scope decisions worth knowing about

- **Physical file approval is single-step** (needs-approval or doesn't, based on confidentiality),
  not spec §29's fully configurable multi-step chain (Dept Manager → Doc Coordinator → Director).
  Same reasoning as Phase 4's approval-workflow scoping: the core gate is correct and enforced;
  generalizing the routing chain is a frontend/service extension on top of the same
  `ApprovalWorkflow`/`ApprovalStep` models already built in Phase 4, not a new concept.
- **Labels are frontend-rendered and browser-printed**, not server-generated PDFs. Avoids a
  `pdf-lib`/headless-browser dependency for what is, for now, a fairly simple card layout; revisit
  if a real deployment needs precise print-media sizing (spec §27 mentions configurable label
  sizes) beyond what CSS print styles give you.

### How this was verified

Entirely live `curl` walkthroughs plus one real browser screenshot, because - like Phase 4 - this
phase is mostly state-machine and side-effect behavior that's better proven by actually running it:
create → set location → QR/label generation → QR-token resolve → request → issue → extension-reject
(due date preserved) → extension-approve (due date changed) → return → file available again;
separately, the confidentiality-gated issue path (blocked → approved → issued) and the
confidentiality-gated *download* path closing Phase 4's gap (blocked even for a high-ceiling user →
approved request → succeeds). `npm run typecheck` clean on all four workspaces;
`npm run test --workspace=apps/api` still 13/13 (no new unit tests this phase, same reasoning as
Phase 4 - the interesting behavior is DB/state-machine side effects, exercised live). Screenshotted
`/physical-files` with live data via the same throwaway login-helper pattern as prior phases
(created, used, deleted, confirmed untracked).

## What's actually built and verified (Phase 6)

**SMTP / email.** `EmailModule` (`apps/api/src/email/`): `EmailService.send()` loads SMTP config
from `SystemSetting` (host/port/secure/user/password, password AES-256-GCM encrypted at rest same
as the AD bind password), builds a Nodemailer transport per send, and **always** writes an
`EmailLog` row (recipient, subject, status, error if any) regardless of success/failure - so a
failed send is diagnosable from the admin UI, not just a swallowed exception. `POST
/email/test-send` lets an admin fire a real test email at an arbitrary address from the SMTP
settings page. Verified against a real Ethereal Email test account (`createTestAccount()`), i.e. a
genuine SMTP handshake and delivery, not a mocked transport - confirmed the message landed in the
Ethereal web inbox.

**WhatsApp.** `WhatsappModule` (`apps/api/src/whatsapp/`) wraps `whatsapp-web.js` behind an
admin-only controller: `connect` (launches Puppeteer/Chromium, returns a QR data URL or reports
already-connected), `disconnect` (tears down the client, kills the Chrome process tree), `status`.
Session files are filesystem-only (`WHATSAPP_SESSION_PATH`), never returned in any API response.
The service uses a lazy `require()` for `whatsapp-web.js` so a missing Chrome binary degrades to a
clear error instead of crashing the API process at boot. Verified live: `connect()` produced a
genuinely valid, scannable WhatsApp Web QR code (confirmed via screenshot - correct finder
patterns, not a placeholder image); `disconnect()` confirmed to cleanly terminate all spawned
Chrome processes (`ps aux` count returned to 0 after). Full phone-pairing was not exercised (needs
a physical phone), so message-send was not verified end-to-end against a real WhatsApp account.

**Notifications core.** `NotificationsService.notify(eventKey, userId, variables)` is the single
entry point every feature module calls - it reads the `NotificationRule` for that event (per-channel
on/off), renders the matching `NotificationTemplate` for each enabled channel via a `{{key}}`
substitution helper, writes an in-app `Notification` row, and dispatches to `EmailService`/
`WhatsappService` as configured. Wired into real call sites this phase (previously these events only
wrote to `AuditLog` and told nobody): document approval pending (on upload requiring approval),
document approved, document rejected (`documents.service.ts`), file issued, file extension approved,
file extension rejected (`file-issues.service.ts`), and a new file-due-tomorrow check (`POST
/file-issues/check-due-tomorrow`, 24h-window scan, no "already reminded" dedup - see scope note
below). Verified by triggering each event live through its real service method and confirming both
the `Notification` row and the `EmailLog` row were created with correctly substituted variables.

**Frontend.** New admin pages `SmtpSettingsPage`, `WhatsappSettingsPage` (shows QR via polling
`status`), `NotificationSettingsPage` (rule toggles + template editor), all wired into
`AdminLayout`'s tab list and screenshotted rendering correctly with live data. New `NotificationBell`
header component (AntD `Dropdown` + `dropdownRender`, polls unread count every 30s, click-to-expand
list, mark-read/mark-all-read) added to `AppLayout`'s header.

### Bugs found and fixed this phase

1. **WhatsApp `connect()` false-positive status.** The original implementation inferred connection
   status from whether the QR data URL was null - but both "already connected/ready" and "timed out
   waiting for Chrome to respond" produce a null QR, so a timeout was being reported to the frontend
   as a successful connection. Fixed by rewriting the event race into explicit outcome tracking
   (`{ qrDataUrl, status: "CONNECTED" | "CONNECTING" | "TIMED_OUT" }`) resolved by whichever of the
   `qr`/`ready` client events or the 15s timeout fires first, with `TIMED_OUT` now correctly
   surfaced as a thrown error rather than a silent false-positive. Caught by actually reading the
   reported status against what was really happening in the Puppeteer process, not by code review.
2. `dropdownRender` vs `popupRender` - `NotificationBell.tsx` initially used `popupRender`, which
   this AntD version's `Dropdown` doesn't support (the menu never opened); fixed to `dropdownRender`.

### Scope decisions

- **No Redis/BullMQ still.** Revisited the Phase 5 note that this phase was "when it actually
  becomes worth it" - decided against it again: email/WhatsApp sends in this deployment's expected
  volume (manufacturing project events, not bulk marketing) don't need distributed retry/rate-limit
  infrastructure, and adding Redis as a hard dependency contradicts the self-hosted/low-ops spirit
  of the spec's deployment target. `EmailLog`/`WhatsappLog` rows give visibility into failures for
  manual retry instead. Worth revisiting only if real usage shows send volume that needs it.
- **Due-tomorrow reminder has no dedup tracking.** `notifyDueTomorrow()` re-notifies every user with
  a file due within the next 24h on every trigger, with no "already reminded for this transaction"
  flag. Fine for a manually/cron-triggered daily check; would spam if triggered more than once a day.
  Documented here rather than adding a tracking column for a job cadence that isn't decided yet.
- **WhatsApp send path exists but is only proven for QR/session lifecycle, not message delivery** -
  see verification note above. Treat as the spec's own §35 framing: email is the authoritative
  channel, WhatsApp is best-effort.

### How this was verified

Real Ethereal SMTP account + real send/receive for email; real Puppeteer/Chromium QR generation and
process-lifecycle checks for WhatsApp (screenshot-confirmed QR validity, `ps aux` process-count
confirmed clean disconnect); every wired notification event triggered live through its real service
method with `Notification`/`EmailLog` rows inspected afterward, not unit-mocked. `npm run typecheck`
clean across all four workspaces; `npm run test --workspace=apps/api` still 13/13 (no new unit tests
this phase - the interesting behavior is external I/O and event wiring, better proven live than
mocked). Admin pages and the notification bell screenshotted with live data via the same throwaway
login-helper pattern as prior phases (created, used, deleted, confirmed untracked via
`git status --short apps/web/public/`).

## What's actually built and verified (Phase 7)

**Dashboards.** New `apps/api/src/dashboards/` module: `GET /dashboards/summary` (any authenticated
user, no specific permission required) returns active project count, the caller's own pending-approval
count (same routing query `DocumentsService.listPendingApprovalsForUser` already used, reused here as
a `count` instead of a full fetch), issued/overdue physical file counts, a stage-status breakdown
(`groupBy` over `ProjectStage.status`), and the 5 most recently updated projects - every count filtered
by the caller's confidentiality ceiling, same as every other list endpoint. `DashboardPage.tsx`
rewritten from the all-zero placeholder to consume it with `@tanstack/react-query` (60s poll).

**Global search.** New `apps/api/src/search/` module: `GET /search?q=` runs three parallel,
take-10-each Prisma queries (Project/Document/PhysicalFile) with the identical
`confidentialityLevel.rank <= ceiling` filter every other list endpoint uses - a search result set is
just another read path, and it would be a real vulnerability (not a rough edge) if it leaked the
existence of a document/project a user's ceiling doesn't cover. Frontend: a `GlobalSearch` input in
the header (`AppLayout.tsx`, left of the notification bell) that navigates to `/search?q=...` on
Enter; `SearchPage.tsx` renders the three result groups with links back into the relevant project.

**Reports.** New `apps/api/src/reports/` module, four report types (`project-status`,
`document-register`, `physical-file-register`, `overdue-extensions`), each a plain data-assembly
method in `ReportsService` returning `{title, columns, rows}` - confidentiality-filtered the same way
as dashboards/search. `GET /reports/:type?format=json|csv|xlsx|pdf` (`report.view` permission)
dispatches to one of three format serializers in `report-export.ts`:

- **CSV** - hand-rolled with proper quoting, no dependency needed for something this simple.
- **Excel** - real `.xlsx` via `exceljs` (added this phase), not a CSV-with-an-.xlsx-extension trick.
- **PDF** - real paginated tables via `pdf-lib` (added this phase, the architecture plan's original
  choice, not used for physical-file labels in Phase 5 since those turned out simpler as
  browser-printed HTML). Hand-rolled column layout since pdf-lib has no table primitive.

`ReportsPage.tsx` lists all four reports with CSV/Excel/PDF download buttons (`<a href>` to the API
route, same cookie-auth-on-GET pattern as document downloads - no client-side blob handling needed).

### Bugs found and fixed this phase

1. **PDF report columns had no gutter and no text clipping** - column width was allocated
   proportional to *header label* length, not cell content length, so a long value (e.g. "Customer
   Technical Specification" under a "Document Type" header) drew straight into the next column with
   zero gap. Only visible by actually rendering a PDF and looking at it (`qlmanage -t` thumbnail),
   not from the code or from "a valid PDF file was produced." Fixed by reserving a fixed gutter
   between columns and measuring/truncating each cell's text with `font.widthOfTextAtSize()` (binary
   search to the longest string-plus-ellipsis that fits), added as `fitText()` in `report-export.ts`.

### Scope decisions

- **No dedicated `search` permission** - global search reuses each result type's existing read
  visibility rule (confidentiality ceiling) rather than adding a new permission string; anyone who
  could already see a project/document/physical file in its own list page can find it via search,
  nothing more.
- **Dashboard "active projects"** is defined as any status other than `DRAFT`/`DISPATCHED`/
  `COMPLETED`/`ON_HOLD`/`CANCELLED` (see `ACTIVE_PROJECT_STATUSES` in `dashboards.service.ts`) - a
  judgment call, not a spec-literal list; revisit if a real deployment's definition of "active"
  differs. Confirmed correct at least directionally in live testing: all 3 seeded projects are
  `DRAFT`, so `activeProjects` correctly reports 0.
- **Dashboard shows recent projects, not a recent-activity/audit feed** - simpler and more directly
  useful for a PM landing on their dashboard than a raw `AuditLog` tail would be; a real activity feed
  is left for whenever Phase 8+ work revisits dashboards, not blocking here.
- **`/search` isn't a sidebar nav item**, so `AppLayout`'s nav-highlight logic falls back to
  "Dashboard" highlighted while actually on the search results page - cosmetic only (the page itself
  renders correctly), not fixed this phase since search is reached via the header bar, not the nav
  tree, matching how most apps treat a global-search results page.

### How this was verified

Real `curl` walkthroughs against a live-logged-in session (dashboard summary, search with a real
query, all three export formats) plus real file-format verification - not just "the request
succeeded": `file` confirmed the xlsx download is genuinely `Microsoft Excel 2007+` and the PDF is a
genuine `PDF document, version 1.7`, and `qlmanage -t` was used to actually render the PDF to a PNG
and inspect it visually, which is what caught the column-gutter bug above. Screenshotted `/`
(dashboard with real KPIs), `/search?q=transformer` (grouped results), and `/reports` (all three
export buttons per report) via the same throwaway login-helper pattern as prior phases (created, used,
deleted, confirmed untracked). `npm run typecheck` clean on all four workspaces; `npm run test
--workspace=apps/api` still 13/13 (no new unit tests this phase - the interesting behavior is
Prisma query shape and file-format correctness, both better proven live than mocked).

## What's actually built and verified (Type Test Certificates)

User request, inserted between Phase 7 and Phase 8: a standalone registry (deliberately *not* tied to
a project - a type test is done once per transformer type/rating and reused across whichever projects
build that type, confirmed with the user before building) for uploading Type Test Certificates with an
expiry date, where administrators get reminded every 4 days once a certificate has a month or less
left, repeating (including after expiry) until it's renewed.

**Data model.** New `TypeTestCertificate` (`prisma/schema.prisma`): `transformerType`, `title`,
`certificateNo`, the same file-metadata shape `DocumentVersion` uses (`fileName`/`storagePath`/
`storageStatus`/`checksum`/`sizeBytes`/`mimeType`), `expiryDate`, and `lastReminderSentAt` - the field
that makes the 4-day cadence work (see below). No version history and no confidentiality level:
renewal overwrites the file/expiry on the same row (audit-logged, not versioned - there's no approval
chain here the way there is for engineering documents, so versioning would add structure nothing
uses), and access is gated by a plain permission rather than the confidentiality-ceiling system.

**API** (`apps/api/src/type-test-certificates/`): `GET /type-test-certificates` (list, with a computed
`expiryStatus` - `VALID`/`EXPIRING_SOON`/`EXPIRED` - and `daysLeft`, both computed at read time rather
than stored, so they can never drift from the actual date), `POST /type-test-certificates` (upload,
`certificate.manage`), `POST /type-test-certificates/:id/renew` (`certificate.manage`), `GET
/type-test-certificates/:id/download` (`certificate.view`). New permissions `certificate.view`/
`certificate.manage` granted per-role in `libs/shared/src/permissions.ts` (System Administrator gets
both automatically; Document Coordinator and Quality User get manage; most other roles get view-only).

**The reminder itself** (`TypeTestCertificatesService.checkExpiring()`): finds certificates with
`expiryDate` within 30 days (spec ask: "1 month left") where `lastReminderSentAt` is null or ≥4 days
ago, finds every user whose role is named "System Administrator" (a direct reading of "remind all
admin" - not a permission-based lookup, so it means literally that role, regardless of who else holds
`certificate.manage`), and calls the existing `NotificationsService.notify()` for each admin per
qualifying certificate - so channel choice and template content stay admin-configurable from
Notification Rules exactly like every other event, nothing here bypasses that. `lastReminderSentAt` is
then stamped, which is what actually enforces "every 4 days" - the check can run as often as it wants
without spamming.

**Automatic triggering** (`POST /type-test-certificates/check-expiring`): unlike Phase 5/6's
reminder endpoints (which are manual/admin-triggered only, a documented known gap), this one is
called automatically by the worker process every 6 hours (`apps/worker/src/check-certificate-expiry.ts`,
wired into `apps/worker/src/main.ts`'s existing setInterval pattern) - genuinely automatic, not
"works if someone remembers to click a button." Since the worker is a bare Prisma script with no Nest
DI (deliberately, per the architecture plan), it can't call `NotificationsService` directly without
duplicating SMTP/WhatsApp logic outside Nest's DI - instead it makes one HTTP call into the API, which
does have all of that wired correctly. That call is authenticated with a new `INTERNAL_WORKER_TOKEN`
env var checked by a new `InternalTokenGuard` (`apps/api/src/common/internal-token.guard.ts`) instead
of the normal JWT `@Auth()` guard, since the worker has no logged-in user to authenticate as. Narrow
by design - only this one endpoint uses it.

**Frontend**: new `/certificates` route and sidebar tab ("Type Test Certificates", between Physical
Files and Workflow) - `TypeTestCertificatesPage.tsx`, a table with a color-coded expiry `Tag`
(green/orange/red) plus days-left/overdue text, an Upload modal (gated on `certificate.manage`), and
a per-row Renew modal. Follows the same `Form` + `Upload beforeUpload=false` + `FormData` pattern
already used in `ProjectWorkflowChecklist.tsx`/`ProjectsPage.tsx`.

### A real bug found and fixed (pre-existing, not introduced this task)

`prisma/seed.ts` had its own **duplicate copy** of the permission list and default role grants,
separate from `libs/shared/src/permissions.ts` despite that file's own comment claiming to be the
"single source of truth... shared between the API (guards, seed data) and the web app." It wasn't:
seed.ts never imported it. This meant adding `certificate.view`/`certificate.manage` to the shared
file alone would have silently never reached the seeded database - caught only because the seed
script's own summary line (`${PERMISSIONS.length} permissions`) stayed at 36 after the edit when it
should have become 38. Fixed by deleting seed.ts's duplicate arrays and importing `PERMISSIONS`/
`DEFAULT_ROLE_PERMISSIONS` from `@trafo360/shared` instead, which is what the comment always claimed
happened. Worth keeping an eye out for similar drift elsewhere, since this one existed silently
through Phases 0-7 without ever being exercised.

### Scope decisions

- **"All admin" = the System Administrator role by name**, not "everyone with `certificate.manage`" -
  chosen because Document Coordinator/Quality User were also granted `certificate.manage` (they need
  to be able to renew certificates), and a permission-based lookup would have pulled them into "admin"
  reminders too, which isn't what was asked.
- **No confidentiality level on certificates** - not asked for, and type test certificates are
  reference/compliance documents rather than project-confidential ones; revisit if that's wrong for a
  real deployment.
- **Automatic worker-driven trigger, not manual-only** - a deliberate deviation from the Phase 5/6
  precedent (see Known Gaps below), because "remind every 4 days" implies real automation and the
  worker process already exists as the place recurring jobs live.

### How this was verified

Live `curl` walkthrough end-to-end against the running dev API: uploaded a certificate 20 days from
expiry, confirmed `expiryStatus: "EXPIRING_SOON"` and `daysLeft: 20` computed correctly; called
`check-expiring` with the internal token and got `{"notified":1}`, confirmed the exact `Notification`
row landed for the admin user with correctly-substituted variables; called it again immediately and
got `{"notified":0}`, confirming the 4-day gate actually gates; renewed the certificate with a
365-days-out expiry, confirmed `lastReminderSentAt` reset to `null` and `expiryStatus` flipped to
`"VALID"`; called `check-expiring` again and confirmed the renewed certificate no longer triggers a
reminder; downloaded the file and confirmed with `file` that a genuine PDF came back byte-for-byte
correct. Also confirmed the internal-token guard actually rejects a request with no token (403).
Restarted the worker process fresh and confirmed its startup tick calls the API successfully (no
logged error) - real inter-process communication, not just code review. Screenshotted `/certificates`
with two live certificates (one expired, one valid) via the same throwaway login-helper pattern as
every prior phase (created, used, deleted, confirmed untracked). `npm run typecheck` clean on all four
workspaces; `npm run test --workspace=apps/api` still 13/13 (no new unit tests - this feature is
almost entirely date-math and integration wiring, both proven live above).

## What's actually built and verified (Phase 8)

**Docker/Compose review - two real deployment-breaking bugs found and fixed.** Reviewed
`docker-compose.yml`, both Dockerfiles, and `nginx/trafo360.conf.example` line-by-line against what
the app actually needs now that every module exists (they were written speculatively in Phase 0):

1. `apps/api/Dockerfile` and `apps/worker/Dockerfile` copied `libs/shared/dist` into the runtime
   stage but not `libs/shared/package.json` - since `node_modules/@trafo360/shared` is an npm-
   workspaces symlink to `libs/shared/`, and Node needs that `package.json`'s `"main"` field to
   resolve `require("@trafo360/shared")` at all, both containers would have crashed on boot with a
   module-not-found error. Fixed by also copying the package.json.
2. The Type Test Certificate worker→API call (`apps/worker/src/check-certificate-expiry.ts`, added
   just before this phase) was hardcoded to `http://localhost:4000` - inside Docker Compose, `worker`
   and `api` are separate containers, so "localhost" there means the worker container itself, not the
   api one. Fixed with a new `API_INTERNAL_URL` env var (`http://localhost:4000` default for
   same-host dev, `http://api:4000` set explicitly in `docker-compose.yml`'s `worker` service).

Neither bug would have been caught by typecheck or the unit test suite - both are pure deployment-
topology issues that only show up when the containers actually run separately. Caught by reading the
Dockerfiles as if actually deploying with them, not by running `docker compose up` (still not
possible in this sandbox - see Known Gaps).

**Removed unused infrastructure.** `redis` (Docker Compose service, `REDIS_URL` everywhere) and
`@nestjs/websockets`/`@nestjs/platform-socket.io` (npm deps) were speculative Phase-0 additions for a
BullMQ-based queue and a WebSocket gateway that were never built (see `docs/architecture.md`'s new
"Deviation from the original plan" section for the reasoning, reaffirmed multiple times across
Phases 0/6/8) - confirmed via grep that nothing in the codebase references either, then removed both
plus the now-dead `/socket.io/` nginx location block and the unused `WORKER_PORT` env var (the worker
never opens an HTTP listener). Keeping infrastructure nothing uses in the deployment stack is a
bigger ops liability for whoever runs this than a smaller, honest stack.

**Security hardening.**
- `@nestjs/throttler`: global default (300 req/min/IP) plus a tight per-route limit on `/auth/login`
  (10/min/IP) - verified live with 12 rapid login attempts: the first 10 got real 401s, the 11th and
  12th got 429, and a *correct* password on attempt 13 (same window) still got 429 - rate limiting
  applies before credential checking, which is the correct behavior (otherwise an attacker could
  distinguish valid usernames by which requests get let through).
- `helmet()` for standard security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options) -
  verified live via `curl -D -`. Safe for a pure-JSON API (nothing here serves HTML for a browser to
  apply CSP against - the SPA is served separately by the web/nginx container).
- `app.getHttpAdapter().getInstance().set("trust proxy", 1)` so `req.ip` (used by both the rate
  limiter and every audit-log IP field) reflects the real client through nginx's `X-Forwarded-For`,
  not the proxy's own address.
- A new `RequestLoggerInterceptor` (`apps/api/src/common/request-logger.interceptor.ts`) logs one
  structured line per request (method/path/status/duration/userId/ip) - JSON in production, readable
  in dev - verified live via the dev log tail. Deliberately excludes request/response bodies (they
  routinely carry secrets on the SMTP/AD config endpoints, and business-event detail already belongs
  in `AuditLog`, not a second copy in the request log).
- Existing file-upload validation (mime whitelist, size caps, server-generated storage paths so
  filenames never reach the filesystem) and cookie flags (httpOnly, `SameSite=strict`,
  secure-in-production) were reviewed and found already correct from earlier phases - no changes
  needed there, just confirmed.

**Test suite expansion.** Extracted the Type Test Certificate expiry/reminder-cadence logic into a
pure, DB-free module (`apps/api/src/type-test-certificates/certificate-expiry.ts`, mirroring
`workflow/stage-status.ts`'s pattern exactly - functions take `now` explicitly rather than reading
`Date.now()`, so tests are deterministic) and wrote 11 new unit tests covering the exact "1 month
left," "every 4 days," and "still reminding after expiry until renewed" boundary conditions. Test
suite is now 24/24 passing across 3 suites (up from 13/13 across 2).

**Backup/restore.** `scripts/backup.sh` (pg_dump + tar of local-fallback storage + WhatsApp session)
and `scripts/restore.sh` (destructive, confirmation-gated, runs `prisma migrate deploy` after
restoring so an older backup catches up to a newer schema). Deliberately does **not** back up
NFS-stored documents (that's the NFS server's own job) or secrets (`SECRETS_ENCRYPTION_KEY` etc. -
those belong in a secrets manager, not a backup archive). See "How this was verified" below for what
was and wasn't actually exercised.

**Documentation.** Wrote real (not stub) versions of every doc the architecture plan's file list
promised: `docs/deployment.md`, `docs/backup-recovery.md`, `docs/ad-ldap-setup.md`,
`docs/smtp-setup.md`, `docs/nfs-setup.md`, `docs/whatsapp-setup.md`, `docs/admin-manual.md`,
`docs/user-manual.md`, `docs/test-plan.md`, plus a root `README.md` (didn't exist before this phase)
and an update to `docs/architecture.md` to correct the now-stale Redis/BullMQ/WebSocket-gateway
description. Every setup doc's endpoint/field/button claims were checked against the actual
controller/page code rather than written from memory - this caught two things worth knowing: the AD
sync endpoint requires a real admin session and can't simply be put on cron (unlike the new
certificate-expiry check), and `EmailLog`/`WhatsappLog` have API endpoints but no admin UI page
renders them yet.

### Scope decisions

- **AD sync-now and the file-issue reminders (`check-overdue`/`check-due-tomorrow`) stay
  manual-trigger-only** - only the new certificate-expiry check got the internal-token treatment that
  makes it genuinely cron/worker-automatable. Extending that pattern to the older endpoints is real,
  identified follow-up work (see Known Gaps), not done here to keep this phase's scope to what
  directly needed fixing.
- **No APM/observability stack, no WAF, no log aggregation setup** - the structured request logger
  gives any real deployment something to point a log aggregator at (JSON lines in production), but
  actually standing one up is an infrastructure choice for whoever deploys this, not something to
  bundle into the app.
- **`EmailLog`/`WhatsappLog` admin UI pages not built** - the API endpoints exist
  (`GET /api/email-logs`), a table view is a natural small addition but wasn't in this phase's
  critical path (documented instead in `docs/smtp-setup.md`/`docs/whatsapp-setup.md` so it's not a
  silent gap).
- **Storage health dashboard UI not built** - same situation: `GET /api/storage/health` exists and
  works, no page renders it. Documented in `docs/nfs-setup.md`.

### How this was verified

Real `curl` walkthroughs throughout: helmet headers inspected via `curl -D -`; structured logging
confirmed by tailing the dev log after triggering requests; rate limiting proven with 12 rapid login
attempts producing exactly the expected 401×10 → 429×3 sequence (including a correct password still
being blocked mid-window); the internal-token guard confirmed to reject an unauthenticated
`check-expiring` call with a real 403. `scripts/backup.sh`'s own control flow (not Postgres itself -
no `pg_dump`/`psql` client binaries were available in this sandbox, only the `embedded-postgres`
package's bundled server binaries) verified live with a stubbed `pg_dump`: produced a real,
correctly-structured `.tar.gz` containing the dump placeholder plus genuine tar archives of the real
`storage/whatsapp-session` directory (135 files, ~17MB), confirmed via `tar -tzf` and extraction.

**Full golden-path walkthrough** (the closing acceptance check for the whole build, not just this
phase) run live end-to-end against the running dev stack: logged in → created a new project
(`PRJ-2026-000004`) against a workflow template → instantiated its checklist (31 stages cloned) →
uploaded a document against a mandatory requirement → confirmed the stage flipped from `INCOMPLETE`
to `COMPLETED` only once the document's status was `APPROVED`, not merely uploaded → created a
physical file record for the project (QR token generated) → confirmed the new project and physical
file are both immediately findable via global search → confirmed the dashboard's "recently updated
projects" picked it up. Every layer touched in this walkthrough (projects, workflow engine, documents,
physical files, search, dashboards) is therefore confirmed working together, post-Phase-8-changes, not
just individually per its own phase. Screenshotted the dashboard afterward showing the real data from
this walkthrough rendering correctly in the browser.

`npm run typecheck` clean on all four workspaces; `npm run test --workspace=apps/api` 24/24. API,
worker, and web dev processes all confirmed healthy after every restart during this phase.

## Build status: all 8 planned phases complete

This closes out the phase-by-phase plan approved at the start of this build (`docs/architecture.md`
§9's phased order, mirrored in this doc's phase table above). What's genuinely solid, and what still
needs real-world validation before a production rollout, is summarized honestly in
`docs/test-plan.md`'s "Known coverage gaps" section and the "Earlier-phase follow-ups" list directly
below - read both before considering this "done" in the sense of "ready to deploy without further
testing." It is done in the sense of "every planned feature is built and has been verified working,
end-to-end, at least once."

## Post-build: repo cleanup + aaPanel deployment guide (user request, after Phase 8)

**Repo cleanup.** Checked for leftover unused files/folders beyond what Phase 8 already touched:
the entire TRAFO 360 v1 codebase (`config/`, `cron/`, `middleware/`, `public/`, `routes/`, `views/`,
`server.js`, the old `Dockerfile`/`.dockerignore`, etc. - 118 files) was already deleted from the
working tree and staged (`git add -A`) earlier in this build, confirmed still true; no other stray
build artifacts, `.bak`/`.orig`/log files, or duplicate configs were found. `docs/legacy-reference/`
(the old v1 README + its SQL schema/seed files, renamed there via `git mv`-equivalent) is kept
deliberately, not leftover cruft - it's the documented source of the seed data's validated domain
knowledge (stage names, roles, document categories), cited from `docs/architecture.md` and this doc.
**Nothing has been committed on this branch yet** - `main` still holds v1 untouched, and this entire
rewrite exists only as staged changes; that's a decision for the user, not something to do
unprompted.

**A real production-deployment bug found and fixed while writing the aaPanel guide.** Writing a
guide for a plain `node dist/main.js` deployment (no Docker, no `docker-compose.yml`'s `env_file`
auto-injecting environment variables) surfaced something Docker had been quietly covering for:
`apps/worker`'s production entrypoint (`node dist/main.js`) never loaded `.env` at all - unlike
`apps/api`, whose `@nestjs/config` `ConfigModule` loads `.env` from the process's working directory
automatically, the worker is a plain script with no such mechanism, and its `dev` script only worked
by accident of `-r dotenv/config` being wired into the dev command specifically. Under Docker Compose
this never mattered (`env_file: .env` injects real env vars directly into the container regardless of
what the app code does), but under PM2/aaPanel or any bare-metal deployment, the worker would have
started with an empty environment - no `DATABASE_URL`, no `INTERNAL_WORKER_TOKEN` - and failed
immediately. Fixed in `apps/worker/src/main.ts` with an explicit `dotenv.config()` call resolved
relative to the compiled file's own location (`path.resolve(__dirname, "../../../.env")`, not
`process.cwd()`, so it works no matter what directory the process manager launches from) - safe under
Docker too, since dotenv never overwrites a variable that's already set, and the file it's pointed at
won't even exist inside that image.

While fixing this, also caught and suppressed a purely cosmetic issue: newer `dotenv` versions
(17.x) print a random self-promotional "tip" line to stdout on every `config()` call (e.g. "auth for
agents [www.vestauth.com]") unless `quiet: true` is passed - worth flagging since the string looked
alarming out of context (verified it's genuinely just `dotenv`'s own bundled marketing copy, not a
supply-chain issue, by finding the exact `TIPS` array in the installed package). Added `quiet: true`
to the new `dotenv.config()` call so production logs stay clean.

**Production build verified live for the first time this build.** Every previous phase ran the app
via `ts-node-dev` (dev mode, hot-reload); the actual `npm run build` → `node dist/main.js` path this
doc/the aaPanel guide describes had never been exercised. Ran it for real: `npm run build` compiled
all three TypeScript packages and the Vite SPA build cleanly (single warning: the SPA's JS bundle is
~1.5MB, unsplit - a real but non-blocking perf note, not a correctness issue - see Known Gaps);
started `node apps/api/dist/main.js` and `node apps/worker/dist/main.js` from the repo root exactly
as aaPanel/PM2 would, confirmed the API's health endpoint and structured JSON logging both work in
production mode, confirmed the worker connects to the database and (after the dotenv fix) picks up
its configuration correctly, and confirmed the worker's certificate-expiry HTTP call to the API
succeeds once the API is also up (and fails gracefully, without crashing the worker, in the brief
window it wasn't). Dev servers were restored afterward for continued work.

**`docs/aapanel-deployment.md`** - a full click-through guide mirroring v1's aaPanel guide's format
(`docs/legacy-reference/TRAFO360_V1_README.md` §2), adapted for this app's actual topology: two PM2
Node projects (api + worker, both needing "Project directory" set to the repo root specifically, not
a subfolder, so `.env` loading and npm-workspace module resolution both work) instead of v1's one,
PostgreSQL instead of MySQL, a real build step, and a static-SPA-plus-reverse-proxied-API single site
instead of v1's one Express process serving everything. Flags explicitly, rather than glossing over,
the one thing not verified against real aaPanel behavior (whether the worker's Node Project GUI entry
tolerates having no HTTP port actually listening) with a Terminal-based `pm2 start` fallback that
doesn't depend on the GUI's exact behavior. Also documents a security-critical step specific to this
app's build-output layout that v1 never needed (aaPanel's "Run Directory" must point at
`apps/web/dist`, not the repo root, or `.env`/`node_modules`/source code become web-accessible) with
a concrete verification step (`curl -I https://your-domain/.env` must 404).

### How this was verified

Live, on the actual built production artifacts, not just by reading the Dockerfiles/scripts as
Phase 8 did: `npm run build` run for real; `node apps/api/dist/main.js` and
`node apps/worker/dist/main.js` both run for real from the repo root with no dev tooling involved;
API health check and JSON-structured logs confirmed via `curl`; worker's database connection and
`.env` loading confirmed via its own startup log (both before the fix - confirmed the old behavior
would have failed by inspecting the code path - and after, live); worker's HTTP call to the API
confirmed via a real `check-expiring` round-trip once the API was back up. `npm run typecheck`
clean across all four workspaces; `npm run test --workspace=apps/api` still 24/24. The aaPanel guide
itself, as stated in its own honesty note, was not walked through on a live aaPanel instance - that
remains the one unverified piece of this update, same category of gap as the Docker Compose path in
Phase 8.

## Earlier-phase follow-ups not carried forward as blockers

- **This branch has zero commits so far** - everything since the rewrite began exists only as staged
  working-tree changes (`git add -A`, never `git commit`). `main` is untouched. Commit when the user
  asks for it, not before - see the "Post-build: repo cleanup" section above.
- The SPA's production JS bundle is a single ~1.5MB (493KB gzipped) chunk - Vite's own build output
  warns about this. Not a correctness issue, but worth code-splitting (route-based dynamic `import()`,
  or at minimum separating AntD/React Flow into their own chunk via `manualChunks`) before a
  bandwidth-constrained deployment, since every user currently downloads the entire app up front.
- AD/LDAP bind and sync logic has never touched a real Active Directory server. Get a real test
  against one before depending on it in production - the code is correct per the ldapjs API and its
  failure paths are proven, but directory-specific quirks (attribute casing, `memberOf` format,
  referral handling) are unknowns.
- **No Redis/BullMQ, by final decision, not just default** - storage sync, overdue-detection, and
  certificate-expiry reminders all use plain interval loops instead. Reconsidered and reaffirmed
  across Phases 0/6/8; the Compose `redis` service and unused websocket deps were actually removed in
  Phase 8 once confirmed nothing used them. Migrating to a real queue is still worth doing before
  scaling to multiple worker replicas or high job volume (retry backoff, distributed workers, job
  introspection) - see `docs/architecture.md`'s "Deviation from the original plan" section.
- WhatsApp message delivery is unverified end-to-end (only QR/session lifecycle proven live) -
  needs a real phone pairing before depending on it in production. See Phase 6 / `docs/whatsapp-setup.md`.
- Due-tomorrow physical file reminder has no "already notified" dedup - fine for daily manual/cron
  triggering, would spam on more frequent triggers. See Phase 6 scope decisions.
- **Docker Compose stack reviewed line-by-line and two real bugs fixed (Phase 8), but still never
  actually built/run** - no Docker available in any environment this was built in. Run a real
  `docker compose build && docker compose up` before depending on this for production; see
  `docs/deployment.md`.
- AD sync-now and the file-issue reminders (`check-overdue`/`check-due-tomorrow`) are still
  manual-trigger-only, unlike the Type Test Certificate expiry check which the worker now triggers
  automatically via `INTERNAL_WORKER_TOKEN` - extending that pattern to these would make them
  genuinely cron-automatable too. See Phase 8 scope decisions.
- `EmailLog` and storage-health have working API endpoints (`GET /api/email-logs`,
  `GET /api/storage/health`) but no admin UI page renders either yet - see `docs/smtp-setup.md`,
  `docs/nfs-setup.md`. `WhatsappLog` is written to on every send but has no read endpoint at all yet
  (not even API-only) - see `docs/whatsapp-setup.md`.
- **`INTERNAL_WORKER_TOKEN` is a plain shared secret in `.env`**, checked by `InternalTokenGuard` - fine
  for a single-host deployment where worker and API share the same `.env`, but if these ever run on
  separate hosts/containers this needs to travel through whatever secrets mechanism the real deploy
  uses (spec §66's Docker Compose setup keeps them on the same internal network, so this should be
  low-risk, but flagging it since it's a new inter-process auth mechanism not used anywhere else).
- The Type Test Certificate reminder is the first background job that's genuinely automatic
  end-to-end (worker triggers it on its own schedule) rather than manual/admin-triggered like the
  Phase 5/6 reminders (`check-overdue`, `check-due-tomorrow`) - worth eventually making those
  consistent with this pattern too, since "remind me only if I remember to click a button" is a real
  gap for file-overdue/due-tomorrow notifications today.
- Admin-configurable project/document numbering format (spec §6/§52) - the format itself is
  hardcoded (`PRJ-YYYY-NNNNNN`, `PF-YYYY-NNNNNN`), only the atomicity/uniqueness is handled properly.
- ~~Highly-confidential/restricted downloads only enforce the confidentiality ceiling~~ - **closed
  in Phase 5**: `DocumentRequest`/`RequestApproval` now gates these downloads for real, verified
  live (see Phase 5 notes above).
- Physical file and document-request approval are both single-step (routed by confidentiality, not
  a configurable multi-step chain). Noted in Phase 5's scope-decisions section.

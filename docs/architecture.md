# TRAFO 360 v2 — Architecture

This is the self-contained architecture reference for the rewrite (see `BUILD_PROGRESS.md` for
what's actually been built so far). It condenses the approved implementation plan so it ships with
the repo rather than living only in an external planning file.

## 1. Why a rewrite

The repo's `main` branch holds TRAFO 360 v1: a working Express/EJS/MySQL manufacturing execution
system already covering configurable stages, GTP-driven documents, document issue/QR/approval/
extension workflow, RBAC, SMTP and WhatsApp Web notifications. This rewrite targets a broader
enterprise spec (AD/LDAP auth, PostgreSQL/Prisma, NFS storage with offline fallback + sync,
project/document-level permissions, confidentiality-gated approvals, a visual workflow builder,
physical file tracking with QR/labels) on a NestJS + React/TypeScript stack, per explicit user
decision. v1's validated domain data (stage names, roles, document categories) was ported into the
seed data rather than the code.

## 2. Stack

| Layer | Choice |
|---|---|
| Backend | NestJS + TypeScript, REST API |
| ORM / DB | Prisma + PostgreSQL |
| Background jobs | Plain `setInterval` loops in a separate `apps/worker` process - see "Deviation from the original plan" below |
| Frontend | React + TypeScript + Vite + Ant Design |
| Workflow builder | React Flow (node/flow canvas for parent-stage -> stage editing) |
| Data fetching | TanStack Query; light UI state in Zustand |
| Auth | AD/LDAP via `ldapjs` + JWT access/refresh as httpOnly `SameSite=strict` cookies |
| Email | Nodemailer, sent synchronously from the request/job that triggers it, always logged to `EmailLog` |
| WhatsApp | `whatsapp-web.js`, isolated in its own module; admin pairing/status/send all synchronous, no queue |
| File storage | Custom `StorageService` with NFS + local-fallback adapters |

### Deviation from the original plan: no Redis/BullMQ, no WebSocket gateway

The architecture plan approved before implementation specified Redis + BullMQ for background jobs
and a WebSocket gateway for live notification/storage-health/WhatsApp-pairing push. Neither was
built. This was a deliberate, repeatedly-reconsidered simplification (first made in Phase 0 for lack
of a local Redis in the dev sandbox, reconsidered and reaffirmed in Phase 6 once email/WhatsApp
needed it too - see `docs/BUILD_PROGRESS.md`), not an oversight:

- **Jobs**: storage sync, overdue-file detection, and type-test-certificate expiry reminders all run
  as plain `setInterval` loops in `apps/worker`, with the same idempotent/retry-safe logic a real
  queue would have (checksum-verify before/after copy, status transitions gated on DB state, a
  `lastReminderSentAt` timestamp instead of a job's own retry counter). This is adequate for this
  deployment's expected volume; a real queue is worth adding before scaling to multiple worker
  replicas or high job volume, since a plain interval loop doesn't give you distributed workers, job
  introspection, or backoff-with-jitter retry.
- **Real-time push**: the frontend polls instead (notification bell every 30s, dashboard every 60s,
  WhatsApp pairing status on an interval while its modal is open) rather than a WebSocket gateway.
  Simpler to build and deploy (no sticky-session/reverse-proxy WebSocket concerns), and the polling
  intervals are short enough that the UX difference is negligible for this app's usage pattern.
  Revisit if a future feature genuinely needs sub-second push (there wasn't one that did).

Both `@nestjs/websockets`/`@nestjs/platform-socket.io` and the `redis` Docker Compose service were
removed in Phase 8 once it was clear nothing in the codebase used them - keeping unused
infrastructure in the deployment stack is a bigger ops liability than a smaller stack that's honest
about what it actually needs.

### Documented deviations from a literal spec reading

1. **Bootstrap local admin.** Exactly one local (non-AD) `System Administrator` account is seeded
   so the very first admin can log in and configure AD/SMTP/NFS/WhatsApp before any AD integration
   exists. Flagged in the UI as a local account; its use is audit-logged; admin may disable it once
   AD is verified (not forced automatically — avoids lockout).
2. **CSRF** is not the applicable threat model for a stateless JWT-bearer API consumed by the SPA;
   mitigated instead via `SameSite=strict` on the refresh-token cookie.
3. **Malware scanning** is an integration point (`ScanAdapter` interface, no-op default), not a
   bundled AV engine — licensing/scope reasons.

## 3. Module list

`auth`, `ldap`, `users`, `roles`, `permissions`, `departments`, `customers`, `projects`,
`workflow-templates`, `parent-stages`, `stages`, `document-types`, `documents`,
`document-versions`, `document-approvals`, `document-library`, `physical-files`, `qr-labels`,
`file-issues`, `confidentiality`, `notifications`, `email`, `whatsapp`, `storage`, `search`,
`reports`, `dashboards`, `type-test-certificates`, `audit`, `settings`.

Frontend route tree: Dashboard / Projects / Document Library / Physical Files / Type Test
Certificates / Workflow / Customers / Reports / Administration / Audit Logs (implemented as the
sidebar nav in `apps/web/src/layout/AppLayout.tsx`).

## 4. Database

Full model definitions: `prisma/schema.prisma`. Grouped by concern:

- **Identity & access**: `User`, `Department`, `Role`, `Permission`, `RolePermission`,
  `UserPermissionOverride`, `AdGroup`, `AdGroupRoleMapping`, `LoginHistory`, `AuditLog`.
- **Org data**: `Customer`, `Project`, `ProjectMember`, `ConfidentialityLevel`.
- **Workflow engine**: `WorkflowTemplate` → `ParentStage` → `Stage` → `StageDependency`,
  `DocumentType`, `StageDocumentRequirement`, then per-project instances `ProjectStage` /
  `ProjectDocumentRequirement` (+ `ProjectStageHistory`).
- **Documents**: `Document`, `DocumentVersion`, `ApprovalWorkflow`/`ApprovalStep`,
  `DocumentApproval`, `DocumentRequest`/`RequestApproval`.
- **Physical files**: `PhysicalFile`, `FileIssueTransaction`, `ExtensionRequest`,
  `FileReturnTransaction`.
- **Notifications**: `Notification`, `NotificationTemplate`, `NotificationRule`, `EmailLog`,
  `WhatsappLog`, `WhatsappSession`.
- **Storage**: `StorageHealthSnapshot`, `StorageSyncJob`.
- **System**: `SystemSetting` (secrets encrypted at rest), `QrLabelTemplate`.

`AuditLog` has no update/delete path anywhere in the API — insert-only at the service layer, not
just by convention.

## 5. Permission model

Permission strings are seeded rows (`libs/shared/src/permissions.ts` is the single source of truth
— imported by the seed script; the frontend will import it too for UI gating), never hard-coded in
guard logic beyond the string constant. See `docs/permission-matrix.md` (generated, not hand-edited
— regenerate with `node scripts/gen-permission-matrix.mjs`).

Resolution: `RolePermission` (from the user's role) ∪ `UserPermissionOverride`
(GRANT adds, REVOKE removes — revoke wins on conflict). Three enforcement layers required together:

1. Route-level `PermissionsGuard` — does the user hold the permission string at all.
2. Service-level resource check — project membership/department match; confidentiality ceiling.
3. Confidentiality escalation — `HIGHLY_CONFIDENTIAL`/`RESTRICTED` downloads and physical issues
   additionally require an approved `DocumentRequest`/`RequestApproval`, even for otherwise
   permitted users.

## 6. Storage architecture (NFS + offline fallback)

`StorageService` tries `NfsAdapter` first (pre-write canary probe, short timeout), falls back to
`LocalAdapter` on failure (`DocumentVersion.storageStatus = LOCAL_PENDING_SYNC`). A worker-process
`nfs-sync` job re-probes NFS periodically, copies, sha256-verifies, **only then** flips status to
`NFS_STORED` and deletes the local temp copy; failures retry with backoff and surface on the
storage-health dashboard (`StorageHealthSnapshot`). Downloads never expose NFS/local paths — always
`GET /api/documents/:id/download`, which resolves storage server-side, runs the full permission
chain, streams the file, and audit-logs before streaming.

## 7. Workflow engine & status rules

Templates are admin-authored (`WorkflowTemplate` → `ParentStage` → `Stage` →
`StageDocumentRequirement` → `DocumentType`); creating a project clones the chosen template into
`ProjectStage`/`ProjectDocumentRequirement` rows — users never hand-build a checklist. Project-level
overrides flip a requirement's `required`/`notApplicable` flag with an audited reason; the template
itself is never mutated by a project-level change.

**Stage status is a hard rule, not "any file present = done"**: all mandatory requirements have an
`APPROVED` version → `COMPLETED`; any mandatory requirement has an uploaded version awaiting
decision → `UNDER_REVIEW`; any mandatory requirement has no accepted version → `INCOMPLETE`. Project
`COMPLETED` status requires all mandatory stages complete, or an explicit admin override (reason +
audit trail).

## 8. Notifications, WhatsApp, AD isolation

- **Notifications**: every feature module calls `NotificationsService.notify(eventKey, userId,
  variables)` - the single entry point (nothing sends email/WhatsApp/in-app directly). It reads the
  event's `NotificationRule` (per-channel on/off) and `NotificationTemplate` rows, then dispatches to
  `EmailService`/`WhatsappService` synchronously and writes an in-app `Notification` row.
- **Email**: Nodemailer using `SystemSetting`-stored SMTP config (password encrypted at rest); every
  send - success or failure - is logged to `EmailLog` for admin visibility.
- **WhatsApp**: dedicated module wrapping `whatsapp-web.js` behind an admin-only controller
  (connect/disconnect/status/send), called synchronously by `NotificationsService`. Session files are
  filesystem-only (`WHATSAPP_SESSION_PATH`), never API-exposed. Rides on an unofficial channel -
  email remains authoritative per the notification rule defaults.
- **AD/LDAP**: `SystemSetting`-stored config (bind password encrypted), used by
  `AuthService.validateAdCredentials` (bind-as-user, password never persisted) and a scheduled +
  on-demand sync job that upserts `User`/`AdGroup`/`Department` mappings, audit-logged.
- **Type test certificate reminders**: the one job that genuinely needs external scheduling and
  genuinely runs on one - `apps/worker` calls `POST /type-test-certificates/check-expiring` on the
  API every 6 hours (authenticated via `INTERNAL_WORKER_TOKEN`, not a user session), which itself
  calls `NotificationsService.notify()` per qualifying certificate per admin. See
  `docs/BUILD_PROGRESS.md`'s Type Test Certificates section for the full reminder-cadence design.

## 9. Deployment

`docker-compose.yml` (postgres, api, worker, web, nginx) - see `docs/deployment.md` for the full
walkthrough (env vars, TLS, NFS mount, migrations, seeding). See `nginx/trafo360.conf.example` for
the reverse-proxy config (TLS termination, `/api` → api service, everything else → the built SPA).

## 10. Key security risks tracked

Secrets-at-rest for AD/SMTP passwords (AES-256-GCM via `SECRETS_ENCRYPTION_KEY`, never plaintext in
DB); download authorization bypass via ID guessing (mitigated by the mandatory permission chain on
every download/stream endpoint — never raw paths); confidentiality enforcement gaps between
physical issue and digital download (both routed through the same `RequestApproval` chain);
WhatsApp session hijack if session files leak (filesystem permissions, never API-exposed); path
traversal on upload filenames (server-generated storage paths; original filename kept only as
metadata); audit log tamper resistance (insert-only at the service layer — no delete/edit route
exists anywhere in the API).

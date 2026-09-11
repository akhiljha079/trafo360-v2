# Test Plan

This app was built phase-by-phase with a deliberate emphasis on **live verification over trusting
typecheck alone** - `docs/BUILD_PROGRESS.md` documents a real bug caught by actually running the app
for nearly every phase, ones that clean types/a green build would have missed entirely (wrong
document-supersede timing, a WhatsApp status race, a Prisma relation that only broke at runtime, PDF
columns overlapping only visible by rendering the file). This doc is the map of what's covered, how,
and - just as importantly - what isn't, so a future session (or a real QA pass) knows where to focus.

## What's automated

`npm run test --workspace=apps/api` - 24 tests across 3 suites, all pure-function/business-rule
tests with zero DB dependency (fast, deterministic, no test-database setup needed):

- `src/workflow/stage-status.spec.ts` (10 tests) - the stage-completion rule (spec's own "not
  complete just because a file exists" scenario, explicitly).
- `src/type-test-certificates/certificate-expiry.spec.ts` (11 tests) - the expiry-status
  classification and the "every 4 days, starting at 1 month left, continuing past expiry until
  renewed" reminder-cadence rule, including boundary conditions (exactly 30 days, exactly 4 days
  since last reminder).
- `src/common/permissions.service.spec.ts` (3 tests) - permission resolution (role grants ∪
  user overrides, revoke wins), against a real (test-data) database connection.

`npm run typecheck` - all four workspaces (`apps/api`, `apps/worker`, `apps/web`, `libs/shared`)
clean on every change throughout the build.

## What's verified live but not automated

The bulk of this app's actual behavior - state machines, multi-step workflows, file I/O, external
service integration - was verified by really running it (real HTTP requests against a real Postgres,
real file uploads, real screenshots of the rendered UI) rather than unit tests, because that's what
actually catches the kind of bug that showed up during this build (see the examples above). This is a
deliberate tradeoff, not an oversight: a mocked-everything unit test for "does approving a document
version update `currentVersionId`" would have passed right through the actual bug that existed here
(supersede happening at upload time instead of approval time) - the mock would have provided whatever
answer the test expected.

The tradeoff's cost is real, though: **this leaves no regression safety net**. A future change to,
say, the document approval flow could silently reintroduce a fixed bug, and nothing would catch it
until someone notices in production. If this app moves past initial rollout into steady maintenance,
converting the walkthroughs below into `apps/api/test/*.e2e-spec.ts` integration tests (Nest's
supertest-based e2e testing, against a real - not mocked - test database) is the single highest-value
addition to this test suite, in priority order:

1. Document lifecycle: upload → approval-required → approve → supersede-on-new-approval → reject
   falls back to last-approved (this is where the real bug was).
2. Confidentiality gating: ceiling-blocked download → access request → approved → succeeds.
3. Physical file issue/return/extension state machine, especially the "rejected extension keeps
   original due date" rule.
4. Stage/project status recomputation after a requirement is overridden or a document is
   approved/rejected.

## Golden-path walkthrough (manual, repeat before any release)

The spec's own acceptance scenario, condensed - walk this end-to-end after any change that touches
more than one module, and definitely before a production release:

1. Log in as the bootstrap admin. Configure a confidentiality level, a department, a role.
2. Create a customer, then a project against a workflow template.
3. Upload a document against a mandatory checklist requirement that needs approval - confirm the
   stage stays `INCOMPLETE`/`UNDER_REVIEW`, not `COMPLETED`.
4. Approve it as a user routed to that approval step - confirm the stage now shows `COMPLETED` once
   every mandatory requirement is approved, not before.
5. Create a physical file record for the project, generate its QR/label.
6. Request the physical file as a different user, approve the request (if above the confidentiality
   ceiling), issue it, confirm it shows as issued with a due date.
7. Request an extension, reject it, confirm the due date is unchanged from the original.
8. Upload a Type Test Certificate with a near-term expiry date, trigger the expiry check
   (`POST /api/type-test-certificates/check-expiring` with the internal token, or wait for the
   worker's 6-hour tick), confirm the notification lands for a System Administrator user.
9. Run a report export in all three formats (CSV/Excel/PDF) and confirm each opens correctly and
   contains only data the exporting user could already see.
10. Search for something from the header search bar, confirm results respect the same access rules.

## Security-relevant checks worth re-running periodically

- Login rate limiting: 11 rapid login attempts from one IP should return `429` on the 11th (verified
  live during Phase 8 - `@nestjs/throttler`, 10/min on `/auth/login`).
- A user without `certificate.manage` (or the equivalent permission for whatever resource) cannot
  reach the corresponding write endpoint even with a valid session - guard + service-level check both
  matter, not just the route decorator.
- A confidentiality-gated document/physical-file cannot be downloaded/issued by a ceiling-blocked
  user even with an otherwise-valid session and a guessed ID.
- `POST /api/type-test-certificates/check-expiring` rejects any request without a valid
  `x-internal-token` header (verified live - returns `403`).

## Known coverage gaps

- **AD/LDAP** has never been tested against a real Active Directory server - see
  `docs/ad-ldap-setup.md`'s Known Limitation.
- **WhatsApp message delivery** has never been tested against a real paired phone - see
  `docs/whatsapp-setup.md`.
- **Docker Compose** has never been run end-to-end in the environment this was built in (no Docker
  available) - reviewed line-by-line instead, two real bugs found and fixed that way (see
  `docs/deployment.md` section 8). Run a real `docker compose up` before depending on this for
  production.
- **Backup/restore scripts**: control flow verified live with a stubbed `pg_dump`; the actual
  `pg_dump`/`pg_restore` invocations were not run against a real Postgres (no client binaries
  available in the build environment - see `docs/backup-recovery.md`).
- **Load/concurrency**: nothing here has been tested under concurrent load or with a
  production-scale dataset. The project-numbering sequence uses an atomic `SystemSetting` upsert
  specifically to be race-safe under concurrent project creation, but that claim itself hasn't been
  load-tested, only reasoned about from the SQL.

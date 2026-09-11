# Administrator Manual

Everything below is reachable from the **Administration** section of the sidebar, or the specific
pages linked - no server access needed for any of it, per the original "manageable from the front
end" requirement this app was built to.

## Initial setup order

1. **Log in** as the bootstrap local admin (username/password from your deployment's `.env` -
   flagged in the UI as "Local account - not AD-backed"). Change this password on first login.
2. **Administration → Departments** - create your organization's departments (Sales, Engineering,
   Procurement, QA, etc.) before creating roles/users that reference them.
3. **Administration → Roles & Permissions** - review the seeded default roles (System Administrator,
   Document Coordinator, Department User, Quality User, Management, Director, File Requester,
   Auditor) and adjust their permission grants if your organization's structure differs. See
   `docs/permission-matrix.md` for the full seeded grant table.
4. **Administration → AD/LDAP** (optional) - see `docs/ad-ldap-setup.md`. Skip this and use
   Administration → Users to create local accounts if you're not integrating with a directory.
5. **Administration → SMTP** - see `docs/smtp-setup.md`. Needed for approval/reminder emails to work
   at all.
6. **Administration → WhatsApp Web** (optional) - see `docs/whatsapp-setup.md`.
7. **Administration → Notification Rules** - review which events send which channels; email-on/
   WhatsApp-off is the default for every event.
8. **Workflow → [create a template]** - build your organization's stage/document-requirement
   structure (see "Workflow templates" below) before creating real projects, since project creation
   requires picking a template.
9. **Confidentiality levels, Customers** - set up your confidentiality tiers and customer master data
   as needed before real project work starts.

## Users & Roles

- **Administration → Users**: create/edit users, assign role + department, set status
  (active/disabled). AD-sourced users are marked as such and can't have a local password set.
- **Administration → Roles & Permissions**: each role has a permission checklist grouped by category,
  plus a **confidentiality ceiling** (the highest confidentiality level users with this role can see
  at all - a role with no ceiling set defaults to PUBLIC-only, not unrestricted, so a newly created
  role is locked down until you explicitly widen it).
- **Per-user overrides**: an individual user can be granted or revoked a specific permission beyond
  what their role gives them, from their user detail view - use sparingly, since it's an exception to
  track, not the primary permission mechanism.

## Workflow templates

**Workflow** page (top-level nav) - build the stage structure your projects will follow:
`WorkflowTemplate → ParentStage (e.g. "Engineering") → Stage (e.g. "Drawing Approval") →
DocumentType requirements (mandatory or optional, with an optional approval workflow)`. Reordering
parent stages/stages is drag-and-drop. A template can be cloned to make a variant without touching
the original. Creating a project clones the chosen template into that project's own checklist -
editing the template afterward never retroactively changes an already-created project's checklist
(by design - a project's requirements are what they were the moment it was created, unless someone
explicitly overrides a specific requirement on that project).

## Projects & the document checklist

Project detail page shows the cloned checklist grouped by parent stage, with each requirement's
status. A stage is complete **only** when every mandatory requirement on it has an *approved* current
document version - uploading a file alone never marks anything complete, and neither does an
under-review upload. A specific requirement can be overridden to "not applicable" (with a required
reason, audit-logged) if it genuinely doesn't apply to that project - this never changes the template.

## Documents

- Upload happens against a specific checklist requirement (from the project's checklist) or as a
  general document type. Configurable approval chains route to a specific role and/or department -
  only a user matching the step's routing can decide that step, even if they hold the general
  `document.approve` permission (checked at the service layer, not just the permission guard).
- **Confidentiality**: `HIGHLY_CONFIDENTIAL`/`RESTRICTED` documents require an *approved access
  request* to download, even for a user whose role ceiling would otherwise permit it - Document
  Library → the document → Request Access.
- A rejected new version never destroys a previously-approved one - the document stays on its last
  approved version until the new one is either approved or a further revision is uploaded.

## Physical files

Create a physical file record from a project's detail page once it needs a physical folder (QR code +
printable label generated automatically). Issue/return/extension all go through the same
confidentiality-aware request→approve→issue chain as documents for anything above the PUBLIC tier.
Extension requests never auto-extend the due date - a rejected extension keeps the *original* due
date, not the requested one.

## Type Test Certificates

**Type Test Certificates** (top-level nav) - a registry independent of any single project, since a
type test covers a transformer type/rating and is reused across every project that builds it. Upload
with an expiry date; once a certificate has a month or less left, every System Administrator gets a
reminder every 4 days (email/in-app, per Notification Rules) - including after expiry - until someone
renews it (new file + new future expiry date, from the Renew button on that row).

## Reports & Search

**Reports** - Project Status, Document Register, Physical File Register, and Overdue/Extension
reports, each exportable as CSV, Excel, or PDF - every export respects the same confidentiality
filtering as the on-screen views, so exporting never shows more than a user could already see.
**Search bar** (top of every page) - searches across projects/documents/physical files at once, same
confidentiality filtering.

## Audit Log

**Audit Logs** (top-level nav, requires `audit.view`) - every significant action (uploads, approvals,
overrides, config changes, downloads) is recorded here, insert-only - there is no edit/delete path
for audit entries anywhere in the app, by design.

## Backups

Not managed from the front end - see `docs/backup-recovery.md`. This is a deliberate scope decision:
giving a web UI the ability to trigger a full database dump is a bigger attack-surface/operational-
risk tradeoff than it's worth for what is fundamentally a sysadmin/cron task.

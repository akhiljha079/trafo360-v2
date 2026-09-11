# Permission Matrix (generated from seed data - do not hand-edit)

Generated 2026-09-10T20:13:44.230Z from `prisma/seed.ts` via `node scripts/gen-permission-matrix.mjs`. Regenerate after any change to role/permission seed data or after admin-side edits in a real deployment's DB.

| Permission | Auditor | Department User | Director | Document Coordinator | File Requester | Management | Quality User | System Administrator |
|---|---|---|---|---|---|---|---|---|
| **admin** |  |  |  |  |  |  |  |  |
| `ad.manage` |  |  |  |  |  |  |  | x |
| `department.manage` |  |  |  |  |  |  |  | x |
| `notification.manage` |  |  |  |  |  |  |  | x |
| `role.manage` |  |  |  |  |  |  |  | x |
| `settings.manage` |  |  |  |  |  |  |  | x |
| `storage.manage` |  |  |  |  |  |  |  | x |
| `user.manage` |  |  |  |  |  |  |  | x |
| **audit** |  |  |  |  |  |  |  |  |
| `audit.view` | x |  |  |  |  |  |  | x |
| **certificate** |  |  |  |  |  |  |  |  |
| `certificate.manage` |  |  |  | x |  |  | x | x |
| `certificate.view` | x | x | x | x |  | x | x | x |
| **confidential** |  |  |  |  |  |  |  |  |
| `confidential.download` |  |  | x |  |  |  |  | x |
| `confidential.view` |  |  | x |  |  |  |  | x |
| **customer** |  |  |  |  |  |  |  |  |
| `customer.manage` |  |  |  |  |  |  |  | x |
| **document** |  |  |  |  |  |  |  |  |
| `document.approve` |  |  | x | x |  |  | x | x |
| `document.delete` |  |  |  |  |  |  |  | x |
| `document.download` |  | x | x | x |  |  | x | x |
| `document.edit` |  |  |  | x |  |  |  | x |
| `document.reject` |  |  | x |  |  |  | x | x |
| `document.share` |  |  |  | x | x |  |  | x |
| `document.upload` |  | x |  | x |  |  |  | x |
| `document.version` |  | x |  | x |  |  |  | x |
| `document.view` | x | x | x | x | x | x | x | x |
| **document_type** |  |  |  |  |  |  |  |  |
| `document_type.manage` |  |  |  |  |  |  |  | x |
| **physical_file** |  |  |  |  |  |  |  |  |
| `physical_file.approve` |  |  | x |  |  |  |  | x |
| `physical_file.create` |  |  |  | x | x |  |  | x |
| `physical_file.issue` |  |  |  | x |  |  |  | x |
| `physical_file.return` |  |  |  | x | x |  |  | x |
| `physical_file.view` | x | x | x | x | x | x | x | x |
| **project** |  |  |  |  |  |  |  |  |
| `project.create` |  |  |  | x |  |  |  | x |
| `project.delete` |  |  |  |  |  |  |  | x |
| `project.edit` |  |  |  | x |  |  |  | x |
| `project.override_status` |  |  | x |  |  |  |  | x |
| `project.view` | x | x | x | x | x | x | x | x |
| **report** |  |  |  |  |  |  |  |  |
| `report.view` | x |  | x | x |  | x |  | x |
| **workflow** |  |  |  |  |  |  |  |  |
| `workflow.create` |  |  |  |  |  |  |  | x |
| `workflow.edit` |  |  |  |  |  |  |  | x |
| `workflow.publish` |  |  |  |  |  |  |  | x |
| `workflow.view` | x |  | x | x |  | x |  | x |

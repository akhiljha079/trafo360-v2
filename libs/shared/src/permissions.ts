// Single source of truth for permission strings (spec §10) shared between the
// API (guards, seed data) and the web app (UI gating). Never hard-code a
// permission string anywhere else - import PERMISSION_CODES or Permission.

export interface PermissionDefinition {
  code: string;
  category: string;
  description: string;
}

export const PERMISSIONS: PermissionDefinition[] = [
  { code: "project.create", category: "project", description: "Create new projects" },
  { code: "project.view", category: "project", description: "View project details" },
  { code: "project.edit", category: "project", description: "Edit project details" },
  { code: "project.delete", category: "project", description: "Delete projects" },
  { code: "project.override_status", category: "project", description: "Manually override project status/completion (audited)" },

  { code: "customer.manage", category: "customer", description: "Create/edit customer master records" },

  { code: "workflow.view", category: "workflow", description: "View workflow templates" },
  { code: "workflow.create", category: "workflow", description: "Create workflow templates" },
  { code: "workflow.edit", category: "workflow", description: "Edit workflow templates, stages, document requirements" },
  { code: "workflow.publish", category: "workflow", description: "Activate/deactivate workflow templates" },

  { code: "document_type.manage", category: "document_type", description: "Manage document type master data" },

  { code: "document.upload", category: "document", description: "Upload documents" },
  { code: "document.view", category: "document", description: "View document metadata" },
  { code: "document.download", category: "document", description: "Download document files" },
  { code: "document.edit", category: "document", description: "Edit document metadata" },
  { code: "document.delete", category: "document", description: "Delete documents" },
  { code: "document.approve", category: "document", description: "Approve documents" },
  { code: "document.reject", category: "document", description: "Reject documents" },
  { code: "document.version", category: "document", description: "Upload new document versions" },
  { code: "document.share", category: "document", description: "Share/request documents" },

  { code: "physical_file.view", category: "physical_file", description: "View physical file register" },
  { code: "physical_file.create", category: "physical_file", description: "Create physical file records / requests" },
  { code: "physical_file.issue", category: "physical_file", description: "Issue physical files" },
  { code: "physical_file.return", category: "physical_file", description: "Process physical file returns" },
  { code: "physical_file.approve", category: "physical_file", description: "Approve physical file issue/extension requests" },

  { code: "confidential.view", category: "confidential", description: "View confidential-tier documents" },
  { code: "confidential.download", category: "confidential", description: "Download confidential-tier documents" },

  { code: "certificate.view", category: "certificate", description: "View type test certificates" },
  { code: "certificate.manage", category: "certificate", description: "Upload and renew type test certificates" },

  { code: "report.view", category: "report", description: "View and export reports" },
  { code: "audit.view", category: "audit", description: "View audit logs" },

  { code: "user.manage", category: "admin", description: "Manage users" },
  { code: "role.manage", category: "admin", description: "Manage roles and permissions" },
  { code: "department.manage", category: "admin", description: "Manage departments" },
  { code: "settings.manage", category: "admin", description: "Manage system settings (numbering, branding, retention)" },
  { code: "ad.manage", category: "admin", description: "Configure AD/LDAP connection and run sync" },
  { code: "storage.manage", category: "admin", description: "Configure NFS/local storage and view sync health" },
  { code: "notification.manage", category: "admin", description: "Configure SMTP, WhatsApp Web, notification templates/rules" },
];

export const PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Default role -> permission grants seeded on first install. Admin-editable afterwards. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  "System Administrator": PERMISSION_CODES,
  "Document Coordinator": [
    "project.create", "project.view", "project.edit",
    "workflow.view",
    "document.upload", "document.view", "document.download", "document.edit", "document.version", "document.approve", "document.share",
    "physical_file.view", "physical_file.create", "physical_file.issue", "physical_file.return",
    "certificate.view", "certificate.manage",
    "report.view",
  ],
  "Department User": [
    "project.view",
    "document.upload", "document.view", "document.download", "document.version",
    "physical_file.view",
    "certificate.view",
  ],
  "Quality User": [
    "project.view",
    "document.view", "document.download", "document.approve", "document.reject",
    "physical_file.view",
    "certificate.view", "certificate.manage",
  ],
  Management: [
    "project.view", "workflow.view", "report.view",
    "document.view",
    "physical_file.view",
    "certificate.view",
  ],
  Director: [
    "project.view", "project.override_status", "workflow.view", "report.view",
    "document.view", "document.download", "document.approve", "document.reject",
    "confidential.view", "confidential.download",
    "physical_file.view", "physical_file.approve",
    "certificate.view",
  ],
  "File Requester": [
    "project.view",
    "document.view", "document.share",
    "physical_file.view", "physical_file.create", "physical_file.return",
  ],
  Auditor: [
    "project.view", "workflow.view", "report.view", "audit.view",
    "document.view",
    "physical_file.view",
    "certificate.view",
  ],
};

export const DEFAULT_ROLE_NAMES = Object.keys(DEFAULT_ROLE_PERMISSIONS);

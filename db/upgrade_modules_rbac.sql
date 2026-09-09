-- =====================================================================
-- Upgrade: Modules + Granular Per-Module RBAC
-- Run this ONCE against an existing database (after schema.sql/seed.sql).
-- All statements are additive - safe to run on a live database.
-- If you are setting up a brand new database, schema.sql + seed.sql already
-- include everything in this file, so you can skip it.
--
-- What this does:
--   1. Creates `modules` (Sales/Manufacturing/Dispatch/Documents/Warranty/
--      Accounting/Reports) and `role_permissions` (per-module View/Create/
--      Edit/Delete/Approve per role) - see db/schema.sql for full comments.
--   2. Backfills role_permissions from each existing role's legacy flat
--      flags (can_manage_jobs, can_manage_documents,
--      can_approve_document_issue, is_admin, is_director), so every role
--      ends up with the same effective access it had before this upgrade.
--      The legacy columns on `roles` are left in place, untouched - the
--      application code simply stops reading them once this migration has
--      run. Re-running this file is safe: INSERT IGNORE never overwrites a
--      permission you've since hand-edited in Admin > Roles & Privileges.
-- =====================================================================

CREATE TABLE IF NOT EXISTS modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module_key VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  icon VARCHAR(40) DEFAULT NULL COMMENT 'Bootstrap Icons class suffix, e.g. bi-truck',
  sequence_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  module_id INT NOT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 0,
  can_create TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  can_approve TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_role_module (role_id, module_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO modules (module_key, name, icon, sequence_order) VALUES
('sales', 'Sales', 'bi-graph-up-arrow', 10),
('manufacturing', 'Manufacturing', 'bi-gear-wide-connected', 20),
('dispatch', 'Dispatch', 'bi-truck', 30),
('documents', 'Documents', 'bi-folder2-open', 40),
('warranty', 'Warranty', 'bi-shield-check', 50),
('accounting', 'Accounting', 'bi-receipt', 60),
('reports', 'Reports', 'bi-graph-up', 70)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT IGNORE INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete, can_approve)
SELECT
  r.id, m.id,
  CASE
    WHEN r.is_admin = 1 THEN 1
    WHEN m.module_key IN ('sales','manufacturing','dispatch','warranty') AND r.can_manage_jobs = 1 THEN 1
    WHEN m.module_key IN ('documents','accounting') AND (r.can_manage_documents = 1 OR r.can_approve_document_issue = 1) THEN 1
    WHEN m.module_key = 'reports' AND (r.is_director = 1 OR r.can_manage_jobs = 1 OR r.can_manage_documents = 1) THEN 1
    ELSE 0
  END AS can_view,
  CASE
    WHEN r.is_admin = 1 THEN 1
    WHEN m.module_key IN ('sales','manufacturing','dispatch','warranty') AND r.can_manage_jobs = 1 THEN 1
    WHEN m.module_key IN ('documents','accounting') AND r.can_manage_documents = 1 THEN 1
    ELSE 0
  END AS can_create,
  CASE
    WHEN r.is_admin = 1 THEN 1
    WHEN m.module_key IN ('sales','manufacturing','dispatch','warranty') AND r.can_manage_jobs = 1 THEN 1
    WHEN m.module_key IN ('documents','accounting') AND r.can_manage_documents = 1 THEN 1
    ELSE 0
  END AS can_edit,
  CASE
    WHEN r.is_admin = 1 THEN 1
    WHEN m.module_key IN ('sales','manufacturing','dispatch','warranty') AND r.can_manage_jobs = 1 THEN 1
    WHEN m.module_key IN ('documents','accounting') AND r.can_manage_documents = 1 THEN 1
    ELSE 0
  END AS can_delete,
  CASE
    WHEN r.is_admin = 1 THEN 1
    WHEN m.module_key IN ('documents','warranty') AND r.can_approve_document_issue = 1 THEN 1
    ELSE 0
  END AS can_approve
FROM roles r CROSS JOIN modules m;

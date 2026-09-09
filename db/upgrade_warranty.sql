-- =====================================================================
-- Upgrade: Warranty Tracking & Claims, Accounting Document Categories
-- Run this ONCE against an existing database (after schema.sql/seed.sql and
-- db/upgrade_modules_rbac.sql). All statements are additive - safe to run on
-- a live database. If you are setting up a brand new database, schema.sql +
-- seed.sql already include everything in this file, so you can skip it.
-- =====================================================================

ALTER TABLE email_log
  MODIFY COLUMN category ENUM('Workflow Stage','Document Issue','Warranty','System') NOT NULL DEFAULT 'Workflow Stage';

ALTER TABLE transformer_types
  ADD COLUMN warranty_months INT NOT NULL DEFAULT 12 COMMENT 'Default warranty period for units of this type, from dispatch date' AFTER sequence_order;

UPDATE transformer_types SET warranty_months = 18;

CREATE TABLE IF NOT EXISTS warranties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT NOT NULL UNIQUE,
  start_date DATE NOT NULL COMMENT 'Dispatch/completion date',
  duration_months INT NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('Active','Expiring','Expired','Void') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warranty_claims (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warranty_id INT NOT NULL,
  claim_no VARCHAR(60) NOT NULL UNIQUE,
  raised_by INT DEFAULT NULL,
  customer_complaint VARCHAR(1000) NOT NULL,
  raised_date DATE NOT NULL,
  status ENUM('Open','Investigating','Resolved','Rejected','Closed') NOT NULL DEFAULT 'Open',
  assigned_to INT DEFAULT NULL,
  site_visit_date DATE DEFAULT NULL,
  resolution_notes VARCHAR(1000) DEFAULT NULL,
  resolved_date DATE DEFAULT NULL,
  closed_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (warranty_id) REFERENCES warranties(id) ON DELETE CASCADE,
  FOREIGN KEY (raised_by) REFERENCES users(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warranty_claim_parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_id INT NOT NULL,
  part_name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  notes VARCHAR(300) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claim_id) REFERENCES warranty_claims(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE documents
  ADD COLUMN related_warranty_claim_id INT DEFAULT NULL COMMENT 'Set for photos/reports attached to a Warranty claim' AFTER qr_token,
  ADD FOREIGN KEY (related_warranty_claim_id) REFERENCES warranty_claims(id) ON DELETE SET NULL;

ALTER TABLE document_categories
  ADD COLUMN category_type ENUM('operational','accounting') NOT NULL DEFAULT 'operational' COMMENT 'accounting = shown under the Accounting module instead of the general Document Library' AFTER name;

INSERT INTO document_categories (name) VALUES ('Warranty Claim Records')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO document_categories (name, category_type) VALUES
('Sales Invoice', 'accounting'),
('Payment Receipt', 'accounting'),
('E-Way Bill', 'accounting'),
('Purchase Order (Vendor)', 'accounting'),
('Tax Invoice / GST Document', 'accounting')
ON DUPLICATE KEY UPDATE category_type = VALUES(category_type);

INSERT INTO system_settings (setting_key, setting_value) VALUES
('default_warranty_months', '18')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO system_settings (setting_key, setting_value) VALUES
('warranty_expiring_days_before', '60')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Backfill warranties for units that were already Completed before this
-- upgrade ran (a fresh dispatch going forward is handled automatically by
-- routes/jobs.js - see utils/warranty.js). Uses each job's transformer_type
-- lookup where it matches a known type, else the default_warranty_months
-- setting; start_date falls back to the job's last updated_at since the
-- exact historical dispatch date isn't separately recorded.
INSERT IGNORE INTO warranties (job_id, start_date, duration_months, end_date, status)
SELECT
  j.id,
  DATE(j.updated_at),
  COALESCE(tt.warranty_months, 18),
  DATE_ADD(DATE(j.updated_at), INTERVAL COALESCE(tt.warranty_months, 18) MONTH),
  CASE WHEN DATE_ADD(DATE(j.updated_at), INTERVAL COALESCE(tt.warranty_months, 18) MONTH) < CURDATE() THEN 'Expired'
       WHEN DATE_ADD(DATE(j.updated_at), INTERVAL COALESCE(tt.warranty_months, 18) MONTH) <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 'Expiring'
       ELSE 'Active' END
FROM jobs j
LEFT JOIN transformer_types tt ON tt.name = j.transformer_type
WHERE j.status = 'Completed' AND j.is_deleted = 0;

-- Give every role a Warranty/Accounting row in the per-module RBAC grid
-- (db/upgrade_modules_rbac.sql already seeds the `modules` table with these
-- two, but if that migration ran before this file existed, the modules
-- themselves are still present - just re-run the same backfill so any role
-- created since then also gets sensible Warranty/Accounting defaults).
INSERT IGNORE INTO role_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete, can_approve)
SELECT
  r.id, m.id,
  CASE WHEN r.is_admin = 1 OR r.can_manage_jobs = 1 OR r.can_manage_documents = 1 THEN 1 ELSE 0 END,
  CASE WHEN r.is_admin = 1 OR (m.module_key = 'warranty' AND r.can_manage_jobs = 1) OR (m.module_key = 'accounting' AND r.can_manage_documents = 1) THEN 1 ELSE 0 END,
  CASE WHEN r.is_admin = 1 OR (m.module_key = 'warranty' AND r.can_manage_jobs = 1) OR (m.module_key = 'accounting' AND r.can_manage_documents = 1) THEN 1 ELSE 0 END,
  CASE WHEN r.is_admin = 1 OR (m.module_key = 'warranty' AND r.can_manage_jobs = 1) OR (m.module_key = 'accounting' AND r.can_manage_documents = 1) THEN 1 ELSE 0 END,
  CASE WHEN r.is_admin = 1 OR r.can_approve_document_issue = 1 THEN 1 ELSE 0 END
FROM roles r CROSS JOIN modules m
WHERE m.module_key IN ('warranty', 'accounting');

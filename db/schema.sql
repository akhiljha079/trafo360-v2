-- =====================================================================
-- Trafo Power & Electricals Pvt Ltd
-- Sales -> Manufacturing -> Dispatch Workflow & Document Issue Management
-- Built by Vayrone Infratech
-- MySQL / MariaDB Schema
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- ROLES  (defines what a user-type can do; also used for notification routing)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) DEFAULT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  is_director TINYINT(1) NOT NULL DEFAULT 0,
  can_view_confidential TINYINT(1) NOT NULL DEFAULT 0,
  can_approve_document_issue TINYINT(1) NOT NULL DEFAULT 0,
  can_manage_documents TINYINT(1) NOT NULL DEFAULT 0,
  can_manage_jobs TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id INT NOT NULL,
  department VARCHAR(120) DEFAULT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  whatsapp_number VARCHAR(20) DEFAULT NULL COMMENT 'E.164-ish number for WhatsApp Web notifications, e.g. 91XXXXXXXXXX',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- WORKFLOW STAGES  (Sales -> Manufacturing -> Dispatch, in sequence)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stage_code VARCHAR(10) NOT NULL UNIQUE,
  stage_name VARCHAR(150) NOT NULL,
  phase ENUM('Sales','Manufacturing','Dispatch') NOT NULL,
  sequence_order INT NOT NULL,
  owner_role_id INT DEFAULT NULL COMMENT 'Role typically responsible for completing this stage',
  description VARCHAR(500) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (owner_role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- TRANSFORMER TYPES  (admin-customizable - was a fixed 4-value ENUM;
-- orders/jobs.transformer_type now just stores the name as free text so
-- adding a new type here never requires a migration)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transformer_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  sequence_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- GTP FIELD GROUPS / FIELDS  (admin-customizable GTP schema - was a
-- hardcoded constant in utils/gtpFields.js. A group/field with
-- transformer_type_id=NULL applies to every transformer type; otherwise
-- it's scoped to just that type. Field values are still stored per-order
-- as flat JSON in orders.gtp_json (unchanged), keyed by field_key.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gtp_field_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transformer_type_id INT DEFAULT NULL COMMENT 'NULL = applies to all transformer types',
  name VARCHAR(120) NOT NULL,
  sequence_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transformer_type_id) REFERENCES transformer_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gtp_fields (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  field_key VARCHAR(80) NOT NULL UNIQUE COMMENT 'Used as the JSON key in orders.gtp_json and as the gtp_<key> form field name',
  label VARCHAR(150) NOT NULL,
  unit VARCHAR(60) DEFAULT NULL,
  field_type ENUM('text','textarea','number','select') NOT NULL DEFAULT 'text',
  select_options VARCHAR(500) DEFAULT NULL COMMENT 'Comma-separated options, only used when field_type=select',
  stage_codes VARCHAR(255) DEFAULT NULL COMMENT 'Comma-separated stage_code list this field appears on in generated work orders/documents',
  sequence_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES gtp_field_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- ORDERS  (a customer order, e.g. "50 x 10MVA transformers" - one GTP/design)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(60) NOT NULL UNIQUE,
  customer_name VARCHAR(150) NOT NULL,
  po_no VARCHAR(80) DEFAULT NULL,
  transformer_type VARCHAR(100) NOT NULL COMMENT 'Free text matching a transformer_types.name - see Admin > Transformer Types',
  rating VARCHAR(100) DEFAULT NULL,
  total_quantity INT NOT NULL DEFAULT 1,
  gtp_json LONGTEXT DEFAULT NULL COMMENT 'Structured GTP / technical parameters, stored as JSON for flexibility across transformer types',
  gtp_document_id INT DEFAULT NULL COMMENT 'Optional uploaded GTP document from the Document Library',
  status ENUM('Active','On Hold','Completed','Cancelled') NOT NULL DEFAULT 'Active',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- LOTS  (a manufacturing batch within an order, e.g. Lot 1 = 10 units)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  lot_no INT NOT NULL,
  lot_name VARCHAR(100) DEFAULT NULL,
  quantity INT NOT NULL,
  planned_start_date DATE DEFAULT NULL,
  planned_completion_date DATE DEFAULT NULL,
  status ENUM('Active','On Hold','Completed','Cancelled') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_order_lot (order_id, lot_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- TRANSFORMER JOBS  (one row per physical transformer unit moving through the workflow.
-- order_id/lot_id/unit_no are NULL for a standalone job created outside the Orders module.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT DEFAULT NULL,
  lot_id INT DEFAULT NULL,
  unit_no INT DEFAULT NULL COMMENT 'Position of this unit within its lot, e.g. Unit 3 of 10',
  job_no VARCHAR(60) NOT NULL UNIQUE,
  po_no VARCHAR(80) DEFAULT NULL,
  customer_name VARCHAR(150) NOT NULL,
  transformer_type VARCHAR(100) NOT NULL COMMENT 'Free text matching a transformer_types.name - see Admin > Transformer Types',
  rating VARCHAR(100) DEFAULT NULL,
  serial_no VARCHAR(80) DEFAULT NULL,
  target_dispatch_date DATE DEFAULT NULL COMMENT 'Planned dispatch date, used to compute on-track/at-risk/delayed status',
  current_stage_id INT DEFAULT NULL,
  status ENUM('Active','On Hold','Completed','Cancelled') NOT NULL DEFAULT 'Active',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE SET NULL,
  FOREIGN KEY (current_stage_id) REFERENCES stages(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- STAGE DOCUMENT REQUIREMENTS  (admin-customizable: what must be uploaded
-- to complete a given stage - the gate that makes a department "show their work"
-- before a unit is allowed to move to the next stage)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stage_document_requirements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stage_id INT NOT NULL,
  requirement_name VARCHAR(200) NOT NULL,
  is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- JOB STAGE DOCUMENTS  (what a department actually uploaded, per unit, per stage)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_stage_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT NOT NULL,
  stage_id INT NOT NULL,
  requirement_id INT DEFAULT NULL,
  file_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  uploaded_by INT DEFAULT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  remarks VARCHAR(300) DEFAULT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES stages(id),
  FOREIGN KEY (requirement_id) REFERENCES stage_document_requirements(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- JOB STAGE HISTORY  (every start/complete event for a job's stage)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_stage_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT NOT NULL,
  stage_id INT NOT NULL,
  event ENUM('Started','Completed','Skipped') NOT NULL,
  remarks VARCHAR(500) DEFAULT NULL,
  updated_by INT DEFAULT NULL,
  action_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES stages(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- NOTIFICATION RULES  (admin decides: this stage's start/complete emails go to these roles/users)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stage_id INT NOT NULL,
  event ENUM('on_start','on_complete') NOT NULL,
  recipient_role_id INT DEFAULT NULL,
  recipient_user_id INT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_role_id) REFERENCES roles(id),
  FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  CHECK (recipient_role_id IS NOT NULL OR recipient_user_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- EMAIL LOG  (audit trail of every email sent by the system)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category ENUM('Workflow Stage','Document Issue','System') NOT NULL DEFAULT 'Workflow Stage',
  channel ENUM('Email','WhatsApp') NOT NULL DEFAULT 'Email',
  job_id INT DEFAULT NULL,
  document_issue_id INT DEFAULT NULL,
  recipient_email VARCHAR(150) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT,
  status ENUM('Sent','Failed') NOT NULL,
  error_msg VARCHAR(500) DEFAULT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- DOCUMENT CATEGORIES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- DOCUMENTS  (the "library catalogue" - master record for every physical/digital file)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_code VARCHAR(60) NOT NULL UNIQUE,
  doc_name VARCHAR(200) NOT NULL,
  category_id INT DEFAULT NULL,
  confidentiality ENUM('Public','Internal','Confidential','Highly Confidential') NOT NULL DEFAULT 'Internal',
  related_job_id INT DEFAULT NULL,
  related_order_id INT DEFAULT NULL COMMENT 'Set for order/lot-level documents (QAP, BOM, Packing List, etc.)',
  related_lot_id INT DEFAULT NULL,
  storage_location VARCHAR(150) DEFAULT NULL COMMENT 'Physical rack/shelf/cabinet reference, if a physical file',
  file_path VARCHAR(500) DEFAULT NULL COMMENT 'Uploaded scanned copy, if any',
  qr_token VARCHAR(64) DEFAULT NULL UNIQUE COMMENT 'Random token encoded in this document''s QR label for physical file tracking',
  uploaded_by INT DEFAULT NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  current_status ENUM('Available','Issued','Archived') NOT NULL DEFAULT 'Available',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES document_categories(id),
  FOREIGN KEY (related_job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (related_lot_id) REFERENCES lots(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- DOCUMENT TEMPLATES  (admin-customizable settings per generated-document
-- type - numbering prefix, which GTP-tagged stages feed its data table,
-- enable/disable. The actual PDF layout lives in
-- views/documents/generate/pdf-template.ejs, driven by utils/documentTypes.js)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_type VARCHAR(60) NOT NULL UNIQUE COMMENT 'Matches a key in utils/documentTypes.js',
  name VARCHAR(150) NOT NULL,
  numbering_prefix VARCHAR(20) NOT NULL,
  source_stage_codes VARCHAR(255) DEFAULT NULL COMMENT 'Comma-separated stage_codes whose GTP-tagged fields feed this document',
  intro_text VARCHAR(1000) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- GENERATED DOCUMENTS  (audit trail linking a PDF the system generated back
-- to its source job/order/lot and the documents-library row it created)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_type VARCHAR(60) NOT NULL,
  document_id INT NOT NULL COMMENT 'The documents-library row holding the actual PDF',
  job_id INT DEFAULT NULL,
  order_id INT DEFAULT NULL,
  lot_id INT DEFAULT NULL,
  generated_by INT DEFAULT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE SET NULL,
  FOREIGN KEY (generated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- DOCUMENT ISSUE REQUESTS  (borrow/checkout workflow, like a library circulation desk)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_id INT NOT NULL,
  requested_by INT NOT NULL,
  purpose VARCHAR(300) DEFAULT NULL,
  requested_days INT NOT NULL DEFAULT 7,
  status ENUM(
    'Pending Approval','Rejected','Approved','Issued',
    'Returned','Overdue','Escalated',
    'Extension Requested','Extension Approved','Extension Rejected'
  ) NOT NULL DEFAULT 'Pending Approval',
  approver_id INT DEFAULT NULL,
  approval_decision_at TIMESTAMP NULL DEFAULT NULL,
  approval_remarks VARCHAR(300) DEFAULT NULL,
  approver_signature LONGTEXT DEFAULT NULL COMMENT 'Base64 PNG captured signature at approval time',
  issue_date DATE DEFAULT NULL,
  due_date DATE DEFAULT NULL,
  return_date DATE DEFAULT NULL,
  last_reminder_sent DATE DEFAULT NULL,
  escalated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- ISSUE EXTENSION REQUESTS  (requester asks for more time; approver decides)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS issue_extensions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  document_issue_id INT NOT NULL,
  requested_new_due_date DATE NOT NULL,
  reason VARCHAR(300) DEFAULT NULL,
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  approver_signature LONGTEXT DEFAULT NULL COMMENT 'Base64 PNG captured signature at approval time',
  approver_id INT DEFAULT NULL,
  decided_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_issue_id) REFERENCES document_issues(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- SMTP SETTINGS  (editable from Admin UI; falls back to .env if empty)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smtp_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  host VARCHAR(150) NOT NULL,
  port INT NOT NULL DEFAULT 587,
  secure TINYINT(1) NOT NULL DEFAULT 0,
  username VARCHAR(150) NOT NULL,
  password VARCHAR(255) NOT NULL,
  from_email VARCHAR(150) NOT NULL,
  from_name VARCHAR(150) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- SYSTEM SETTINGS  (key-value store: company name, grace period, default issue days etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value TEXT DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- Add-on Migration: Orders & Lots hierarchy, GTP parameters, stage
-- document requirements (department upload gating), and soft-delete.
-- Run this ONCE against an existing database that predates this feature.
-- Safe/additive - a fresh `npm run seed` on a brand new database already
-- includes all of this via schema.sql, so you can skip this file then.
-- =====================================================================

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(60) NOT NULL UNIQUE,
  customer_name VARCHAR(150) NOT NULL,
  po_no VARCHAR(80) DEFAULT NULL,
  transformer_type ENUM('Power Transformer','Distribution Transformer','IDT (Interconnecting/Auto)','Special Purpose') NOT NULL,
  rating VARCHAR(100) DEFAULT NULL,
  total_quantity INT NOT NULL DEFAULT 1,
  gtp_json LONGTEXT DEFAULT NULL,
  gtp_document_id INT DEFAULT NULL,
  status ENUM('Active','On Hold','Completed','Cancelled') NOT NULL DEFAULT 'Active',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

ALTER TABLE jobs
  ADD COLUMN order_id INT DEFAULT NULL AFTER id,
  ADD COLUMN lot_id INT DEFAULT NULL AFTER order_id,
  ADD COLUMN unit_no INT DEFAULT NULL AFTER lot_id,
  ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD CONSTRAINT fk_jobs_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_jobs_lot FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS stage_document_requirements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stage_id INT NOT NULL,
  requirement_name VARCHAR(200) NOT NULL,
  is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

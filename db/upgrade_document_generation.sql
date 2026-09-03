-- =====================================================================
-- Upgrade: Technical Document Generation Engine
-- Run this ONCE against an existing database that predates this change.
-- A fresh `npm run seed` on a new database already includes everything
-- via schema.sql + seed.sql - do not run this against a fresh install.
-- =====================================================================

SET NAMES utf8mb4;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS related_order_id INT DEFAULT NULL COMMENT 'Set for order/lot-level documents (QAP, BOM, Packing List, etc.)' AFTER related_job_id,
  ADD COLUMN IF NOT EXISTS related_lot_id INT DEFAULT NULL AFTER related_order_id;

-- MySQL/MariaDB versions without ADD COLUMN IF NOT EXISTS support will error
-- on the two lines above if the columns already exist - safe to ignore in
-- that case. Foreign keys added separately since "ADD CONSTRAINT IF NOT
-- EXISTS" isn't universally supported either.
ALTER TABLE documents ADD CONSTRAINT fk_documents_related_order FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE documents ADD CONSTRAINT fk_documents_related_lot FOREIGN KEY (related_lot_id) REFERENCES lots(id) ON DELETE SET NULL;

ALTER TABLE system_settings MODIFY COLUMN setting_value TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS document_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_type VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  numbering_prefix VARCHAR(20) NOT NULL,
  source_stage_codes VARCHAR(255) DEFAULT NULL,
  intro_text VARCHAR(1000) DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS generated_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_type VARCHAR(60) NOT NULL,
  document_id INT NOT NULL,
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

INSERT IGNORE INTO document_categories (name) VALUES ('System-Generated Documents');

INSERT IGNORE INTO document_templates (doc_type, name, numbering_prefix, source_stage_codes, intro_text) VALUES
('routine_test_report', 'Routine Test Report', 'RTR', 'M10', 'Routine electrical tests performed in accordance with the applicable standard prior to dispatch. Measured values to be filled in by QA/Testing.'),
('type_test_certificate', 'Type Test Certificate', 'TTC', 'M11', 'Type/special tests performed on a representative unit of this design, in accordance with the applicable standard.'),
('qap', 'Quality Assurance Plan', 'QAP', 'M1,M2,M3,M4,M5,M6,M7,M8,M9,M10,M11,M12,M13', 'Quality assurance / inspection plan for this order, listing the inspection and documentation requirement at each manufacturing stage.'),
('inspection_call_notice', 'Inspection Call Notice', 'ICN', 'M13', 'Notice inviting the customer / third-party inspection agency to witness final inspection prior to dispatch.'),
('packing_list', 'Packing List', 'PL', 'D1', 'Packing list for the unit(s) covered by this document.'),
('dispatch_clearance', 'Dispatch Clearance Note', 'DCN', 'D1,D2,D3,D4', 'Confirms this unit has cleared all pre-dispatch requirements and is cleared for dispatch from the factory.'),
('warranty_certificate', 'Warranty Certificate', 'WC', NULL, 'Warranty terms and conditions applicable to this transformer.'),
('nameplate', 'Nameplate / Rating Plate Data Sheet', 'NP', 'M1', 'Rating plate data for this unit.'),
('technical_offer', 'Technical Offer Sheet', 'TOS', 'M1', 'Technical offer summary for this order, for customer reference.'),
('bom_export', 'Bill of Materials Export', 'BOM', 'M1,M2,M3,M4,M5,M6', 'Bill of materials / key components summary for this order, drawn from the GTP design data.'),
('mtc_index', 'Material Test Certificate Index', 'MTCI', NULL, 'Index of material test certificates on file in the Document Library for this order.');

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
('warranty_terms_text', 'This transformer is warranted against defects in material and workmanship for a period of 18 months from the date of dispatch or 12 months from the date of commissioning, whichever is earlier, subject to the transformer being installed, operated, and maintained in accordance with the manufacturer''s instructions. This warranty does not cover damage due to improper installation, unauthorized repair, or force majeure.');

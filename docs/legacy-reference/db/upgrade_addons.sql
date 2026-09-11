-- =====================================================================
-- Add-on Migration: QR Tracking, E-Signatures, WhatsApp Web Notifications
-- Run this ONCE against an existing database (after schema.sql/seed.sql).
-- All statements are additive - safe to run on a live database.
-- If you are setting up a brand new database, schema.sql already includes
-- these columns, so you can skip this file.
-- =====================================================================

-- ---- QR-code physical file tracking ----
ALTER TABLE documents
  ADD COLUMN qr_token VARCHAR(64) DEFAULT NULL UNIQUE AFTER file_path;

-- ---- E-signature capture on approvals ----
ALTER TABLE document_issues
  ADD COLUMN approver_signature LONGTEXT DEFAULT NULL AFTER approval_remarks;

ALTER TABLE issue_extensions
  ADD COLUMN approver_signature LONGTEXT DEFAULT NULL AFTER status;

-- ---- WhatsApp Web (unofficial) notifications ----
ALTER TABLE users
  ADD COLUMN whatsapp_number VARCHAR(20) DEFAULT NULL AFTER phone;

ALTER TABLE email_log
  ADD COLUMN channel ENUM('Email','WhatsApp') NOT NULL DEFAULT 'Email' AFTER category;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('whatsapp_enabled', '0')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('app_name', 'TRAFO 360')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Backfill a random qr_token for any documents created before this migration.
-- (Safe to re-run - only affects rows where qr_token IS NULL.)
UPDATE documents
SET qr_token = SUBSTRING(MD5(RAND()), 1, 32)
WHERE qr_token IS NULL;

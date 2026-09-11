-- =====================================================================
-- Upgrade: OCR Text Extraction on Uploaded Scans
-- Run this ONCE against an existing database. Additive - safe on a live DB.
-- If setting up a brand new database, schema.sql already includes this.
-- =====================================================================

ALTER TABLE documents
  ADD COLUMN ocr_text LONGTEXT DEFAULT NULL COMMENT 'Best-effort text extracted from an uploaded image via Tesseract OCR - see utils/ocr.js. NULL until processed or if unsupported/failed.' AFTER customer_visible;

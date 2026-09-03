-- =====================================================================
-- Add-on Migration: Project Status (target dispatch date for RAG tracking)
-- Run this ONCE against an existing database that predates this feature.
-- Safe/additive - if you're setting up a brand new database, schema.sql
-- already includes this column, so you can skip this file.
-- =====================================================================

ALTER TABLE jobs
  ADD COLUMN target_dispatch_date DATE DEFAULT NULL
  COMMENT 'Planned dispatch date, used to compute on-track/at-risk/delayed status'
  AFTER serial_no;

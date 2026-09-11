-- =====================================================================
-- Upgrade: Configurable GTP Schema + Transformer Types
-- Run this ONCE against an existing database that predates this change.
-- A fresh `npm run seed` on a new database already includes everything
-- via schema.sql + seed.sql - do not run this against a fresh install.
--
-- What this does:
--   1. Creates transformer_types, gtp_field_groups, gtp_fields.
--   2. Converts orders.transformer_type and jobs.transformer_type from a
--      fixed 4-value ENUM to free-text VARCHAR(100) - existing values are
--      preserved exactly (VARCHAR is a superset of the old ENUM values),
--      this just removes the hardcoded list so Admin > Transformer Types
--      can add more without a future migration.
--   3. Seeds the same 4 transformer types and the same GTP fields that
--      were previously hardcoded in utils/gtpFields.js, so existing
--      orders' gtp_json keeps rendering identically.
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS transformer_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  sequence_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  field_key VARCHAR(80) NOT NULL UNIQUE,
  label VARCHAR(150) NOT NULL,
  unit VARCHAR(60) DEFAULT NULL,
  field_type ENUM('text','textarea','number','select') NOT NULL DEFAULT 'text',
  select_options VARCHAR(500) DEFAULT NULL,
  stage_codes VARCHAR(255) DEFAULT NULL,
  sequence_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES gtp_field_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE orders MODIFY COLUMN transformer_type VARCHAR(100) NOT NULL;
ALTER TABLE jobs MODIFY COLUMN transformer_type VARCHAR(100) NOT NULL;

INSERT IGNORE INTO transformer_types (name, sequence_order) VALUES
('Power Transformer', 1),
('Distribution Transformer', 2),
('IDT (Interconnecting/Auto)', 3),
('Special Purpose', 4);

INSERT IGNORE INTO gtp_field_groups (id, transformer_type_id, name, sequence_order) VALUES
(1, NULL, 'General', 1),
(2, NULL, 'Voltage & Ratios', 2),
(3, NULL, 'Losses & Impedance', 3),
(4, NULL, 'Core', 4),
(5, NULL, 'Windings', 5),
(6, NULL, 'Tap Changer', 6),
(7, NULL, 'Insulation', 7),
(8, NULL, 'Tank & Oil', 8),
(9, NULL, 'Bushings & Accessories', 9);

INSERT IGNORE INTO gtp_fields (group_id, field_key, label, unit, field_type, stage_codes, sequence_order) VALUES
(1, 'rated_power', 'Rated Power', 'kVA/MVA', 'text', 'M1', 1),
(1, 'frequency', 'Frequency', 'Hz', 'text', 'M1', 2),
(1, 'phases', 'No. of Phases', NULL, 'text', 'M1', 3),
(1, 'standard', 'Applicable Standard', 'e.g. IS 2026 / IEC 60076', 'text', 'M1', 4),
(1, 'cooling_type', 'Type of Cooling', 'ONAN / ONAF / OFAF / ODAF', 'text', 'M1,M6', 5),
(1, 'installation', 'Installation', 'Indoor / Outdoor', 'text', 'M1', 6),
(1, 'vector_group', 'Vector Group', NULL, 'text', 'M1,M4,M5', 7),
(2, 'hv_voltage', 'HV Voltage', 'kV', 'text', 'M1,M4', 1),
(2, 'lv_voltage', 'LV Voltage', 'kV', 'text', 'M1,M4', 2),
(2, 'tertiary_voltage', 'Tertiary Voltage (if any)', 'kV', 'text', 'M1,M4', 3),
(2, 'voltage_variation', 'Voltage Variation Range', '%', 'text', 'M1,M4', 4),
(3, 'no_load_loss_kw', 'No-Load Loss', 'kW', 'text', 'M1,M3,M10', 1),
(3, 'load_loss_kw', 'Load Loss', 'kW', 'text', 'M1,M4,M10', 2),
(3, 'impedance_pct', 'Impedance', '%', 'text', 'M1,M4,M10', 3),
(3, 'temp_rise_oil', 'Temperature Rise - Oil', '°C', 'text', 'M1,M8,M10', 4),
(3, 'temp_rise_winding', 'Temperature Rise - Winding', '°C', 'text', 'M1,M8,M10', 5),
(4, 'core_material', 'Core Material / Grade', 'e.g. CRGO M4', 'text', 'M1,M3', 1),
(4, 'core_type', 'Core Type', 'Core / Shell', 'text', 'M1,M3', 2),
(4, 'flux_density', 'Flux Density', 'Tesla', 'text', 'M1,M3', 3),
(4, 'core_weight_kg', 'Core Weight', 'kg', 'text', 'M1,M3', 4),
(5, 'hv_winding_material', 'HV Winding Material', 'Cu / Al', 'text', 'M1,M4', 1),
(5, 'lv_winding_material', 'LV Winding Material', 'Cu / Al', 'text', 'M1,M4', 2),
(5, 'winding_type', 'Winding Type', 'Disc / Helical / Layer', 'text', 'M1,M4', 3),
(5, 'current_density', 'Current Density', 'A/mm²', 'text', 'M1,M4', 4),
(6, 'tap_changer_type', 'Tap Changer Type', 'OLTC / OCTC', 'text', 'M1,M4,M5', 1),
(6, 'tap_range', 'Tap Range', '%', 'text', 'M1,M4,M5', 2),
(6, 'tap_steps', 'Number of Tap Steps', NULL, 'text', 'M1,M4,M5', 3),
(7, 'bil_hv', 'BIL - HV', 'kV', 'text', 'M1,M5,M10', 1),
(7, 'bil_lv', 'BIL - LV', 'kV', 'text', 'M1,M5,M10', 2),
(7, 'insulation_class', 'Insulation Class', NULL, 'text', 'M1,M5,M8', 3),
(8, 'tank_type', 'Tank Type', 'e.g. Corrugated / Plain with Radiators', 'text', 'M1,M6', 1),
(8, 'oil_type', 'Oil Type', 'e.g. Mineral / Synthetic Ester', 'text', 'M1,M9', 2),
(8, 'oil_quantity_l', 'Total Oil Quantity', 'Litres', 'text', 'M1,M9', 3),
(8, 'untanked_weight_kg', 'Untanked Weight', 'kg', 'text', 'M1,M6', 4),
(8, 'total_weight_kg', 'Total Weight (Tanked)', 'kg', 'text', 'M1,M6', 5),
(9, 'hv_bushing', 'HV Bushing Type & Rating', NULL, 'text', 'M1,M5', 1),
(9, 'lv_bushing', 'LV Bushing Type & Rating', NULL, 'text', 'M1,M5', 2),
(9, 'paint_shade', 'Paint Shade', 'e.g. RAL 7032', 'text', 'M1,M7', 3),
(9, 'fittings', 'Standard Fittings / Accessories', NULL, 'textarea', 'M1,M6', 4);

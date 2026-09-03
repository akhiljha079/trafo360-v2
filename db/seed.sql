-- =====================================================================
-- Seed Data: Roles, Workflow Stages, Document Categories, Default Settings
-- Run this AFTER schema.sql. Admin user is created separately via
-- `npm run create-admin` (so the password is hashed correctly).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ROLES
-- ---------------------------------------------------------------------
INSERT INTO roles (name, description, is_admin, is_director, can_view_confidential, can_approve_document_issue, can_manage_documents, can_manage_jobs) VALUES
('Admin',                    'Full system administrator',                                    1, 0, 1, 1, 1, 1),
('Director',                 'Receives escalation emails; approves document issue/extension', 0, 1, 1, 1, 0, 0),
('Sales',                    'Handles enquiry through order booking',                        0, 0, 0, 0, 0, 1),
('Design Engineering',       'Design, drawings, BOM',                                        0, 0, 1, 0, 0, 1),
('Stores / Procurement',     'Material procurement & incoming inspection',                   0, 0, 0, 0, 0, 1),
('Production - Core & Winding','Core cutting, stacking, winding',                             0, 0, 0, 0, 0, 1),
('Production - Assembly',    'Active part assembly',                                         0, 0, 0, 0, 0, 1),
('Production - Fabrication', 'Tank, radiator, painting',                                     0, 0, 0, 0, 0, 1),
('Production - Oil & Drying','Drying and oil processing',                                    0, 0, 0, 0, 0, 1),
('QA / Testing',             'Testing, inspection, NCR, QA release',                         0, 0, 1, 0, 0, 1),
('Dispatch',                 'Packing, dispatch, logistics',                                 0, 0, 0, 0, 0, 1),
('Documents Coordinator',    'Manages document library & issue/return workflow',             0, 0, 1, 0, 1, 0);

-- ---------------------------------------------------------------------
-- STAGES  (sequence_order drives progress bar; phase groups Sales/Manufacturing/Dispatch)
-- ---------------------------------------------------------------------
INSERT INTO stages (stage_code, stage_name, phase, sequence_order, owner_role_id, description) VALUES
-- SALES PHASE
('S1','Enquiry / Lead Received','Sales',1,(SELECT id FROM roles WHERE name='Sales'),'Initial customer enquiry logged'),
('S2','Technical Discussion & GTP Preparation','Sales',2,(SELECT id FROM roles WHERE name='Sales'),'Technical clarification, GTP drafted'),
('S3','Quotation / Offer Submitted','Sales',3,(SELECT id FROM roles WHERE name='Sales'),'Commercial offer sent to customer'),
('S4','Negotiation','Sales',4,(SELECT id FROM roles WHERE name='Sales'),'Commercial/technical negotiation'),
('S5','Purchase Order / LOI Received','Sales',5,(SELECT id FROM roles WHERE name='Sales'),'Customer PO or LOI received'),
('S6','Order Acknowledgement & Advance','Sales',6,(SELECT id FROM roles WHERE name='Sales'),'Order acknowledged, advance payment tracked'),
('S7','Drawing / GTP Approval by Customer','Sales',7,(SELECT id FROM roles WHERE name='Design Engineering'),'Customer approves GA/GTP/drawings'),
('S8','Production Order Released','Sales',8,(SELECT id FROM roles WHERE name='Sales'),'Order formally handed over to manufacturing'),
-- MANUFACTURING PHASE
('M1','Design & BOM Finalisation','Manufacturing',9,(SELECT id FROM roles WHERE name='Design Engineering'),'Electrical design, calculations, BOM'),
('M2','Material Procurement & Incoming QC','Manufacturing',10,(SELECT id FROM roles WHERE name='Stores / Procurement'),'Raw material procured & inspected'),
('M3','Core Cutting & Stacking','Manufacturing',11,(SELECT id FROM roles WHERE name='Production - Core & Winding'),'Core manufacturing'),
('M4','HV/LV Winding','Manufacturing',12,(SELECT id FROM roles WHERE name='Production - Core & Winding'),'Winding process'),
('M5','Active Part Assembly','Manufacturing',13,(SELECT id FROM roles WHERE name='Production - Assembly'),'Core-coil assembly, tap changer mounting'),
('M6','Tank & Radiator Fabrication','Manufacturing',14,(SELECT id FROM roles WHERE name='Production - Fabrication'),'Tank & radiator fabrication, leak test'),
('M7','Painting','Manufacturing',15,(SELECT id FROM roles WHERE name='Production - Fabrication'),'Surface prep & painting, DFT check'),
('M8','Drying (Vapor Phase / Vacuum)','Manufacturing',16,(SELECT id FROM roles WHERE name='Production - Oil & Drying'),'Active part drying'),
('M9','Oil Filtration & Tanking','Manufacturing',17,(SELECT id FROM roles WHERE name='Production - Oil & Drying'),'Oil processing, tanking, vacuum filling'),
('M10','Routine Testing','Manufacturing',18,(SELECT id FROM roles WHERE name='QA / Testing'),'Routine electrical tests'),
('M11','Special / Type Testing (if applicable)','Manufacturing',19,(SELECT id FROM roles WHERE name='QA / Testing'),'Type/special tests where required'),
('M12','NCR Resolution (if any)','Manufacturing',20,(SELECT id FROM roles WHERE name='QA / Testing'),'Non-conformance closure, conditional stage'),
('M13','Final Inspection & QA Release','Manufacturing',21,(SELECT id FROM roles WHERE name='QA / Testing'),'Final QA sign-off for dispatch'),
-- DISPATCH PHASE
('D1','Packing & Preservation','Dispatch',22,(SELECT id FROM roles WHERE name='Dispatch'),'Packing, preservation inspection'),
('D2','Final Documentation Compilation','Dispatch',23,(SELECT id FROM roles WHERE name='Documents Coordinator'),'QA/MRB book compiled'),
('D3','Invoice / E-Way Bill Generation','Dispatch',24,(SELECT id FROM roles WHERE name='Dispatch'),'Commercial invoice & E-Way Bill'),
('D4','Transportation Arranged','Dispatch',25,(SELECT id FROM roles WHERE name='Dispatch'),'Vehicle arranged, fitness certificate'),
('D5','Dispatched from Factory','Dispatch',26,(SELECT id FROM roles WHERE name='Dispatch'),'Transformer leaves factory premises'),
('D6','Delivered to Customer Site','Dispatch',27,(SELECT id FROM roles WHERE name='Dispatch'),'Confirmed delivery / installation support'),
('D7','Final Documents Handed to Customer','Dispatch',28,(SELECT id FROM roles WHERE name='Documents Coordinator'),'Complete document package issued to customer - order closed');

-- ---------------------------------------------------------------------
-- TRANSFORMER TYPES  (was a fixed ENUM; now admin-customizable)
-- ---------------------------------------------------------------------
INSERT INTO transformer_types (name, sequence_order) VALUES
('Power Transformer', 1),
('Distribution Transformer', 2),
('IDT (Interconnecting/Auto)', 3),
('Special Purpose', 4);

-- ---------------------------------------------------------------------
-- GTP FIELD GROUPS & FIELDS  (was the hardcoded GTP_GROUPS constant in
-- utils/gtpFields.js; transformer_type_id NULL = applies to every type,
-- matching the single shared schema every type used before this change)
-- ---------------------------------------------------------------------
INSERT INTO gtp_field_groups (id, transformer_type_id, name, sequence_order) VALUES
(1, NULL, 'General', 1),
(2, NULL, 'Voltage & Ratios', 2),
(3, NULL, 'Losses & Impedance', 3),
(4, NULL, 'Core', 4),
(5, NULL, 'Windings', 5),
(6, NULL, 'Tap Changer', 6),
(7, NULL, 'Insulation', 7),
(8, NULL, 'Tank & Oil', 8),
(9, NULL, 'Bushings & Accessories', 9);

INSERT INTO gtp_fields (group_id, field_key, label, unit, field_type, stage_codes, sequence_order) VALUES
-- General
(1, 'rated_power', 'Rated Power', 'kVA/MVA', 'text', 'M1', 1),
(1, 'frequency', 'Frequency', 'Hz', 'text', 'M1', 2),
(1, 'phases', 'No. of Phases', NULL, 'text', 'M1', 3),
(1, 'standard', 'Applicable Standard', 'e.g. IS 2026 / IEC 60076', 'text', 'M1', 4),
(1, 'cooling_type', 'Type of Cooling', 'ONAN / ONAF / OFAF / ODAF', 'text', 'M1,M6', 5),
(1, 'installation', 'Installation', 'Indoor / Outdoor', 'text', 'M1', 6),
(1, 'vector_group', 'Vector Group', NULL, 'text', 'M1,M4,M5', 7),
-- Voltage & Ratios
(2, 'hv_voltage', 'HV Voltage', 'kV', 'text', 'M1,M4', 1),
(2, 'lv_voltage', 'LV Voltage', 'kV', 'text', 'M1,M4', 2),
(2, 'tertiary_voltage', 'Tertiary Voltage (if any)', 'kV', 'text', 'M1,M4', 3),
(2, 'voltage_variation', 'Voltage Variation Range', '%', 'text', 'M1,M4', 4),
-- Losses & Impedance
(3, 'no_load_loss_kw', 'No-Load Loss', 'kW', 'text', 'M1,M3,M10', 1),
(3, 'load_loss_kw', 'Load Loss', 'kW', 'text', 'M1,M4,M10', 2),
(3, 'impedance_pct', 'Impedance', '%', 'text', 'M1,M4,M10', 3),
(3, 'temp_rise_oil', 'Temperature Rise - Oil', '°C', 'text', 'M1,M8,M10', 4),
(3, 'temp_rise_winding', 'Temperature Rise - Winding', '°C', 'text', 'M1,M8,M10', 5),
-- Core
(4, 'core_material', 'Core Material / Grade', 'e.g. CRGO M4', 'text', 'M1,M3', 1),
(4, 'core_type', 'Core Type', 'Core / Shell', 'text', 'M1,M3', 2),
(4, 'flux_density', 'Flux Density', 'Tesla', 'text', 'M1,M3', 3),
(4, 'core_weight_kg', 'Core Weight', 'kg', 'text', 'M1,M3', 4),
-- Windings
(5, 'hv_winding_material', 'HV Winding Material', 'Cu / Al', 'text', 'M1,M4', 1),
(5, 'lv_winding_material', 'LV Winding Material', 'Cu / Al', 'text', 'M1,M4', 2),
(5, 'winding_type', 'Winding Type', 'Disc / Helical / Layer', 'text', 'M1,M4', 3),
(5, 'current_density', 'Current Density', 'A/mm²', 'text', 'M1,M4', 4),
-- Tap Changer
(6, 'tap_changer_type', 'Tap Changer Type', 'OLTC / OCTC', 'text', 'M1,M4,M5', 1),
(6, 'tap_range', 'Tap Range', '%', 'text', 'M1,M4,M5', 2),
(6, 'tap_steps', 'Number of Tap Steps', NULL, 'text', 'M1,M4,M5', 3),
-- Insulation
(7, 'bil_hv', 'BIL - HV', 'kV', 'text', 'M1,M5,M10', 1),
(7, 'bil_lv', 'BIL - LV', 'kV', 'text', 'M1,M5,M10', 2),
(7, 'insulation_class', 'Insulation Class', NULL, 'text', 'M1,M5,M8', 3),
-- Tank & Oil
(8, 'tank_type', 'Tank Type', 'e.g. Corrugated / Plain with Radiators', 'text', 'M1,M6', 1),
(8, 'oil_type', 'Oil Type', 'e.g. Mineral / Synthetic Ester', 'text', 'M1,M9', 2),
(8, 'oil_quantity_l', 'Total Oil Quantity', 'Litres', 'text', 'M1,M9', 3),
(8, 'untanked_weight_kg', 'Untanked Weight', 'kg', 'text', 'M1,M6', 4),
(8, 'total_weight_kg', 'Total Weight (Tanked)', 'kg', 'text', 'M1,M6', 5),
-- Bushings & Accessories
(9, 'hv_bushing', 'HV Bushing Type & Rating', NULL, 'text', 'M1,M5', 1),
(9, 'lv_bushing', 'LV Bushing Type & Rating', NULL, 'text', 'M1,M5', 2),
(9, 'paint_shade', 'Paint Shade', 'e.g. RAL 7032', 'text', 'M1,M7', 3),
(9, 'fittings', 'Standard Fittings / Accessories', NULL, 'textarea', 'M1,M6', 4);

-- ---------------------------------------------------------------------
-- DOCUMENT CATEGORIES
-- ---------------------------------------------------------------------
INSERT INTO document_categories (name) VALUES
('Customer PO & Contracts'),
('Design & Drawings'),
('Material Test Certificates'),
('Manufacturing / In-process Records'),
('Test Reports & Certificates'),
('QA / NCR Records'),
('Dispatch & Logistics'),
('Financial / Commercial'),
('HR & Administrative'),
('General / Miscellaneous');

-- ---------------------------------------------------------------------
-- DEFAULT SYSTEM SETTINGS
-- ---------------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value) VALUES
('company_name', 'Trafo Power & Electricals Pvt Ltd'),
('app_name', 'TRAFO 360'),
('company_tagline', 'Manufacturer of Power & Distribution Transformers'),
('powered_by', 'Vayrone Infratech'),
('default_issue_days', '7'),
('grace_period_working_days', '2'),
('reminder_days_before_due', '1'),
('whatsapp_enabled', '0');

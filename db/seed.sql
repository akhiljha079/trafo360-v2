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
